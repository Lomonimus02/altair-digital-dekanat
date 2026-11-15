import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { academicPeriod, dueAtMoscow, formatRuDate, longDay, moscowHour, moscowToday, resolveWhen, ruCount } from "../../shared/src/dates";
import {
  defaultPurpose,
  kindMeta,
  STATUS_LABEL,
  type AnswerCard,
  type ChoiceChip,
  type Citation,
  type ConfirmCard,
  type Proposal,
  type PublicUser,
  type RequestStatus,
  type Theme,
  type UiDirective,
  type UndoPayload,
} from "../../shared/src/domain";
import { analyzeSession, withHypothetical } from "../../shared/src/navigator";
import { composeBrief, narrateAdvice, narrateOverview } from "../../shared/src/narrate";
import { samePerson } from "../../shared/src/names";
import { matchDiscipline, parseIntent } from "../../shared/src/parser";
import { registryByName, relaxArgs, schemas, stepLabel } from "../../shared/src/registry";
import { makeVerifyCode } from "./auth/crypto";
import { searchRegulations } from "./content/regulations";
import { getDb } from "./db/client";
import {
  auditLog,
  marks,
  notifications,
  pendingActions,
  reminders,
  requestEvents,
  requests,
  scheduleFlags,
  scheduleItems,
  submissions,
  users,
  announcements,
  clarifications,
} from "./db/schema";
import { publish } from "./hub";
import { badRequest, forbidden, HttpError, notFound } from "./httpError";
import { proposeWithCloud, proposeWithLocal, type ChatTurn } from "./llm";
import {
  allStaff,
  allStudents,
  changesUntil,
  disciplineNames,
  findUserById,
  getRequestFor,
  listAudit,
  listNotifications,
  listOwnRequests,
  listReminders,
  loadDisciplines,
  loadSchedule,
  semestersFor,
  staffInbox,
  toPublic,
  unreadCount,
} from "./loaders";
import {
  announceToGroup,
  getStudentHomework,
  getTeacherAssignment,
  gradeSubmission,
  issueAssignment,
  listStudentHomework,
  markAbsentToday,
  narrateHomework,
  openRoll,
  pickHomework,
  remindDeadline,
  resolveStudentAssignment,
  resolveTaughtStudent,
  resolveTeacherSubmission,
  returnSubmission,
  subjectSummary,
  saveStudentWork,
  setAttendance,
  setJournalMark,
  teacherHome,
  teacherQueue,
  loadForTeacher,
  type HomeworkKind,
} from "./homework";
import { triageRequest } from "./triage";
import { getConfig } from "./config";

const ProposalSchema = z.object({
  say: z.string().max(400).optional().default(""),
  steps: z
    .array(
      z.object({
        tool: z.string().min(1).max(64),
        args: z.record(z.string(), z.unknown()).optional().default({}),
      }),
    )
    .max(4),
});

type Outcome = {
  summary: string;
  ui?: UiDirective[];
  citations?: Citation[];
  download?: { href: string; label: string };
  reversible?: { undo: UndoPayload };
  card?: AnswerCard;
  choices?: ChoiceChip[];
};

export interface PerformResult extends Outcome {
  ok: boolean;
  confirm?: ConfirmCard;
  auditId?: number;
  undoOffer?: { auditId: number; label: string };
}

const NEXT: Record<string, RequestStatus[]> = {
  submitted: ["in_progress", "rejected", "withdrawn"],
  in_progress: ["ready", "issued", "rejected", "withdrawn"],
  ready: ["issued", "rejected"],
  issued: [],
  rejected: [],
  withdrawn: [],
};

