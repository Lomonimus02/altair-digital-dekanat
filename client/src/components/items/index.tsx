import type { ReactNode } from "react";
import { Bell, BookOpen, CalendarClock, ClipboardList, DoorOpen, GraduationCap, Megaphone, UserRound } from "lucide-react";
import { fmtDate, fmtTimeAgo, formatWeight, glueLast, gradeInk, gradeTone, kindChip, nb, urgency } from "../../lib/format";

function allowLatin(text: string) {
  return /[A-Za-z]{3,}/.test(text) ? { "data-ui-allow-latin": "" } : {};
}

export function ItemRow({ kind, lead, title, meta, trail, href }: { kind: string; lead: ReactNode; title: string; meta?: ReactNode; trail?: ReactNode; href?: string }) {
  const body = (
    <div className="item-row" data-ui={kind}>
      <div className="item-lead">{lead}</div>
      <div className="min-w-0">
        <div data-ui-part="title" className="t-title item-title" title={title} {...allowLatin(title)}>{glueLast(title)}</div>
        {meta ? <div className="item-meta-line mt-1">{meta}</div> : null}
      </div>
      {trail ? <div className="item-trail">{trail}</div> : <span />}
    </div>
  );
  if (!href) return body;
  return <a href={href} className="block min-h-11">{body}</a>;
}

export function Chip({ children, tone = "lesson" }: { children: string; tone?: "lesson" | "work" | "grade" | "notice" | "request" }) {
  const color = `var(--tone-${tone})`;
  return <span data-ui-part="chip" className="t-chip rounded-full px-2 py-0.5" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{children}</span>;
}

export function StatusPill({ children, tone }: { children: string; tone: "neutral" | "amber" | "red" | "green" | "blue" }) {
  const map = { neutral: "var(--muted)", amber: "var(--u-soon)", red: "var(--u-over)", green: "var(--tone-grade)", blue: "var(--tone-lesson)" };
  return <span data-ui-part="status" className="t-chip rounded-full px-2 py-0.5" style={{ color: map[tone], background: `color-mix(in srgb, ${map[tone]} 16%, transparent)` }}>{children}</span>;
}

export function DueChip({ due, settled = false }: { due: string; settled?: boolean }) {
  const level = settled ? "later" : urgency(due);
  const label = !settled && level === "over" ? "просрочено" : fmtDate(due, "day");
  const color = level === "over" ? "var(--u-over)" : level === "soon" ? "var(--u-soon)" : "var(--u-later)";
  return <span data-ui-part="time" className="t-chip" style={{ color }} title={fmtDate(due, "full")}>{label}</span>;
}

export function Meta({ icon, children, title }: { icon?: "door" | "user"; children: string; title?: string }) {
  const Icon = icon === "door" ? DoorOpen : icon === "user" ? UserRound : null;
  return (
    <span data-ui-part="meta" className="t-meta inline-flex min-w-0 items-center gap-1 text-[var(--muted)]" title={title ?? children}>
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate" title={title ?? children}>{nb(children)}</span>
    </span>
  );
}

export function SectionHeader({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="t-section whitespace-nowrap">{title}</h2>
        {count != null ? <span className="t-chip rounded-full bg-black/5 px-2 py-0.5">{count}</span> : null}
      </div>
      {action}
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 md:flex md:items-baseline md:justify-between md:gap-4">
      <div className="t-muted">{label}</div>
      <div className="t-title" title={value} {...allowLatin(value)}>{nb(value)}</div>
    </div>
  );
}

export function EmptyLine({ text, action }: { text: string; action?: ReactNode }) {
  return <p className="t-muted py-2">{text}{action}</p>;
}

export function ItemSkeleton({ kind = "lesson" }: { kind?: string }) {
  return (
    <div className="item-row" data-ui={kind} aria-hidden>
      <div className="skeleton h-11 w-11 rounded-2xl" />
      <div className="space-y-2">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-3 w-24" />
      </div>
      <div className="skeleton h-4 w-12" />
    </div>
  );
}

