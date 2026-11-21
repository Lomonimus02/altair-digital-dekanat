import { CHIP_LABELS } from "@shared/journal";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const DAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function fmtDate(iso: string, mode: "short" | "day" | "full" | "rel" = "short", today = new Date().toISOString().slice(0, 10)) {
  const day = iso.slice(0, 10);
  const { d, m, wd } = parts(day);
  const short = `${d} ${MONTHS[m - 1]}`;
  const withDay = `${DAYS[wd]}, ${short}`;
  if (mode === "short") return short;
  if (mode === "day") return withDay;
  if (mode === "full") {
    const date = new Date(Date.UTC(parts(day).y, m - 1, d));
    const name = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  if (day === today) return "сегодня";
  const next = shift(today, 1);
  const prev = shift(today, -1);
  if (day === next) return "завтра";
  if (day === prev) return "вчера";
  return withDay;
}

export function fmtTimeAgo(iso: string, today = new Date().toISOString().slice(0, 10)) {
  const day = iso.slice(0, 10);
  const clock = iso.length > 10 ? iso.slice(11, 16) : "";
  if (day === today && clock) return clock;
  if (day === shift(today, -1)) return "вчера";
  const age = (Date.parse(today) - Date.parse(day)) / 86_400_000;
  if (age >= 0 && age < 7) return DAYS[parts(day).wd];
  return fmtDate(day, "short");
}

function shift(iso: string, days: number) {
  const { y, m, d } = parts(iso);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function nb(value: string) {
  return value
    .replace(/(\d)\s+/g, "$1\u00A0")
    .replace(/(№)\s+/g, "$1\u00A0")
    .replace(/(ауд\.)\s+/g, "$1\u00A0")
    .replace(/([А-ЯЁ]\.)\s+/g, "$1\u00A0");
}

export function urgency(due: string, today = new Date().toISOString().slice(0, 10)): "over" | "soon" | "later" {
  if (due < today) return "over";
  const limit = shift(today, 3);
  if (due <= limit) return "soon";
  return "later";
}

export function gradeTone(percent: number | null) {
  if (percent == null) return "var(--g-2)";
  if (percent >= 85) return "var(--g-5)";
  if (percent >= 70) return "var(--g-4)";
  if (percent >= 55) return "var(--g-3)";
  return "var(--g-2)";
}

export function gradeInk(percent: number | null) {
  if (percent == null) return "var(--g-2-fg)";
  if (percent >= 85) return "var(--g-5-fg)";
  if (percent >= 70) return "var(--g-4-fg)";
  if (percent >= 55) return "var(--g-3-fg)";
  return "var(--g-2-fg)";
}

export function formatWeight(weight: number) {
  return weight.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(weight) ? 0 : 1, maximumFractionDigits: 1 });
}

/** Последнее слово не остаётся одно на строке: пробел перед ним неразрывный. */
export function glueLast(value: string) {
  const text = value.trim();
  const index = text.lastIndexOf(" ");
  if (index <= 0) return text;
  return `${text.slice(0, index)}\u00A0${text.slice(index + 1)}`;
}

export function kindChip(kind: string) {
  return CHIP_LABELS[kind] ?? "Работа";
}

export function noticeView(note: { title: string; body: string; kind?: string }) {
  let title = note.title;
  let body = note.body.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, year, month, day) => fmtDate(`${year}-${month}-${day}`, "short"));
  let type: "grade" | "work" | "returned" | "schedule" | "request" | "announcement" | "system" = "system";
  if (note.kind === "grade" || title.startsWith("Баллы:")) type = "grade";
  else if (note.kind === "schedule" || title.startsWith("Изменение")) type = "schedule";
  else if (note.kind === "request" || title.startsWith("Заявка")) type = "request";
  else if (note.kind === "announcement") type = "announcement";
  else if (title.startsWith("Вернули")) type = "returned";
  else if (note.kind === "homework" || title.startsWith("Новое задание")) type = "work";
  if (title.startsWith("Новое задание: ")) { type = "work"; body = body || "Новое задание"; title = title.slice("Новое задание: ".length); }
  else if (title.startsWith("Вернули на доработку: ")) { type = "returned"; body = "Вернули на доработку"; title = title.slice("Вернули на доработку: ".length); }
  return { type, title, body };
}
