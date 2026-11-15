import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mondayOf, scheduleLook } from "../../shared/src/dates";
import { buildApp } from "../src/app";
import { getDb } from "../src/db/client";
import { extendSchedule } from "../src/db/seed-schedule-extend";
import { seed } from "../src/db/seed";
import { seedHomework } from "../src/db/seed-homework";
import { assignments, disciplines, marks, scheduleItems, submissions, users } from "../src/db/schema";

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
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 7));
  return date.toISOString().slice(0, 10);
}
