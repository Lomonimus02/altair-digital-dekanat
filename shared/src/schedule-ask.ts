import { addDays, mondayOf, moscowToday, studyWeek, upcomingWeekday, weekdayIndex } from "./dates";

const KNOWN_SUBJECTS = [
  "Базы данных",
  "Программирование",
  "Математический анализ",
  "Линейная алгебра",
  "Экономика фирмы",
  "Информационные технологии в юридической деятельности",
  "Конституционное право",
  "Римское право",
  "Теория государства и права",
  "Английский язык",
];

const MONTHS: [string, number][] = [
  ["январ", 1],
  ["феврал", 2],
  ["март", 3],
  ["апрел", 4],
  ["ма", 5],
  ["июн", 6],
  ["июл", 7],
  ["август", 8],
  ["сентябр", 9],
  ["октябр", 10],
  ["ноябр", 11],
  ["декабр", 12],
];

const WEEKDAYS: [string, number][] = [
  ["понедельник", 1],
  ["вторник", 2],
  ["сред", 3],
  ["четверг", 4],
  ["пятниц", 5],
  ["суббот", 6],
  ["воскресень", 0],
];

export interface ScheduleAsk {
  when: "today" | "tomorrow" | "day_after" | "week" | "next_week" | "prev_week" | "date" | "range" | "month" | "changes" | "next_lesson";
  date?: string;
  from?: string;
  to?: string;
  month?: number;
  subject?: string;
}

export function scheduleAsk(text: string, names: string[] = [], today = moscowToday(), bias: "upcoming" | "past" = "upcoming"): ScheduleAsk | null {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (/перенос|изменен/.test(t) && /расписан|пар|есть ли|какие/.test(t)) return { when: "changes" };
  if (/когда/.test(t) && /пар|занят/.test(t)) {
    return { when: "next_lesson", ...(subjectOf(t, names) ? { subject: subjectOf(t, names) } : {}) };
  }
  const monthOnly = t.match(/(?:^|\s)(?:в|за|на)\s+(январе|феврале|марте|апреле|мае|июне|июле|августе|сентябре|октябре|ноябре|декабре)(?:\s|$)/);
  if (monthOnly && !/\d/.test(t)) {
    const month = MONTHS.find(([stem]) => monthOnly[1].startsWith(stem))?.[1];
    if (month) return { when: "month", month };
  }
  const date = extractDate(t, today, bias);
  if (date) {
    if (/недел/.test(t)) return { when: "week", date };
    if (/(?:^|\s)с\s+\d/.test(t)) return { when: "range", from: date, to: studyWeek(date).at(-1) };
    return { when: "date", date };
  }
  const weekday = WEEKDAYS.find(([stem]) => t.includes(stem));
  if (weekday && /расписан|пар|что у меня|в |на |когда|поставь|оцен|балл|явк/.test(t)) {
    const past = bias === "past" || /прошл/.test(t);
    const date = past ? lastWeekday(today, weekday[1]) : upcomingWeekday(today, weekday[1], /следующ/.test(t));
    return { when: "date", date };
  }
  if (/через неделю|следующ[а-я]*\s+недел/.test(t)) return { when: "next_week" };
  if (/прошл[а-я]*\s+недел/.test(t)) return { when: "prev_week" };
  if (/послезавтра/.test(t)) return { when: "day_after" };
  if (/завтра/.test(t)) return { when: "tomorrow" };
  if (/сегодня/.test(t)) return { when: "today" };
  if (/недел|расписан|что у меня|пары|занят/.test(t)) return { when: "week" };
  return null;
}

function subjectOf(text: string, names: string[]): string | undefined {
  const pool = [...names];
  for (const name of KNOWN_SUBJECTS) if (!pool.includes(name)) pool.push(name);
  const q = text.toLowerCase().replace(/ё/g, "е");
  const aliases: [string, string][] = [
    ["бд", "базы данных"],
    ["базам данных", "базы данных"],
    ["базы данных", "базы данных"],
    ["баз данных", "базы данных"],
    ["программирован", "программирование"],
    ["математическ", "математический анализ"],
    ["матан", "математический анализ"],
    ["линейн", "линейная алгебра"],
    ["линал", "линейная алгебра"],
    ["информационн технолог", "информационные технологии"],
    ["экономик", "экономика фирмы"],
  ];
  for (const [alias, canonical] of aliases) {
    const hit = alias.length <= 3 ? new RegExp(`(^|[^а-яёa-z])${alias}([^а-яёa-z]|$)`).test(q) : q.includes(alias);
    if (!hit) continue;
    const found = pool.find((name) => name.toLowerCase().includes(canonical));
    if (found) return found;
  }
  return pool.find((name) => q.includes(name.toLowerCase()));
}

