export const UNIVERSITY = "Академия «Альтаир»";

export const CONTEST_NOTE =
  "Учебный концепт конкурса «Цифровой деканат будущего». Академия «Альтаир» вымышлена и не является официальным сервисом какого-либо университета.";

export const REQUEST_KIND_IDS = [
  "study_certificate",
  "period_certificate",
  "military_certificate",
  "academic_leave",
  "transfer",
  "financial_aid",
  "free_form",
] as const;

export type RequestKind = (typeof REQUEST_KIND_IDS)[number];

export const REQUEST_KINDS: {
  id: RequestKind;
  title: string;
  instant: boolean;
  group: "certificate" | "application";
}[] = [
  { id: "study_certificate", title: "Справка об обучении", instant: true, group: "certificate" },
  { id: "period_certificate", title: "Справка о периоде обучения", instant: true, group: "certificate" },
  { id: "military_certificate", title: "Справка для военкомата", instant: false, group: "certificate" },
  { id: "academic_leave", title: "Заявление на академический отпуск", instant: false, group: "application" },
  { id: "transfer", title: "Заявление о переводе", instant: false, group: "application" },
  { id: "financial_aid", title: "Заявление на материальную помощь", instant: false, group: "application" },
  { id: "free_form", title: "Произвольное заявление", instant: false, group: "application" },
];

export const REQUEST_STATUSES = [
  "submitted",
  "in_progress",
  "ready",
  "issued",
  "rejected",
  "withdrawn",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STAFF_STATUSES = ["in_progress", "ready", "issued", "rejected"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: "Подана",
  in_progress: "В работе",
  ready: "Готова",
  issued: "Выдана",
  rejected: "Отклонена",
  withdrawn: "Отозвана",
};

export const PAGES = [
  "dashboard",
  "schedule",
  "grades",
  "requests",
  "request",
  "new_request",
  "notifications",
  "profile",
  "audit",
  "regulations",
  "staff_inbox",
  "staff_request",
  "staff_announce",
  "homework",
  "teach",
  "teach_journal",
  "teach_queue",
  "teach_issue",
  "teach_announce",
  "staff_journal",
] as const;

export type AppPage = (typeof PAGES)[number];

export const WHEN = ["today", "tomorrow", "day_after", "week", "next_week", "prev_week"] as const;
export type When = (typeof WHEN)[number];

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const LESSON_KINDS = ["lecture", "seminar", "lab", "practice"] as const;
export const KIND_LABEL: Record<string, string> = {
  lecture: "лекция",
  seminar: "семинар",
  lab: "лабораторная",
  practice: "практика",
};

export const CHANGE_LABEL: Record<string, string> = {
  none: "",
  cancelled: "Отмена",
  moved: "Перенос",
  room: "Другая аудитория",
};

export function kindMeta(id: string) {
  return REQUEST_KINDS.find((k) => k.id === id) ?? null;
}

export function defaultPurpose(kind: RequestKind): string {
  switch (kind) {
    case "study_certificate":
      return "Для предъявления по месту требования";
    case "period_certificate":
      return "Для подтверждения периода обучения";
    case "military_certificate":
      return "Для предоставления в военный комиссариат";
    case "academic_leave":
      return "Прошу предоставить академический отпуск";
    case "transfer":
      return "Прошу рассмотреть вопрос о переводе";
    case "financial_aid":
      return "Прошу оказать материальную помощь";
    case "free_form":
      return "Обращение в учебный офис";
  }
}

export function addressName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 3) return `${parts[1]} ${parts[2]}`;
  return parts[0] ?? fullName;
}

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

export type Role = "student" | "staff" | "teacher";

export interface PublicUser {
  id: number;
  login: string;
  role: Role;
  fullName: string;
  addressName: string;
  initials: string;
  institute: string | null;
  direction: string | null;
  course: number | null;
  groupName: string | null;
  recordBook: string | null;
  theme: Theme;
  showCancelled: boolean;
}

export interface LessonView {
  id: number;
  date: string;
  startsAt: string;
  endsAt: string;
  discipline: string;
  kind: string;
  room: string | null;
  teacher: string | null;
  changeType: "none" | "cancelled" | "moved" | "room";
  changeNote: string | null;
  pairNumber: number;
  flagged: boolean;
  groupName?: string | null;
}

export type MarkKind = "current" | "exam" | "credit";

export interface MarkView {
  id: number;
  label: string;
  value: number | null;
  kind: MarkKind;
  awardedOn: string | null;
  points?: number | null;
  maxPoints?: number;
  weight?: number;
}

export interface DisciplineView {
  id: number;
  name: string;
  controlForm: "exam" | "credit";
  sessionDate: string | null;
  obligatoryTotal: number;
  obligatoryDone: number;
  semester: string;
  marks: MarkView[];
  thresholds?: { excellent: number; good: number; satisfactory: number };
}

export type UiDirective =
  | { type: "navigate"; to: string; highlight?: string }
  | { type: "theme"; value: Theme }
  | { type: "invalidate"; keys: string[] };

export interface Citation {
  slug: string;
  title: string;
  excerpt: string;
}

export interface ConfirmCard {
  pendingId: string;
  title: string;
  summary: string;
  fields: { label: string; value: string }[];
}

export interface AnswerCard {
  title: string;
  rows: { label: string; value: string }[];
}

export interface ChoiceChip {
  label: string;
  clarificationId: string;
  entityId: string;
}

export type UndoPayload =
  | { type: "settings"; theme: Theme; showCancelled: boolean }
  | { type: "notifications"; items: { id: number; readAt: string | null }[] }
  | { type: "reminder"; id: number }
  | { type: "flag"; scheduleItemId: number; flagged: boolean }
  | { type: "mark"; markId: number }
  | { type: "mark_cell"; markId: number; created: boolean; prev: { id?: number; disciplineId?: number; studentId?: number; columnId?: number | null; value: number | null; points?: number | string | null; comment: string | null; label: string; kind: string; awardedOn: string | null; teacherId?: number | null; updatedAt?: string | null } | null; createdColumnId?: number | null; createdDisciplineId?: number | null; notice?: { id: number; previousBody: string | null; previousTitle?: string | null } | null }
  | { type: "mark_restore"; row: { id?: number; studentId: number; disciplineId: number; columnId: number | null; label: string; value: number | null; points?: number | string | null; kind: string; awardedOn: string | null; comment: string | null; teacherId: number | null; updatedAt?: string | null } }
  | { type: "journal_column"; column: Record<string, unknown>; marks: Record<string, unknown>[] }
  | { type: "topic"; groupName: string; discipline: string; date: string; topic: string | null }
  | { type: "attendance"; studentId: number; groupName: string; discipline: string; date: string; present: boolean | null; status: string | null }
  | { type: "grading"; groupName: string; discipline: string; previous: { defaults: Record<string, { maxPoints: number; weight: number }>; excellent: number; good: number; satisfactory: number } | null }
  | { type: "submission"; submissionId: number; previousStatus: string; previousScore: number | null; previousComment: string | null; previousUpdatedAt?: string | null; markId: number | null; markCreated?: boolean; previousPoints?: number | null; noticeId?: number | null; noticeCreated?: boolean; previousNotice?: { title: string; body: string; kind: string } | null; createdColumnId?: number | null; assignmentId?: number; previousColumnId?: number | null; previousMark?: { value: number | null; points: number | null; comment: string | null; label: string; kind: string; awardedOn: string | null; teacherId: number | null; columnId: number | null; updatedAt?: string | null } | null };

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface Proposal {
  say: string;
  steps: ToolCall[];
}
