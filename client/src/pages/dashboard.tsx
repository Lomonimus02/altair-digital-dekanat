import { useQuery } from "@tanstack/react-query";
import { KIND_LABEL, STATUS_LABEL, type LessonView, type RequestStatus } from "@shared/domain";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAgent } from "../lib/agent";
import { useAuth } from "../lib/auth";
import { ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface Brief {
  greeting: string;
  paragraphs: string[];
}

export function DashboardPage() {
  const { user } = useAuth();
  const brief = useQuery({ queryKey: ["brief"], queryFn: () => api<Brief>("/api/brief") });
  const schedule = useQuery({
    queryKey: ["schedule", "today"],
    queryFn: () => api<{ today: string; days: { date: string; items: LessonView[] }[] }>("/api/schedule?when=today"),
    enabled: user?.role === "student",
  });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: Note[] }>("/api/notifications") });
  const grades = useQuery({ queryKey: ["grades", ""], queryFn: () => api<{ items: { id: number; name: string; risk: string; statusText?: string; headline: string }[] }>("/api/grades") });
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => api<{ requests: { id: number; title: string; status: RequestStatus }[] }>("/api/requests") });
  const homework = useQuery({ queryKey: ["homework"], queryFn: () => api<{ homework: { id: number; title: string; deadline: string; submission: { status: string } }[] }>("/api/homework") });

  if (user?.role === "staff") return <StaffHome />;
  if (brief.isLoading || schedule.isLoading) return <LoadingBlock />;
  if (brief.error || schedule.error) return <ErrorState text="Сводка не загрузилась" onRetry={() => void brief.refetch()} />;

  const today = schedule.data?.days.find((day) => day.date === schedule.data?.today);
  const upcoming = schedule.data?.days.find((day) => day.date > (schedule.data?.today ?? "") && day.items.length);
  const focusDay = today?.items.length ? today : upcoming;
  const lessons = (focusDay?.items ?? []).slice(0, 3);
  const lessonTitle = today?.items.length ? "Сейчас" : "Ближайшие пары";
  const dayName = focusDay ? new Date(`${focusDay.date}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";
  const dueWork = (homework.data?.homework ?? []).filter((row) => !["graded", "in_review", "submitted"].includes(row.submission.status)).slice(0, 3);
  const risky = (grades.data?.items ?? []).filter((item) => item.risk === "high" || item.risk === "medium").slice(0, 3);
  const openRequests = (requests.data?.requests ?? []).filter((row) => row.status === "ready" || row.status === "submitted" || row.status === "in_progress").slice(0, 3);
  const unread = (notes.data?.notifications ?? []).filter((note) => !note.readAt).slice(0, 3);

  return (
    <div className="space-y-4">
      <header className="min-w-0">
        <h1 className="truncate">Панель управления</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{user?.addressName}</p>
      </header>
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <Glass target="today" className="lg:col-span-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">{lessonTitle}</h2>
            <Link className="inline-flex min-h-11 min-w-11 items-center px-2" to="/schedule">Все</Link>
          </div>
          {dayName ? <p className="mb-2 text-sm text-[var(--muted)]">{dayName}</p> : null}
          {lessons.length ? lessons.map((lesson) => <LessonLine key={lesson.id} lesson={lesson} />) : <p className="py-4 text-sm text-[var(--muted)]">Ближайших пар нет.</p>}
        </Glass>
        <div className="flex flex-col gap-4">
          <Glass>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Сроки</h2>
              <Link className="inline-flex min-h-11 min-w-11 items-center px-2" to="/homework">Все</Link>
            </div>
            {dueWork.length ? dueWork.map((row) => (
              <Link key={row.id} to={`/homework/${row.id}`} className="block min-h-11 border-t border-white/40 py-2 text-sm first:border-0">
                <span className="font-semibold">{row.title}</span>
                <span className="text-[var(--muted)]"> · до {row.deadline.slice(8)}.{row.deadline.slice(5, 7)}</span>
              </Link>
            )) : <p className="text-sm text-[var(--muted)]">Срочных заданий нет.</p>}
          </Glass>
          <Glass>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Нужно действие</h2>
              <Link className="inline-flex min-h-11 min-w-11 items-center px-2" to="/requests">Все</Link>
            </div>
            {openRequests.map((row) => (
              <p key={row.id} className="flex items-center justify-between gap-2 border-t border-white/40 py-2 text-sm first:border-0">
                <span className="min-w-0 truncate font-semibold">{row.title}</span>
                <Pill tone="mid">{STATUS_LABEL[row.status]}</Pill>
              </p>
            ))}
            {unread.map((note) => <p key={note.id} className="truncate border-t border-white/40 py-2 text-sm">{note.title}</p>)}
            {!openRequests.length && !unread.length ? <p className="text-sm text-[var(--muted)]">Срочных дел нет.</p> : null}
          </Glass>
          <Glass>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Сессия</h2>
              <Link className="inline-flex min-h-11 min-w-11 items-center px-2" to="/grades">Все</Link>
            </div>
            {risky.length ? risky.map((item) => (
              <p key={item.id} className="mt-2 text-sm">
                <span className="font-semibold">{item.name}. </span>
                <span className="text-[var(--muted)]">{item.statusText || item.headline}</span>
              </p>
            )) : <p className="mt-2 text-sm text-[var(--muted)]">Срочного риска нет.</p>}
          </Glass>
        </div>
      </div>
    </div>
  );
}

function StaffHome() {
  const inbox = useQuery({ queryKey: ["staff"], queryFn: () => api<{ requests: StaffRow[] }>("/api/staff/requests") });
  const agent = useAgent();
  if (inbox.isLoading) return <LoadingBlock />;
  if (inbox.error) return <ErrorState text="Входящие не загрузились" onRetry={() => void inbox.refetch()} />;
  const fresh = inbox.data?.requests.filter((row) => row.status === "submitted") ?? [];
  return (
    <div className="space-y-4">
      <h1>Учебный офис</h1>
      <Glass target="inbox">
        <p className="text-sm text-[var(--muted)]">Новых заявок: {fresh.length}. Агент может разобрать входящие и подсказать ответ.</p>
        <button className="btn btn-primary mt-3" onClick={() => void agent.send("Разбери входящие")}>Разобрать с агентом</button>
      </Glass>
      <div className="space-y-3">
        {[...(inbox.data?.requests ?? [])].sort((a, b) => Number(b.status === "submitted") - Number(a.status === "submitted")).slice(0, 6).map((row) => (
          <Link key={row.id} to={`/staff/requests/${row.id}`} className="liquid-glass block">
            <div className="glass-pad p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 font-semibold">{row.title}</h2>
                <Pill tone={row.status === "rejected" ? "high" : row.status === "submitted" ? "mid" : "low"}>{STATUS_LABEL[row.status]}</Pill>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{row.studentName}{row.groupName ? ` · ${row.groupName}` : ""}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function LessonLine({ lesson }: { lesson: LessonView }) {
  return (
    <div className="flex gap-3 border-t border-white/40 py-3 first:border-0" data-agent-target={`lesson-${lesson.id}`}>
      <div className="w-24 shrink-0 text-sm font-semibold">{lesson.startsAt}–{lesson.endsAt}</div>
      <div className="min-w-0">
        <p className="font-semibold">{lesson.discipline}</p>
        <p className="text-sm text-[var(--muted)]">{KIND_LABEL[lesson.kind]} · ауд. {lesson.room} · {lesson.teacher}</p>
        {lesson.changeType !== "none" ? <p className="mt-1 text-sm">{lesson.changeNote}</p> : null}
      </div>
    </div>
  );
}

interface Note { id: number; title: string; body: string; readAt: string | null }
interface StaffRow {
  id: number;
  title: string;
  status: RequestStatus;
  studentName: string;
  groupName: string | null;
  triage: { summary: string };
}
