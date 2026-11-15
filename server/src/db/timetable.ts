export type Slot = {
  pair: number;
  discipline: string;
  kind: "lecture" | "seminar" | "lab" | "practice";
  room: string;
  teacher: string;
};

export const PAIRS = [
  { pair: 1, start: "09:00", end: "10:30" },
  { pair: 2, start: "10:40", end: "12:10" },
  { pair: 3, start: "13:00", end: "14:30" },
  { pair: 4, start: "14:40", end: "16:10" },
];

/** 1 = понедельник … 6 = суббота. Преподаватель в шаблоне сида — «П. С.»; продление подставляет «П. Н.». */
export const BI: Record<number, Slot[]> = {
  1: [
    { pair: 1, discipline: "Математический анализ", kind: "lecture", room: "314", teacher: "доц. Белов А. Н." },
    { pair: 2, discipline: "Линейная алгебра", kind: "seminar", room: "209", teacher: "ст. преп. Каримова Л. Р." },
    { pair: 3, discipline: "Базы данных", kind: "lab", room: "512", teacher: "доц. Орлов П. С." },
  ],
  2: [
    { pair: 1, discipline: "Программирование", kind: "lab", room: "508", teacher: "доц. Орлов П. С." },
    { pair: 2, discipline: "Экономика фирмы", kind: "lecture", room: "101", teacher: "проф. Демина Е. В." },
    { pair: 3, discipline: "Английский язык", kind: "seminar", room: "220", teacher: "преп. Новак И. П." },
  ],
  3: [
    { pair: 1, discipline: "Математический анализ", kind: "seminar", room: "209", teacher: "доц. Белов А. Н." },
    { pair: 2, discipline: "Правоведение", kind: "lecture", room: "118", teacher: "доц. Мишин Г. А." },
    { pair: 4, discipline: "Базы данных", kind: "lecture", room: "314", teacher: "доц. Орлов П. С." },
  ],
  4: [
    { pair: 1, discipline: "Линейная алгебра", kind: "lecture", room: "401", teacher: "ст. преп. Каримова Л. Р." },
    { pair: 2, discipline: "Программирование", kind: "lecture", room: "314", teacher: "доц. Орлов П. С." },
    { pair: 3, discipline: "Экономика фирмы", kind: "seminar", room: "101", teacher: "проф. Демина Е. В." },
  ],
  5: [
    { pair: 1, discipline: "Управление проектами", kind: "seminar", room: "222", teacher: "доц. Фролова М. Д." },
    { pair: 2, discipline: "Английский язык", kind: "seminar", room: "220", teacher: "преп. Новак И. П." },
  ],
  6: [{ pair: 1, discipline: "Физическая культура", kind: "practice", room: "Спортзал", teacher: "преп. Гусев Н. И." }],
};

export const LAW: Record<number, Slot[]> = {
  1: [
    { pair: 1, discipline: "Теория государства и права", kind: "lecture", room: "410", teacher: "проф. Савельев И. К." },
    { pair: 2, discipline: "Римское право", kind: "seminar", room: "216", teacher: "доц. Ершова Н. В." },
    { pair: 3, discipline: "Иностранный язык", kind: "seminar", room: "225", teacher: "преп. Новак И. П." },
  ],
  2: [
    { pair: 1, discipline: "Конституционное право", kind: "lecture", room: "410", teacher: "проф. Савельев И. К." },
    { pair: 2, discipline: "История государства и права", kind: "lecture", room: "118", teacher: "доц. Мишин Г. А." },
  ],
  3: [
    { pair: 1, discipline: "Теория государства и права", kind: "seminar", room: "216", teacher: "доц. Ершова Н. В." },
    { pair: 2, discipline: "Логика", kind: "seminar", room: "230", teacher: "доц. Бельская А. М." },
  ],
  4: [
    { pair: 1, discipline: "Конституционное право", kind: "seminar", room: "216", teacher: "проф. Савельев И. К." },
    { pair: 2, discipline: "Физическая культура", kind: "practice", room: "Спортзал", teacher: "преп. Гусев Н. И." },
  ],
  5: [
    { pair: 1, discipline: "Информационные технологии в юридической деятельности", kind: "lab", room: "505", teacher: "ст. преп. Котов Д. Л." },
    { pair: 2, discipline: "Римское право", kind: "lecture", room: "410", teacher: "доц. Ершова Н. В." },
  ],
  6: [],
};

export const GROUPS = [
  ["БИ-3-26-04", BI],
  ["ЮР-1-26-02", LAW],
] as const;

export function teacherOnSchedule(name: string) {
  return name.replace("доц. Орлов П. С.", "доц. Орлов П. Н.");
}

export function usualRoom(groupName: string, discipline: string, kind: string): string | null {
  const template = GROUPS.find(([name]) => name === groupName)?.[1];
  if (!template) return null;
  const slots = Object.values(template).flat();
  return slots.find((slot) => slot.discipline === discipline && slot.kind === kind)?.room ?? slots.find((slot) => slot.discipline === discipline)?.room ?? null;
}
