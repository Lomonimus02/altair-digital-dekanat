import { expect, it } from "vitest";
import { ruCount } from "../../shared/src/dates";
import { extractComment, parseIntent } from "../../shared/src/parser";

const forms = [
  ["верни на доработку работу Сорокина с комментарием добавь ER-диаграмму", "добавь ER-диаграмму"],
  ["верни на доработку с комментарием: добавь схему", "добавь схему"],
  ["верни на доработку, комментарий: добавь подписи", "добавь подписи"],
  ["верни на доработку, коммент: добавь пример", "добавь пример"],
  ["верни на доработку с комментарием «добавь ER-диаграмму»", "добавь ER-диаграмму"],
] as const;

it("комментарий к возврату не теряет первую букву", () => {
  for (const [phrase, comment] of forms) {
    expect(extractComment(phrase), phrase).toBe(comment);
    const parsed = parseIntent(phrase, "teacher");
    expect(parsed.steps[0]?.tool).toBe("teacher_return_homework");
    expect(parsed.steps[0]?.args.comment).toBe(comment);
  }
});

it("числительные занятий", () => {
  expect(ruCount(1, "занятие", "занятия", "занятий")).toBe("1 занятие");
  expect(ruCount(3, "занятие", "занятия", "занятий")).toBe("3 занятия");
  expect(ruCount(5, "занятие", "занятия", "занятий")).toBe("5 занятий");
  expect(ruCount(11, "занятие", "занятия", "занятий")).toBe("11 занятий");
  expect(ruCount(22, "занятие", "занятия", "занятий")).toBe("22 занятия");
});
