import { expect, it } from "vitest";
import { parseIntent } from "../../shared/src/parser";

const names = ["Математический анализ", "Линейная алгебра", "Базы данных", "Программирование", "Конституционное право"];

const cases: { role: "student" | "staff" | "teacher"; phrase: string; tool: string; args?: Record<string, unknown> }[] = [
  { role: "student", phrase: "что у меня завтра?", tool: "get_schedule", args: { when: "tomorrow" } },
  { role: "student", phrase: "что у меня сегодня", tool: "get_schedule", args: { when: "today" } },
  { role: "student", phrase: "покажи расписание на следующую неделю", tool: "get_schedule", args: { when: "next_week" } },
  { role: "student", phrase: "что послезавтра", tool: "get_schedule", args: { when: "day_after" } },
  { role: "student", phrase: "открой оценки по линейной алгебре", tool: "get_grades", args: { subject: "Линейная алгебра" } },
  { role: "student", phrase: "сколько мне нужно на экзамене по матану для автомата?", tool: "get_session_navigator", args: { subject: "Математический анализ" } },
  { role: "student", phrase: "сводка по базам данных", tool: "get_session_navigator", args: { subject: "Базы данных" } },
  { role: "student", phrase: "какие у меня долги", tool: "list_homework", args: { bucket: "overdue" } },
  { role: "student", phrase: "что мне сдать до пятницы", tool: "list_homework" },
  { role: "student", phrase: "какие лабы на этой неделе", tool: "list_homework", args: { kind: "lab" } },
  { role: "student", phrase: "что сдать до 20 ноября", tool: "list_homework" },
  { role: "student", phrase: "какие задания просрочены", tool: "list_homework", args: { bucket: "overdue" } },
  { role: "student", phrase: "сдай задание по базам данных: готово, ссылка в тексте", tool: "submit_homework" },
  { role: "student", phrase: "нужна справка для военкомата", tool: "create_request", args: { kind: "military_certificate" } },
  { role: "student", phrase: "статус заявки на справку", tool: "list_requests" },
  { role: "student", phrase: "где моя справка?", tool: "list_requests" },
  { role: "student", phrase: "хочу академ", tool: "create_request", args: { kind: "academic_leave" } },
  { role: "student", phrase: "напомни о дедлайне", tool: "set_reminder", args: { title: "Дедлайн", day: "tomorrow" } },
  { role: "student", phrase: "включи тёмную тему", tool: "update_settings", args: { theme: "dark" } },
  { role: "student", phrase: "прочитай все уведомления", tool: "mark_notifications_read" },
  { role: "student", phrase: "что делал агент", tool: "get_audit" },
  { role: "student", phrase: "открой профиль", tool: "get_profile" },
  { role: "student", phrase: "как получить справку об обучении", tool: "search_regulations" },
  { role: "student", phrase: "что мне сдать до пятницы и закажи справку для военкомата", tool: "list_homework" },
  { role: "staff", phrase: "разбери входящие", tool: "staff_list_inbox" },
  { role: "staff", phrase: "опубликуй объявление: Приём справок до 17", tool: "staff_publish_announcement" },
  { role: "teacher", phrase: "покажи непроверенные работы БИ-3-26-04", tool: "teacher_list_submissions" },
  { role: "teacher", phrase: "что у меня сегодня", tool: "teacher_home" },
  { role: "teacher", phrase: "что у меня на неделе", tool: "get_schedule", args: { when: "week" } },
  { role: "teacher", phrase: "поставь 5 Сорокину за лабу", tool: "teacher_grade_homework", args: { score: 5 } },
  { role: "teacher", phrase: "верни на доработку Сорокину лабу с комментарием добавь пример", tool: "teacher_return_homework" },
  { role: "teacher", phrase: "отметь отсутствующих Сорокина", tool: "teacher_mark_absent" },
  { role: "teacher", phrase: "сводка по базам данных", tool: "teacher_subject_summary" },
  { role: "teacher", phrase: "выдай задание по базам данных на пятницу", tool: "teacher_issue_assignment" },
];

it("набор фраз агента", () => {
  const misses: string[] = [];
  for (const item of cases) {
    const parsed = parseIntent(item.phrase, item.role, names);
    const step = parsed.steps[0];
    const ok = step?.tool === item.tool && (!item.args || Object.entries(item.args).every(([key, value]) => step.args[key] === value));
    if (!ok) misses.push(`${item.role}: «${item.phrase}» → ${step?.tool ?? "нет"} ${JSON.stringify(step?.args ?? {})}`);
  }
  const rate = Math.round(((cases.length - misses.length) / cases.length) * 100);
  console.log(`agent-eval ${cases.length - misses.length}/${cases.length} (${rate}%)`);
  expect(misses, misses.join("\n")).toEqual([]);
});
