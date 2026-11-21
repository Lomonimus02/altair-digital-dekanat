import { addDays, mondayOf, moscowToday, resolveWhen } from "./dates";
import { scheduleAsk } from "./schedule-ask";

export const WORK_TYPES = {
  current: { label: "Текущая", short: "Тек", weight: 1, tone: "green" },
  seminar: { label: "Семинар", short: "Сем", weight: 1, tone: "green" },
  homework: { label: "Домашняя", short: "ДЗ", weight: 1, tone: "orange" },
  lab: { label: "Лабораторная", short: "Лаб", weight: 1.5, tone: "blue" },
  test: { label: "Тест", short: "Тест", weight: 1.5, tone: "sky" },
  essay: { label: "Эссе", short: "Эсс", weight: 1, tone: "violet" },
  case: { label: "Кейс", short: "Кейс", weight: 1, tone: "violet" },
  project: { label: "Проект", short: "Пр", weight: 1.5, tone: "violet" },
  colloquium: { label: "Коллоквиум", short: "Колл", weight: 2, tone: "red" },
  control: { label: "Контрольная", short: "КР", weight: 2, tone: "red" },
  defense: { label: "Защита", short: "Защ", weight: 1, tone: "red" },
  credit: { label: "Зачёт", short: "Зач", weight: 0, tone: "slate" },
} as const;

export const WORK_TYPE_KEYS = ["current", "seminar", "homework", "lab", "test", "essay", "case", "project", "colloquium", "control", "defense", "credit"] as const;
export type WorkType = (typeof WORK_TYPE_KEYS)[number];

export const ATTENDANCE = { present: "", absent: "Н", sick: "Б", late: "О", excused: "У" } as const;
export type AttendanceStatus = keyof typeof ATTENDANCE;

const WEEK = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function journalDateLabel(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = WEEK[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}, ${weekday}`;
}

export const DEFAULT_THRESHOLDS = { excellent: 85, good: 70, satisfactory: 55 };

export function defaultWorkRule(type: WorkType) {
  return { maxPoints: 10, weight: WORK_TYPES[type].weight || 1 };
}

export function formatPercent(value: number | null) {
  if (value == null) return "—";
  return `${value.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function finalByPercent(percent: number, thresholds = DEFAULT_THRESHOLDS) {
  if (percent >= thresholds.excellent) return "отлично";
  if (percent >= thresholds.good) return "хорошо";
  if (percent >= thresholds.satisfactory) return "удовлетворительно";
  return "неудовлетворительно";
}

export function gradeLabel(percent: number | null, thresholds = DEFAULT_THRESHOLDS, controlForm: "exam" | "credit" = "exam") {
  if (percent == null) return null;
  if (controlForm === "credit") return percent >= thresholds.satisfactory ? "зачтено" : "не зачтено";
  return finalByPercent(percent, thresholds);
}

export function scalePoints(points: number, fromMax: number, toMax: number) {
  if (!(fromMax > 0) || !(toMax > 0)) return 0;
  const stepped = Math.round(((points / fromMax) * toMax) * 2) / 2;
  return Math.min(toMax, Math.max(0, stepped));
}

/** Диапазон, который покрывает учебную часть семестра (осень до 31.12, весна до 30.06), считается итогом семестра. */
export function countsAsSemester(bounds: { from: string; to: string }, today = moscowToday()) {
  const term = semesterBounds(today);
  if (bounds.from <= term.from && bounds.to >= term.to) return true;
  const year = term.from.slice(0, 4);
  const teachingEnd = term.to.endsWith("-01-31") ? `${year}-12-31` : term.to.endsWith("-08-31") ? `${year}-06-30` : term.to;
  return bounds.from <= term.from && bounds.to >= teachingEnd && bounds.to <= term.to;
}

export const MAX_POINTS_ERROR = "Максимум — целое от 1 до 1000";
export const WEIGHT_ERROR = "Вес больше 0 и не больше 20";

export function workRuleError(maxRaw: string, weightRaw: string) {
  const maxPoints = Number(maxRaw.trim().replace(",", "."));
  const weight = Number(weightRaw.trim().replace(",", "."));
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 1000) return MAX_POINTS_ERROR;
  if (!Number.isFinite(weight) || weight <= 0 || weight > 20) return WEIGHT_ERROR;
  return null;
}

/** Процент — среднее отношений балл/максимум с весами. «Набрано X из 100» — те же взвешенные баллы, X/100 равен проценту. */
export function pointsTotal(items: { points: number | null; maxPoints: number; weight: number }[], thresholds = DEFAULT_THRESHOLDS) {
  const graded = items.filter((item) => item.points != null && item.maxPoints > 0 && item.weight > 0);
  if (!graded.length) return { percent: null as number | null, earned: 0, possible: 0, grade: null as string | null };
  let ratio = 0;
  let weight = 0;
  for (const item of graded) {
    ratio += (Number(item.points) / item.maxPoints) * item.weight;
    weight += item.weight;
  }
  const percent = Math.round((ratio / weight) * 1000) / 10;
  return {
    percent,
    earned: percent,
    possible: 100,
    grade: finalByPercent(percent, thresholds),
  };
}

export function formatScore(value: number) {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 });
}

export function marksForTerm<T extends { awardedOn: string | null }>(marks: T[], from: string, to: string) {
  return marks.filter((mark) => !mark.awardedOn || (mark.awardedOn >= from && mark.awardedOn <= to));
}

