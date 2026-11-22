import { readFileSync } from "node:fs";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { analyzeSession } from "../../shared/src/navigator";
import type { PublicUser } from "../../shared/src/domain";
import { academicPeriod, formatDdMm, weekdayIndex } from "../../shared/src/dates";
import { ATTENDANCE, DEFAULT_THRESHOLDS, countsAsSemester, defaultWorkRule, formatScore, gradeLabel, legacyFromMark, monthBounds, periodLabel, pointsTotal, semesterBounds, validPoints, WORK_TYPES, WORK_TYPE_KEYS, type AttendanceStatus, type WorkType } from "../../shared/src/journal";
import { calendarDay, isFutureDay, moscowToday } from "../../shared/src/dates";
import { samePerson } from "../../shared/src/names";
import { getDb } from "./db/client";
import { attendance, disciplines, gradingSchemes, journalColumns, lessonTopics, marks, scheduleItems, teachingLoad, users } from "./db/schema";
import { badRequest, forbidden, notFound } from "./httpError";
import { loadDisciplines } from "./loaders";

const MISS = "Журнал не найден";

export async function backfillJournal() {
  const { getPool } = await import("./db/client");
  const dir = new URL("../migrations/", import.meta.url);
  await getPool().query(readFileSync(new URL("004_grades_journal.sql", dir), "utf8"));
  await getPool().query(readFileSync(new URL("005_cumulative_points.sql", dir), "utf8"));
}

function shortName(full: string) {
  const parts = full.split(/\s+/);
  const initials = parts.slice(1).map((part) => `${part[0]}.`).join(" ");
  return initials ? `${parts[0]} ${initials}` : full;
}

async function teaches(teacherId: number, groupName: string, discipline: string) {
  const rows = await getDb()
    .select()
    .from(teachingLoad)
    .where(and(eq(teachingLoad.teacherId, teacherId), eq(teachingLoad.groupName, groupName), eq(teachingLoad.discipline, discipline)))
    .limit(1);
  if (!rows[0]) throw notFound("Вы не ведёте этот предмет.");
  return rows[0];
}

async function knownPair(groupName: string, discipline: string) {
  const rows = await getDb()
    .select()
    .from(teachingLoad)
    .where(and(eq(teachingLoad.groupName, groupName), eq(teachingLoad.discipline, discipline)))
    .limit(1);
  if (!rows[0]) throw notFound(MISS);
  return rows[0];
}

async function studentsOf(groupName: string) {
  return getDb().select().from(users).where(and(eq(users.role, "student"), eq(users.groupName, groupName))).orderBy(asc(users.fullName));
}

async function studentIn(groupName: string, studentName: string) {
  const list = await studentsOf(groupName);
  const found = list.filter((row) => samePerson(studentName, row.fullName));
  if (found.length !== 1) throw notFound(found.length ? "В группе несколько таких студентов." : "Такого студента в этой группе нет.");
  return found[0];
}

export async function ensureDiscipline(studentId: number, name: string, groupName: string) {
  const db = getDb();
  const own = await db.select().from(disciplines).where(and(eq(disciplines.studentId, studentId), eq(disciplines.name, name))).limit(1);
  if (own[0]) return own[0];
  const peers = await db.select().from(users).where(and(eq(users.role, "student"), eq(users.groupName, groupName)));
  const peer = peers.length
    ? (await db.select().from(disciplines).where(and(eq(disciplines.name, name), inArray(disciplines.studentId, peers.map((row) => row.id)))).limit(1))[0]
    : undefined;
  const [created] = await db.insert(disciplines).values({
    studentId,
    name,
    controlForm: peer?.controlForm ?? "exam",
    semester: peer?.semester ?? academicPeriod(moscowToday()).current.id,
    obligatoryTotal: peer?.obligatoryTotal ?? 0,
    obligatoryDone: 0,
  }).returning();
  return created;
}

function checkRange(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest("Нужны даты периода");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days > 240) throw badRequest("Период длиннее семестра");
}

