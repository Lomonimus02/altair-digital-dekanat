import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { addDays, formatRuDate, moscowNow, moscowToday, nearestStudyDay } from "../../shared/src/dates";
import type { PublicUser } from "../../shared/src/domain";
import { defaultWorkRule, formatScore, validPoints, type WorkType } from "../../shared/src/journal";
import { matchDiscipline } from "../../shared/src/parser";
import { samePerson, toDative } from "../../shared/src/names";
import { getDb } from "./db/client";
import { assignments, attendance, disciplines, groupAnnouncements, journalColumns, marks, notifications, scheduleItems, submissions, teachingLoad, users } from "./db/schema";
import { publish } from "./hub";
import { badRequest, forbidden, notFound } from "./httpError";
import { ensureDiscipline, readScheme } from "./journal";

export const HOMEWORK_KINDS = ["essay", "problem_set", "lab", "reading", "project"] as const;
export type HomeworkKind = (typeof HOMEWORK_KINDS)[number];
export const KIND_LABEL: Record<HomeworkKind, string> = {
  essay: "Эссе",
  problem_set: "Задачник",
  lab: "Лабораторная",
  reading: "Чтение",
  project: "Проект",
};

export const SUBMISSION_STATUSES = ["not_started", "in_progress", "submitted", "in_review", "returned", "graded"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const SUBMISSION_LABEL: Record<SubmissionStatus, string> = {
  not_started: "Не начато",
  in_progress: "В работе",
  submitted: "Сдано",
  in_review: "На проверке",
  returned: "Возвращено на доработку",
  graded: "Оценено",
};

type Link = { title: string; href: string };

async function notify(userId: number, kind: string, title: string, body: string, href: string) {
  const { notifications } = await import("./db/schema");
  await getDb().insert(notifications).values({ userId, kind, title, body, href });
  publish(userId, { type: "notifications" });
}

export async function loadForTeacher(teacherId: number) {
  return getDb().select().from(teachingLoad).where(eq(teachingLoad.teacherId, teacherId)).orderBy(asc(teachingLoad.groupName), asc(teachingLoad.discipline));
}

export async function assertTeaches(teacherId: number, groupName: string, discipline: string) {
  const rows = await getDb()
    .select()
    .from(teachingLoad)
    .where(and(eq(teachingLoad.teacherId, teacherId), eq(teachingLoad.groupName, groupName), eq(teachingLoad.discipline, discipline)))
    .limit(1);
  if (!rows[0]) throw notFound("Группа или предмет не найдены");
  return rows[0];
}

async function studentsOf(groupName: string) {
  return getDb().select().from(users).where(and(eq(users.role, "student"), eq(users.groupName, groupName))).orderBy(asc(users.fullName));
}

async function studentInGroup(groupName: string, studentName: string) {
  const list = await studentsOf(groupName);
  const found = list.filter((row) => samePerson(studentName, row.fullName));
  if (found.length !== 1) throw notFound("Студент не найден");
  return found[0];
}

function presentSubmission(row: typeof submissions.$inferSelect | undefined) {
  const status = (row?.status ?? "not_started") as SubmissionStatus;
  return {
    status,
    statusLabel: SUBMISSION_LABEL[status] ?? status,
    body: row?.body ?? "",
    links: row?.links ?? [],
    teacherComment: row?.teacherComment ?? null,
    score: row?.score == null ? null : Number(row.score),
  };
}

export async function listStudentHomework(user: PublicUser) {
  if (user.role !== "student" || !user.groupName) throw forbidden();
  const rows = await getDb().select().from(assignments).where(eq(assignments.groupName, user.groupName)).orderBy(asc(assignments.deadline));
  const ids = rows.map((row) => row.id);
  const mine = ids.length
    ? await getDb().select().from(submissions).where(and(eq(submissions.studentId, user.id), inArray(submissions.assignmentId, ids)))
    : [];
  const byAssignment = new Map(mine.map((row) => [row.assignmentId, row]));
  const teachers = rows.length
    ? await getDb().select().from(users).where(inArray(users.id, [...new Set(rows.map((row) => row.teacherId))]))
    : [];
  const teacherName = new Map(teachers.map((row) => [row.id, row.fullName]));
  const lessons = rows.flatMap((row) => (row.scheduleItemId ? [row.scheduleItemId] : []));
  const lessonRows = lessons.length ? await getDb().select().from(scheduleItems).where(inArray(scheduleItems.id, lessons)) : [];
  const lessonById = new Map(lessonRows.map((row) => [row.id, row]));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    discipline: row.discipline,
    teacherName: teacherName.get(row.teacherId) ?? "Преподаватель",
    kind: row.kind,
    kindLabel: KIND_LABEL[row.kind as HomeworkKind] ?? row.kind,
    description: row.description,
    deadline: row.deadline,
    issuedOn: row.issuedOn,
    maxScore: row.maxScore,
    attachments: row.attachments,
    lesson: row.scheduleItemId && lessonById.get(row.scheduleItemId)
      ? { date: lessonById.get(row.scheduleItemId)!.date, startsAt: lessonById.get(row.scheduleItemId)!.startsAt }
      : null,
    submission: presentSubmission(byAssignment.get(row.id)),
  }));
}

