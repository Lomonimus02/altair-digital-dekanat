import { useQuery } from "@tanstack/react-query";
import type { DisciplineView } from "@shared/domain";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Choice, EmptyState, ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface Item {
  id: number;
  name: string;
  controlForm: "exam" | "credit";
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

export function GradesPage() {
  const [params, setParams] = useSearchParams();
  const semester = params.get("semester") ?? "";
  const subject = params.get("subject") ?? "";
  const [opened, setOpened] = useState<number | null>(null);
  const grades = useQuery({
    queryKey: ["grades", semester],
    queryFn: () => api<Payload>(`/api/grades${semester ? `?semester=${semester}` : ""}`),
  });

  if (grades.isLoading) return <LoadingBlock />;
  if (grades.error || !grades.data) return <ErrorState text="Оценки не загрузились" onRetry={() => void grades.refetch()} />;

  const high = grades.data.items.filter((item) => item.risk === "high").length;
  const autos = grades.data.items.filter((item) => item.automatic && !item.finalText).length;
  return (
    <div className="space-y-4" data-agent-target="grades">
      <div className="min-w-0">
        <h1>Успеваемость</h1>
        <p className="text-sm text-[var(--muted)]">Как идёт сессия и что нужно для автомата.</p>
      </div>
      <Choice label="Семестр" value={grades.data.semester} options={grades.data.semesters.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => setParams({ semester: value })} />
      <div className="chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button type="button" className="btn btn-quiet h-11 shrink-0 px-3" data-agent-action="grades-open" onClick={() => setParams({ semester: grades.data!.semester })}>Все</button>
        {grades.data.items.map((item) => (
          <button key={item.id} type="button" className={`btn btn-quiet h-11 shrink-0 px-3 ${subject === item.name ? "bg-[var(--primary)] text-[var(--primary-ink)]" : ""}`} data-agent-action="grades-open" onClick={() => { setParams({ semester: grades.data!.semester, subject: item.name }); setOpened(item.id); }}>{item.name}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Glass className="p-0"><div className="glass-pad px-2 py-3 text-center"><p className="text-xs text-[var(--muted)]">Дисциплин</p><p className="text-2xl font-bold">{grades.data.items.length}</p></div></Glass>
        <Glass><div className="glass-pad px-2 py-3 text-center"><p className="text-xs text-[var(--muted)]">Риск</p><p className="text-2xl font-bold">{high}</p></div></Glass>
        <Glass><div className="glass-pad px-2 py-3 text-center"><p className="text-xs text-[var(--muted)]">Автомат</p><p className="text-2xl font-bold">{autos}</p></div></Glass>
      </div>
      {grades.data.items.length === 0 ? (
        <EmptyState title="Нет данных" text="За выбранный период оценок нет." />
      ) : (
        grades.data.items.map((item) => {
          const discipline = grades.data!.disciplines.find((row) => row.id === item.id);
          const expanded = opened === item.id || item.name === subject;
          return (
            <Glass key={item.id} target={`grade-${item.id}`} className={subject && item.name !== subject ? "opacity-70" : ""}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-expanded={expanded} onClick={() => setOpened(expanded ? null : item.id)}>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{item.name}</h2>
                  <p className="text-sm text-[var(--muted)]">{item.average == null ? "Средний —" : `Средний ${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(item.average)}`} · {item.controlForm === "exam" ? "экзамен" : "зачёт"}</p>
                </div>
                <Pill tone={item.risk === "high" ? "high" : item.risk === "medium" ? "mid" : "low"}>{item.risk === "high" ? "Риск" : item.automatic && !item.finalText ? `Автомат ${item.automatic === "pass" ? "зачёт" : item.automatic}` : item.risk === "medium" ? "В работе" : "Спокойно"}</Pill>
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
                          <span className="font-semibold">{mark.kind === "credit" ? (mark.value ? "зачтено" : "незачёт") : mark.value}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.average != null ? (
                    <div className="mt-3 h-2 rounded-full bg-black/10">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, ((item.average - 2) / 3) * 100)}%`, background: "var(--brand)" }} />
                    </div>
                  ) : null}
                </div>
              </div>
            </Glass>
          );
        })
      )}
    </div>
  );
}
