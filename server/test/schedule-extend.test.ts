import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { formatDdMm, formatWeekSpan, mondayOf, scheduleLook, setClock } from "../../shared/src/dates";
import { buildApp } from "../src/app";
import { getDb } from "../src/db/client";
import { loadSchedule, toPublic } from "../src/loaders";
import { extendSchedule } from "../src/db/seed-schedule-extend";
import { seed } from "../src/db/seed";
import { seedHomework } from "../src/db/seed-homework";
import { assignments, disciplines, marks, notifications, scheduleItems, submissions, users } from "../src/db/schema";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await seed();
  await seedHomework();
});
afterAll(async () => {
  await app.close();
});

it("продление расписания дважды не трогает людей, оценки и сдачи", async () => {
  const before = await snapshot();
  await extendSchedule();
  const mid = await snapshot();
  await extendSchedule();
  const after = await snapshot();

  expect(after.users).toBe(before.users);
  expect(after.marks).toBe(before.marks);
  expect(after.submissions).toBe(before.submissions);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.schedule).toBe(mid.schedule);
  expect(after.assignments).toBe(mid.assignments);

  const db = getDb();
  const december = await db.select().from(scheduleItems).where(eq(scheduleItems.date, "2026-12-07"));
  expect(december.some((row) => row.groupName === "БИ-3-26-04" && row.discipline === "Базы данных" && row.teacher === "доц. Орлов П. Н.")).toBe(true);
  expect(december.some((row) => row.groupName === "ЮР-1-26-02")).toBe(true);
  const pastEnd = await db.select({ id: scheduleItems.id }).from(scheduleItems).where(eq(scheduleItems.date, "2027-01-02"));
  expect(pastEnd).toHaveLength(0);

  const changes = await db.select().from(scheduleItems);
  const weeks = new Map<string, Set<string>>();
  for (const row of changes) {
    if (row.changeType === "none" || row.date < "2026-11-16" || row.date > "2026-12-31") continue;
    const key = mondayOf(row.date);
    const groups = weeks.get(key) ?? new Set<string>();
    groups.add(row.groupName);
    weeks.set(key, groups);
  }
  for (let monday = "2026-11-16"; monday <= "2026-12-28"; monday = nextMonday(monday)) {
    expect(weeks.get(monday)?.has("БИ-3-26-04"), monday).toBe(true);
    expect(weeks.get(monday)?.has("ЮР-1-26-02"), monday).toBe(true);
  }

  const added = await db.select().from(assignments).where(eq(assignments.title, "Лабораторная: транзакции"));
  expect(added).toHaveLength(1);
  expect(added[0]?.deadline).toBe("2026-11-27");

  const sources = changes.filter((row) => row.changeType === "moved" && (row.changeNote ?? "").toLowerCase().includes("пятниц"));
  expect(sources.length).toBeGreaterThan(0);
  for (const source of sources) {
    const friday = nextDay(source.date);
    const target = changes.find(
      (row) =>
        row.groupName === source.groupName &&
        row.date === friday &&
        row.discipline === source.discipline &&
        (row.changeNote ?? "").startsWith("Перенесено с"),
    );
    expect(target, `${source.groupName} ${source.date}`).toBeTruthy();
    expect(target?.startsAt).toBe("13:00");
  }

  const kotov = changes.filter(
    (row) => row.groupName === "ЮР-1-26-02" && row.discipline === "Информационные технологии в юридической деятельности" && row.teacher !== "доц. Орлов П. Н.",
  );
  expect(kotov).toHaveLength(0);
  for (const row of changes.filter((item) => item.changeType === "room")) {
    if (row.discipline === "Программирование") expect(row.changeNote).toBe(`Аудитория изменена: была 314, теперь ${row.room}`);
    if (row.discipline.includes("Информационные")) expect(row.changeNote).toBe(`Аудитория изменена: была 505, теперь ${row.room}`);
    if (row.discipline === "Линейная алгебра") expect(row.changeNote).toContain("была 401");
  }
  expect(changes.some((row) => /, \d\.\d{2}$/.test(row.changeNote ?? ""))).toBe(false);
  expect(changes.some((row) => /Перенесено с четверга, \d{2}\.\d{2}/.test(row.changeNote ?? ""))).toBe(true);

  const [sorokin] = await db.select().from(users).where(eq(users.login, "sorokin.mo"));
  const [belova] = await db.select().from(users).where(eq(users.login, "bi.01"));
  const [selectLab] = await db.select().from(assignments).where(eq(assignments.title, "Лабораторная: SELECT"));
  const owned = await db.select().from(submissions).where(and(eq(submissions.assignmentId, selectLab.id), eq(submissions.studentId, sorokin.id)));
  expect(owned).toHaveLength(1);
  const misplaced = await db.select().from(submissions).where(and(eq(submissions.assignmentId, selectLab.id), eq(submissions.studentId, belova.id)));
  expect(misplaced).toHaveLength(0);
});

