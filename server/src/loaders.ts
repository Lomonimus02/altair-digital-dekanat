import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { academicPeriod, addDays, formatDdMm, longDay, mondayOf, moscowToday, studyWeek, weekdayRu } from "../../shared/src/dates";
import { addressName, initials, type LessonView, type PublicUser, type Role, type Theme } from "../../shared/src/domain";
import { getDb } from "./db/client";
import {
  announcements,
  auditLog,
  disciplines,
  gradingSchemes,
  journalColumns,
  marks,
  notifications,
  reminders,
  requestEvents,
  requests,
  scheduleFlags,
  scheduleItems,
  teachingLoad,
  users,
} from "./db/schema";
import { notFound } from "./httpError";

type UserRow = typeof users.$inferSelect;

export function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    login: row.login,
    role: row.role as Role,
    fullName: row.fullName,
    addressName: addressName(row.fullName),
    initials: initials(row.fullName),
    institute: row.institute,
    direction: row.direction,
    course: row.course,
    groupName: row.groupName,
    recordBook: row.recordBook,
    theme: row.theme as Theme,
    showCancelled: row.showCancelled,
  };
}

export async function findUserByLogin(login: string) {
  const rows = await getDb().select().from(users).where(eq(users.login, login)).limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: number) {
  const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function loadSchedule(user: PublicUser, focus: string, includeCancelled = true) {
  if (user.role === "teacher") return loadTeacherSchedule(user, focus, includeCancelled);
  if (!user.groupName) return { today: focus, focus, weekStart: mondayOf(focus), days: [], items: [] as LessonView[] };
  const days = studyWeek(focus);
  const rows = await getDb()
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.groupName, user.groupName), gte(scheduleItems.date, days[0]), lte(scheduleItems.date, days[5])))
    .orderBy(asc(scheduleItems.date), asc(scheduleItems.pairNumber));
  const ids = rows.map((row) => row.id);
  const flags = ids.length
    ? await getDb()
        .select()
        .from(scheduleFlags)
        .where(and(eq(scheduleFlags.userId, user.id), inArray(scheduleFlags.scheduleItemId, ids)))
    : [];
  const flagged = new Set(flags.filter((flag) => flag.flagged).map((flag) => flag.scheduleItemId));
  const items: LessonView[] = rows
    .filter((row) => includeCancelled || row.changeType !== "cancelled")
    .map((row) => ({
      id: row.id,
      date: row.date,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      discipline: row.discipline,
      kind: row.kind,
      room: row.room,
      teacher: row.teacher,
      changeType: row.changeType as LessonView["changeType"],
      changeNote: row.changeNote,
      pairNumber: row.pairNumber,
      flagged: flagged.has(row.id),
      groupName: row.groupName,
    }));
  await notifySoonChanges(user.id, items);
  return {
    today: focus,
    focus,
    weekStart: days[0],
    days: days.map((date) => ({
      date,
      weekday: weekdayRu(date),
      items: items.filter((item) => item.date === date),
    })),
    items,
  };
}

async function loadTeacherSchedule(user: PublicUser, focus: string, includeCancelled: boolean) {
  const days = studyWeek(focus);
  const empty = {
    today: focus,
    focus,
    weekStart: days[0],
    days: days.map((date) => ({ date, weekday: weekdayRu(date), items: [] as LessonView[] })),
    items: [] as LessonView[],
  };
  const load = await getDb()
    .select()
    .from(teachingLoad)
    .where(eq(teachingLoad.teacherId, user.id))
    .orderBy(asc(teachingLoad.groupName), asc(teachingLoad.discipline), asc(teachingLoad.id));
  if (!load.length) return empty;
  const groups = [...new Set(load.map((row) => row.groupName))];
  const rows = await getDb()
    .select()
    .from(scheduleItems)
    .where(and(inArray(scheduleItems.groupName, groups), gte(scheduleItems.date, days[0]), lte(scheduleItems.date, days[5])))
    .orderBy(asc(scheduleItems.date), asc(scheduleItems.pairNumber), asc(scheduleItems.id));
  const items: LessonView[] = rows
    .filter((row) => load.some((item) => item.groupName === row.groupName && item.discipline === row.discipline))
    .filter((row) => includeCancelled || row.changeType !== "cancelled")
    .map((row) => ({
      id: row.id,
      date: row.date,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      discipline: row.discipline,
      kind: row.kind,
      room: row.room,
      teacher: row.teacher,
      changeType: row.changeType as LessonView["changeType"],
      changeNote: row.changeNote,
      pairNumber: row.pairNumber,
      flagged: false,
      groupName: row.groupName,
    }));
  return {
    ...empty,
    days: days.map((date) => ({
      date,
      weekday: weekdayRu(date),
      items: items.filter((item) => item.date === date),
    })),
    items,
  };
}