export async function getStudentHomework(user: PublicUser, id: number) {
  const list = await listStudentHomework(user);
  const found = list.find((row) => row.id === id);
  if (!found) throw notFound("Задание не найдено");
  return found;
}

export async function saveStudentWork(user: PublicUser, assignmentId: number, body: string, links: Link[], submit: boolean) {
  const assignment = await getStudentHomework(user, assignmentId);
  if (assignment.submission.status === "graded") throw notFound("Работа уже оценена");
  const status: SubmissionStatus = submit ? "in_review" : assignment.submission.status === "returned" ? "in_progress" : "in_progress";
  const now = new Date().toISOString();
  const existing = await getDb()
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, user.id)))
    .limit(1);
  if (existing[0]) {
    await getDb()
      .update(submissions)
      .set({ status: submit ? "in_review" : status, body, links, updatedAt: now })
      .where(eq(submissions.id, existing[0].id));
  } else {
    await getDb().insert(submissions).values({
      assignmentId,
      studentId: user.id,
      status: submit ? "in_review" : "in_progress",
      body,
      links,
      updatedAt: now,
    });
  }
  if (submit) {
    const teachers = await getDb().select().from(teachingLoad).where(and(eq(teachingLoad.groupName, user.groupName!), eq(teachingLoad.discipline, assignment.discipline)));
    for (const row of teachers) {
      await notify(row.teacherId, "homework", `На проверке: ${assignment.title}`, `${user.fullName} сдал работу.`, `/teach/homework/${assignmentId}`);
    }
  }
  return submit ? `Работа «${assignment.title}» отправлена на проверку.` : `Черновик «${assignment.title}» сохранён.`;
}

export async function teacherHome(user: PublicUser) {
  if (user.role !== "teacher") throw forbidden();
  const load = await loadForTeacher(user.id);
  const today = moscowToday();
  const groups = [...new Set(load.map((row) => row.groupName))];
  const lessons = groups.length
    ? await getDb().select().from(scheduleItems).where(and(eq(scheduleItems.date, today), inArray(scheduleItems.groupName, groups)))
    : [];
  let mine = lessons.filter((lesson) => load.some((row) => row.groupName === lesson.groupName && row.discipline === lesson.discipline));
  let lessonDay = today;
  if (!mine.length && groups.length) {
    for (let shift = 1; shift <= 10 && !mine.length; shift += 1) {
      const date = addDays(today, shift);
      const upcoming = await getDb().select().from(scheduleItems).where(and(eq(scheduleItems.date, date), inArray(scheduleItems.groupName, groups)));
      mine = upcoming.filter((lesson) => load.some((row) => row.groupName === lesson.groupName && row.discipline === lesson.discipline));
      lessonDay = date;
    }
  }
  const queue = await teacherQueue(user);
  const review = queue.filter((row) => row.submission.status === "in_review");
  return {
    groups: load,
    lessonDay,
    review: review.slice(0, 3).map((row) => ({ assignmentId: row.assignmentId, title: row.title, kind: row.kind, studentName: row.studentName, groupName: row.groupName })),
    lessons: mine.map((lesson) => ({
      id: lesson.id,
      groupName: lesson.groupName,
      discipline: lesson.discipline,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      kind: lesson.kind,
      room: lesson.room,
    })),
    pending: queue.filter((row) => row.submission.status === "in_review").length,
  };
}