it("преподаватель видит свою неделю, а подпись недели стоит в родительном падеже", async () => {
  await extendSchedule();
  expect(formatWeekSpan("2026-11-23", "2026-11-28")).toBe("23–28 ноября");
  expect(formatWeekSpan("2026-11-30", "2026-12-05")).toBe("30 ноября – 5 декабря");

  const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "orlov.pn", password: "Altair-teacher-58" } });
  expect(loginRes.statusCode).toBe(200);
  const cookie = asCookie(loginRes.headers["set-cookie"]);
  const csrf = loginRes.json().csrfToken as string;
  const schedule = await app.inject({
    method: "GET",
    url: "/api/schedule?date=2026-12-04",
    headers: { cookie, "x-csrf-token": csrf },
  });
  expect(schedule.statusCode).toBe(200);
  const body = schedule.json() as { items: { discipline: string; groupName: string; teacher: string }[] };
  expect(body.items.some((item) => item.groupName === "ЮР-1-26-02" && item.discipline.includes("Информационные"))).toBe(true);
  expect(body.items.every((item) => item.groupName === "БИ-3-26-04" || item.groupName === "ЮР-1-26-02")).toBe(true);

  const turn = await app.inject({
    method: "POST",
    url: "/api/agent/turn",
    payload: { message: "что у меня на неделе", mode: "fallback" },
    headers: { cookie, "x-csrf-token": csrf },
  });
  expect(turn.statusCode).toBe(200);
  const answer = turn.json() as { say: string; cards?: unknown[]; link?: { to: string }; ui?: { type: string }[] };
  expect(answer.say).toMatch(/Пн, \d{1,2} /);
  expect(answer.say).toMatch(/ауд\./);
  expect(answer.say).toMatch(/БИ-3-26-04/);
  expect(answer.say).toMatch(/ЮР-1-26-02/);
  expect(answer.say).toMatch(/отменена|другая аудитория|перенос/);
  expect(answer.cards?.length).toBeGreaterThan(0);
  expect(answer.link?.to).toContain("/schedule");
  expect(answer.ui?.some((entry) => entry.type === "navigate" && entry.to?.includes("/schedule"))).toBe(true);

  const studentLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "sorokin.mo", password: "Altair-student-31" } });
  const studentCookie = asCookie(studentLogin.headers["set-cookie"]);
  const studentCsrf = studentLogin.json().csrfToken as string;
  const studentTurn = await app.inject({
    method: "POST",
    url: "/api/agent/turn",
    payload: { message: "что у меня на неделе", mode: "fallback" },
    headers: { cookie: studentCookie, "x-csrf-token": studentCsrf },
  });
  const studentSay = studentTurn.json().say as string;
  expect(studentSay).toMatch(/Пн, \d{1,2} /);
  expect(studentSay).not.toContain("БИ-3-26-04");
  expect(studentSay).toMatch(/ауд\./);
  expect(studentSay).toContain("отменена");
  expect(studentSay).toContain("другая аудитория");
  expect(studentSay).toContain("перенос");
});

