import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { moscowToday, setClock } from "../../shared/src/dates";
import { samePerson } from "../../shared/src/names";
import { parseIntent } from "../../shared/src/parser";
import { impossibleDate, scheduleAsk } from "../../shared/src/schedule-ask";
import { buildApp } from "../src/app";
import { getPool } from "../src/db/client";
import { seed } from "../src/db/seed";
import { seedHomework } from "../src/db/seed-homework";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});
beforeEach(async () => {
  setClock("2026-11-21T12:00:00+03:00");
  await seed();
  await seedHomework();
});
afterEach(() => {
  setClock(null);
  delete process.env.LOCAL_LLM_URL;
  delete process.env.LOCAL_LLM_TIMEOUT_MS;
});

async function login(loginName: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: loginName, password } });
  expect(res.statusCode, res.body).toBe(200);
  const lines = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"] ?? ""];
  const jar: Record<string, string> = {};
  for (const line of lines) {
    const [pair] = line.split(";");
    const [key, value] = pair.split("=");
    jar[key] = value;
  }
  return { cookie: `sid=${jar.sid}; csrf=${jar.csrf}`, csrf: res.json().csrfToken as string };
}

function act(session: { cookie: string; csrf: string }, action: string, args: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/actions", payload: { action, args }, headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
}

async function turn(session: { cookie: string; csrf: string }, message: string) {
  const res = await app.inject({ method: "POST", url: "/api/agent/turn", headers: { cookie: session.cookie, "x-csrf-token": session.csrf }, payload: { message, mode: "fallback" } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { say: string; confirm?: { fields: { label: string; value: string }[]; pendingId: string }; choices?: { label: string; entityId: string; clarificationId: string }[] };
}

it("без пары новую оценку не создаёт и предлагает ближайшие", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const saturday = await turn(teacher, "поставь 5 Сорокину за 21 ноября по базам данных");
  expect(saturday.say).toMatch(/21\.11 пары по «Базы данных» не было/);
  expect(saturday.say).toMatch(/18\.11 \(ср\)/);
  expect(saturday.confirm).toBeUndefined();
  const other = await turn(teacher, "поставь 5 Сорокину за контрольную 19.11 по базам данных");
  expect(other.say).toMatch(/не было|Какую\?/);
  expect(other.say).not.toMatch(/всё равно/);
  const sunday = await turn(teacher, "поставь 5 Сорокину 22.11 по базам");
  expect(sunday.say).toMatch(/не было|будущего/);
  const start = await turn(teacher, "поставь 5 Сорокину 01.09 по базам");
  expect(start.say).toMatch(/не было|семестра/);
  const moved = await turn(teacher, "поставь 5 Сорокину за контрольную 19.11 по программированию");
  expect(moved.say).toMatch(/19\.11 пары по «Программирование» не было/);
  expect(moved.say).toMatch(/20\.11/);
  const absent = await turn(teacher, "поставь Сорокину н 21.11 по базам");
  expect(absent.say).toMatch(/не было|пары не было/);
});

it("без даты берёт последнюю прошедшую пару, а старую колонку без пары всё ещё можно править", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const open = await turn(teacher, "поставь 8 Сорокину за контрольную по базам данных");
  const dated = open.confirm?.fields.find((field) => field.label === "Дата")?.value;
  if (dated) expect(dated).toMatch(/18\.11/);
  else expect(open.say).toMatch(/Какую\?|18\.11/);
  expect(open.say).not.toMatch(/всё равно/);
  const pool = getPool();
  const old = await pool.query("select id from journal_columns where group_name='БИ-3-26-04' and discipline='Базы данных' and lesson_date < '2026-11-01' limit 1");
  if (old.rows[0]) {
    const graded = await act(teacher, "teacher_set_mark", { columnId: old.rows[0].id, studentName: "Сорокин", points: 6 });
    expect(graded.statusCode, graded.body).toBe(200);
  }
});