export async function loadJournal(user: PublicUser, groupName: string, discipline: string, from?: string, to?: string) {
  if (user.role === "student") throw forbidden();
  if (user.role === "teacher") await teaches(user.id, groupName, discipline);
  else if (user.role === "staff") await knownPair(groupName, discipline);
  else throw forbidden();
  const bounds = from && to ? { from, to } : monthBounds();
  checkRange(bounds.from, bounds.to);
  const term = semesterBounds();
  if (bounds.from < term.from || bounds.to > term.to) throw badRequest("Период вне семестра");
  const db = getDb();
  const people = await studentsOf(groupName);
  const lessonRows = await db.select().from(scheduleItems).where(and(
    eq(scheduleItems.groupName, groupName),
    eq(scheduleItems.discipline, discipline),
    gte(scheduleItems.date, bounds.from),
    lte(scheduleItems.date, bounds.to),
  )).orderBy(asc(scheduleItems.date), asc(scheduleItems.pairNumber));
  const topics = await db.select().from(lessonTopics).where(and(
    eq(lessonTopics.groupName, groupName),
    eq(lessonTopics.discipline, discipline),
    gte(lessonTopics.lessonDate, bounds.from),
    lte(lessonTopics.lessonDate, bounds.to),
  ));
  const topicOf = new Map(topics.map((row) => [row.lessonDate, row.topic]));
  const columnRows = await db.select().from(journalColumns).where(and(
    eq(journalColumns.groupName, groupName),
    eq(journalColumns.discipline, discipline),
    gte(journalColumns.lessonDate, bounds.from),
    lte(journalColumns.lessonDate, bounds.to),
  )).orderBy(asc(journalColumns.lessonDate), asc(journalColumns.position), asc(journalColumns.id));
  const subjectRows = people.length
    ? await db.select().from(disciplines).where(and(inArray(disciplines.studentId, people.map((row) => row.id)), eq(disciplines.name, discipline)))
    : [];
  const markRows = subjectRows.length
    ? await db.select().from(marks).where(inArray(marks.disciplineId, subjectRows.map((row) => row.id)))
    : [];
  const visits = await db.select().from(attendance).where(and(eq(attendance.groupName, groupName), eq(attendance.discipline, discipline), gte(attendance.lessonDate, bounds.from), lte(attendance.lessonDate, bounds.to)));
  const cellRows = columnRows.length
    ? markRows.filter((row) => row.columnId && columnRows.some((column) => column.id === row.columnId))
    : [];
  const scheme = await readScheme(groupName, discipline);
  const thresholds = { excellent: scheme.excellent, good: scheme.good, satisfactory: scheme.satisfactory };
  const scoreColumns = await db.select().from(journalColumns).where(and(eq(journalColumns.groupName, groupName), eq(journalColumns.discipline, discipline)));
  const controlForm = subjectRows.some((row) => row.controlForm === "credit") ? "credit" : "exam";
  const averages: Record<string, { simple: number | null; weighted: number | null; count: number; percent: number | null; earned: number; possible: number; grade: string | null }> = {};
  for (const person of people) {
    const mine = markRows.filter((row) => row.studentId === person.id).flatMap((row) => {
      const column = row.columnId ? scoreColumns.find((item) => item.id === row.columnId) : undefined;
      const when = column?.lessonDate ?? row.awardedOn;
      if (when && (when < term.from || when > term.to)) return [];
      const points = row.points != null ? Number(row.points) : legacyFromMark(row.value, row.kind);
      if (points == null) return [];
      return [{ points, maxPoints: column?.maxPoints ?? 10, weight: Number(column?.weight ?? 1) }];
    });
    const total = pointsTotal(mine, thresholds);
    averages[person.id] = { simple: total.percent, weighted: total.percent, count: mine.filter((row) => row.points != null).length, percent: total.percent, earned: total.earned, possible: total.possible, grade: gradeLabel(total.percent, thresholds, controlForm) };
  }
  const semester = academicPeriod(moscowToday()).current.id;
  const students = await Promise.all(people.map(async (student) => {
    const subject = subjectRows.find((row) => row.studentId === student.id);
    const list = await loadDisciplines(student.id, semester);
    const view = analyzeSession(list.filter((row) => row.name === discipline), moscowToday())[0];
    return {
      id: student.id,
      name: student.fullName,
      short: shortName(student.fullName),
      automatic: view?.automatic ?? null,
      finalText: view?.finalText ?? null,
      marks: markRows.filter((row) => row.disciplineId === subject?.id).map((row) => ({ label: row.label, value: row.points != null ? Number(row.points) : null })),
      attendance: visits.filter((row) => row.studentId === student.id).map((row) => ({ date: row.lessonDate, present: row.present })),
    };
  }));
  return {
    groupName,
    discipline,
    studyDate: (await import("../../shared/src/dates")).nearestStudyDay(moscowToday()),
    readOnly: user.role !== "teacher",
    period: { from: bounds.from, to: bounds.to, semester, label: periodLabel(bounds.from, bounds.to) },
    workTypes: WORK_TYPES,
    lessons: lessonRows.map((row) => ({
      date: row.date,
      scheduleItemId: row.id,
      kind: row.kind,
      startsAt: row.startsAt,
      pairNumber: row.pairNumber,
      topic: topicOf.get(row.date) ?? null,
      cancelled: row.changeType === "cancelled",
    })),
    columns: columnRows.map((row) => ({
      id: row.id,
      date: row.lessonDate,
      workType: row.workType,
      short: WORK_TYPES[row.workType as WorkType]?.short ?? row.workType,
      title: row.title,
      maxScore: row.maxPoints ?? row.maxScore,
      maxPoints: row.maxPoints ?? 10,
      weight: Number(row.weight),
      scheduleItemId: row.scheduleItemId,
      position: row.position,
    })),
    students,
    cells: cellRows.map((row) => ({ markId: row.id, studentId: row.studentId, columnId: row.columnId, value: row.points != null ? Number(row.points) : legacyFromMark(row.value, row.kind), points: row.points != null ? Number(row.points) : legacyFromMark(row.value, row.kind), comment: row.comment, updatedAt: row.updatedAt })),
    scheme,
    attendance: visits.map((row) => ({ studentId: row.studentId, date: row.lessonDate, status: row.status ?? (row.present ? "present" : "absent"), comment: row.comment })),
    averages,
  };
}