export function validPoints(points: number, maxPoints: number) {
  if (!Number.isFinite(points) || points < 0 || points > maxPoints) return false;
  return Math.abs(points * 2 - Math.round(points * 2)) < 1e-6;
}

export function legacyFromMark(value: number | null, kind: string) {
  if (value == null) return null;
  if (kind === "credit") return value >= 1 ? 10 : 0;
  if (value === 5) return 10;
  if (value === 4) return 8;
  if (value === 3) return 6;
  if (value === 2) return 4;
  if (value === 1) return 2;
  if (value === 0) return 0;
  return null;
}

export function weightedAverage(items: { value: number | null; weight: number; maxScore: number; workType: string }[]) {
  const scored = items.filter((item) => item.workType !== "credit" && item.value != null && item.weight > 0);
  if (!scored.length) return null;
  let sum = 0;
  let weight = 0;
  for (const item of scored) {
    const normalized = item.maxScore === 5 ? Number(item.value) : (Number(item.value) / item.maxScore) * 5;
    sum += normalized * item.weight;
    weight += item.weight;
  }
  if (!weight) return null;
  return Math.round((sum / weight) * 100) / 100;
}

export function simpleAverage(items: { value: number | null; maxScore: number; workType: string }[]) {
  return weightedAverage(items.map((item) => ({ ...item, weight: item.workType === "credit" ? 0 : 1 })));
}

export function parseWorkType(text: string): { type: WorkType; title?: string } | null {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (/самостоят/.test(t)) return { type: "control", title: "Самостоятельная" };
  if (/контрольн|(^|\s)кр(\s|$)/.test(t)) return { type: "control" };
  if (/лаборатор|(^|\s)лаб/.test(t)) return { type: "lab" };
  if (/тест/.test(t)) return { type: "test" };
  if (/коллокв/.test(t)) return { type: "colloquium" };
  if (/семинар|ответ на семинаре/.test(t)) return { type: "seminar" };
  if (/(^|\s)дз(\s|$)|домашн/.test(t)) return { type: "homework" };
  if (/эссе/.test(t)) return { type: "essay" };
  if (/проект/.test(t)) return { type: "project" };
  if (/кейс/.test(t)) return { type: "case" };
  if (/защит/.test(t)) return { type: "defense" };
  if (/зач[её]т/.test(t)) return { type: "credit" };
  return null;
}

export function journalDate(text: string, today = moscowToday()): string | undefined {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (/вчера/.test(t)) return addDays(today, -1);
  const asked = scheduleAsk(text, [], today);
  if (asked?.date) return asked.date;
  if (asked?.when === "today" || asked?.when === "tomorrow" || asked?.when === "day_after") return resolveWhen(asked.when, today).focus;
  return undefined;
}

export function monthBounds(today = moscowToday()) {
  const [year, month] = today.split("-").map(Number);
  const from = `${today.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export function semesterBounds(today = moscowToday()) {
  const [year, month] = today.split("-").map(Number);
  if (month >= 9) return { from: `${year}-09-01`, to: `${year + 1}-01-31` };
  if (month === 1) return { from: `${year - 1}-09-01`, to: `${year}-01-31` };
  return { from: `${year}-02-01`, to: `${year}-08-31` };
}

export function weekBounds(iso: string) {
  const from = mondayOf(iso);
  return { from, to: addDays(from, 6) };
}

export function journalFocus(date: string, workType: string) {
  return `new|${date}|${workType}`;
}

export function parseJournalFocus(value: string): { date: string; workType: string; maxPoints?: number; weight?: number } | null {
  const pipe = value.match(/^new\|(\d{4}-\d{2}-\d{2})\|([a-z]+)(?:\|(\d+))?(?:\|(\d+(?:\.\d+)?))?$/);
  if (pipe && (WORK_TYPE_KEYS as readonly string[]).includes(pipe[2])) {
    return { date: pipe[1], workType: pipe[2], ...(pipe[3] ? { maxPoints: Number(pipe[3]) } : {}), ...(pipe[4] ? { weight: Number(pipe[4]) } : {}) };
  }
  const dashed = value.match(/^new-(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (dashed && (WORK_TYPE_KEYS as readonly string[]).includes(dashed[2])) return { date: dashed[1], workType: dashed[2] };
  return null;
}

/** Даты колонок и все даты пар периода, даже если оценок ещё нет. */
export function journalDates(columnDates: string[], lessonDates: string[]) {
  return [...new Set([...lessonDates, ...columnDates])].sort();
}

export function shiftPeriod(from: string, to: string, dir: number) {
  const [year, month, day] = from.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${from.slice(0, 7)}-${String(last).padStart(2, "0")}`;
  if (day === 1 && to === monthEnd) {
    const next = new Date(Date.UTC(year, month - 1 + dir, 1));
    const nextYear = next.getUTCFullYear();
    const nextMonth = next.getUTCMonth();
    const nextLast = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
    const mm = String(nextMonth + 1).padStart(2, "0");
    return { from: `${nextYear}-${mm}-01`, to: `${nextYear}-${mm}-${String(nextLast).padStart(2, "0")}` };
  }
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(from, dir * span), to: addDays(to, dir * span) };
}

export function periodLabel(from: string, to: string) {
  const months = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01")) return `${months[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  return `${from.slice(8, 10)}.${from.slice(5, 7)}–${to.slice(8, 10)}.${to.slice(5, 7)}`;
}