it("замена аудитории обновляет уже отправленное уведомление", async () => {
  const db = getDb();
  const [row] = await db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.changeType, "room"), eq(scheduleItems.discipline, "Программирование")));
  const oldNote = "Аудитория изменена: была 401, теперь 415";
  await db.update(scheduleItems).set({ changeNote: oldNote }).where(eq(scheduleItems.id, row.id));
  const [sorokin] = await db.select().from(users).where(eq(users.login, "sorokin.mo"));
  const [note] = await db
    .insert(notifications)
    .values({
      userId: sorokin.id,
      kind: "schedule",
      title: "Изменение в расписании",
      body: `${formatDdMm(row.date)} Программирование: ${oldNote}`,
      href: `/schedule?date=${row.date}`,
    })
    .returning();
  await extendSchedule();
  const [fresh] = await db.select().from(notifications).where(eq(notifications.id, note.id));
  expect(fresh.body).toContain("была 314");
  expect(fresh.body).not.toContain("была 401");
  await extendSchedule();
  const [again] = await db.select().from(notifications).where(eq(notifications.id, note.id));
  expect(again.body).toBe(fresh.body);
  await db.update(notifications).set({ body: `${formatDdMm(row.date)} Программирование: ${oldNote}`, href: `/schedule?date=${row.date}` }).where(eq(notifications.id, note.id));
  await extendSchedule();
  const [kept] = await db.select().from(notifications).where(eq(notifications.id, note.id));
  expect(kept.body).toContain("была 314");
  expect(kept.body).not.toContain("была 401");
  expect(kept.href).toContain(`item=${row.id}`);
});

it("повторный просмотр пары не создаёт второе уведомление", async () => {
  const db = getDb();
  const [row] = await db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.changeType, "room"), eq(scheduleItems.discipline, "Программирование"), eq(scheduleItems.date, "2026-11-19")));
  const [sorokin] = await db.select().from(users).where(eq(users.login, "sorokin.mo"));
  await db.delete(notifications).where(and(eq(notifications.userId, sorokin.id), eq(notifications.title, "Изменение в расписании")));
  setClock("2026-11-16T12:00:00+03:00");
  try {
    await loadSchedule(toPublic(sorokin), "2026-11-19", true);
    await loadSchedule(toPublic(sorokin), "2026-11-19", true);
  } finally {
    setClock(null);
  }
  const notes = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, sorokin.id), eq(notifications.title, "Изменение в расписании")));
  const mine = notes.filter((note) => note.href?.includes(`item=${row.id}`));
  expect(mine).toHaveLength(1);
  expect(mine[0]?.body).toContain("была 314");
});

it("прошедшая дата не называется ближайшей", () => {
  expect(scheduleLook("2026-11-15", "2026-11-09", "2026-11-14")).toBe("past");
  expect(scheduleLook("2026-11-15", "2026-11-16", "2026-11-21")).toBe("near");
  expect(scheduleLook("2026-11-16", "2026-11-16", "2026-11-21")).toBe("in-week");
});

async function snapshot() {
  const db = getDb();
  const [userCount] = await db.select({ value: count() }).from(users);
  const [markCount] = await db.select({ value: count() }).from(marks);
  const [submissionCount] = await db.select({ value: count() }).from(submissions);
  const [scheduleCount] = await db.select({ value: count() }).from(scheduleItems);
  const [assignmentCount] = await db.select({ value: count() }).from(assignments);
  const sessions = (await db.select({ sessionDate: disciplines.sessionDate }).from(disciplines)).map((row) => row.sessionDate).sort();
  return {
    users: userCount?.value ?? 0,
    marks: markCount?.value ?? 0,
    submissions: submissionCount?.value ?? 0,
    schedule: scheduleCount?.value ?? 0,
    assignments: assignmentCount?.value ?? 0,
    sessions,
  };
}

function nextMonday(iso: string) {
  return nextDay(iso, 7);
}

function nextDay(iso: string, shift = 1) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + shift));
  return date.toISOString().slice(0, 10);
}

function asCookie(value: string | string[] | undefined) {
  const lines = !value ? [] : Array.isArray(value) ? value : [value];
  const jar: Record<string, string> = {};
  for (const line of lines) {
    const [pair] = line.split(";");
    const [key, raw] = pair.split("=");
    jar[key] = raw;
  }
  return `sid=${jar.sid}; csrf=${jar.csrf}`;
}