async function notifySoonChanges(userId: number, items: LessonView[]) {
  const today = moscowToday();
  const until = addDays(today, 7);
  for (const item of items) {
    if (item.changeType === "none" || item.date < today || item.date > until) continue;
    const title = "Изменение в расписании";
    const body = `${formatDdMm(item.date)} ${item.discipline}: ${item.changeNote ?? ""}`.trim();
    const href = `/schedule?date=${item.date}&item=${item.id}`;
    const legacy = `${formatDdMm(item.date)} ${item.discipline}:`;
    const hint = item.changeType === "room" ? "%Аудитория изменена%" : item.changeType === "cancelled" ? "%отмен%" : "%Перенес%";
    const existing = await getDb()
      .select({ id: notifications.id, body: notifications.body, href: notifications.href })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.title, title),
          or(
            sql`${notifications.href} like ${"%item=" + item.id + "%"}`,
            and(
              sql`${notifications.href} like ${"%date=" + item.date + "%"}`,
              sql`${notifications.body} like ${legacy + "%"}`,
              sql`${notifications.body} like ${hint}`,
            ),
          ),
        ),
      )
      .limit(1);
    if (existing[0]) {
      if (existing[0].body !== body || existing[0].href !== href) {
        await getDb().update(notifications).set({ body, href }).where(eq(notifications.id, existing[0].id));
      }
      continue;
    }
    await getDb().insert(notifications).values({ userId, kind: "schedule", title, body, href });
  }
}