function lessonHeld(row: { changeType: string; changeNote: string | null }) {
  if (row.changeType === "cancelled") return false;
  const note = (row.changeNote ?? "").toLowerCase();
  return !(row.changeType === "moved" && note.includes("перенесено на"));
}

function titlesClose(stored: string, asked: string) {
  const stem = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map((word) => word.replace(/(ую|ая|ой|ый|ий|ом|ем|а|я|у|ю|е|ы|и)$/u, ""));
  const left = stem(stored);
  const right = stem(asked);
  if (!left.length || left.length !== right.length) return false;
  return left.every((word, index) => word === right[index] || word.startsWith(right[index]) || right[index].startsWith(word));
}

async function lessonsOn(groupName: string, discipline: string, date: string) {
  return getDb().select().from(scheduleItems).where(and(eq(scheduleItems.groupName, groupName), eq(scheduleItems.discipline, discipline), eq(scheduleItems.date, date)));
}

async function lessonOn(groupName: string, discipline: string, date: string) {
  const rows = await lessonsOn(groupName, discipline, date);
  return rows.find((row) => lessonHeld(row)) ?? null;
}

const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function lessonChip(date: string) {
  return `${formatDdMm(date)} (${WEEKDAY_SHORT[weekdayIndex(date)]})`;
}

export async function nearestHeldLessons(groupName: string, discipline: string, today: string, limit = 3) {
  const rows = await getDb().select().from(scheduleItems).where(and(
    eq(scheduleItems.groupName, groupName),
    eq(scheduleItems.discipline, discipline),
    lte(scheduleItems.date, today),
  )).orderBy(asc(scheduleItems.date));
  const seen = new Set<string>();
  const held = rows.filter((row) => lessonHeld(row) && !seen.has(row.date) && seen.add(row.date));
  return held.reverse().slice(0, limit);
}

export async function heldLessonsBetween(groupName: string, discipline: string, from: string, to: string) {
  const rows = await getDb().select().from(scheduleItems).where(and(
    eq(scheduleItems.groupName, groupName),
    eq(scheduleItems.discipline, discipline),
    gte(scheduleItems.date, from),
    lte(scheduleItems.date, to),
  )).orderBy(asc(scheduleItems.date), asc(scheduleItems.startsAt));
  const seen = new Set<string>();
  return rows.filter((row) => lessonHeld(row) && !seen.has(row.date) && seen.add(row.date));
}

