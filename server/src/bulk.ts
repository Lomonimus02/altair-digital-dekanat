import type { ChoiceChip, ConfirmCard, PublicUser } from "../../shared/src/domain";
import { addDays, isFutureDay, mondayOf, moscowToday } from "../../shared/src/dates";
import { ATTENDANCE, defaultWorkRule, formatScore, parseWorkType, rankTitle, validPoints, WORK_TYPES, type WorkType } from "../../shared/src/journal";
import { loadForTeacher } from "./homework";
import {
  attendanceOn, columnsOf, columnsOn, heldLessonOn, lessonChip, marksInColumn, missingLessonNote, nearestHeldLessons, nextHeldLesson, pickExcluded, readScheme, rosterOf,
} from "./journal";

type Early = { ok: true; summary: string; choices?: ChoiceChip[]; card?: { title: string; rows: { label: string; value: string }[] } };
type Clarify = (tool: string, args: Record<string, unknown>) => Promise<string>;

const dm = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const short = (full: string) => {
  const parts = full.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.slice(1).map((part) => `${part[0]}.`).join(" ")}` : full;
};

function fits(stored: string, asked: string) {
  const a = asked.toLowerCase().replace(/ё/g, "е");
  const b = stored.toLowerCase().replace(/ё/g, "е");
  return b === a || b.includes(a) || a.includes(b) || b.startsWith(a.slice(0, 6));
}

/** Группа и предмет из нагрузки преподавателя. */
export async function resolvePair(user: PublicUser, name: string, args: Record<string, unknown>, clarify: Clarify, question: string): Promise<Early | null> {
  const load = await loadForTeacher(user.id);
  const pairs = load.filter((row) => (!args.groupName || row.groupName === String(args.groupName).toUpperCase()) && (!args.discipline || fits(row.discipline, String(args.discipline))));
  if (!pairs.length) {
    const own = [...new Set(load.map((row) => `${row.groupName} · ${row.discipline}`))].join("; ");
    return { ok: true, summary: `Это не ваша группа или предмет. Вы ведёте: ${own}.` };
  }
  if (pairs.length > 1) {
    const clarificationId = await clarify(name, args);
    return { ok: true, summary: question, choices: pairs.map((row) => ({ label: `${row.groupName} · ${row.discipline}`, clarificationId, entityId: `pair:${row.groupName}||${row.discipline}` })) };
  }
  args.groupName = pairs[0].groupName;
  args.discipline = pairs[0].discipline;
  return null;
}

async function lastLessonChips(groupName: string, discipline: string, clarificationId: string, limit = 2) {
  const held = await nearestHeldLessons(groupName, discipline, moscowToday(), limit);
  return held.map((row, index) => ({ label: `${index === 0 ? "Последняя пара" : "Пара"} ${lessonChip(row.date)}`, clarificationId, entityId: row.date }));
}

/** Разбирает, какую пару имели в виду. Будущие пары не берём: оценки и явку ставят после занятия. */
async function resolveDate(user: PublicUser, name: string, args: Record<string, unknown>, clarify: Clarify): Promise<Early | null> {
  const groupName = String(args.groupName);
  const discipline = String(args.discipline);
  const today = moscowToday();
  const refuseFuture = async (date: string) => {
    const clarificationId = await clarify(name, { ...args, date: undefined, lesson: undefined });
    return { ok: true as const, summary: `Пара ${lessonChip(date)} ещё не прошла — баллы и явку ставят после занятия. Выберите прошедшую пару.`, choices: await lastLessonChips(groupName, discipline, clarificationId) };
  };
  if (args.lesson === "next") {
    const next = await nextHeldLesson(groupName, discipline, today);
    if (!next) return { ok: true, summary: `Ближайших пар по «${discipline}» в расписании нет.` };
    if (next.date !== today) return refuseFuture(next.date);
    args.date = today;
  } else if (args.lesson === "today") {
    if (!(await heldLessonOn(groupName, discipline, today))) {
      const clarificationId = await clarify(name, { ...args, lesson: undefined });
      return { ok: true, summary: `Сегодня пары по «${discipline}» нет. За какую пару поставить?`, choices: await lastLessonChips(groupName, discipline, clarificationId) };
    }
    args.date = today;
  } else if (args.lesson === "last") {
    const last = (await nearestHeldLessons(groupName, discipline, today, 1))[0];
    if (!last) return { ok: true, summary: `Прошедших пар по «${discipline}» ещё не было.` };
    args.date = last.date;
  }
  delete args.lesson;
  if (args.date) {
    const date = String(args.date);
    if (isFutureDay(date, today)) return refuseFuture(date);
    if (!(await heldLessonOn(groupName, discipline, date))) {
      const clarificationId = await clarify(name, { ...args, date: undefined });
      const why = await missingLessonNote(groupName, discipline, date);
      const chips = await lastLessonChips(groupName, discipline, clarificationId, 3);
      if (why.target && !chips.some((chip) => chip.entityId === why.target)) chips.unshift({ label: `Пара ${lessonChip(why.target)}`, clarificationId, entityId: why.target });
      return { ok: true, summary: `${dm(date)} пары по «${discipline}» не было.${why.text} Выберите пару:`, choices: chips.slice(0, 3) };
    }
    return null;
  }
  if (await heldLessonOn(groupName, discipline, today)) {
    args.date = today;
    return null;
  }
  const clarificationId = await clarify(name, args);
  const chips = await lastLessonChips(groupName, discipline, clarificationId);
  if (name === "teacher_bulk_mark") {
    const recent = (await columnsOf(groupName, discipline)).filter((row) => row.lessonDate <= today).slice(-3).reverse();
    chips.push(...recent.map((row) => ({ label: `${row.title} · ${dm(row.lessonDate)}`, clarificationId, entityId: `col:${row.id}` })));
  }
  return { ok: true, summary: "Сегодня пары нет. За какую пару или работу поставить?", choices: chips };
}

export async function prepareBulk(user: PublicUser, name: "teacher_bulk_mark" | "teacher_bulk_attendance", args: Record<string, unknown>, clarify: Clarify): Promise<Early | null> {
  if (Array.isArray(args.except) && !args.except.length) delete args.except;
  if (!args.columnId || !args.groupName) {
    const pair = await resolvePair(user, name, args, clarify, "Для какой группы и предмета?");
    if (pair) return pair;
  }
  const groupName = String(args.groupName);
  const discipline = String(args.discipline);
  if (name === "teacher_bulk_mark" && !args.columnId && args.columnTitle) {
    const asked = String(args.columnTitle);
    const all = (await columnsOf(groupName, discipline)).filter((row) => !isFutureDay(row.lessonDate));
    let hits = all.map((row) => ({ row, score: rankTitle(asked, row.title) })).filter((item) => item.score >= 70).sort((a, b) => b.score - a.score).map((item) => item.row);
    if (!hits.length) {
      const work = parseWorkType(asked);
      const number = Number(asked.match(/\d+/)?.[0] ?? NaN);
      if (work) {
        hits = all.filter((row) => row.workType === work.type);
        if (Number.isFinite(number) && hits.some((row) => (row.maxPoints ?? 10) === number) && !hits.some((row) => new RegExp(`\\b${number}\\b`).test(row.title))) hits = hits.filter((row) => (row.maxPoints ?? 10) === number);
        const titled = hits.filter((row) => Number.isFinite(number) && new RegExp(`\\b${number}\\b`).test(row.title));
        if (titled.length === 1) hits = titled;
      }
    }
    if (!hits.length) {
      const clarificationId = await clarify(name, { ...args, columnTitle: undefined });
      return { ok: true, summary: `Работы «${asked}» в журнале «${discipline}» нет. Выберите пару или работу:`, choices: await lastLessonChips(groupName, discipline, clarificationId) };
    }
    if (hits.length > 1) {
      const clarificationId = await clarify(name, { ...args, columnTitle: undefined });
      return { ok: true, summary: `Несколько работ «${asked}». Какую?`, choices: hits.slice(-6).reverse().map((row) => ({ label: `${row.title} · ${dm(row.lessonDate)}`, clarificationId, entityId: `col:${row.id}` })) };
    }
    args.columnId = hits[0].id;
    args.date = hits[0].lessonDate;
    delete args.lesson;
  }
  delete args.columnTitle;
  if (!args.columnId) {
    const early = await resolveDate(user, name, args, clarify);
    if (early) return early;
  }
  const date = String(args.date);
  let max = 10;
  if (name === "teacher_bulk_mark") {
    if (!args.columnId && !args.newColumn) {
      const cols = await columnsOn(groupName, discipline, date);
      if (cols.length === 1) args.columnId = cols[0].id;
      else if (cols.length > 1) {
        const clarificationId = await clarify(name, args);
        return { ok: true, summary: `${dm(date)} несколько работ. В какую поставить?`, choices: [...cols.map((row) => ({ label: row.title, clarificationId, entityId: `col:${row.id}` })), { label: "Новая колонка", clarificationId, entityId: "col:new" }] };
      } else args.newColumn = true;
    }
    if (args.columnId) {
      const col = (await columnsOf(groupName, discipline)).find((row) => row.id === Number(args.columnId));
      if (!col) return { ok: true, summary: "Такой работы в вашем журнале нет." };
      max = col.maxPoints ?? col.maxScore ?? 10;
      args.date = col.lessonDate;
      delete args.newColumn;
    } else {
      const rule = (await readScheme(groupName, discipline)).defaults[(args.workType ?? "current") as WorkType] ?? defaultWorkRule((args.workType ?? "current") as WorkType);
      max = rule.maxPoints;
    }
    if (!args.max && args.value == null) {
      const clarificationId = await clarify(name, args);
      return { ok: true, summary: "Сколько баллов поставить всем?", choices: [{ label: `Максимум — ${max}`, clarificationId, entityId: "value:max" }] };
    }
    if (!args.max && !validPoints(Number(args.value), max)) {
      const clarificationId = await clarify(name, args);
      return { ok: true, summary: `У работы максимум ${max}. ${formatScore(Number(args.value))} больше максимума.`, choices: [{ label: `Поставить всем ${max}`, clarificationId, entityId: "value:max" }] };
    }
  }
  const roster = await rosterOf(groupName);
  const { excluded, missing } = pickExcluded(roster, (args.except as string[] | undefined) ?? []);
  if (missing.length) return { ok: true, summary: `Не нашёл в группе ${groupName}: ${missing.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(", ")}. Проверьте фамилию.` };
  const left = roster.filter((row) => !excluded.has(row));
  if (!left.length) return { ok: true, summary: "После исключений никого не осталось." };
  if (args.onlyEmpty) {
    const filled = name === "teacher_bulk_mark"
      ? new Set(args.columnId ? (await marksInColumn(Number(args.columnId))).filter((row) => row.points != null).map((row) => row.studentId) : [])
      : new Set((await attendanceOn(groupName, discipline, String(args.date))).map((row) => row.studentId));
    if (left.every((row) => filled.has(row.id))) return { ok: true, summary: name === "teacher_bulk_mark" ? "У всех уже стоят баллы — пустых клеток нет." : "Явка у всех уже отмечена." };
  }
  void max;
  return null;
}

export async function bulkPreview(name: "teacher_bulk_mark" | "teacher_bulk_attendance", args: Record<string, unknown>, clarify: Clarify): Promise<Omit<ConfirmCard, "pendingId"> & { columnId?: number }> {
  const groupName = String(args.groupName);
  const discipline = String(args.discipline);
  const date = String(args.date);
  const roster = await rosterOf(groupName);
  const { excluded } = pickExcluded(roster, (args.except as string[] | undefined) ?? []);
  if (name === "teacher_bulk_attendance") {
    const rows = await attendanceOn(groupName, discipline, date);
    const by = new Map(rows.map((row) => [row.studentId, row]));
    const targets = roster.filter((row) => !excluded.has(row) && !(args.onlyEmpty && by.has(row.id)));
    const status = String(args.status ?? "present") as keyof typeof ATTENDANCE;
    const letter = (value?: string | null) => (value ? (value === "present" ? "был" : ATTENDANCE[value as keyof typeof ATTENDANCE] || value) : "—");
    const overwrite = targets.filter((row) => by.has(row.id) && by.get(row.id)?.status !== status).length;
    const empties = targets.filter((row) => !by.has(row.id)).length;
    const alt = overwrite && !args.onlyEmpty && empties ? { label: `Только пустым · ${empties}`, clarificationId: await clarify(name, args), entityId: "only-empty" } : undefined;
    return {
      title: "Явка всей группе",
      summary: `${groupName} · ${discipline}`,
      fields: [
        { label: "Пара", value: lessonChip(date) },
        { label: "Отметка", value: status === "present" ? "Присутствовал" : `«${ATTENDANCE[status]}»` },
        { label: "Студентов", value: String(targets.length) },
        ...(excluded.size ? [{ label: "Кроме", value: [...excluded].map((row) => short(row.fullName)).join(", ") }] : []),
      ],
      ...(overwrite ? { warning: `Изменит уже отмеченную явку у ${overwrite} студ.` } : {}),
      details: { title: `Кому и что было (${targets.length})`, rows: targets.map((row) => ({ label: short(row.fullName), value: `было ${letter(by.get(row.id)?.status)}` })) },
      ...(alt ? { alt } : {}),
    };
  }
  const columnId = args.columnId ? Number(args.columnId) : undefined;
  const col = columnId ? (await columnsOf(groupName, discipline)).find((row) => row.id === columnId) : undefined;
  const workType = (col?.workType ?? args.workType ?? "current") as WorkType;
  const rule = (await readScheme(groupName, discipline)).defaults[workType] ?? defaultWorkRule(workType);
  const max = col ? (col.maxPoints ?? col.maxScore ?? 10) : rule.maxPoints;
  const points = args.max ? max : Number(args.value);
  const existing = columnId ? await marksInColumn(columnId) : [];
  const by = new Map(existing.map((row) => [row.studentId, row]));
  const has = (id: number) => by.get(id)?.points != null;
  const targets = roster.filter((row) => !excluded.has(row) && !(args.onlyEmpty && has(row.id)));
  const overwrite = targets.filter((row) => has(row.id) && Number(by.get(row.id)?.points) !== points).length;
  const empties = targets.filter((row) => !has(row.id)).length;
  const alt = overwrite && !args.onlyEmpty && empties ? { label: `Только пустым · ${empties}`, clarificationId: await clarify(name, args), entityId: "only-empty" } : undefined;
  return {
    title: "Баллы всей группе",
    summary: `${groupName} · ${discipline}`,
    fields: [
      { label: "Работа", value: col ? `${col.title} · ${lessonChip(col.lessonDate)}` : `Новая колонка «${WORK_TYPES[workType].label}» · ${lessonChip(date)}` },
      { label: "Баллы", value: `${formatScore(points)} из ${max}${args.max ? " (максимум)" : ""}` },
      { label: "Студентов", value: String(targets.length) },
      ...(excluded.size ? [{ label: "Кроме", value: [...excluded].map((row) => short(row.fullName)).join(", ") }] : []),
    ],
    ...(overwrite ? { warning: `Перезапишет ${overwrite} уже выставленн${overwrite === 1 ? "ую оценку" : overwrite < 5 ? "ые оценки" : "ых оценок"}.` } : {}),
    details: { title: `Кому и что было (${targets.length})`, rows: targets.map((row) => ({ label: short(row.fullName), value: `было ${has(row.id) ? formatScore(Number(by.get(row.id)?.points)) : "—"} → ${formatScore(points)}` })) },
    ...(alt ? { alt } : {}),
    columnId,
  };
}

export function journalFocusLink(groupName: string, discipline: string, date: string, column?: number | string) {
  const from = mondayOf(date);
  const to = addDays(from, 6);
  return `/teach/journal?group=${encodeURIComponent(groupName)}&discipline=${encodeURIComponent(discipline)}&from=${from}&to=${to}&hlcol=${column ?? `d:${date}`}`;
}

const KIND_RU: Record<string, string> = { essay: "Эссе", problem_set: "Задачи", lab: "Лабораторная", reading: "Чтение", project: "Проект" };

async function deadlineChips(groupName: string, discipline: string, clarificationId: string) {
  const today = moscowToday();
  const next = await nextHeldLesson(groupName, discipline, addDays(today, 1));
  const week = addDays(today, 7);
  const chips = [{ label: `Через неделю · ${lessonChip(week)}`, clarificationId, entityId: `deadline:${week}` }];
  if (next && next.date !== week) chips.unshift({ label: `К следующей паре · ${lessonChip(next.date)}`, clarificationId, entityId: `deadline:${next.date}` });
  const two = addDays(today, 14);
  chips.push({ label: `Через 2 недели · ${lessonChip(two)}`, clarificationId, entityId: `deadline:${two}` });
  return chips;
}

export async function prepareIssue(user: PublicUser, args: Record<string, unknown>, clarify: Clarify): Promise<Early | null> {
  const title = String(args.title ?? "").trim();
  if (title.length < 2) return { ok: true, summary: "Как назвать задание? Например: «выдай задание Первый миллион до 30.11»." };
  const pair = await resolvePair(user, "teacher_issue_assignment", args, clarify, "Какой группе и по какому предмету выдать?");
  if (pair) return pair;
  if (!args.description || String(args.description).trim().length < 2) args.description = title;
  if (!args.kind) args.kind = "problem_set";
  const today = moscowToday();
  if (!args.deadline || String(args.deadline) <= today) {
    const clarificationId = await clarify("teacher_issue_assignment", { ...args, deadline: undefined });
    return {
      ok: true,
      summary: args.deadline ? "Срок должен быть позже сегодняшнего дня. Выберите срок или напишите дату, например «до 5 декабря»." : `Задание «${title}» для ${args.groupName}. Какой срок сдачи? Выберите или напишите дату.`,
      choices: await deadlineChips(String(args.groupName), String(args.discipline), clarificationId),
    };
  }
  return null;
}

export function issuePreview(args: Record<string, unknown>): Omit<ConfirmCard, "pendingId"> {
  return {
    title: "Выдать задание",
    summary: "Группа получит уведомление. Чтобы поправить, ответьте: «срок 5 декабря», «название …», «описание …» или «тип эссе».",
    fields: [
      { label: "Задание", value: String(args.title) },
      { label: "Группа", value: String(args.groupName) },
      { label: "Предмет", value: String(args.discipline) },
      { label: "Тип", value: KIND_RU[String(args.kind)] ?? String(args.kind) },
      { label: "Срок", value: lessonChip(String(args.deadline)) },
      { label: "Описание", value: String(args.description ?? args.title) },
    ],
  };
}
