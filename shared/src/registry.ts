import { z } from "zod";
import { PAGES, REQUEST_KIND_IDS, STAFF_STATUSES, THEMES, WHEN, type Role } from "./domain";

export type Risk = "read" | "reversible" | "consequential";

const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .refine((value) => {
    const [h, m] = value.split(":").map(Number);
    return h <= 23 && m <= 59;
  }, "Некорректное время");

export const schemas = {
  open_page: z.object({
    page: z.enum(PAGES),
    when: z.enum(WHEN).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    weekOffset: z.number().int().min(-8).max(12).optional(),
    subject: z.string().max(160).optional(),
    group: z.string().max(40).optional(),
    requestId: z.number().int().positive().optional(),
    assignmentId: z.number().int().positive().optional(),
    semester: z.string().max(32).optional(),
    q: z.string().max(200).optional(),
  }),
  search_regulations: z.object({ query: z.string().trim().min(2).max(200) }),
  update_settings: z
    .object({
      theme: z.enum(THEMES).optional(),
      showCancelled: z.boolean().optional(),
    })
    .refine((v) => v.theme != null || v.showCancelled != null, "Нечего менять"),
  get_profile: z.object({}),
  get_audit: z.object({}),
  undo: z.object({ auditId: z.number().int().positive() }),
  undo_last: z.object({}),
  mark_notifications_read: z.object({
    all: z.boolean().optional(),
    ids: z.array(z.number().int().positive()).max(100).optional(),
  }),
  get_schedule: z.object({
    when: z.enum([...WHEN, "date", "range", "month", "changes", "next_lesson"] as const).default("week"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    month: z.number().int().min(1).max(12).optional(),
    subject: z.string().max(160).optional(),
  }),
  get_grades: z.object({
    subject: z.string().max(160).optional(),
    semester: z.string().max(32).optional(),
  }),
  get_session_navigator: z.object({
    subject: z.string().max(160).optional(),
    semester: z.string().max(32).optional(),
  }),
  simulate_mark: z.object({
    subject: z.string().trim().min(2).max(160),
    value: z.number().int().min(2).max(5),
  }),
  get_brief: z.object({}),
  list_requests: z.object({
    certificates: z.boolean().optional(),
    kind: z.enum(REQUEST_KIND_IDS).optional(),
  }),
  get_request_status: z.object({ requestId: z.number().int().positive() }),
  create_request: z.object({
    kind: z.enum(REQUEST_KIND_IDS),
    purpose: z.string().trim().max(300).optional(),
    comment: z.string().trim().max(2000).optional(),
  }),
  cancel_request: z.object({ requestId: z.number().int().positive() }),
  remind_deadline: z.object({ subject: z.string().trim().min(2).max(160) }),
  teacher_open_roll: z.object({}),
  set_reminder: z.object({
    title: z.string().trim().min(2).max(200),
    day: z.enum(["today", "tomorrow", "day_after"]),
    time,
  }),
  download_certificate: z.object({
    requestId: z.number().int().positive().optional(),
    kind: z.enum(REQUEST_KIND_IDS).optional(),
  }),
  mark_schedule_item: z
    .object({
      scheduleItemId: z.number().int().positive().optional(),
      subject: z.string().max(160).optional(),
      when: z.enum(["today", "tomorrow", "day_after"]).optional(),
      flagged: z.boolean().default(true),
    })
    .refine((v) => v.scheduleItemId != null || (v.subject != null && v.subject.length > 1), "Нужно занятие"),
  staff_list_inbox: z.object({}),
  staff_triage: z.object({ requestId: z.number().int().positive() }),
  staff_set_status: z
    .object({
      requestId: z.number().int().positive(),
      status: z.enum(STAFF_STATUSES),
      comment: z.string().trim().max(2000).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.status === "rejected" && !v.comment) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Укажите причину отказа", path: ["comment"] });
      }
    }),
  staff_publish_announcement: z.object({
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().min(3).max(2000),
  }),
  list_homework: z.object({
    bucket: z.enum(["all", "due", "overdue", "done"]).optional(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    kind: z.enum(["essay", "problem_set", "lab", "reading", "project"]).optional(),
  }),
  get_homework: z.object({ assignmentId: z.number().int().positive() }),
  save_homework: z.object({
    assignmentId: z.number().int().positive(),
    body: z.string().trim().max(4000).default(""),
    links: z.array(z.object({ title: z.string().max(120), href: z.string().url().max(400) })).max(5).optional(),
  }),
  submit_homework: z.object({
    assignmentId: z.number().int().positive().optional(),
    subject: z.string().trim().max(160).optional(),
    body: z.string().trim().min(2).max(4000),
    links: z.array(z.object({ title: z.string().max(120), href: z.string().url().max(400) })).max(5).optional(),
  }).refine((value) => value.assignmentId != null || (value.subject && value.subject.length > 1), "Нужно задание"),
  teacher_home: z.object({}),
  teacher_list_submissions: z.object({
    group: z.string().max(40).optional(),
  }),
  teacher_issue_assignment: z.object({
    groupName: z.string().trim().min(2).max(40),
    discipline: z.string().trim().min(2).max(160),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(3).max(2000),
    kind: z.enum(["essay", "problem_set", "lab", "reading", "project"]),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduleItemId: z.number().int().positive().optional(),
  }),
  teacher_return_homework: z.object({
    assignmentId: z.number().int().positive().optional(),
    query: z.string().max(80).optional(),
    studentName: z.string().trim().min(2).max(120),
    comment: z.string().trim().min(2).max(1000),
    groupName: z.string().max(40).optional(),
    discipline: z.string().max(160).optional(),
    workTitle: z.string().max(200).optional(),
  }),
  teacher_grade_homework: z.object({
    assignmentId: z.number().int().positive().optional(),
    query: z.string().max(80).optional(),
    studentName: z.string().trim().min(2).max(120),
    score: z.number().int().min(0).max(5),
    comment: z.string().trim().max(1000).optional(),
    groupName: z.string().max(40).optional(),
    discipline: z.string().max(160).optional(),
    workTitle: z.string().max(200).optional(),
  }),
  teacher_set_mark: z.object({
    groupName: z.string().trim().min(2).max(40).optional(),
    discipline: z.string().trim().min(2).max(160).optional(),
    studentName: z.string().trim().min(2).max(120),
    value: z.number().int().min(0).max(5),
    label: z.string().trim().min(2).max(80).default("Текущая"),
    kind: z.enum(["current", "credit"]).default("current"),
  }),
  teacher_mark_absent: z.object({
    names: z.array(z.string().trim().min(2)).min(1).max(20),
  }),
  teacher_subject_summary: z.object({
    discipline: z.string().trim().min(2).max(160),
  }),
  teacher_set_attendance: z.object({
    groupName: z.string().trim().min(2).max(40),
    discipline: z.string().trim().min(2).max(160),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    studentName: z.string().trim().min(2).max(120),
    present: z.boolean(),
  }),
  teacher_announce: z.object({
    groupName: z.string().trim().min(2).max(40),
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().min(3).max(2000),
  }),
};

