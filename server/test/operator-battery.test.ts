import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { seed } from "../src/db/seed";
import { seedHomework } from "../src/db/seed-homework";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await seed();
  await seedHomework();
});
afterAll(async () => {
  await app.close();
});

const phrases: { login: string; password: string; phrase: string; confirm?: boolean; hint?: RegExp }[] = [
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что у меня на этой неделе", hint: /ноябр|занят/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что у меня на следующей неделе", hint: /ноябр/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "покажи расписание на следующую неделю", hint: /ноябр/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что у меня завтра", hint: /завтра|ноябр|занят/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что послезавтра", hint: /послезавтра|ноябр|занят/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что у меня сегодня", hint: /ноябр|занят|понедельник/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "26 ноября", hint: /26 ноября/ },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "в четверг", hint: /ноябр/ },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "в следующий четверг", hint: /ноябр|декабр/ },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "через неделю", hint: /ноябр/ },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "с 30 ноября", hint: /30 ноября/ },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "в декабре", hint: /какую неделю/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "когда следующая пара по базам данных", hint: /по дисциплине «Базы данных»/ },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "есть ли изменения в расписании", hint: /изменен|отмен|перенос|аудитор/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "открой оценки", hint: /дисциплин|риск|сесс/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "сколько мне нужно на экзамене по матану для автомата", hint: /матан|математическ/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "какие у меня долги", hint: /срок|семестр|задач|рекурс|долг/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что мне сдать", hint: /задани|срок|сдать/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "где моя справка", hint: /заявк|справк/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "подай заявку на справку об обучении для военкомата", confirm: true },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "включи тёмную тему", hint: /тема/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "отметь все уведомления прочитанными", hint: /прочитан/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "открой профиль", hint: /сорокин/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "что делал агент", hint: /действ|агент|журнал/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "открой расписание", hint: /ноябр|занят/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "скрой отмены", hint: /скрыт|отмен/i },
  { login: "sorokin.mo", password: "Altair-student-31", phrase: "покажи отмены", hint: /отмен/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "что у меня сегодня", hint: /проверк|пар|сегодня/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "что у меня на неделе", hint: /ноябр/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "покажи непроверенные работы", hint: /проверк/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "поставь Волковой 5 за лабораторную", confirm: true },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "верни на доработку Сорокину лабу с комментарием добавь пример", confirm: true },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "отметь отсутствующих", hint: /явк|журнал|отсутств/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "сводка по базам данных", hint: /баз/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "на следующей неделе", hint: /ноябр/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "когда следующая пара по базам данных", hint: /по дисциплине «Базы данных»/ },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "есть ли переносы в расписании", hint: /перенос|изменен|отмен|аудитор/i },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "выдай задание по базам данных на пятницу", confirm: true },
  { login: "orlov.pn", password: "Altair-teacher-58", phrase: "включи тёмную тему", hint: /тема/i },
  { login: "lebedeva.ip", password: "Altair-staff-204", phrase: "разбери входящие", hint: /справк|заявлен|входящ|заявк/i },
  { login: "lebedeva.ip", password: "Altair-staff-204", phrase: "опубликуй объявление: Приём справок до 17", confirm: true },
];

it("сорок фраз выполняются правилами и запасным путём сервера", async () => {
  expect(phrases.length).toBeGreaterThanOrEqual(40);
  const sessions = new Map<string, { cookie: string; csrf: string }>();
  const misses: string[] = [];
  for (const item of phrases) {
    for (const mode of ["fallback", "server"] as const) {
      const session = sessions.get(item.login) ?? (await login(item.login, item.password));
      sessions.set(item.login, session);
      const turn = await app.inject({
        method: "POST",
        url: "/api/agent/turn",
        payload: { message: item.phrase, mode },
        headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
      });
      const body = turn.json() as { say?: string; confirm?: { pendingId: string }; steps?: { status: string; tool?: string }[] };
      const say = body.say ?? "";
      const ok = turn.statusCode === 200 && say.length > 8 && (!item.confirm || Boolean(body.confirm)) && (!item.hint || item.hint.test(say)) && !body.steps?.every((step) => step.status === "error");
      if (!ok) misses.push(`${mode} ${item.login} «${item.phrase}» → ${turn.statusCode} ${say.slice(0, 180)}`);
    }
  }
  expect(misses, misses.join("\n")).toEqual([]);
});

it("заявка заполняется и создаётся только после подтверждения", async () => {
  const session = await login("sorokin.mo", "Altair-student-31");
  const before = await app.inject({ method: "GET", url: "/api/requests", headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
  const count = (before.json() as { requests: unknown[] }).requests.length;
  const turn = await app.inject({
    method: "POST",
    url: "/api/agent/turn",
    payload: { message: "подай заявку на справку об обучении для военкомата", mode: "fallback" },
    headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
  });
  const pendingId = turn.json().confirm.pendingId as string;
  const mid = await app.inject({ method: "GET", url: "/api/requests", headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
  expect((mid.json() as { requests: unknown[] }).requests.length).toBe(count);
  const done = await app.inject({
    method: "POST",
    url: "/api/agent/confirm",
    payload: { pendingId },
    headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
  });
  expect(done.statusCode).toBe(200);
  const after = await app.inject({ method: "GET", url: "/api/requests", headers: { cookie: session.cookie, "x-csrf-token": session.csrf } });
  expect((after.json() as { requests: unknown[] }).requests.length).toBe(count + 1);
});

async function login(loginName: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: loginName, password } });
  expect(res.statusCode, res.body).toBe(200);
  const lines = [res.headers["set-cookie"]].flat().filter(Boolean) as string[];
  const jar: Record<string, string> = {};
  for (const line of lines) {
    const [pair] = line.split(";");
    const [key, value] = pair.split("=");
    jar[key] = value;
  }
  return { cookie: `sid=${jar.sid}; csrf=${jar.csrf}`, csrf: res.json().csrfToken as string };
}
