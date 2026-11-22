import { useQuery } from "@tanstack/react-query";
import { JournalScreen } from "../components/journal/JournalScreen";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { formatScore, validPoints } from "@shared/journal";
import { Chip, DueChip, EmptyLine, LessonItem, Meta, SectionHeader, StatusPill, WorkItem } from "../components/items";
import { ClipboardList, Paperclip, Search, SlidersHorizontal, X } from "lucide-react";
import { RuDateField } from "../components/journal/RuDateField";
import { fmtDate } from "../lib/format";
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
  deadline?: string;
  studentName: string;
  submittedAt?: string | null;
  submission: { status: string; statusLabel: string; score?: number | null };
  maxScore?: number;
}

const REVIEW_TABS = [
  { id: "review", label: "На проверке", short: "Проверить" },
  { id: "returned", label: "На доработке", short: "Доработка" },
  { id: "graded", label: "Проверено", short: "Готово" },
  { id: "overdue", label: "Не сдали", short: "Не сдали" },
] as const;
type ReviewTab = (typeof REVIEW_TABS)[number]["id"];
const SORTS = [["new", "Сначала новые"], ["old", "Сначала старые"], ["deadline", "По сроку"]] as const;
const PAGE = 20;

function tabOf(row: QueueItem): ReviewTab | null {
  const status = row.submission.status;
  if (status === "in_review" || status === "submitted") return "review";
  if (status === "returned") return "returned";
  if (status === "graded") return "graded";
  return null;
}

function ruToIso(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function isoToRu(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

function reviewTone(tab: ReviewTab) {
  return tab === "review" ? "amber" : tab === "returned" ? "red" : tab === "graded" ? "green" : "neutral";
}

function QueueRow({ row, tab, showTitle = true }: { row: QueueItem; tab: ReviewTab; showTitle?: boolean }) {
  const label = tab === "graded" && row.submission.score != null ? `Оценено ${formatScore(row.submission.score)}` : tab === "overdue" ? (row.submission.status === "in_progress" ? "Черновик" : "Не сдано") : tab === "returned" ? "На доработке" : "На проверке";
  const when = row.submittedAt ? row.submittedAt.slice(0, 10) : "";
  return (
    <Link to={`/teach/homework/${row.assignmentId}`} className="block min-h-11" data-agent-target={`review-${row.assignmentId}-${row.studentName}`}>
      <div className="item-row" data-ui="work">
        <div className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--tone-work) 16%, transparent)", color: "var(--tone-work)" }}>
          <ClipboardList className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div data-ui-part="title" className="t-title item-title" title={showTitle ? row.title : row.studentName}>{showTitle ? row.title : shortName(row.studentName)}</div>
          <div className="item-meta-line mt-1">
            {showTitle ? <Meta icon="user" title={row.studentName}>{shortName(row.studentName)}</Meta> : null}
            <Meta>{row.groupName}</Meta>
            {showTitle ? <Meta>{row.discipline}</Meta> : null}
          </div>
        </div>
        <div className="item-trail">
          <StatusPill tone={reviewTone(tab)}>{label}</StatusPill>
          {when ? <span className="t-chip whitespace-nowrap text-[var(--muted)]" title={fmtDate(when, "full")}>{`сдано ${fmtDate(when, "short")}`}</span> : row.deadline ? <span className="t-chip whitespace-nowrap text-[var(--muted)]">{`срок ${fmtDate(row.deadline, "short")}`}</span> : null}
        </div>
      </div>
    </Link>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button type="button" className="inline-flex min-h-11 max-w-[16rem] shrink-0 items-center gap-1 rounded-full bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-ink)]" onClick={onClear} aria-label={`Убрать фильтр ${label}`}>
      <span className="truncate">{label}</span><X className="h-4 w-4 shrink-0" aria-hidden />
    </button>
  );
}

function Pick({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option.value || "all"} type="button" aria-pressed={value === option.value} title={option.label} className={`min-h-11 max-w-full truncate rounded-full px-4 text-sm font-semibold transition active:scale-95 ${value === option.value ? "bg-[var(--primary)] text-[var(--primary-ink)]" : "bg-black/5 dark:bg-white/10"}`} onClick={() => onChange(option.value)}>{option.label}</button>
        ))}
      </div>
    </div>
  );
}