export interface RegistryItem {
  name: keyof typeof schemas;
  summary: string;
  argsHint: string;
  risk: Risk;
  roles: Role[];
  schema: z.ZodTypeAny;
}

function item(
  name: keyof typeof schemas,
  risk: Risk,
  roles: Role[],
  summary: string,
  argsHint: string,
): RegistryItem {
  return { name, risk, roles, summary, argsHint, schema: schemas[name] };
}

const both: Role[] = ["student", "staff", "teacher"];

export const registry: RegistryItem[] = [
  item("open_page", "read", both, "Открыть раздел", "page, when?, subject?, requestId?, q?"),
  item("search_regulations", "read", both, "Найти норму в регламенте", "query"),
  item("update_settings", "reversible", both, "Тема или показ отмен", "theme?: light|dark|system, showCancelled?"),
  item("get_profile", "read", both, "Профиль", ""),
  item("get_audit", "read", both, "Журнал действий агента", ""),
  item("undo", "reversible", both, "Отменить действие по номеру", "auditId"),
  item("undo_last", "reversible", both, "Отменить последнее обратимое действие", ""),
  item("mark_notifications_read", "reversible", both, "Прочитать уведомления", "all?: true, ids?"),
  item("get_schedule", "read", ["student", "teacher"], "Расписание", "when: today|tomorrow|day_after|week|next_week|prev_week|date|range|month|changes|next_lesson, date?, from?, to?, month?, subject?"),
  item("get_grades", "read", ["student"], "Оценки", "subject?, semester?"),
  item("get_session_navigator", "read", ["student"], "Что нужно для сессии и автомата", "subject?"),
  item("simulate_mark", "read", ["student"], "Прикинуть следующую оценку, ничего не записывая", "subject, value 2..5"),
  item("get_brief", "read", both, "Сводка на сегодня", ""),
  item("list_requests", "read", ["student"], "Список заявок", ""),
  item("get_request_status", "read", ["student"], "Статус одной заявки", "requestId"),
  item("create_request", "consequential", ["student"], "Заказать справку или подать заявление", "kind, purpose?, comment?"),
  item("cancel_request", "consequential", ["student"], "Отозвать заявку", "requestId"),
  item("set_reminder", "reversible", ["student"], "Напоминание", "title, day: today|tomorrow|day_after, time HH:MM"),
  item("remind_deadline", "reversible", ["student"], "Напомнить о реальном дедлайне задания", "subject"),
  item("teacher_open_roll", "read", ["teacher"], "Открыть явку ближайшей пары", ""),
  item("download_certificate", "read", ["student"], "Ссылка на PDF справки", "requestId? | kind?"),
  item("mark_schedule_item", "reversible", ["student"], "Отметить занятие", "scheduleItemId? | subject+when, flagged?"),
  item("staff_list_inbox", "read", ["staff"], "Входящие заявки", ""),
  item("staff_triage", "read", ["staff"], "Разбор заявки", "requestId"),
  item("staff_set_status", "consequential", ["staff"], "Сменить статус заявки", "requestId, status, comment?"),
  item("staff_publish_announcement", "consequential", ["staff"], "Опубликовать объявление всем студентам", "title, body"),
  item("list_homework", "read", ["student"], "Задания и сроки", "bucket?: all|due|overdue|done, until?, kind?"),
  item("get_homework", "read", ["student"], "Одно задание", "assignmentId"),
  item("save_homework", "reversible", ["student"], "Сохранить черновик работы", "assignmentId, body, links?"),
  item("submit_homework", "consequential", ["student"], "Сдать работу на проверку", "assignmentId, body, links?"),
  item("teacher_home", "read", ["teacher"], "Пары сегодня и мои группы", ""),
  item("teacher_list_submissions", "read", ["teacher"], "Очередь работ, сначала непроверенные", "group?"),
  item("teacher_issue_assignment", "consequential", ["teacher"], "Выдать задание группе", "groupName, discipline, title, description, kind, deadline"),
  item("teacher_return_homework", "consequential", ["teacher"], "Вернуть работу на доработку", "assignmentId, studentName, comment"),
  item("teacher_grade_homework", "consequential", ["teacher"], "Оценить работу", "assignmentId, studentName, score, comment?"),
  item("teacher_set_mark", "consequential", ["teacher"], "Поставить оценку в журнал", "groupName, discipline, studentName, value, label?, kind?"),
  item("teacher_mark_absent", "reversible", ["teacher"], "Отметить отсутствующих на сегодня", "names"),
  item("teacher_subject_summary", "read", ["teacher"], "Сводка по предмету", "discipline"),
  item("teacher_set_attendance", "reversible", ["teacher"], "Отметить присутствие", "groupName, discipline, date, studentName, present"),
  item("teacher_announce", "consequential", ["teacher"], "Объявление своим группам", "groupName, title, body"),
];