const LESSON_KIND = { lecture: "lecture", practice: "practice", lab: "lab", seminar: "seminar", exam: "exam", credit: "credit" } as const;

export function LessonItem({ start, end, title, kind, room, teacher, group, state = "normal", note, action, badge, live = false, conflict = false }: {
  start: string; end: string; title: string; kind: keyof typeof LESSON_KIND | string;
  room?: string; teacher?: string; group?: string; state?: "normal" | "cancelled" | "moved" | "moved-from" | "moved-to" | "room" | "now"; note?: string; action?: ReactNode;
  badge?: string; live?: boolean; conflict?: boolean;
}) {
  const struck = state === "cancelled" || state === "moved-from";
  const accent = live || state === "now";
  return (
    <div className={`item-row ${struck ? "opacity-60" : ""}`} data-ui="lesson" data-lesson-state={state} style={accent ? { boxShadow: "inset 3px 0 0 var(--brand)" } : undefined}>
      <div>
        <div data-ui-part="time" className={`t-value ${struck ? "line-through" : ""}`}>{start}</div>
        <div data-ui-part="meta" className="t-muted">{end}</div>
      </div>
      <div className="min-w-0">
        <div data-ui-part="title" className={`t-title item-title ${struck ? "line-through" : ""}`} title={title}>{glueLast(title)}</div>
        <div className="item-meta-line mt-1">
          <Chip>{kindChip(kind)}</Chip>
          {live ? <StatusPill tone="green">Идёт сейчас</StatusPill> : null}
          {state === "cancelled" ? <StatusPill tone="red">Отменено</StatusPill> : null}
          {state === "moved" ? <StatusPill tone="amber">Перенос</StatusPill> : null}
          {state === "moved-from" ? <StatusPill tone="amber">{badge ?? "Перенесено"}</StatusPill> : null}
          {state === "moved-to" ? <StatusPill tone="blue">{badge ?? "Перенесено сюда"}</StatusPill> : null}
          {state === "room" ? <StatusPill tone="blue">{badge ?? "Другая аудитория"}</StatusPill> : null}
          {conflict ? <StatusPill tone="red">Накладка</StatusPill> : null}
          {room ? <Meta icon="door">{room}</Meta> : null}
          {group ? <Meta>{group}</Meta> : teacher ? <Meta icon="user">{teacher}</Meta> : null}
        </div>
        {note ? <p className="t-muted mt-1 truncate" title={note}>{note}</p> : null}
      </div>
      <div className="item-trail">{action}</div>
    </div>
  );
}

export function WorkItem({ title, kind, subject, student, group, due, status, points, href }: {
  title: string; kind: string; subject?: string; student?: string; group?: string; due?: string;
  status?: string; points?: { value: number; max: number }; href?: string;
}) {
  const statusTone = status === "returned" ? "red" : status === "graded" ? "green" : status === "in_review" || status === "submitted" ? "amber" : "neutral";
  const statusText = status === "not_started" ? "Не начато" : status === "in_review" || status === "submitted" ? "На проверке" : status === "returned" ? "Возвращено" : status === "graded" ? "Оценено" : "";
  const inner = (
    <div className="item-row" data-ui="work">
      <div className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--tone-work) 16%, transparent)", color: "var(--tone-work)" }}>
        <ClipboardList className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <div data-ui-part="title" className="t-title item-title" title={title} {...allowLatin(title)}>{glueLast(title)}</div>
        <div className="item-meta-line mt-1">
          <Chip tone="work">{kindChip(kind)}</Chip>
          {subject ? <Meta>{subject}</Meta> : null}
          {student ? <Meta icon="user">{student}</Meta> : null}
          {group ? <Meta>{group}</Meta> : null}
        </div>
      </div>
      <div className="item-trail">
        {due ? <DueChip due={due} settled={status === "graded" || status === "submitted" || status === "in_review"} /> : null}
        {statusText ? <StatusPill tone={statusTone}>{status === "graded" && points ? `Оценено ${points.value}/${points.max}` : statusText}</StatusPill> : null}
      </div>
    </div>
  );
  if (!href) return inner;
  return <a href={href} className="block">{inner}</a>;
}

