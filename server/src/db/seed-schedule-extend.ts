import { and, asc, eq, ne, or, sql } from "drizzle-orm";
import { addDays, formatDdMm, mondayOf, studyWeek, weekdayIndex } from "../../../shared/src/dates";
import { getDb, getPool } from "./client";
import { announcements, assignments, notifications, scheduleItems, users } from "./schema";
import { GROUPS, PAIRS, teacherOnSchedule, usualRoom, type Slot } from "./timetable";

const END = "2026-12-31";
const FROM = "2026-11-16";

const CHANGE_NOTES = {
  cancelled: "Пара отменена: преподаватель на конференции",
  moved: "Перенесено на пятницу, 13:00–14:30, ауд. 314",
} as const;

function roomChangeNote(usual: string, next: string) {
  return `Аудитория изменена: была ${usual}, теперь ${next}`;
}

const HOMEWORK = [
  {
    groupName: "БИ-3-26-04",
    discipline: "Базы данных",
    title: "Лабораторная: транзакции",
    description: "Опишите, где в учебной базе нужна транзакция, и приведите один пример\u00A0отката.",
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
  await backfillMovedTargets();
  await unifyLawItTeacher();
  await fixChangeNotes();
  await insertHomework();
  await insertAnnouncements();
  console.log("Расписание продлено до 31 декабря. Оценки и сдачи не менялись. Переносы дополнены пятницей.");
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
    .orderBy(asc(scheduleItems.id))
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
  const usual = usualRoom(groupName, slot.discipline, slot.kind);
  const note = kind === "room" ? roomChangeNote(usual ?? slot.room, slot.room) : CHANGE_NOTES[kind];
  await insertSlot(groupName, thursday, slot, kind, note, slot.room);
}

async function backfillMovedTargets() {
  const db = getDb();
  const moved = await db.select().from(scheduleItems).where(eq(scheduleItems.changeType, "moved")).orderBy(asc(scheduleItems.id));
  for (const row of moved) {
    const note = (row.changeNote ?? "").toLowerCase();
    if (!note.includes("пятниц") || note.startsWith("перенесено с")) continue;
    const friday = addDays(row.date, 1);
    if (weekdayIndex(friday) !== 5 || friday > END) continue;
    const sameDay = await db
      .select()
      .from(scheduleItems)
      .where(and(eq(scheduleItems.groupName, row.groupName), eq(scheduleItems.date, friday)))
      .orderBy(asc(scheduleItems.pairNumber), asc(scheduleItems.id));
    const already = sameDay.find((item) => item.discipline === row.discipline && (item.changeNote ?? "").toLowerCase().startsWith("перенесено с"));
    if (already) continue;
    const used = new Set(sameDay.map((item) => item.pairNumber));
    const pair = [3, 4, 1, 2].find((number) => !used.has(number));
    const time = PAIRS.find((item) => item.pair === pair);
    if (!pair || !time) continue;
    await db.insert(scheduleItems).values({
      groupName: row.groupName,
      date: friday,
      startsAt: pair === 3 ? "13:00" : time.start,
      endsAt: pair === 3 ? "14:30" : time.end,
      discipline: row.discipline,
      kind: row.kind,
      room: "314",
      teacher: row.teacher,
      changeType: "moved",
      changeNote: `Перенесено с четверга, ${formatDdMm(row.date)}`,
      pairNumber: pair,
    });
  }
}

async function fixChangeNotes() {
  const db = getDb();
  const rows = await db.select().from(scheduleItems).orderBy(asc(scheduleItems.id));
  for (const row of rows) {
    if (!row.changeNote) continue;
    let note = row.changeNote;
    if (row.changeType === "room" && row.room) {
      const usual = usualRoom(row.groupName, row.discipline, row.kind);
      if (usual) note = roomChangeNote(usual, row.room);
    }
    note = note.replace(/, (\d)\.(\d{2})$/g, (_, day: string, month: string) => `, 0${day}.${month}`);
    if (note !== row.changeNote) {
      await db.update(scheduleItems).set({ changeNote: note }).where(eq(scheduleItems.id, row.id));
    }
    if (row.changeType === "room") await syncRoomNotification(row, note);
  }
}

async function syncRoomNotification(row: { id: number; date: string; discipline: string }, note: string) {
  const db = getDb();
  const canonical = `${formatDdMm(row.date)} ${row.discipline}: ${note}`;
  const href = `/schedule?date=${row.date}&item=${row.id}`;
  const legacy = `${formatDdMm(row.date)} ${row.discipline}:`;
  await db
    .update(notifications)
    .set({ body: canonical, href })
    .where(
      and(
        eq(notifications.title, "Изменение в расписании"),
        or(
          sql`${notifications.href} like ${"%item=" + row.id + "%"}`,
          and(sql`${notifications.body} like ${legacy + "%"}`, sql`${notifications.body} like ${"%Аудитория изменена%"}`),
        ),
        sql`${notifications.body} is distinct from ${canonical}`,
      ),
    );
}

async function unifyLawItTeacher() {
  const db = getDb();
  await db
    .update(scheduleItems)
    .set({ teacher: "доц. Орлов П. Н." })
    .where(
      and(
        eq(scheduleItems.groupName, "ЮР-1-26-02"),
        eq(scheduleItems.discipline, "Информационные технологии в юридической деятельности"),
        ne(scheduleItems.teacher, "доц. Орлов П. Н."),
      ),
    );
}

async function insertHomework() {
  const db = getDb();
  const teacher = (await db.select().from(users).where(eq(users.login, "orlov.pn")).orderBy(asc(users.id)).limit(1))[0];
  if (!teacher) return;
  for (const item of HOMEWORK) {
    const existing = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.groupName, item.groupName), eq(assignments.title, item.title)))
      .orderBy(asc(assignments.id))
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
  const staff = (await db.select().from(users).where(eq(users.login, "lebedeva.ip")).orderBy(asc(users.id)).limit(1))[0];
  if (!staff) return;
  for (const item of NEWS) {
    const existing = await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.title, item.title)).orderBy(asc(announcements.id)).limit(1);
    if (existing[0]) continue;
    await db.insert(announcements).values({ authorId: staff.id, title: item.title, body: item.body });
    const students = await db.select().from(users).where(eq(users.role, "student")).orderBy(asc(users.login), asc(users.id));
    for (const student of students) {
      const sent = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, student.id), eq(notifications.title, item.title)))
        .orderBy(asc(notifications.id))
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
