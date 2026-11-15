import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { parseIntent } from "../../shared/src/parser";
import { buildApp } from "../src/app";
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
