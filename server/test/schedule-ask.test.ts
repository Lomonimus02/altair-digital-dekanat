import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { setClock } from "../../shared/src/dates";
import { parseIntent } from "../../shared/src/parser";
import { buildApp } from "../src/app";
import { extendSchedule } from "../src/db/seed-schedule-extend";
import { seed } from "../src/db/seed";
import { seedHomework } from "../src/db/seed-homework";

const names = ["Базы данных", "Программирование", "Математический анализ"];

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await seed();
  await seedHomework();
  await extendSchedule();
});
afterEach(() => setClock(null));
afterAll(async () => {
  await app.close();
});

const phrases = [
  "на этой неделе",
  "на ближайшей неделе",
  "на следующей неделе",
  "через неделю",
  "на неделе 23 ноября",
  "с 30 ноября",
  "26 ноября",
  "26.11",
  "в четверг",
  "в следующий четверг",
  "послезавтра",
  "в декабре",
  "когда следующая пара по базам данных",
  "есть ли переносы в расписании",
  "есть ли изменения в расписании",
] as const;

it("фразы расписания разбираются у студента и преподавателя", () => {
  for (const role of ["student", "teacher"] as const) {
    for (const phrase of phrases) {
      const step = parseIntent(phrase, role, names).steps[0];
      expect(step?.tool, `${role}: ${phrase}`).toBe("get_schedule");
    }
  }
  setClock("2026-11-15T12:00:00+03:00");
  expect(parseIntent("на следующей неделе", "student", names).steps[0].args.when).toBe("next_week");
  expect(parseIntent("на этой неделе", "student", names).steps[0].args.when).toBe("week");
  expect(parseIntent("в следующий четверг", "teacher", names).steps[0].args).toMatchObject({ when: "date", date: "2026-11-26" });
  expect(parseIntent("в четверг", "teacher", names).steps[0].args).toMatchObject({ when: "date", date: "2026-11-19" });
  expect(parseIntent("26.11", "student", names).steps[0].args).toMatchObject({ when: "date", date: "2026-11-26" });
  expect(parseIntent("на неделе 23 ноября", "student", names).steps[0].args).toMatchObject({ when: "week", date: "2026-11-23" });
  expect(parseIntent("с 30 ноября", "student", names).steps[0].args).toMatchObject({ when: "range", from: "2026-11-30" });
  expect(parseIntent("в декабре", "teacher", names).steps[0].args).toMatchObject({ when: "month", month: 12 });
  expect(parseIntent("когда следующая пара по базам данных", "teacher").steps[0].args).toMatchObject({ when: "next_lesson", subject: "Базы данных" });
  expect(parseIntent("есть ли изменения в расписании", "student", names).steps[0].args.when).toBe("changes");
  setClock("2026-11-25T12:00:00+03:00");
  expect(parseIntent("в четверг", "student", names).steps[0].args).toMatchObject({ when: "date", date: "2026-11-26" });
  expect(parseIntent("в следующий четверг", "student", names).steps[0].args).toMatchObject({ when: "date", date: "2026-12-03" });
  expect(parseIntent("послезавтра", "student", names).steps[0].args.when).toBe("day_after");
});

it("на живом сиде воскресенье и среда отвечают разными неделями", async () => {
  const misses: string[] = [];
  for (const clock of ["2026-11-15T12:00:00+03:00", "2026-11-25T12:00:00+03:00"]) {
    const sunday = clock.startsWith("2026-11-15");
    for (const role of [
      { login: "sorokin.mo", password: "Altair-student-31", teacher: false },
      { login: "orlov.pn", password: "Altair-teacher-58", teacher: true },
    ]) {
      const session = await login(role.login, role.password);
      const ask = async (phrase: string) => {
        setClock(clock);
        const turn = await app.inject({
          method: "POST",
          url: "/api/agent/turn",
          payload: { message: phrase, mode: "fallback" },
          headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
        });
        return String(turn.json().say ?? "");
      };
      const checks: [string, (say: string) => boolean][] = [
        ["на этой неделе", (say) => (sunday ? say.includes("Пн, 16 ноября") && !say.includes("Пн, 23 ноября") : say.includes("Пн, 23 ноября") && !say.includes("Пн, 30 ноября"))],
        ["на ближайшей неделе", (say) => (sunday ? say.includes("Пн, 16 ноября") : say.includes("Пн, 23 ноября"))],
        ["на следующей неделе", (say) => (sunday ? say.includes("Пн, 23 ноября") && !say.includes("Пн, 16 ноября") : say.includes("Пн, 30 ноября") && !say.includes("Пн, 23 ноября"))],
        ["через неделю", (say) => (sunday ? say.includes("Пн, 23 ноября") : say.includes("Пн, 30 ноября"))],
        ["на неделе 23 ноября", (say) => say.includes("Пн, 23 ноября") && say.includes("23–28 ноября")],
        ["с 30 ноября", (say) => say.includes("С 30 ноября") && say.includes("30 ноября")],
        ["26 ноября", (say) => say.includes("Чт, 26 ноября:") && (say.match(/Чт, 26 ноября/g) ?? []).length === 1],
        ["26.11", (say) => say.includes("Чт, 26 ноября:") && (say.match(/Чт, 26 ноября/g) ?? []).length === 1],
        ["в четверг", (say) => say.includes(sunday ? "19 ноября" : "26 ноября")],
        ["в следующий четверг", (say) => say.includes(sunday ? "26 ноября" : "3 декабря")],
        ["послезавтра", (say) => say.includes(sunday ? "17 ноября" : "27 ноября")],
        ["в декабре", (say) => /какую неделю/i.test(say) && /декабр/i.test(say)],
        ["когда следующая пара по базам данных", (say) => say.includes("по дисциплине «Базы данных»") && !say.includes("по «Базы данных»") && say.includes(sunday ? "16 ноября" : "25 ноября")],
        ["есть ли переносы в расписании", (say) => /отменена|перенос|другая аудитория/.test(say) && say.includes(sunday ? "19 ноября" : "26 ноября") && say.includes(sunday ? "26 ноября" : "3 декабря")],
        ["есть ли изменения в расписании", (say) => /отменена|перенос|другая аудитория/.test(say)],
      ];
      for (const [phrase, ok] of checks) {
        const say = await ask(phrase);
        if (!ok(say)) misses.push(`${clock.slice(0, 10)} ${role.login} «${phrase}» → ${say.slice(0, 240).replaceAll("\n", " | ")}`);
        if (!role.teacher && phrase === "на этой неделе" && say.includes("БИ-3-26-04")) misses.push("студент повторяет группу в каждой строке");
        if (role.teacher && phrase === "на этой неделе" && !say.includes("БИ-3-26-04")) misses.push("преподаватель не назвал группу");
      }
    }
  }
  expect(misses, misses.join("\n")).toEqual([]);
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