export async function loadDisciplines(userId: number, semester?: string) {
  const rows = await getDb()
    .select()
    .from(disciplines)
    .where(semester ? and(eq(disciplines.studentId, userId), eq(disciplines.semester, semester)) : eq(disciplines.studentId, userId))
    .orderBy(asc(disciplines.name));
  if (!rows.length) return [];
  const markRows = await getDb()
    .select()
    .from(marks)
    .where(and(eq(marks.studentId, userId), inArray(marks.disciplineId, rows.map((row) => row.id))))
    .orderBy(asc(marks.awardedOn));
  const owner = (await getDb().select({ groupName: users.groupName }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const schemes = owner?.groupName ? await getDb().select().from(gradingSchemes).where(eq(gradingSchemes.groupName, owner.groupName)) : [];
  const columnIds = [...new Set(markRows.map((mark) => mark.columnId).filter((id): id is number => id != null))];
  const columns = columnIds.length ? await getDb().select().from(journalColumns).where(inArray(journalColumns.id, columnIds)) : [];
  const columnOf = new Map(columns.map((column) => [column.id, column]));
  return rows.map((row) => {
    const scheme = schemes.find((item) => item.discipline === row.name);
    return {
      id: row.id,
      name: row.name,
      controlForm: row.controlForm as "exam" | "credit",
      sessionDate: row.sessionDate,
      obligatoryTotal: row.obligatoryTotal,
      obligatoryDone: row.obligatoryDone,
      semester: row.semester,
      thresholds: scheme
        ? { excellent: Number(scheme.excellent), good: Number(scheme.good), satisfactory: Number(scheme.satisfactory) }
        : undefined,
      marks: markRows
        .filter((mark) => mark.disciplineId === row.id)
        .map((mark) => {
          const column = mark.columnId ? columnOf.get(mark.columnId) : undefined;
          return {
            id: mark.id,
            label: mark.label,
            value: null,
            points: mark.points != null ? Number(mark.points) : null,
            maxPoints: column?.maxPoints ?? 10,
            weight: column ? Number(column.weight) : 1,
            kind: mark.kind as "current" | "exam" | "credit",
            awardedOn: mark.awardedOn,
          };
        }),
    };
  });
}

export async function disciplineNames(userId: number) {
  const rows = await getDb().select({ name: disciplines.name }).from(disciplines).where(eq(disciplines.studentId, userId));
  return rows.map((row) => row.name);
}

export async function listOwnRequests(userId: number) {
  return getDb().select().from(requests).where(eq(requests.studentId, userId)).orderBy(desc(requests.createdAt));
}

export async function getRequestFor(user: PublicUser, id: number) {
  const rows = await getDb().select().from(requests).where(eq(requests.id, id)).limit(1);
  const row = rows[0];
  if (!row || (user.role !== "staff" && row.studentId !== user.id)) throw notFound("Заявка не найдена");
  const events = await getDb().select().from(requestEvents).where(eq(requestEvents.requestId, id)).orderBy(asc(requestEvents.createdAt));
  let student: PublicUser | null = null;
  if (user.role === "staff") {
    const owner = await findUserById(row.studentId);
    student = owner ? toPublic(owner) : null;
  }
  return { request: row, events, student };
}

export async function listNotifications(userId: number) {
  return getDb().select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(50);
}

export async function listAudit(userId: number) {
  await getDb()
    .update(auditLog)
    .set({ summary: sql`replace(${auditLog.summary}, 'Ждёт подтверждения', 'Не подтверждено')` })
    .where(and(eq(auditLog.userId, userId), sql`${auditLog.summary} like 'Ждёт подтверждения%'`, sql`${auditLog.createdAt} < now() - interval '10 minutes'`));
  return getDb().select().from(auditLog).where(eq(auditLog.userId, userId)).orderBy(desc(auditLog.createdAt)).limit(40);
}

export async function listReminders(userId: number) {
  return getDb()
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, userId), eq(reminders.done, false), gte(reminders.dueAt, new Date(Date.now() - 86_400_000).toISOString())))
    .orderBy(asc(reminders.dueAt))
    .limit(8);
}

export async function listAnnouncements() {
  return getDb().select().from(announcements).orderBy(desc(announcements.createdAt)).limit(20);
}

export async function staffInbox() {
  const rows = await getDb().select().from(requests).orderBy(desc(requests.updatedAt)).limit(100);
  if (!rows.length) return [];
  const owners = await getDb()
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((row) => row.studentId))]));
  const byId = new Map(owners.map((owner) => [owner.id, owner]));
  return rows.map((row) => ({ row, owner: byId.get(row.studentId) ?? null }));
}

export async function allStudents() {
  return getDb().select().from(users).where(eq(users.role, "student"));
}

export async function allStaff() {
  return getDb().select().from(users).where(eq(users.role, "staff"));
}

export function semestersFor(todayISO: string) {
  const period = academicPeriod(todayISO);
  return { current: period.current, previous: period.previous, list: [period.current, period.previous] };
}

export async function changesUntil(user: PublicUser, todayISO: string) {
  if (!user.groupName) return [];
  const end = addDays(mondayOf(todayISO), 5);
  const data = await loadSchedule(user, todayISO, true);
  return data.items.filter((item) => item.date >= todayISO && item.date <= end && item.changeType !== "none");
}

export async function touchNow() {
  return sql`now()`;
}

export async function unreadCount(userId: number) {
  const rows = await getDb()
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows.length;
}

export { longDay };
