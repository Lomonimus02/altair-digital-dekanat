import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { formFill, formMatches } from "../../shared/src/form-fill";
import { titleHit } from "../src/homework";

it("слой свайпа скрыт, пока карточку не тянут", () => {
  const source = readFileSync("client/src/pages/more.tsx", "utf8");
  expect(source).toContain('aria-hidden={open ? undefined : true}');
  expect(source).toContain('visibility: open ? "visible" : "hidden"');
  expect(source).toContain("layer.current.inert = !open");
});

it("название работы ищется по корню слова", () => {
  expect(titleHit("лабораторную «транзакции»", "Лабораторная: транзакции", 10)).toBe(true);
  expect(titleHit("Лабораторная: транзакции", "Лабораторная: транзакции", 10)).toBe(true);
  expect(titleHit("задание №10", "Любое", 10)).toBe(true);
  expect(titleHit("эссе о погоде", "Лабораторная: транзакции", 10)).toBe(false);
});

it("форма задания совпадает с тем, что уйдёт на сервер", () => {
  const payload = {
    groupName: "ЮР-1-26-02",
    discipline: "Информационные технологии в юридической деятельности",
    title: "Эссе о сроках хранения",
    description: "Эссе о сроках хранения, срок 30 ноября",
    kind: "essay",
    deadline: "2026-11-30",
  };
  const fill = formFill("teacher_issue_assignment", payload);
  expect(formMatches(fill, {
    group: payload.groupName,
    discipline: payload.discipline,
    title: payload.title,
    kind: "essay",
    deadline: "2026-11-30",
  })).toBe(true);
  expect(fill.title).toBe(payload.title);
  expect(fill.kind).not.toBe("lab");
});