export const registryByName = new Map(registry.map((item) => [item.name, item]));

export function toolsFor(role: Role): RegistryItem[] {
  return registry.filter((item) => item.roles.includes(role));
}

export function stepLabel(tool: string, args: Record<string, unknown> = {}): string {
  const page = String(args.page ?? "");
  const pages: Record<string, string> = {
    dashboard: "Открываю главную…",
    schedule: "Открываю расписание…",
    grades: "Открываю оценки…",
    requests: "Открываю заявки…",
    request: "Открываю заявку…",
    new_request: "Открываю форму заявления…",
    notifications: "Открываю уведомления…",
    profile: "Открываю профиль…",
    audit: "Открываю журнал агента…",
    regulations: "Открываю регламенты…",
    staff_inbox: "Открываю входящие…",
    staff_request: "Открываю заявку…",
    staff_announce: "Открываю объявления…",
    homework: "Открываю задания…",
    teach: "Открываю пары на сегодня…",
    teach_journal: "Открываю журнал…",
    teach_queue: "Открываю непроверенные работы…",
    teach_issue: "Открываю выдачу задания…",
    teach_announce: "Открываю объявление группе…",
  };
  const labels: Record<string, string> = {
    open_page: pages[page] ?? "Открываю раздел…",
    search_regulations: "Ищу в регламентах…",
    update_settings: "Меняю настройки…",
    get_profile: "Смотрю профиль…",
    get_audit: "Открываю журнал агента…",
    undo: "Отменяю действие…",
    undo_last: "Отменяю последнее действие…",
    mark_notifications_read: "Отмечаю уведомления прочитанными…",
    get_schedule: "Смотрю расписание…",
    get_grades: "Смотрю оценки…",
    get_session_navigator: "Считаю, что нужно для сессии…",
    simulate_mark: "Прикидываю оценку, в ведомость не пишу…",
    get_brief: "Собираю сводку дня…",
    list_requests: "Проверяю заявки…",
    get_request_status: "Смотрю статус заявки…",
    create_request: "Готовлю заявление…",
    cancel_request: "Готовлю отзыв заявки…",
    set_reminder: "Ставлю напоминание…",
    remind_deadline: "Ставлю напоминание о дедлайне…",
    teacher_open_roll: "Открываю явку…",
    download_certificate: "Готовлю файл справки…",
    mark_schedule_item: "Отмечаю занятие…",
    staff_list_inbox: "Открываю входящие…",
    staff_triage: "Разбираю заявку…",
    staff_set_status: "Готовлю смену статуса…",
    staff_publish_announcement: "Готовлю объявление…",
    list_homework: "Смотрю задания…",
    get_homework: "Открываю задание…",
    save_homework: "Сохраняю черновик…",
    submit_homework: "Готовлю сдачу работы…",
    teacher_home: "Смотрю пары на сегодня…",
    teacher_list_submissions: "Смотрю непроверенные работы…",
    teacher_issue_assignment: "Готовлю задание…",
    teacher_return_homework: "Готовлю возврат работы…",
    teacher_grade_homework: "Готовлю оценку…",
    teacher_set_mark: "Ставлю оценку в журнал…",
    teacher_mark_absent: "Отмечаю отсутствующих…",
    teacher_subject_summary: "Собираю сводку по предмету…",
    teacher_set_attendance: "Отмечаю присутствие…",
    teacher_announce: "Готовлю объявление группе…",
  };
  return labels[tool] ?? "Выполняю шаг…";
}

export function relaxArgs(args: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args };
  for (const key of ["when", "theme", "page", "day", "status", "kind"]) {
    if (typeof next[key] === "string") next[key] = next[key].toLowerCase();
  }
  if (typeof next.time === "string" && /^\d{1,2}:\d{2}$/.test(next.time)) {
    const [h, m] = next.time.split(":");
    next.time = `${h.padStart(2, "0")}:${m}`;
  }
  for (const key of ["requestId", "scheduleItemId", "auditId", "value", "weekOffset", "assignmentId", "score"]) {
    if (typeof next[key] === "string" && /^-?\d+$/.test(next[key])) next[key] = Number(next[key]);
  }
  for (const key of ["flagged", "showCancelled", "all"]) {
    if (next[key] === "true") next[key] = true;
    if (next[key] === "false") next[key] = false;
  }
  if (Array.isArray(next.ids)) {
    next.ids = next.ids.map((id) => (typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id));
  }
  delete next.userId;
  delete next.studentId;
  delete next.user_id;
  delete next.student_id;
  return next;
}
