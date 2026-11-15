import { and, eq } from "drizzle-orm";
import { academicPeriod, addDays, moscowToday, weekdayIndex } from "../../../shared/src/dates";
import { hashPassword } from "../auth/crypto";
import { getDb, getPool } from "./client";
import { assignments, attendance, disciplines, marks, notifications, scheduleItems, submissions, teachingLoad, users } from "./schema";

const TEACHER = {
  login: "orlov.pn",
  password: "Altair-teacher-58",
  fullName: "Орлов Пётр Николаевич",
  institute: "Институт цифровых систем",
};

const LOAD = [
  { groupName: "БИ-3-26-04", discipline: "Базы данных" },
  { groupName: "БИ-3-26-04", discipline: "Программирование" },
  { groupName: "ЮР-1-26-02", discipline: "Информационные технологии в юридической деятельности" },
];

function nextFriday(today: string) {
  const delta = (5 - weekdayIndex(today) + 7) % 7 || 7;
  return addDays(today, delta);
}

async function notifyOnce(userId: number, title: string, body: string, href: string) {
  const db = getDb();
  const existing = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.title, title))).limit(1);
  if (existing[0]) return;
  await db.insert(notifications).values({ userId, kind: "homework", title, body, href });
}

export async function seedHomework() {
  const db = getDb();
  const today = moscowToday();
  await db.update(scheduleItems).set({ teacher: "доц. Орлов П. Н." }).where(eq(scheduleItems.teacher, "доц. Орлов П. С."));

  let teacher = (await db.select().from(users).where(eq(users.login, TEACHER.login)).limit(1))[0];
  if (!teacher) {
    const [created] = await db
      .insert(users)
      .values({
        login: TEACHER.login,
        passwordHash: await hashPassword(TEACHER.password),
        role: "teacher",
        fullName: TEACHER.fullName,
        institute: TEACHER.institute,
        theme: "system",
        showCancelled: true,
      })
      .returning();
    teacher = created;
  }

  for (const row of LOAD) {
    const exists = await db
      .select({ id: teachingLoad.id })
      .from(teachingLoad)
      .where(and(eq(teachingLoad.teacherId, teacher.id), eq(teachingLoad.groupName, row.groupName), eq(teachingLoad.discipline, row.discipline)))
      .limit(1);
    if (!exists[0]) await db.insert(teachingLoad).values({ teacherId: teacher.id, groupName: row.groupName, discipline: row.discipline });
  }

  const students = await db.select().from(users).where(eq(users.role, "student"));
  const byGroup = (group: string) => students.find((row) => row.groupName === group);

  const lesson = async (group: string, discipline: string) => {
    const rows = await db.select().from(scheduleItems).where(and(eq(scheduleItems.groupName, group), eq(scheduleItems.discipline, discipline))).limit(1);
    return rows[0]?.id ?? null;
  };

  const plan = [
    {
      group: "БИ-3-26-04",
      discipline: "Базы данных",
      title: "Задачник: нормальные формы",
      description: "Привести две таблицы к третьей нормальной форме и коротко объяснить, зачем.",
      kind: "problem_set",
      deadline: addDays(today, -2),
      status: "not_started" as const,
      body: "",
      comment: null as string | null,
      score: null as number | null,
    },
    {
      group: "БИ-3-26-04",
      discipline: "Базы данных",
      title: "Лабораторная: SELECT",
      description: "Три запроса к учебной базе: фильтр, соединение и группировка.",
      kind: "lab",
      deadline: today,
      status: "in_progress" as const,
      body: "Готов первый запрос, соединение ещё пишу.",
      comment: null,
      score: null,
    },
    {
      group: "БИ-3-26-04",
      discipline: "Базы данных",
      title: "Лабораторная: индексы",
      description: "Сравнить план запроса до и после индекса.",
      kind: "lab",
      deadline: addDays(today, 3),
      status: "in_review" as const,
      body: "Приложил оба плана. Индекс ускорил выборку примерно вчетверо.",
      comment: null,
      score: null,
    },
    {
      group: "БИ-3-26-04",
      discipline: "Базы данных",
      title: "Лабораторная: ER-модель",
      description: "Схема «зачётка — дисциплина — оценка».",
      kind: "lab",
      deadline: addDays(today, -6),
      status: "graded" as const,
      body: "Схема в ссылке.",
      comment: "Связи верные, подписи сущностей аккуратные.",
      score: 5,
    },
    {
      group: "БИ-3-26-04",
      discipline: "Программирование",
      title: "Конспект: рекурсия",
      description: "Одна страница: базовый случай и пример.",
      kind: "reading",
      deadline: addDays(today, 1),
      status: "returned" as const,
      body: "Базовый случай описал, примера нет.",
      comment: "Добавьте короткий пример на Python.",
      score: null,
    },
    {
      group: "ЮР-1-26-02",
      discipline: "Информационные технологии в юридической деятельности",
      title: "Эссе: персональные данные",
      description: "Когда вузу нужно согласие студента, а когда нет. До одной страницы.",
      kind: "essay",
      deadline: addDays(today, -1),
      status: "not_started" as const,
      body: "",
      comment: null,
      score: null,
    },
    {
      group: "ЮР-1-26-02",
      discipline: "Информационные технологии в юридической деятельности",
      title: "Чтение: регламент доступа",
      description: "Выпишите три правила из учебного регламента.",
      kind: "reading",
      deadline: today,
      status: "in_progress" as const,
      body: "Два правила уже выписала.",
      comment: null,
      score: null,
    },
    {
      group: "ЮР-1-26-02",
      discipline: "Информационные технологии в юридической деятельности",
      title: "Лабораторная: реестр",
      description: "Карточка дела: поля, кто видит, кто меняет.",
      kind: "lab",
      deadline: nextFriday(today),
      status: "in_review" as const,
      body: "Карточка готова, права расписала.",
      comment: null,
      score: null,
    },
    {
      group: "ЮР-1-26-02",
      discipline: "Информационные технологии в юридической деятельности",
      title: "Проект: карточка дела",
      description: "Короткий прототип карточки.",
      kind: "project",
      deadline: addDays(today, -4),
      status: "graded" as const,
      body: "Ссылка на макет.",
      comment: "Структура ясная.",
      score: 4,
    },
  ];

  for (const item of plan) {
    const student = byGroup(item.group);
    if (!student) continue;
    let assignment = (
      await db.select().from(assignments).where(and(eq(assignments.groupName, item.group), eq(assignments.title, item.title))).limit(1)
    )[0];
    if (!assignment) {
      const scheduleItemId = await lesson(item.group, item.discipline);
      const [created] = await db
        .insert(assignments)
        .values({
          groupName: item.group,
          discipline: item.discipline,
          teacherId: teacher.id,
          title: item.title,
          description: item.description,
          kind: item.kind,
          maxScore: 5,
          issuedOn: addDays(item.deadline, -7),
          deadline: item.deadline,
          scheduleItemId,
          attachments: [{ title: "Учебный бланк", href: "https://example.com/altair-blank" }],
        })
        .returning();
      assignment = created;
      await notifyOnce(student.id, `Новое задание: ${item.title}`, `Срок ${item.deadline}.`, `/homework/${assignment.id}`);
    }
    if (item.status === "not_started") continue;
    const existing = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignment.id), eq(submissions.studentId, student.id)))
      .limit(1);
    if (!existing[0]) {
      await db.insert(submissions).values({
        assignmentId: assignment.id,
        studentId: student.id,
        status: item.status,
        body: item.body,
        links: [],
        teacherComment: item.comment,
        score: item.score,
      });
    }
    if (item.status === "returned" && item.comment) {
      await notifyOnce(student.id, `Вернули на доработку: ${item.title}`, item.comment, `/homework/${assignment.id}`);
    }
    if (item.status === "graded" && item.score) {
      await notifyOnce(student.id, `Оценка за «${item.title}»: ${item.score}`, item.comment ?? "Работа проверена.", `/homework/${assignment.id}`);
    }
  }

  const tomorrowTitle = "Завтра срок: Конспект: рекурсия";
  const sorokin = byGroup("БИ-3-26-04");
  if (sorokin) await notifyOnce(sorokin.id, tomorrowTitle, "Конспект по рекурсии нужно сдать завтра.", "/homework");
  await seedClassmates(today);
  console.log("Задания и преподаватель на месте, существующие данные не стирались.");
}

