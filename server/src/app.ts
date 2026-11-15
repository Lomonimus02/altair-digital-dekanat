import { existsSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { moscowToday, resolveWhen } from "../../shared/src/dates";
import { CONTEST_NOTE, kindMeta, UNIVERSITY, type PublicUser } from "../../shared/src/domain";
import { analyzeSession } from "../../shared/src/navigator";
import { hashPassword, randomToken, sessionHash, verifyPassword } from "./auth/crypto";
import { clarifyChoice, confirmPending, perform, rejectPending, runTurn, studentBrief } from "./actions";
import { getConfig } from "./config";
import { REGULATION_DOCS, searchRegulations } from "./content/regulations";
import { getDb, getPool } from "./db/client";
import { requests, sessions, users } from "./db/schema";
import { subscribe } from "./hub";
import { HttpError } from "./httpError";
import {
  findUserById,
  findUserByLogin,
  getRequestFor,
  listAnnouncements,
  listAudit,
  listNotifications,
  listOwnRequests,
  loadDisciplines,
  loadSchedule,
  semestersFor,
  staffInbox,
  toPublic,
} from "./loaders";
import { renderCertificate } from "./pdf";
import { getStudentHomework, getTeacherAssignment, listStudentHomework, teacherHome, teacherQueue, journal } from "./homework";
import { triageRequest } from "./triage";
import type { RequestStatus } from "../../shared/src/domain";
import { STATUS_LABEL } from "../../shared/src/domain";

declare module "fastify" {
  interface FastifyRequest {
    user?: PublicUser;
    sessionCsrf?: string;
  }
}

const loginSchema = z.object({
  login: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
});

const buckets = new Map<string, { count: number; reset: number }>();

export function resetRateLimits() {
  buckets.clear();
}

function allow(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function originAllowed(request: FastifyRequest) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = request.headers.host;
    if (!getConfig().production && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return true;
    if (host && url.host === host) return true;
    if (getConfig().publicBaseUrl && origin === getConfig().publicBaseUrl) return true;
    return false;
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;

function publicBase(request: FastifyRequest) {
  if (getConfig().publicBaseUrl) return getConfig().publicBaseUrl;
  const proto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  return `${proto}://${request.headers.host}`;
}

export function cspDirectives() {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    imgSrc: ["'self'", "data:", "blob:"],
    fontSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    workerSrc: ["'self'", "blob:"],
    connectSrc: [
      "'self'",
      "https://huggingface.co",
      "https://cdn-lfs.huggingface.co",
      "https://cas-bridge.xethub.hf.co",
      "https://raw.githubusercontent.com",
    ],
    manifestSrc: ["'self'"],
  };
}

export async function buildApp() {
  const config = getConfig();
  const app = Fastify({
    logger: config.nodeEnv === "test" ? false : { level: config.logLevel, redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password"] },
    bodyLimit: 256 * 1024,
    trustProxy: config.trustProxy,
  });
  const clientDist = path.resolve(process.cwd(), "client/dist");
  const serveStatic = config.production && existsSync(clientDist);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: serveStatic ? { directives: cspDirectives() } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.code, message: error.message });
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "bad_request",
        message: "Проверьте поля",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "internal", message: "Что-то пошло не так" });
  });

  app.get("/api/health", async (_request, reply) => {
    try {
      await getPool().query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    if (!originAllowed(request)) return reply.code(403).send({ error: "forbidden", message: "Чужой источник запроса" });
    const ip = request.ip || "local";
    const body = loginSchema.parse(request.body);
    const key = `${ip}:${body.login.toLowerCase()}`;
    if (!allow(key, config.loginLimit, 10 * 60 * 1000)) {
      return reply.code(429).send({ error: "rate_limited", message: "Слишком много попыток. Подождите и попробуйте снова." });
    }
    const row = await findUserByLogin(body.login);
    dummyHashPromise ??= hashPassword("not-a-real-password-value");
    const ok = await verifyPassword(body.password, row?.passwordHash ?? (await dummyHashPromise));
    if (!row || !ok) return reply.code(401).send({ error: "unauthorized", message: "Неверный логин или пароль" });
    const token = randomToken();
    const csrfToken = randomToken();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await getDb().insert(sessions).values({ userId: row.id, tokenHash: sessionHash(token), csrfToken, expiresAt: expires });
    const cookieBase = { path: "/", sameSite: "lax" as const, secure: config.cookieSecure, maxAge: 7 * 86400 };
    reply.setCookie("sid", token, { ...cookieBase, httpOnly: true });
    reply.setCookie("csrf", csrfToken, { ...cookieBase, httpOnly: false });
    return { user: toPublic(row), csrfToken };
  });

  app.get("/api/verify/:code", async (request, reply) => {
    if (!allow(`verify:${request.ip}`, 40, 60_000)) return reply.code(429).send({ error: "rate_limited", message: "Слишком много проверок." });
    const code = (request.params as { code: string }).code.slice(0, 32);
    const rows = await getDb().select().from(requests).where(eq(requests.verifyCode, code)).limit(1);
    const row = rows[0];
    if (!row || (row.status !== "ready" && row.status !== "issued")) return reply.code(404).send({ valid: false, error: "not_found" });
    const owner = await findUserById(row.studentId);
    if (!owner) return reply.code(404).send({ valid: false, error: "not_found" });
    return {
      valid: true,
      documentTitle: row.title,
      studentName: owner.fullName,
      institute: owner.institute,
      direction: owner.direction,
      course: owner.course,
      group: owner.groupName,
      issuedAt: row.updatedAt,
      status: "действительна",
      university: UNIVERSITY,
    };
  });

  app.register(async (scope) => {
    scope.addHook("preHandler", async (request, reply) => {
      const sid = request.cookies.sid;
      if (!sid) return reply.code(401).send({ error: "unauthorized", message: "Нужно войти" });
      const rows = await getDb()
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, sessionHash(sid)), sql`${sessions.expiresAt} > now()`))
        .limit(1);
      if (!rows[0]) return reply.code(401).send({ error: "unauthorized", message: "Нужно войти" });
      request.user = toPublic(rows[0].user);
      request.sessionCsrf = rows[0].session.csrfToken;
      const method = request.method.toUpperCase();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
      if (!originAllowed(request)) return reply.code(403).send({ error: "forbidden", message: "Чужой источник запроса" });
      const header = String(request.headers["x-csrf-token"] ?? "");
      if (!sameToken(header, rows[0].session.csrfToken)) return reply.code(403).send({ error: "forbidden", message: "Не подтверждён запрос" });
    });

    scope.post("/api/auth/logout", async (request, reply) => {
      const sid = request.cookies.sid;
      if (sid) await getDb().delete(sessions).where(eq(sessions.tokenHash, sessionHash(sid)));
      reply.clearCookie("sid", { path: "/" });
      reply.clearCookie("csrf", { path: "/" });
      return { ok: true };
    });

    scope.get("/api/me", async (request) => ({ user: request.user, contest: CONTEST_NOTE }));

    scope.get("/api/agent/config", async () => ({
      serverModel: Boolean(getConfig().localLlmUrl),
      cloudEnabled: false,
      deviceModels: {
        light: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
        default: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
        quality: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
      },
    }));

    scope.get("/api/schedule", async (request) => {
      const user = request.user!;
      if (user.role !== "student" && user.role !== "teacher") throw new HttpError(403, "forbidden", "Расписание есть в кабинете студента и преподавателя");
      const query = request.query as { date?: string; when?: string; weekOffset?: string };
      const today = moscowToday();
      let focus = today;
      if (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) focus = query.date;
      else if (query.when && ["today", "tomorrow", "day_after", "week", "next_week", "prev_week"].includes(query.when)) focus = resolveWhen(query.when as "today", today).focus;
      else if (query.weekOffset && /^-?\d+$/.test(query.weekOffset)) {
        const { addDays, mondayOf, nearestStudyDay } = await import("../../shared/src/dates");
        focus = addDays(mondayOf(nearestStudyDay(today)), Number(query.weekOffset) * 7);
      }
      const data = await loadSchedule(user, focus, user.showCancelled);
      return { ...data, today, focus };
    });

    scope.get("/api/grades", async (request) => {
      const user = request.user!;
      if (user.role !== "student") throw new HttpError(403, "forbidden", "Оценки есть в кабинете студента");
      const today = moscowToday();
      const semesters = semestersFor(today);
      const query = request.query as { semester?: string };
      const semester = query.semester || semesters.current.id;
      const list = await loadDisciplines(user.id, semester);
      return { semester, semesters: semesters.list, today, items: analyzeSession(list, today), disciplines: list };
    });

    scope.get("/api/brief", async (request) => {
      const user = request.user!;
      if (user.role === "staff") {
        const inbox = await staffInbox();
        return {
          greeting: `Добрый день, ${user.addressName}.`,
          paragraphs: [`Во входящих ${inbox.length} заявок, новых — ${inbox.filter((item) => item.row.status === "submitted").length}.`],
          role: "staff",
        };
      }
      return { ...(await studentBrief(user)), role: "student" };
    });

    scope.get("/api/requests", async (request) => {
      const user = request.user!;
      if (user.role !== "student") throw new HttpError(403, "forbidden", "Свои заявления смотрит студент");
      const rows = await listOwnRequests(user.id);
      return { requests: rows.map(presentRequest) };
    });

    scope.get("/api/requests/:id", async (request) => {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isInteger(id)) throw new HttpError(404, "not_found", "Заявка не найдена");
      const data = await getRequestFor(request.user!, id);
      return { request: presentRequest(data.request), events: data.events, student: data.student ? publicStudent(data.student) : null };
    });

    scope.get("/api/requests/:id/pdf", async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isInteger(id)) throw new HttpError(404, "not_found", "Заявка не найдена");
      const data = await getRequestFor(request.user!, id);
      const meta = kindMeta(data.request.kind);
      if (meta?.group !== "certificate") throw new HttpError(409, "not_ready", "У этого заявления нет бланка");
      if (data.request.status !== "ready" && data.request.status !== "issued") throw new HttpError(409, "not_ready", "Справка ещё не готова");
      const owner = data.request.studentId === request.user!.id ? request.user! : data.student;
      if (!owner) throw new HttpError(404, "not_found", "Заявка не найдена");
      const pdf = await renderCertificate({
        title: data.request.title,
        studentName: owner.fullName,
        institute: owner.institute,
        direction: owner.direction,
        course: owner.course,
        groupName: owner.groupName,
        purpose: data.request.purpose,
        issuedAt: new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(new Date(data.request.updatedAt)),
        code: data.request.verifyCode ?? "",
        verifyUrl: `${publicBase(request)}/verify/${data.request.verifyCode}`,
      });
      reply.header("content-type", "application/pdf");
      reply.header("content-disposition", `inline; filename="altair-${data.request.id}.pdf"`);
      return reply.send(pdf);
    });

    scope.get("/api/notifications", async (request) => ({ notifications: await listNotifications(request.user!.id) }));
    scope.get("/api/audit", async (request) => ({ events: await listAudit(request.user!.id) }));
    scope.get("/api/announcements", async () => ({ announcements: await listAnnouncements() }));
    scope.get("/api/regulations", async (request) => {
      const query = String((request.query as { q?: string }).q ?? "");
      return { documents: REGULATION_DOCS.map((doc) => ({ slug: doc.slug, title: doc.title, body: doc.body })), matches: query ? searchRegulations(query) : [] };
    });

    scope.get("/api/notifications/stream", async (request, reply) => {
      const user = request.user!;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      raw.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
      const unsubscribe = subscribe(user.id, (data) => raw.write(`data: ${JSON.stringify(data)}\n\n`));
      const timer = setInterval(() => raw.write(`: ping\n\n`), 25_000);
      request.raw.on("close", () => {
        clearInterval(timer);
        unsubscribe();
      });
    });

    scope.post("/api/actions", async (request) => {
      const body = z.object({ action: z.string().min(1).max(64), args: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
      return perform(request.user!, body.action, body.args, { source: "ui", confirmed: true });
    });

    scope.post("/api/agent/turn", async (request) => {
      const body = z
        .object({
          message: z.string().trim().min(1).max(2000),
          mode: z.enum(["auto", "device", "server", "fallback", "cloud"]).optional(),
          proposal: z.unknown().optional(),
          history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(500) })).max(6).optional(),
        })
        .parse(request.body);
      return runTurn(request.user!, body);
    });

    scope.post("/api/agent/clarify", async (request) => {
      const body = z.object({ clarificationId: z.string().uuid(), entityId: z.string().min(1).max(200) }).parse(request.body);
      return clarifyChoice(request.user!, body.clarificationId, body.entityId);
    });

    scope.post("/api/agent/confirm", async (request) => {
      const body = z.object({ pendingId: z.string().uuid() }).parse(request.body);
      return confirmPending(request.user!, body.pendingId);
    });

    scope.post("/api/agent/reject", async (request) => {
      const body = z.object({ pendingId: z.string().uuid() }).parse(request.body);
      return rejectPending(request.user!, body.pendingId);
    });

    scope.get("/api/homework", async (request) => {
      const user = request.user!;
      const homework = await listStudentHomework(user);
      const { listReminders } = await import("./loaders");
      const reminders = await listReminders(user.id);
      return {
        homework: homework.map((row) => ({
          ...row,
          reminder: reminders.find((item) => item.title.includes(row.title))?.title ?? null,
        })),
      };
    });
    scope.get("/api/homework/:id", async (request) => {
      const user = request.user!;
      const homework = await getStudentHomework(user, Number((request.params as { id: string }).id));
      const { listReminders } = await import("./loaders");
      const reminder = (await listReminders(user.id)).find((row) => row.title.includes(homework.title)) ?? null;
      return { homework, reminder: reminder ? { title: reminder.title, dueAt: reminder.dueAt } : null };
    });
    scope.get("/api/teach/home", async (request) => teacherHome(request.user!));
    scope.get("/api/teach/homework", async (request) => ({ queue: await teacherQueue(request.user!) }));
    scope.get("/api/teach/homework/:id", async (request) => ({ assignment: await getTeacherAssignment(request.user!, Number((request.params as { id: string }).id)) }));
    scope.get("/api/teach/journal", async (request) => {
      const query = request.query as { group?: string; discipline?: string };
      if (!query.group || !query.discipline) throw new HttpError(400, "bad_request", "Нужны группа и предмет");
      return journal(request.user!, query.group, query.discipline);
    });

    scope.get("/api/staff/requests", async (request) => {
      if (request.user!.role !== "staff") throw new HttpError(403, "forbidden", "Недостаточно прав");
      const inbox = await staffInbox();
      return {
        requests: inbox.map((item) => ({
          ...presentRequest(item.row),
          studentName: item.owner?.fullName ?? "Студент",
          groupName: item.owner?.groupName ?? null,
          triage: triageRequest({
            id: item.row.id,
            kind: item.row.kind,
            title: item.row.title,
            purpose: item.row.purpose,
            body: item.row.body,
            status: item.row.status as RequestStatus,
            studentName: item.owner?.fullName ?? "Студент",
            groupName: item.owner?.groupName,
          }),
        })),
      };
    });

    scope.get("/api/staff/requests/:id", async (request) => {
      if (request.user!.role !== "staff") throw new HttpError(403, "forbidden", "Недостаточно прав");
      const id = Number((request.params as { id: string }).id);
      const data = await getRequestFor(request.user!, id);
      return {
        request: presentRequest(data.request),
        events: data.events,
        student: data.student ? publicStudent(data.student) : null,
        triage: triageRequest({
          id: data.request.id,
          kind: data.request.kind,
          title: data.request.title,
          purpose: data.request.purpose,
          body: data.request.body,
          status: data.request.status as RequestStatus,
          studentName: data.student?.fullName ?? "Студент",
          groupName: data.student?.groupName,
        }),
      };
    });
  });

  if (serveStatic) {
    await app.register(fastifyStatic, {
      root: clientDist,
      wildcard: false,
      setHeaders(reply, filePath) {
        if (filePath.endsWith(`${path.sep}index.html`)) {
          reply.header("Cache-Control", "no-cache");
          return;
        }
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api")) return reply.code(404).type("application/json").send({ error: "not_found", message: "Маршрут не найден" });
    if (serveStatic && (request.method === "GET" || request.method === "HEAD")) {
      reply.header("Cache-Control", "no-cache");
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found", message: "Маршрут не найден" });
  });

  return app;
}

function presentRequest(row: typeof requests.$inferSelect) {
  return {
    id: row.id,
    studentId: row.studentId,
    kind: row.kind,
    title: row.title,
    purpose: row.purpose,
    body: row.body,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status as RequestStatus],
    rejectionReason: row.rejectionReason,
    resultNote: row.resultNote,
    verifyCode: row.verifyCode,
    downloadable: Boolean(row.verifyCode) && (row.status === "ready" || row.status === "issued") && kindMeta(row.kind)?.group === "certificate",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicStudent(user: PublicUser) {
  return { fullName: user.fullName, institute: user.institute, direction: user.direction, course: user.course, groupName: user.groupName };
}