export async function planMark(user: PublicUser, args: Record<string, unknown>) {
  if (user.role !== "teacher") throw forbidden();
  const today = moscowToday();
  const explicitColumn = Boolean(args.columnId);
  let namedMatch = false;
  let column = args.columnId ? (await getDb().select().from(journalColumns).where(eq(journalColumns.id, Number(args.columnId))).limit(1))[0] : undefined;
  if (args.columnId && !column) throw notFound(MISS);
  const groupName = column?.groupName ?? String(args.groupName ?? "");
  const discipline = column?.discipline ?? String(args.discipline ?? "");
  if (!groupName || !discipline) throw notFound(MISS);
  await teaches(user.id, groupName, discipline);
  const student = args.studentId
    ? (await getDb().select().from(users).where(eq(users.id, Number(args.studentId))).limit(1))[0]
    : await studentIn(groupName, String(args.studentName ?? ""));
  if (!student || student.role !== "student" || student.groupName !== groupName) throw notFound(MISS);
  let date = column?.lessonDate ?? (typeof args.date === "string" ? args.date : "");
  if (!date) {
    const last = (await nearestHeldLessons(groupName, discipline, today, 1))[0];
    if (!last) throw badRequest("Прошедшей пары по этому предмету нет");
    date = last.date;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("Нужна дата");
  const term = semesterBounds(today);
  if (date < term.from || date > term.to) throw badRequest("Дата вне семестра");
  if (isFutureDay(date, today)) throw badRequest("Дату из будущего ставить нельзя");
  const workType = (column?.workType ?? args.workType ?? (args.kind === "credit" ? "credit" : "current")) as WorkType;
  if (!WORK_TYPES[workType]) throw badRequest("Неизвестный тип работы");
  let title = String(args.title ?? "");
  if (!title || title === "Текущая") title = WORK_TYPES[workType].label;
  const requested = String(args.title ?? args.label ?? "");
  const generic = !requested || requested === WORK_TYPES[workType].label || requested === "Текущая";
  if (!column && !args.forceNew && !generic) {
    const named = (await getDb().select().from(journalColumns).where(and(eq(journalColumns.groupName, groupName), eq(journalColumns.discipline, discipline)))).filter((row) => titlesClose(row.title, requested));
    if (named.length === 1) {
      column = named[0];
      namedMatch = true;
    }
    else if (named.length > 1) {
      return { choices: named.map((row) => ({ id: row.id, title: row.title, date: row.lessonDate, fresh: false })) };
    }
  }
  if (column) date = column.lessonDate;
  if (!column && !args.forceNew) {
    const same = await getDb().select().from(journalColumns).where(and(
      eq(journalColumns.groupName, groupName),
      eq(journalColumns.discipline, discipline),
      eq(journalColumns.lessonDate, date),
      eq(journalColumns.workType, workType),
    ));
    const titled = generic ? [] : same.filter((row) => titlesClose(row.title, requested));
    if (titled.length === 1) {
      column = titled[0];
      namedMatch = true;
    } else if (!generic && titled.length === 0 && same.length === 0) {
      column = undefined;
    } else if (generic && same.length === 1) {
      column = same[0];
      if (args.date && args.workType) namedMatch = true;
    }
    else if (same.length > 1 || (!generic && same.length >= 1 && titled.length !== 1)) {
      return {
        choices: [
          ...same.map((row) => ({ id: row.id, title: row.title, date: row.lessonDate, fresh: false })),
          { id: 0, title: "Новая работа", date, fresh: true },
        ],
      };
    }
  }
  if (args.forceNew) {
    column = undefined;
    const siblings = await getDb().select().from(journalColumns).where(and(
      eq(journalColumns.groupName, groupName),
      eq(journalColumns.discipline, discipline),
      eq(journalColumns.lessonDate, date),
      eq(journalColumns.workType, workType),
    ));
    const base = WORK_TYPES[workType].label;
    const taken = new Set(siblings.map((row) => row.title));
    if (!title || title === "Текущая" || title === base || taken.has(title)) {
      let n = Math.max(2, siblings.length + 1);
      let next = `${base} ${n}`;
      while (taken.has(next)) {
        n += 1;
        next = `${base} ${n}`;
      }
      title = siblings.length ? next : base;
    }
  }
  if (column) title = column.title;
  const lesson = await lessonOn(groupName, discipline, date);
  if (!lesson && !(explicitColumn || namedMatch)) {
    const options = await nearestHeldLessons(groupName, discipline, today, 3);
    return { noLesson: true as const, date, discipline, groupName, options };
  }
  const existing = column
    ? (await getDb().select().from(marks).where(and(eq(marks.studentId, student.id), eq(marks.columnId, column.id))).limit(1))[0]
    : undefined;
  const rule = (await readScheme(groupName, discipline)).defaults[workType] ?? defaultWorkRule(workType);
  return {
    groupName,
    discipline,
    student,
    date,
    workType,
    title,
    column,
    createColumn: !column,
    lesson: Boolean(lesson),
    previous: existing?.points != null ? Number(existing.points) : legacyFromMark(existing?.value ?? null, existing?.kind ?? "current"),
    previousComment: existing?.comment ?? null,
    weight: Number(column?.weight ?? args.weight ?? rule.weight),
    maxPoints: column?.maxPoints ?? (args.maxPoints != null ? Number(args.maxPoints) : args.maxScore != null ? Number(args.maxScore) : rule.maxPoints),
  };
}

async function notifyGrade(studentId: number, points: number, maxPoints: number, title: string, date: string, discipline: string, markId: number) {
  const { notifications } = await import("./db/schema");
  const body = `${formatScore(points)} из ${maxPoints}. ${title}, ${date.slice(8, 10)}.${date.slice(5, 7)}, ${discipline}`;
  const nextTitle = `Баллы: ${title}`;
  const href = `/grades?view=table&focus=${markId}`;
  const rows = await getDb().select().from(notifications).where(and(eq(notifications.userId, studentId), eq(notifications.href, href)));
  const existing = rows.sort((left, right) => right.id - left.id)[0];
  if (existing) {
    await getDb().update(notifications).set({ body, title: nextTitle, kind: "grade" }).where(eq(notifications.id, existing.id));
    return { id: existing.id, previousBody: existing.body, previousTitle: existing.title };
  }
  const [created] = await getDb().insert(notifications).values({
    userId: studentId,
    kind: "grade",
    title: nextTitle,
    body,
    href,
  }).returning({ id: notifications.id });
  return { id: created.id, previousBody: null as string | null, previousTitle: null as string | null };
}

function snapshotMark(row: typeof marks.$inferSelect) {
  return {
    id: row.id,
    disciplineId: row.disciplineId,
    studentId: row.studentId,
    columnId: row.columnId,
    points: row.points,
    value: row.value,
    teacherId: row.teacherId,
    updatedAt: row.updatedAt,
    comment: row.comment,
    label: row.label,
    kind: row.kind,
    awardedOn: row.awardedOn,
  };
}

export async function applyMark(user: PublicUser, args: Record<string, unknown>) {
  const plan = await planMark(user, args);
  if ("noLesson" in plan) throw badRequest("В этот день пары не было");
  if ("choices" in plan) throw badRequest("Несколько колонок. Выберите работу.");
  const db = getDb();
  let column = plan.column;
  let createdColumnId: number | null = null;
  if (!column) {
    const lesson = await lessonOn(plan.groupName, plan.discipline, plan.date);
    if (!lesson) throw badRequest("В этот день пары не было");
    const rule = (await readScheme(plan.groupName, plan.discipline)).defaults[plan.workType] ?? defaultWorkRule(plan.workType);
    const maxPoints = Number(args.maxPoints ?? args.maxScore ?? rule.maxPoints);
    const weight = args.weight ?? rule.weight;
    const [created] = await db.insert(journalColumns).values({
      groupName: plan.groupName,
      discipline: plan.discipline,
      lessonDate: plan.date,
      scheduleItemId: lesson?.id ?? null,
      workType: plan.workType,
      title: plan.title,
      maxScore: maxPoints,
      maxPoints,
      weight: String(weight),
      createdBy: user.id,
    }).returning();
    column = created;
    createdColumnId = created.id;
  }
  const hadSubject = (await db.select({ id: disciplines.id }).from(disciplines).where(and(eq(disciplines.studentId, plan.student.id), eq(disciplines.name, plan.discipline))).limit(1))[0];
  const subject = await ensureDiscipline(plan.student.id, plan.discipline, plan.groupName);
  const createdDisciplineId = hadSubject ? null : subject.id;
  const rawPoints = args.points != null ? Number(args.points) : args.value != null ? Number(args.value) : null;
  const maxPoints = column.maxPoints ?? 10;
  if (rawPoints != null && !validPoints(rawPoints, maxPoints)) throw badRequest(`Баллы от 0 до ${maxPoints} с шагом 0,5`);
  const comment = args.comment == null ? null : String(args.comment);
  const existing = (await db.select().from(marks).where(and(eq(marks.studentId, plan.student.id), eq(marks.columnId, column.id))).limit(1))[0];
  const kind = plan.workType === "credit" ? "credit" : "current";
  let markId = existing?.id;
  if (rawPoints == null && existing) {
    await db.delete(marks).where(eq(marks.id, existing.id));
    markId = existing.id;
  } else if (existing) {
    await db.update(marks).set({ value: null, points: rawPoints == null ? null : String(rawPoints), comment, label: column.title, kind, awardedOn: plan.date, teacherId: user.id, updatedAt: new Date().toISOString() }).where(eq(marks.id, existing.id));
  } else if (rawPoints != null) {
    const [saved] = await db.insert(marks).values({
      disciplineId: subject.id,
      studentId: plan.student.id,
      columnId: column.id,
      label: column.title,
      value: null,
      points: String(rawPoints),
      kind,
      awardedOn: plan.date,
      comment,
      teacherId: user.id,
    }).returning();
    markId = saved.id;
  }
  const previousPoints = existing?.points != null ? Number(existing.points) : legacyFromMark(existing?.value ?? null, existing?.kind ?? kind);
  const valueChanged = !existing || previousPoints !== rawPoints;
  const notice = markId && rawPoints != null && valueChanged ? await notifyGrade(plan.student.id, rawPoints, maxPoints, column.title, plan.date, plan.discipline, markId) : null;
  const shown = rawPoints == null ? "—" : `${rawPoints}/${maxPoints}`;
  const was = previousPoints == null ? "—" : String(previousPoints);
  return {
    summary: `${shortName(plan.student.fullName)}, ${plan.discipline}, ${plan.date.slice(8, 10)}.${plan.date.slice(5, 7)} «${column.title}»: ${shown} (было ${was}).`,
    markId: markId ?? 0,
    undo: {
      type: "mark_cell" as const,
      markId: markId ?? 0,
      created: !existing,
      prev: existing ? snapshotMark(existing) : null,
      notice,
      createdColumnId,
      createdDisciplineId,
    },
  };
}

export async function clearMark(user: PublicUser, markId: number) {
  if (user.role !== "teacher") throw forbidden();
  const row = (await getDb().select().from(marks).where(eq(marks.id, markId)).limit(1))[0];
  if (!row?.columnId) throw notFound(MISS);
  const column = (await getDb().select().from(journalColumns).where(eq(journalColumns.id, row.columnId)).limit(1))[0];
  if (!column) throw notFound(MISS);
  await teaches(user.id, column.groupName, column.discipline);
  await getDb().delete(marks).where(eq(marks.id, row.id));
  return {
    summary: "Оценка снята.",
    undo: { type: "mark_restore" as const, row: snapshotMark(row) },
  };
}

export async function addColumn(user: PublicUser, args: Record<string, unknown>) {
  if (user.role !== "teacher") throw forbidden();
  const groupName = String(args.groupName);
  const discipline = String(args.discipline);
  await teaches(user.id, groupName, discipline);
  const date = String(args.date);
  const workType = String(args.workType) as WorkType;
  if (!WORK_TYPES[workType]) throw badRequest("Неизвестный тип работы");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("Нужна дата");
  if (isFutureDay(date)) throw badRequest("Дату из будущего ставить нельзя");
  const term = semesterBounds(moscowToday());
  if (date < term.from || date > term.to) throw badRequest("Дата вне семестра");
  const scheme = await readScheme(groupName, discipline);
  const rule = scheme.defaults[workType] ?? defaultWorkRule(workType);
  const title = String(args.title ?? WORK_TYPES[workType].label);
  const existing = (await getDb().select().from(journalColumns).where(and(
    eq(journalColumns.groupName, groupName),
    eq(journalColumns.discipline, discipline),
    eq(journalColumns.lessonDate, date),
    eq(journalColumns.workType, workType),
    eq(journalColumns.title, title),
  )).limit(1))[0];
  if (existing) return { summary: `Колонка «${existing.title}» уже есть.`, columnId: existing.id, undo: null };
  const lesson = await lessonOn(groupName, discipline, date);
  if (!lesson) throw badRequest("В этот день пары не было");
  const [created] = await getDb().insert(journalColumns).values({
    groupName,
    discipline,
    lessonDate: date,
    scheduleItemId: lesson?.id ?? null,
    workType,
    title,
    maxScore: Number(args.maxPoints ?? args.maxScore ?? rule.maxPoints),
    maxPoints: Number(args.maxPoints ?? args.maxScore ?? rule.maxPoints),
    weight: String(args.weight ?? rule.weight),
    createdBy: user.id,
  }).returning();
  return {
    summary: `Колонка «${created.title}» добавлена.`,
    columnId: created.id,
    undo: { type: "journal_column" as const, column: { ...created, removed: true }, marks: [] },
  };
}

export async function editColumn(user: PublicUser, args: Record<string, unknown>) {
  if (user.role !== "teacher") throw forbidden();
  const column = (await getDb().select().from(journalColumns).where(eq(journalColumns.id, Number(args.columnId))).limit(1))[0];
  if (!column) throw notFound(MISS);
  await teaches(user.id, column.groupName, column.discipline);
  const maxPoints = args.maxPoints == null && args.maxScore == null ? (column.maxPoints ?? column.maxScore) : Number(args.maxPoints ?? args.maxScore);
  const highest = await getDb().select({ points: marks.points, value: marks.value, kind: marks.kind }).from(marks).where(eq(marks.columnId, column.id));
  const top = Math.max(0, ...highest.map((row) => (row.points != null ? Number(row.points) : legacyFromMark(row.value, row.kind) ?? 0)));
  if (maxPoints < top) throw badRequest(`Уже стоит ${top} баллов. Максимум нельзя сделать меньше`);
  const nextDate = args.date == null ? column.lessonDate : String(args.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDay(nextDate)) || isFutureDay(nextDate)) throw badRequest("Нужна дата не позже сегодня");
  const term = semesterBounds(moscowToday());
  if (nextDate < term.from || nextDate > term.to) throw badRequest("Дата вне семестра");
  const next = {
    title: args.title == null ? column.title : String(args.title),
    workType: args.workType == null ? column.workType : String(args.workType),
    maxScore: maxPoints,
    maxPoints,
    weight: args.weight == null ? column.weight : String(args.weight),
    lessonDate: nextDate,
  };
  await getDb().update(journalColumns).set(next).where(eq(journalColumns.id, column.id));
  return {
    summary: "Колонка обновлена.",
    undo: { type: "journal_column" as const, column: { ...column, restore: true }, marks: [] },
  };
}