async function seedClassmates(today: string) {
  const db = getDb();
  const semester = academicPeriod(today).current.id;
  const groups: Record<string, { discipline: string; names: string[] }> = {
    "БИ-3-26-04": {
      discipline: "Базы данных",
      names: ["Белова Мария Игоревна", "Громов Артём Сергеевич", "Данилова Ева Павловна", "Егоров Илья Дмитриевич", "Жукова Софья Андреевна", "Зайцев Кирилл Романович", "Ильина Полина Олеговна", "Ковалёв Никита Артёмович", "Лебедев Степан Ильич", "Морозова Алина Викторовна"],
    },
    "ЮР-1-26-02": {
      discipline: "Информационные технологии в юридической деятельности",
      names: ["Новикова Дарья Сергеевна", "Орлова Милана Павловна", "Павлов Глеб Андреевич", "Романова Кира Игоревна", "Семёнов Лев Петрович", "Тихонова Агата Максимовна", "Устинов Марк Алексеевич", "Фролова Вера Николаевна", "Харитонов Пётр Олегович", "Чернова Яна Денисовна"],
    },
  };
  const passwordHash = await hashPassword("Altair-classmate-1");
  for (const [group, pack] of Object.entries(groups)) {
    const assignment = (await db.select().from(assignments).where(eq(assignments.groupName, group)).limit(1))[0];
    let index = 1;
    for (const fullName of pack.names) {
      const login = `${group.startsWith("Б") ? "bi" : "jur"}.${String(index).padStart(2, "0")}`;
      index += 1;
      let person = (await db.select().from(users).where(eq(users.login, login)).limit(1))[0];
      if (!person) {
        const [created] = await db.insert(users).values({
          login,
          passwordHash,
          role: "student",
          fullName,
          institute: group.startsWith("Б") ? "Институт цифровых систем" : "Юридический институт",
          groupName: group,
          course: group.startsWith("Б") ? 3 : 1,
          theme: "system",
          showCancelled: true,
        }).returning();
        person = created;
      }
      const subject = (await db.select().from(disciplines).where(and(eq(disciplines.studentId, person.id), eq(disciplines.name, pack.discipline))).limit(1))[0];
      let disciplineId = subject?.id;
      if (!disciplineId) {
        const [created] = await db.insert(disciplines).values({
          studentId: person.id,
          name: pack.discipline,
          controlForm: "exam",
          sessionDate: addDays(today, 21),
          obligatoryTotal: 3,
          obligatoryDone: 1,
          semester,
        }).returning();
        disciplineId = created.id;
        await db.insert(marks).values({ disciplineId, studentId: person.id, label: "Семинар", value: 4, kind: "current", awardedOn: addDays(today, -10) });
      }
      const visit = await db.select({ id: attendance.id }).from(attendance).where(and(eq(attendance.studentId, person.id), eq(attendance.lessonDate, addDays(today, -2)))).limit(1);
      if (!visit[0]) {
        await db.insert(attendance).values({ teacherId: (await db.select().from(users).where(eq(users.login, "orlov.pn")).limit(1))[0].id, studentId: person.id, groupName: group, discipline: pack.discipline, lessonDate: addDays(today, -2), present: index % 4 !== 0 });
      }
      if (assignment && index % 3 === 0) {
        const sent = await db.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.assignmentId, assignment.id), eq(submissions.studentId, person.id))).limit(1);
        if (!sent[0]) {
          await db.insert(submissions).values({ assignmentId: assignment.id, studentId: person.id, status: "in_review", body: "Черновик одногруппника.", links: [] });
        }
      }
    }
  }
}

const isMain = process.argv[1]?.includes("seed-homework.ts") || process.argv[1]?.includes("seed-homework.js");
if (isMain) {
  const job = process.argv.includes("--classmates") ? seedClassmates(moscowToday()).then(() => console.log("Одногруппники на месте, существующие пользователи не менялись.")) : seedHomework();
  job
    .then(() => getPool().end())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
