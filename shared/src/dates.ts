let clock: Date | null = null;

/** Тестовые часы. null возвращает системное время. */
export function setClock(value: Date | string | null) {
  clock = value == null ? null : new Date(value);
}

export function moscowNow(now?: Date): Date {
  return now ?? clock ?? new Date();
}

export function moscowToday(now?: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moscowNow(now));
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

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
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

export function longDay(iso: string): string {
  return `${weekdayRu(iso)}, ${formatRuDate(iso)}`;
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
    const focus = addDays(mondayOf(today), 7);
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
  if (weekdayIndex(raw) === 0) {
    return { focus: addDays(raw, 1), label: "Понедельник", sundayNote: true };
  }
  const names = { today: "Сегодня", tomorrow: "Завтра", day_after: "Послезавтра" } as const;
  return { focus: raw, label: names[when], sundayNote: false };
}

export function dueAtMoscow(day: "today" | "tomorrow" | "day_after", time: string, today = moscowToday()): string {
  const shift = day === "today" ? 0 : day === "tomorrow" ? 1 : 2;
  const date = addDays(today, shift);
  return new Date(`${date}T${time}:00+03:00`).toISOString();
}
