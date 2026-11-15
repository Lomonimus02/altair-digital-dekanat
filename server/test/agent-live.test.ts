import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
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

const phrases = [
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "поставь 5 Сорокину за лабу", check: "grade" },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "верни на доработку работу Сорокина с комментарием добавь ER-диаграмму", check: "return" },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "сдай задание по базам данных: ссылка https://example.com", check: "submit" },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "напомни о дедлайне по базам данных", check: "remind" },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "какие у меня долги", check: "debts" },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "отметь отсутствующих", check: "roll" },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "статус заявки на справку", check: "certs" },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что у меня завтра", check: "schedule" },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "открой расписание", check: "open" },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "закажи справку об обучении для военкомата", check: "order" },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "что у меня сегодня", check: "teach" },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "поставь 4 Волкову по информационным технологиям", check: "volkova" },
] as const;

it("живые фразы по сиду проходят через API", async () => {
  const misses: string[] = [];
  for (const item of phrases) {
    const session = await login(item.login, item.password);
    const turn = await authed(session, "POST", "/api/agent/turn", { message: item.phrase, mode: "fallback" });
    const body = turn.json() as {
      say: string;
      confirm?: { pendingId: string; fields: { label: string; value: string }[] };
      ui?: { type: string; to?: string }[];
      undo?: { auditId: number };
      cards?: { title: string; rows: { label: string; value: string }[] }[];
      choices?: { label: string; message: string }[];
      link?: { to: string };
    };
    const say = body.say ?? "";
    const fields = Object.fromEntries((body.confirm?.fields ?? []).map((field) => [field.label, field.value]));
    let ok = false;
    if (item.check === "grade") {
      ok = fields["Студент"]?.includes("Сорокин") && fields["Группа"] === "БИ-3-26-04" && fields["Предмет"] === "Базы данных" && /Лабораторная/.test(fields["Работа"] ?? "") && !say.includes("не нашёл");
    } else if (item.check === "return") {
      ok = !say.includes("не нашёл") && (fields["Комментарий"] === "добавь ER-диаграмму" || (body.choices?.length ?? 0) > 1);
    } else if (item.check === "submit") {
      ok = !say.includes("Такого задания нет") && (body.choices?.length ?? 0) >= 2 && !body.ui?.some((entry) => entry.type === "navigate");
    } else if (item.check === "remind") {
      ok = /Лабораторная|Задачник|индекс|SELECT|нормальн/.test(say) && Boolean(body.undo) && !/^Напоминание «Дедлайн»/.test(say);
    } else if (item.check === "debts") {
      ok = !say.startsWith("Подходящих заданий нет") && /рекурси|нормальн|доработ|риск|автомат|алгебр/i.test(say) && Boolean(body.cards?.length) && !body.ui?.some((entry) => entry.type === "navigate");
    } else if (item.check === "schedule") {
      ok = Boolean(body.cards?.length) && body.link?.to.includes("/schedule") && !body.ui?.some((entry) => entry.type === "navigate");
    } else if (item.check === "open") {
      ok = Boolean(body.ui?.some((entry) => entry.to?.includes("/schedule")));
    } else if (item.check === "order") {
      ok = fields["Документ"] === "Справка об обучении" && /воен/.test(fields["Назначение"] ?? "") && !body.ui?.some((entry) => entry.type === "navigate");
    } else if (item.check === "teach") {
      ok = /проверк/i.test(say) && Boolean(body.cards?.some((card) => card.rows.some((row) => row.label === "На проверке"))) && !body.ui?.some((entry) => entry.type === "navigate");
    } else if (item.check === "volkova") {
      ok = (fields["Студент"] ?? "").includes("Волкова") && /информац/i.test(fields["Предмет"] ?? "") && Boolean(body.confirm) && !body.ui?.some((entry) => entry.type === "navigate");
    } else if (item.check === "roll") {
      ok = Boolean(body.ui?.some((entry) => entry.to?.includes("/teach/journal")));
    } else if (item.check === "certs") {
      ok = /справк/i.test(say) && !/академическ|перевод|материальн/i.test(say);
    }
    if (!ok) misses.push(`${item.phrase} → ${say.slice(0, 220)} | ${JSON.stringify(fields)}`);
  }
  const rate = Math.round(((phrases.length - misses.length) / phrases.length) * 100);
  console.log(`agent-live ${phrases.length - misses.length}/${phrases.length} (${rate}%)`);
  expect(misses, misses.join("\n")).toEqual([]);
});

it("подтверждение справки само заполняет бланк и открывает заявку", async () => {
  const session = await login("sorokin.mo", "Altair-student-31");
  const turn = await authed(session, "POST", "/api/agent/turn", { message: "закажи справку об обучении для военкомата", mode: "fallback" });
  const pendingId = turn.json().confirm.pendingId as string;
  const done = await authed(session, "POST", "/api/agent/confirm", { pendingId });
  expect(done.statusCode, done.body).toBe(200);
  const body = done.json() as { summary: string; download?: { href: string }; ui?: { type: string; to?: string }[]; cards?: { rows: { label: string; value: string }[] }[] };
  expect(body.summary).toMatch(/№\d+/);
  expect(body.summary.toLowerCase()).toContain("выдана");
  expect(body.summary.toLowerCase()).toContain("сразу");
  expect(body.download?.href).toMatch(/\/api\/requests\/\d+\/pdf/);
  expect(body.ui?.some((item) => item.to?.includes("/requests/"))).toBe(true);
  expect(body.cards?.[0].rows.some((row) => row.value.includes("воен"))).toBe(true);
});

it("подтверждение возврата находит работу Сорокина и сообщает результат", async () => {
  const session = await login("orlov.pn", "Altair-teacher-58");
  const turn = await authed(session, "POST", "/api/agent/turn", { message: "верни на доработку работу Сорокина с комментарием добавь ER-диаграмму", mode: "fallback" });
  const first = turn.json() as { confirm?: { pendingId: string; fields: { label: string; value: string }[] }; choices?: { label: string; clarificationId: string; entityId: string }[] };
  let card = first.confirm;
  if (!card && first.choices?.length) {
    const choice = first.choices.find((item) => /индекс/i.test(item.label)) ?? first.choices[0];
    const resumed = await authed(session, "POST", "/api/agent/clarify", { clarificationId: choice.clarificationId, entityId: choice.entityId });
    card = resumed.json().confirm;
  }
  expect(card?.fields.find((field) => field.label === "Комментарий")?.value).toBe("добавь ER-диаграмму");
  expect(card?.fields.find((field) => field.label === "Работа")?.value).toMatch(/Лабораторная|Задачник|Конспект/);
  const done = await authed(session, "POST", "/api/agent/confirm", { pendingId: card.pendingId });
  expect(done.statusCode, done.body).toBe(200);
  const body = done.json() as { summary: string; ui?: { to?: string }[] };
  expect(body.summary.toLowerCase()).toMatch(/сорокин|доработ/);
  expect(body.ui?.some((item) => item.to?.includes("/teach/homework/"))).toBe(true);
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

function authed(session: { cookie: string; csrf: string }, method: string, url: string, payload?: unknown) {
  return app.inject({ method, url, payload, headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
}
