import { useQuery } from "@tanstack/react-query";
import { JournalScreen } from "../components/journal/JournalScreen";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { formatScore, validPoints } from "@shared/journal";
import { EmptyLine, LessonItem, SectionHeader, WorkItem } from "../components/items";
import { BackLink, Button, Choice, EmptyState, ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface Home {
  groups: { groupName: string; discipline: string }[];
  lessonDay: string;
  review: { assignmentId: number; title: string; kind?: string; studentName: string; groupName: string }[];
  lessons: { id: number; groupName: string; discipline: string; startsAt: string; endsAt: string; room: string | null }[];
  pending: number;
}

function moscowDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}

function shortName(name: string) {
  const [last, first, middle] = name.split(" ");
  if (!first) return name;
  return `${last}\u00A0${first[0]}.\u00A0${middle ? `${middle[0]}.` : ""}`.trim();
}

export function TeachHome() {
  const home = useQuery({ queryKey: ["teach"], queryFn: () => api<Home>("/api/teach/home") });
  if (home.isLoading) return <LoadingBlock />;
  if (home.error || !home.data) return <ErrorState text="Кабинет не загрузился" onRetry={() => void home.refetch()} />;
  const groups = [...new Set(home.data.groups.map((row) => row.groupName))];
  return (
    <div className="stagger space-y-4" data-agent-target="teach">
      <h1 className="t-page">Преподаватель</h1>
      <Glass>
        <SectionHeader title={home.data.lessonDay === moscowDate() ? "Пары сегодня" : "Ближайшие пары"} />
        {home.data.lessons.length ? home.data.lessons.slice(0, 3).map((lesson) => (
          <LessonItem key={lesson.id} start={lesson.startsAt} end={lesson.endsAt} title={lesson.discipline} kind="lecture" room={lesson.room ?? undefined} group={lesson.groupName} action={<Link className="t-chip inline-flex min-h-11 items-center" to={`/teach/journal?group=${encodeURIComponent(lesson.groupName)}&discipline=${encodeURIComponent(lesson.discipline)}`}>Журнал</Link>} />
        )) : <EmptyLine text="Ближайших пар нет" />}
      </Glass>
      <Glass>
        <SectionHeader title="Ждут проверки" count={home.data.pending} action={<Link className="t-chip inline-flex min-h-11 items-center" to="/teach/homework">Все</Link>} />
        {home.data.review.length ? home.data.review.map((row) => (
          <WorkItem key={`${row.assignmentId}-${row.studentName}`} href={`/teach/homework/${row.assignmentId}`} title={row.title} kind={row.kind || "homework"} student={shortName(row.studentName)} group={row.groupName} status="in_review" />
        )) : <EmptyLine text="Очередь пуста" />}
      </Glass>
      <Glass>
        <SectionHeader title="Мои группы" />
        <ul className="mt-2 space-y-2">
          {groups.map((group) => (
            <li key={group} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{group}</span>
              <Link className="inline-flex min-h-11 items-center" to={`/teach/journal?group=${encodeURIComponent(group)}`}>Журнал</Link>
            </li>
          ))}
        </ul>
      </Glass>
    </div>
  );
}

export function TeachJournal() {
  return <JournalScreen />;
}


interface QueueItem {
  assignmentId: number;
  title: string;
  kind?: string;
  discipline: string;
  groupName: string;
  studentName: string;
  submission: { status: string; statusLabel: string };
}