export async function teacherQueue(user: PublicUser) {
  if (user.role !== "teacher") throw forbidden();
  const load = await loadForTeacher(user.id);
  if (!load.length) return [];
  const rows = await getDb().select().from(assignments).where(eq(assignments.teacherId, user.id)).orderBy(asc(assignments.deadline));
  const allowed = rows.filter((row) => load.some((item) => item.groupName === row.groupName && item.discipline === row.discipline));
  const ids = allowed.map((row) => row.id);
  const subs = ids.length ? await getDb().select().from(submissions).where(inArray(submissions.assignmentId, ids)) : [];
  const studentIds = [...new Set(subs.map((row) => row.studentId))];
  const people = studentIds.length ? await getDb().select().from(users).where(inArray(users.id, studentIds)) : [];
  const byStudent = new Map(people.map((row) => [row.id, row]));
  const rank: Record<string, number> = { in_review: 0, returned: 1, submitted: 2, in_progress: 3, not_started: 4, graded: 5 };
  const items = subs
    .map((sub) => {
      const assignment = allowed.find((row) => row.id === sub.assignmentId);
      const student = byStudent.get(sub.studentId);
      if (!assignment || !student) return null;
      return {
        assignmentId: assignment.id,
        title: assignment.title,
        kind: assignment.kind,
        discipline: assignment.discipline,
        groupName: assignment.groupName,
        deadline: assignment.deadline,
        maxScore: assignment.maxScore,
        studentName: student.fullName,
        submission: presentSubmission(sub),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  items.sort((a, b) => (rank[a.submission.status] ?? 9) - (rank[b.submission.status] ?? 9));
  return items;
}

export async function getTeacherAssignment(user: PublicUser, id: number) {
  if (user.role !== "teacher") throw forbidden();
  const rows = await getDb().select().from(assignments).where(eq(assignments.id, id)).limit(1);
  const assignment = rows[0];
  if (!assignment || assignment.teacherId !== user.id) throw notFound("Задание не найдено");
  await assertTeaches(user.id, assignment.groupName, assignment.discipline);
  const linked = assignment.columnId
    ? (await getDb().select().from(journalColumns).where(eq(journalColumns.id, assignment.columnId)).limit(1))[0]
    : (await getDb().select().from(journalColumns).where(and(eq(journalColumns.groupName, assignment.groupName), eq(journalColumns.discipline, assignment.discipline), eq(journalColumns.title, assignment.title))).limit(1))[0];
  const subs = await getDb().select().from(submissions).where(eq(submissions.assignmentId, id));
  const people = await studentsOf(assignment.groupName);
  return {
    id: assignment.id,
    title: assignment.title,
    description: assignment.description,
    discipline: assignment.discipline,
    groupName: assignment.groupName,
    deadline: assignment.deadline,
    kind: assignment.kind,
    kindLabel: KIND_LABEL[assignment.kind as HomeworkKind] ?? assignment.kind,
    maxScore: assignment.maxScore,
    maxPoints: linked?.maxPoints ?? Math.max(assignment.maxScore, 10),
    columnId: linked?.id ?? null,
    students: people.map((student) => ({
      name: student.fullName,
      submission: presentSubmission(subs.find((row) => row.studentId === student.id)),
    })),
  };
}

export async function issueAssignment(
  user: PublicUser,
  input: { groupName: string; discipline: string; title: string; description: string; kind: HomeworkKind; deadline: string; scheduleItemId?: number },
) {
  if (user.role !== "teacher") throw forbidden();
  await assertTeaches(user.id, input.groupName, input.discipline);
  if (input.scheduleItemId) {
    const lesson = await getDb().select().from(scheduleItems).where(eq(scheduleItems.id, input.scheduleItemId)).limit(1);
    const row = lesson[0];
    if (!row || row.groupName !== input.groupName || row.discipline !== input.discipline) throw notFound("Занятие не найдено");
  }
  const [created] = await getDb()
    .insert(assignments)
    .values({
      groupName: input.groupName,
      discipline: input.discipline,
      teacherId: user.id,
      title: input.title,
      description: input.description,
      kind: input.kind,
      deadline: input.deadline,
      issuedOn: moscowToday(),
      scheduleItemId: input.scheduleItemId ?? null,
      attachments: [],
    })
    .returning();
  for (const student of await studentsOf(input.groupName)) {
    await notify(student.id, "homework", `Новое задание: ${created.title}`, `Сдать до ${formatRuDate(created.deadline)}.`, `/homework/${created.id}`);
  }
  return { summary: `Задание «${created.title}» выдано группе ${input.groupName}.`, id: created.id };
}

async function submissionFor(user: PublicUser, assignmentId: number, studentName: string) {
  const detail = await getTeacherAssignment(user, assignmentId);
  const student = await studentInGroup(detail.groupName, studentName);
  const rows = await getDb()
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, student.id)))
    .limit(1);
  return { detail, student, submission: rows[0] };
}