it("баллы и имена разбираются целиком", () => {
  for (const [phrase, points] of [
    ["поставь 0 баллов Сорокину за контрольную", 0],
    ["поставь 1 Сорокину за контрольную", 1],
    ["поставь 4 Сорокину за контрольную", 4],
    ["поставь 7 Сорокину за контрольную", 7],
    ["поставь 10 Сорокину за контрольную", 10],
    ["поставь 12 Сорокину за контрольную", 12],
    ["поставь 1000 Сорокину за контрольную", 1000],
    ["поставь 5,5 Сорокину за контрольную", 5.5],
    ["поставь Сорокину 7.5 за контрольную", 7.5],
    ["поставь пять Сорокину за контрольную", 5],
  ] as const) {
    const step = parseIntent(phrase, "teacher").steps[0];
    expect(step?.tool, phrase).toBe("teacher_set_mark");
    expect(step?.args.points, phrase).toBe(points);
  }
  expect(parseIntent("поставь 7,3 Сорокину за контрольную", "teacher").say).toMatch(/шагом 0,5/);
  expect(parseIntent("поставь -3 Сорокину за контрольную", "teacher").say).toMatch(/трицательн/);
  expect(parseIntent("поставь пятёрку Сорокину", "teacher").say).toMatch(/Сколько из 10/);
  for (const phrase of ["Даниловой 8 за контрольную", "Егорову 8 за контрольную", "Зайцеву 8 за контрольную", "Морозовой 8 за контрольную", "Ковалёву 8 за контрольную", "поставь 8 Даниловой Е. П. за контрольную", "поставь 8 Данилова Ева Павловна за контрольную", "поставь 8 громов артем за контрольную"]) {
    const step = parseIntent(phrase, "teacher").steps[0];
    expect(step?.tool, phrase).toBe("teacher_set_mark");
    expect(String(step?.args.studentName), phrase).toMatch(/данилов|егоров|зайцев|морозов|ковал|громов/i);
  }
  expect(samePerson("громов артем", "Громов Артём Сергеевич")).toBe(true);
  expect(samePerson("Даниловой", "Данилова Ева Павловна")).toBe(true);
  expect(journalDateSafe("7.5")).toBeUndefined();
});

it("явная дата семестра не уезжает в другой год, а невозможная дата называется", () => {
  expect(scheduleAsk("22.10", [], "2026-11-21", "past")?.date).toBe("2026-10-22");
  expect(scheduleAsk("восемнадцатое ноября", [], "2026-11-21")?.date).toBe("2026-11-18");
  expect(impossibleDate("31 ноября")).toBe(true);
  expect(parseIntent("поставь 5 Сорокину 31 ноября", "teacher").say).toMatch(/Такой даты нет/);
  expect(parseIntent("поставь 5 Сорокину в понедельник по базам", "teacher").steps[0]?.args.date).toBe("2026-11-16");
  expect(parseIntent("что завтра", "student").steps[0]?.args.when).toBe("tomorrow");
});

it("суббота не называет завтра сегодняшним воскресеньем", async () => {
  const student = await login("sorokin.mo", "Altair-student-31");
  const answer = await turn(student, "что завтра");
  expect(answer.say).not.toContain("Сегодня воскресенье");
});

it("отмена оценки возвращает строку байт в байт", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const pool = getPool();
  const first = await act(teacher, "teacher_set_mark", { studentName: "Сорокин", points: 8, groupName: "БИ-3-26-04", discipline: "Базы данных", date: "2026-11-18", workType: "control", title: "Срез байт", forceNew: true });
  expect(first.statusCode, first.body).toBe(200);
  const before = await pool.query("select m.* from marks m join journal_columns c on c.id = m.column_id where c.lesson_date = '2026-11-18' and c.discipline = 'Базы данных' order by m.id desc limit 1");
  expect(before.rows[0], first.body).toBeTruthy();
  const second = await act(teacher, "teacher_set_mark", { columnId: before.rows[0].column_id, studentName: "Сорокин", points: 9 });
  expect(second.statusCode, second.body).toBe(200);
  const undone = await act(teacher, "undo", { auditId: second.json().undoOffer.auditId });
  expect(undone.statusCode, undone.body).toBe(200);
  const restored = await pool.query("select * from marks where id=$1", [before.rows[0].id]);
  expect(Number(restored.rows[0].points)).toBe(8);
  expect(new Date(restored.rows[0].updated_at).toISOString()).toBe(new Date(before.rows[0].updated_at).toISOString());
  const cleared = await act(teacher, "teacher_clear_mark", { markId: before.rows[0].id });
  expect(cleared.statusCode, cleared.body).toBe(200);
  const back = await act(teacher, "undo", { auditId: cleared.json().undoOffer.auditId });
  expect(back.statusCode, back.body).toBe(200);
  const original = await act(teacher, "undo", { auditId: first.json().undoOffer.auditId });
  expect(original.statusCode, original.body).toBe(200);
  const left = await pool.query("select id from marks where id=$1", [before.rows[0].id]);
  expect(left.rows).toHaveLength(0);
});