export async function deleteColumn(user: PublicUser, columnId: number) {
  if (user.role !== "teacher") throw forbidden();
  const column = (await getDb().select().from(journalColumns).where(eq(journalColumns.id, columnId)).limit(1))[0];
  if (!column) throw notFound(MISS);
  await teaches(user.id, column.groupName, column.discipline);
  const rows = await getDb().select().from(marks).where(eq(marks.columnId, columnId));
  await getDb().delete(marks).where(eq(marks.columnId, columnId));
  await getDb().delete(journalColumns).where(eq(journalColumns.id, columnId));
  return {
    summary: rows.length ? `Удалит ${rows.length} оценок.` : "Колонка удалена.",
    undo: { type: "journal_column" as const, column, marks: rows },
  };
}

export async function setTopic(user: PublicUser, groupName: string, discipline: string, date: string, topic: string) {
  if (user.role !== "teacher") throw forbidden();
  await teaches(user.id, groupName, discipline);
  const existing = (await getDb().select().from(lessonTopics).where(and(eq(lessonTopics.groupName, groupName), eq(lessonTopics.discipline, discipline), eq(lessonTopics.lessonDate, date))).limit(1))[0];
  const lesson = await lessonOn(groupName, discipline, date);
  if (existing) await getDb().update(lessonTopics).set({ topic, teacherId: user.id, updatedAt: new Date().toISOString() }).where(eq(lessonTopics.id, existing.id));
  else await getDb().insert(lessonTopics).values({ groupName, discipline, lessonDate: date, topic, teacherId: user.id, scheduleItemId: lesson?.id ?? null });
  return { summary: "Тема пары сохранена.", undo: { type: "topic" as const, groupName, discipline, date, topic: existing?.topic ?? null } };
}