export async function returnSubmission(user: PublicUser, assignmentId: number, studentName: string, comment: string) {
  const { detail, student, submission } = await submissionFor(user, assignmentId, studentName);
  if (!submission) throw notFound("Работа не найдена");
  await getDb()
    .update(submissions)
    .set({ status: "returned", teacherComment: comment, updatedAt: new Date().toISOString() })
    .where(eq(submissions.id, submission.id));
  await notify(student.id, "homework", `Вернули на доработку: ${detail.title}`, comment, `/homework/${assignmentId}`);
  return {
    summary: `«${detail.title}» возвращена ${toDative(student.fullName)} на доработку.`,
    undo: {
      type: "submission" as const,
      submissionId: submission.id,
      previousStatus: submission.status,
      previousScore: submission.score == null ? null : Number(submission.score),
      previousComment: submission.teacherComment,
      markId: null,
    },
  };
}

const KIND_WORK: Record<string, WorkType> = {
  lab: "lab",
  essay: "essay",
  project: "project",
  problem_set: "homework",
  reading: "homework",
};

export async function gradeSubmission(user: PublicUser, assignmentId: number, studentName: string, score: number, comment?: string) {
  const { detail, student, submission } = await submissionFor(user, assignmentId, studentName);
  const maxPoints = detail.maxPoints ?? Math.max(detail.maxScore, 10);
  if (!validPoints(score, maxPoints)) throw badRequest(`Баллы от 0 до ${maxPoints} с шагом 0,5`);
  const subject = await ensureDiscipline(student.id, detail.discipline, detail.groupName);
  const scheme = await readScheme(detail.groupName, detail.discipline);
  const workType = KIND_WORK[detail.kind] ?? "homework";
  const rule = scheme.defaults[workType] ?? defaultWorkRule(workType);
  const now = new Date().toISOString();
  const today = moscowToday();
  const previous = submission
    ? { id: submission.id, status: submission.status, score: submission.score == null ? null : Number(submission.score), comment: submission.teacherComment }
    : null;
  const href = `/homework/${assignmentId}`;
  const noticeTitle = `Баллы: ${detail.title}`;
  const noticeBody = `${formatScore(score)} из ${maxPoints}`;
  const saved = await getDb().transaction(async (tx) => {
    const [assignmentRow] = await tx.select({ columnId: assignments.columnId }).from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
    const previousColumnId = assignmentRow?.columnId ?? null;
    let submissionId = previous?.id ?? 0;
    if (submission) {
      await tx.update(submissions).set({ status: "graded", score: String(score), teacherComment: comment ?? submission.teacherComment, updatedAt: now }).where(eq(submissions.id, submission.id));
    } else {
      const [createdSubmission] = await tx.insert(submissions).values({
        assignmentId,
        studentId: student.id,
        status: "graded",
        score: String(score),
        teacherComment: comment ?? null,
        links: [],
        updatedAt: now,
      }).returning({ id: submissions.id });
      submissionId = createdSubmission.id;
    }
    let column = detail.columnId
      ? (await tx.select().from(journalColumns).where(eq(journalColumns.id, detail.columnId)).limit(1))[0]
      : undefined;
    if (!column) {
      column = (await tx.select().from(journalColumns).where(and(
        eq(journalColumns.groupName, detail.groupName),
        eq(journalColumns.discipline, detail.discipline),
        eq(journalColumns.title, detail.title),
      )).limit(1))[0];
    }
    let createdColumnId: number | null = null;
    if (!column) {
      const [createdColumn] = await tx.insert(journalColumns).values({
        groupName: detail.groupName,
        discipline: detail.discipline,
        lessonDate: today,
        workType,
        title: detail.title,
        maxScore: maxPoints,
        maxPoints,
        weight: String(rule.weight),
        createdBy: user.id,
      }).returning();
      column = createdColumn;
      createdColumnId = createdColumn.id;
    }
    await tx.update(assignments).set({ columnId: column.id }).where(eq(assignments.id, assignmentId));
    const existingMark = (await tx.select().from(marks).where(and(eq(marks.studentId, student.id), eq(marks.columnId, column.id))).limit(1))[0];
    let markId = existingMark?.id ?? 0;
    const markCreated = !existingMark;
    const previousPoints = existingMark?.points == null ? null : Number(existingMark.points);
    const previousMark = existingMark
      ? {
          value: existingMark.value,
          points: previousPoints,
          comment: existingMark.comment,
          label: existingMark.label,
          kind: existingMark.kind,
          awardedOn: existingMark.awardedOn,
          teacherId: existingMark.teacherId,
          columnId: existingMark.columnId,
        }
      : null;
    if (existingMark) {
      await tx.update(marks).set({
        points: String(score),
        value: null,
        label: column.title,
        awardedOn: today,
        teacherId: user.id,
        comment: comment ?? existingMark.comment,
        updatedAt: now,
      }).where(eq(marks.id, existingMark.id));
    } else {
      const [mark] = await tx.insert(marks).values({
        disciplineId: subject.id,
        studentId: student.id,
        label: column.title,
        value: null,
        points: String(score),
        columnId: column.id,
        kind: "current",
        awardedOn: today,
        teacherId: user.id,
        comment: comment ?? null,
      }).returning({ id: marks.id });
      markId = mark.id;
    }
    const existingNotice = (await tx.select().from(notifications).where(and(
      eq(notifications.userId, student.id),
      eq(notifications.href, href),
      eq(notifications.kind, "grade"),
    )).orderBy(desc(notifications.id)).limit(1))[0];
    let noticeId = existingNotice?.id ?? 0;
    const noticeCreated = !existingNotice;
    const previousNotice = existingNotice ? { title: existingNotice.title, body: existingNotice.body, kind: existingNotice.kind } : null;
    if (existingNotice) {
      await tx.update(notifications).set({ title: noticeTitle, body: noticeBody, kind: "grade" }).where(eq(notifications.id, existingNotice.id));
    } else {
      const [createdNotice] = await tx.insert(notifications).values({
        userId: student.id,
        kind: "grade",
        title: noticeTitle,
        body: noticeBody,
        href,
      }).returning({ id: notifications.id });
      noticeId = createdNotice.id;
    }
    return { submissionId, markId, markCreated, previousPoints, previousMark, noticeId, noticeCreated, previousNotice, createdColumnId, previousColumnId };
  });
  publish(student.id, { type: "notifications" });
  return {
    summary: `${student.fullName}, ${detail.groupName}, ${detail.discipline}: «${detail.title}» — ${noticeBody}.`,
    undo: {
      type: "submission" as const,
      submissionId: saved.submissionId,
      previousStatus: previous?.status ?? "not_started",
      previousScore: previous?.score ?? null,
      previousComment: previous?.comment ?? null,
      markId: saved.markId,
      markCreated: saved.markCreated,
      previousPoints: saved.previousPoints,
      noticeId: saved.noticeId,
      noticeCreated: saved.noticeCreated,
      previousNotice: saved.previousNotice,
      createdColumnId: saved.createdColumnId,
      assignmentId,
      previousColumnId: saved.previousColumnId,
      previousMark: saved.previousMark,
    },
  };
}