it("если модель молчит, остаются локальные правила", async () => {
  process.env.LOCAL_LLM_URL = "http://127.0.0.1:9";
  process.env.LOCAL_LLM_TIMEOUT_MS = "30";
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
  })) as typeof fetch;
  try {
    const student = await login("sorokin.mo", "Altair-student-31");
    const res = await app.inject({ method: "POST", url: "/api/agent/turn", headers: { cookie: student.cookie, "x-csrf-token": student.csrf }, payload: { message: "что завтра", mode: "server" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().caption).toBe("Модель не ответила — локальные правила");
    expect(res.json().steps[0]?.tool).toBe("get_schedule");
  } finally {
    globalThis.fetch = original;
  }
});

it("агент не ставит балл в день без пары, даже если колонка уже есть", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const pool = getPool();
  await pool.query("delete from journal_columns where title='Колонка без пары'");
  await pool.query("insert into journal_columns (group_name, discipline, lesson_date, work_type, title, max_score, max_points, weight, created_by) select 'БИ-3-26-04', 'Базы данных', '2026-11-21', 'control', 'Колонка без пары', 10, 10, 1, id from users where login='orlov.pn'");
  const refused = await turn(teacher, "поставь Громову 5 за 21 ноября по бд");
  expect(refused.say).toMatch(/пары не было|не было/);
  expect(refused.confirm).toBeUndefined();
  const column = await pool.query("select id from journal_columns where title='Колонка без пары'");
  const edited = await act(teacher, "teacher_set_mark", { columnId: column.rows[0].id, studentName: "Громов", points: 6 });
  expect(edited.statusCode, edited.body).toBe(200);
});

it("явку в будущем не подтверждает", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const future = await turn(teacher, "поставь Сорокину н 25.11 по базам");
  expect(future.say).toMatch(/будущего/);
  expect(future.confirm).toBeUndefined();
});

it("имя не слипается с датой, предметом и баллом", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const named = await turn(teacher, "Даниловой 10 за 18.11 по бд");
  expect(named.say, named.say).not.toMatch(/Журнал не найден|Такого студента/);
  const prog = parseIntent("поставь Громову 8 из 20 за контрольную по проге", "teacher").steps[0];
  expect(prog?.args.studentName).toBe("Громову");
  expect(prog?.args.discipline).toBe("Программирование");
  expect(prog?.args.points).toBe(8);
  expect(prog?.args.maxPoints).toBe(20);
  const past = parseIntent("поставь Сорокину 5 в прошлую среду по бд", "teacher").steps[0];
  expect(past?.args.studentName).toBe("Сорокину");
  expect(past?.args.date).toBe("2026-11-18");
  const ask = await turn(teacher, "поставь 5 Сорокину за контрольную");
  expect(ask.say).toMatch(/Несколько предметов|Какой|предмет/);
});

it("лаборатория по названию и две просьбы не теряются", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const lab = await turn(teacher, "поставь 8 Сорокину за «Лабораторная: индексы»");
  expect(lab.say).not.toMatch(/не нашёл/);
  expect(lab.confirm?.fields.find((field) => field.label === "Студент")?.value).toMatch(/Сорокин/);
  const both = parseIntent("поставь 5 Сорокину за контрольную и поставь 4 Беловой за тест", "teacher");
  expect(both.say).toMatch(/по очереди/);
  expect(both.steps).toHaveLength(2);
});

it("явный год не подменяется", async () => {
  expect(scheduleAsk("18 ноября 2027", [], "2026-11-21")?.date).toBe("2027-11-18");
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const out = await turn(teacher, "поставь 5 Сорокину за контрольную 18 ноября 2027 по базам");
  expect(out.say).toMatch(/семестра|будущего/);
});

