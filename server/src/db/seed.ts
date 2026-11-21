import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/crypto";
import { REGULATION_DOCS } from "../content/regulations";
import { closePool, getDb } from "./client";
import {
  announcements,
  auditLog,
  disciplines,
  marks,
  notifications,
  pendingActions,
  regulations,
  reminders,
  requestEvents,
  requests,
  scheduleFlags,
  scheduleItems,
  sessions,
  users,
} from "./schema";
import { academicPeriod, addDays, dueAtMoscow, mondayOf, nearestStudyDay, studyWeek, weekdayIndex } from "../../../shared/src/dates";
import { BI, LAW, PAIRS } from "./timetable";
import { makeVerifyCode } from "../auth/crypto";
import { moscowToday } from "../../../shared/src/dates";

const hashCache = new Map<string, Promise<string>>();
function cachedHash(password: string) {
  let pending = hashCache.get(password);
  if (!pending) {
    pending = hashPassword(password);
    hashCache.set(password, pending);
  }
  return pending;
}

type MarkSeed = { label: string; value: number | null; kind: "current" | "exam" | "credit" };

export async function seed() {
  const db = getDb();
  const today = moscowToday();
  const semester = academicPeriod(today).current.id;
  const [sorokinHash, volkovaHash, staffHash] = await Promise.all([
    cachedHash("Altair-student-31"),
    cachedHash("Altair-student-17"),
    cachedHash("Altair-staff-204"),
  ]);

  await db.transaction(async (tx) => {
    await tx.delete(requestEvents);
    await tx.delete(requests);
    await tx.delete(notifications);
    await tx.delete(reminders);
    await tx.delete(auditLog);
    await tx.delete(pendingActions);
    await tx.delete(scheduleFlags);
    await tx.delete(marks);
    await tx.delete(disciplines);
    await tx.delete(announcements);
    await tx.delete(sessions);
    await tx.delete(users);
    await tx.delete(scheduleItems);
    await tx.delete(regulations);

    for (const table of [
      "users",
      "sessions",
      "schedule_items",
      "disciplines",
      "marks",
      "requests",
      "request_events",
      "notifications",
      "announcements",
      "reminders",
      "audit_log",
      "regulations",
    ]) {
      await tx.execute(sql.raw(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), 1, false)`));
    }

    const [sorokin] = await tx
      .insert(users)
      .values({
        login: "sorokin.mo",
        passwordHash: sorokinHash,
        role: "student",
        fullName: "Сорокин Максим Олегович",
        institute: "Институт экономики и цифрового управления",
        direction: "38.03.05 Бизнес-информатика",
        course: 3,
        groupName: "БИ-3-26-04",
        recordBook: "26-04183",
      })
      .returning();
    const [volkova] = await tx
      .insert(users)
      .values({
        login: "volkova.as",
        passwordHash: volkovaHash,
        role: "student",
        fullName: "Волкова Арина Сергеевна",
        institute: "Юридический институт",
        direction: "40.03.01 Юриспруденция",
        course: 1,
        groupName: "ЮР-1-26-02",
        recordBook: "26-11057",
      })
      .returning();
    const [staff] = await tx
      .insert(users)
      .values({
        login: "lebedeva.ip",
        passwordHash: staffHash,
        role: "staff",
        fullName: "Лебедева Ирина Павловна",
        institute: "Учебный офис",
      })
      .returning();

    const anchor = nearestStudyDay(today);
    const weeks = [-7, 0, 7].map((shift) => studyWeek(addDays(mondayOf(anchor), shift)));
    const currentMonday = mondayOf(anchor);
    const scheduleRows: (typeof scheduleItems.$inferInsert)[] = [];
    for (const [groupName, template] of [
      ["БИ-3-26-04", BI],
      ["ЮР-1-26-02", LAW],
    ] as const) {
      for (const week of weeks) {
        for (const date of week) {
          const weekday = weekdayIndex(date);
          const slots = [...(template[weekday] ?? [])];
          const current = mondayOf(date) === currentMonday;
          if (current && groupName === "БИ-3-26-04" && weekday === 5) {
            slots.push({ pair: 3, discipline: "Программирование", kind: "lecture", room: "314", teacher: "доц. Орлов П. С." });
          }
          for (const slot of slots) {
            const time = PAIRS.find((pair) => pair.pair === slot.pair)!;
            let changeType = "none";
            let changeNote: string | null = null;
            let room = slot.room;
            if (current && groupName === "БИ-3-26-04" && weekday === 4 && slot.pair === 1) {
              changeType = "room";
              room = "415";
              changeNote = "Аудитория изменена: была 401, теперь 415";
            }
            if (current && groupName === "БИ-3-26-04" && weekday === 4 && slot.pair === 2) {
              changeType = "moved";
              changeNote = "Перенесено на пятницу, 13:00–14:30, ауд. 314";
            }
            if (current && groupName === "БИ-3-26-04" && weekday === 4 && slot.pair === 3) {
              changeType = "cancelled";
              changeNote = "Преподаватель на конференции";
            }
            if (current && groupName === "БИ-3-26-04" && weekday === 5 && slot.pair === 3 && slot.discipline === "Программирование") {
              changeType = "moved";
              changeNote = "Перенесено с четверга";
            }
            if (current && groupName === "ЮР-1-26-02" && weekday === 4 && slot.pair === 1) {
              changeType = "cancelled";
              changeNote = "Семинар заменён индивидуальными консультациями";
            }
            scheduleRows.push({
              groupName,
              date,
              startsAt: time.start,
              endsAt: time.end,
              discipline: slot.discipline,
              kind: slot.kind,
              room,
              teacher: slot.teacher,
              changeType,
              changeNote,
              pairNumber: slot.pair,
            });
          }
        }
      }
    }
    await tx.insert(scheduleItems).values(scheduleRows);

    await addDiscipline(tx, sorokin.id, semester, "Математический анализ", "exam", addDays(today, 18), 4, 3, [
      { label: "Контрольная 1", value: 5, kind: "current" },
      { label: "Семинар", value: 4, kind: "current" },
      { label: "Контрольная 2", value: 5, kind: "current" },
    ]);
    await addDiscipline(tx, sorokin.id, semester, "Линейная алгебра", "exam", addDays(today, 5), 4, 3, [
      { label: "Коллоквиум", value: 3, kind: "current" },
      { label: "Семинар", value: 3, kind: "current" },
      { label: "Контрольная", value: 4, kind: "current" },
      { label: "Самостоятельная", value: 2, kind: "current" },
    ]);
    await addDiscipline(tx, sorokin.id, semester, "Базы данных", "exam", addDays(today, 21), 4, 4, [
      { label: "Лабораторная 1", value: 5, kind: "current" },
      { label: "Лабораторная 2", value: 5, kind: "current" },
      { label: "Контрольная", value: 4, kind: "current" },
      { label: "Проект", value: 5, kind: "current" },
    ]);
    await addDiscipline(tx, sorokin.id, semester, "Программирование", "credit", addDays(today, 16), 3, 3, [
      { label: "Лабораторная 1", value: 4, kind: "current" },
      { label: "Лабораторная 2", value: 5, kind: "current" },
      { label: "Лабораторная 3", value: 4, kind: "current" },
    ]);
    await addDiscipline(tx, sorokin.id, semester, "Экономика фирмы", "exam", addDays(today, 12), 3, 3, [
      { label: "Эссе", value: 4, kind: "current" },
      { label: "Семинар", value: 4, kind: "current" },
      { label: "Контрольная", value: 3, kind: "current" },
    ]);
    await addDiscipline(tx, sorokin.id, semester, "Управление проектами", "credit", addDays(today, 9), 2, 2, [
      { label: "Кейс", value: 5, kind: "current" },
      { label: "Защита", value: 5, kind: "current" },
      { label: "Зачёт", value: 1, kind: "credit" },
    ]);

    await addDiscipline(tx, volkova.id, semester, "Теория государства и права", "exam", addDays(today, 20), 3, 3, [
      { label: "Семинар", value: 5, kind: "current" },
      { label: "Контрольная", value: 5, kind: "current" },
      { label: "Эссе", value: 5, kind: "current" },
    ]);
    await addDiscipline(tx, volkova.id, semester, "Конституционное право", "exam", addDays(today, 4), 3, 2, [
      { label: "Семинар", value: 3, kind: "current" },
      { label: "Контрольная", value: 2, kind: "current" },
      { label: "Тест", value: 3, kind: "current" },
    ]);
    await addDiscipline(tx, volkova.id, semester, "Римское право", "credit", addDays(today, 14), 3, 1, [
      { label: "Семинар", value: 3, kind: "current" },
    ]);
    await addDiscipline(tx, volkova.id, semester, "История государства и права", "credit", addDays(today, 11), 2, 2, [
      { label: "Конспект", value: 4, kind: "current" },
      { label: "Семинар", value: 4, kind: "current" },
      { label: "Зачёт", value: 1, kind: "credit" },
    ]);
    await addDiscipline(tx, volkova.id, semester, "Логика", "credit", addDays(today, 15), 2, 2, [
      { label: "Тест", value: 4, kind: "current" },
      { label: "Задачи", value: 5, kind: "current" },
    ]);
    await addDiscipline(tx, volkova.id, semester, "Информационные технологии в юридической деятельности", "exam", addDays(today, 19), 3, 3, [
      { label: "Лабораторная", value: 4, kind: "current" },
      { label: "Тест", value: 4, kind: "current" },
      { label: "Проект", value: 5, kind: "current" },
    ]);

    const verify = makeVerifyCode();
    const [study] = await tx
      .insert(requests)
      .values({
        studentId: sorokin.id,
        kind: "study_certificate",
        title: "Справка об обучении",
        purpose: "Для предъявления по месту требования",
        body: "Нужна справка об обучении.",
        status: "issued",
        verifyCode: verify,
      })
      .returning();
    const [military] = await tx
      .insert(requests)
      .values({
        studentId: sorokin.id,
        kind: "military_certificate",
        title: "Справка для военкомата",
        purpose: "Для предоставления в военный комиссариат",
        body: "Нужна к началу следующей недели.",
        status: "in_progress",
        resultNote: "Сверяем сведения группы.",
      })
      .returning();
    const [leave] = await tx
      .insert(requests)
      .values({
        studentId: volkova.id,
        kind: "academic_leave",
        title: "Заявление на академический отпуск",
        purpose: "Прошу предоставить академический отпуск",
        body: "По семейным обстоятельствам на один семестр.",
        status: "rejected",
        rejectionReason: "Не приложены подтверждающие документы. Подайте заявление повторно с основанием (п. 4.2 Положения об академическом отпуске).",
      })
      .returning();

    await tx.insert(requestEvents).values([
      { requestId: study.id, status: "submitted", comment: "Заявление принято", actorId: sorokin.id },
      { requestId: study.id, status: "ready", comment: "Справка сформирована автоматически", actorId: null },
      { requestId: study.id, status: "issued", comment: "Доступна для скачивания", actorId: null },
      { requestId: military.id, status: "submitted", comment: "Заявление принято", actorId: sorokin.id },
      { requestId: military.id, status: "in_progress", comment: "Сверяем сведения группы.", actorId: staff.id },
      { requestId: leave.id, status: "submitted", comment: "Заявление принято", actorId: volkova.id },
      {
        requestId: leave.id,
        status: "rejected",
        comment: "Не приложены подтверждающие документы. Подайте заявление повторно с основанием (п. 4.2 Положения об академическом отпуске).",
        actorId: staff.id,
      },
    ]);

    const [sessionNews] = await tx
      .insert(announcements)
      .values({
        authorId: staff.id,
        title: "Зимняя сессия: автоматы и долги",
        body: "Автомат считается по положению об аттестации. Справки об обучении можно заказать в кабинете — бланк появится сразу. Военкомат готовит учебный офис.",
      })
      .returning();
    await tx.insert(announcements).values({
      authorId: staff.id,
      title: "Часы приёма учебного офиса",
      body: "Будни с 10:00 до 17:00, аудитория 100. Заявления из кабинета обрабатываем в эти же часы.",
    });

    await tx.insert(notifications).values([
      {
        userId: sorokin.id,
        kind: "schedule",
        title: "Изменение в расписании",
        body: "В четверг линейная алгебра переехала в аудиторию 415, программирование перенесено на пятницу, экономика фирмы отменена.",
        href: "/schedule",
      },
      {
        userId: sorokin.id,
        kind: "request",
        title: `Заявка №${military.id}: в работе`,
        body: "Справка для военкомата уже у учебного офиса. Сверяем сведения группы.",
        href: `/requests/${military.id}`,
      },
      {
        userId: sorokin.id,
        kind: "announcement",
        title: sessionNews.title,
        body: sessionNews.body,
        href: "/notifications",
        readAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
      {
        userId: volkova.id,
        kind: "schedule",
        title: "Семинар отменён",
        body: "В четверг семинар по конституционному праву заменён индивидуальными консультациями.",
        href: "/schedule",
      },
      {
        userId: volkova.id,
        kind: "request",
        title: `Заявка №${leave.id} отклонена`,
        body: "Не приложены подтверждающие документы. Подайте заявление повторно с основанием (п. 4.2).",
        href: `/requests/${leave.id}`,
      },
      {
        userId: volkova.id,
        kind: "announcement",
        title: sessionNews.title,
        body: sessionNews.body,
        href: "/notifications",
      },
    ]);

    await tx.insert(reminders).values([
      { userId: sorokin.id, title: "Черновик по базам данных", dueAt: dueAtMoscow("tomorrow", "09:00", today) },
      { userId: volkova.id, title: "Консультация по конституционному праву", dueAt: dueAtMoscow("day_after", "12:00", today) },
    ]);

    await tx.insert(regulations).values(REGULATION_DOCS.map((doc) => ({ slug: doc.slug, title: doc.title, body: doc.body })));
  });
  const { backfillJournal } = await import("../journal");
  await backfillJournal();
}

async function addDiscipline(
  tx: Pick<ReturnType<typeof getDb>, "insert">,
  studentId: number,
  semester: string,
  name: string,
  controlForm: "exam" | "credit",
  sessionDate: string,
  obligatoryTotal: number,
  obligatoryDone: number,
  markList: MarkSeed[],
) {
  const [row] = await tx
    .insert(disciplines)
    .values({ studentId, semester, name, controlForm, sessionDate, obligatoryTotal, obligatoryDone })
    .returning();
  if (!markList.length) return;
  await tx.insert(marks).values(
    markList.map((mark, index) => ({
      disciplineId: row.id,
      studentId,
      label: mark.label,
      value: mark.value,
      kind: mark.kind,
      awardedOn: addDays(moscowToday(), -30 + index * 4),
    })),
  );
}

const isMain = process.argv[1]?.includes("seed.ts") || process.argv[1]?.includes("seed.js");
if (isMain) {
  seed()
    .then(async () => {
      console.log("Демо-данные записаны");
      await closePool();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