export async function journal(user: PublicUser, groupName: string, discipline: string) {
  if (user.role !== "teacher") throw forbidden();
  await assertTeaches(user.id, groupName, discipline);
  const people = await studentsOf(groupName);
  const subjectRows = people.length
    ? await getDb()
        .select()
        .from(disciplines)
        .where(and(inArray(disciplines.studentId, people.map((row) => row.id)), eq(disciplines.name, discipline)))
    : [];
  const markRows = subjectRows.length
    ? await getDb().select().from(marks).where(inArray(marks.disciplineId, subjectRows.map((row) => row.id)))
    : [];
  const visits = await getDb()
    .select()
    .from(attendance)
    .where(and(eq(attendance.groupName, groupName), eq(attendance.discipline, discipline)));
  return {
    groupName,
    discipline,
    studyDate: nearestStudyDay(moscowToday()),
    students: people.map((student) => {
      const subject = subjectRows.find((row) => row.studentId === student.id);
      return {
        name: student.fullName,
        marks: markRows.filter((row) => row.disciplineId === subject?.id).map((row) => ({ label: row.label, value: row.points != null ? Number(row.points) : null })),
        attendance: visits.filter((row) => row.studentId === student.id).map((row) => ({ date: row.lessonDate, present: row.present })),
      };
    }),
  };
}

