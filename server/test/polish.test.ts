import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { formFill, formMatches } from "../../shared/src/form-fill";
import { parseIntent, submissionText } from "../../shared/src/parser";
import { selectAssignments, titleHit } from "../src/homework";

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
    deadline: "30.11.2026",
  })).toBe(true);
  expect(fill.title).toBe(payload.title);
  expect(fill.kind).not.toBe("lab");
});

it("текст сдачи попадает в поле дословно", () => {
  const phrases = [
    "сдай лабораторную «транзакции» с текстом Готово",
    "сдай лабораторную «транзакции» с комментарием Готово",
    "сдай лабораторную «транзакции», напиши Готово",
  ];
  for (const phrase of phrases) {
    expect(submissionText(phrase), phrase).toBe("Готово");
    const parsed = parseIntent(phrase, "student");
    expect(parsed.steps[0]?.args.body, phrase).toBe("Готово");
    expect(parsed.steps[0]?.args.subject, phrase).toBe("транзакции");
  }
  expect(submissionText("напиши «Готово» и сдай лабораторную")).toBe("Готово");
});

it("полное название работы не спрашивает, какая из двух", () => {
  const rows = [
    { id: 1, title: "Лабораторная: SELECT", discipline: "Базы данных", kind: "lab" },
    { id: 2, title: "Лабораторная: транзакции", discipline: "Базы данных", kind: "lab" },
  ];
  expect(titleHit("Лабораторная: транзакции", "Лабораторная: SELECT", 1)).toBe(false);
  expect(selectAssignments("Лабораторная: транзакции", rows).map((row) => row.id)).toEqual([2]);
  expect(selectAssignments("«Лабораторная: транзакции»", rows).map((row) => row.id)).toEqual([2]);
});

it("условие задания не повторяет команду, а срок в форме — дд.мм.гггг", () => {
  const parsed = parseIntent("выдай задание группе ЮР-1-26-02: Эссе о сроках хранения, срок 30 ноября", "teacher");
  const args = parsed.steps[0]?.args ?? {};
  expect(args.title).toBe("Эссе о сроках хранения");
  expect(String(args.description)).toBe("Эссе о сроках хранения");
  expect(String(args.description)).not.toMatch(/выдай/i);
  expect(String(args.description)).not.toMatch(/срок\s+\d/);
  const fill = formFill("teacher_issue_assignment", args);
  expect(fill.description).toBe("Эссе о сроках хранения");
  expect(fill.deadline).toBe("30.11.2026");
});