const STATUS_PRESENT: Record<string, boolean> = { present: true, absent: false, sick: false, late: false, excused: false };

export async function setAttendanceStatus(user: PublicUser, groupName: string, discipline: string, date: string, studentName: string, present: boolean, status?: string) {
  if (user.role !== "teacher") throw forbidden();
  await teaches(user.id, groupName, discipline);
  if (isFutureDay(date)) throw badRequest("Дату из будущего ставить нельзя");
  if (!(await lessonOn(groupName, discipline, date))) throw badRequest("В этот день пары не было");
  const student = await studentIn(groupName, studentName);
  const nextStatus = (status ?? (present ? "present" : "absent")) as AttendanceStatus;
  if (!(nextStatus in ATTENDANCE)) throw badRequest("Неизвестный статус явки");
  const nextPresent = STATUS_PRESENT[nextStatus] ?? present;
  const existing = (await getDb().select().from(attendance).where(and(eq(attendance.studentId, student.id), eq(attendance.discipline, discipline), eq(attendance.lessonDate, date))).limit(1))[0];
  if (existing) await getDb().update(attendance).set({ present: nextPresent, status: nextStatus, teacherId: user.id }).where(eq(attendance.id, existing.id));
  else await getDb().insert(attendance).values({ teacherId: user.id, studentId: student.id, groupName, discipline, lessonDate: date, present: nextPresent, status: nextStatus });
  const letter = ATTENDANCE[nextStatus];
  return {
    summary: `${student.fullName} ${letter || "был"} ${date.slice(8, 10)}.${date.slice(5, 7)}.`,
    undo: {
      type: "attendance" as const,
      studentId: student.id,
      groupName,
      discipline,
      date,
      present: existing ? existing.present : null,
      status: existing?.status ?? null,
    },
  };
}