function subjectHit(query: string, discipline: string, names: string[]) {
  const found = matchDiscipline(query, names.length ? names : [discipline]);
  if (found && found === discipline) return true;
  const q = query.toLowerCase().replace(/ё/g, "е");
  const d = discipline.toLowerCase().replace(/ё/g, "е");
  return d.includes(q) || q.includes(d.slice(0, 5));
}

function stems(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/).filter((word) => word.length >= 4).map((word) => word.slice(0, 6));
}

function compactTitle(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[«»"'`]/g, "").replace(/\s+/g, " ").trim();
}

function distinctiveTokens(value: string) {
  return stems(value).filter((token) => !/^(сдайте|сдай|сдати|лабора|задани|домашк|конспе|проект|чтени|работ|эссе|текст|комме|напиш|групп|предмет)$/.test(token));
}

export function titleHit(query: string, title: string, id: number) {
  const q = compactTitle(query);
  const t = compactTitle(title);
  if (q === t || (t.length >= 8 && q.includes(t))) return true;
  if (q.includes(String(id)) && /№|#|\b\d+\b/.test(query)) return true;
  const left = distinctiveTokens(query);
  if (!left.length) return false;
  const right = stems(title);
  return left.every((token) => right.some((word) => word.startsWith(token) || token.startsWith(word)));
}

export function selectAssignments<T extends { id: number; title: string; discipline: string; kind: string }>(subject: string, rows: T[]): T[] {
  const q = subject.toLowerCase().replace(/ё/g, "е");
  const names = [...new Set(rows.map((row) => row.discipline))];
  const titled = rows.filter((row) => titleHit(subject, row.title, row.id));
  if (titled.length) {
    const exact = titled.filter((row) => {
      const title = compactTitle(row.title);
      const query = compactTitle(subject);
      return query === title || (title.length >= 8 && query.includes(title));
    });
    return exact.length ? exact : titled;
  }
  if (q.includes("лаб") && distinctiveTokens(subject).length === 0) return rows.filter((row) => row.kind === "lab");
  return rows.filter((row) => subjectHit(subject, row.discipline, names) || row.title.toLowerCase().includes(q));
}

export async function resolveStudentAssignment(user: PublicUser, subject: string) {
  const rows = await listStudentHomework(user);
  const matches = selectAssignments(subject, rows);
  const submittable = matches.filter((row) => ["not_started", "in_progress", "returned"].includes(row.submission.status));
  if (!submittable.length) {
    const reviewing = matches.some((row) => row.submission.status === "in_review" || row.submission.status === "submitted");
    return { options: [], note: reviewing ? "Эта работа уже на проверке." : "Такого задания нет." };
  }
  if (submittable.length === 1) return { id: submittable[0].id, title: submittable[0].title, discipline: submittable[0].discipline };
  return {
    options: submittable.map((row) => ({ id: row.id, title: row.title, discipline: row.discipline, statusLabel: row.submission.statusLabel, deadline: row.deadline })),
  };
}

export async function resolveTeacherSubmission(user: PublicUser, studentName: string, query: string) {
  const queue = await teacherQueue(user);
  let rows = queue.filter((row) => samePerson(studentName, row.studentName));
  const q = query.toLowerCase().replace(/ё/g, "е");
  if (/лаб/.test(q)) rows = rows.filter((row) => row.title.toLowerCase().includes("лаборатор") || row.kind === "lab");
  else if (q) {
    const names = [...new Set(rows.map((row) => row.discipline))];
    rows = rows.filter((row) => subjectHit(query, row.discipline, names) || row.title.toLowerCase().includes(q));
  }
  const actionable = rows.filter((row) => ["in_review", "submitted", "returned"].includes(row.submission.status));
  const pool = actionable.length ? actionable : rows.filter((row) => row.submission.status !== "graded");
  if (pool.length === 1) {
    const hit = pool[0];
    return { assignmentId: hit.assignmentId, studentName: hit.studentName, title: hit.title, groupName: hit.groupName, discipline: hit.discipline };
  }
  return {
    options: pool.map((row) => ({ assignmentId: row.assignmentId, studentName: row.studentName, title: row.title, groupName: row.groupName, discipline: row.discipline })),
  };
}

export async function resolveTaughtStudent(user: PublicUser, studentName: string, disciplineQuery: string) {
  const load = await loadForTeacher(user.id);
  const names = [...new Set(load.map((row) => row.discipline))];
  const wanted = disciplineQuery ? matchDiscipline(disciplineQuery, names) : undefined;
  const hits: { studentName: string; groupName: string; discipline: string }[] = [];
  for (const row of load) {
    if (wanted && row.discipline !== wanted) continue;
    if (!wanted && disciplineQuery && !subjectHit(disciplineQuery, row.discipline, names)) continue;
    const person = (await studentsOf(row.groupName)).find((item) => samePerson(studentName, item.fullName));
    if (!person) continue;
    if (hits.some((hit) => hit.studentName === person.fullName && hit.discipline === row.discipline)) continue;
    hits.push({ studentName: person.fullName, groupName: row.groupName, discipline: row.discipline });
  }
  if (hits.length === 1) return hits[0];
  return { options: hits };
}

export async function setJournalMark(user: PublicUser, groupName: string, discipline: string, studentName: string, value: number, label: string, kind: "current" | "credit" = "current") {
  if (user.role !== "teacher") throw forbidden();
  await assertTeaches(user.id, groupName, discipline);
  const student = await studentInGroup(groupName, studentName);
  const subject = await getDb()
    .select()
    .from(disciplines)
    .where(and(eq(disciplines.studentId, student.id), eq(disciplines.name, discipline)))
    .limit(1);
  if (!subject[0]) throw notFound("Дисциплина не найдена");
  const [mark] = await getDb().insert(marks).values({
    disciplineId: subject[0].id,
    studentId: student.id,
    label,
    value: kind === "credit" ? value : value,
    kind,
    awardedOn: moscowToday(),
  }).returning({ id: marks.id });
  const shown = kind === "credit" ? (value >= 1 ? "зачёт" : "незачёт") : String(value);
  return { summary: `В журнале ${student.fullName}, ${groupName}, ${discipline}: ${label} — ${shown}.`, markId: mark.id };
}

export async function remindDeadline(user: PublicUser, subject: string) {
  if (user.role !== "student") throw forbidden();
  const rows = await listStudentHomework(user);
  const names = [...new Set(rows.map((row) => row.discipline))];
  const found = matchDiscipline(subject, names);
  const pool = rows.filter((row) => row.submission.status !== "graded" && (!found || row.discipline === found));
  const ordered = [...pool].sort((a, b) => a.deadline.localeCompare(b.deadline));
  const now = moscowNow().getTime();
  for (const row of ordered) {
    const end = new Date(`${row.deadline}T23:00:00+03:00`);
    if (end.getTime() <= now) continue;
    const evening = new Date(`${addDays(row.deadline, -1)}T18:00:00+03:00`);
    const afternoon = new Date(`${row.deadline}T15:00:00+03:00`);
    const soon = new Date(now + 30 * 60 * 1000);
    const when = evening.getTime() > now + 20 * 60 * 1000 ? evening : afternoon.getTime() > now + 20 * 60 * 1000 ? afternoon : soon < end ? soon : null;
    if (!when) continue;
    const { reminders } = await import("./db/schema");
    const title = `Сдать «${row.title}»`;
    const existing = await getDb()
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, user.id), eq(reminders.title, title), eq(reminders.done, false)))
      .limit(1);
    if (existing[0]) {
      const clock = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(existing[0].dueAt));
      return { summary: `Напоминание «${title}» уже стоит на ${formatRuDate(existing[0].dueAt.slice(0, 10))} в ${clock}.`, reminderId: existing[0].id, assignmentId: row.id };
    }
    const [saved] = await getDb().insert(reminders).values({ userId: user.id, title, dueAt: when.toISOString() }).returning();
    await notify(user.id, "reminder", title, `До срока ${formatRuDate(row.deadline)}.`, `/homework/${row.id}`);
    const clock = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(when);
    return { summary: `Напомню про «${row.title}» (${row.discipline}) ${formatRuDate(when.toISOString().slice(0, 10))} в ${clock}, это до срока ${formatRuDate(row.deadline)}.`, reminderId: saved.id, assignmentId: row.id };
  }
  throw notFound("Открытого задания по этому предмету нет");
}