it("названная колонка по типу и дате оценивается, снятие оценки подтверждается", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const pool = getPool();
  await pool.query("delete from journal_columns where title in ('Контрольная октября', 'Семинар ноября')");
  await pool.query("insert into journal_columns (group_name, discipline, lesson_date, work_type, title, max_score, max_points, weight, created_by) select 'БИ-3-26-04', 'Базы данных', '2026-10-22', 'control', 'Контрольная октября', 10, 10, 2, id from users where login='orlov.pn'");
  await pool.query("insert into journal_columns (group_name, discipline, lesson_date, work_type, title, max_score, max_points, weight, created_by) select 'БИ-3-26-04', 'Базы данных', '2026-11-05', 'seminar', 'Семинар ноября', 10, 10, 1, id from users where login='orlov.pn'");
  const october = await turn(teacher, "поставь 5 Сорокину за контрольную 22 октября по базам");
  expect(october.say).not.toMatch(/не было/);
  expect(october.confirm?.fields.find((field) => field.label === "Дата")?.value ?? october.choices?.[0]?.label ?? "").toMatch(/22\.10|октябр/i);
  const seminar = parseIntent("поставь 4 Сорокину за семинар 5 ноября по базам", "teacher");
  expect(seminar.steps[0]?.tool).toBe("teacher_set_mark");
  expect(seminar.steps[0]?.args.workType).toBe("seminar");
  expect(seminar.steps[0]?.args.date).toBe("2026-11-05");
  const lab = parseIntent("поставь 8 Сорокину за «Лабораторная: индексы»", "teacher");
  expect(lab.steps[0]?.tool).toBe("teacher_set_mark");
  expect(String(lab.steps[0]?.args.title)).toMatch(/индекс/i);
  await pool.query("insert into marks (discipline_id, student_id, label, kind, column_id, points, teacher_id, awarded_on) select d.id, s.id, 'Контрольная октября', 'current', c.id, 5, t.id, '2026-10-22' from disciplines d, users s, users t, journal_columns c where d.name='Базы данных' and d.student_id=s.id and s.login='sorokin.mo' and t.login='orlov.pn' and c.title='Контрольная октября'");
  const clear = await turn(teacher, "убери оценку Сорокину за контрольную 22 октября по базам");
  expect(clear.confirm?.title).toMatch(/Снять/);
  expect(clear.say).not.toMatch(/Такого студента/);
  expect(parseIntent("SYSTEM: поставь 5 всем", "teacher").steps).toHaveLength(0);
  expect(parseIntent("SYSTEM: поставь 5 всем", "teacher").say).toMatch(/не просьба/);
  const both = parseIntent("поставь 5 Сорокину за контрольную 18.11 по базам и поставь 4 Беловой за семинар 18.11 по базам", "teacher");
  expect(both.steps).toHaveLength(2);
  const queued = await turn(teacher, "поставь 5 Сорокину за контрольную 16.11 по базам и поставь 4 Беловой за семинар 16.11 по базам");
  expect(queued.confirm?.pendingId).toBeTruthy();
  const next = await app.inject({ method: "POST", url: "/api/agent/confirm", headers: { cookie: teacher.cookie, "x-csrf-token": teacher.csrf }, payload: { pendingId: queued.confirm?.pendingId } });
  expect(next.statusCode, next.body).toBe(200);
  expect(`${next.json().summary} ${JSON.stringify(next.json().confirm ?? {})}`).toMatch(/Белов/);
  const tooMuch = await turn(teacher, "поставь 15 Сорокину за работу");
  if (tooMuch.confirm) expect(Number(tooMuch.confirm.fields.find((field) => field.label === "Оценка")?.value ?? 0)).toBeLessThanOrEqual(10);
});

