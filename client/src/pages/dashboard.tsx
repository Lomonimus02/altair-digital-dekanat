import { useQuery } from "@tanstack/react-query";
import { STATUS_LABEL, type LessonView, type RequestStatus } from "@shared/domain";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { useAgent } from "../lib/agent";
import { useAuth } from "../lib/auth";
import { lessonView } from "../lib/lesson";
import { EmptyLine, ItemSkeleton, LessonItem, NotificationItem, RequestItem, SectionHeader, StatusPill, WorkItem } from "../components/items";
import { fmtDate, noticeView } from "../lib/format";
import { ErrorState, Glass, LoadingBlock } from "../components/ui";

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
  const student = user?.role === "student";
  const grades = useQuery({ queryKey: ["grades", ""], queryFn: () => api<{ items: { id: number; name: string; risk: string; statusText?: string; average?: number | null; headline: string }[] }>("/api/grades"), enabled: student });
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => api<{ requests: { id: number; title: string; status: RequestStatus }[] }>("/api/requests"), enabled: student });
  const homework = useQuery({ queryKey: ["homework"], queryFn: () => api<{ homework: { id: number; title: string; deadline: string; submission: { status: string } }[] }>("/api/homework"), enabled: student });

  if (user?.role === "staff") return <StaffHome />;
  if (brief.isLoading || schedule.isLoading) return <div className="space-y-3"><ItemSkeleton kind="lesson" /><ItemSkeleton kind="work" /></div>;
  if (brief.error || schedule.error) return <ErrorState text="Сводка не загрузилась" onRetry={() => void brief.refetch()} />;

  const today = schedule.data?.days.find((day) => day.date === schedule.data?.today);
  const upcoming = schedule.data?.days.find((day) => day.date > (schedule.data?.today ?? "") && day.items.length);
  const focusDay = today?.items.length ? today : upcoming;
  const lessons = (focusDay?.items ?? []).slice(0, 3);
  const dueWork = (homework.data?.homework ?? []).filter((row) => !["graded", "in_review", "submitted"].includes(row.submission.status)).slice(0, 3);
  const risky = (grades.data?.items ?? []).filter((item) => item.risk === "high" || item.risk === "medium").slice(0, 3);
  const openRequests = (requests.data?.requests ?? []).filter((row) => row.status === "ready" || row.status === "submitted" || row.status === "in_progress").slice(0, 3);
  const unread = dedupeNotes((notes.data?.notifications ?? []).filter((note) => !note.readAt)).slice(0, 3);

  const gradeNotes = dedupeNotes(notes.data?.notifications ?? []).filter((note) => !note.readAt && noticeView(note).type === "grade").slice(0, 3);
  return (
    <div className="stagger space-y-4">
      <header className="min-w-0">
        <h1 className="t-page">Добрый день</h1>
        <p className="t-muted mt-1">{user?.addressName} {schedule.data?.today ? fmtDate(schedule.data.today, "day") : ""}</p>
      </header>
      <Glass target="today">
        <SectionHeader title={today?.items.length ? "Пары сегодня" : "Следующая пара"} action={<Link className="t-chip inline-flex min-h-11 items-center" to="/schedule">Все</Link>} />
        {lessons.length ? lessons.map((lesson, index) => <LessonLine key={lesson.id} lesson={lesson} ask={index === 0} />) : <EmptyLine text="Сегодня пар нет" />}
      </Glass>
      <Glass>
        <SectionHeader title="Работы к сдаче" action={<Link className="t-chip inline-flex min-h-11 items-center" to="/homework">Все</Link>} />
        {dueWork.length ? <div className="work-stack">{dueWork.map((row) => <WorkItem key={row.id} href={`/homework/${row.id}`} title={row.title} kind="homework" due={row.deadline} status={row.submission.status} />)}</div> : <EmptyLine text="Срочных заданий нет" />}
      </Glass>
      <Glass>
        <SectionHeader title="Новые баллы" count={gradeNotes.length} action={<Link className="t-chip inline-flex min-h-11 items-center" to="/grades">Все</Link>} />
        {gradeNotes.length ? gradeNotes.map((note) => {
          const view = noticeView(note);
          return <NotificationItem key={note.id} type="grade" title={view.title} body={view.body} at={schedule.data?.today ?? "2026-11-21"} unread={!note.readAt} href={note.href ?? "/grades"} />;
        }) : <EmptyLine text="Новых баллов нет" />}
      </Glass>
      <Glass>
        <SectionHeader title="Заявки" action={<Link className="t-chip inline-flex min-h-11 items-center" to="/requests">Все</Link>} />
        {openRequests.length ? openRequests.map((row) => <RequestItem key={row.id} href={`/requests/${row.id}`} number={row.id} title={row.title} statusLabel={STATUS_LABEL[row.status]} createdAt={schedule.data?.today ?? "2026-11-21"} />) : <EmptyLine text="Открытых заявок нет" />}
      </Glass>
      <Glass>
        <SectionHeader title="Сессия" action={<Link className="t-chip inline-flex min-h-11 items-center" to="/grades">Все</Link>} />
        {risky.length ? risky.map((item) => (
          <div key={item.id} className="mt-2 flex items-center justify-between gap-2">
            <span className="t-title" title={item.name}>{item.name}</span>
            <StatusPill tone={item.risk === "high" ? "red" : "amber"}>{item.risk === "high" ? "Риск" : "В работе"}</StatusPill>
          </div>
        )) : <EmptyLine text="Срочного риска нет" />}
      </Glass>
    </div>
  );
}

