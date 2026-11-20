import { useQuery } from "@tanstack/react-query";
import { formatDdMm } from "@shared/dates";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { useAgent } from "../lib/agent";
import { BackLink, Button, EmptyState, ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface Work {
  id: number;
  title: string;
  discipline: string;
  teacherName: string;
  kindLabel: string;
  description: string;
  deadline: string;
  maxScore: number;
  attachments: { title: string; href: string }[];
  lesson: { date: string; startsAt: string } | null;
  submission: { status: string; statusLabel: string; body: string; teacherComment: string | null; score: number | null };
  reminder?: string | null;
}

const FILTERS = [
  ["all", "Все"],
  ["due", "Сдать"],
  ["overdue", "Срок"],
  ["done", "Готово"],
] as const;

function settled(work: Work) {
  return ["graded", "in_review", "submitted"].includes(work.submission.status);
}

function bucket(work: Work, today: string) {
  if (settled(work)) return "done";
  if (work.deadline < today) return "overdue";
  return "due";
}

function groupLabel(work: Work, today: string) {
  if (settled(work)) return "Сдано";
  const deadline = work.deadline;
  if (deadline < today) return "Просрочено";
  if (deadline === today) return "Сегодня";
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  if (deadline === next.toISOString().slice(0, 10)) return "Завтра";
  const week = new Date(`${today}T00:00:00Z`);
  week.setUTCDate(week.getUTCDate() + 7);
  if (deadline <= week.toISOString().slice(0, 10)) return "На неделе";
  return "Позже";
}

export function HomeworkPage() {
  const list = useQuery({ queryKey: ["homework"], queryFn: () => api<{ homework: Work[] }>("/api/homework") });
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => {
    const items = list.data?.homework ?? [];
    return items.filter((work) => filter === "all" || bucket(work, today) === filter || (filter === "due" && bucket(work, today) === "overdue"));
  }, [list.data, filter, today]);
  if (list.isLoading) return <LoadingBlock />;
  if (list.error) return <ErrorState text="Задания не загрузились" onRetry={() => void list.refetch()} />;
  const groups = ["Просрочено", "Сегодня", "Завтра", "На неделе", "Позже", "Сдано"].filter((name) => rows.some((work) => groupLabel(work, today) === name));
  return (
    <div className="stagger space-y-4" data-agent-target="homework">
      <h1>Задания</h1>
      <div className="grid grid-cols-4 gap-2">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" className={`btn h-11 min-w-0 px-1 text-sm ${filter === id ? "btn-primary" : "btn-glass"}`} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? <EmptyState title="Пусто" text="В этом фильтре заданий нет." /> : groups.map((name) => (
        <section key={name} className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--muted)]">{name}</h2>
          {rows.filter((work) => groupLabel(work, today) === name).map((work) => (
            <Link key={work.id} to={`/homework/${work.id}`} className="liquid-glass block min-h-11" data-agent-target={`homework-${work.id}`}>
              <div className="glass-pad flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{work.title}</p>
                  <p className="truncate text-sm text-[var(--muted)]">{work.discipline}</p>
                  {work.reminder ? <p className="truncate text-sm">Напоминание: {work.reminder}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Pill tone={work.submission.status === "returned" ? "high" : work.submission.status === "graded" ? "low" : "mid"}>{work.submission.statusLabel}</Pill>
                  <Deadline deadline={work.deadline} today={today} settled={settled(work)} />
                </div>
              </div>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

function Deadline({ deadline, today, settled = false }: { deadline: string; today: string; settled?: boolean }) {
  const tone = settled ? "low" : deadline < today ? "high" : deadline === today ? "mid" : "low";
  return <Pill tone={tone}>{formatDdMm(deadline)}</Pill>;
}

export function HomeworkDetail() {
  const { id = "" } = useParams();
  const run = useAction();
  const agent = useAgent();
  const detail = useQuery({ queryKey: ["homework", id], queryFn: () => api<{ homework: Work; reminder: { title: string; dueAt: string } | null }>(`/api/homework/${id}`) });
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<{ field: string; value: string }>).detail;
      if (detail.field === "homework-body") setBody(detail.value);
    };
    window.addEventListener("altair-fill", onFill);
    return () => window.removeEventListener("altair-fill", onFill);
  }, []);
  if (detail.isLoading) return <LoadingBlock />;
  if (detail.error || !detail.data) return <ErrorState text="Задание не найдено" />;
  const work = detail.data.homework;
  const text = body || work.submission.body;
  const locked = work.submission.status === "graded" || work.submission.status === "in_review";
  return (
    <div className="space-y-4" data-agent-target={`homework-${work.id}`}>
      <BackLink to="/homework" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="line-clamp-2">{work.title}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{work.discipline} · {work.teacherName}</p>
        </div>
        <Pill tone={work.submission.status === "returned" ? "high" : work.submission.status === "graded" ? "low" : "mid"}>{work.submission.statusLabel}</Pill>
      </div>
      {detail.data.reminder ? <Glass><p className="text-sm font-semibold">Напоминание</p><p className="mt-1 text-sm">{detail.data.reminder.title}</p></Glass> : null}
      <Glass>
        <p className="text-sm">{work.description}</p>
        {work.lesson ? <p className="mt-2 text-sm text-[var(--muted)]">К паре {formatDdMm(work.lesson.date)}, {work.lesson.startsAt}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="glass" className="h-11 px-4" onClick={() => agent.ask(`Что сдавать по «${work.title}»?`)}>Спросить про это</Button>
        </div>
      </Glass>
      <Glass>
        <p className="text-sm font-semibold">Ваша работа</p>
        <p className="mt-1 whitespace-pre-wrap text-sm">{work.submission.body || "Текст ещё не отправлен."}</p>
        {work.submission.teacherComment ? <p className="mt-3 text-sm"><span className="font-semibold">Комментарий преподавателя. </span>{work.submission.teacherComment}</p> : null}
      </Glass>
      {work.submission.score != null ? <Glass><p className="text-sm">Оценка {work.submission.score} из {work.maxScore}. Она уже в ведомости.</p></Glass> : null}
      {locked ? null : (
        <Glass>
          <form className="space-y-3" onSubmit={(event) => event.preventDefault()}>
            <label className="block text-sm font-semibold">
              Текст работы
              <textarea className="field mt-1 min-h-28 py-3" data-agent-field="homework-body" value={text} onChange={(event) => setBody(event.target.value)} />
            </label>
            {error ? <p className="text-sm text-[var(--risk-high-fg)]">{error}</p> : null}
            <div className="form-sticky flex flex-wrap gap-2">
              <Button variant="glass" className="h-11 px-4" data-agent-action="homework-save" onClick={() => void run("save_homework", { assignmentId: work.id, body: text }).catch((err: Error) => setError(err.message))}>Сохранить</Button>
              <Button className="h-11 px-4" data-agent-action="homework-submit" onClick={() => void run("submit_homework", { assignmentId: work.id, body: text }).then(() => detail.refetch()).catch((err: Error) => setError(err.message))}>Сдать</Button>
            </div>
          </form>
        </Glass>
      )}
    </div>
  );
}
