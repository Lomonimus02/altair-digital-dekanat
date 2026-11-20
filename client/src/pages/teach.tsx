import { useQuery } from "@tanstack/react-query";
import { formatDdMm } from "@shared/dates";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { BackLink, Button, Choice, EmptyState, ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface Home {
  groups: { groupName: string; discipline: string }[];
  lessonDay: string;
  review: { assignmentId: number; title: string; studentName: string; groupName: string }[];
  lessons: { id: number; groupName: string; discipline: string; startsAt: string; endsAt: string; room: string | null }[];
  pending: number;
}

export function TeachHome() {
  const home = useQuery({ queryKey: ["teach"], queryFn: () => api<Home>("/api/teach/home") });
  if (home.isLoading) return <LoadingBlock />;
  if (home.error || !home.data) return <ErrorState text="Кабинет не загрузился" onRetry={() => void home.refetch()} />;
  const groups = [...new Set(home.data.groups.map((row) => row.groupName))];
  return (
    <div className="space-y-4" data-agent-target="teach">
      <h1>Преподаватель</h1>
      <Glass>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-xl font-semibold">На проверке · {home.data.pending}</h2>
          <Link className="inline-flex min-h-11 items-center px-2" to="/teach/homework">Все</Link>
        </div>
        {home.data.review.length ? home.data.review.map((row) => (
          <Link key={`${row.assignmentId}-${row.studentName}`} to={`/teach/homework/${row.assignmentId}`} className="block min-h-11 whitespace-normal border-t border-white/40 py-2 text-sm">
            <span className="font-semibold">{row.title}</span>
            <span className="text-[var(--muted)]"> · {row.studentName}, {row.groupName}</span>
          </Link>
        )) : <p className="text-sm text-[var(--muted)]">Очередь пуста.</p>}
      </Glass>
      <Glass>
        <h2 className="text-xl font-semibold">{home.data.lessonDay === moscowDate() ? "Пары сегодня" : "Ближайшие пары"}</h2>
        {home.data.lessons.length ? home.data.lessons.slice(0, 3).map((lesson) => (
          <p key={lesson.id} className="mt-2 text-sm">
            <span className="font-semibold">{lesson.startsAt}–{lesson.endsAt} {lesson.discipline}</span>
            <span className="text-[var(--muted)]"> · {lesson.groupName}{lesson.room ? ` · ${lesson.room}` : ""}</span>
          </p>
        )) : <p className="mt-2 text-sm text-[var(--muted)]">Ближайших пар нет.</p>}
      </Glass>
      <Glass>
        <h2 className="text-xl font-semibold">Мои группы</h2>
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
  const home = useQuery({ queryKey: ["teach"], queryFn: () => api<Home>("/api/teach/home") });
  const [params] = useSearchParams();
  const [group, setGroup] = useState(params.get("group") ?? "");
  const [discipline, setDiscipline] = useState(params.get("discipline") ?? "");
  useEffect(() => {
    const nextGroup = params.get("group");
    const nextDiscipline = params.get("discipline");
    if (nextGroup) setGroup(nextGroup);
    if (nextDiscipline) setDiscipline(nextDiscipline);
  }, [params]);
  const subjects = (home.data?.groups ?? []).filter((row) => !group || row.groupName === group);
  const activeDiscipline = discipline || subjects[0]?.discipline || "";
  const activeGroup = group || subjects[0]?.groupName || "";
  const journal = useQuery({
    queryKey: ["journal", activeGroup, activeDiscipline],
    queryFn: () => api<{ studyDate: string; students: JournalStudent[] }>(`/api/teach/journal?group=${encodeURIComponent(activeGroup)}&discipline=${encodeURIComponent(activeDiscipline)}`),
    enabled: Boolean(activeGroup && activeDiscipline),
  });
  const run = useAction();
  if (home.isLoading) return <LoadingBlock />;
  return (
    <div className="space-y-4" data-agent-target="journal">
      <BackLink to="/teach" />
      <h1>Журнал</h1>
      <Choice label="Группа" value={activeGroup} options={[...new Set((home.data?.groups ?? []).map((row) => row.groupName))].map((name) => ({ value: name, label: name }))} onChange={(value) => { setGroup(value); setDiscipline(""); }} />
      <Choice label="Предмет" value={activeDiscipline} options={subjects.map((row) => ({ value: row.discipline, label: row.discipline }))} onChange={setDiscipline} />
      {journal.isLoading ? <LoadingBlock /> : null}
      {journal.error ? <ErrorState text="Журнал недоступен" /> : null}
      <div className="space-y-3 md:hidden">
        {journal.data?.students.map((student) => (
          <Glass key={student.name} target={`journal-${student.name}`}>
            <p className="font-semibold">{student.name}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--muted)]">{attendanceLabel(journal.data?.studyDate)}</span>
              <AttendanceButton student={student} studyDate={journal.data?.studyDate} group={activeGroup} discipline={activeDiscipline} onDone={() => void journal.refetch()} />
            </div>
            <GradeChips student={student} group={activeGroup} discipline={activeDiscipline} onDone={() => void journal.refetch()} />
            <p className="mt-2 text-sm text-[var(--muted)]">Уже стоит: {marksText(student.marks)}</p>
          </Glass>
        ))}
      </div>
      <div className="hidden w-full min-w-0 overflow-x-auto md:block">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-[22%] bg-[#f4fff8] px-3 py-2 text-left dark:bg-[#10182c]">Студент</th>
              <th className="w-[14%] px-3 py-2 text-left">{attendanceLabel(journal.data?.studyDate)}</th>
              <th className="w-[40%] px-3 py-2 text-left">Поставить</th>
              <th className="w-[24%] px-3 py-2 text-left">Уже стоит</th>
            </tr>
          </thead>
          <tbody>
            {journal.data?.students.map((student) => (
              <tr key={student.name} className="border-t border-white/40" data-agent-target={`journal-${student.name}`}>
                <th className="sticky left-0 z-10 whitespace-normal bg-[#f4fff8] px-3 py-2 text-left font-semibold dark:bg-[#10182c]">{student.name}</th>
                <td className="px-3 py-2">
                  <AttendanceButton student={student} studyDate={journal.data?.studyDate} group={activeGroup} discipline={activeDiscipline} onDone={() => void journal.refetch()} />
                </td>
                <td className="px-3 py-2">
                  <GradeChips compact student={student} group={activeGroup} discipline={activeDiscipline} onDone={() => void journal.refetch()} />
                </td>
                <td className="whitespace-normal px-3 py-2 text-[var(--muted)]">{marksText(student.marks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface QueueItem {
  assignmentId: number;
  title: string;
  discipline: string;
  groupName: string;
  studentName: string;
  submission: { status: string; statusLabel: string };
}

export function TeachQueue() {
  const queue = useQuery({ queryKey: ["teach-queue"], queryFn: () => api<{ queue: QueueItem[] }>("/api/teach/homework") });
  if (queue.isLoading) return <LoadingBlock />;
  if (queue.error) return <ErrorState text="Очередь не загрузилась" onRetry={() => void queue.refetch()} />;
  const rows = queue.data?.queue ?? [];
  return (
    <div className="space-y-3" data-agent-target="queue">
      <BackLink to="/teach" />
      <h1>На проверке</h1>
      {rows.length === 0 ? <EmptyState title="Очередь пуста" text="Сданных работ пока нет." /> : rows.slice(0, 12).map((row) => (
        <Link key={`${row.assignmentId}-${row.studentName}`} to={`/teach/homework/${row.assignmentId}`} className="liquid-glass block">
          <div className="glass-pad flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold">{row.title}</p>
              <p className="truncate text-sm text-[var(--muted)]">{row.studentName} · {row.groupName}</p>
            </div>
            <Pill tone={row.submission.status === "in_review" ? "mid" : "low"}>{row.submission.statusLabel}</Pill>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function TeachAssignment() {
  const { id = "" } = useParams();
  const detail = useQuery({
    queryKey: ["teach-assignment", id],
    queryFn: () => api<{ assignment: { id: number; title: string; description: string; groupName: string; discipline: string; students: { name: string; submission: { statusLabel: string; body: string; status: string; score: number | null; teacherComment: string | null } }[] } }>(`/api/teach/homework/${id}`),
  });
  const [error, setError] = useState("");
  if (detail.isLoading) return <LoadingBlock />;
  if (detail.error || !detail.data) return <ErrorState text="Задание не найдено" />;
  const assignment = detail.data.assignment;
  return (
    <div className="space-y-4">
      <BackLink to="/teach/homework" />
      <h1 className="line-clamp-2">{assignment.title}</h1>
      <p className="text-sm text-[var(--muted)]">{assignment.groupName} · {assignment.discipline}</p>
      <Glass><p className="text-sm">{assignment.description}</p></Glass>
      {assignment.students.map((student) => (
        <StudentReview key={student.name} student={student} assignmentId={assignment.id} onError={setError} onSaved={() => void detail.refetch()} />
      ))}
      {error ? <p className="text-sm text-[var(--risk-high-fg)]">{error}</p> : null}
    </div>
  );
}

function StudentReview({
  student,
  assignmentId,
  onError,
  onSaved,
}: {
  student: { name: string; submission: { statusLabel: string; body: string; status: string; score: number | null; teacherComment: string | null } };
  assignmentId: number;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const run = useAction();
  const [comment, setComment] = useState(student.submission.teacherComment || "Нужно поправить и прислать снова.");
  useEffect(() => {
    if (student.submission.teacherComment) setComment(student.submission.teacherComment);
  }, [student.submission.teacherComment]);
  return (
    <Glass target={`student-${student.name}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{student.name}</h2>
        <Pill>{student.submission.statusLabel}</Pill>
      </div>
      {student.submission.body ? <p className="mt-2 text-sm">{student.submission.body}</p> : null}
      {student.submission.teacherComment ? <p className="mt-2 text-sm"><span className="font-semibold">Комментарий. </span>{student.submission.teacherComment}</p> : null}
      {student.submission.status === "returned" ? (
        <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void run("teacher_return_homework", { assignmentId, studentName: student.name, comment }).then(onSaved).catch((err: Error) => onError(err.message)); }}>
          <label className="block text-sm font-semibold">Исправить комментарий<textarea className="field mt-1 min-h-16 py-3" value={comment} onChange={(event) => setComment(event.target.value)} /></label>
          <Button variant="glass" className="h-11 px-4">Сохранить комментарий</Button>
        </form>
      ) : null}
      {student.submission.status === "graded" ? <p className="mt-2 text-sm">Оценка {student.submission.score}</p> : student.submission.status === "not_started" ? <p className="mt-2 text-sm text-[var(--muted)]">Не начато — ставить оценку рано.</p> : student.submission.status === "returned" ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          {[2, 3, 4, 5].map((score) => (
            <Button key={score} className="h-11 w-11 px-0" data-agent-action="teach-grade" onClick={() => void run("teacher_grade_homework", { assignmentId, studentName: student.name, score }).then(onSaved).catch((err: Error) => onError(err.message))}>{score}</Button>
          ))}
          <Button variant="glass" className="h-11 px-3" onClick={() => void run("teacher_grade_homework", { assignmentId, studentName: student.name, score: 1 }).then(onSaved).catch((err: Error) => onError(err.message))}>зачёт</Button>
          <Button variant="glass" className="h-11 px-3" onClick={() => void run("teacher_grade_homework", { assignmentId, studentName: student.name, score: 0 }).then(onSaved).catch((err: Error) => onError(err.message))}>незачёт</Button>
          <Button variant="glass" className="h-11 px-4" data-agent-action="teach-return" onClick={() => void run("teacher_return_homework", { assignmentId, studentName: student.name, comment }).then(onSaved).catch((err: Error) => onError(err.message))}>Вернуть</Button>
        </div>
      )}
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

function moscowDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
}

type JournalStudent = { name: string; marks: { label: string; value: number | null }[]; attendance: { date: string; present: boolean }[] };

function marksText(marks: JournalStudent["marks"]) {
  return marks.map((mark) => `${mark.label} ${mark.value === 1 && mark.label === "Зачёт" ? "зачёт" : mark.value === 0 ? "незачёт" : mark.value}`).join(", ") || "—";
}

function attendanceLabel(studyDate?: string) {
  if (!studyDate) return "Явка";
  if (studyDate === moscowDate()) return "Явка сегодня";
  return `Явка ${formatDdMm(studyDate)}`;
}

function AttendanceButton({ student, studyDate, group, discipline, onDone }: { student: JournalStudent; studyDate?: string; group: string; discipline: string; onDone: () => void }) {
  const run = useAction();
  const date = studyDate || moscowDate();
  const row = student.attendance.find((item) => item.date === date);
  const present = Boolean(row?.present);
  const label = !row ? "Не отмечен" : present ? "Был" : "Не был";
  return (
    <button type="button" className="btn btn-glass h-11 whitespace-nowrap px-3" aria-pressed={present} onClick={() => void run("teacher_set_attendance", { groupName: group, discipline, date, studentName: student.name, present: !present }).then(onDone)}>
      {label}
    </button>
  );
}

function GradeChips({ student, group, discipline, onDone, compact = false }: { student: JournalStudent; group: string; discipline: string; onDone: () => void; compact?: boolean }) {
  const run = useAction();
  const put = (value: number, label: string, kind: "current" | "credit") => void run("teacher_set_mark", { groupName: group, discipline, studentName: student.name, value, label, kind }).then(onDone);
  const chips = [
    ...[2, 3, 4, 5].map((value) => ({ value, label: String(value), kind: "current" as const, mark: "Текущая" })),
    { value: 1, label: "зач.", kind: "credit" as const, mark: "Зачёт" },
    { value: 0, label: "нез.", kind: "credit" as const, mark: "Незачёт" },
  ];
  return (
    <div className={compact ? "flex flex-nowrap gap-1" : "mt-2 grid grid-cols-6 gap-1"}>
      {chips.map((chip) => (
        <button key={chip.label} type="button" className={compact ? "grade-chip grade-chip-compact" : "grade-chip"} aria-label={`${chip.mark} для ${student.name}`} onClick={() => put(chip.value, chip.mark, chip.kind)}>{chip.label}</button>
      ))}
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