const ORDINALS: [string, number][] = [
  ["тридцать первое", 31], ["тридцатое", 30], ["двадцать девятое", 29], ["двадцать восьмое", 28], ["двадцать седьмое", 27],
  ["двадцать шестое", 26], ["двадцать пятое", 25], ["двадцать четвертое", 24], ["двадцать третье", 23], ["двадцать второе", 22],
  ["двадцать первое", 21], ["двадцатое", 20], ["девятнадцатое", 19], ["восемнадцатое", 18], ["семнадцатое", 17], ["шестнадцатое", 16],
  ["пятнадцатое", 15], ["четырнадцатое", 14], ["тринадцатое", 13], ["двенадцатое", 12], ["одиннадцатое", 11], ["десятое", 10],
  ["девятое", 9], ["восьмое", 8], ["седьмое", 7], ["шестое", 6], ["пятое", 5], ["четвертое", 4], ["третье", 3], ["второе", 2], ["первое", 1],
];

function calendarDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function termBounds(today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (month >= 9) return { from: `${year}-09-01`, to: `${year + 1}-01-31` };
  if (month === 1) return { from: `${year - 1}-09-01`, to: `${year}-01-31` };
  return { from: `${year}-02-01`, to: `${year}-08-31` };
}

export function impossibleDate(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, "е");
  const named = t.match(/(\d{1,2})\s+(январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]\w*|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)/);
  if (!named) return false;
  const month = MONTHS.find(([stem]) => named[2].startsWith(stem))?.[1];
  if (!month) return false;
  return calendarDate(2000, month, Number(named[1])) == null && calendarDate(2004, month, Number(named[1])) == null;
}

function extractDate(text: string, today: string, _bias: "upcoming" | "past"): string | null {
  const spoken = ORDINALS.find(([word]) => text.includes(word));
  const monthWord = text.match(/(январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]\w*|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)/);
  if (spoken && monthWord) {
    const month = MONTHS.find(([stem]) => monthWord[1].startsWith(stem))?.[1];
    if (month) return withYear(spoken[1], month, today, null);
  }
  const named = text.match(/(\d{1,2})\s+(январ[а-яё]*|феврал[а-яё]*|март[а-яё]*|апрел[а-яё]*|ма[йя][а-яё]*|июн[а-яё]*|июл[а-яё]*|август[а-яё]*|сентябр[а-яё]*|октябр[а-яё]*|ноябр[а-яё]*|декабр[а-яё]*)(?:\s+(\d{4}))?/);
  if (named) {
    const month = MONTHS.find(([stem]) => named[2].startsWith(stem))?.[1];
    const year = named[3] ? Number(named[3]) : null;
    if (month) return withYear(Number(named[1]), month, today, year);
  }
  const numeric = text.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/);
  if (!numeric) return null;
  if (!numeric[3] && numeric[2].length === 1) return null;
  const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
  return withYear(Number(numeric[1]), Number(numeric[2]), today, year);
}

function withYear(day: number, month: number, today: string, year?: number | null): string | null {
  if (year) return calendarDate(year, month, day);
  const term = termBounds(today);
  const base = Number(today.slice(0, 4));
  for (const candidate of [base, base + 1, base - 1]) {
    const date = calendarDate(candidate, month, day);
    if (date && date >= term.from && date <= term.to) return date;
  }
  return calendarDate(base, month, day);
}

function lastWeekday(today: string, weekday: number): string {
  const delta = (weekdayIndex(today) - weekday + 7) % 7;
  return addDays(today, -delta);
}

export function previousStudyWeek(today: string) {
  const from = mondayOf(addDays(today, -7));
  return { from, to: addDays(from, 5) };
}