export async function openRoll(user: PublicUser) {
  const home = await teacherHome(user);
  const lesson = home.lessons[0];
  if (!lesson) throw notFound("Ближайшей пары нет");
  const when = home.lessonDay === moscowToday() ? "сегодня" : formatRuDate(home.lessonDay);
  return {
    summary: `Явка ближайшей пары, ${when}: ${lesson.discipline}, ${lesson.groupName}.`,
    to: `/teach/journal?group=${encodeURIComponent(lesson.groupName)}&discipline=${encodeURIComponent(lesson.discipline)}`,
  };
}

export async function markAbsentToday(user: PublicUser, names: string[]) {
  if (user.role !== "teacher") throw forbidden();
  const home = await teacherHome(user);
  const lesson = home.lessons[0];
  if (!lesson) throw notFound("Сегодня пар нет");
  const lines: string[] = [];
  for (const name of names) {
    lines.push(await setAttendance(user, lesson.groupName, lesson.discipline, moscowToday(), name, false));
  }
  return lines.join(" ");
}

export async function subjectSummary(user: PublicUser, discipline: string) {
  if (user.role !== "teacher") throw forbidden();
  const queue = await teacherQueue(user);
  const rows = queue.filter((row) => row.discipline.toLowerCase().includes(discipline.toLowerCase()));
  if (!rows.length) throw notFound("Предмет не найден");
  const pending = rows.filter((row) => row.submission.status === "in_review").length;
  return `«${rows[0].discipline}»: работ в очереди ${rows.length}, на проверке ${pending}.`;
}

