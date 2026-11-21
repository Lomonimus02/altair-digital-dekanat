import { describe, expect, it } from "vitest";
import { academicPeriod, formatDdMm, shortDayDate } from "../../shared/src/dates";
import { narrateWeekSchedule } from "../../shared/src/narrate";
import { countsAsSemester, gradeLabel, scalePoints } from "../../shared/src/journal";
import { analyzeDiscipline } from "../../shared/src/navigator";
import { parseIntent } from "../../shared/src/parser";
import { registry } from "../../shared/src/registry";
import { cspDirectives } from "../src/app";
import { hashPassword, verifyPassword } from "../src/auth/crypto";
import type { DisciplineView } from "../../shared/src/domain";
import { z } from "zod";

const names = ["Математический анализ", "Линейная алгебра", "Базы данных", "Конституционное право"];

describe("учебные периоды", () => {
  it("ноябрь 2026 — первый семестр 2026/27", () => {
    expect(academicPeriod("2026-11-12").current).toEqual({ id: "2026-fall", label: "1 семестр 2026/27" });
    expect(academicPeriod("2026-11-12").previous.id).toBe("2025-spring");
  });
});

describe("навигатор сессии", () => {
  const base: DisciplineView = {
    id: 1,
    name: "Математический анализ",
    controlForm: "exam",
    sessionDate: "2026-11-30",
    obligatoryTotal: 4,
    obligatoryDone: 3,
    semester: "2026-fall",
    marks: [
      { id: 1, label: "К1", value: null, points: 10, maxPoints: 10, kind: "current", awardedOn: null },
      { id: 2, label: "С", value: null, points: 8, maxPoints: 10, kind: "current", awardedOn: null },
      { id: 3, label: "К2", value: null, points: 10, maxPoints: 10, kind: "current", awardedOn: null },
    ],
  };

  it("говорит, какая оценка нужна для автомата", () => {
    const item = analyzeDiscipline(base, "2026-11-12");
    expect(item.automatic).toBeNull();
    expect(item.headline + item.details.join(" ")).toMatch(/отлично|85/);
  });

  it("работа ниже 55% называет получившийся процент", () => {
    const item = analyzeDiscipline({
      ...base,
      obligatoryDone: 4,
      marks: [{ id: 1, label: "К", value: null, points: 4, maxPoints: 10, weight: 1, kind: "current", awardedOn: null }],
    }, "2026-11-12");
    expect(item.headline).toMatch(/40,0%/);
    expect(item.risk).toBe("high");
  });

  it("зачёт называется зачтено по порогу схемы, а учебная часть семестра считается итогом", () => {
    expect(gradeLabel(60, { excellent: 85, good: 70, satisfactory: 55 }, "credit")).toBe("зачтено");
    expect(gradeLabel(40, { excellent: 85, good: 70, satisfactory: 55 }, "credit")).toBe("не зачтено");
    expect(gradeLabel(60, { excellent: 95, good: 80, satisfactory: 70 }, "credit")).toBe("не зачтено");
    expect(scalePoints(14, 20, 15)).toBe(10.5);
    expect(scalePoints(18, 20, 15)).toBe(13.5);
    expect(countsAsSemester({ from: "2026-09-01", to: "2026-12-31" }, "2026-11-21")).toBe(true);
    expect(countsAsSemester({ from: "2026-11-01", to: "2026-11-30" }, "2026-11-21")).toBe(false);
  });

  it("двойка закрывает автомат", () => {
    const item = analyzeDiscipline(
      {
        ...base,
        name: "Линейная алгебра",
        obligatoryDone: 4,
        obligatoryTotal: 4,
        marks: [
          { id: 1, label: "К", value: null, points: 4, maxPoints: 10, kind: "current", awardedOn: null },
          { id: 2, label: "С", value: null, points: 8, maxPoints: 10, kind: "current", awardedOn: null },
        ],
      },
      "2026-11-12",
    );
    expect(item.risk).toBe("high");
    expect(item.automatic).toBeNull();
  });
});

