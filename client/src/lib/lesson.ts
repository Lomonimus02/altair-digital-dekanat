import type { LessonView } from "@shared/domain";
import { formatDdMm } from "@shared/dates";

function roleOf(lesson: LessonView) {
  if (lesson.moveRole) return lesson.moveRole;
  const note = (lesson.changeNote ?? "").toLowerCase();
  return note.includes("перенесено на") ? "from" : "to";
}

function dayShort(date: string) {
  const names = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
  return `${names[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${formatDdMm(date)}`;
}

export function lessonView(lesson: LessonView) {
  if (lesson.changeType === "cancelled") return { state: "cancelled" as const, badge: undefined, note: lesson.changeNote ?? undefined };
  if (lesson.changeType === "room") return { state: "room" as const, badge: "Другая аудитория", note: lesson.changeNote ?? undefined };
  if (lesson.changeType === "moved") {
    if (roleOf(lesson) === "from") {
      const target = lesson.movedTo;
      return {
        state: "moved-from" as const,
        badge: target ? `Перенесено → ${dayShort(target.date)}, ${target.startsAt}` : "Перенесено",
        note: target ? (target.room ? `Новое место: ауд. ${target.room}` : undefined) : lesson.changeNote ?? undefined,
      };
    }
    const source = lesson.movedFrom;
    return {
      state: "moved-to" as const,
      badge: source ? `Перенесено с ${dayShort(source.date)}, ${source.startsAt}` : "Перенесено сюда",
      note: source ? undefined : lesson.changeNote ?? undefined,
    };
  }
  return { state: "normal" as const, badge: undefined, note: lesson.changeNote ?? undefined };
}

export function held(lesson: LessonView) {
  return lesson.changeType !== "cancelled" && !(lesson.changeType === "moved" && roleOf(lesson) === "from");
}