export function schemeDefaults() {
  return Object.fromEntries(WORK_TYPE_KEYS.map((type) => [type, defaultWorkRule(type)]));
}

export async function readScheme(groupName: string, discipline: string) {
  const row = (await getDb().select().from(gradingSchemes).where(and(eq(gradingSchemes.groupName, groupName), eq(gradingSchemes.discipline, discipline))).limit(1))[0];
  return {
    defaults: { ...schemeDefaults(), ...(row?.defaults ?? {}) },
    excellent: Number(row?.excellent ?? DEFAULT_THRESHOLDS.excellent),
    good: Number(row?.good ?? DEFAULT_THRESHOLDS.good),
    satisfactory: Number(row?.satisfactory ?? DEFAULT_THRESHOLDS.satisfactory),
  };
}

export async function saveScheme(user: PublicUser, args: Record<string, unknown>) {
  if (user.role !== "teacher") throw forbidden();
  const groupName = String(args.groupName ?? "");
  const discipline = String(args.discipline ?? "");
  if (!groupName || !discipline) throw notFound(MISS);
  await teaches(user.id, groupName, discipline);
  const current = await readScheme(groupName, discipline);
  const defaults = { ...current.defaults };
  if (args.workType) {
    const type = String(args.workType) as WorkType;
    if (!WORK_TYPES[type]) throw badRequest("Неизвестный тип работы");
    defaults[type] = {
      maxPoints: args.maxPoints == null ? defaults[type]?.maxPoints ?? 10 : Number(args.maxPoints),
      weight: args.weight == null ? defaults[type]?.weight ?? 1 : Number(args.weight),
    };
  }
  const next = {
    defaults,
    excellent: args.excellent == null ? current.excellent : Number(args.excellent),
    good: args.good == null ? current.good : Number(args.good),
    satisfactory: args.satisfactory == null ? current.satisfactory : Number(args.satisfactory),
  };
  if (!(next.excellent > next.good && next.good > next.satisfactory && next.satisfactory >= 0)) throw badRequest("Пороги должны убывать: отлично, хорошо, удовлетворительно");
  if (args.workType && args.maxPoints != null) {
    const type = String(args.workType);
    const previous = current.defaults[type as WorkType]?.maxPoints ?? 10;
    const nextMax = Number(args.maxPoints);
    if (nextMax < previous) {
      const cols = await getDb().select().from(journalColumns).where(and(eq(journalColumns.groupName, groupName), eq(journalColumns.discipline, discipline), eq(journalColumns.workType, type), eq(journalColumns.maxPoints, previous)));
      const ids = cols.map((column) => column.id);
      const scored = ids.length ? await getDb().select({ points: marks.points }).from(marks).where(inArray(marks.columnId, ids)) : [];
      const top = Math.max(0, ...scored.map((row) => Number(row.points ?? 0)));
      if (top > nextMax) throw badRequest(`В колонках с этим максимумом уже стоит ${top} баллов. Максимум нельзя сделать меньше`);
    }
  }
  const existing = (await getDb().select().from(gradingSchemes).where(and(eq(gradingSchemes.groupName, groupName), eq(gradingSchemes.discipline, discipline))).limit(1))[0];
  if (existing) {
    await getDb().update(gradingSchemes).set({ defaults: next.defaults, excellent: String(next.excellent), good: String(next.good), satisfactory: String(next.satisfactory), updatedBy: user.id, updatedAt: new Date().toISOString() }).where(eq(gradingSchemes.id, existing.id));
  } else {
    await getDb().insert(gradingSchemes).values({ groupName, discipline, defaults: next.defaults, excellent: String(next.excellent), good: String(next.good), satisfactory: String(next.satisfactory), updatedBy: user.id });
  }
  return {
    summary: args.workType ? `Для «${WORK_TYPES[String(args.workType) as WorkType].label}» сохранены баллы и вес.` : "Система оценивания сохранена.",
    undo: { type: "grading" as const, groupName, discipline, previous: existing ? { defaults: existing.defaults, excellent: Number(existing.excellent), good: Number(existing.good), satisfactory: Number(existing.satisfactory) } : null },
  };
}

