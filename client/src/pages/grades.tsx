import { useQuery } from "@tanstack/react-query";
import type { DisciplineView } from "@shared/domain";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatPercent, formatScore, monthBounds, semesterBounds } from "@shared/journal";
import { gradeInk, gradeTone } from "../lib/format";
import { GradeItem, SectionHeader } from "../components/items";
import { fmtDate } from "../lib/format";
import { api } from "../lib/api";
import { Choice, EmptyState, ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface Item {
  id: number;
  name: string;
  controlForm: "exam" | "credit" | "diff_credit" | string;
  sessionDate?: string | null;
  average: number | null;
  automatic: "5" | "4" | "pass" | null;
  finalText: string | null;
  risk: "low" | "medium" | "high";
  headline: string;
  details: string[];
  daysLeft: number | null;
}

interface Payload {
  semester: string;
  semesters: { id: string; label: string }[];
  items: Item[];
  disciplines: DisciplineView[];
}

function useCount(target: number) {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [value, setValue] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700);
      setValue(target * progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);
  return value;
}

function Ring({ value, max }: { value: number; max: number }) {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [drawn, setDrawn] = useState(reduce);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const radius = 16;
  const length = 2 * Math.PI * radius;
  const ratio = Math.min(value / Math.max(max, 0.001), 1);
  const offset = drawn ? length * (1 - ratio) : length;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden className="text-[var(--primary)]">
      <circle cx="22" cy="22" r={radius} fill="none" stroke="currentColor" opacity="0.2" strokeWidth="4" />
      <circle cx="22" cy="22" r={radius} fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={length} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 22 22)" style={{ transition: reduce ? "none" : "stroke-dashoffset 700ms ease" }} />
    </svg>
  );
}

