import { boolean, date, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { UndoPayload } from "../../../shared/src/domain";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  login: text("login").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  fullName: text("full_name").notNull(),
  institute: text("institute"),
  direction: text("direction"),
  course: integer("course"),
  groupName: text("group_name"),
  recordBook: text("record_book"),
  theme: text("theme").notNull().default("system"),
  showCancelled: boolean("show_cancelled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  csrfToken: text("csrf_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const scheduleItems = pgTable("schedule_items", {
  id: serial("id").primaryKey(),
  groupName: text("group_name").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  discipline: text("discipline").notNull(),
  kind: text("kind").notNull(),
  room: text("room"),
  teacher: text("teacher"),
  changeType: text("change_type").notNull().default("none"),
  changeNote: text("change_note"),
  pairNumber: integer("pair_number").notNull(),
});

export const scheduleFlags = pgTable("schedule_flags", {
  userId: integer("user_id").notNull(),
  scheduleItemId: integer("schedule_item_id").notNull(),
  flagged: boolean("flagged").notNull().default(true),
});

export const disciplines = pgTable("disciplines", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  name: text("name").notNull(),
  controlForm: text("control_form").notNull(),
  sessionDate: date("session_date", { mode: "string" }),
  obligatoryTotal: integer("obligatory_total").notNull().default(0),
  obligatoryDone: integer("obligatory_done").notNull().default(0),
  semester: text("semester").notNull(),
});

export const marks = pgTable("marks", {
  id: serial("id").primaryKey(),
  disciplineId: integer("discipline_id").notNull(),
  studentId: integer("student_id").notNull(),
  label: text("label").notNull(),
  value: integer("value"),
  kind: text("kind").notNull(),
  awardedOn: date("awarded_on", { mode: "string" }),
  columnId: integer("column_id"),
  comment: text("comment"),
  teacherId: integer("teacher_id"),
  points: numeric("points", { precision: 6, scale: 1 }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const journalColumns = pgTable("journal_columns", {
  id: serial("id").primaryKey(),
  groupName: text("group_name").notNull(),
  discipline: text("discipline").notNull(),
  lessonDate: date("lesson_date", { mode: "string" }).notNull(),
  scheduleItemId: integer("schedule_item_id"),
  workType: text("work_type").notNull(),
  title: text("title").notNull(),
  maxScore: integer("max_score").notNull().default(5),
  maxPoints: integer("max_points").notNull().default(10),
  weight: numeric("weight", { precision: 3, scale: 1 }).notNull().default("1"),
  position: integer("position").notNull().default(0),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const gradingSchemes = pgTable("grading_schemes", {
  id: serial("id").primaryKey(),
  groupName: text("group_name").notNull(),
  discipline: text("discipline").notNull(),
  defaults: jsonb("defaults").$type<Record<string, { maxPoints: number; weight: number }>>().notNull(),
  excellent: numeric("excellent", { precision: 5, scale: 2 }).notNull().default("85"),
  good: numeric("good", { precision: 5, scale: 2 }).notNull().default("70"),
  satisfactory: numeric("satisfactory", { precision: 5, scale: 2 }).notNull().default("55"),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const lessonTopics = pgTable("lesson_topics", {
  id: serial("id").primaryKey(),
  groupName: text("group_name").notNull(),
  discipline: text("discipline").notNull(),
  lessonDate: date("lesson_date", { mode: "string" }).notNull(),
  scheduleItemId: integer("schedule_item_id"),
  topic: text("topic").notNull(),
  teacherId: integer("teacher_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const requests = pgTable("requests", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  purpose: text("purpose"),
  body: text("body"),
  status: text("status").notNull(),
  rejectionReason: text("rejection_reason"),
  resultNote: text("result_note"),
  verifyCode: text("verify_code"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const requestEvents = pgTable("request_events", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull(),
  status: text("status").notNull(),
  comment: text("comment"),
  actorId: integer("actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  source: text("source").notNull(),
  action: text("action").notNull(),
  args: jsonb("args").$type<Record<string, unknown>>().notNull(),
  summary: text("summary").notNull(),
  reversible: boolean("reversible").notNull().default(false),
  undo: jsonb("undo").$type<UndoPayload | null>(),
  undoneAt: timestamp("undone_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const clarifications = pgTable("clarifications", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tool: text("tool").notNull(),
  args: jsonb("args").$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const pendingActions = pgTable("pending_actions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),
  args: jsonb("args").$type<Record<string, unknown>>().notNull(),
  preview: jsonb("preview").$type<{ title: string; summary: string; fields: { label: string; value: string }[] }>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const teachingLoad = pgTable(
  "teaching_load",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id").notNull(),
    groupName: text("group_name").notNull(),
    discipline: text("discipline").notNull(),
  },
  (table) => [unique("teaching_load_unique").on(table.teacherId, table.groupName, table.discipline)],
);

export const assignments = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    groupName: text("group_name").notNull(),
    discipline: text("discipline").notNull(),
    teacherId: integer("teacher_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    kind: text("kind").notNull(),
    maxScore: integer("max_score").notNull().default(5),
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    deadline: date("deadline", { mode: "string" }).notNull(),
    scheduleItemId: integer("schedule_item_id"),
    attachments: jsonb("attachments").$type<{ title: string; href: string }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [unique("assignments_group_title").on(table.groupName, table.title)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    assignmentId: integer("assignment_id").notNull(),
    studentId: integer("student_id").notNull(),
    status: text("status").notNull(),
    body: text("body"),
    links: jsonb("links").$type<{ title: string; href: string }[]>().notNull().default([]),
    teacherComment: text("teacher_comment"),
    score: integer("score"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [unique("submissions_unique").on(table.assignmentId, table.studentId)],
);

export const attendance = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id").notNull(),
    studentId: integer("student_id").notNull(),
    groupName: text("group_name").notNull(),
    discipline: text("discipline").notNull(),
    lessonDate: date("lesson_date", { mode: "string" }).notNull(),
    present: boolean("present").notNull(),
    status: text("status"),
    comment: text("comment"),
  },
  (table) => [unique("attendance_unique").on(table.studentId, table.discipline, table.lessonDate)],
);

export const groupAnnouncements = pgTable("group_announcements", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull(),
  groupName: text("group_name").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const regulations = pgTable("regulations", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
});
