import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { addDays, moscowToday } from "../../shared/src/dates";
import { finalByPercent, journalDate, journalDates, legacyFromMark, parseJournalFocus, parseWorkType, pointsTotal, shiftPeriod, validPoints, weightedAverage, workRuleError } from "../../shared/src/journal";
import { parseIntent } from "../../shared/src/parser";
import { buildApp } from "../src/app";
import { getPool } from "../src/db/client";
import { seed } from "../src/db/seed";
import { seedHomework } from "../src/db/seed-homework";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});
beforeEach(async () => {
  await seed();
  await seedHomework();
});
afterAll(async () => app.close());

it("среднее учитывает вес и не берёт зачёт", () => {
  expect(weightedAverage([
    { value: 5, weight: 2, maxScore: 5, workType: "control" },
    { value: 3, weight: 1, maxScore: 5, workType: "seminar" },
  ])).toBeCloseTo((10 + 3) / 3, 2);
  expect(weightedAverage([
    { value: 1, weight: 0, maxScore: 5, workType: "credit" },
    { value: 4, weight: 1, maxScore: 5, workType: "seminar" },
  ])).toBe(4);
  expect(weightedAverage([{ value: 8, weight: 1, maxScore: 10, workType: "test" }])).toBe(4);
  expect(parseWorkType("контрольная работа")?.type).toBe("control");
});

it("миграция 004 переносит оценки и повтор ничего не меняет", async () => {
  const pool = getPool();
  const before = await pool.query("select count(*)::int as n from marks");
  const empty = await pool.query("select count(*)::int as n from marks where column_id is null and awarded_on is not null");
  expect(empty.rows[0].n).toBe(0);
  const control = await pool.query("select work_type, weight::float from journal_columns where title ~* '^контрольн' limit 1");
  expect(control.rows[0].work_type).toBe("control");
  expect(Number(control.rows[0].weight)).toBe(2);
  const seminar = await pool.query("select work_type from journal_columns where title ~* '^семинар' limit 1");
  expect(seminar.rows[0].work_type).toBe("seminar");
  await pool.query(readFileSync("server/migrations/004_grades_journal.sql", "utf8"));
  const after = await pool.query("select count(*)::int as n from marks");
  expect(after.rows[0].n).toBe(before.rows[0].n);
});

it("фразы журнала не путаются со сданной работой", () => {
  const control = parseIntent("поставь 5 Сорокину за контрольную 20.11", "teacher");
  expect(control.steps[0]?.tool).toBe("teacher_set_mark");
  expect(control.steps[0]?.args.workType).toBe("control");
  expect(control.steps[0]?.args.date).toBe(journalDate("20.11"));
  expect(control.steps[0]?.args.points).toBe(5);
  expect(control.steps[0]?.args.value).toBe(5);
  const yesterday = parseIntent("поставь Сорокину 4 за лабу вчера", "teacher");
  expect(yesterday.steps[0]?.tool).toBe("teacher_set_mark");
  expect(yesterday.steps[0]?.args.workType).toBe("lab");
  expect(yesterday.steps[0]?.args.date).toBe(addDays(moscowToday(), -1));
  const test = parseIntent("Сорокину 3 за тест по базам 18 ноября", "teacher");
  expect(test.steps[0]?.args.workType).toBe("test");
  expect(test.steps[0]?.args.discipline).toMatch(/баз/i);
  const absent = parseIntent("поставь Сорокину н 20.11", "teacher");
  expect(absent.steps[0]?.tool).toBe("teacher_set_attendance");
  expect(absent.steps[0]?.args.status).toBe("absent");
  const word = parseIntent("поставь 5 Сорокину за контрольную работу", "teacher");
  expect(word.steps[0]?.tool).toBe("teacher_set_mark");
  const titled = parseIntent("поставь 5 за «Лабораторную 3» Сорокину", "teacher");
  expect(titled.steps[0]?.tool).toBe("teacher_set_mark");
  expect(titled.steps[0]?.args.title).toBe("Лабораторная 3");
  const homework = parseIntent("оцени работу «Задачник» Сорокина на 5", "teacher");
  expect(homework.steps[0]?.tool).toBe("teacher_grade_homework");
  expect(journalDate("22.10", "2026-11-21")).toBe("2026-10-22");
  expect(journalDate("22 октября", "2026-11-21")).toBe("2026-10-22");
  expect(journalDate("поставь оценку 22.10", "2026-11-21")).toBe("2026-10-22");
  const zero = parseIntent("поставь 0 баллов из 30 Сорокину за контрольную", "teacher");
  expect(zero.steps[0]?.tool).toBe("teacher_set_mark");
  expect(zero.steps[0]?.args.points).toBe(0);
  expect(zero.steps[0]?.args.maxPoints).toBe(30);
  const comma = parseIntent("поставь 10,5 из 15 Сорокину за контрольную", "teacher");
  expect(comma.steps[0]?.args.points).toBe(10.5);
  expect(comma.steps[0]?.args.maxPoints).toBe(15);
  const hypo = parseIntent("что если 0 баллов из 30 по матану", "student", ["Математический анализ"]);
  expect(hypo.steps[0]?.args.points).toBe(0);
  expect(hypo.steps[0]?.args.maxPoints).toBe(30);
});