export async function perform(
  user: PublicUser,
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  ctx: { source: "ui" | "agent"; confirmed: boolean },
): Promise<PerformResult> {
  const def = registryByName.get(name as never);
  if (!def) throw badRequest(`Неизвестный инструмент «${name}»`);
  if (!def.roles.includes(user.role)) throw forbidden();
  const relaxed = relaxArgs({ ...(rawArgs ?? {}) });
  for (const [key, value] of Object.entries(relaxed)) if (value === undefined) delete relaxed[key];
  const parsed = def.schema.safeParse(relaxed);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((issue) => issue.message).join("; ") || "Проверьте поля");
  const args = parsed.data as Record<string, unknown>;

  if ((name === "submit_homework" || name === "teacher_grade_homework" || name === "teacher_return_homework") && !args.assignmentId) {
    if (name === "submit_homework") {
      const found = await resolveStudentAssignment(user, String(args.subject ?? ""));
      if (!("id" in found)) {
        if (!found.options.length) return { ok: true, summary: "note" in found && found.note ? found.note : "Такого задания нет." };
        const clarificationId = await saveClarification(user.id, name, args);
        return {
          ok: true,
          summary: "Несколько заданий. Какое сдать?",
          choices: found.options.map((row) => ({ label: row.title, clarificationId, entityId: String(row.id) })),
          card: { title: "Какое задание?", rows: found.options.map((row) => ({ label: row.discipline, value: `${row.title} · ${row.statusLabel}` })) },
        };
      }
      args.assignmentId = found.id;
    } else {
      const found = await resolveTeacherSubmission(user, String(args.studentName), String(args.query ?? ""));
      if (!("assignmentId" in found)) {
        if (!found.options.length) return { ok: true, summary: "Сданной работы не нашёл." };
        const clarificationId = await saveClarification(user.id, name, args);
        return {
          ok: true,
          summary: "Несколько работ. Какую?",
          choices: found.options.map((row) => ({ label: row.title, clarificationId, entityId: String(row.assignmentId) })),
          card: { title: "Какая работа?", rows: found.options.map((row) => ({ label: row.studentName, value: `${row.title} · ${row.discipline}` })) },
        };
      }
      args.assignmentId = found.assignmentId;
      args.studentName = found.studentName;
      args.groupName = found.groupName;
      args.discipline = found.discipline;
      args.workTitle = found.title;
    }
  }
  if (name === "teacher_set_mark" && (!args.groupName || !args.discipline)) {
    const found = await resolveTaughtStudent(user, String(args.studentName), String(args.discipline ?? ""));
    if (!("studentName" in found)) {
      if (!found.options.length) return { ok: true, summary: "Такого студента в ваших группах нет." };
      const clarificationId = await saveClarification(user.id, name, args);
      return {
        ok: true,
        summary: "Несколько предметов. Куда поставить оценку?",
        choices: found.options.map((row) => ({ label: row.discipline, clarificationId, entityId: `${row.groupName}||${row.discipline}` })),
        card: { title: String(args.studentName), rows: found.options.map((row) => ({ label: row.groupName, value: row.discipline })) },
      };
    }
    args.groupName = found.groupName;
    args.discipline = found.discipline;
    args.studentName = found.studentName;
  }

  if (def.risk === "consequential" && ctx.source === "agent" && !ctx.confirmed) {
    const preview = await buildPreview(user, def.name, args);
    const pendingId = randomUUID();
    await getDb()
      .insert(pendingActions)
      .values({
        id: pendingId,
        userId: user.id,
        action: def.name,
        args,
        preview,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
    await writeAudit(user, ctx.source, def.name, args, `Ждёт подтверждения: ${preview.title}`, false, null);
    return { ok: true, summary: "Нужно ваше подтверждение.", ui: [], confirm: { pendingId, ...preview } };
  }

  const handler = handlers[def.name];
  if (!handler) throw badRequest(`Инструмент «${name}» не подключён`);
  const outcome = await handler(user, args);
  const shouldLog = ctx.source === "agent" || def.risk !== "read";
  let auditId: number | undefined;
  if (shouldLog) {
    auditId = await writeAudit(
      user,
      ctx.source === "agent" ? "agent" : user.role === "staff" ? "staff" : "ui",
      def.name,
      args,
      outcome.summary || stepLabel(def.name, args),
      Boolean(outcome.reversible),
      outcome.reversible?.undo ?? null,
    );
  }
  console.info(JSON.stringify({ tool: def.name, userId: user.id, role: user.role, source: ctx.source }));
  return {
    ok: true,
    ...outcome,
    auditId,
    undoOffer: outcome.reversible && auditId ? { auditId, label: "Отменить" } : undefined,
  };
}

async function writeAudit(
  user: PublicUser,
  source: string,
  action: string,
  args: Record<string, unknown>,
  summary: string,
  reversible: boolean,
  undo: UndoPayload | null,
) {
  const [row] = await getDb()
    .insert(auditLog)
    .values({
      userId: user.id,
      source,
      action,
      args,
      summary: summary.slice(0, 700),
      reversible,
      undo,
    })
    .returning({ id: auditLog.id });
  return row.id;
}

async function buildPreview(user: PublicUser, name: string, args: Record<string, unknown>): Promise<Omit<ConfirmCard, "pendingId">> {
  if (name === "create_request") {
    const kind = String(args.kind);
    const meta = kindMeta(kind);
    const purpose = String(args.purpose || defaultPurpose(kind as never));
    return {
      title: meta?.group === "certificate" ? "Заказать справку" : "Подать заявление",
      summary: meta?.instant
        ? "После подтверждения бланк будет готов сразу, с кодом проверки."
        : "После подтверждения заявление уйдёт сотруднику учебного офиса.",
      fields: [
        { label: "Документ", value: meta?.title ?? kind },
        { label: "Назначение", value: purpose },
        ...(args.comment ? [{ label: "Комментарий", value: String(args.comment) }] : []),
      ],
    };
  }
  if (name === "cancel_request") {
    const { request } = await getRequestFor(user, Number(args.requestId));
    return {
      title: "Отозвать заявку",
      summary: "Статус станет «отозвана». Это нельзя нажать случайно, поэтому нужно подтверждение.",
      fields: [
        { label: "Заявка", value: `№${request.id} · ${request.title}` },
        { label: "Сейчас", value: STATUS_LABEL[request.status as RequestStatus] },
      ],
    };
  }
  if (name === "staff_set_status") {
    const { request, student } = await getRequestFor(user, Number(args.requestId));
    return {
      title: "Сменить статус заявки",
      summary: "Студент сразу получит уведомление.",
      fields: [
        { label: "Заявка", value: `№${request.id} · ${request.title}` },
        { label: "Студент", value: student?.fullName ?? "—" },
        { label: "Новый статус", value: STATUS_LABEL[String(args.status) as RequestStatus] },
        ...(args.comment ? [{ label: "Комментарий", value: String(args.comment) }] : []),
      ],
    };
  }
  if (name === "submit_homework") {
    const row = await getStudentHomework(user, Number(args.assignmentId));
    const href = String(args.body ?? "").match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "");
    return {
      title: "Сдать работу",
      summary: "После подтверждения преподаватель увидит её в очереди «На проверке».",
      fields: [
        { label: "Задание", value: row.title },
        { label: "Предмет", value: row.discipline },
        ...(href ? [{ label: "Ссылка", value: href }] : []),
      ],
    };
  }
  if (name === "teacher_issue_assignment") {
    return {
      title: "Выдать задание",
      summary: "Группа получит уведомление.",
      fields: [
        { label: "Группа", value: String(args.groupName) },
        { label: "Предмет", value: String(args.discipline) },
        { label: "Задание", value: String(args.title) },
        { label: "Срок", value: String(args.deadline) },
      ],
    };
  }
  if (name === "teacher_grade_homework" || name === "teacher_set_mark") {
    if (name === "teacher_grade_homework" && args.assignmentId && !args.workTitle) {
      const detail = await getTeacherAssignment(user, Number(args.assignmentId));
      args.workTitle = detail.title;
      args.groupName = args.groupName || detail.groupName;
      args.discipline = args.discipline || detail.discipline;
    }
    const work = String(args.workTitle ?? "");
    return {
      title: "Поставить оценку",
      summary: "Оценка попадёт в ведомость студента.",
      fields: [
        { label: "Студент", value: String(args.studentName) },
        { label: "Группа", value: String(args.groupName ?? "его группа") },
        { label: "Предмет", value: String(args.discipline ?? "предмет") },
        ...(work && work !== "работа" ? [{ label: "Работа", value: work }] : []),
        { label: "Оценка", value: String(args.score ?? args.value) },
        ...(args.comment ? [{ label: "Комментарий", value: String(args.comment) }] : []),
      ],
    };
  }
  if (name === "teacher_return_homework") {
    return {
      title: "Вернуть на доработку",
      summary: "Студент увидит комментарий.",
      fields: [
        { label: "Студент", value: String(args.studentName) },
        { label: "Работа", value: String(args.workTitle ?? "работа") },
        { label: "Комментарий", value: String(args.comment) },
      ],
    };
  }
  if (name === "teacher_announce") {
    return {
      title: "Объявление группе",
      summary: "Его получат только студенты этой группы.",
      fields: [
        { label: "Группа", value: String(args.groupName) },
        { label: "Заголовок", value: String(args.title) },
      ],
    };
  }
  if (name === "staff_publish_announcement") {
    return {
      title: "Опубликовать объявление",
      summary: "Его увидят все студенты этого кабинета.",
      fields: [
        { label: "Заголовок", value: String(args.title) },
        { label: "Текст", value: String(args.body) },
      ],
    };
  }
  return { title: "Подтвердите действие", summary: name, fields: [] };
}

