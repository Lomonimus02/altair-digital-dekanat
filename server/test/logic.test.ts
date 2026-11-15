import { describe, expect, it } from "vitest";
import { academicPeriod } from "../../shared/src/dates";
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
      { id: 1, label: "К1", value: 5, kind: "current", awardedOn: null },
      { id: 2, label: "С", value: 4, kind: "current", awardedOn: null },
      { id: 3, label: "К2", value: 5, kind: "current", awardedOn: null },
    ],
  };

  it("говорит, какая оценка нужна для автомата", () => {
    const item = analyzeDiscipline(base, "2026-11-12");
    expect(item.automatic).toBeNull();
    expect(item.headline + item.details.join(" ")).toMatch(/отлично/i);
    expect(item.details.join(" ")).toMatch(/5/);
  });

  it("двойка закрывает автомат", () => {
    const item = analyzeDiscipline(
      {
        ...base,
        name: "Линейная алгебра",
        obligatoryDone: 4,
        obligatoryTotal: 4,
        marks: [
          { id: 1, label: "К", value: 2, kind: "current", awardedOn: null },
          { id: 2, label: "С", value: 4, kind: "current", awardedOn: null },
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
