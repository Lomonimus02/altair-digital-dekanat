import { longDay } from "./dates";
import { CHANGE_LABEL, KIND_LABEL, STATUS_LABEL, type LessonView, type RequestStatus } from "./domain";
import { formatMark, type NavigatorItem } from "./navigator";

export function autoWord(auto: NavigatorItem["automatic"]): string {
  if (auto === "5") return "отлично";
  if (auto === "4") return "хорошо";
  if (auto === "pass") return "зачёт";
  return "";
}

export function narrateOverview(items: NavigatorItem[]): string {
  if (!items.length) return "За выбранный семестр оценок пока нет.";
  const risks = items.filter((i) => i.risk === "high");
  const autos = items.filter((i) => i.automatic && !i.finalText);
  const closed = items.filter((i) => i.finalText);
  const parts = [`Дисциплин в семестре: ${items.length}.`];
  if (risks.length) parts.push(`Высокий риск: ${risks.map((i) => i.name).join(", ")}.`);
  else parts.push("Высокого риска сейчас нет.");
  if (autos.length) parts.push(`Автомат уже открыт: ${autos.map((i) => `${i.name} (${autoWord(i.automatic)})`).join(", ")}.`);
  if (closed.length) parts.push(`Уже закрыто: ${closed.map((i) => `${i.name} — ${i.finalText}`).join(", ")}.`);
  return parts.join(" ");
}

export function narrateAdvice(items: NavigatorItem[], subject?: string): string {
  const picked = subject ? items.filter((i) => i.name === subject) : items;
  if (subject && !picked.length) {
    const names = items.map((i) => i.name).join(", ");
    return `Не нашёл дисциплину «${subject}». В зачётке сейчас: ${names || "пусто"}.`;
  }
  if (!picked.length) return "Оценок за этот семестр нет.";
  if (subject) {
    const item = picked[0];
    return [item.headline, ...item.details].join(" ");
  }
  const focus = items.filter((i) => i.risk !== "low").slice(0, 4);
  const lines = [narrateOverview(items)];
  for (const item of focus) lines.push(item.headline);
  lines.push("Полный разбор открыт в успеваемости.");
  return lines.join(" ");
}

export function narrateSchedule(opts: {
  label: string;
  focus: string;
  sundayNote: boolean;
  mode: "day" | "week";
  items: LessonView[];
}): string {
  const prefix = opts.sundayNote ? "Это воскресенье, занятий нет — показываю понедельник. " : "";
  if (opts.mode === "week") {
    const changes = opts.items.filter((i) => i.changeType !== "none");
    const active = opts.items.filter((i) => i.changeType !== "cancelled");
    if (!opts.items.length) return `${prefix}${opts.label}: занятий нет.`;
    const changeText = changes.length
      ? ` Изменения: ${changes
          .map((i) => `${CHANGE_LABEL[i.changeType].toLowerCase()} — ${i.discipline} (${longDay(i.date)})`)
          .join("; ")}.`
      : " Изменений нет.";
    return `${prefix}${opts.label}: ${active.length} занятий.${changeText} Открыл неделю.`;
  }
  const dayItems = opts.items.filter((i) => i.date === opts.focus);
  const head = `${prefix}${opts.label}, ${longDay(opts.focus)}.`;
  if (!dayItems.length) return `${head} Занятий нет.`;
  const lines = dayItems.map((lesson, index) => formatLesson(lesson, index));
  return `${head}\n${lines.join("\n")}`;
}

function formatLesson(lesson: LessonView, index: number): string {
  const kind = KIND_LABEL[lesson.kind] ?? lesson.kind;
  const place = [lesson.room ? `ауд. ${lesson.room}` : null, lesson.teacher].filter(Boolean).join(" · ");
  const flag = lesson.changeType !== "none" ? ` · ${CHANGE_LABEL[lesson.changeType]}` : "";
  const note = lesson.changeNote ? ` (${lesson.changeNote})` : "";
  return `${index + 1}. ${lesson.startsAt}–${lesson.endsAt} · ${lesson.discipline} · ${kind}${place ? ` · ${place}` : ""}${flag}${note}`;
}

export function composeBrief(input: {
  addressName: string;
  hour: number;
  todayISO: string;
  todayLessons: LessonView[];
  changes: LessonView[];
  navigator: NavigatorItem[];
  requests: { id: number; title: string; status: RequestStatus }[];
  unread: number;
  reminders: { title: string; dueLabel: string }[];
}): { greeting: string; paragraphs: string[] } {
  const hello = input.hour < 11 ? "Доброе утро" : input.hour < 17 ? "Добрый день" : "Добрый вечер";
  const greeting = `${hello}, ${input.addressName}.`;
  const paragraphs: string[] = [];
  const active = input.todayLessons.filter((l) => l.changeType !== "cancelled");
  const cancelled = input.todayLessons.filter((l) => l.changeType === "cancelled");
  if (!input.todayLessons.length) paragraphs.push(`Сегодня, ${longDay(input.todayISO, true)}, пар нет.`);
  else {
    const names = active.map((l) => `${l.startsAt} ${l.discipline}`).join(", ");
    const cancelText = cancelled.length ? ` Отменено: ${cancelled.map((l) => l.discipline).join(", ")}.` : "";
    paragraphs.push(`Сегодня ${active.length} ${pairWord(active.length)}: ${names || "все пары отменены"}.${cancelText}`);
  }
  const otherChanges = input.changes.filter((c) => c.date !== input.todayISO);
  if (otherChanges.length) {
    paragraphs.push(
      `До конца недели ещё ${otherChanges.length} ${changeWord(otherChanges.length)}: ${otherChanges
        .slice(0, 3)
        .map((c) => `${CHANGE_LABEL[c.changeType].toLowerCase()} — ${c.discipline}`)
        .join("; ")}.`,
    );
  }
  const risks = input.navigator.filter((i) => i.risk === "high");
  if (risks.length) {
    paragraphs.push(`К сессии есть риск: ${risks.map((r) => r.name).join(", ")}.`);
  }
  const open = input.requests.filter((r) => r.status === "submitted" || r.status === "in_progress" || r.status === "ready");
  if (open.length) {
    paragraphs.push(
      `Заявки: ${open.map((r) => `№${r.id} «${r.title}» — ${STATUS_LABEL[r.status].toLowerCase()}`).join("; ")}.`,
    );
  }
  if (input.reminders.length) {
    paragraphs.push(`Напоминания: ${input.reminders.map((r) => `${r.title} (${r.dueLabel})`).join("; ")}.`);
  }
  if (input.unread) paragraphs.push(`Непрочитанных уведомлений: ${input.unread}.`);
  return { greeting, paragraphs };
}

function pairWord(n: number) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "пара";
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "пары";
  return "пар";
}

function changeWord(n: number) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "изменение";
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "изменения";
  return "изменений";
}