it("журнал закрыт чужим, а оценка без строки дисциплины проходит", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const foreign = await authed(teacher, "GET", `/api/teach/journal?group=${encodeURIComponent("ЮР-1-26-02")}&discipline=${encodeURIComponent("Римское право")}`);
  expect(foreign.statusCode).toBe(404);
  const student = await login("sorokin.mo", "Altair-student-31");
  expect((await authed(student, "GET", "/api/teach/journal?group=БИ-3-26-04&discipline=Базы%20данных")).statusCode).toBe(403);
  const table = await authed(student, "GET", "/api/grades/table?studentId=2");
  expect(table.statusCode).toBe(200);
  expect(table.json().rows.every((row: { discipline: string }) => !/персональн/i.test(row.discipline))).toBe(true);
  const staff = await login("lebedeva.ip", "Altair-staff-204");
  expect((await act(staff, "teacher_set_mark", { studentName: "Сорокин", value: 5, groupName: "БИ-3-26-04", discipline: "Базы данных" })).statusCode).toBe(403);
  const future = await act(teacher, "teacher_set_mark", { studentName: "Сорокин", value: 5, groupName: "БИ-3-26-04", discipline: "Базы данных", date: addDays(moscowToday(), 2) });
  expect(future.statusCode).toBe(400);
  const wide = await authed(teacher, "GET", "/api/teach/journal?group=БИ-3-26-04&discipline=Базы%20данных&from=2026-09-01&to=2027-08-01");
  expect(wide.statusCode).toBe(400);
  const huge = await act(teacher, "teacher_set_mark", { studentName: "Сорокин", points: 11, groupName: "БИ-3-26-04", discipline: "Базы данных" });
  expect(huge.statusCode).toBe(400);
  const long = await act(teacher, "teacher_set_mark", { studentName: "Сорокин", value: 5, groupName: "БИ-3-26-04", discipline: "Базы данных", comment: "а".repeat(501) });
  expect(long.statusCode).toBe(400);

  const date = addDays(moscowToday(), -1);
  const first = await act(teacher, "teacher_set_mark", { studentName: "Белова", value: 4, groupName: "БИ-3-26-04", discipline: "Программирование", date, workType: "control", title: "Контрольная Беловой" });
  expect(first.statusCode, first.body).toBe(200);
  const again = await act(teacher, "teacher_set_mark", { studentName: "Белова", value: 5, groupName: "БИ-3-26-04", discipline: "Программирование", date, workType: "control", title: "Контрольная Беловой" });
  expect(again.statusCode).toBe(200);
  const pool = getPool();
  const rows = await pool.query("select count(*)::int as n from marks m join journal_columns c on c.id=m.column_id where c.title='Контрольная Беловой'");
  expect(rows.rows[0].n).toBe(1);
  const undo = await act(teacher, "undo", { auditId: again.json().undoOffer.auditId });
  expect(undo.statusCode).toBe(200);
  const restored = await pool.query("select value, points from marks m join journal_columns c on c.id=m.column_id where c.title='Контрольная Беловой'");
  expect(restored.rows[0].value).toBeNull();
  expect(Number(restored.rows[0].points)).toBe(4);

  const other = await act(teacher, "teacher_set_mark", { studentName: "Волкова", value: 5, columnId: (await pool.query("select id from journal_columns where title='Контрольная Беловой'")).rows[0].id });
  expect(other.statusCode).toBe(404);
});