export function TeachQueue() {
  const queue = useQuery({ queryKey: ["teach-queue"], queryFn: () => api<{ queue: QueueItem[]; missing?: QueueItem[] }>("/api/teach/homework") });
  const [params, setParams] = useSearchParams();
  const tab = (REVIEW_TABS.some((item) => item.id === params.get("tab")) ? params.get("tab") : "review") as ReviewTab;
  const group = params.get("group") ?? "";
  const subject = params.get("subject") ?? "";
  const assignment = params.get("assignment") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sort = (params.get("sort") ?? (tab === "review" ? "old" : "new")) as (typeof SORTS)[number][0];
  const byWork = params.get("by") === "work";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState(false);
  const [draftFrom, setDraftFrom] = useState(isoToRu(from));
  const [draftTo, setDraftTo] = useState(isoToRu(to));
  useEffect(() => { setLimit(PAGE); }, [tab, group, subject, assignment, from, to, sort, query]);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const all = useMemo(() => {
    const data = queue.data;
    if (!data) return [] as { row: QueueItem; tab: ReviewTab }[];
    const rows = data.queue.flatMap((row) => { const t = tabOf(row); return t ? [{ row, tab: t }] : []; });
    return rows.concat((data.missing ?? []).map((row) => ({ row, tab: "overdue" as ReviewTab })));
  }, [queue.data]);
  const needle = query.trim().toLowerCase();
  const stamp = (row: QueueItem) => (row.submittedAt ?? row.deadline ?? "").slice(0, 10);
  const matches = (row: QueueItem) =>
    (!group || row.groupName === group) &&
    (!subject || row.discipline === subject) &&
    (!assignment || String(row.assignmentId) === assignment) &&
    (!needle || row.studentName.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle)) &&
    (!from || stamp(row) >= from) &&
    (!to || stamp(row) <= to);
  const filtered = all.filter((item) => matches(item.row));
  const counts = Object.fromEntries(REVIEW_TABS.map((item) => [item.id, filtered.filter((entry) => entry.tab === item.id).length])) as Record<ReviewTab, number>;
  const rows = filtered.filter((item) => item.tab === tab).map((item) => item.row).sort((a, b) =>
    sort === "deadline" ? (a.deadline ?? "").localeCompare(b.deadline ?? "") || a.studentName.localeCompare(b.studentName, "ru")
      : sort === "old" ? (a.submittedAt ?? a.deadline ?? "").localeCompare(b.submittedAt ?? b.deadline ?? "") || a.studentName.localeCompare(b.studentName, "ru")
        : (b.submittedAt ?? b.deadline ?? "").localeCompare(a.submittedAt ?? a.deadline ?? "") || a.studentName.localeCompare(b.studentName, "ru"));
  const groups = [...new Set(all.map((item) => item.row.groupName))].sort();
  const subjects = [...new Set(all.filter((item) => !group || item.row.groupName === group).map((item) => item.row.discipline))].sort();
  const works = [...new Map(all.filter((item) => (!group || item.row.groupName === group) && (!subject || item.row.discipline === subject)).map((item) => [String(item.row.assignmentId), item.row.title])).entries()];
  const workTitle = all.find((item) => String(item.row.assignmentId) === assignment)?.row.title ?? "";
  const shown = rows.slice(0, limit);
  const buckets = byWork ? [...new Map(shown.map((row) => [row.assignmentId, row.title])).entries()] : [];
  const active = [group, subject, assignment, from || to ? "dates" : ""].filter(Boolean).length;
  const empty = tab === "review" ? "Все сданные работы проверены." : tab === "returned" ? "Никто сейчас не дорабатывает работу." : tab === "graded" ? "Проверенных работ пока нет." : "Все сдали к сроку.";
  return (
    <div className="space-y-3" data-agent-target="queue">
      <BackLink to="/teach" />
      <h1 className="t-page">Проверка</h1>
      <div className="grid grid-cols-4 gap-1 rounded-[1.75rem] bg-black/5 p-1 dark:bg-white/10" role="tablist" aria-label="Статус">
        {REVIEW_TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} data-agent-target={`queue-tab-${item.id}`} className={`flex min-h-12 min-w-0 flex-col items-center justify-center rounded-3xl px-1 text-xs font-semibold leading-tight transition sm:flex-row sm:gap-1 sm:text-sm ${tab === item.id ? "bg-[var(--primary)] text-[var(--primary-ink)] shadow" : ""}`} onClick={() => update({ tab: item.id === "review" ? "" : item.id, sort: "" })}>
            <span className="max-w-full truncate"><span className="sm:hidden">{item.short}</span><span className="hidden sm:inline">{item.label}</span></span>
            <span className="tabular-nums opacity-80">{queue.isLoading ? "·" : counts[item.id]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-nowrap items-center gap-2">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Поиск по студенту или работе</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
          <input className="field h-11" style={{ paddingLeft: "2.5rem" }} type="search" placeholder="Студент или работа" value={query} onChange={(event) => { setQuery(event.target.value); update({ q: event.target.value }); }} />
        </label>
        <button type="button" className="btn btn-glass relative h-11 shrink-0 gap-1 px-3" onClick={() => { setDraftFrom(isoToRu(from)); setDraftTo(isoToRu(to)); setSheet(true); }} aria-label="Фильтры и сортировка">
          <SlidersHorizontal className="h-4 w-4" aria-hidden /><span className="hidden min-[400px]:inline">Фильтры</span>
          {active ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--primary)] px-1 text-[11px] text-[var(--primary-ink)]">{active}</span> : null}
        </button>
      </div>
      {active ? (
        <div className="chip-row flex gap-2 overflow-x-auto pb-1" data-scroll-x="">
          {group ? <FilterChip label={group} onClear={() => update({ group: "", subject: "", assignment: "" })} /> : null}
          {subject ? <FilterChip label={subject} onClear={() => update({ subject: "", assignment: "" })} /> : null}
          {assignment ? <FilterChip label={workTitle || "Работа"} onClear={() => update({ assignment: "" })} /> : null}
          {from || to ? <FilterChip label={`${from ? fmtDate(from, "short") : "…"} — ${to ? fmtDate(to, "short") : "…"}`} onClear={() => update({ from: "", to: "" })} /> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="t-meta min-h-11 whitespace-nowrap" onClick={() => setSheet(true)}>{SORTS.find(([id]) => id === sort)?.[1]}</button>
        <button type="button" aria-pressed={byWork} className={`min-h-11 rounded-full px-3 text-sm font-semibold ${byWork ? "bg-[var(--primary)] text-[var(--primary-ink)]" : "bg-black/5 dark:bg-white/10"}`} onClick={() => update({ by: byWork ? "" : "work" })}>По работам</button>
      </div>
      {queue.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-16 w-full rounded-3xl" />)}
        </div>
      ) : queue.error ? (
        <ErrorState text="Очередь не загрузилась" onRetry={() => void queue.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={active || needle ? "Ничего не нашлось" : "Пусто"} text={active || needle ? "Измените фильтры или поиск." : empty} action={active || needle ? <button type="button" className="btn btn-glass h-11 px-4" onClick={() => { setQuery(""); update({ group: "", subject: "", assignment: "", from: "", to: "", q: "" }); }}>Сбросить фильтры</button> : undefined} />
      ) : byWork ? (
        buckets.map(([id, title]) => {
          const part = shown.filter((row) => row.assignmentId === id);
          return (
            <section key={id} className="space-y-2">
              <SectionHeader title={title} count={part.length} action={<Link className="t-chip inline-flex min-h-11 shrink-0 items-center" to={`/teach/homework/${id}`}>Открыть</Link>} />
              <Glass><div className="work-stack">{part.map((row) => <QueueRow key={`${row.assignmentId}-${row.studentName}`} row={row} tab={tab} showTitle={false} />)}</div></Glass>
            </section>
          );
        })
      ) : (
        <Glass><div className="work-stack">{shown.map((row) => <QueueRow key={`${row.assignmentId}-${row.studentName}`} row={row} tab={tab} />)}</div></Glass>
      )}
      {rows.length > shown.length ? (
        <Button variant="glass" className="h-11 w-full" onClick={() => setLimit((current) => current + PAGE)}>{`Показать ещё (${rows.length - shown.length})`}</Button>
      ) : null}
      {sheet ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 md:items-center" onClick={() => setSheet(false)}>
          <div role="dialog" aria-label="Фильтры" className="max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-[var(--surface-solid)] p-4 md:rounded-3xl" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">Фильтры</p>
              <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Закрыть" onClick={() => setSheet(false)}><X className="h-5 w-5" aria-hidden /></button>
            </div>
            {groups.length > 1 ? <Pick label="Группа" value={group} options={[{ value: "", label: "Все" }, ...groups.map((name) => ({ value: name, label: name }))]} onChange={(value) => update({ group: value, subject: "", assignment: "" })} /> : null}
            {subjects.length > 1 ? <Pick label="Предмет" value={subject} options={[{ value: "", label: "Все" }, ...subjects.map((name) => ({ value: name, label: name }))]} onChange={(value) => update({ subject: value, assignment: "" })} /> : null}
            <Pick label="Работа" value={assignment} options={[{ value: "", label: "Все" }, ...works.map(([id, title]) => ({ value: id, label: title }))]} onChange={(value) => update({ assignment: value })} />
            <div>
              <p className="text-sm font-semibold">Дата сдачи</p>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <RuDateField label="С" value={draftFrom} onChange={setDraftFrom} />
                <RuDateField label="По" value={draftTo} onChange={setDraftTo} />
              </div>
            </div>
            <Pick label="Сортировка" value={sort} options={SORTS.map(([id, label]) => ({ value: id, label }))} onChange={(value) => update({ sort: value })} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="glass" className="h-11" onClick={() => { setDraftFrom(""); setDraftTo(""); update({ group: "", subject: "", assignment: "", from: "", to: "", sort: "" }); }}>Сбросить</Button>
              <Button className="h-11" onClick={() => { update({ from: ruToIso(draftFrom), to: ruToIso(draftTo) }); setSheet(false); }}>Готово</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface IssuedCounts { total: number; turnedIn: number; review: number; graded: number; returned: number; inProgress: number }
interface Issued {
  id: number;
  title: string;
  discipline: string;
  groupName: string;
  kind: string;
  kindLabel: string;
  deadline: string;
  issuedOn: string;
  overdue: boolean;
  attachments: number;
  counts: IssuedCounts;
}

function AssignTabs({ active }: { active: "issued" | "new" }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Задания">
      <Link to="/teach/assignments" role="tab" aria-selected={active === "issued"} className={`btn h-11 min-w-0 px-2 text-sm ${active === "issued" ? "btn-primary" : "btn-glass"}`}>Выданные</Link>
      <Link to="/teach/assign" role="tab" aria-selected={active === "new"} className={`btn h-11 min-w-0 px-2 text-sm ${active === "new" ? "btn-primary" : "btn-glass"}`}>Новое задание</Link>
    </div>
  );
}

function IssuedRow({ row, marked = false }: { row: Issued; marked?: boolean }) {
  const { counts } = row;
  return (
    <Link to={`/teach/homework/${row.id}?from=list`} className={`block min-h-11 rounded-2xl transition-colors ${marked ? "issued-hl" : ""}`} data-agent-target={`assignment-${row.id}`} aria-current={marked ? "true" : undefined}>
      <div className="item-row" data-ui="work">
        <div className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--tone-work) 16%, transparent)", color: "var(--tone-work)" }}>
          <ClipboardList className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div data-ui-part="title" className="t-title item-title" title={row.title}>{row.title}</div>
          <div className="item-meta-line mt-1">
            <Chip tone="work">{row.kindLabel}</Chip>
            <Meta>{row.groupName}</Meta>
            <Meta>{row.discipline}</Meta>
          </div>
          <div className="item-meta-line mt-1">
            <span className="t-meta whitespace-nowrap">Сдали {counts.turnedIn} из {counts.total}</span>
            {counts.review ? <StatusPill tone="amber">{`На проверке ${counts.review}`}</StatusPill> : null}
            {counts.returned ? <StatusPill tone="red">{`На доработке ${counts.returned}`}</StatusPill> : null}
          </div>
        </div>
        <div className="item-trail">
          <DueChip due={row.deadline} />
          <StatusPill tone={row.overdue ? "neutral" : "green"}>{row.overdue ? "Срок прошёл" : "Активно"}</StatusPill>
        </div>
      </div>
    </Link>
  );
}

const ISSUED_FILTERS = [["all", "Все"], ["active", "Активные"], ["past", "Срок прошёл"]] as const;

export function TeachAssignments() {
  const list = useQuery({ queryKey: ["teach-assignments"], queryFn: () => api<{ assignments: Issued[] }>("/api/teach/assignments") });
  const [params, setParams] = useSearchParams();
  const fresh = params.get("hl") || "";
  useEffect(() => {
    if (!fresh) return;
    const timer = window.setTimeout(() => document.querySelector(`[data-agent-target="assignment-${fresh}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
    return () => window.clearTimeout(timer);
  }, [fresh, list.data]);
  const status = (params.get("status") ?? "all") as (typeof ISSUED_FILTERS)[number][0];
  const group = params.get("group") ?? "";
  const subject = params.get("subject") ?? "";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(key, value); else next.delete(key);
    if (key === "group") next.delete("subject");
    setParams(next, { replace: true });
  };
  const all = list.data?.assignments ?? [];
  const groups = useMemo(() => [...new Set(all.map((row) => row.groupName))].sort(), [all]);
  const subjects = useMemo(() => [...new Set(all.filter((row) => !group || row.groupName === group).map((row) => row.discipline))].sort(), [all, group]);
  const needle = query.trim().toLowerCase();
  const rows = all.filter((row) =>
    (status === "all" || (status === "active" ? !row.overdue : row.overdue)) &&
    (!group || row.groupName === group) &&
    (!subject || row.discipline === subject) &&
    (!needle || `${row.title} ${row.discipline} ${row.groupName} ${row.kindLabel}`.toLowerCase().includes(needle)));
  const active = rows.filter((row) => !row.overdue);
  const past = rows.filter((row) => row.overdue).sort((a, b) => b.deadline.localeCompare(a.deadline) || b.id - a.id);
  const reviewTotal = all.reduce((sum, row) => sum + row.counts.review, 0);
  return (
    <div className="space-y-4" data-agent-target="assignments">
      <BackLink to="/teach" />
      <h1 className="t-page">Задания</h1>
      <AssignTabs active="issued" />
      {list.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-20 w-full rounded-3xl" />)}
        </div>
      ) : list.error ? (
        <ErrorState text="Задания не загрузились" onRetry={() => void list.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title="Вы ещё не выдавали заданий" text="Выданные задания появятся здесь вместе с тем, кто уже сдал работу." action={<Link to="/teach/assign" className="btn btn-primary inline-flex h-11 px-4">Выдать задание</Link>} />
      ) : (
        <>
          {reviewTotal ? (
            <Link to="/teach/homework" className="liquid-glass flex min-h-11 items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="font-semibold">Ждут проверки: {reviewTotal}</span>
              <span className="t-chip">Проверить</span>
            </Link>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {ISSUED_FILTERS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={status === id} className={`btn h-11 min-w-0 whitespace-nowrap px-1 text-[13px] ${status === id ? "btn-primary" : "btn-glass"}`} onClick={() => update("status", id)}>{label}</button>
            ))}
          </div>
          {groups.length > 1 ? (
            <div className="chip-row flex gap-2 overflow-x-auto pb-1" data-scroll-x="">
              {["", ...groups].map((name) => (
                <button key={name || "all"} type="button" aria-pressed={group === name} className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition active:scale-95 ${group === name ? "bg-[var(--primary)] text-[var(--primary-ink)]" : "border border-white/40 bg-white/40"}`} onClick={() => update("group", name)}>{name || "Все группы"}</button>
              ))}
            </div>
          ) : null}
          {subjects.length > 1 ? (
            <div className="chip-row flex gap-2 overflow-x-auto pb-1" data-scroll-x="">
              {["", ...subjects].map((name) => (
                <button key={name || "all"} type="button" aria-pressed={subject === name} className={`min-h-11 max-w-[16rem] shrink-0 truncate whitespace-nowrap rounded-full px-4 text-sm font-semibold transition active:scale-95 ${subject === name ? "bg-[var(--primary)] text-[var(--primary-ink)]" : "border border-white/40 bg-white/40"}`} title={name || "Все предметы"} onClick={() => update("subject", name)}>{name || "Все предметы"}</button>
              ))}
            </div>
          ) : null}
          <label className="relative block">
            <span className="sr-only">Поиск по заданиям</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
            <input className="field h-11" style={{ paddingLeft: "2.5rem" }} type="search" placeholder="Название, предмет, группа" value={query} onChange={(event) => { setQuery(event.target.value); update("q", event.target.value); }} />
          </label>
          {rows.length === 0 ? <EmptyState title="Ничего не нашлось" text="Измените фильтр или поиск." /> : null}
          {active.length ? (
            <section className="space-y-2">
              <SectionHeader title="Активные" count={active.length} />
              <Glass><div className="work-stack">{active.map((row) => <IssuedRow key={row.id} row={row} marked={String(row.id) === fresh} />)}</div></Glass>
            </section>
          ) : null}
          {past.length ? (
            <section className="space-y-2">
              <SectionHeader title="Срок прошёл" count={past.length} />
              <Glass><div className="work-stack">{past.map((row) => <IssuedRow key={row.id} row={row} marked={String(row.id) === fresh} />)}</div></Glass>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function TeachAssignment() {
  const { id = "" } = useParams();
  const detail = useQuery({
    queryKey: ["teach-assignment", id],
    queryFn: () => api<{ assignment: { id: number; title: string; description: string; groupName: string; discipline: string; kind: string; kindLabel?: string; deadline?: string; issuedOn?: string; overdue?: boolean; attachments?: { title: string; href: string }[]; counts?: IssuedCounts; maxPoints?: number; students: { name: string; submission: { statusLabel: string; body: string; status: string; score: number | null; teacherComment: string | null } }[] } }>(`/api/teach/homework/${id}`),
  });
  const [error, setError] = useState("");
  const [params] = useSearchParams();
  const back = params.get("from") === "list" ? "/teach/assignments" : "/teach/homework";
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
      <BackLink to={back} />
      <h1 className="t-page item-title" title={assignment.title}>{assignment.title}</h1>
      <p className="t-meta">{assignment.groupName}</p>
      <p className="t-meta">{assignment.discipline}</p>
      {assignment.deadline ? (
        <Glass target="assignment-facts">
          <div className="flex flex-wrap items-center gap-2">
            {assignment.kindLabel ? <Chip tone="work">{assignment.kindLabel}</Chip> : null}
            <StatusPill tone={assignment.overdue ? "neutral" : "green"}>{assignment.overdue ? "Срок прошёл" : "Активно"}</StatusPill>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="min-w-0"><dt className="t-muted">Срок</dt><dd className="t-title whitespace-nowrap">{fmtDate(assignment.deadline, "day")}</dd></div>
            {assignment.issuedOn ? <div className="min-w-0"><dt className="t-muted">Выдано</dt><dd className="t-title whitespace-nowrap">{fmtDate(assignment.issuedOn, "day")}</dd></div> : null}
            {assignment.counts ? <div className="min-w-0"><dt className="t-muted">Сдали</dt><dd className="t-title whitespace-nowrap">{assignment.counts.turnedIn} из {assignment.counts.total}</dd></div> : null}
            {assignment.counts ? <div className="min-w-0"><dt className="t-muted">На проверке</dt><dd className="t-title whitespace-nowrap">{assignment.counts.review}</dd></div> : null}
          </dl>
          {assignment.counts ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn btn-glass inline-flex h-11 px-3 text-sm" to={`/teach/homework?assignment=${assignment.id}`}>{`Проверка по работе${assignment.counts.review ? ` · ${assignment.counts.review}` : ""}`}</Link>
              {assignment.overdue && assignment.counts.total - assignment.counts.turnedIn - assignment.counts.returned > 0 ? <Link className="btn btn-glass inline-flex h-11 px-3 text-sm" to={`/teach/homework?assignment=${assignment.id}&tab=overdue`}>{`Не сдали · ${assignment.counts.total - assignment.counts.turnedIn - assignment.counts.returned}`}</Link> : null}
            </div>
          ) : null}
          {assignment.counts && assignment.counts.total ? (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--line)]" aria-hidden>
              <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.round((assignment.counts.turnedIn / assignment.counts.total) * 100)}%` }} />
            </div>
          ) : null}
        </Glass>
      ) : null}
      <Glass><p className="text-sm" data-ui-allow-latin="">{assignment.description}</p>
        {assignment.attachments?.length ? (
          <ul className="mt-3 space-y-1">
            {assignment.attachments.map((file) => (
              <li key={file.href}><a className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold" href={file.href} target="_blank" rel="noreferrer"><Paperclip className="h-4 w-4" aria-hidden />{file.title}</a></li>
            ))}
          </ul>
        ) : null}
      </Glass>
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
      <h1>Задания</h1>
      <AssignTabs active="new" />
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
