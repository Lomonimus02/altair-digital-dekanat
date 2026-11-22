let clock: Date | null = null;

/** Тестовые часы. null возвращает системное время. */
export function setClock(value: Date | string | null) {
  clock = value == null ? null : new Date(value);
}

export function moscowNow(now?: Date): Date {
  return now ?? clock ?? new Date();
}

export function moscowToday(now?: Date): string {
  return calendarDay(moscowNow(now));
}

/** Календарный день в Европе/Москве. Готовая дата ГГГГ-ММ-ДД не переводится через UTC. */
export function calendarDay(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : moscowToday();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isFutureDay(value: string, today = moscowToday()): boolean {
  return calendarDay(value) > today;
}

/** Воскресенье — не учебный день: ближайший понедельник. Остальные дни остаются собой. */
export function nearestStudyDay(iso: string): string {
  return weekdayIndex(iso) === 0 ? addDays(iso, 1) : iso;
}

export function moscowHour(now?: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(moscowNow(now));
  return Number(hour);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function mondayOf(iso: string): string {
  const wd = weekdayIndex(iso);
  const diff = wd === 0 ? -6 : 1 - wd;
  return addDays(iso, diff);
}

export function studyWeek(focusISO: string): string[] {
  const monday = mondayOf(nearestStudyDay(focusISO));
  return [0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i));
}

export function weekOffsetBetween(todayISO: string, focusISO: string): number {
  const a = Date.parse(`${mondayOf(todayISO)}T00:00:00Z`);
  const b = Date.parse(`${mondayOf(focusISO)}T00:00:00Z`);
  return Math.round((b - a) / (7 * 86_400_000));
}

export function ruCount(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} ${one}`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** Как подписать неделю, если в ней нет сегодняшнего дня. */
const GENITIVE_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function formatWeekSpan(startISO: string, endISO: string): string {
  const startDay = Number(startISO.slice(8, 10));
  const endDay = Number(endISO.slice(8, 10));
  const startMonth = GENITIVE_MONTHS[Number(startISO.slice(5, 7)) - 1] ?? "";
  const endMonth = GENITIVE_MONTHS[Number(endISO.slice(5, 7)) - 1] ?? "";
  if (startISO.slice(5, 7) === endISO.slice(5, 7)) return `${startDay}–${endDay} ${endMonth}`;
  return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
}

export function scheduleLook(today: string, weekStart: string, weekEnd: string): "in-week" | "past" | "near" | "later" {
  if (today >= weekStart && today <= weekEnd) return "in-week";
  if (weekEnd < today) return "past";
  if (daysBetween(today, weekStart) <= 7) return "near";
  return "later";
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function formatDdMm(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

const SHORT_WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function shortDayDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = SHORT_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${weekday}, ${day} ${GENITIVE_MONTHS[month - 1] ?? ""}`;
}