export function GradeItem({ points, max, percent, kind, title, discipline, date, weight, hideDate = false, onClick }: {
  points: number; max: number; percent?: number | null; kind: string; title: string; discipline?: string; date?: string; weight?: number; hideDate?: boolean; onClick?: () => void;
}) {
  const ratio = percent ?? (max ? (points / max) * 100 : null);
  return (
    <button type="button" className="item-row w-full text-left" data-ui="grade" onClick={onClick}>
      <div data-ui-part="value" className="grade-badge t-value" style={{ background: gradeTone(ratio), color: gradeInk(ratio) }}>{points}/{max}</div>
      <div className="min-w-0">
        <div data-ui-part="title" className="t-title item-title" title={title} {...allowLatin(title)}>{glueLast(title)}</div>
        <div className="item-meta-line mt-1">
          <Chip tone="grade">{weight != null ? `${kindChip(kind)} вес ${formatWeight(weight)}` : kindChip(kind)}</Chip>
          {discipline ? <Meta>{discipline}</Meta> : null}
        </div>
      </div>
      {hideDate || !date ? null : <div data-ui-part="time" className="t-muted">{fmtDate(date, "short")}</div>}
    </button>
  );
}

const NOTICE_ICON = { grade: GraduationCap, work: BookOpen, returned: ClipboardList, schedule: CalendarClock, request: Bell, announcement: Megaphone, system: Bell };

export function NotificationItem({ type, title, body, at, unread, href }: {
  type: keyof typeof NOTICE_ICON; title: string; body?: string; at: string; unread: boolean; href?: string;
}) {
  const Icon = NOTICE_ICON[type];
  const inner = (
    <div className="item-row" data-ui="notification">
      <div className="relative grid h-11 w-11 place-items-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--tone-notice) 14%, transparent)" }}>
        <Icon className="h-5 w-5" aria-hidden />
        {unread ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--brand)]" /> : null}
      </div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div data-ui-part="title" className="t-title item-title min-w-0" title={title} {...allowLatin(title)}>{glueLast(title)}</div>
          <div data-ui-part="time" className="t-muted shrink-0">{fmtTimeAgo(at)}</div>
        </div>
        {body ? <div data-ui-part="meta" className="t-meta truncate text-[var(--muted)]" title={body} {...allowLatin(body)}>{body}</div> : null}
      </div>
    </div>
  );
  if (!href) return inner;
  return <a href={href} className="block">{inner}</a>;
}

export function RequestItem({ number, title, statusLabel, createdAt, purpose, student, group, fresh, href }: {
  number: number; title: string; statusLabel: string; createdAt: string; purpose?: string; student?: string; group?: string; fresh?: boolean; href: string;
}) {
  const tone = statusLabel === "Отклонена" ? "red" : statusLabel === "Готова" || statusLabel === "Выдана" ? "green" : statusLabel === "В работе" ? "blue" : "amber";
  return (
    <a href={href} className="item-row" data-ui="request">
      <div className="t-muted" data-ui-part="meta">№{number}</div>
      <div className="min-w-0">
        <div data-ui-part="title" className="t-title item-title" title={title}>{glueLast(title)}</div>
        <div className="item-meta-line mt-1">
          <Meta>{`подана ${fmtDate(createdAt, "short")}`}</Meta>
          {student ? <Meta icon="user">{student}</Meta> : null}
          {group ? <Meta>{group}</Meta> : null}
          {purpose ? <Meta title={purpose}>{purpose}</Meta> : null}
        </div>
      </div>
      <div className="item-trail">
        <StatusPill tone={tone}>{statusLabel}</StatusPill>
        {fresh ? <StatusPill tone="amber">новая</StatusPill> : null}
      </div>
    </a>
  );
}