it("карточка оценки показывает дату и прежнюю оценку", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const turn = await authedPost(teacher, "/api/agent/turn", { message: "поставь 5 Сорокину за контрольную 20.11 по базам", mode: "fallback" });
  expect(turn.statusCode, turn.body).toBe(200);
  const body = turn.json();
  const card = body.confirm ?? body;
  const fields = Object.fromEntries((card.confirm?.fields ?? card.fields ?? body.confirm?.fields ?? []).map((field: { label: string; value: string }) => [field.label, field.value]));
  expect(fields["Дата"]).toMatch(/^\d{2}\.\d{2}/);
  expect(fields["Дата"]).not.toMatch(/2026-/);
  expect(fields["Было"] === "—" || /из \d+$/.test(fields["Было"])).toBe(true);
  if (fields["Работа"]) expect(fields["Работа"]).not.toMatch(/вес \d+\.\d/);
  if (body.confirm?.pendingId) {
    const rejected = await authedPost(teacher, "/api/agent/reject", { pendingId: body.confirm.pendingId });
    expect(rejected.statusCode).toBe(200);
  }
});

it("оператор выбирает ячейку по студенту и колонке", () => {
  const source = readFileSync("client/src/lib/operator.ts", "utf8");
  expect(source).toContain('get("student")');
  expect(source).toContain('data-agent-cell="${student}:${focus}"');
  expect(source).not.toContain("data-agent-cell$=");
  const clarify = readFileSync("client/src/lib/agent.tsx", "utf8");
  expect(clarify.indexOf("const clarify")).toBeLessThan(clarify.lastIndexOf("playTurn("));
});

