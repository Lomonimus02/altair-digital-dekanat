import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setClock } from "../../shared/src/dates";
import { buildApp } from "../src/app";
import { seed } from "../src/db/seed";
import { seedHomework } from "../src/db/seed-homework";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});
beforeEach(async () => {
  setClock(null);
  await seed();
  await seedHomework();
});
afterEach(() => setClock(null));
afterAll(async () => {
  await app.close();
});

it("чипы несут слоты: оценка, возврат с комментарием, сдача «регламент», напоминание", async () => {
  const maxim = await login("sorokin.mo", "Altair-student-31");
  const reminder = await turn(maxim, "напомни о дедлайне по базам данных");
  expect(reminder.undo?.auditId, reminder.say).toBeTruthy();
  const href = reminder.ui?.find((item) => item.to?.includes("/homework/"))?.to ?? "";
  const id = href.split("/").pop();
  const page = await authed(maxim, "GET", `/api/homework/${id}`);
  expect(page.json().reminder?.title).toMatch(/Сдать/);

  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const gradeTurn = await turn(teacher, "поставь 5 Сорокину за работу");
  const gradeChoices = gradeTurn.choices ?? [];
  expect(gradeChoices.length).toBeGreaterThan(1);
  const lab = gradeChoices.find((choice) => /индекс/i.test(choice.label));
  expect(lab?.clarificationId).toBeTruthy();
  expect(lab?.entityId).toMatch(/^\d+$/);
  const picked = await clarify(teacher, lab!.clarificationId, lab!.entityId);
  expect(picked.confirm?.fields.find((field) => field.label === "Оценка")?.value).toBe("5");
  expect(picked.confirm?.fields.find((field) => field.label === "Студент")?.value).toContain("Сорокин");
  expect(picked.confirm?.fields.find((field) => field.label === "Группа")?.value).toBe("БИ-3-26-04");
  expect(picked.confirm?.fields.find((field) => field.label === "Предмет")?.value).toBe("Базы данных");
  expect(picked.confirm?.fields.find((field) => field.label === "Работа")?.value).toMatch(/индекс/i);
  const graded = await confirm(teacher, picked.confirm!.pendingId);
  expect(graded.summary).toMatch(/5/);
  expect(graded.ui?.some((item) => item.to?.includes("/teach/journal") && item.highlight?.includes("Сорокин"))).toBe(true);
  const journal = await authed(teacher, "GET", `/api/teach/journal?group=${encodeURIComponent("БИ-3-26-04")}&discipline=${encodeURIComponent("Базы данных")}`);
  const sorokin = journal.json().students.find((student: { name: string }) => student.name.includes("Сорокин"));
  expect(sorokin.marks.some((mark: { value: number }) => mark.value === 5)).toBe(true);

  const backTurn = await turn(teacher, "верни на доработку работу Сорокина с комментарием добавь схему связей");
  let pending = backTurn.confirm;
  if (!pending) {
    const choice = (backTurn.choices ?? []).find((item) => /индекс/i.test(item.label)) ?? backTurn.choices?.[0];
    expect(choice?.clarificationId).toBeTruthy();
    const resumed = await clarify(teacher, choice!.clarificationId, choice!.entityId);
    pending = resumed.confirm;
  }
  expect(pending?.fields.find((field) => field.label === "Комментарий")?.value).toContain("схему связей");
  const returned = await confirm(teacher, pending!.pendingId);
  expect(returned.summary.toLowerCase()).toMatch(/доработ|вернул/);
  const assignmentId = returned.ui?.find((item) => item.to?.includes("/teach/homework/"))?.to?.split("/").pop();
  const detail = await authed(teacher, "GET", `/api/teach/homework/${assignmentId}`);
  const student = detail.json().assignment.students.find((row: { name: string }) => row.name.includes("Сорокин"));
  expect(student.submission.teacherComment).toContain("схему связей");
  expect(student.submission.status).toBe("returned");

  const studentSession = await login("volkova.as", "Altair-student-17");
  const submitTurn = await turn(studentSession, "сдай задание по информационным технологиям: ссылка https://example.com/reglament");
  const reading = (submitTurn.choices ?? []).find((choice) => /регламент/i.test(choice.label));
  expect(reading, JSON.stringify(submitTurn.choices)).toBeTruthy();
  const ready = await clarify(studentSession, reading!.clarificationId, reading!.entityId);
  expect(ready.confirm?.fields.find((field) => field.label === "Задание")?.value).toMatch(/регламент/i);
  const sent = await confirm(studentSession, ready.confirm!.pendingId);
  expect(sent.summary).toMatch(/проверк/i);
  const work = await authed(studentSession, "GET", `/api/homework/${reading!.entityId}`);
  expect(work.json().homework.submission.status).toBe("in_review");
  expect(work.json().homework.submission.body).toContain("https://example.com/reglament");
});