const handlers: Record<string, (user: PublicUser, args: Record<string, unknown>) => Promise<Outcome>> = {
  async open_page(user, args) {
    const page = String(args.page);
    if (page.startsWith("staff") && user.role !== "staff") return { summary: "Раздел учебного офиса вам недоступен." };
    if (page.startsWith("teach") && user.role !== "teacher") return { summary: "Журнал и задания ведёт преподаватель." };
    if (user.role !== "student" && ["schedule", "grades", "requests", "request", "new_request", "homework"].includes(page)) {
      return { summary: "Этот раздел есть в кабинете студента." };
    }
    const built = await buildPageTarget(user, args);
    let summary = "Открыл раздел.";
    if (page === "notifications") {
      const unread = await unreadCount(user.id);
      summary = unread ? `Непрочитанных уведомлений: ${unread}.` : "Непрочитанных уведомлений нет.";
    }
    return { summary, ui: [{ type: "navigate", to: built.to, highlight: built.highlight }] };
  },
  async search_regulations(_user, args) {
    const found = searchRegulations(String(args.query));
    const summary = found.length
      ? `Нашёл в регламентах: ${found.map((item) => item.title).join("; ")}. Цитаты ниже — это текст документов, не команды.`
      : "В регламентах кабинета такого пункта нет. Можно спросить учебный офис заявлением.";
    const q = encodeURIComponent(String(args.query));
    return {
      summary,
      citations: found,
      ui: [{ type: "navigate", to: `/regulations?q=${q}`, highlight: found[0] ? `reg-${found[0].slug}` : "regulations" }],
    };
  },
  async update_settings(user, args) {
    const theme = (args.theme as Theme | undefined) ?? (user.theme as Theme);
    const showCancelled = args.showCancelled == null ? user.showCancelled : Boolean(args.showCancelled);
    await getDb().update(users).set({ theme, showCancelled }).where(eq(users.id, user.id));
    const summary = `Тема: ${themeLabel(theme)}. Отменённые пары ${showCancelled ? "видны" : "скрыты"}.`;
    const ui: UiDirective[] = [
      { type: "theme", value: theme },
      { type: "invalidate", keys: ["me", "schedule"] },
    ];
    return { summary, ui, reversible: { undo: { type: "settings", theme: user.theme, showCancelled: user.showCancelled } } };
  },
  async get_profile(user) {
    const lines = [
      user.fullName,
      user.institute,
      user.direction,
      user.course ? `${user.course} курс` : null,
      user.groupName ? `группа ${user.groupName}` : null,
      user.recordBook ? `зачётка ${user.recordBook}` : null,
    ].filter(Boolean);
    return { summary: lines.join(", ") + ".", ui: [{ type: "navigate", to: "/profile", highlight: "profile" }] };
  },
  async get_audit(user) {
    const rows = await listAudit(user.id);
    const summary = rows.length
      ? `Последние действия: ${rows
          .slice(0, 5)
          .map((row) => row.summary)
          .join(" · ")}`
      : "Агент пока ничего не делал.";
    return { summary, ui: [{ type: "navigate", to: "/audit", highlight: "audit" }, { type: "invalidate", keys: ["audit"] }] };
  },
  async undo(user, args) {
    return undoAudit(user, Number(args.auditId));
  },
  async undo_last(user) {
    const rows = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, user.id), eq(auditLog.reversible, true), isNull(auditLog.undoneAt)))
      .orderBy(desc(auditLog.id))
      .limit(1);
    if (!rows[0]) return { summary: "Отменять нечего." };
    return undoAudit(user, rows[0].id);
  },
  async mark_notifications_read(user, args) {
    const all = await listNotifications(user.id);
    const ids = Array.isArray(args.ids) ? (args.ids as number[]) : [];
    const targets = (args.all || !ids.length ? all : all.filter((item) => ids.includes(item.id))).filter((item) => !item.readAt);
    if (!targets.length) return { summary: "Непрочитанных уведомлений нет." };
    const now = new Date().toISOString();
    for (const item of targets) {
      await getDb().update(notifications).set({ readAt: now }).where(and(eq(notifications.id, item.id), eq(notifications.userId, user.id)));
    }
    return {
      summary: `Отметил прочитанными: ${targets.length}.`,
      ui: [{ type: "invalidate", keys: ["notifications", "brief"] }],
      reversible: { undo: { type: "notifications", items: targets.map((item) => ({ id: item.id, readAt: item.readAt })) } },
    };
  },
  async get_schedule(user, args) {
    const when = (args.when as "today") || "week";
    const resolved = resolveWhen(when);
    const data = await loadSchedule(user, resolved.focus, true);
    const mode = when === "today" || when === "tomorrow" || when === "day_after" ? "day" : "week";
    const pool = mode === "day" ? data.items.filter((item) => item.date === resolved.focus) : data.items.filter((item) => item.changeType !== "cancelled");
    const shown = pool.slice(0, 8);
    const summary = `${resolved.sundayNote ? "Сегодня воскресенье. " : ""}${resolved.label}: ${pool.length ? ruCount(pool.length, "занятие", "занятия", "занятий") : "занятий нет."}`;
    return {
      summary,
      card: {
        title: resolved.label,
        rows: shown.map((item) => ({ label: `${item.startsAt}–${item.endsAt}`, value: `${item.discipline}${item.room ? ` · ${item.room}` : ""}` })),
      },
      ui: [{ type: "navigate", to: `/schedule?date=${resolved.focus}`, highlight: `schedule-day-${resolved.focus}` }],
    };
  },
  async get_grades(user, args) {
    return gradesAnswer(user, args, "overview");
  },
  async get_session_navigator(user, args) {
    return gradesAnswer(user, args, "advice");
  },
  async simulate_mark(user, args) {
    const today = moscowToday();
    const semester = String(args.semester || academicPeriod(today).current.id);
    const list = await loadDisciplines(user.id, semester);
    const { subject } = await resolveSubject(user, String(args.subject));
    const discipline = list.find((item) => item.name === subject);
    if (!discipline) {
      return { summary: `Не нашёл дисциплину «${args.subject}». В зачётке: ${list.map((item) => item.name).join(", ") || "пусто"}.` };
    }
    const before = analyzeSession([discipline], today)[0];
    const after = analyzeSession([withHypothetical(discipline, Number(args.value))], today)[0];
    return {
      summary: `Если следующая оценка по «${discipline.name}» будет ${args.value} (в ведомость ничего не записал): сейчас — ${before.headline} После неё — ${after.headline}`,
      ui: [{ type: "navigate", to: `/grades?semester=${semester}&subject=${encodeURIComponent(discipline.name)}`, highlight: `grade-${discipline.id}` }],
    };
  },
  async get_brief(user) {
    if (user.role === "staff") {
      const inbox = await staffInbox();
      const fresh = inbox.filter((item) => item.row.status === "submitted").length;
      return {
        summary: `Входящих заявок: ${inbox.length}. Ещё не взяты в работу: ${fresh}.`,
        ui: [{ type: "navigate", to: "/staff", highlight: "inbox" }, { type: "invalidate", keys: ["staff"] }],
      };
    }
    const brief = await studentBrief(user);
    return {
      summary: [brief.greeting, ...brief.paragraphs].join(" "),
      ui: [{ type: "navigate", to: "/", highlight: "brief" }, { type: "invalidate", keys: ["brief"] }],
    };
  },
  async list_requests(user, args) {
    const rows = (await listOwnRequests(user.id)).filter((row) => {
      if (args.kind && row.kind !== args.kind) return false;
      if (args.certificates && kindMeta(row.kind)?.group !== "certificate") return false;
      return true;
    });
    const summary = rows.length
      ? rows.map((row) => `№${row.id} «${row.title}» — ${STATUS_LABEL[row.status as RequestStatus].toLowerCase()}`).join("; ")
      : "Заявок пока нет. Можно заказать справку об обучении — она появится сразу.";
    return {
      summary,
      card: { title: args.certificates || args.kind ? "Справки" : "Заявки", rows: rows.slice(0, 6).map((row) => ({ label: `№${row.id}`, value: `${row.title} — ${STATUS_LABEL[row.status as RequestStatus].toLowerCase()}` })) },
      ui: [{ type: "navigate", to: "/requests", highlight: "requests" }],
    };
  },
  async get_request_status(user, args) {
    const { request, events } = await getRequestFor(user, Number(args.requestId));
    const last = events.at(-1);
    const summary = `Заявка №${request.id} «${request.title}»: ${STATUS_LABEL[request.status as RequestStatus].toLowerCase()}.${last?.comment ? ` ${last.comment}` : ""}${request.rejectionReason ? ` Причина: ${request.rejectionReason}` : ""}`;
    return {
      summary,
      card: { title: `№${request.id}`, rows: [{ label: "Документ", value: request.title }, { label: "Статус", value: STATUS_LABEL[request.status as RequestStatus] }] },
      ui: [{ type: "navigate", to: `/requests/${request.id}`, highlight: `request-${request.id}` }],
    };
  },
  async create_request(user, args) {
    const kind = String(args.kind);
    const meta = kindMeta(kind);
    if (!meta) throw badRequest("Неизвестный вид заявления");
    const purpose = String(args.purpose || defaultPurpose(kind as never));
    const comment = args.comment ? String(args.comment) : null;
    const instant = meta.instant;
    const status: RequestStatus = instant ? "issued" : "submitted";
    const code = instant ? makeVerifyCode() : null;
    const [row] = await getDb()
      .insert(requests)
      .values({
        studentId: user.id,
        kind,
        title: meta.title,
        purpose,
        body: comment,
        status,
        verifyCode: code,
      })
      .returning();
    const eventRows = instant
      ? [
          { requestId: row.id, status: "submitted", comment: "Заявление подтверждено", actorId: user.id },
          { requestId: row.id, status: "ready", comment: "Справка сформирована автоматически", actorId: null },
          { requestId: row.id, status: "issued", comment: "Можно скачать PDF", actorId: null },
        ]
      : [{ requestId: row.id, status: "submitted", comment: "Заявление подтверждено", actorId: user.id }];
    await getDb().insert(requestEvents).values(eventRows);
    await notify(user.id, "request", `Заявка №${row.id}: ${STATUS_LABEL[status].toLowerCase()}`, meta.title, `/requests/${row.id}`);
    if (!instant) {
      for (const staff of await allStaff()) {
        await notify(staff.id, "request", `Новая заявка №${row.id}`, `${user.fullName}: ${meta.title}`, `/staff/requests/${row.id}`);
      }
    }
    const download = instant ? { href: `/api/requests/${row.id}/pdf`, label: "Скачать справку" } : undefined;
    const eta = instant ? "Готово сразу" : "Около 3 рабочих дней";
    return {
      summary: `Заявка №${row.id} «${meta.title}». Статус: ${STATUS_LABEL[status].toLowerCase()}. Срок: ${eta.toLowerCase()}.`,
      card: {
        title: `Заявка №${row.id}`,
        rows: [
          { label: "Документ", value: meta.title },
          { label: "Статус", value: STATUS_LABEL[status] },
          { label: "Срок", value: eta },
          { label: "Назначение", value: purpose },
        ],
      },
      download,
      ui: [
        { type: "navigate", to: `/requests/${row.id}`, highlight: `request-${row.id}` },
        { type: "invalidate", keys: ["requests", "notifications", "brief", "staff"] },
      ],
    };
  },
  async cancel_request(user, args) {
    const { request } = await getRequestFor(user, Number(args.requestId));
    if (user.role !== "student" || request.studentId !== user.id) throw notFound("Заявка не найдена");
    if (!["submitted", "in_progress"].includes(request.status)) throw badRequest("Эту заявку уже нельзя отозвать.");
    await setStatus(request.id, "withdrawn", user.id, "Студент отозвал заявление", null);
    await notify(user.id, "request", `Заявка №${request.id} отозвана`, request.title, `/requests/${request.id}`);
    return {
      summary: `Заявка №${request.id} отозвана.`,
      ui: [
        { type: "navigate", to: `/requests/${request.id}`, highlight: `request-${request.id}` },
        { type: "invalidate", keys: ["requests", "notifications", "brief"] },
      ],
    };
  },
  async set_reminder(user, args) {
    const dueAt = dueAtMoscow(args.day as "today", String(args.time));
    const [row] = await getDb()
      .insert(reminders)
      .values({ userId: user.id, title: String(args.title), dueAt })
      .returning();
    return {
      summary: `Напоминание «${row.title}» стоит на ${formatRuDate(dueAt.slice(0, 10))} в ${String(args.time)}.`,
      ui: [{ type: "invalidate", keys: ["brief"] }, { type: "navigate", to: "/", highlight: "today" }],
      reversible: { undo: { type: "reminder", id: row.id } },
    };
  },
  async download_certificate(user, args) {
    const rows = await listOwnRequests(user.id);
    const ready = rows.filter((row) => row.status === "ready" || row.status === "issued");
    const picked =
      (args.requestId ? ready.find((row) => row.id === Number(args.requestId)) : null) ??
      (args.kind ? ready.find((row) => row.kind === args.kind) : null) ??
      ready.find((row) => kindMeta(row.kind)?.group === "certificate");
    if (!picked) return { summary: "Готовой справки пока нет. Справку об обучении можно заказать — она появится сразу." };
    if (kindMeta(picked.kind)?.group !== "certificate") return { summary: "PDF есть только у справок. Это заявление без бланка." };
    return {
      summary: `«${picked.title}» можно скачать.`,
      download: { href: `/api/requests/${picked.id}/pdf`, label: "Скачать PDF" },
      ui: [{ type: "navigate", to: `/requests/${picked.id}`, highlight: `request-${picked.id}` }],
    };
  },
  async mark_schedule_item(user, args) {
    const item = await resolveLesson(user, args);
    const existing = await getDb()
      .select()
      .from(scheduleFlags)
      .where(and(eq(scheduleFlags.userId, user.id), eq(scheduleFlags.scheduleItemId, item.id)))
      .limit(1);
    const previous = existing[0]?.flagged ?? false;
    const flagged = Boolean(args.flagged);
    if (existing[0]) {
      await getDb()
        .update(scheduleFlags)
        .set({ flagged })
        .where(and(eq(scheduleFlags.userId, user.id), eq(scheduleFlags.scheduleItemId, item.id)));
    } else await getDb().insert(scheduleFlags).values({ userId: user.id, scheduleItemId: item.id, flagged });
    return {
      summary: flagged
        ? `Отметил ${item.discipline} ${longDay(item.date)} в ${item.startsAt}.`
        : `Снял отметку с «${item.discipline}».`,
      ui: [{ type: "invalidate", keys: ["schedule"] }, { type: "navigate", to: `/schedule?date=${item.date}`, highlight: `lesson-${item.id}` }],
      reversible: { undo: { type: "flag", scheduleItemId: item.id, flagged: previous } },
    };
  },
  async staff_list_inbox(user) {
    if (user.role !== "staff") throw forbidden();
    const inbox = await staffInbox();
    const summary = inbox.length
      ? inbox
          .slice(0, 8)
          .map((item) => `№${item.row.id} ${item.row.title} — ${STATUS_LABEL[item.row.status as RequestStatus].toLowerCase()} (${item.owner?.fullName ?? "студент"})`)
          .join("; ")
      : "Входящих нет.";
    return { summary, ui: [{ type: "navigate", to: "/staff", highlight: "inbox" }] };
  },
  async staff_triage(user, args) {
    const { request, student } = await getRequestFor(user, Number(args.requestId));
    const triage = triageRequest({
      id: request.id,
      kind: request.kind,
      title: request.title,
      purpose: request.purpose,
      body: request.body,
      status: request.status as RequestStatus,
      studentName: student?.fullName ?? "Студент",
      groupName: student?.groupName,
    });
    return {
      summary: `${triage.category}. ${triage.summary} Черновик ответа: ${triage.suggestedReply}`,
      ui: [{ type: "navigate", to: `/staff/requests/${request.id}`, highlight: `staff-request-${request.id}` }],
    };
  },
  async staff_set_status(user, args) {
    const { request } = await getRequestFor(user, Number(args.requestId));
    const status = String(args.status) as RequestStatus;
    if (!NEXT[request.status]?.includes(status)) throw badRequest("Такой переход статуса не предусмотрен.");
    const comment = args.comment ? String(args.comment) : null;
    const meta = kindMeta(request.kind);
    let verifyCode = request.verifyCode;
    if ((status === "ready" || status === "issued") && meta?.group === "certificate" && !verifyCode) verifyCode = makeVerifyCode();
    await getDb()
      .update(requests)
      .set({
        status,
        updatedAt: new Date().toISOString(),
        rejectionReason: status === "rejected" ? comment : request.rejectionReason,
        resultNote: status === "rejected" ? request.resultNote : comment ?? request.resultNote,
        verifyCode,
      })
      .where(eq(requests.id, request.id));
    await getDb().insert(requestEvents).values({ requestId: request.id, status, comment, actorId: user.id });
    await notify(
      request.studentId,
      "request",
      `Заявка №${request.id}: ${STATUS_LABEL[status].toLowerCase()}`,
      comment || request.title,
      `/requests/${request.id}`,
    );
    return {
      summary: `Заявка №${request.id} теперь «${STATUS_LABEL[status].toLowerCase()}». Студент уже уведомлён.`,
      ui: [
        { type: "navigate", to: `/staff/requests/${request.id}`, highlight: `staff-request-${request.id}` },
        { type: "invalidate", keys: ["staff", "requests", "notifications"] },
      ],
    };
  },
  async staff_publish_announcement(user, args) {
    const [row] = await getDb()
      .insert(announcements)
      .values({ authorId: user.id, title: String(args.title), body: String(args.body) })
      .returning();
    for (const student of await allStudents()) {
      await notify(student.id, "announcement", row.title, row.body, "/notifications");
    }
    return {
      summary: `Объявление «${row.title}» опубликовано.`,
      ui: [{ type: "navigate", to: "/staff/announcements", highlight: "announcements" }, { type: "invalidate", keys: ["announcements", "notifications"] }],
    };
  },
  async list_homework(user, args) {
    const rows = await listStudentHomework(user);
    const bucket = args.bucket ? String(args.bucket) : "all";
    const until = args.until ? String(args.until) : undefined;
    const kind = args.kind ? String(args.kind) : undefined;
    const picked = pickHomework(rows, bucket, until, kind);
    return {
      summary: narrateHomework(rows, bucket, until, kind),
      card: {
        title: bucket === "overdue" ? "Долги" : "Задания",
        rows: picked.slice(0, 6).map((row) => ({ label: row.discipline, value: `${row.title} · ${row.submission.statusLabel} · ${formatRuDate(row.deadline)}` })),
      },
      ui: [{ type: "navigate", to: "/homework", highlight: "homework" }, { type: "invalidate", keys: ["homework"] }],
    };
  },
  async get_homework(user, args) {
    const row = await getStudentHomework(user, Number(args.assignmentId));
    return {
      summary: `«${row.title}»: ${row.submission.statusLabel}. Срок ${row.deadline}.`,
      ui: [{ type: "navigate", to: `/homework/${row.id}`, highlight: `homework-${row.id}` }],
    };
  },
  async save_homework(user, args) {
    const summary = await saveStudentWork(user, Number(args.assignmentId), String(args.body ?? ""), (args.links as { title: string; href: string }[]) ?? [], false);
    return { summary, ui: [{ type: "invalidate", keys: ["homework"] }, { type: "navigate", to: `/homework/${args.assignmentId}`, highlight: `homework-${args.assignmentId}` }] };
  },
  async submit_homework(user, args) {
    const links = [...((args.links as { title: string; href: string }[]) ?? [])];
    for (const href of String(args.body).match(/https?:\/\/\S+/g) ?? []) {
      links.push({ title: "Ссылка", href: href.replace(/[),.;]+$/, "") });
    }
    const summary = await saveStudentWork(user, Number(args.assignmentId), String(args.body), links, true);
    return { summary, ui: [{ type: "invalidate", keys: ["homework", "notifications"] }, { type: "navigate", to: `/homework/${args.assignmentId}`, highlight: `homework-${args.assignmentId}` }] };
  },
  async teacher_home(user) {
    const home = await teacherHome(user);
    const sameDay = home.lessonDay === moscowToday();
    const when = sameDay ? "Сегодня" : `Ближайшие, ${formatRuDate(home.lessonDay)}`;
    const lessonText = home.lessons.length ? home.lessons.map((lesson) => `${lesson.startsAt} ${lesson.discipline}, ${lesson.groupName}`).join("; ") : "пар нет";
    const summary = `На проверке: ${home.pending}. ${when}: ${lessonText}.`;
    return {
      summary,
      card: {
        title: when,
        rows: [
          { label: "На проверке", value: String(home.pending) },
          ...home.lessons.slice(0, 4).map((lesson) => ({ label: `${lesson.startsAt}–${lesson.endsAt}`, value: `${lesson.discipline} · ${lesson.groupName}` })),
        ],
      },
      ui: [{ type: "navigate", to: "/teach", highlight: "teach" }],
    };
  },
  async teacher_list_submissions(user, args) {
    const queue = await teacherQueue(user);
    const group = args.group ? String(args.group) : "";
    const rows = queue.filter((row) => !group || row.groupName === group);
    const pending = rows.filter((row) => row.submission.status === "in_review");
    const summary = pending.length
      ? `На проверке ${pending.length}: ${pending.slice(0, 3).map((row) => `${row.studentName} — «${row.title}»`).join("; ")}.`
      : "Непроверенных работ нет.";
    return {
      summary,
      card: { title: "На проверке", rows: pending.slice(0, 6).map((row) => ({ label: row.groupName, value: `${row.studentName} — ${row.title}` })) },
      ui: [{ type: "navigate", to: "/teach/homework", highlight: "queue" }],
    };
  },
  async teacher_issue_assignment(user, args) {
    const result = await issueAssignment(user, {
      groupName: String(args.groupName),
      discipline: String(args.discipline),
      title: String(args.title),
      description: String(args.description),
      kind: String(args.kind) as HomeworkKind,
      deadline: String(args.deadline),
      scheduleItemId: args.scheduleItemId ? Number(args.scheduleItemId) : undefined,
    });
    return { summary: result.summary, ui: [{ type: "navigate", to: `/teach/homework/${result.id}`, highlight: "queue" }, { type: "invalidate", keys: ["homework"] }] };
  },
  async teacher_return_homework(user, args) {
    const summary = await returnSubmission(user, Number(args.assignmentId), String(args.studentName), String(args.comment));
    return { summary, ui: [{ type: "invalidate", keys: ["homework"] }, { type: "navigate", to: `/teach/homework/${args.assignmentId}`, highlight: `student-${args.studentName}` }] };
  },
  async teacher_grade_homework(user, args) {
    const graded = await gradeSubmission(user, Number(args.assignmentId), String(args.studentName), Number(args.score), args.comment ? String(args.comment) : undefined);
    return {
      summary: graded.summary,
      ui: [{ type: "invalidate", keys: ["homework", "grades", "journal"] }, { type: "navigate", to: `/teach/journal?group=${encodeURIComponent(String(args.groupName ?? ""))}&discipline=${encodeURIComponent(String(args.discipline ?? ""))}`, highlight: `journal-${args.studentName}` }],
      reversible: { undo: graded.undo },
    };
  },
  async remind_deadline(user, args) {
    const result = await remindDeadline(user, String(args.subject));
    return {
      summary: result.summary,
      ui: [{ type: "invalidate", keys: ["brief", "homework"] }, { type: "navigate", to: `/homework/${result.assignmentId}`, highlight: `homework-${result.assignmentId}` }],
      reversible: { undo: { type: "reminder", id: result.reminderId } },
    };
  },
  async teacher_open_roll(user) {
    const roll = await openRoll(user);
    return { summary: roll.summary, ui: [{ type: "navigate", to: roll.to, highlight: "journal" }] };
  },
  async teacher_set_mark(user, args) {
    const result = await setJournalMark(user, String(args.groupName), String(args.discipline), String(args.studentName), Number(args.value), String(args.label ?? "Текущая"), args.kind === "credit" ? "credit" : "current");
    return {
      summary: result.summary,
      ui: [
        { type: "invalidate", keys: ["grades", "journal"] },
        { type: "navigate", to: `/teach/journal?group=${encodeURIComponent(String(args.groupName))}&discipline=${encodeURIComponent(String(args.discipline))}`, highlight: `journal-${args.studentName}` },
      ],
      reversible: { undo: { type: "mark", markId: result.markId } },
    };
  },
  async teacher_mark_absent(user, args) {
    const summary = await markAbsentToday(user, args.names as string[]);
    return { summary, ui: [{ type: "navigate", to: "/teach/journal", highlight: "journal" }] };
  },
  async teacher_subject_summary(user, args) {
    const summary = await subjectSummary(user, String(args.discipline));
    return { summary, ui: [{ type: "navigate", to: "/teach/homework", highlight: "queue" }] };
  },
  async teacher_set_attendance(user, args) {
    const summary = await setAttendance(user, String(args.groupName), String(args.discipline), String(args.date), String(args.studentName), Boolean(args.present));
    return { summary, ui: [{ type: "navigate", to: "/teach/journal", highlight: "journal" }] };
  },
  async teacher_announce(user, args) {
    const summary = await announceToGroup(user, String(args.groupName), String(args.title), String(args.body));
    return { summary, ui: [{ type: "navigate", to: "/teach/announce", highlight: "announce" }, { type: "invalidate", keys: ["notifications"] }] };
  },
};