it("новая колонка читается целиком, месяц листается по календарю, пары не пропадают", () => {
  expect(parseJournalFocus("new|2026-11-17|essay")).toEqual({ date: "2026-11-17", workType: "essay" });
  expect(parseJournalFocus("new-2026-11-17-essay")).toEqual({ date: "2026-11-17", workType: "essay" });
  expect(parseJournalFocus("new-2026-11-17-essay")?.workType).not.toBe("11-17-essay");
  expect(shiftPeriod("2026-11-01", "2026-11-30", -1)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  expect(journalDates([], ["2026-11-16", "2026-11-18"])).toEqual(["2026-11-16", "2026-11-18"]);
  const named = parseIntent("поставь 5 Сорокину за контрольную 20.11", "teacher");
  expect(named.steps[0]?.args.studentName).toBe("Сорокину");
  for (const phrase of [
    "Поставь 5 Сорокину за контрольную по базам данных 20.11",
    "ПОСТАВЬ 5 СОРОКИНУ ЗА КОНТРОЛЬНУЮ ПО БАЗАМ ДАННЫХ 20.11",
  ]) {
    const parsed = parseIntent(phrase, "teacher");
    expect(parsed.steps[0]?.tool, phrase).toBe("teacher_set_mark");
    expect(parsed.steps[0]?.args.workType, phrase).toBe("control");
    expect(parsed.steps[0]?.args.date, phrase).toBe("2026-11-20");
    expect(String(parsed.steps[0]?.args.discipline), phrase).toMatch(/баз/i);
  }
  const points = parseIntent("поставь 18 баллов Сорокину за контрольную 20.11", "teacher");
  expect(points.steps[0]?.args.points).toBe(18);
  expect(points.steps[0]?.args.workType).toBe("control");
  const outOf = parseIntent("поставь 18 из 20 Сорокину за контрольную", "teacher");
  expect(outOf.steps[0]?.args.points).toBe(18);
  expect(outOf.steps[0]?.args.maxPoints).toBe(20);
  const weight = parseIntent("сделай вес контрольных 3", "teacher");
  expect(weight.steps[0]?.tool).toBe("teacher_update_grading");
  expect(weight.steps[0]?.args.weight).toBe(3);
  const cap = parseIntent("максимум за лабу 15 баллов", "teacher");
  expect(cap.steps[0]?.args.maxPoints).toBe(15);
  expect(cap.steps[0]?.args.workType).toBe("lab");
  expect(pointsTotal([{ points: 8, maxPoints: 10, weight: 2 }, { points: 5, maxPoints: 10, weight: 1 }]).percent).toBeCloseTo(((0.8 * 2 + 0.5) / 3) * 100, 1);
  const mixed = pointsTotal([{ points: 8, maxPoints: 10, weight: 1 }, { points: 18, maxPoints: 20, weight: 1 }]);
  expect((mixed.earned / mixed.possible) * 100).toBeCloseTo(mixed.percent ?? 0, 5);
  expect(workRuleError("abc", "1")).toMatch(/1 до 1000/);
  expect(workRuleError("10", "25")).toMatch(/не больше 20/);
  expect(workRuleError("10", "0")).toMatch(/не больше 20/);
  expect(workRuleError("10", "1.5")).toBeNull();
  const eight = parseIntent("если получу 8 баллов за контрольную по базам", "student", ["Базы данных"]);
  expect(eight.steps[0]?.tool).toBe("simulate_mark");
  expect(eight.steps[0]?.args.points).toBe(8);
  expect(eight.steps[0]?.args.value).toBe(8);
  const outOfWhat = parseIntent("что если 18 из 20 по матану", "student", ["Математический анализ"]);
  expect(outOfWhat.steps[0]?.tool).toBe("simulate_mark");
  expect(outOfWhat.steps[0]?.args.points).toBe(18);
  expect(outOfWhat.steps[0]?.args.maxPoints).toBe(20);
  expect(parseIntent("если получу 8 баллов за контрольную", "student", ["Базы данных"]).steps[0]?.tool).not.toBe("get_grades");
  expect(legacyFromMark(5, "current")).toBe(10);
  expect(legacyFromMark(4, "current")).toBe(8);
  expect(legacyFromMark(1, "credit")).toBe(10);
  expect(legacyFromMark(0, "credit")).toBe(0);
  expect(validPoints(10.5, 10)).toBe(false);
  expect(validPoints(8, 10)).toBe(true);
  const operator = readFileSync("client/src/lib/operator.ts", "utf8");
  expect(operator).toContain("waitForElement");
  expect(operator).not.toContain("navigate(open);\n      await wait(480");
});

it("уточнение предмета открывает журнал, колонка по id не спрашивает дисциплину, отмена снимает уведомление", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const asked = await authedPost(teacher, "/api/agent/turn", { message: "поставь 5 Сорокину за контрольную 20.11", mode: "fallback" });
  expect(asked.statusCode).toBe(200);
  const body = asked.json();
  expect(body.cards?.[0]?.title ?? body.say ?? "").toMatch(/Сорокин/);
  expect(body.ui?.some((item: { to?: string }) => item.to?.includes("/teach/journal"))).toBe(true);
  const column = await act(teacher, "teacher_add_journal_column", { groupName: "БИ-3-26-04", discipline: "Базы данных", date: addDays(moscowToday(), -3), workType: "essay", title: "Эссе для колонки" });
  expect(column.statusCode, column.body).toBe(200);
  const only = await act(teacher, "teacher_set_mark", { columnId: column.json().columnId ?? (await getPool().query("select id from journal_columns where title='Эссе для колонки'")).rows[0].id, studentName: "Сорокин", value: 5 });
  expect(only.statusCode, only.body).toBe(200);
  const pool = getPool();
  const notes = await pool.query("select count(*)::int as n from notifications where title='Новая оценка' and user_id=(select id from users where login='sorokin.mo')");
  const before = notes.rows[0].n;
  const same = await act(teacher, "teacher_set_mark", { columnId: (await pool.query("select id from journal_columns where title='Эссе для колонки'")).rows[0].id, studentName: "Сорокин", value: 5, comment: "без второй новости" });
  expect(same.statusCode).toBe(200);
  const afterComment = await pool.query("select count(*)::int as n from notifications where title='Новая оценка' and user_id=(select id from users where login='sorokin.mo')");
  expect(afterComment.rows[0].n).toBe(before);
  await act(teacher, "undo", { auditId: only.json().undoOffer.auditId });
  const left = await pool.query("select count(*)::int as n from notifications where body like '%Эссе для колонки%'");
  expect(left.rows[0].n).toBe(0);
  const staff = await login("lebedeva.ip", "Altair-staff-204");
  expect((await authed(staff, "GET", "/api/teach/journal?group=БИ-3-26-04&discipline=Базы%20данных")).statusCode).toBe(403);
  expect((await act(staff, "teacher_update_grading", { groupName: "БИ-3-26-04", discipline: "Базы данных", workType: "control", weight: 3 })).statusCode).toBe(403);
  const foreignScheme = await act(teacher, "teacher_update_grading", { groupName: "ЮР-1-26-02", discipline: "Римское право", workType: "lab", maxPoints: 15 });
  expect(foreignScheme.statusCode).toBe(404);
  const ownScheme = await act(teacher, "teacher_update_grading", { groupName: "БИ-3-26-04", discipline: "Базы данных", workType: "control", weight: 3, maxPoints: 20, excellent: 99 });
  expect(ownScheme.statusCode, ownScheme.body).toBe(200);
  const created = await act(teacher, "teacher_add_journal_column", { groupName: "БИ-3-26-04", discipline: "Базы данных", date: addDays(moscowToday(), -2), workType: "control", title: "Контрольная по схеме" });
  expect(created.statusCode, created.body).toBe(200);
  const schemeColumn = await getPool().query("select id, max_points, weight::float from journal_columns where title='Контрольная по схеме'");
  expect(schemeColumn.rows[0].max_points).toBe(20);
  expect(Number(schemeColumn.rows[0].weight)).toBe(3);
  const columnId = schemeColumn.rows[0].id;
  const marked = await act(teacher, "teacher_set_mark", { columnId, studentName: "Сорокин", points: 18 });
  expect(marked.statusCode, marked.body).toBe(200);
  const stored = await getPool().query("select value, points from marks where column_id=$1", [columnId]);
  expect(stored.rows[0].value).toBeNull();
  expect(Number(stored.rows[0].points)).toBe(18);
  const journal = await authed(teacher, "GET", `/api/teach/journal?group=${encodeURIComponent("БИ-3-26-04")}&discipline=${encodeURIComponent("Базы данных")}`);
  const person = journal.json().students.find((student: { name: string }) => student.name.includes("Сорокин"));
  const sorokin = journal.json().averages[person.id];
  expect(sorokin.percent).toBeLessThan(99);
  expect(sorokin.grade).toBe(finalByPercent(sorokin.percent, { excellent: 99, good: 70, satisfactory: 55 }));
  const edit = await act(teacher, "teacher_set_mark", { columnId, studentName: "Сорокин", points: 19, comment: "правка" });
  expect(edit.statusCode).toBe(200);
  await act(teacher, "undo", { auditId: edit.json().undoOffer.auditId });
  const kept = await getPool().query("select count(*)::int as n from notifications where body like '%Контрольная по схеме%'");
  expect(kept.rows[0].n).toBeGreaterThan(0);
  const byAlias = parseIntent("сколько баллов по бд", "student", ["Базы данных", "Программирование"]);
  expect(String(byAlias.steps[0]?.args.subject ?? "")).toMatch(/баз/i);
  const five = await authedPost(teacher, "/api/agent/turn", { message: "поставь 5 Сорокину за контрольную 20.11 по базам", mode: "fallback" });
  const fiveFields = Object.fromEntries((five.json().confirm?.fields ?? []).map((field: { label: string; value: string }) => [field.label, field.value]));
  expect(fiveFields["Баллы"]).toMatch(/5 из \d+ баллов/);
  if (five.json().confirm?.pendingId) await authedPost(teacher, "/api/agent/reject", { pendingId: five.json().confirm.pendingId });
});