it("журнал открывается с группой и предметом, напоминание ставится на открытую работу", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const journal = await turn(teacher, "открой журнал группы БИ-3-26-04 по базам данных");
  const to = journal.ui?.find((item) => item.type === "navigate")?.to ?? "";
  const url = new URL(to, "http://altair.local");
  expect(url.searchParams.get("group")).toBe("БИ-3-26-04");
  expect(url.searchParams.get("discipline")).toBe("Базы данных");

  const student = await login("sorokin.mo", "Altair-student-31");
  const reminder = await turn(student, "напомни о дедлайне по базам данных");
  expect(reminder.say).not.toMatch(/нет/i);
  expect(reminder.undo?.auditId).toBeTruthy();
  expect(reminder.say.startsWith("Напомню") || reminder.say.includes("Сдать")).toBe(true);
});

it("ER в комментарии не мешает вернуть работу Громова", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const body = await turn(teacher, "верни на доработку работу Громова с комментарием добавь ER-диаграмму");
  expect(body.say).not.toContain("не нашёл");
  const comment = body.confirm?.fields.find((field) => field.label === "Комментарий")?.value;
  const student = body.confirm?.fields.find((field) => field.label === "Студент")?.value;
  expect(comment).toBe("добавь ER-диаграмму");
  expect(student).toMatch(/Громов/);
});

it("подтверждение заменяет карточку в журнале, повторное напоминание не плодит уведомления", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const prepared = await turn(teacher, "поставь 5 Сорокину за лабу");
  expect(prepared.confirm?.pendingId).toBeTruthy();
  await confirm(teacher, prepared.confirm!.pendingId);
  const audit = await authed(teacher, "GET", "/api/audit");
  const events = audit.json().events as { summary: string; action: string }[];
  expect(events.some((event) => event.action === "teacher_grade_homework" && event.summary.startsWith("Ждёт подтверждения"))).toBe(false);
  expect(events.filter((event) => event.action === "teacher_grade_homework")).toHaveLength(1);

  const student = await login("sorokin.mo", "Altair-student-31");
  await turn(student, "напомни о дедлайне по базам данных");
  const again = await turn(student, "напомни о дедлайне по базам данных");
  expect(again.say).toMatch(/уже стоит/);
  const notes = await authed(student, "GET", "/api/notifications");
  const reminders = (notes.json().notifications as { kind: string; title: string }[]).filter((note) => note.kind === "reminder" && note.title.startsWith("Сдать"));
  expect(reminders).toHaveLength(1);
});

it("в воскресенье расписание и пары преподавателя смотрят на ближайший понедельник", async () => {
  setClock("2026-11-15T09:00:00+03:00");
  const student = await login("sorokin.mo", "Altair-student-31");
  const opened = await turn(student, "открой расписание");
  const to = opened.ui?.find((item) => item.type === "navigate")?.to ?? "";
  expect(to).toContain("2026-11-16");
  expect(opened.say).not.toContain("09.11");
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const today = await turn(teacher, "что у меня сегодня");
  expect(today.say).toContain("Ближайшие");
  expect(today.say).not.toMatch(/Сегодня: 13:00/);
  const journal = await authed(teacher, "GET", `/api/teach/journal?group=${encodeURIComponent("БИ-3-26-04")}&discipline=${encodeURIComponent("Базы данных")}`);
  expect(journal.json().studyDate).toBe("2026-11-16");
});

async function turn(session: Session, message: string) {
  const res = await authed(session, "POST", "/api/agent/turn", { message, mode: "fallback" });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as TurnBody;
}

async function clarify(session: Session, clarificationId: string, entityId: string) {
  const res = await authed(session, "POST", "/api/agent/clarify", { clarificationId, entityId });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as TurnBody;
}

async function confirm(session: Session, pendingId: string) {
  const res = await authed(session, "POST", "/api/agent/confirm", { pendingId });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { summary: string; ui?: { to?: string; highlight?: string }[] };
}

async function login(loginName: string, password: string): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: loginName, password } });
  expect(res.statusCode, res.body).toBe(200);
  const lines = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"] ?? ""];
  const jar: Record<string, string> = {};
  for (const line of lines) {
    const [pair] = line.split(";");
    const [key, value] = pair.split("=");
    jar[key] = value;
  }
  return { cookie: `sid=${jar.sid}; csrf=${jar.csrf}`, csrf: res.json().csrfToken as string };
}

function authed(session: Session, method: string, url: string, payload?: unknown) {
  return app.inject({ method, url, payload, headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
}

interface Session { cookie: string; csrf: string }
interface TurnBody {
  say: string;
  confirm?: { pendingId: string; fields: { label: string; value: string }[] };
  choices?: { label: string; clarificationId: string; entityId: string }[];
  ui?: { type: string; to?: string; highlight?: string }[];
  undo?: { auditId: number };
}