function StaffHome() {
  const [params] = useSearchParams();
  const status = params.get("status");
  const inbox = useQuery({ queryKey: ["staff"], queryFn: () => api<{ requests: StaffRow[] }>("/api/staff/requests") });
  const agent = useAgent();
  if (inbox.isLoading) return <LoadingBlock />;
  if (inbox.error) return <ErrorState text="Входящие не загрузились" onRetry={() => void inbox.refetch()} />;
  const fresh = inbox.data?.requests.filter((row) => row.status === "submitted") ?? [];
  return (
    <div className="space-y-4">
      <h1 className="t-page">Учебный офис</h1>
      <Glass target="inbox">
        <SectionHeader title="Новые" count={fresh.length} action={<button className="btn btn-primary h-11 px-3" onClick={() => void agent.send("Разбери входящие")}>Разобрать с агентом</button>} />
      </Glass>
      {(["submitted", "in_progress", "issued"] as const).map((bucket) => {
        const title = bucket === "submitted" ? "Новые" : bucket === "in_progress" ? "В работе" : "Закрыто";
        const rows = (inbox.data?.requests ?? []).filter((row) => (bucket === "issued" ? row.status === "issued" || row.status === "rejected" || row.status === "ready" : row.status === bucket)).filter((row) => !status || row.status === status);
        if (!rows.length) return null;
        return (
          <section key={bucket} className="space-y-2">
            <SectionHeader title={title} count={rows.length} />
            {rows.slice(0, 6).map((row) => (
              <RequestItem key={row.id} href={`/staff/requests/${row.id}`} number={row.id} title={row.title} statusLabel={STATUS_LABEL[row.status]} createdAt={row.createdAt ?? "2026-11-21"} student={row.studentName} group={row.groupName ?? undefined} fresh={row.status === "submitted"} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function LessonLine({ lesson, ask = false }: { lesson: LessonView; ask?: boolean }) {
  const agent = useAgent();
  const run = useAction();
  const view = lessonView(lesson);
  return (
    <div data-agent-target={`lesson-${lesson.id}`}>
      <LessonItem
        start={lesson.startsAt}
        end={lesson.endsAt}
        title={lesson.discipline}
        kind={lesson.kind}
        room={lesson.room ?? undefined}
        teacher={lesson.teacher ?? undefined}
        state={view.state}
        badge={view.badge}
        note={view.note}
        action={ask ? (
          <button type="button" className="btn btn-quiet h-11 whitespace-nowrap px-3" data-agent-action="schedule-star" aria-pressed={lesson.flagged} onClick={() => void run("mark_schedule_item", { scheduleItemId: lesson.id, flagged: !lesson.flagged })}>
            {lesson.flagged ? "Пара отмечена" : "Отметить пару"}
          </button>
        ) : null}
      />
      {ask ? <button type="button" className="btn btn-quiet mt-2 h-11 px-3" onClick={() => agent.ask(`Что у меня на паре «${lesson.discipline}»?`)}>Спросить агента</button> : null}
    </div>
  );
}

interface Note { id: number; title: string; body: string; href?: string | null; readAt: string | null }

function dedupeNotes(notes: Note[]) {
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = note.href || note.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
interface StaffRow {
  id: number;
  title: string;
  status: RequestStatus;
  studentName: string;
  groupName: string | null;
  createdAt?: string;
  triage: { summary: string };
}