export function GradesPage() {
  const [params, setParams] = useSearchParams();
  const semester = params.get("semester") ?? "";
  const subject = params.get("subject") ?? "";
  const view = params.get("view") ?? "table";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [opened, setOpened] = useState<number | null>(null);
  const grades = useQuery({
    queryKey: ["grades", semester],
    queryFn: () => api<Payload>(`/api/grades${semester ? `?semester=${semester}` : ""}`),
  });

  if (grades.isLoading) return <LoadingBlock />;
  if (grades.error || !grades.data) return <ErrorState text="Оценки не загрузились" onRetry={() => void grades.refetch()} />;

  const scored = grades.data.items.filter((item) => item.average != null);
  const average = scored.length ? scored.reduce((sum, item) => sum + (item.average ?? 0), 0) / scored.length : null;
  const high = grades.data.items.filter((item) => item.risk === "high").length;
  const autos = grades.data.items.filter((item) => item.automatic && !item.finalText).length;
  return (
    <div className="space-y-4" data-agent-target="grades">
      <div className="min-w-0">
        <h1>Успеваемость</h1>
        <p className="text-sm text-[var(--muted)]">Баллы, процент и пороги предмета.</p>
      </div>
      <HowAmI items={grades.data.items} average={average} />
      <Choice label="Семестр" value={grades.data.semester} options={grades.data.semesters.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => setParams({ semester: value, view })} />
      <div className="flex flex-wrap gap-2" data-agent-action="grades-view">
        {[["table", "Таблица"], ["list", "Список"], ["session", "Сессия"], ["summary", "Сводка"]].map(([id, label]) => (
          <button key={id} type="button" className={`btn h-11 px-3 ${view === id ? "btn-primary" : "btn-quiet"}`} onClick={() => setParams({ semester: grades.data!.semester, view: id, subject })}>{label}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" data-agent-action="grades-period">
        <button type="button" className="btn btn-quiet h-11 px-3" onClick={() => { const month = monthBounds(); setParams({ semester: grades.data!.semester, view, subject, from: month.from, to: month.to }); }}>Месяц</button>
        <button type="button" className="btn btn-quiet h-11 px-3" onClick={() => { const term = semesterBounds(); setParams({ semester: grades.data!.semester, view, subject, from: term.from, to: term.to }); }}>Семестр</button>
      </div>
      {view === "session" ? <SessionView items={grades.data.items} /> : null}
      {view === "summary" || view === "session" ? null : <GradeTable mode={view === "list" ? "list" : "table"} semester={grades.data.semester} from={from} to={to} subject={subject} focus={params.get("focus") ?? ""} />}
      <div className="chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button type="button" className="btn btn-quiet h-11 shrink-0 px-3" data-agent-action="grades-open" onClick={() => setParams({ semester: grades.data!.semester })}>Все</button>
        {grades.data.items.map((item) => (
          <button key={item.id} type="button" className={`btn btn-quiet h-11 shrink-0 px-3 ${subject === item.name ? "bg-[var(--primary)] text-[var(--primary-ink)]" : ""}`} data-agent-action="grades-open" onClick={() => { setParams({ semester: grades.data!.semester, subject: item.name }); setOpened(item.id); }}>{item.name}</button>
        ))}
      </div>
      <GradeMeters average={average} high={high} autos={autos} total={Math.max(grades.data.items.length, 1)} />
      {view !== "summary" ? null : grades.data.items.length === 0 ? (
        <EmptyState title="Нет данных" text="За выбранный период оценок нет." />
      ) : (
        <div className="stagger space-y-4">{grades.data.items.map((item) => {
          const discipline = grades.data!.disciplines.find((row) => row.id === item.id);
          const expanded = opened === item.id || item.name === subject;
          return (
            <Glass key={item.id} target={`grade-${item.id}`} className={subject && item.name !== subject ? "opacity-70" : ""}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-expanded={expanded} onClick={() => setOpened(expanded ? null : item.id)}>
                <div className="min-w-0">
                  <div data-ui="grade" className="min-w-0">
                    <h2 data-ui-part="title" className="t-title item-title" title={item.name}>{item.name}</h2>
                    <p data-ui-part="value" className="t-value">{item.average == null ? "—" : formatPercent(item.average)}</p>
                  </div>
                </div>
                <Pill tone={item.risk === "high" ? "high" : item.risk === "medium" ? "mid" : "low"}>{item.risk === "high" ? "Риск" : item.automatic && !item.finalText ? (item.automatic === "5" ? "Отлично" : item.automatic === "4" ? "Хорошо" : "Зачёт") : item.risk === "medium" ? "В работе" : "Спокойно"}</Pill>
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  <p className="mt-3 text-sm">{item.headline}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                    {item.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                  {discipline ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {discipline.marks.map((mark) => (
                        <span key={mark.id} className="rounded-2xl bg-white/50 px-3 py-2 text-sm dark:bg-white/5">
                          <span className="block text-[11px] text-[var(--muted)]">{mark.label}</span>
                          <span className="font-semibold">{mark.points == null ? "—" : `${mark.points}/${mark.maxPoints ?? 10}`}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.average != null ? (
                    <div className="mt-3 h-2 rounded-full bg-black/10">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, item.average)}%`, background: "var(--brand)" }} />
                    </div>
                  ) : null}
                </div>
              </div>
            </Glass>
          );
        })}</div>
      )}
    </div>
  );
}

const CONTROL_RU: Record<string, string> = { exam: "Экзамен", credit: "Зачёт", diff_credit: "Дифф. зачёт" };

function sessionState(item: Item): { label: string; tone: "low" | "mid" | "high" } {
  if (item.finalText) return { label: `Итог: ${item.finalText}`, tone: "low" };
  if (item.automatic) return { label: item.automatic === "5" ? "Автомат «отлично»" : item.automatic === "4" ? "Автомат «хорошо»" : "Автомат «зачтено»", tone: "low" };
  if (item.risk === "high") return { label: "Риск — нужен план", tone: "high" };
  if (item.risk === "medium") return { label: "Допуск, нужно добрать", tone: "mid" };
  return { label: "Допуск", tone: "low" };
}

/** «Как у меня дела»: одна фраза, понятная без таблиц. */
function HowAmI({ items, average }: { items: Item[]; average: number | null }) {
  if (!items.length) return null;
  const risky = items.filter((item) => item.risk === "high");
  const autos = items.filter((item) => item.automatic && !item.finalText);
  const closed = items.filter((item) => item.finalText);
  const next = items.filter((item) => item.sessionDate && (item.daysLeft ?? -1) >= 0 && !item.finalText).sort((a, b) => String(a.sessionDate).localeCompare(String(b.sessionDate)))[0];
  const mood = risky.length ? "Есть над чем поработать" : average != null && average >= 85 ? "Всё отлично" : "Всё под контролем";
  return (
    <section className="liquid-glass" data-agent-target="grades-summary" aria-label="Как у меня дела">
      <div className="glass-pad p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Как у меня дела</p>
        <p className="mt-1 text-lg font-semibold">{mood}{average != null ? ` · средний ${formatPercent(average)}` : ""}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {[
            autos.length ? `автоматов: ${autos.length}` : null,
            closed.length ? `закрыто: ${closed.length}` : null,
            risky.length ? `в зоне риска: ${risky.map((item) => item.name).join(", ")}` : "долгов нет",
            next ? `ближайшая аттестация — ${next.name}, ${fmtDate(String(next.sessionDate), "day")}${next.daysLeft === 0 ? " (сегодня)" : next.daysLeft != null ? ` (через ${next.daysLeft} дн.)` : ""}` : null,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
    </section>
  );
}

function SessionView({ items }: { items: Item[] }) {
  if (!items.length) return <EmptyState title="Сессии пока нет" text="Когда появятся дисциплины с аттестацией, они будут здесь." />;
  const rows = [...items].sort((a, b) => String(a.sessionDate ?? "9999").localeCompare(String(b.sessionDate ?? "9999")));
  return (
    <div className="space-y-2" data-agent-target="grades-session">
      {rows.map((item) => {
        const state = sessionState(item);
        const past = (item.daysLeft ?? 0) < 0;
        return (
          <Glass key={item.id} target={`session-${item.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="t-title item-title" title={item.name}>{item.name}</h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  {CONTROL_RU[item.controlForm] ?? "Аттестация"}
                  {item.sessionDate ? ` · ${fmtDate(item.sessionDate, "day")}${item.finalText ? "" : past ? " (прошла)" : item.daysLeft === 0 ? " · сегодня" : item.daysLeft != null ? ` · через ${item.daysLeft} дн.` : ""}` : ""}
                </p>
                <p className="mt-1 text-sm">Текущий итог: {item.average == null ? "—" : formatPercent(item.average)}</p>
              </div>
              <Pill tone={state.tone}>{state.label}</Pill>
            </div>
          </Glass>
        );
      })}
    </div>
  );
}

function GradeTable({ semester, from, to, subject, focus, mode }: { semester: string; from: string; to: string; subject: string; focus: string; mode: "table" | "list" }) {
  const table = useQuery({
    queryKey: ["grades-table", semester, from, to],
    queryFn: () => api<{ period: { label: string; final: boolean }; dates: string[]; rows: { discipline: string; weighted: number | null; percent: number | null; earned: number; possible: number; grade: string | null; automatic: string | null; finalText: string | null; cells: { date: string; markId: number; value: number | null; points: number | null; short: string; workType?: string; title: string; comment: string | null; teacher: string | null; weight: number; maxPoints: number }[] }[] }>(`/api/grades/table?semester=${encodeURIComponent(semester)}${from ? `&from=${from}&to=${to}` : ""}`),
  });
  const [open, setOpen] = useState<{ id: number; top: number; left: number } | null>(null);
  if (table.isLoading) return <LoadingBlock />;
  if (table.error || !table.data) return <ErrorState text="Таблица не загрузилась" />;
  const final = table.data.period?.final !== false;
  const rows = table.data.rows.filter((row) => !subject || row.discipline === subject);
  if (mode === "list") {
    const cells = rows.flatMap((row) => row.cells.map((cell) => ({ ...cell, discipline: row.discipline }))).sort((a, b) => b.date.localeCompare(a.date));
    const dates = [...new Set(cells.map((cell) => cell.date))];
    return <div className="space-y-3">{dates.map((date) => (
      <section key={date}>
        <SectionHeader title={fmtDate(date, "day")} />
        {cells.filter((cell) => cell.date === date).map((cell) => (
          <GradeItem key={cell.markId} points={Number(cell.points ?? cell.value ?? 0)} max={cell.maxPoints ?? 10} kind={cell.workType || "current"} title={cell.title} discipline={cell.discipline} hideDate weight={cell.weight} />
        ))}
      </section>
    ))}</div>;
  }
  return (
    <>
    {final ? null : <p className="text-sm">За {table.data.period.label}. Это не итог&nbsp;семестра.</p>}
    <div className="max-w-full overflow-x-auto" data-scroll-x>
      <table className="min-w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-[var(--surface-solid)] px-2 py-2 text-left">Предмет</th>
            {table.data.dates.map((date) => <th key={date} className="min-w-14 whitespace-nowrap px-2 py-2">{date.slice(8, 10)}.{date.slice(5, 7)}</th>)}
            <th className="sticky right-0 z-10 w-16 bg-[var(--surface-solid)] px-1 text-center">Итог</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.discipline}>
              <th className="sticky left-0 z-10 w-28 bg-[var(--surface-solid)] px-2 py-2 text-left md:w-36" scope="row" data-ui="grade"><span className="block font-semibold" title={row.discipline}>{row.discipline}</span></th>
              {table.data!.dates.map((date) => {
                const cells = row.cells.filter((cell) => cell.date === date);
                return <td key={date} className="px-1">{cells.map((cell) => {
                  const ratio = cell.points == null ? null : (Number(cell.points) / (cell.maxPoints || 10)) * 100;
                  const label = cell.points == null ? "—" : `${formatScore(Number(cell.points))}/${cell.maxPoints ?? 10}`;
                  return <button key={cell.markId} type="button" data-agent-target={`grade-${cell.markId}`} className={`m-0.5 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${cell.markId === Number(focus) ? "ring-2 ring-[var(--primary)]" : ""}`} style={{ background: gradeTone(ratio), color: gradeInk(ratio) }} onClick={(event) => setOpen({ id: cell.markId, top: event.currentTarget.getBoundingClientRect().bottom + 8, left: event.currentTarget.getBoundingClientRect().left })}>{label}</button>;
                })}</td>;
              })}
              <td className="sticky right-0 z-10 w-16 bg-[var(--surface-solid)] px-1 text-center text-xs"><span className="block whitespace-nowrap font-semibold">{formatPercent(row.percent)}</span><span className="block whitespace-nowrap">{final ? (row.grade || outcomeLabel(row.automatic, row.finalText)) : "период"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {open ? <GradePopover cell={rows.flatMap((row) => row.cells.map((item) => ({ ...item, discipline: row.discipline }))).find((item) => item.markId === open.id)} top={open.top} left={open.left} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function outcomeLabel(automatic: string | null, finalText: string | null) {
  if (finalText) return finalText;
  if (automatic === "5") return "отлично";
  if (automatic === "4") return "хорошо";
  if (automatic === "pass") return "зачёт";
  if (automatic === "fail") return "незачёт";
  return "—";
}

function GradePopover({ cell, top, left, onClose }: { cell?: { date: string; title: string; short: string; weight: number; maxPoints?: number; points?: number | null; comment: string | null; teacher: string | null; discipline: string; value: number | null }; top: number; left: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!cell) return null;
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  return (
    <div role="dialog" aria-label="Оценка" className="fixed z-[70] w-[min(22rem,calc(100%-1.5rem))] rounded-3xl bg-[var(--surface-solid)] p-4 text-sm shadow-2xl" style={wide ? { top: Math.min(top, window.innerHeight - 220), left: Math.max(12, Math.min(left, window.innerWidth - 360)) } : { left: 12, right: 12, bottom: "calc(7.75rem + env(safe-area-inset-bottom))", width: "auto" }}>
      <p className="font-semibold">{cell.date.slice(8, 10)}.{cell.date.slice(5, 7)}</p>
      <p className="mt-1">{cell.discipline}</p>
      <p className="mt-1">{cell.title}</p>
      <p className="mt-1 whitespace-nowrap">{cell.points ?? cell.value}/{cell.maxPoints ?? 10}, вес {String(cell.weight).replace(".", ",")}</p>
      <p className="mt-1 text-[var(--muted)]">{cell.teacher || "—"}</p>
      {cell.comment ? <p className="mt-1">{cell.comment}</p> : null}
      <button type="button" className="btn btn-quiet mt-3 h-11 px-3" onClick={onClose}>Закрыть</button>
    </div>
  );
}

function GradeMeters({ average, high, autos, total }: { average: number | null; high: number; autos: number; total: number }) {
  const shown = useCount(average ?? 0);
  const risk = useCount(high);
  const auto = useCount(autos);
  return (
    <div className="grid grid-cols-3 gap-2">
      <Glass className="p-0"><div className="glass-pad flex flex-col items-center px-2 py-3 text-center"><Ring value={average == null ? 0 : shown} max={100} /><p className="text-xs text-[var(--muted)]">Баллы</p><p className="text-2xl font-bold">{average == null ? "—" : formatPercent(shown)}</p></div></Glass>
      <Glass><div className="glass-pad flex flex-col items-center px-2 py-3 text-center"><Ring value={risk} max={total} /><p className="text-xs text-[var(--muted)]">Риск</p><p className="text-2xl font-bold">{Math.round(risk)}</p></div></Glass>
      <Glass><div className="glass-pad flex flex-col items-center px-2 py-3 text-center"><Ring value={auto} max={total} /><p className="text-xs text-[var(--muted)]">Автомат</p><p className="text-2xl font-bold">{Math.round(auto)}</p></div></Glass>
    </div>
  );
}