export async function studentTable(user: PublicUser, from?: string, to?: string, semester?: string) {
  if (user.role !== "student") throw forbidden();
  const bounds = from && to ? { from, to } : semesterBounds();
  checkRange(bounds.from, bounds.to);
  const final = countsAsSemester(bounds);
  const term = academicPeriod(moscowToday());
  const active = semester || term.current.id;
  const list = await loadDisciplines(user.id, active);
  const teachers = user.groupName
    ? await getDb().select({ discipline: teachingLoad.discipline, name: users.fullName }).from(teachingLoad).innerJoin(users, eq(users.id, teachingLoad.teacherId)).where(eq(teachingLoad.groupName, user.groupName))
    : [];
  const rows = [];
  const dates = new Set<string>();
  for (const discipline of list) {
    const cells = discipline.marks
      .filter((mark) => (mark.awardedOn ? mark.awardedOn >= bounds.from && mark.awardedOn <= bounds.to : final))
      .map((mark) => {
        if (mark.awardedOn) dates.add(mark.awardedOn);
        return {
          date: mark.awardedOn,
          markId: mark.id,
          value: mark.points ?? null,
          points: mark.points ?? null,
          short: mark.label.slice(0, 4),
          title: mark.label,
          workType: "current",
          weight: mark.weight ?? 1,
          maxScore: mark.maxPoints ?? 10,
          maxPoints: mark.maxPoints ?? 10,
          comment: null as string | null,
          teacher: null as string | null,
        };
      });
    const columnIds = cells.map((cell) => cell.markId);
    if (columnIds.length) {
      const stored = await getDb().select().from(marks).where(inArray(marks.id, columnIds));
      for (const cell of cells) {
        const row = stored.find((item) => item.id === cell.markId);
        const column = row?.columnId ? (await getDb().select().from(journalColumns).where(eq(journalColumns.id, row.columnId)).limit(1))[0] : undefined;
        if (row) cell.points = row.points != null ? Number(row.points) : legacyFromMark(row.value, row.kind);
        if (column) {
          cell.workType = column.workType;
          cell.short = WORK_TYPES[column.workType as WorkType]?.short ?? cell.short;
          cell.title = column.title;
          cell.weight = Number(column.weight);
          cell.maxPoints = column.maxPoints ?? 10;
          cell.maxScore = cell.maxPoints;
        }
        cell.value = cell.points;
        cell.comment = row?.comment ?? null;
        cell.teacher = teachers.find((item) => item.discipline === discipline.name)?.name ?? cell.teacher;
      }
    }
    const teacherName = teachers.find((item) => item.discipline === discipline.name)?.name ?? null;
    for (const cell of cells) if (!cell.teacher) cell.teacher = teacherName;
    const view = analyzeSession([discipline], moscowToday())[0];
    const thresholds = discipline.thresholds ?? { excellent: 85, good: 70, satisfactory: 55 };
    const total = pointsTotal(cells.map((cell) => ({ points: cell.points, maxPoints: cell.maxPoints, weight: cell.weight })), thresholds);
    rows.push({
      discipline: discipline.name,
      controlForm: discipline.controlForm,
      average: total.percent,
      weighted: total.percent,
      percent: total.percent,
      earned: total.earned,
      possible: total.possible,
      grade: final ? gradeLabel(total.percent, thresholds, discipline.controlForm) : null,
      automatic: view?.automatic ?? null,
      finalText: view?.finalText ?? null,
      cells,
    });
  }
  if (user.groupName) {
    const lessons = await getDb().select({ date: scheduleItems.date }).from(scheduleItems).where(and(
      eq(scheduleItems.groupName, user.groupName),
      gte(scheduleItems.date, bounds.from),
      lte(scheduleItems.date, bounds.to),
    ));
    for (const lesson of lessons) dates.add(lesson.date);
  }
  return {
    period: { from: bounds.from, to: bounds.to, semester: active, label: periodLabel(bounds.from, bounds.to), final },
    rows,
    dates: [...dates].sort(),
  };
}