export const actionHandlers = handlers;

async function gradesAnswer(user: PublicUser, args: Record<string, unknown>, mode: "overview" | "advice"): Promise<Outcome> {
  const today = moscowToday();
  const semester = String(args.semester || academicPeriod(today).current.id);
  const list = await loadDisciplines(user.id, semester);
  const names = list.map((item) => item.name);
  let subject = args.subject ? String(args.subject) : undefined;
  if (subject) {
    const found = matchDiscipline(subject, names) ?? names.find((name) => name.toLowerCase() === subject!.toLowerCase());
    if (!found) {
      return { summary: `Не нашёл дисциплину «${subject}». Сейчас в зачётке: ${names.join(", ") || "пусто"}.` };
    }
    subject = found;
  }
  const items = analyzeSession(list, today);
  const summary = mode === "advice" ? narrateAdvice(items, subject) : subject ? narrateAdvice(items, subject) : narrateOverview(items);
  const focus = subject ? items.find((item) => item.name === subject) : undefined;
  const query = new URLSearchParams({ semester });
  if (subject) query.set("subject", subject);
  const shown = focus ? [focus] : items.slice(0, 6);
  return {
    summary,
    card: { title: subject ?? "Сессия", rows: shown.map((item) => ({ label: item.name, value: item.headline })) },
    ui: [{ type: "navigate", to: `/grades?${query.toString()}`, highlight: focus ? `grade-${focus.id}` : "grades" }],
  };
}