describe("разбор фраз", () => {
  it("понимает основные просьбы студента", () => {
    expect(parseIntent("что у меня завтра?", "student", names).steps[0]).toMatchObject({ tool: "get_schedule", args: { when: "tomorrow" } });
    expect(parseIntent("сколько мне нужно на экзамене по матану для автомата?", "student", names).steps[0]).toMatchObject({
      tool: "get_session_navigator",
      args: { subject: "Математический анализ" },
    });
    expect(parseIntent("открой оценки по линейной алгебре", "student", names).steps[0]).toMatchObject({
      tool: "get_grades",
      args: { subject: "Линейная алгебра" },
    });
    expect(parseIntent("нужна справка для военкомата", "student", names).steps[0]).toMatchObject({
      tool: "create_request",
      args: { kind: "military_certificate" },
    });
    expect(parseIntent("хочу академ", "student", names).steps[0]).toMatchObject({ tool: "create_request", args: { kind: "academic_leave" } });
    expect(parseIntent("где моя справка?", "student", names).steps[0].tool).toBe("list_requests");
    expect(parseIntent("покажи расписание на следующую неделю", "student", names).steps[0]).toMatchObject({
      tool: "get_schedule",
      args: { when: "next_week" },
    });
    expect(parseIntent("включи тёмную тему", "student", names).steps[0]).toMatchObject({ tool: "update_settings", args: { theme: "dark" } });
  });

  it("сотруднику отдаёт входящие, а не расписание студента", () => {
    expect(parseIntent("разбери входящие", "staff").steps[0].tool).toBe("staff_list_inbox");
    expect(parseIntent("разбери входящие", "student", names).steps).toHaveLength(0);
  });
});

describe("реестр", () => {
  it("ни один инструмент не принимает чужой идентификатор", () => {
    for (const action of registry) {
      const keys = collectKeys(action.schema);
      expect(keys.has("userId"), action.name).toBe(false);
      expect(keys.has("studentId"), action.name).toBe(false);
    }
  });

  it("CSP разрешает локальную модель и не открывает произвольные сайты", () => {
    const connect = cspDirectives().connectSrc.join(" ");
    expect(connect).toContain("https://huggingface.co");
    expect(connect).not.toContain("gigachat");
    expect(cspDirectives().scriptSrc).toContain("'wasm-unsafe-eval'");
  });
});

describe("недельное расписание агента", () => {
  const lesson = (patch: Partial<import("../../shared/src/domain").LessonView>): import("../../shared/src/domain").LessonView => ({
    id: 1,
    date: "2026-11-16",
    startsAt: "09:00",
    endsAt: "10:30",
    discipline: "Программирование",
    kind: "lecture",
    room: "314",
    teacher: "доц. Орлов П. Н.",
    changeType: "none",
    changeNote: null,
    pairNumber: 1,
    flagged: false,
    groupName: "БИ-3-26-04",
    ...patch,
  });

  it("группирует дни и называет отмену, аудиторию и перенос", () => {
    expect(formatDdMm("2026-12-03")).toBe("03.12");
    expect(shortDayDate("2026-11-16")).toBe("Пн, 16 ноября");
    const text = narrateWeekSchedule(
      [
        lesson({ id: 1, date: "2026-11-16", startsAt: "09:00", pairNumber: 1 }),
        lesson({
          id: 2,
          date: "2026-11-19",
          startsAt: "13:00",
          pairNumber: 3,
          discipline: "Экономика фирмы",
          room: "101",
          changeType: "cancelled",
          changeNote: "Преподаватель на конференции",
        }),
        lesson({
          id: 3,
          date: "2026-11-19",
          startsAt: "09:00",
          pairNumber: 1,
          discipline: "Линейная алгебра",
          room: "415",
          changeType: "room",
          changeNote: "Аудитория изменена: была 401, теперь 415",
        }),
        lesson({
          id: 4,
          date: "2026-11-20",
          startsAt: "13:00",
          pairNumber: 3,
          changeType: "moved",
          changeNote: "Перенесено с четверга, 19.11",
          groupName: "ЮР-1-26-02",
        }),
      ],
      { label: "Эта неделя", sundayNote: false },
    );
    expect(text).toContain("Пн, 16 ноября: 09:00 Программирование, БИ-3-26-04, ауд. 314");
    expect(text).toContain("Чт, 19 ноября: 09:00 Линейная алгебра, БИ-3-26-04, ауд. 415 — другая аудитория (Аудитория изменена: была 401, теперь 415); 13:00 Экономика фирмы, БИ-3-26-04, ауд. 101 — отменена");
    expect(text).toContain("Пт, 20 ноября: 13:00 Программирование, ЮР-1-26-02, ауд. 314 — перенос (Перенесено с четверга, 19.11)");
    expect(text.indexOf("Пн, 16 ноября")).toBeLessThan(text.indexOf("Чт, 19 ноября"));
  });
});

describe("пароли", () => {
  it("scrypt проверяется и не совпадает с чужим паролем", async () => {
    const stored = await hashPassword("Altair-student-31");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Altair-student-31", stored)).toBe(true);
    expect(await verifyPassword("Altair-student-17", stored)).toBe(false);
  });
});

function collectKeys(schema: z.ZodTypeAny, acc = new Set<string>()) {
  if (schema instanceof z.ZodObject) for (const key of Object.keys(schema.shape)) acc.add(key);
  if (schema instanceof z.ZodEffects) collectKeys(schema.innerType(), acc);
  return acc;
}