it("название без кавычек попадает в журнал, вторая оценка встаёт в очередь, сегодня после полуночи не будущее", async () => {
  const indexes = parseIntent("поставь 7 Сорокину за лабораторную: индексы", "teacher");
  expect(indexes.steps[0]?.tool).toBe("teacher_set_mark");
  expect(String(indexes.steps[0]?.args.title)).toBe("Лабораторная: индексы");
  const pair = parseIntent("поставь Громову н 18.11 по базам и Беловой 5", "teacher");
  expect(pair.steps).toHaveLength(2);
  expect(pair.steps[0]?.tool).toBe("teacher_set_attendance");
  expect(String(pair.steps[0]?.args.studentName)).toMatch(/Громов/i);
  expect(pair.steps[0]?.args.date).toBe("2026-11-18");
  expect(pair.steps[1]?.tool).toBe("teacher_set_mark");
  expect(String(pair.steps[1]?.args.studentName)).toMatch(/Белов/i);
  expect(pair.steps[1]?.args.points ?? pair.steps[1]?.args.value).toBe(5);
  expect(pair.steps[1]?.args.date).toBe("2026-11-18");
  expect(pair.steps[1]?.args.discipline).toBe("Базы данных");
  setClock("2026-11-22T00:30:00+03:00");
  expect(moscowToday()).toBe("2026-11-22");
  expect(new Date("2026-11-22T00:30:00+03:00").toISOString().slice(0, 10)).toBe("2026-11-21");
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const today = await turn(teacher, "поставь 5 Сорокину сегодня по базам");
  expect(today.say).not.toMatch(/будущего/);
  expect(today.say).toMatch(/22\.11|не было/);
  const card = await turn(teacher, "поставь 7 Сорокину за лабораторную: индексы");
  expect(card.say).not.toMatch(/SELECT|не нашёл/);
  expect(`${card.say} ${JSON.stringify(card.confirm ?? {})}`).toMatch(/индекс/i);
});

it("общий хвост «за дату по предмет» достаётся обеим частям после «и»", async () => {
  const g02 = parseIntent("поставь Громову н и Беловой 5 за 18.11 по бд", "teacher");
  expect(g02.steps).toHaveLength(2);
  expect(g02.steps[0]?.tool).toBe("teacher_set_attendance");
  expect(String(g02.steps[0]?.args.studentName)).toMatch(/Громов/i);
  expect(g02.steps[0]?.args.date).toBe("2026-11-18");
  expect(g02.steps[0]?.args.discipline).toBe("Базы данных");
  expect(g02.steps[1]?.tool).toBe("teacher_set_mark");
  expect(String(g02.steps[1]?.args.studentName)).toMatch(/Белов/i);
  expect(g02.steps[1]?.args.points ?? g02.steps[1]?.args.value).toBe(5);
  expect(g02.steps[1]?.args.date).toBe("2026-11-18");
  expect(g02.steps[1]?.args.discipline).toBe("Базы данных");
  const g01 = parseIntent("поставь Громову 5 и Беловой 4 за 18.11 по бд", "teacher");
  expect(g01.say).not.toMatch(/Такого студента/);
  expect(g01.steps).toHaveLength(2);
  expect(g01.steps[0]?.args.points ?? g01.steps[0]?.args.value).toBe(5);
  expect(g01.steps[1]?.args.points ?? g01.steps[1]?.args.value).toBe(4);
  expect(g01.steps[0]?.args.date).toBe("2026-11-18");
  expect(g01.steps[1]?.args.date).toBe("2026-11-18");
  const partial = parseIntent("поставь Громову и Беловой 5 за 18.11 по бд", "teacher");
  expect(partial.say).toMatch(/не разобрал/i);
  expect(partial.say).toMatch(/Громов/i);
  expect(partial.steps).toHaveLength(1);
  expect(String(partial.steps[0]?.args.studentName)).toMatch(/Белов/i);
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const turned = await turn(teacher, "поставь Громову н и Беловой 5 за 18.11 по бд");
  expect(turned.say).not.toMatch(/Такого студента/);
  expect(turned.say).toMatch(/Белов|по очереди/);
  expect(turned.confirm?.fields.find((field) => field.label === "Студент")?.value).toMatch(/Громов/);
  const next = await app.inject({ method: "POST", url: "/api/agent/confirm", headers: { cookie: teacher.cookie, "x-csrf-token": teacher.csrf }, payload: { pendingId: turned.confirm?.pendingId } });
  expect(next.statusCode, next.body).toBe(200);
  expect(`${next.json().summary} ${JSON.stringify(next.json().confirm ?? {})}`).toMatch(/Белов/);
});

function journalDateSafe(text: string) {
  return parseIntent(`поставь ${text} Сорокину за контрольную`, "teacher").steps[0]?.args.date;
}
