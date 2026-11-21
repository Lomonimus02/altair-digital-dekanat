import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
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
afterAll(async () => {
  await app.close();
});

it("преподаватель видит обе группы, чужую работу студент не открывает", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const home = await authed(teacher, "GET", "/api/teach/home");
  expect(home.statusCode).toBe(200);
  const groups = home.json().groups.map((row: { groupName: string }) => row.groupName);
  expect(groups).toContain("БИ-3-26-04");
  expect(groups).toContain("ЮР-1-26-02");

  const sorokin = await login("sorokin.mo", "Altair-student-31");
  const volkova = await login("volkova.as", "Altair-student-17");
  const own = await authed(sorokin, "GET", "/api/homework");
  expect(own.statusCode).toBe(200);
  const foreign = own.json().homework.find((row: { groupName?: string; discipline: string }) => row.discipline.includes("персональн") || row.discipline.includes("Информационн"));
  expect(foreign).toBeUndefined();
  const volkovaList = await authed(volkova, "GET", "/api/homework");
  const hidden = volkovaList.json().homework[0];
  const leaked = await authed(sorokin, "GET", `/api/homework/${hidden.id}`);
  expect(leaked.statusCode).toBe(404);

  const journal = await authed(teacher, "GET", "/api/teach/journal?group=ЮР-9-99-99&discipline=Базы%20данных");
  expect(journal.statusCode).toBe(404);
  const staff = await login("lebedeva.ip", "Altair-staff-204");
  const denied = await authed(staff, "GET", "/api/teach/homework");
  expect(denied.statusCode).toBe(403);
});

it("фраза студента собирает два шага, фраза преподавателя просит подтвердить оценку", () => {
  const names = ["Математический анализ", "Базы данных"];
  const plan = parseIntent("что мне сдать до пятницы и закажи справку для военкомата", "student", names);
  expect(plan.steps.map((step) => step.tool)).toEqual(["list_homework", "create_request"]);
  const grade = parseIntent("поставь 5 Сорокину за лабу", "teacher");
  expect(grade.steps[0].tool).toBe("teacher_grade_homework");
  expect(grade.steps[0].args).toMatchObject({ score: 5, studentName: "сорокин" });
});

it("повторная оценка обновляет балл в журнале, а отмена не стирает возврат", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const pool = getPool();
  const found = await pool.query("select a.id, u.id as student_id from submissions s join assignments a on a.id = s.assignment_id join users u on u.id = s.student_id where u.login = 'sorokin.mo' and s.status = 'in_review' limit 1");
  expect(found.rows.length).toBe(1);
  const assignmentId = found.rows[0].id as number;
  const studentId = found.rows[0].student_id as number;
  const returned = await act(teacher, "teacher_return_homework", { assignmentId, studentName: "Сорокин", comment: "Нужен пример." });
  expect(returned.statusCode, returned.body).toBe(200);
  const first = await act(teacher, "teacher_grade_homework", { assignmentId, studentName: "Сорокин", score: 6 });
  expect(first.statusCode, first.body).toBe(200);
  const second = await act(teacher, "teacher_grade_homework", { assignmentId, studentName: "Сорокин", score: 8.5 });
  expect(second.statusCode, second.body).toBe(200);
  expect(second.json().undoOffer?.auditId).toBeTruthy();
  const stored = await pool.query("select m.points::float as points, m.column_id from marks m where m.student_id = $1 and m.column_id is not null and m.label = (select title from assignments where id = $2)", [studentId, assignmentId]);
  expect(stored.rows).toHaveLength(1);
  expect(Number(stored.rows[0].points)).toBe(8.5);
  const back = await pool.query("select count(*)::int as n from notifications where user_id = $1 and title like 'Вернули на доработку%'", [studentId]);
  expect(back.rows[0].n).toBeGreaterThan(0);
  const undone = await act(teacher, "undo", { auditId: second.json().undoOffer.auditId });
  expect(undone.statusCode, undone.body).toBe(200);
  const kept = await pool.query("select count(*)::int as n from notifications where user_id = $1 and title like 'Вернули на доработку%'", [studentId]);
  expect(kept.rows[0].n).toBe(back.rows[0].n);
  const score = await pool.query("select score::float as score from submissions where assignment_id = $1 and student_id = $2", [assignmentId, studentId]);
  expect(Number(score.rows[0].score)).toBe(6);
  const note = await pool.query("select title, body from notifications where user_id = $1 and kind = 'grade' and href = $2", [studentId, `/homework/${assignmentId}`]);
  expect(note.rows[0].title).toMatch(/^Баллы:/);
  expect(note.rows[0].body).toMatch(/6 из/);
  expect(note.rows[0].body).not.toMatch(/8,5/);
});

