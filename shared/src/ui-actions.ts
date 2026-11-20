import type { Role } from "./domain";

/** Каждая кнопка с data-agent-action должна быть здесь, и наоборот. */
export interface UiAction {
  id: string;
  label: string;
  roles: Role[];
  tool?: string;
  to?: string;
}

export const UI_ACTIONS: UiAction[] = [
  { id: "nav-home", label: "Главная", roles: ["student"], to: "/" },
  { id: "nav-schedule", label: "Расписание", roles: ["student", "teacher"], to: "/schedule", tool: "get_schedule" },
  { id: "nav-homework", label: "Задания", roles: ["student"], to: "/homework", tool: "list_homework" },
  { id: "nav-grades", label: "Оценки", roles: ["student"], to: "/grades", tool: "get_grades" },
  { id: "nav-requests", label: "Заявки", roles: ["student"], to: "/requests", tool: "list_requests" },
  { id: "nav-teach", label: "Сегодня", roles: ["teacher"], to: "/teach", tool: "teacher_home" },
  { id: "nav-journal", label: "Журнал", roles: ["teacher"], to: "/teach/journal", tool: "teacher_open_roll" },
  { id: "nav-queue", label: "Проверка", roles: ["teacher"], to: "/teach/homework", tool: "teacher_list_submissions" },
  { id: "nav-staff", label: "Входящие", roles: ["staff"], to: "/staff", tool: "staff_list_inbox" },
  { id: "nav-news", label: "Новости", roles: ["staff"], to: "/staff/announcements", tool: "staff_publish_announcement" },
  { id: "nav-notifications", label: "Уведомления", roles: ["student", "teacher", "staff"], to: "/notifications", tool: "mark_notifications_read" },
  { id: "nav-more", label: "Ещё", roles: ["student", "teacher", "staff"] },
  { id: "nav-agent", label: "Агент", roles: ["student", "teacher", "staff"] },
  { id: "theme-toggle", label: "Тема", roles: ["student", "teacher", "staff"], tool: "update_settings" },
  { id: "request-new", label: "Новая заявка", roles: ["student"], to: "/requests/new", tool: "create_request" },
  { id: "request-submit", label: "Подать заявку", roles: ["student"], tool: "create_request" },
  { id: "request-cancel", label: "Отозвать заявку", roles: ["student"], tool: "cancel_request" },
  { id: "notification-read-all", label: "Прочитать все", roles: ["student", "teacher", "staff"], tool: "mark_notifications_read" },
  { id: "notification-read", label: "Прочитать уведомление", roles: ["student", "teacher", "staff"], tool: "mark_notifications_read" },
  { id: "schedule-today", label: "Сегодня в расписании", roles: ["student", "teacher"], tool: "get_schedule" },
  { id: "schedule-week", label: "Неделя", roles: ["student", "teacher"], tool: "get_schedule" },
  { id: "schedule-star", label: "Отметить занятие", roles: ["student"], tool: "mark_schedule_item" },
  { id: "homework-save", label: "Сохранить работу", roles: ["student"], tool: "save_homework" },
  { id: "homework-submit", label: "Сдать работу", roles: ["student"], tool: "submit_homework" },
  { id: "grades-open", label: "Открыть дисциплину", roles: ["student"], tool: "get_grades" },
  { id: "teach-grade", label: "Оценить работу", roles: ["teacher"], tool: "teacher_grade_homework" },
  { id: "teach-return", label: "Вернуть работу", roles: ["teacher"], tool: "teacher_return_homework" },
];

export const UI_ACTION_IDS = new Set(UI_ACTIONS.map((item) => item.id));
