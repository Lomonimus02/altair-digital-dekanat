import { afterEach, expect, it } from "vitest";
import { applyDateInput, longDay, maskRuDate, nearestStudyDay, pasteRuDate, resolveWhen, setClock, studyWeek, weekdayIndex } from "../../shared/src/dates";

afterEach(() => setClock(null));

const week = [
  ["2026-11-09", "понедельник", "2026-11-09"],
  ["2026-11-10", "вторник", "2026-11-10"],
  ["2026-11-11", "среда", "2026-11-11"],
  ["2026-11-12", "четверг", "2026-11-12"],
  ["2026-11-13", "пятница", "2026-11-13"],
  ["2026-11-14", "суббота", "2026-11-14"],
  ["2026-11-15", "воскресенье", "2026-11-16"],
] as const;

it("набор даты не раздувает короткий год и не портит середину", () => {
  let value = "";
  let caret = 0;
  for (const digit of "01112026") {
    const next = `${value.slice(0, caret)}${digit}${value.slice(caret)}`;
    const applied = applyDateInput(value, next, caret + 1);
    value = applied.value;
    caret = applied.caret;
  }
  expect(value).toBe("01.11.2026");
  expect(caret).toBe(value.length);
  expect(applyDateInput("01.11.202", "01.11.20", 8).value).toBe("01.11.20");
  expect(applyDateInput("01.11.20", "01.11.202", 9).value).toBe("01.11.202");
  expect(applyDateInput("01.11.2026", "0111.2026", 2)).toEqual({ value: "01.12.026", caret: 1 });
  expect(applyDateInput("01.", "01", 2)).toEqual({ value: "0", caret: 1 });
  expect(applyDateInput("01.11", "01.1", 4).value).toBe("01.1");
  expect(applyDateInput("01.11.2026", "01.151.2026", 5)).toEqual({ value: "01.15.2026", caret: "01.15".length });
  expect(pasteRuDate("2026-11-01")).toBe("01.11.2026");
  expect(pasteRuDate("01/11/26")).toBe("01.11.2026");
  expect(pasteRuDate("1.1.2026")).toBe("01.01.2026");
  expect(pasteRuDate("01112026")).toBe("01.11.2026");
  expect(maskRuDate("01.11.20")).toBe("01.11.20");
  expect(maskRuDate("2026-11-01")).toBe("20.26.1101");
});

it("ближайший учебный день для каждого дня недели", () => {
  expect(weekdayIndex("2026-11-15")).toBe(0);
  for (const [iso, , nearest] of week) {
    expect(nearestStudyDay(iso), iso).toBe(nearest);
  }
});

it("воскресенье открывает следующую учебную неделю, суббота — текущую", () => {
  expect(studyWeek("2026-11-15")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
  expect(studyWeek("2026-11-14")[0]).toBe("2026-11-09");
  expect(studyWeek("2026-11-14").at(-1)).toBe("2026-11-14");
  const sunday = resolveWhen("week", "2026-11-15");
  expect(sunday.focus).toBe("2026-11-16");
  expect(sunday.sundayNote).toBe(true);
  expect(resolveWhen("today", "2026-11-15").focus).toBe("2026-11-16");
  expect(resolveWhen("today", "2026-11-13")).toMatchObject({ focus: "2026-11-13", label: "Сегодня" });
  expect(resolveWhen("next_week", "2026-11-15").focus).toBe("2026-11-23");
  expect(resolveWhen("week", "2026-11-25").focus).toBe("2026-11-25");
  expect(resolveWhen("next_week", "2026-11-25").focus).toBe("2026-11-30");
  expect(resolveWhen("tomorrow", "2026-11-13").focus).toBe("2026-11-14");
});

it("после запятой день недели со строчной", () => {
  expect(longDay("2026-11-15", true)).toMatch(/^воскресенье,/);
});

it("часы воскресенья по Москве", () => {
  setClock("2026-11-15T09:00:00+03:00");
  expect(resolveWhen("week").focus).toBe("2026-11-16");
  expect(resolveWhen("today").label).toBe("Понедельник");
});