async function freeCaseDay(startOffset: number, span: number) {
  const pool = getPool();
  await pool.query("delete from journal_columns where discipline = 'Базы данных' and title in ('Кейс другой', 'Кейс ещё', 'Кейс на 10', 'Кейс на 15')");
  for (let step = 0; step < span; step += 1) {
    const candidate = addDays(moscowToday(), startOffset - step);
    if (candidate < addDays(moscowToday(), -13)) break;
    const taken = await pool.query("select count(*)::int as n from journal_columns where group_name='БИ-3-26-04' and discipline='Базы данных' and lesson_date=$1 and work_type='case'", [candidate]);
    if (taken.rows[0].n === 0 && new Date(`${candidate}T00:00:00Z`).getUTCDay() !== 0) return candidate;
  }
  throw new Error("нет свободного дня для кейса");
}

it("явный максимум не подменяется молча, баллы выше максимума не попадают в карточку", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const pool = getPool();
  let date = await freeCaseDay(-3, 10);
  const spoken = `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
  const created = await act(teacher, "teacher_add_journal_column", { groupName: "БИ-3-26-04", discipline: "Базы данных", date, workType: "case", title: "Кейс на 15", maxPoints: 15, weight: 2 });
  expect(created.statusCode, created.body).toBe(200);
  const fourteen = await authedPost(teacher, "/api/agent/turn", { message: `поставь 14 из 20 Сорокину за кейс ${spoken} по базам`, mode: "fallback" });
  expect(fourteen.statusCode, fourteen.body).toBe(200);
  const asked = fourteen.json();
  expect(asked.confirm).toBeFalsy();
  expect(asked.say).toMatch(/максимум 15/);
  expect(asked.say).toMatch(/14 из 15/);
  expect(asked.say).toMatch(/10,5 из 15/);
  expect(asked.say).toMatch(/новую работу из 20/);
  const asIs = (asked.choices ?? []).find((choice: { label: string }) => choice.label.startsWith("Поставить 14"));
  expect(asIs?.clarificationId).toBeTruthy();
  const kept = await authedPost(teacher, "/api/agent/clarify", { clarificationId: asIs.clarificationId, entityId: asIs.entityId });
  const keptFields = Object.fromEntries((kept.json().confirm?.fields ?? []).map((field: { label: string; value: string }) => [field.label, field.value]));
  expect(keptFields["Баллы"]).toBe("14 из 15 баллов");
  if (kept.json().confirm?.pendingId) await authedPost(teacher, "/api/agent/reject", { pendingId: kept.json().confirm.pendingId });

  const scaledAsk = await authedPost(teacher, "/api/agent/turn", { message: `поставь 14 из 20 Сорокину за кейс ${spoken} по базам`, mode: "fallback" });
  const scaleChoice = (scaledAsk.json().choices ?? []).find((choice: { entityId?: string; label: string }) => choice.entityId === "fit:scale");
  expect(scaleChoice?.clarificationId).toBeTruthy();
  const scaled = await authedPost(teacher, "/api/agent/clarify", { clarificationId: scaleChoice.clarificationId, entityId: "fit:scale" });
  const scaledFields = Object.fromEntries((scaled.json().confirm?.fields ?? []).map((field: { label: string; value: string }) => [field.label, field.value]));
  expect(scaledFields["Баллы"]).toBe("10,5 из 15 баллов");
  if (scaled.json().confirm?.pendingId) await authedPost(teacher, "/api/agent/reject", { pendingId: scaled.json().confirm.pendingId });

  const freshAsk = await authedPost(teacher, "/api/agent/turn", { message: `поставь 14 из 20 Сорокину за кейс ${spoken} по базам`, mode: "fallback" });
  const freshChoice = (freshAsk.json().choices ?? []).find((choice: { entityId?: string; label: string }) => choice.entityId === "fit:fresh");
  expect(freshChoice?.clarificationId).toBeTruthy();
  const fresh = await authedPost(teacher, "/api/agent/clarify", { clarificationId: freshChoice.clarificationId, entityId: "fit:fresh" });
  const freshFields = Object.fromEntries((fresh.json().confirm?.fields ?? []).map((field: { label: string; value: string }) => [field.label, field.value]));
  expect(freshFields["Работа"]).toMatch(/^Кейс 2 /);
  expect(freshFields["Работа"]).not.toMatch(/Кейс на 15/);
  if (fresh.json().confirm?.pendingId) await authedPost(teacher, "/api/agent/reject", { pendingId: fresh.json().confirm.pendingId });

  const eighteen = await authedPost(teacher, "/api/agent/turn", { message: `поставь 18 из 20 Сорокину за кейс ${spoken} по базам`, mode: "fallback" });
  const over = eighteen.json();
  expect(over.confirm).toBeFalsy();
  expect(JSON.stringify(over)).not.toMatch(/18 из 15/);
  expect(over.say).toMatch(/13,5 из 15/);
  expect(over.say).toMatch(/больше этого максимума/);

  const small = await freeCaseDay(-4, 10);
  const smallSpoken = `${Number(small.slice(8, 10))}.${Number(small.slice(5, 7))}`;
  const ten = await act(teacher, "teacher_add_journal_column", { groupName: "БИ-3-26-04", discipline: "Базы данных", date: small, workType: "case", title: "Кейс на 10", maxPoints: 10, weight: 1 });
  expect(ten.statusCode, ten.body).toBe(200);
  const plain = await authedPost(teacher, "/api/agent/turn", { message: `поставь 13 Сорокину за кейс ${smallSpoken} по базам`, mode: "fallback" });
  const tooBig = plain.json();
  expect(tooBig.confirm).toBeFalsy();
  expect(JSON.stringify(tooBig)).not.toMatch(/13 из 10/);
  expect(tooBig.say).toMatch(/больше максимума/);
});

it("одна колонка того же типа переиспользуется, две спрашивают, отмена правки возвращает текст уведомления", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const pool = getPool();
  const date = await freeCaseDay(-2, 12);
  const spoken = `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
  const first = await act(teacher, "teacher_add_journal_column", { groupName: "БИ-3-26-04", discipline: "Базы данных", date, workType: "case", title: "Кейс другой" });
  expect(first.statusCode, first.body).toBe(200);
  const turn = await authedPost(teacher, "/api/agent/turn", { message: `поставь 8 Сорокину за кейс ${spoken} по базам`, mode: "fallback" });
  expect(turn.statusCode, turn.body).toBe(200);
  const body = turn.json();
  expect(body.summary ?? "").not.toMatch(/Создам/);
  const fields = Object.fromEntries((body.confirm?.fields ?? []).map((field: { label: string; value: string }) => [field.label, field.value]));
  expect(fields["Работа"], body.say).toMatch(/Кейс другой/);
  if (body.confirm?.pendingId) await authedPost(teacher, "/api/agent/reject", { pendingId: body.confirm.pendingId });
  const second = await act(teacher, "teacher_add_journal_column", { groupName: "БИ-3-26-04", discipline: "Базы данных", date, workType: "case", title: "Кейс ещё" });
  expect(second.statusCode, second.body).toBe(200);
  const asked = await authedPost(teacher, "/api/agent/turn", { message: `поставь 8 Сорокину за кейс ${spoken} по базам`, mode: "fallback" });
  const labels = (asked.json().choices ?? []).map((choice: { label: string }) => choice.label);
  expect(labels).toEqual(expect.arrayContaining(["Кейс другой", "Кейс ещё", "Новая работа"]));
  const columnId = (await pool.query("select id from journal_columns where title='Кейс другой'")).rows[0].id;
  const marked = await act(teacher, "teacher_set_mark", { columnId, studentName: "Сорокин", points: 8 });
  expect(marked.statusCode, marked.body).toBe(200);
  const edited = await act(teacher, "teacher_set_mark", { columnId, studentName: "Сорокин", points: 9 });
  expect(edited.statusCode, edited.body).toBe(200);
  const fresh = await pool.query("select body from notifications where href like '%focus=' || (select id from marks where column_id=$1 limit 1)", [columnId]);
  expect(fresh.rows[0].body).toMatch(/9 из/);
  await act(teacher, "undo", { auditId: edited.json().undoOffer.auditId });
  const restored = await pool.query("select body from notifications where href like '%focus=' || (select id from marks where column_id=$1 limit 1)", [columnId]);
  expect(restored.rows[0].body).toMatch(/8 из/);
  expect(restored.rows[0].body).not.toMatch(/9 из/);
  const student = await login("sorokin.mo", "Altair-student-31");
  const whatIf = await authedPost(student, "/api/agent/turn", { message: "что если 0 из 10 по программированию", mode: "fallback" });
  const say = String(whatIf.json().say ?? "");
  if (/ниже 55/.test(say)) expect(say).toMatch(/Итог \d/);
  const teaching = await authed(student, "GET", "/api/grades/table?from=2026-09-01&to=2026-12-31");
  expect(teaching.json().period.final).toBe(true);
  const programming = teaching.json().rows.find((row: { discipline: string }) => row.discipline === "Программирование");
  expect(programming.grade).toMatch(/зачтено/);
  expect(programming.grade).not.toMatch(/отлично|хорошо|удовлетворительно/);
  const grades = await authedPost(student, "/api/agent/turn", { message: "сколько баллов по базам данных", mode: "fallback" });
  expect(grades.json().say).toMatch(/За семестр/);
  expect(grades.json().say).toMatch(/итог «/);
  const table = await authed(student, "GET", "/api/grades/table");
  expect(table.json().period.final).toBe(true);
  expect(table.json().period.from).toMatch(/-09-01|-02-01/);
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

function authed(session: { cookie: string; csrf: string }, method: string, url: string) {
  return app.inject({ method, url, headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
}

function act(session: { cookie: string; csrf: string }, action: string, args: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/actions", payload: { action, args }, headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
}

function authedPost(session: { cookie: string; csrf: string }, url: string, payload: unknown) {
  return app.inject({ method: "POST", url, payload, headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
}
