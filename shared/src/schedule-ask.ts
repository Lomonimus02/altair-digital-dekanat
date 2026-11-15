import { addDays, moscowToday, studyWeek, upcomingWeekday, weekdayIndex } from "./dates";

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

export function scheduleAsk(text: string, names: string[] = [], today = moscowToday()): ScheduleAsk | null {
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
  const date = extractDate(t, today);
  if (date) {
    if (/недел/.test(t)) return { when: "week", date };
    if (/(?:^|\s)с\s+\d/.test(t)) return { when: "range", from: date, to: studyWeek(date).at(-1) };
    return { when: "date", date };
  }
  const weekday = WEEKDAYS.find(([stem]) => t.includes(stem));
  if (weekday && /расписан|пар|что у меня|в |на |когда/.test(t)) {
    return { when: "date", date: upcomingWeekday(today, weekday[1], /следующ/.test(t)) };
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
    if (!q.includes(alias)) continue;
    const found = pool.find((name) => name.toLowerCase().includes(canonical));
    if (found) return found;
  }
  return pool.find((name) => q.includes(name.toLowerCase()));
}

function extractDate(text: string, today: string): string | null {
  const named = text.match(/(\d{1,2})\s+(январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]\w*|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)/);
  if (named) {
    const month = MONTHS.find(([stem]) => named[2].startsWith(stem))?.[1];
    if (month) return withYear(Number(named[1]), month, today);
  }
  const numeric = text.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/);
  if (!numeric) return null;
  const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
  return withYear(Number(numeric[1]), Number(numeric[2]), today, year);
}

function withYear(day: number, month: number, today: string, year?: number | null): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const fallback = Number(today.slice(0, 4));
  let y = year || fallback;
  const iso = (yearNumber: number) => `${yearNumber}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!year && iso(y) < addDays(today, -14)) y += 1;
  const date = iso(y);
  return weekdayIndex(date) >= 0 ? date : null;
}