/** Только цифры набора, не больше восьми. Короткий год здесь не дополняется. */
export function maskRuDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `.${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `.${digits.slice(4, 8)}`;
  return out;
}

/** Вставка: ISO, короткий год и дд.мм.гггг. Набор по одной цифре сюда не попадает. */
export function pasteRuDate(value: string): string {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const grouped = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (grouped) {
    const day = grouped[1].padStart(2, "0");
    const month = grouped[2].padStart(2, "0");
    const year = grouped[3].length === 2 ? `20${grouped[3]}` : grouped[3];
    return `${day}.${month}.${year}`;
  }
  return maskRuDate(trimmed);
}

export function caretAfterDateDigits(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index] ?? "")) seen += 1;
    if (seen === digitCount) return index + 1;
  }
  return formatted.length;
}

/** Событие input: цифры и каретка. Backspace по точке снимает цифру перед ней. */
export function applyDateInput(previous: string, next: string, caret: number): { value: string; caret: number } {
  if (next.length + 1 === previous.length) {
    let index = 0;
    while (index < next.length && next[index] === previous[index]) index += 1;
    if (previous[index] === ".") {
      const before = previous.slice(0, index).replace(/\D/g, "");
      const after = previous.slice(index + 1).replace(/\D/g, "");
      const digits = `${before.slice(0, -1)}${after}`.slice(0, 8);
      const value = maskRuDate(digits);
      return { value, caret: caretAfterDateDigits(value, Math.max(0, before.length - 1)) };
    }
  }
  const previousDigits = previous.replace(/\D/g, "");
  const nextDigits = next.replace(/\D/g, "");
  if (previousDigits.length >= 8 && nextDigits.length > previousDigits.length) {
    const digitsBefore = next.slice(0, caret).replace(/\D/g, "");
    const inserted = digitsBefore.slice(-1);
    const at = Math.max(0, digitsBefore.length - 1);
    const digits = `${previousDigits.slice(0, at)}${inserted}${previousDigits.slice(at + 1)}`.slice(0, 8);
    const value = maskRuDate(digits);
    return { value, caret: caretAfterDateDigits(value, Math.min(digitsBefore.length, 8)) };
  }
  const value = maskRuDate(next);
  const digitsBefore = Math.min(next.slice(0, caret).replace(/\D/g, "").length, value.replace(/\D/g, "").length);
  return { value, caret: caretAfterDateDigits(value, digitsBefore) };
}

export function formatRuDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(dt);
}

export function weekdayRu(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const name = new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" }).format(dt);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function longDay(iso: string, lowerWeekday = false): string {
  const day = weekdayRu(iso);
  const name = lowerWeekday ? day.charAt(0).toLowerCase() + day.slice(1) : day;
  return `${name}, ${formatRuDate(iso)}`;
}

export interface AcademicTerm {
  id: string;
  label: string;
}

export function academicPeriod(todayISO: string): { current: AcademicTerm; previous: AcademicTerm } {
  const [y, m] = todayISO.split("-").map(Number);
  let startYear: number;
  let term: "fall" | "spring";
  if (m >= 9) {
    term = "fall";
    startYear = y;
  } else if (m === 1) {
    term = "fall";
    startYear = y - 1;
  } else {
    term = "spring";
    startYear = y - 1;
  }
  const current = termLabel(startYear, term);
  const previous =
    term === "spring" ? termLabel(startYear, "fall") : termLabel(startYear - 1, "spring");
  return { current, previous };
}

function termLabel(startYear: number, term: "fall" | "spring"): AcademicTerm {
  const label =
    term === "fall"
      ? `1 семестр ${startYear}/${String(startYear + 1).slice(2)}`
      : `2 семестр ${startYear}/${String(startYear + 1).slice(2)}`;
  return { id: `${startYear}-${term}`, label };
}

export function resolveWhen(when: "today" | "tomorrow" | "day_after" | "week" | "next_week" | "prev_week", today = moscowToday()) {
  if (when === "next_week") {
    const focus = addDays(mondayOf(nearestStudyDay(today)), 7);
    return { focus, label: "Следующая неделя", sundayNote: false };
  }
  if (when === "prev_week") {
    const focus = addDays(mondayOf(today), -7);
    return { focus, label: "Прошлая неделя", sundayNote: false };
  }
  if (when === "week") {
    const sunday = weekdayIndex(today) === 0;
    return { focus: nearestStudyDay(today), label: sunday ? "Ближайшая неделя" : "Эта неделя", sundayNote: sunday };
  }
  const shift = when === "today" ? 0 : when === "tomorrow" ? 1 : 2;
  const raw = addDays(today, shift);
  if (weekdayIndex(raw) === 0 && when === "today") {
    return { focus: addDays(raw, 1), label: "Понедельник", sundayNote: true };
  }
  const names = { today: "Сегодня", tomorrow: "Завтра", day_after: "Послезавтра" } as const;
  return { focus: raw, label: names[when], sundayNote: false };
}

/** Ближайший такой день недели. skipNearest — «следующий четверг», то есть через один. */
export function upcomingWeekday(today: string, weekday: number, skipNearest = false): string {
  let delta = (weekday - weekdayIndex(today) + 7) % 7;
  if (skipNearest) delta += 7;
  return addDays(today, delta);
}

export function dueAtMoscow(day: "today" | "tomorrow" | "day_after", time: string, today = moscowToday()): string {
  const shift = day === "today" ? 0 : day === "tomorrow" ? 1 : 2;
  const date = addDays(today, shift);
  return new Date(`${date}T${time}:00+03:00`).toISOString();
}