export function TeachQueue() {
  const queue = useQuery({ queryKey: ["teach-queue"], queryFn: () => api<{ queue: QueueItem[] }>("/api/teach/homework") });
  if (queue.isLoading) return (
    <div className="space-y-3" aria-busy="true">
      <h1 className="t-page">Проверка</h1>
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-16 w-full rounded-3xl" />)}
    </div>
  );
  if (queue.error) return <ErrorState text="Очередь не загрузилась" onRetry={() => void queue.refetch()} />;
  const rows = queue.data?.queue ?? [];
  return (
    <div className="stagger space-y-3" data-agent-target="queue">
      <BackLink to="/teach" />
      <h1 className="t-page">Проверка</h1>
      {rows.length === 0 ? <EmptyState title="Очередь пуста" text="Сданных работ пока нет." /> : (["in_review", "returned", "graded"] as const).map((status) => {
        const title = status === "in_review" ? "Ждут проверки" : status === "returned" ? "Возвращены" : "Проверены";
        const group = rows.filter((row) => (status === "in_review" ? row.submission.status === "in_review" || row.submission.status === "submitted" : row.submission.status === status));
        if (!group.length) return null;
        return (
          <section key={status} className="space-y-2">
            <SectionHeader title={title} count={group.length} />
            {group.slice(0, 12).map((row) => (
              <WorkItem key={`${row.assignmentId}-${row.studentName}`} href={`/teach/homework/${row.assignmentId}`} title={row.title} kind={row.kind || "homework"} student={shortName(row.studentName)} group={row.groupName} status={row.submission.status} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function TeachAssignment() {
  const { id = "" } = useParams();
  const detail = useQuery({
    queryKey: ["teach-assignment", id],
    queryFn: () => api<{ assignment: { id: number; title: string; description: string; groupName: string; discipline: string; kind: string; maxPoints?: number; students: { name: string; submission: { statusLabel: string; body: string; status: string; score: number | null; teacherComment: string | null } }[] } }>(`/api/teach/homework/${id}`),
  });
  const [error, setError] = useState("");
  if (detail.isLoading) return (
    <div className="space-y-4" aria-busy="true">
      <h1 className="t-page">Работа</h1>
      <div className="skeleton h-24 w-full rounded-3xl" />
      <div className="skeleton h-40 w-full rounded-3xl" />
    </div>
  );
  if (detail.error || !detail.data) return <ErrorState text="Задание не найдено" />;
  const assignment = detail.data.assignment;
  return (
    <div className="space-y-4">
      <BackLink to="/teach/homework" />
      <h1 className="t-page item-title" title={assignment.title}>{assignment.title}</h1>
      <p className="t-meta">{assignment.groupName}</p>
      <p className="t-meta">{assignment.discipline}</p>
      <Glass><p className="text-sm" data-ui-allow-latin="">{assignment.description}</p></Glass>
      <ReviewGroups students={assignment.students} assignmentId={assignment.id} kind={assignment.kind} maxPoints={assignment.maxPoints ?? 10} onError={setError} onSaved={() => void detail.refetch()} />
      {error ? <p className="text-sm text-[var(--risk-high-fg)]">{error}</p> : null}
    </div>
  );
}

function ReviewGroups({ students, assignmentId, kind, maxPoints, onError, onSaved }: { students: { name: string; submission: { statusLabel: string; body: string; status: string; score: number | null; teacherComment: string | null } }[]; assignmentId: number; kind: string; maxPoints: number; onError: (message: string) => void; onSaved: () => void }) {
  const waiting = students.filter((student) => student.submission.status === "in_review" || student.submission.status === "submitted");
  const returned = students.filter((student) => student.submission.status === "returned");
  const graded = students.filter((student) => student.submission.status === "graded");
  const idle = students.filter((student) => student.submission.status === "not_started" || student.submission.status === "in_progress");
  return (
    <>
      <SectionHeader title="На проверке" count={waiting.length} />
      {waiting.map((student) => <StudentReview key={student.name} student={student} assignmentId={assignmentId} kind={kind} maxPoints={maxPoints} onError={onError} onSaved={onSaved} />)}
      {returned.length ? <SectionHeader title="Возвращены" count={returned.length} /> : null}
      {returned.map((student) => <StudentReview key={student.name} student={student} assignmentId={assignmentId} kind={kind} maxPoints={maxPoints} onError={onError} onSaved={onSaved} />)}
      {graded.length ? <SectionHeader title="Сдано" count={graded.length} /> : null}
      {graded.map((student) => <StudentReview key={student.name} student={student} assignmentId={assignmentId} kind={kind} maxPoints={maxPoints} onError={onError} onSaved={onSaved} />)}
      {idle.length ? (
        <section className="space-y-1">
          <SectionHeader title="Не сдали" count={idle.length} />
          {idle.map((student) => <p key={student.name} className="t-meta whitespace-nowrap" title={student.name}>{shortName(student.name)}</p>)}
        </section>
      ) : null}
    </>
  );
}

function StudentReview({
  student,
  assignmentId,
  kind,
  maxPoints,
  onError,
  onSaved,
}: {
  student: { name: string; submission: { statusLabel: string; body: string; status: string; score: number | null; teacherComment: string | null } };
  assignmentId: number;
  kind: string;
  maxPoints: number;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const run = useAction();
  const [draft, setDraft] = useState(student.submission.score == null ? "" : formatScore(student.submission.score));
  const [comment, setComment] = useState(student.submission.teacherComment || "Нужно поправить и прислать снова.");
  useEffect(() => {
    setDraft(student.submission.score == null ? "" : formatScore(student.submission.score));
  }, [student.submission.score]);
  useEffect(() => {
    if (student.submission.teacherComment) setComment(student.submission.teacherComment);
  }, [student.submission.teacherComment]);
  const grading = student.submission.status === "in_review" || student.submission.status === "submitted";
  const raw = draft.trim().replace(",", ".");
  const parsed = Number(raw);
  const valid = raw !== "" && Number.isFinite(parsed) && validPoints(parsed, maxPoints);
  const step = (delta: number) => {
    const base = raw === "" || !Number.isFinite(parsed) ? 0 : parsed;
    const next = Math.round((base + delta) * 2) / 2;
    setDraft(formatScore(Math.min(maxPoints, Math.max(0, next))));
  };
  const picks = [
    { label: "макс", value: maxPoints },
    { label: "75%", value: Math.round(maxPoints * 0.75 * 2) / 2 },
    { label: "50%", value: Math.round(maxPoints * 0.5 * 2) / 2 },
  ];
  return (
    <Glass target={`student-${student.name}`}>
      <WorkItem title={shortName(student.name)} kind={kind} status={student.submission.status} points={student.submission.score != null ? { value: student.submission.score, max: maxPoints } : undefined} />
      {student.submission.body ? <p className="mt-2 text-sm" data-ui-allow-latin="">{student.submission.body}</p> : null}
      {grading ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-nowrap items-center gap-2">
            <button type="button" className="btn btn-quiet h-11 w-11 shrink-0 px-0" aria-label="Меньше" onClick={() => step(-0.5)}>−</button>
            <input className="field h-11 shrink-0 px-2 text-center" style={{ width: 72, flex: "0 0 72px" }} inputMode="decimal" aria-label="Баллы" data-agent-field="homework-score" placeholder="—" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <span className="t-meta whitespace-nowrap">из {maxPoints}</span>
            <button type="button" className="btn btn-quiet h-11 w-11 shrink-0 px-0" aria-label="Больше" onClick={() => step(0.5)}>+</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {picks.map((pick) => (
              <button key={pick.label} type="button" className="btn btn-quiet h-11 px-3" onClick={() => setDraft(formatScore(pick.value))}>{pick.label}</button>
            ))}
          </div>
          <Button className="h-11 w-full" data-agent-action="teach-grade" disabled={!valid} onClick={() => { if (!valid) return; void run("teacher_grade_homework", { assignmentId, studentName: student.name, score: parsed }).then(onSaved).catch((err: Error) => onError(err.message)); }}>Сохранить баллы</Button>
          <Button variant="glass" className="h-11 w-full" data-agent-action="teach-return" onClick={() => void run("teacher_return_homework", { assignmentId, studentName: student.name, comment }).then(onSaved).catch((err: Error) => onError(err.message))}>Вернуть</Button>
        </div>
      ) : null}
    </Glass>
  );
}

export function TeachIssue() {
  const home = useQuery({ queryKey: ["teach"], queryFn: () => api<Home>("/api/teach/home") });
  const run = useAction();
  const [groupName, setGroupName] = useState("БИ-3-26-04");
  const [discipline, setDiscipline] = useState("Базы данных");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [kind, setKind] = useState("lab");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<{ field: string; value: string }>).detail;
      if (detail.field === "group") setGroupName(detail.value);
      if (detail.field === "discipline") setDiscipline(detail.value);
      if (detail.field === "title") setTitle(detail.value);
      if (detail.field === "description") setDescription(detail.value);
      if (detail.field === "deadline") setDeadline(detail.value);
      if (detail.field === "kind") setKind(detail.value);
    };
    window.addEventListener("altair-fill", onFill);
    return () => window.removeEventListener("altair-fill", onFill);
  }, []);
  return (
    <div className="space-y-4" data-agent-target="issue">
      <BackLink to="/teach" />
      <h1>Выдать задание</h1>
      <Glass>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void run("teacher_issue_assignment", { groupName, discipline, title, description, kind, deadline: deadline.includes(".") ? deadline.split(".").reverse().join("-") : deadline }).then(() => setMessage("Задание выдано, группа получила уведомление.")).catch((error: Error) => setMessage(error.message));
        }}>
          <Choice label="Группа" value={groupName} options={[...new Set((home.data?.groups ?? [{ groupName: "БИ-3-26-04" }, { groupName: "ЮР-1-26-02" }]).map((row) => row.groupName))].map((name) => ({ value: name, label: name }))} onChange={setGroupName} />
          <label className="block text-sm font-semibold">Предмет<input className="field mt-1" data-agent-field="discipline" value={discipline} onChange={(event) => setDiscipline(event.target.value)} /></label>
          <label className="block text-sm font-semibold">Название<input className="field mt-1" data-agent-field="title" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="block text-sm font-semibold">Условие<textarea className="field mt-1 min-h-24 py-3" data-agent-field="description" value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
          <Choice label="Тип" value={kind} options={[{ value: "lab", label: "Лабораторная" }, { value: "problem_set", label: "Задачник" }, { value: "essay", label: "Эссе" }, { value: "reading", label: "Чтение" }, { value: "project", label: "Проект" }]} onChange={setKind} />
          <label className="block text-sm font-semibold">Срок<input className="field mt-1" data-agent-field="deadline" inputMode="numeric" placeholder="дд.мм.гггг" lang="ru" value={deadline} onChange={(event) => setDeadline(event.target.value)} required /></label>
          <div className="form-sticky">
            <Button className="h-11 px-4" data-agent-action="teach-issue">Выдать</Button>
          </div>
          {message ? <p className="text-sm">{message}</p> : null}
        </form>
      </Glass>
    </div>
  );
}

export function TeachAnnounce() {
  const run = useAction();
  const [groupName, setGroupName] = useState("БИ-3-26-04");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-4" data-agent-target="announce">
      <BackLink to="/teach" />
      <h1>Объявление группе</h1>
      <Glass>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void run("teacher_announce", { groupName, title, body }).then(() => setMessage("Отправлено только этой группе.")).catch((error: Error) => setMessage(error.message));
        }}>
          <Choice label="Группа" value={groupName} options={[{ value: "БИ-3-26-04", label: "БИ-3-26-04" }, { value: "ЮР-1-26-02", label: "ЮР-1-26-02" }]} onChange={setGroupName} />
          <label className="block text-sm font-semibold">Заголовок<input className="field mt-1" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="block text-sm font-semibold">Текст<textarea className="field mt-1 min-h-24 py-3" value={body} onChange={(event) => setBody(event.target.value)} required /></label>
          <div className="form-sticky">
            <Button className="h-11 px-4">Отправить</Button>
          </div>
          {message ? <p className="text-sm">{message}</p> : null}
        </form>
      </Glass>
    </div>
  );
}