it("отмена оценки возвращает колонку задания и все поля отметки", async () => {
  const teacher = await login("orlov.pn", "Altair-teacher-58");
  const pool = getPool();
  const found = await pool.query("select a.id, u.id as student_id from submissions s join assignments a on a.id = s.assignment_id join users u on u.id = s.student_id where u.login = 'sorokin.mo' and s.status = 'in_review' limit 1");
  const assignmentId = found.rows[0].id as number;
  const studentId = found.rows[0].student_id as number;
  await pool.query("delete from marks where column_id in (select id from journal_columns where title = (select title from assignments where id = $1))", [assignmentId]);
  await pool.query("delete from journal_columns where title = (select title from assignments where id = $1)", [assignmentId]);
  const before = await pool.query("select column_id from assignments where id = $1", [assignmentId]);
  expect(before.rows[0].column_id).toBeNull();
  const first = await act(teacher, "teacher_grade_homework", { assignmentId, studentName: "Сорокин", score: 6 });
  expect(first.statusCode, first.body).toBe(200);
  const linked = await pool.query("select column_id from assignments where id = $1", [assignmentId]);
  const columnId = linked.rows[0].column_id as number;
  expect(columnId).toBeTruthy();
  await pool.query("update marks set value = 5, awarded_on = '2026-10-22', comment = 'черновик', updated_at = '2026-10-22T08:00:00.000Z' where student_id = $1 and column_id = $2", [studentId, columnId]);
  await pool.query("update submissions set updated_at = '2026-10-21T09:00:00.000Z' where assignment_id = $1 and student_id = $2", [assignmentId, studentId]);
  const second = await act(teacher, "teacher_grade_homework", { assignmentId, studentName: "Сорокин", score: 8.5 });
  expect(second.statusCode, second.body).toBe(200);
  const undone = await act(teacher, "undo", { auditId: second.json().undoOffer.auditId });
  expect(undone.statusCode, undone.body).toBe(200);
  const mark = await pool.query("select value, points::float as points, awarded_on::text as awarded_on, comment, updated_at from marks where student_id = $1 and column_id = $2", [studentId, columnId]);
  expect(mark.rows[0].value).toBe(5);
  expect(Number(mark.rows[0].points)).toBe(6);
  expect(String(mark.rows[0].awarded_on)).toBe("2026-10-22");
  expect(mark.rows[0].comment).toBe("черновик");
  expect(new Date(mark.rows[0].updated_at).toISOString()).toBe("2026-10-22T08:00:00.000Z");
  const submissionStamp = await pool.query("select updated_at from submissions where assignment_id = $1 and student_id = $2", [assignmentId, studentId]);
  expect(new Date(submissionStamp.rows[0].updated_at).toISOString()).toBe("2026-10-21T09:00:00.000Z");
  expect((await pool.query("select column_id from assignments where id = $1", [assignmentId])).rows[0].column_id).toBe(columnId);
  const removed = await act(teacher, "undo", { auditId: first.json().undoOffer.auditId });
  expect(removed.statusCode, removed.body).toBe(200);
  expect((await pool.query("select count(*)::int as n from marks where student_id = $1 and column_id = $2", [studentId, columnId])).rows[0].n).toBe(0);
  expect((await pool.query("select column_id from assignments where id = $1", [assignmentId])).rows[0].column_id).toBeNull();
  expect((await pool.query("select count(*)::int as n from journal_columns where id = $1", [columnId])).rows[0].n).toBe(0);
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
