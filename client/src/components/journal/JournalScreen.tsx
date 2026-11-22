import { useQuery, useQueryClient } from "@tanstack/react-query";
import { moscowToday } from "@shared/dates";
import { WORK_TYPES, formatPercent, journalDateLabel, journalDates, monthBounds, parseJournalFocus, semesterBounds, shiftPeriod, validPoints, weekBounds, workRuleError, type WorkType } from "@shared/journal";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAction } from "../../lib/action";
import { BackLink, Button, Choice, EmptyState, ErrorState, LoadingBlock } from "../ui";
import { scrollCellIntoView } from "../../lib/operator";
import { RuDateField } from "./RuDateField";

interface Column { id: number; date: string; workType: string; short: string; title: string; maxScore: number; maxPoints?: number; weight: number; scheduleItemId: number | null; position?: number; virtual?: boolean; ghostKey?: boolean }
interface Student { id: number; name: string; short: string; automatic: string | null; finalText: string | null; marks: { label: string; value: number | null }[]; attendance: { date: string; present: boolean }[] }
interface Cell { markId: number; studentId: number; columnId: number | null; value: number | null; comment: string | null }
interface Visit { studentId: number; date: string; status: string }
interface Lesson { date: string; kind: string; topic: string | null; cancelled: boolean; startsAt: string; scheduleItemId?: number }
interface Payload {
  groupName: string;
  discipline: string;
  readOnly: boolean;
  period: { from: string; to: string; label: string };
  lessons: Lesson[];
  columns: Column[];
  students: Student[];
  cells: Cell[];
  attendance: Visit[];
  averages: Record<string, { simple: number | null; weighted: number | null; percent?: number | null; earned?: number; possible?: number; grade?: string | null }>;
  scheme?: { defaults: Record<string, { maxPoints: number; weight: number }>; excellent: number; good: number; satisfactory: number };
}

const TONES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-950",
  orange: "bg-orange-100 text-orange-950",
  blue: "bg-sky-100 text-sky-950",
  sky: "bg-cyan-100 text-cyan-950",
  violet: "bg-violet-100 text-violet-950",
  red: "bg-rose-100 text-rose-950",
  slate: "bg-slate-200 text-slate-900",
};

function gradeTone(value: number | null, max = 10) {
  if (value == null) return "bg-[var(--surface-solid)] text-[var(--ink)]";
  const ratio = (value / Math.max(max, 1)) * 100;
  if (ratio >= 85) return "bg-emerald-200 text-emerald-950";
  if (ratio >= 70) return "bg-sky-200 text-sky-950";
  if (ratio >= 55) return "bg-amber-200 text-amber-950";
  return "bg-rose-200 text-rose-950";
}

function ruleFor(data: Payload, workType: string) {
  return data.scheme?.defaults?.[workType] ?? { maxPoints: 10, weight: WORK_TYPES[workType as WorkType]?.weight ?? 1 };
}

