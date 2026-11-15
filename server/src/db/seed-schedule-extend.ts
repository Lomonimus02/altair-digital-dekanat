import { and, eq } from "drizzle-orm";
import { addDays, mondayOf, studyWeek, weekdayIndex } from "../../../shared/src/dates";
import { getDb, getPool } from "./client";
import { announcements, assignments, notifications, scheduleItems, users } from "./schema";
import { GROUPS, PAIRS, teacherOnSchedule, type Slot } from "./timetable";

const END = "2026-12-31";
const FROM = "2026-11-16";

const CHANGE_NOTES = {
  room: "Аудитория изменена: была 401, теперь 415",
  cancelled: "Пара отменена: преподаватель на конференции",
  moved: "Перенесено на пятницу, 13:00–14:30, ауд. 314",
} as const;

const HOMEWORK = [
  {
    groupName: "БИ-3-26-04",
    discipline: "Базы данных",
    title: "Лабораторная: транзакции",
    description: "Опишите, где в учебной базе нужна транзакция, и приведите один пример отката.",
    kind: "lab",
    deadline: "2026-11-27",
  },
  {
    groupName: "БИ-3-26-04",
    discipline: "Программирование",
    title: "Задачник: разбор выражения",
    description: "Коротко разберите рекурсивный разбор арифметического выражения.",
    kind: "problem_set",
    deadline: "2026-12-04",
  },
  {
    groupName: "БИ-3-26-04",
    discipline: "Базы данных",
    title: "Конспект: изоляция",
    description: "Одна страница: чем READ COMMITTED отличается от REPEATABLE READ.",
    kind: "reading",
    deadline: "2026-12-11",
  },
  {
    groupName: "ЮР-1-26-02",
    discipline: "Информационные технологии в юридической деятельности",
    title: "Эссе: сроки хранения",
    description: "Когда персональные данные студента пора удалять. До одной страницы.",
    kind: "essay",
    deadline: "2026-11-25",
  },
  {
    groupName: "ЮР-1-26-02",
    discipline: "Информационные технологии в юридической деятельности",
    title: "Лабораторная: журнал доступа",
    description: "Опишите три события, которые должны попасть в журнал доступа к делу.",
    kind: "lab",
    deadline: "2026-12-09",
  },
] as const;

const NEWS = [
  {
    title: "Расписание пар продлено до 31 декабря",
    body: "Учебные недели идут до 31 декабря 2026. Даты зимней аттестации на странице оценок не менялись.",
  },
  {
    title: "Консультации перед зимней аттестацией",
    body: "С 1 декабря преподаватели принимают консультации в те же аудитории, что и пары. Запись не нужна.",
  },
];

export async function extendSchedule() {
  const db = getDb();
  let monday = mondayOf(FROM);
  let weekIndex = 0;
  while (monday <= END) {
    const week = studyWeek(monday).filter((date) => date <= END);
    for (const [groupName, template] of GROUPS) {
      for (const date of week) {
        const slots = template[weekdayIndex(date)] ?? [];
        for (const slot of slots) await insertSlot(groupName, date, slot, "none", null, slot.room);
      }
      await insertWeekChange(groupName, week, weekIndex);
    }
    monday = addDays(monday, 7);
    weekIndex += 1;
  }
  await insertHomework();
  await insertAnnouncements();
  console.log("Расписание продлено до 31 декабря, существующие строки не менялись.");
}

async function insertSlot(
  groupName: string,
  date: string,
  slot: Slot,
  changeType: string,
  changeNote: string | null,
  room: string,
) {
  const db = getDb();
  const existing = await db
    .select({ id: scheduleItems.id })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.groupName, groupName), eq(scheduleItems.date, date), eq(scheduleItems.pairNumber, slot.pair)))
    .limit(1);
  if (existing[0]) return false;
  const time = PAIRS.find((pair) => pair.pair === slot.pair);
  if (!time) return false;
  await db.insert(scheduleItems).values({
    groupName,
    date,
    startsAt: time.start,
    endsAt: time.end,
    discipline: slot.discipline,
    kind: slot.kind,
    room,
    teacher: teacherOnSchedule(slot.teacher),
    changeType,
    changeNote,
    pairNumber: slot.pair,
  });
  return true;
}

async function insertWeekChange(groupName: string, week: string[], weekIndex: number) {
  const thursday = week.find((date) => weekdayIndex(date) === 4) ?? week[0];
  if (!thursday) return;
  const kinds = ["room", "cancelled", "moved"] as const;
  const kind = kinds[(weekIndex + (groupName.startsWith("Ю") ? 1 : 0)) % kinds.length];
  const slot: Slot = groupName.startsWith("Ю")
    ? {
        pair: 3,
        discipline: "Информационные технологии в юридической деятельности",
        kind: "lab",
        room: kind === "room" ? "415" : "505",
        teacher: "доц. Орлов П. Н.",
      }
    : {
        pair: 4,
        discipline: "Программирование",
        kind: "lecture",
        room: kind === "room" ? "415" : "314",
        teacher: "доц. Орлов П. Н.",
      };
  await insertSlot(groupName, thursday, slot, kind, CHANGE_NOTES[kind], slot.room);
}

async function insertHomework() {
  const db = getDb();
  const teacher = (await db.select().from(users).where(eq(users.login, "orlov.pn")).limit(1))[0];
  if (!teacher) return;
  for (const item of HOMEWORK) {
    const existing = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.groupName, item.groupName), eq(assignments.title, item.title)))
      .limit(1);
    if (existing[0]) continue;
    await db.insert(assignments).values({
      groupName: item.groupName,
      discipline: item.discipline,
      teacherId: teacher.id,
      title: item.title,
      description: item.description,
      kind: item.kind,
      issuedOn: addDays(item.deadline, -7),
      deadline: item.deadline,
      attachments: [],
    });
  }
}

async function insertAnnouncements() {
  const db = getDb();
  const staff = (await db.select().from(users).where(eq(users.login, "lebedeva.ip")).limit(1))[0];
  if (!staff) return;
  for (const item of NEWS) {
    const existing = await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.title, item.title)).limit(1);
    if (existing[0]) continue;
    await db.insert(announcements).values({ authorId: staff.id, title: item.title, body: item.body });
    const students = await db.select().from(users).where(eq(users.role, "student"));
    for (const student of students) {
      const sent = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, student.id), eq(notifications.title, item.title)))
        .limit(1);
      if (sent[0]) continue;
      await db.insert(notifications).values({
        userId: student.id,
        kind: "announcement",
        title: item.title,
        body: item.body,
        href: "/notifications",
      });
    }
  }
}

const isMain = process.argv[1]?.includes("seed-schedule-extend.ts") || process.argv[1]?.includes("seed-schedule-extend.js");
if (isMain) {
  extendSchedule()
    .then(() => getPool().end())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