export async function setAttendance(user: PublicUser, groupName: string, discipline: string, date: string, studentName: string, present: boolean) {
  if (user.role !== "teacher") throw forbidden();
  await assertTeaches(user.id, groupName, discipline);
  const student = await studentInGroup(groupName, studentName);
  const existing = await getDb()
    .select()
    .from(attendance)
    .where(and(eq(attendance.studentId, student.id), eq(attendance.discipline, discipline), eq(attendance.lessonDate, date)))
    .limit(1);
  if (existing[0]) {
    await getDb().update(attendance).set({ present, teacherId: user.id }).where(eq(attendance.id, existing[0].id));
  } else {
    await getDb().insert(attendance).values({ teacherId: user.id, studentId: student.id, groupName, discipline, lessonDate: date, present });
  }
  return `${student.fullName} ${present ? "был" : "отсутствовал"} ${formatRuDate(date)}.`;
}

export async function announceToGroup(user: PublicUser, groupName: string, title: string, body: string) {
  if (user.role !== "teacher") throw forbidden();
  const load = await loadForTeacher(user.id);
  if (!load.some((row) => row.groupName === groupName)) throw notFound("Группа не найдена");
  await getDb().insert(groupAnnouncements).values({ teacherId: user.id, groupName, title, body });
  for (const student of await studentsOf(groupName)) {
    await notify(student.id, "announcement", title, body, "/notifications");
  }
  return `Объявление «${title}» ушло группе ${groupName}.`;
}

export function bucketOf(deadline: string, status: SubmissionStatus, today = moscowToday()) {
  if (status === "graded" || status === "in_review" || status === "submitted") return "done";
  if (deadline < today) return "overdue";
  if (deadline <= addDays(today, 7)) return "due";
  return "later";
}

export function pickHomework(rows: Awaited<ReturnType<typeof listStudentHomework>>, bucket?: string, until?: string, kind?: string) {
  const today = moscowToday();
  return rows.filter((row) => {
    const bucketName = bucketOf(row.deadline, row.submission.status as SubmissionStatus, today);
    if (until && row.deadline > until) return false;
    if (kind === "lab" && row.kind !== "lab") return false;
    if (kind && kind !== "lab" && row.kind !== kind) return false;
    if (!bucket || bucket === "all") return true;
    if (bucket === "due") return bucketName === "due" || bucketName === "overdue";
    if (bucket === "overdue") return bucketName === "overdue" || row.submission.status === "returned";
    if (bucket === "done") return bucketName === "done";
    return true;
  });
}

export function narrateHomework(rows: Awaited<ReturnType<typeof listStudentHomework>>, bucket?: string, until?: string, kind?: string) {
  const filtered = pickHomework(rows, bucket, until, kind);
  if (!filtered.length) return bucket === "overdue" ? "Просроченных заданий и возвратов нет." : "Подходящих заданий нет.";
  return filtered
    .slice(0, 3)
    .map((row) => `«${row.title}» (${row.discipline}) — ${row.submission.statusLabel}, срок ${formatRuDate(row.deadline)}.`)
    .join(" ");
}
