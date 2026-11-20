import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CHANGE_LABEL, KIND_LABEL, type LessonView } from "@shared/domain";
import { addDays, formatDdMm, formatWeekSpan, scheduleLook } from "@shared/dates";
import { useAuth } from "../lib/auth";
import { Star } from "lucide-react";
import { useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface ScheduleResponse {
  today: string;
  focus: string;
  days: { date: string; weekday: string; items: LessonView[] }[];
}

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? "";
  const when = params.get("when") ?? "";
  const weekOffset = params.get("weekOffset") ?? "";
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  else if (when) query.set("when", when);
  else query.set("when", "today");
  if (weekOffset) query.set("weekOffset", weekOffset);
  const schedule = useQuery({
    queryKey: ["schedule", date, when, weekOffset],
    queryFn: () => api<ScheduleResponse>(`/api/schedule?${query.toString()}`),
    placeholderData: keepPreviousData,
  });
  const touch = useRef<number | null>(null);

  if (schedule.isLoading) return <LoadingBlock />;
  if (schedule.error || !schedule.data) return <ErrorState text="Расписание не загрузилось" onRetry={() => void schedule.refetch()} />;

  const focus = schedule.data.focus;
  const index = Math.max(0, schedule.data.days.findIndex((day) => day.date === focus));
  const shift = (delta: number) => {
    if (Math.abs(delta) >= 7) {
      const monday = schedule.data!.days[0]?.date;
      if (!monday) return;
      const base = new Date(`${monday}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() + delta);
      setParams({ date: base.toISOString().slice(0, 10) });
      return;
    }
    const next = schedule.data!.days[index + delta];
    if (next) setParams({ date: next.date });
    else {
      const monday = schedule.data!.days[0]?.date;
      if (!monday) return;
      setParams({ date: delta < 0 ? addDays(monday, -2) : addDays(monday, 7) });
    }
  };

  const weekStart = schedule.data.days[0]?.date ?? focus;
  const weekEnd = schedule.data.days.at(-1)?.date ?? focus;
  const look = scheduleLook(schedule.data.today, weekStart, weekEnd);
  const focusDay = schedule.data.days[index];
  return (
    <div className="stagger space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1>Расписание</h1>
          {look === "near" && focusDay ? <p className="text-sm text-[var(--muted)]">Сегодня пар нет — ближайшие: {shortDay(focusDay.weekday).toLowerCase()} {formatDdMm(focusDay.date)}</p> : null}
          {look === "past" && focusDay ? <p className="text-sm text-[var(--muted)]">Прошедшая неделя: {shortDay(focusDay.weekday).toLowerCase()} {formatDdMm(focusDay.date)}</p> : null}
          {look === "later" && focusDay ? <p className="text-sm text-[var(--muted)]">Вы смотрите {shortDay(focusDay.weekday).toLowerCase()} {formatDdMm(focusDay.date)}</p> : null}
        </div>
        <div className="flex items-center gap-1 rounded-full bg-white/50 p-1 dark:bg-white/10" role="group" aria-label="Период">
          <button type="button" className="btn btn-quiet h-11 px-3" data-agent-action="schedule-today" onClick={() => setParams({ date: schedule.data!.today })}>Сегодня</button>
          <button type="button" className="btn btn-quiet h-11 px-3" data-agent-action="schedule-week" onClick={() => setParams({ when: "week" })}>Неделя</button>
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <button className="btn btn-glass h-11 px-4" onClick={() => shift(-7)}>Предыдущая неделя</button>
          <p className="px-2 text-sm font-semibold">{weekLabel(schedule.data.days)}</p>
          <button className="btn btn-glass h-11 px-4" onClick={() => shift(7)}>Следующая неделя</button>
        </div>
      </div>
      <div className="chip-row sticky top-0 z-20 -mx-1 flex justify-between gap-1 py-1 xl:hidden">
        {schedule.data.days.map((day) => {
          const selected = day.date === focus;
          const isToday = day.date === schedule.data?.today;
          return (
            <button key={day.date} type="button" aria-pressed={selected} className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full ${selected ? "bg-[var(--primary)] text-[var(--primary-ink)]" : "border border-white/40 bg-white/40"}`} onClick={() => setParams({ date: day.date })}>
              <span className="text-[9px] font-semibold leading-none">{shortDay(day.weekday)}</span>
              <span className={`mt-0.5 text-[13px] font-semibold leading-none ${isToday && !selected ? "text-[var(--primary)]" : ""}`}>{Number(day.date.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <div
        className="schedule-one"
        onTouchStart={(event) => {
          touch.current = event.changedTouches[0].clientX;
        }}
        onTouchEnd={(event) => {
          if (touch.current == null) return;
          const delta = event.changedTouches[0].clientX - touch.current;
          if (delta > 48) shift(-1);
          if (delta < -48) shift(1);
        }}
      >
        <DayCard day={focusDay} today={schedule.data.today} />
      </div>
      <div className="schedule-days">
        {schedule.data.days.map((day) => (
          <DayCard key={day.date} day={day} today={schedule.data!.today} />
        ))}
      </div>
    </div>
  );
}

function weekLabel(days: { date: string }[]) {
  if (!days.length) return "";
  return formatWeekSpan(days[0].date, days[days.length - 1].date);
}

function shortDay(name: string) {
  const map: Record<string, string> = { Понедельник: "ПН", Вторник: "ВТ", Среда: "СР", Четверг: "ЧТ", Пятница: "ПТ", Суббота: "СБ", Воскресенье: "ВС" };
  return map[name] ?? name.slice(0, 2).toUpperCase();
}

function DayCard({ day, today }: { day?: { date: string; weekday: string; items: LessonView[] }; today: string }) {
  if (!day) return null;
  return (
    <Glass target={`schedule-day-${day.date}`} className={day.date === today ? "border border-green-400/50 bg-green-500/10" : ""}>
      <div className={`-mx-4 -mt-4 mb-3 rounded-t-[2rem] px-4 py-3 sm:-mx-5 sm:-mt-5 ${day.date === today ? "bg-green-500/10" : "bg-slate-700/10"}`}>
        <h2 className="text-lg font-semibold">{day.weekday}, {formatDdMm(day.date)}</h2>
      </div>
      {day.items.length ? day.items.map((lesson) => <Lesson key={lesson.id} lesson={lesson} />) : <p className="py-8 text-center text-sm text-[var(--muted)]">Занятий нет</p>}
    </Glass>
  );
}

function Lesson({ lesson }: { lesson: LessonView }) {
  const run = useAction();
  const { user } = useAuth();
  const tone = lesson.changeType === "cancelled" ? "high" : lesson.changeType === "none" ? "low" : "mid";
  const who = user?.role === "teacher" ? lesson.groupName : lesson.teacher;
  return (
    <article className={`border-t border-white/40 py-3 first:border-0 ${lesson.changeType === "cancelled" ? "opacity-70" : ""}`} data-agent-target={`lesson-${lesson.id}`}>
      <div className="flex items-start gap-3">
        <div className="w-24 shrink-0 text-sm font-semibold leading-tight">{lesson.startsAt}–{lesson.endsAt}</div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">{lesson.discipline}</h3>
          {lesson.changeType !== "none" ? <div className="mt-1"><Pill tone={tone}>{CHANGE_LABEL[lesson.changeType]}</Pill></div> : null}
          <p className="text-sm text-[var(--muted)]">{KIND_LABEL[lesson.kind]} · ауд. {lesson.room}{who ? ` · ${who}` : ""}</p>
          {lesson.changeNote ? <p className="mt-1 text-sm">{lesson.changeNote}</p> : null}
        </div>
        {user?.role === "teacher" ? null : (
          <button
            className="btn btn-quiet h-11 w-11 shrink-0 px-0"
            data-agent-action="schedule-star"
            aria-label={lesson.flagged ? "Снять отметку" : "Отметить занятие"}
            aria-pressed={lesson.flagged}
            onClick={() => void run("mark_schedule_item", { scheduleItemId: lesson.id, flagged: !lesson.flagged })}
          >
            <Star className="h-4 w-4" fill={lesson.flagged ? "currentColor" : "none"} />
          </button>
        )}
      </div>
    </article>
  );
}