async function resolveSubject(user: PublicUser, subject: string) {
  const names = await disciplineNames(user.id);
  return { names, subject: matchDiscipline(subject, names) ?? names.find((name) => name.toLowerCase() === subject.toLowerCase()) };
}

async function resolveLesson(user: PublicUser, args: Record<string, unknown>) {
  if (!user.groupName) throw badRequest("У профиля нет группы.");
  if (args.scheduleItemId) {
    const rows = await getDb().select().from(scheduleItems).where(eq(scheduleItems.id, Number(args.scheduleItemId))).limit(1);
    const row = rows[0];
    if (!row || row.groupName !== user.groupName) throw notFound("Занятие не найдено");
    return row;
  }
  const names = await disciplineNames(user.id);
  const subject = matchDiscipline(String(args.subject ?? ""), names) ?? String(args.subject ?? "");
  const focus = resolveWhen((args.when as "today") || "today").focus;
  const rows = await getDb()
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.groupName, user.groupName), eq(scheduleItems.date, focus)));
  const row = rows.find((item) => item.discipline === subject) ?? rows.find((item) => item.discipline.toLowerCase().includes(subject.toLowerCase()));
  if (!row) throw notFound("Занятие не найдено");
  return row;
}

async function undoAudit(user: PublicUser, auditId: number): Promise<Outcome> {
  const rows = await getDb().select().from(auditLog).where(eq(auditLog.id, auditId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== user.id) throw notFound("Действие не найдено");
  if (!row.reversible || !row.undo) throw badRequest("Это действие нельзя отменить.");
  if (row.undoneAt) throw badRequest("Его уже отменяли.");
  const undo = row.undo;
  if (undo.type === "settings") {
    await getDb().update(users).set({ theme: undo.theme, showCancelled: undo.showCancelled }).where(eq(users.id, user.id));
  } else if (undo.type === "notifications") {
    for (const item of undo.items) {
      await getDb()
        .update(notifications)
        .set({ readAt: item.readAt })
        .where(and(eq(notifications.id, item.id), eq(notifications.userId, user.id)));
    }
  } else if (undo.type === "reminder") {
    await getDb().delete(reminders).where(and(eq(reminders.id, undo.id), eq(reminders.userId, user.id)));
  } else if (undo.type === "mark") {
    await getDb().delete(marks).where(eq(marks.id, undo.markId));
  } else if (undo.type === "submission") {
    if (undo.markId) await getDb().delete(marks).where(eq(marks.id, undo.markId));
    if (undo.submissionId) {
      await getDb()
        .update(submissions)
        .set({ status: undo.previousStatus, score: undo.previousScore, teacherComment: undo.previousComment })
        .where(eq(submissions.id, undo.submissionId));
    }
  } else if (undo.type === "flag") {
    await getDb()
      .insert(scheduleFlags)
      .values({ userId: user.id, scheduleItemId: undo.scheduleItemId, flagged: undo.flagged })
      .onConflictDoUpdate({
        target: [scheduleFlags.userId, scheduleFlags.scheduleItemId],
        set: { flagged: undo.flagged },
      });
  }
  await getDb().update(auditLog).set({ undoneAt: new Date().toISOString() }).where(eq(auditLog.id, row.id));
  const ui: UiDirective[] = [{ type: "invalidate", keys: ["me", "schedule", "notifications", "brief", "audit"] }];
  if (undo.type === "settings") ui.push({ type: "theme", value: undo.theme });
  return { summary: "Вернул как было.", ui };
}

async function setStatus(id: number, status: RequestStatus, actorId: number, comment: string, extra: null) {
  void extra;
  await getDb().update(requests).set({ status, updatedAt: new Date().toISOString() }).where(eq(requests.id, id));
  await getDb().insert(requestEvents).values({ requestId: id, status, comment, actorId });
}

async function notify(userId: number, kind: string, title: string, body: string, href: string) {
  await getDb().insert(notifications).values({ userId, kind, title, body, href });
  publish(userId, { type: "notifications" });
}

async function buildPageTarget(user: PublicUser, args: Record<string, unknown>) {
  const page = String(args.page);
  const query = new URLSearchParams();
  if (args.date) query.set("date", String(args.date));
  if (args.when) {
    const resolved = resolveWhen(args.when as "today");
    query.set("date", resolved.focus);
  }
  if (args.subject && page !== "teach_journal") query.set("subject", String(args.subject));
  if (args.group) query.set("group", String(args.group));
  if (page === "teach_journal" && user.role === "teacher") {
    const load = await loadForTeacher(user.id);
    const names = [...new Set(load.map((row) => row.discipline))];
    if (args.subject) query.set("discipline", matchDiscipline(String(args.subject), names) ?? String(args.subject));
  }
  if (args.semester) query.set("semester", String(args.semester));
  if (args.q) query.set("q", String(args.q));
  if (args.weekOffset != null) query.set("weekOffset", String(args.weekOffset));
  const qs = query.toString();
  const suffix = qs ? `?${qs}` : "";
  const date = query.get("date");
  switch (page) {
    case "dashboard":
      return { to: "/", highlight: "brief" };
    case "schedule":
      return { to: `/schedule${suffix}`, highlight: date ? `schedule-day-${date}` : "schedule" };
    case "grades":
      return { to: `/grades${suffix}`, highlight: "grades" };
    case "requests":
      return { to: "/requests", highlight: "requests" };
    case "new_request":
      return { to: `/requests/new${suffix}`, highlight: "new-request" };
    case "request":
      if (!args.requestId) throw badRequest("Нужен номер заявки");
      await getRequestFor(user, Number(args.requestId));
      return { to: `/requests/${args.requestId}`, highlight: `request-${args.requestId}` };
    case "notifications":
      return { to: "/notifications", highlight: "notifications" };
    case "profile":
      return { to: "/profile", highlight: "profile" };
    case "audit":
      return { to: "/audit", highlight: "audit" };
    case "regulations":
      return { to: `/regulations${suffix}`, highlight: "regulations" };
    case "staff_inbox":
      return { to: "/staff", highlight: "inbox" };
    case "staff_announce":
      return { to: "/staff/announcements", highlight: "announcements" };
    case "staff_request":
      if (!args.requestId) throw badRequest("Нужен номер заявки");
      await getRequestFor(user, Number(args.requestId));
      return { to: `/staff/requests/${args.requestId}`, highlight: `staff-request-${args.requestId}` };
    case "homework":
      return args.assignmentId
        ? { to: `/homework/${args.assignmentId}`, highlight: `homework-${args.assignmentId}` }
        : { to: "/homework", highlight: "homework" };
    case "teach":
      return { to: "/teach", highlight: "teach" };
    case "teach_journal":
      return { to: `/teach/journal${suffix}`, highlight: "journal" };
    case "teach_queue":
      return { to: "/teach/homework", highlight: "queue" };
    case "teach_issue":
      return { to: "/teach/assign", highlight: "issue" };
    case "teach_announce":
      return { to: "/teach/announce", highlight: "announce" };
    default:
      return { to: "/" };
  }
}

function moscowStamp(iso: string) {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Moscow" }).format(date);
  return `${day}, ${time}`;
}

function themeLabel(theme: Theme) {
  if (theme === "dark") return "тёмная";
  if (theme === "light") return "светлая";
  return "как в системе";
}

export async function studentBrief(user: PublicUser) {
  const today = moscowToday();
  const schedule = await loadSchedule(user, today, true);
  const semester = semestersFor(today).current.id;
  const list = await loadDisciplines(user.id, semester);
  const own = await listOwnRequests(user.id);
  const reminderRows = await listReminders(user.id);
  const unread = await unreadCount(user.id);
  return composeBrief({
    addressName: user.addressName,
    hour: moscowHour(),
    todayISO: today,
    todayLessons: schedule.items.filter((item) => item.date === today),
    changes: await changesUntil(user, today),
    navigator: analyzeSession(list, today),
    requests: own.map((row) => ({ id: row.id, title: row.title, status: row.status as RequestStatus })),
    unread,
    reminders: reminderRows.map((row) => ({
      title: row.title,
      dueLabel: moscowStamp(row.dueAt),
    })),
  });
}

export async function runTurn(
  user: PublicUser,
  input: { message: string; proposal?: unknown; mode?: string; history?: ChatTurn[] },
): Promise<{
  mode: "device" | "fallback" | "server" | "cloud";
  caption: string;
  say: string;
  steps: { label: string; status: "ok" | "error" | "skipped"; detail?: string }[];
  ui: UiDirective[];
  confirm?: ConfirmCard;
  citations?: Citation[];
  download?: { href: string; label: string };
  undo?: { auditId: number; label: string };
  cards?: AnswerCard[];
  choices?: ChoiceChip[];
  link?: { to: string; label: string };
}> {
  let mode: "device" | "fallback" | "server" | "cloud" = "fallback";
  let caption = "Быстрый режим";
  let proposal: Proposal | null = null;
  if (input.proposal) {
    const parsed = ProposalSchema.safeParse(input.proposal);
    if (!parsed.success) throw badRequest("Модель вернула не те поля. Повторите фразу.");
    proposal = { say: parsed.data.say, steps: parsed.data.steps };
    mode = "device";
    caption = "Шаги предложила модель на устройстве";
  } else if (input.mode === "server" && getConfig().localLlmUrl) {
    try {
      const raw = await proposeWithLocal(user.role, input.message, input.history ?? []);
      const parsed = ProposalSchema.parse(raw);
      proposal = { say: parsed.say, steps: parsed.steps };
      mode = "server";
      caption = "Шаги предложила серверная модель";
    } catch {
      proposal = null;
    }
  } else if (input.mode === "cloud" && getConfig().cloudEnabled) {
    try {
      const raw = await proposeWithCloud(user.role, input.message, input.history ?? []);
      const parsed = ProposalSchema.parse(raw);
      proposal = { say: parsed.say, steps: parsed.steps };
      mode = "cloud";
      caption = "Облачный адаптер включён отдельно и не является основным путём";
    } catch {
      proposal = null;
    }
  }
  if (!proposal) {
    const names = user.role === "student" ? await disciplineNames(user.id) : [];
    proposal = parseIntent(input.message, user.role, names);
    mode = "fallback";
    caption = "Быстрый режим";
  }

  const steps: { label: string; status: "ok" | "error" | "skipped"; detail?: string }[] = [];
  const ui: UiDirective[] = [];
  const cards: AnswerCard[] = [];
  let choices: ChoiceChip[] | undefined;
  let confirm: ConfirmCard | undefined;
  let citations: Citation[] | undefined;
  let download: { href: string; label: string } | undefined;
  let undo: { auditId: number; label: string } | undefined;
  let stopped = false;
  for (const call of proposal.steps) {
    const label = stepLabel(call.tool, call.args);
    if (stopped) {
      steps.push({ label, status: "skipped", detail: "Ждёт подтверждения предыдущего шага." });
      continue;
    }
    try {
      const result = await perform(user, call.tool, call.args, { source: "agent", confirmed: false });
      steps.push({ label, status: "ok", detail: result.summary || undefined });
      ui.push(...(result.ui ?? []));
      if (result.citations?.length) citations = result.citations;
      if (result.download) download = result.download;
      if (result.undoOffer) undo = result.undoOffer;
      if (result.card) cards.push(result.card);
      if (result.choices?.length) choices = result.choices;
      if (result.confirm) {
        confirm = result.confirm;
        stopped = true;
      }
    } catch (error) {
      const detail = error instanceof HttpError ? error.message : "Не получилось выполнить шаг.";
      steps.push({ label, status: "error", detail });
    }
  }
  const details = steps.map((step) => step.detail).filter((detail): detail is string => Boolean(detail));
  const say = details.length ? details.join("\n\n") : proposal.say || "Уточните, пожалуйста, что сделать.";
  const acted = !confirm && proposal.steps.some((call, index) => steps[index]?.status === "ok" && ACT_TOOLS.has(call.tool));
  const explicit = /открой|перейди|покажи на странице|покажи страницу|покажи в журнале/i.test(input.message);
  let nextUi = dedupeUi(ui);
  let link: { to: string; label: string } | undefined;
  if (!acted && !explicit) {
    const nav = nextUi.find((item) => item.type === "navigate");
    if (nav && nav.type === "navigate") link = { to: nav.to, label: "На странице" };
    nextUi = nextUi.filter((item) => item.type !== "navigate");
  }
  return { mode, caption, say, steps, ui: nextUi, confirm, citations, download, undo, cards, choices, link };
}

const ACT_TOOLS = new Set([
  "create_request",
  "cancel_request",
  "submit_homework",
  "save_homework",
  "teacher_grade_homework",
  "teacher_return_homework",
  "teacher_set_mark",
  "teacher_mark_absent",
  "teacher_set_attendance",
  "teacher_issue_assignment",
  "teacher_announce",
  "set_reminder",
  "remind_deadline",
  "staff_set_status",
  "staff_publish_announcement",
  "undo",
  "undo_last",
  "mark_schedule_item",
  "teacher_open_roll",
]);

function dedupeUi(list: UiDirective[]): UiDirective[] {
  let navigate: Extract<UiDirective, { type: "navigate" }> | null = null;
  let theme: Extract<UiDirective, { type: "theme" }> | null = null;
  const keys = new Set<string>();
  for (const item of list) {
    if (item.type === "navigate") navigate = item;
    else if (item.type === "theme") theme = item;
    else item.keys.forEach((key) => keys.add(key));
  }
  const out: UiDirective[] = [];
  if (navigate) out.push(navigate);
  if (theme) out.push(theme);
  if (keys.size) out.push({ type: "invalidate", keys: [...keys] });
  return out;
}

async function saveClarification(userId: number, tool: string, args: Record<string, unknown>) {
  const id = randomUUID();
  await getDb().insert(clarifications).values({
    id,
    userId,
    tool,
    args,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  return id;
}

export async function clarifyChoice(user: PublicUser, clarificationId: string, entityId: string) {
  const rows = await getDb()
    .select()
    .from(clarifications)
    .where(and(eq(clarifications.id, clarificationId), eq(clarifications.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Уточнение не найдено");
  if (new Date(row.expiresAt).getTime() < Date.now()) throw new HttpError(410, "expired", "Срок уточнения вышел. Повторите просьбу.");
  await getDb().delete(clarifications).where(eq(clarifications.id, clarificationId));
  const args = { ...(row.args as Record<string, unknown>) };
  if (row.tool === "teacher_set_mark") {
    const [groupName, discipline] = entityId.split("||");
    args.groupName = groupName;
    args.discipline = discipline;
  } else {
    args.assignmentId = Number(entityId);
    if (row.tool === "teacher_grade_homework" || row.tool === "teacher_return_homework") {
      const hit = (await teacherQueue(user)).find((item) => item.assignmentId === Number(entityId) && samePerson(String(args.studentName ?? ""), item.studentName));
      if (hit) {
        args.studentName = hit.studentName;
        args.groupName = hit.groupName;
        args.discipline = hit.discipline;
        args.workTitle = hit.title;
      }
    }
  }
  const result = await perform(user, row.tool, args, { source: "agent", confirmed: false });
  return {
    say: result.summary,
    caption: "Быстрый режим",
    steps: [] as { label: string; status: "ok" | "error" | "skipped" }[],
    ui: result.confirm ? [] : (result.ui ?? []),
    confirm: result.confirm,
    cards: result.card ? [result.card] : undefined,
    choices: result.choices,
    download: result.download,
    undo: result.undoOffer,
  };
}

export async function confirmPending(user: PublicUser, pendingId: string) {
  const rows = await getDb()
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingId), eq(pendingActions.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Подтверждение не найдено");
  if (row.consumedAt) throw new HttpError(409, "consumed", "Это подтверждение уже использовано.");
  if (new Date(row.expiresAt).getTime() < Date.now()) throw new HttpError(410, "expired", "Срок подтверждения вышел. Повторите просьбу.");
  const claimed = await getDb()
    .update(pendingActions)
    .set({ consumedAt: new Date().toISOString() })
    .where(and(eq(pendingActions.id, pendingId), eq(pendingActions.userId, user.id), isNull(pendingActions.consumedAt)))
    .returning();
  if (!claimed[0]) throw new HttpError(409, "consumed", "Это подтверждение уже использовано.");
  try {
    const result = await perform(user, row.action, row.args, { source: "agent", confirmed: true });
    return { ...result, cards: result.card ? [result.card] : undefined };
  } catch (error) {
    await getDb().update(pendingActions).set({ consumedAt: null }).where(eq(pendingActions.id, pendingId));
    throw error;
  }
}

export async function rejectPending(user: PublicUser, pendingId: string) {
  const rows = await getDb()
    .update(pendingActions)
    .set({ consumedAt: new Date().toISOString() })
    .where(and(eq(pendingActions.id, pendingId), eq(pendingActions.userId, user.id), isNull(pendingActions.consumedAt)))
    .returning();
  if (!rows[0]) throw notFound("Подтверждение не найдено");
  return { ok: true };
}

void findUserById;
void sql;