function ru(value: number | null) {
  if (value == null) return "—";
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function JournalScreen({ readOnly = false, endpoint = "/api/teach/journal" }: { readOnly?: boolean; endpoint?: string }) {
  const [params, setParams] = useSearchParams();
  const home = useQuery({ queryKey: ["teach"], queryFn: () => api<{ groups: { groupName: string; discipline: string }[] }>("/api/teach/home"), enabled: !readOnly });
  const groups = home.data?.groups ?? (readOnly ? [
    { groupName: "БИ-3-26-04", discipline: "Базы данных" },
    { groupName: "БИ-3-26-04", discipline: "Программирование" },
    { groupName: "ЮР-1-26-02", discipline: "Информационные технологии в юридической деятельности" },
  ] : []);
  const group = params.get("group") || groups[0]?.groupName || "";
  const discipline = params.get("discipline") || groups.find((row) => row.groupName === group)?.discipline || "";
  const bounds = monthBounds();
  const from = params.get("from") || bounds.from;
  const to = params.get("to") || bounds.to;
  const focus = params.get("focus") || "";
  const mode = params.get("mode") === "lesson" ? "lesson" : "table";
  const journal = useQuery({
    queryKey: ["journal", group, discipline, from, to, readOnly],
    queryFn: () => api<Payload>(`${endpoint}?group=${encodeURIComponent(group)}&discipline=${encodeURIComponent(discipline)}&from=${from}&to=${to}`),
    enabled: Boolean(group && discipline),
  });
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) next.set(key, value);
    setParams(next);
  };
  useEffect(() => {
    if (!params.get("group") && group) set({ group, discipline, from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, discipline]);
  useEffect(() => {
    if (!journal.data) return;
    window.dispatchEvent(new CustomEvent("altair-page-ready", { detail: { page: "journal" } }));
  }, [journal.data]);
  if (!readOnly && home.isLoading && !group) return <LoadingBlock />;
  if (journal.isLoading) {
    return (
      <div className="space-y-4" data-agent-target="journal">
        <h1>Журнал</h1>
        <div className="grid grid-cols-4 gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10" aria-hidden>
          {["Неделя", "Месяц", "Семестр", "Даты"].map((label) => <div key={label} className="h-11 rounded-full" />)}
        </div>
        <div className="space-y-2" aria-busy="true" aria-label="Журнал загружается">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-11 w-full rounded-2xl" />)}
        </div>
      </div>
    );
  }
  if (journal.error || !journal.data) return <ErrorState text="Журнал недоступен" onRetry={() => void journal.refetch()} />;
  const data = journal.data;
  return (
    <div className="space-y-4" data-agent-target="journal">
      {readOnly ? null : <BackLink to="/teach" />}
      <h1>Журнал</h1>
      <Choice label="Группа" value={data.groupName} options={[...new Set((groups.length ? groups : [{ groupName: data.groupName }]).map((row) => row.groupName))].map((name) => ({ value: name, label: name }))} onChange={(value) => set({ group: value, discipline: "" })} />
      <Choice label="Предмет" value={data.discipline} options={(groups.filter((row) => row.groupName === data.groupName).length ? groups.filter((row) => row.groupName === data.groupName) : [{ discipline: data.discipline }]).map((row) => ({ value: row.discipline, label: row.discipline }))} onChange={(value) => set({ discipline: value })} />
      <PeriodBar from={from} to={to} onChange={(nextFrom, nextTo) => set({ from: nextFrom, to: nextTo })} />
      <div className="grid grid-cols-2 gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10" role="group" aria-label="Вид журнала">
        <button type="button" className={`h-11 whitespace-nowrap rounded-full px-3 text-sm font-semibold ${mode === "table" ? "bg-[var(--primary)] text-[var(--primary-ink)]" : ""}`} data-agent-action="journal-period" aria-pressed={mode === "table"} onClick={() => set({ mode: "table" })}>Таблица</button>
        <button type="button" className={`h-11 whitespace-nowrap rounded-full px-3 text-sm font-semibold ${mode === "lesson" ? "bg-[var(--primary)] text-[var(--primary-ink)]" : ""}`} aria-pressed={mode === "lesson"} onClick={() => set({ mode: "lesson" })}>Пары</button>
      </div>
      <div className="flex flex-nowrap items-center gap-2">
        {readOnly ? null : <AddColumn group={data.groupName} discipline={data.discipline} scheme={data.scheme} onDone={() => void journal.refetch()} />}
        <GradingDialog group={data.groupName} discipline={data.discipline} scheme={data.scheme} endpoint={endpoint} readOnly={readOnly} onDone={() => void journal.refetch()} />
      </div>
      <p className="flex flex-wrap gap-1 text-xs text-[var(--muted)]">{Object.entries(WORK_TYPES).map(([key, item]) => <span key={key} className={`rounded-full px-2 py-1 ${TONES[item.tone]}`}>{item.short}</span>)} <span>Н — нет, Б — болел, О — опоздал, У — уважительная</span></p>
      {data.students.length === 0 && data.lessons.length === 0 && data.columns.length === 0 ? <EmptyState title="В этом периоде пар нет" text="Покажите семестр целиком." action={<Button onClick={() => { const term = semesterBounds(); set({ from: term.from, to: term.to }); }}>Показать семестр</Button>} /> : mode === "lesson" ? <LessonMode data={data} readOnly={readOnly} onDone={() => void journal.refetch()} /> : <Grid data={data} focus={focus} studentFocus={params.get("student") || ""} marked={params.get("hl") || ""} readOnly={readOnly} onDone={() => void journal.refetch()} />}
    </div>
  );
}

const RANGE_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function periodMode(from: string, to: string) {
  const term = semesterBounds(from);
  if (from === term.from && to === term.to) return "term";
  const month = monthBounds(from);
  if (from === month.from && to === month.to) return "month";
  const week = weekBounds(from);
  if (from === week.from && to === week.to) return "week";
  return "custom";
}

function compactRange(from: string, to: string) {
  const day = (iso: string) => Number(iso.slice(8, 10));
  const month = (iso: string) => RANGE_MONTHS[Number(iso.slice(5, 7)) - 1];
  if (from.slice(0, 7) === to.slice(0, 7)) return `${day(from)}–${day(to)}\u00A0${month(from)}`;
  return `${day(from)}\u00A0${month(from)}–${day(to)}\u00A0${month(to)}`;
}

function ruInput(iso: string) {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function parseRuInput(value: string) {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return iso;
}

function PeriodBar({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [sheet, setSheet] = useState(false);
  const [start, setStart] = useState(ruInput(from));
  const [end, setEnd] = useState(ruInput(to));
  const [error, setError] = useState("");
  const mode = periodMode(from, to);
  const shift = (dir: number) => {
    const next = shiftPeriod(from, to, dir);
    onChange(next.from, next.to);
  };
  const openDates = () => {
    setStart(ruInput(from));
    setEnd(ruInput(to));
    setError("");
    setSheet(true);
  };
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const nextFrom = parseRuInput(start);
    const nextTo = parseRuInput(end);
    if (!nextFrom || !nextTo || nextFrom > nextTo) { setError("Даты в виде дд.мм.гггг, начало не позже конца"); return; }
    onChange(nextFrom, nextTo);
    setSheet(false);
  };
  const modes = [
    ["week", "Неделя", () => { const week = weekBounds(moscowToday()); onChange(week.from, week.to); }],
    ["month", "Месяц", () => { const month = monthBounds(); onChange(month.from, month.to); }],
    ["term", "Семестр", () => { const term = semesterBounds(); onChange(term.from, term.to); }],
    ["custom", "Даты", openDates],
  ] as const;
  return (
    <>
    <div className="space-y-2" data-journal-toolbar>
      <div className="grid grid-cols-4 gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10" data-toolbar-row role="group" aria-label="Период">
        {modes.map(([id, label, pick]) => (
          <button key={id} type="button" className={`h-11 whitespace-nowrap rounded-full px-1 text-sm font-semibold ${mode === id ? "bg-[var(--primary)] text-[var(--primary-ink)]" : ""}`} aria-pressed={mode === id} onClick={pick}>{label}</button>
        ))}
      </div>
      <div className="flex flex-nowrap items-center gap-2" data-toolbar-row>
        <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/5 dark:bg-white/10" aria-label="Раньше" onClick={() => shift(-1)}><ChevronLeft className="h-5 w-5" aria-hidden /></button>
        <span className="min-w-0 flex-1 whitespace-nowrap text-center text-sm font-semibold" data-ui="lesson" title={compactRange(from, to)}>{compactRange(from, to)}</span>
        <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/5 dark:bg-white/10" aria-label="Дальше" onClick={() => shift(1)}><ChevronRight className="h-5 w-5" aria-hidden /></button>
      </div>
    </div>
      {sheet ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={() => setSheet(false)}>
          <form role="dialog" aria-label="Свои даты" className="w-full max-w-md rounded-t-3xl bg-[var(--surface-solid)] p-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }} onClick={(event) => event.stopPropagation()} onSubmit={apply}>
            <p className="font-semibold">Свои даты</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <RuDateField label="С" value={start} onChange={(next) => { setStart(next); setError(""); }} />
              <RuDateField label="По" value={end} onChange={(next) => { setEnd(next); setError(""); }} />
            </div>
            {error ? <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p> : null}
            <div className="mt-3 flex gap-2">
              <Button className="h-11 flex-1">Показать</Button>
              <button type="button" className="btn btn-quiet h-11 px-3" onClick={() => setSheet(false)}>Закрыть</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function AddColumn({ group, discipline, scheme, onDone }: { group: string; discipline: string; scheme?: Payload["scheme"]; onDone: () => void }) {
  const run = useAction();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const [date, setDate] = useState(ruInput(moscowToday()));
  const [workType, setWorkType] = useState<WorkType>("control");
  const [title, setTitle] = useState("Контрольная");
  const initial = scheme?.defaults?.control ?? { maxPoints: 10, weight: WORK_TYPES.control.weight };
  const [maxPoints, setMaxPoints] = useState(String(initial.maxPoints));
  const [weight, setWeight] = useState(String(initial.weight));
  const [error, setError] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const pickType = (next: WorkType) => {
    const found = scheme?.defaults?.[next] ?? { maxPoints: 10, weight: WORK_TYPES[next].weight };
    setWorkType(next);
    setTitle(WORK_TYPES[next].label);
    setMaxPoints(String(found.maxPoints));
    setWeight(String(found.weight));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const iso = parseRuInput(date);
    const problem = !iso ? "Дата в виде дд.мм.гггг" : workRuleError(maxPoints, weight);
    if (problem) { setError(problem); return; }
    void run("teacher_add_journal_column", { groupName: group, discipline, date: iso, workType, title, maxPoints: Number(maxPoints.replace(",", ".")), weight: Number(weight.replace(",", ".")) }).then(() => { setOpen(false); onDone(); }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Не получилось сохранить"));
  };
  const form = (
    <form className="space-y-3" onSubmit={submit}>
      <p className="font-semibold">Новая работа</p>
      <RuDateField block label="Дата работы" caption="Дата" value={date} required onChange={(next) => { setDate(next); setError(""); }} />
      <label className="block text-sm font-semibold">Тип<select className="field mt-1 h-11" value={workType} onChange={(event) => pickType(event.target.value as WorkType)}>{Object.entries(WORK_TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
      <label className="block text-sm font-semibold">Название<input className="field mt-1" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Название" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Макс.<input className="field mt-1 h-11" inputMode="numeric" aria-label="Максимум баллов" value={maxPoints} onChange={(event) => { setMaxPoints(event.target.value); setError(""); }} /></label>
        <label className="text-sm font-semibold">Вес<input className="field mt-1 h-11" inputMode="decimal" aria-label="Вес" value={weight} onChange={(event) => { setWeight(event.target.value); setError(""); }} /></label>
      </div>
      {error ? <p className="text-sm text-rose-700" role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <Button className="h-11 flex-1">Добавить</Button>
        <button type="button" className="btn btn-quiet h-11 px-3" onClick={() => setOpen(false)}>Закрыть</button>
      </div>
    </form>
  );
  return (
    <div className="relative">
      <Button variant="glass" className="h-11 whitespace-nowrap px-3" data-agent-action="journal-add-column" onClick={() => setOpen(true)}>+ Работа</Button>
      {open && wide ? <div role="dialog" aria-label="Новая работа" className="absolute right-0 z-40 mt-2 w-80 rounded-3xl bg-[var(--surface-solid)] p-4 shadow-2xl">{form}</div> : null}
      {open && !wide ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label="Новая работа" className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[var(--surface-solid)] p-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }} onClick={(event) => event.stopPropagation()}>{form}</div>
        </div>
      ) : null}
    </div>
  );
}

function viewColumns(data: Payload, focus: string): Column[] {
  const ghost = parseJournalFocus(focus);
  const list: Column[] = data.columns.map((column) => ({ ...column }));
  for (const date of journalDates(data.columns.map((column) => column.date), data.lessons.map((lesson) => lesson.date))) {
    if (list.some((column) => column.date === date)) continue;
    const lesson = data.lessons.find((row) => row.date === date);
    const lessonType = lesson?.kind === "lab" ? "lab" : lesson?.kind === "seminar" ? "seminar" : "current";
    const lessonRule = ruleFor(data, lessonType);
    list.push({ id: 0, date, workType: lessonType, short: lesson?.kind === "lab" ? "Лаб" : lesson?.kind === "seminar" ? "Сем" : lesson?.kind === "lecture" ? "Лек" : "Пара", title: lesson?.topic || "Пара", maxScore: lessonRule.maxPoints, maxPoints: lessonRule.maxPoints, weight: lessonRule.weight, scheduleItemId: lesson?.scheduleItemId ?? null, position: -1, virtual: true });
  }
  if (ghost && !list.some((column) => column.ghostKey && column.date === ghost.date && column.workType === ghost.workType)) {
    const meta = WORK_TYPES[ghost.workType as WorkType];
    const rule = ruleFor(data, ghost.workType);
    const maxPoints = ghost.maxPoints || rule.maxPoints;
    const weight = ghost.weight || rule.weight;
    list.push({ id: 0, date: ghost.date, workType: ghost.workType, short: meta?.short ?? ghost.workType, title: meta?.label ?? "Работа", maxScore: maxPoints, maxPoints, weight, scheduleItemId: null, position: 50, virtual: true, ghostKey: true });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date) || (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
}

function Grid({ data, focus, studentFocus, marked = "", readOnly, onDone }: { data: Payload; focus: string; studentFocus: string; marked?: string; readOnly: boolean; onDone: () => void }) {
  const picked = new Set(marked.split(",").filter(Boolean).map(Number));
  const [cell, setCell] = useState<string | null>(null);
  const columns = viewColumns(data, focus);
  const today = moscowToday();
  useEffect(() => {
    if (document.body.dataset.operator === "1") return;
    const selector = studentFocus && focus ? `[data-agent-cell="${studentFocus}:${focus}"]` : "";
    const node = selector ? document.querySelector(selector) : null;
    const grid = node?.closest("[data-scroll-x]");
    if (node instanceof HTMLElement && grid instanceof HTMLElement) scrollCellIntoView(node, grid);
  }, [focus, studentFocus, columns.length]);
  useEffect(() => {
    const first = marked.split(",").filter(Boolean)[0];
    if (!first) return;
    const timer = window.setTimeout(() => {
      const row = document.querySelector(`[data-agent-target="journal-row-${first}"]`);
      if (row instanceof HTMLElement) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [marked, data.students.length]);
  useEffect(() => {
    const open = (event: Event) => setCell((event as CustomEvent<{ id: string }>).detail.id);
    const close = () => setCell(null);
    window.addEventListener("altair-open-cell", open);
    window.addEventListener("altair-close-cell", close);
    return () => {
      window.removeEventListener("altair-open-cell", open);
      window.removeEventListener("altair-close-cell", close);
    };
  }, []);
  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-[1.5rem] border border-black/5" data-scroll-x>
      <table className="min-w-max border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 w-[7.5rem] bg-[var(--surface-solid)] px-2 py-2 text-left md:w-48">Студент</th>
            {columns.map((column) => <ColumnHead key={`${column.date}-${column.id}-${column.workType}-${column.virtual ? "v" : "c"}`} column={column} lesson={data.lessons.find((row) => row.date === column.date)} today={column.date === today} readOnly={readOnly} group={data.groupName} discipline={data.discipline} cells={data.cells} onDone={onDone} onActivate={() => setCell(null)} />)}
            <th className="sticky right-0 z-30 bg-[var(--surface-solid)] px-2 py-2" title="Итог за семестр">%</th>
          </tr>
        </thead>
        <tbody>
          {data.students.map((student) => (
            <tr key={student.id} data-agent-target={`journal-row-${student.id}`} className={picked.has(student.id) ? "agent-row-hl" : undefined} aria-current={picked.has(student.id) ? "true" : undefined}>
              <th className="sticky left-0 z-10 whitespace-nowrap bg-[var(--surface-solid)] px-2 py-1 text-left font-semibold" scope="row" title={student.name}>{student.short}</th>
              {columns.map((column) => {
                const found = column.id ? data.cells.find((item) => item.studentId === student.id && item.columnId === column.id) : undefined;
                const visit = data.attendance.find((item) => item.studentId === student.id && item.date === column.date);
                const key = column.ghostKey ? focus : column.virtual ? `lesson|${column.date}|${column.workType}` : String(column.id);
                const id = `${student.id}:${key}`;
                const max = column.maxPoints ?? column.maxScore ?? 10;
                return <td key={id} className="px-1 py-1"><button type="button" data-agent-action="journal-cell" data-agent-cell={id} className={`grid h-11 min-w-11 place-items-center rounded-xl text-sm font-semibold ${gradeTone(found?.value ?? null, max)} ${column.virtual ? "border border-dashed" : ""}`} aria-label={`${student.short}, ${column.date.slice(8, 10)}.${column.date.slice(5, 7)} ${column.title}: ${found?.value ?? "пусто"}`} onClick={() => setCell(id)}>{found?.value ?? ""}{visit && visit.status !== "present" ? <sup className="text-[10px]">{visit.status === "absent" ? "Н" : visit.status === "sick" ? "Б" : visit.status === "late" ? "О" : "У"}</sup> : null}</button></td>;
              })}
              <td className="sticky right-0 bg-[var(--surface-solid)] px-2 text-center" data-ui="grade" title="Итог за семестр"><span data-ui-part="value" className="t-value inline-grid h-11 min-w-11 place-items-center rounded-2xl px-1" style={{ background: "var(--g-4)", color: "var(--g-4-fg)" }}>{data.averages[student.id]?.percent == null ? "—" : formatPercent(data.averages[student.id]?.percent ?? null)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div aria-hidden className="w-full shrink-0" style={{ height: "var(--agent-sheet-h, 0px)" }} />
      {cell ? <CellDialog id={cell} data={data} readOnly={readOnly} onClose={() => setCell(null)} onDone={onDone} /> : null}
    </div>
  );
}

function ColumnHead({ column, lesson, today, readOnly, group, discipline, cells, onDone, onActivate }: { column: Column; lesson?: Lesson; today: boolean; readOnly: boolean; group: string; discipline: string; cells: Cell[]; onDone: () => void; onActivate?: () => void }) {
  const [open, setOpen] = useState(false);
  const tone = TONES[WORK_TYPES[column.workType as WorkType]?.tone ?? "slate"];
  const caption = [column.title, lesson?.topic].filter(Boolean).join(" · ");
  return (
    <th className={`px-1 py-1 ${today ? "outline outline-2 outline-[var(--primary)]" : ""} ${lesson?.cancelled ? "opacity-50" : ""}`}>
      <button type="button" className="block min-h-11 text-left" data-agent-action="journal-column" onClick={() => { onActivate?.(); setOpen(true); }}>
        <span className="block text-[11px]">{column.date.slice(8, 10)}.{column.date.slice(5, 7)}</span>
        <span className={`mt-1 inline-flex gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${tone}`}><span>{column.short}</span><span>{column.maxPoints ?? column.maxScore}</span><span>вес {Number(column.weight).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}</span></span>
        <span className="mt-1 block max-w-[7.5rem] truncate text-[10px] font-normal text-[var(--muted)]" title={caption}>{column.title}</span>
      </button>
      {open ? <ColumnDialog column={column} lesson={lesson} group={group} discipline={discipline} cells={cells} readOnly={readOnly} onClose={() => setOpen(false)} onDone={onDone} /> : null}
    </th>
  );
}

function CellDialog({ id, data, readOnly, onClose, onDone }: { id: string; data: Payload; readOnly: boolean; onClose: () => void; onDone: () => void }) {
  const cut = id.indexOf(":");
  const studentId = id.slice(0, cut);
  const columnKey = id.slice(cut + 1);
  const student = data.students.find((row) => String(row.id) === studentId);
  const column = data.columns.find((row) => String(row.id) === columnKey);
  const ghost = parseJournalFocus(columnKey);
  const lessonBits = columnKey.startsWith("lesson|") ? columnKey.split("|") : null;
  const lessonDate = lessonBits?.[1] ?? ghost?.date;
  const lessonType = lessonBits?.[2];
  const found = data.cells.find((row) => row.studentId === Number(studentId) && String(row.columnId) === columnKey);
  const run = useAction();
  const client = useQueryClient();
  const [value, setValue] = useState(found?.value == null ? "" : String(found.value));
  const [comment, setComment] = useState(found?.comment ?? "");
  const [error, setError] = useState("");
  useEffect(() => {
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<{ field: string; value: string }>).detail;
      if (detail.field === "journal-value") setValue(detail.value);
      if (detail.field === "journal-comment") setComment(detail.value);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("altair-fill", onFill);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("altair-fill", onFill);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  if (!student) return null;
  const workType = column?.workType ?? ghost?.workType ?? lessonType ?? "current";
  const rule = ruleFor(data, workType);
  const max = column?.maxPoints ?? column?.maxScore ?? ghost?.maxPoints ?? rule.maxPoints;
  const weight = column?.weight ?? ghost?.weight ?? rule.weight;
  const save = async (next: string) => {
    if (document.body.dataset.operator === "1" || readOnly) return;
    const raw = next.trim().replace(",", ".");
    const points = Number(raw);
    if (raw === "" || !Number.isFinite(points) || !validPoints(points, max)) {
      setError(`от 0 до ${max}, шаг 0,5`);
      return;
    }
    setError("");
    try {
      await run("teacher_set_mark", {
        ...(column?.id ? { columnId: column.id } : {}),
        studentName: student.name,
        groupName: data.groupName,
        discipline: data.discipline,
        date: column?.date ?? lessonDate,
        workType,
        title: column?.title ?? (ghost ? WORK_TYPES[ghost.workType as WorkType]?.label : "Текущая"),
        points,
        maxPoints: max,
        weight,
        comment,
      });
      void client.invalidateQueries({ queryKey: ["journal"] });
      onDone();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `от 0 до ${max}, шаг 0,5`);
    }
  };
  return (
    <div className="fixed inset-x-0 z-[60] mx-auto max-w-lg rounded-t-3xl bg-[var(--surface-solid)] p-4 shadow-2xl md:absolute md:inset-auto md:rounded-3xl" style={{ bottom: "calc(var(--agent-sheet-h, 0px) + 12px)" }} role="dialog" aria-label="Оценка">
      <p className="font-semibold">{student.name} · {(column?.date ?? lessonDate) ? journalDateLabel(column?.date ?? lessonDate!) : "новая"} · {column?.short ?? WORK_TYPES[workType as WorkType]?.short ?? "Работа"} /{max} · ×{weight}</p>
      <p className="text-sm text-[var(--muted)]">{column?.title ?? WORK_TYPES[workType as WorkType]?.label ?? "Работа"}</p>
      {readOnly ? <p className="mt-3 text-2xl font-semibold">{found?.value == null ? "—" : `${found.value}/${max}`}</p> : <PointsEntry max={max} value={value} onChange={(next) => { setValue(next); setError(""); }} />}
      <span className="sr-only" aria-hidden="true">{value}</span>
      {error ? <p className="mt-2 text-sm text-rose-700" role="alert">{error}</p> : null}
      {readOnly ? null : <label className="mt-3 block text-sm font-semibold">Комментарий<textarea className="field mt-1 min-h-16 py-3" data-agent-field="journal-comment" value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} /></label>}
      <div className="mt-3 flex flex-wrap gap-2">
        {readOnly ? null : <Button className="h-11 px-4" data-agent-action="journal-save" onClick={() => void save(value)}>Сохранить</Button>}
        {readOnly || !found ? null : <Button variant="glass" className="h-11 px-4" data-agent-action="journal-clear" onClick={() => { void run("teacher_clear_mark", { markId: found.markId }).then(() => { onDone(); onClose(); }); }}>Очистить</Button>}
        <Button variant="glass" className="h-11 px-4" onClick={onClose}>Закрыть</Button>
      </div>
    </div>
  );
}

function ColumnDialog({ column, lesson, group, discipline, cells, readOnly, onClose, onDone }: { column: Column; lesson?: Lesson; group: string; discipline: string; cells: Cell[]; readOnly: boolean; onClose: () => void; onDone: () => void }) {
  const run = useAction();
  const [topic, setTopic] = useState(lesson?.topic ?? "");
  const [title, setTitle] = useState(column.title);
  const [maxPoints, setMaxPoints] = useState(String(column.maxPoints ?? column.maxScore));
  const [weight, setWeight] = useState(String(column.weight));
  const [warn, setWarn] = useState("");
  const top = Math.max(0, ...cells.filter((cell) => cell.columnId === column.id).map((cell) => cell.value ?? 0));
  const save = () => {
    const problem = workRuleError(maxPoints, weight);
    if (problem) { setWarn(problem); return; }
    const nextMax = Number(maxPoints.replace(",", "."));
    if (nextMax < top) {
      setWarn(`Уже стоит ${top} баллов. Максимум нельзя сделать меньше`);
      return;
    }
    setWarn("");
    void run("teacher_edit_journal_column", { columnId: column.id, title, maxPoints: nextMax, weight: Number(weight.replace(",", ".")) }).then(onDone).catch((caught: unknown) => setWarn(caught instanceof Error ? caught.message : "Не получилось сохранить"));
  };
  const full = [column.title, lesson?.topic].filter(Boolean).join(" · ");
  return (
    <div className="fixed inset-x-3 z-[60] mx-auto max-w-md rounded-3xl bg-[var(--surface-solid)] p-4 text-left shadow-2xl" style={{ bottom: "calc(8rem + env(safe-area-inset-bottom))" }} role="dialog" aria-label="Колонка">
      <p className="font-semibold">{column.short} /{column.maxPoints ?? column.maxScore} · ×{column.weight}</p>
      <p className="mt-1 text-sm" title={full}>{full || "Темы пока нет"}</p>
      <label className="mt-2 block text-sm">Тема<input className="field mt-1" value={topic} readOnly={readOnly} onChange={(event) => setTopic(event.target.value)} /></label>
      <label className="mt-2 block text-sm">Название<input className="field mt-1" value={title} readOnly={readOnly} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-sm">Максимум<input className="field mt-1 h-11" inputMode="numeric" readOnly={readOnly || column.virtual} value={maxPoints} onChange={(event) => { setMaxPoints(event.target.value); setWarn(""); }} /></label>
        <label className="text-sm">Вес<input className="field mt-1 h-11" inputMode="decimal" readOnly={readOnly || column.virtual} value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
      </div>
      {warn ? <p className="mt-2 text-sm text-rose-700" role="alert">{warn}</p> : null}
      {readOnly ? null : <div className="mt-3 flex flex-wrap gap-2">
        <Button className="h-11 px-3" data-agent-action="journal-topic" onClick={() => void run("teacher_set_topic", { groupName: group, discipline, date: column.date, topic }).then(onDone)}>Тема</Button>
        {column.virtual ? null : <Button variant="glass" className="h-11 px-3" onClick={save}>Сохранить</Button>}
        {column.virtual ? null : <Button variant="glass" className="h-11 px-3" onClick={() => void run("teacher_delete_journal_column", { columnId: column.id }).then(() => { onDone(); onClose(); })}>Удалить колонку</Button>}
      </div>}
      <button type="button" className="btn btn-quiet mt-2 h-11 px-3" onClick={onClose}>Закрыть</button>
    </div>
  );
}

function LessonMode({ data, readOnly, onDone }: { data: Payload; readOnly: boolean; onDone: () => void }) {
  const today = moscowToday();
  const columns = viewColumns(data, "");
  const initial = columns.find((item) => item.date === today) ?? columns[0];
  const [picked, setPicked] = useState(initial ? `${initial.date}:${initial.id}:${initial.workType}` : "");
  const column = columns.find((item) => `${item.date}:${item.id}:${item.workType}` === picked) ?? initial;
  const run = useAction();
  if (!column) return <EmptyState title="Нет колонки" text="В этом периоде пар нет." />;
  return (
    <div className="stagger space-y-3">
      <div className="flex gap-2 overflow-x-auto" data-scroll-x>
        {columns.map((item) => {
          const key = `${item.date}:${item.id}:${item.workType}`;
          return <button key={key} type="button" className={`btn h-11 shrink-0 px-3 ${key === `${column.date}:${column.id}:${column.workType}` ? "btn-primary" : "btn-quiet"}`} onClick={() => setPicked(key)}>{item.date.slice(8, 10)}.{item.date.slice(5, 7)} {item.short}</button>;
        })}
      </div>
      {data.students.map((student) => (
        <div key={student.id} className="rounded-3xl bg-[var(--surface-solid)] p-3">
          <p className="font-semibold">{student.name}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["0", String((column.maxPoints ?? column.maxScore ?? 10) / 2), String(column.maxPoints ?? column.maxScore ?? 10), "Н"].map((item) => (
              <button key={item} type="button" className="btn btn-quiet h-11 min-w-11 px-3" disabled={readOnly} onClick={() => {
                if (item === "Н") void run("teacher_set_attendance", { groupName: data.groupName, discipline: data.discipline, date: column.date, studentName: student.name, present: false, status: "absent" }).then(onDone);
                else void run("teacher_set_mark", { ...(column.id ? { columnId: column.id } : { date: column.date, workType: column.workType, groupName: data.groupName, discipline: data.discipline, title: column.title, maxPoints: column.maxPoints ?? column.maxScore }), studentName: student.name, points: Number(item) }).then(onDone);
              }}>{item === "Н" ? "Н" : item}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PointsEntry({ max, value, onChange }: { max: number; value: string; onChange: (value: string) => void }) {
  const half = Math.round((max / 2) * 2) / 2;
  const set = (next: number) => onChange(String(Math.max(0, Math.min(max, Math.round(next * 2) / 2))));
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {[0, half, max].map((item) => (
          <button key={item} type="button" className={`btn h-11 px-3 ${value === String(item) ? "btn-primary" : "btn-quiet"}`} onClick={() => set(item)}>{item}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Меньше" onClick={() => set((Number(value) || 0) - 0.5)}>−</button>
        <input className="field h-11 w-24 text-center" inputMode="decimal" step={0.5} min={0} max={max} aria-label="Баллы" data-agent-field="journal-value" value={value} onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Больше" onClick={() => set((Number(value) || 0) + 0.5)}>+</button>
        <span className="text-sm text-[var(--muted)]">из {max}</span>
      </div>
    </div>
  );
}

function GradingDialog({ group, discipline, scheme, endpoint, readOnly, onDone }: { group: string; discipline: string; scheme?: Payload["scheme"]; endpoint: string; readOnly: boolean; onDone: () => void }) {
  const run = useAction();
  const [open, setOpen] = useState(false);
  const term = semesterBounds();
  const all = useQuery({
    queryKey: ["journal-scheme", endpoint, group, discipline, term.from, term.to],
    queryFn: () => api<Payload>(`${endpoint}?group=${encodeURIComponent(group)}&discipline=${encodeURIComponent(discipline)}&from=${term.from}&to=${term.to}`),
    enabled: open,
  });
  const [excellent, setExcellent] = useState(String(scheme?.excellent ?? 85));
  const [good, setGood] = useState(String(scheme?.good ?? 70));
  const [satisfactory, setSatisfactory] = useState(String(scheme?.satisfactory ?? 55));
  const [workType, setWorkType] = useState<WorkType>("control");
  const current = scheme?.defaults?.[workType] ?? { maxPoints: 10, weight: WORK_TYPES[workType].weight };
  const [maxPoints, setMaxPoints] = useState(String(current.maxPoints));
  const [weight, setWeight] = useState(String(current.weight));
  const [warn, setWarn] = useState("");
  if (!open) return <Button variant="glass" className="h-11 whitespace-nowrap px-3" onClick={() => setOpen(true)}>Пороги</Button>;
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly) return;
    const problem = workRuleError(maxPoints, weight);
    if (problem) { setWarn(problem); return; }
    const nextMax = Number(maxPoints.replace(",", "."));
    const previous = scheme?.defaults?.[workType]?.maxPoints ?? 10;
    const columns = all.data?.columns ?? [];
    const cells = all.data?.cells ?? [];
    const usingDefault = columns.filter((column) => column.workType === workType && (column.maxPoints ?? column.maxScore) === previous);
    const top = Math.max(0, ...usingDefault.flatMap((column) => cells.filter((cell) => cell.columnId === column.id).map((cell) => cell.value ?? 0)));
    if (nextMax < top) {
      setWarn(`В колонках с этим максимумом уже стоит ${top} баллов. Максимум нельзя сделать меньше`);
      return;
    }
    setWarn("");
    void run("teacher_update_grading", { groupName: group, discipline, workType, maxPoints: nextMax, weight: Number(weight.replace(",", ".")), excellent: Number(excellent), good: Number(good), satisfactory: Number(satisfactory) }).then(() => { setOpen(false); onDone(); }).catch((caught: unknown) => setWarn(caught instanceof Error ? caught.message : "Не получилось сохранить"));
  };
  return (
    <div className="fixed inset-x-0 z-[70] mx-auto flex max-h-[70vh] max-w-lg flex-col rounded-t-3xl bg-[var(--surface-solid)] shadow-2xl" style={{ bottom: "calc(7.75rem + env(safe-area-inset-bottom))" }} role="dialog" aria-label="Система оценивания">
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={save}>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          <p className="font-semibold">Система оценивания</p>
          <label className="block text-sm">Тип работы<select className="field mt-1 h-11" value={workType} disabled={readOnly} onChange={(event) => { const next = event.target.value as WorkType; setWorkType(next); const found = scheme?.defaults?.[next]; setMaxPoints(String(found?.maxPoints ?? 10)); setWeight(String(found?.weight ?? WORK_TYPES[next].weight)); setWarn(""); }}>{Object.entries(WORK_TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
          <label className="block text-sm">Максимум баллов<input className="field mt-1 h-11" inputMode="numeric" readOnly={readOnly} value={maxPoints} onChange={(event) => { setMaxPoints(event.target.value); setWarn(""); }} /></label>
          <label className="block text-sm">Вес<input className="field mt-1 h-11" inputMode="decimal" readOnly={readOnly} value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">Отлично %<input className="field mt-1 h-11" readOnly={readOnly} value={excellent} onChange={(event) => setExcellent(event.target.value)} /></label>
            <label className="text-xs">Хорошо %<input className="field mt-1 h-11" readOnly={readOnly} value={good} onChange={(event) => setGood(event.target.value)} /></label>
            <label className="text-xs">Удовл. %<input className="field mt-1 h-11" readOnly={readOnly} value={satisfactory} onChange={(event) => setSatisfactory(event.target.value)} /></label>
          </div>
          {warn ? <p className="text-sm text-rose-700" role="alert">{warn}</p> : null}
        </div>
        <div className="flex gap-2 border-t border-black/10 p-3">
          {readOnly ? null : <Button className="h-11 px-3">Сохранить</Button>}
          <button type="button" className="btn btn-quiet h-11 px-3" onClick={() => setOpen(false)}>Закрыть</button>
        </div>
      </form>
    </div>
  );
}
