import { Mic, Send, Sparkles, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useLayoutEffect, useRef, useState } from "react";
import { MODEL_IDS } from "../lib/webllm";
import { useAgent } from "../lib/agent";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";

const STUDENT_HINTS = ["Что у меня завтра?", "Что мне сдать?", "Какие у меня долги", "Как закрыть сессию?", "Справка для военкомата", "Напомни о дедлайне по базам данных"];
const LAW_HINTS = ["Что у меня завтра?", "Что мне сдать?", "Какие у меня долги", "Как закрыть сессию?", "Справка для военкомата", "Напомни о дедлайне по информационным технологиям"];
const HOMEWORK_HINTS = ["Что просрочено?", "Что сдать на этой неделе?", "Какие у меня долги", "Сдай задание по базам данных", "Напомни о дедлайне по базам данных"];
const LAW_HOMEWORK_HINTS = ["Что просрочено?", "Что сдать на этой неделе?", "Какие у меня долги", "Сдай задание по информационным технологиям", "Напомни о дедлайне по информационным технологиям"];
const STAFF_HINTS = ["Разбери входящие", "Статус заявки на справку", "Опубликуй объявление: Приём справок сегодня до 17:00", "Какие заявки ждут меня"];
const TEACHER_HINTS = ["Покажи непроверенные работы", "Что у меня сегодня?", "Отметь отсутствующих", "Поставь 5 Сорокину за лабу", "Выдай задание по базам данных на пятницу", "Верни работу Сорокина на доработку"];

export function AgentPanel({ variant = "dock", chrome = true }: { variant?: "dock" | "sheet"; chrome?: boolean }) {
  const agent = useAgent();
  const { user } = useAuth();
  const location = useLocation();
  const law = Boolean(user?.groupName?.startsWith("ЮР"));
  const hints = user?.role === "staff" ? STAFF_HINTS : user?.role === "teacher" ? TEACHER_HINTS : location.pathname.startsWith("/homework") ? (law ? LAW_HOMEWORK_HINTS : HOMEWORK_HINTS) : law ? LAW_HINTS : STUDENT_HINTS;
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [agent.messages, agent.busy, agent.open]);

  const dictate = () => {
    const host = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "ru-RU";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript ?? "";
      agent.setDraft(text);
      agent.inputRef.current?.focus();
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const speech = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {chrome ? (
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4" style={{ color: "var(--brand)" }} /> Агент деканата
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{statusLine(agent)}</p>
          </div>
          <button type="button" className="btn btn-quiet h-11 w-11 shrink-0 px-0" aria-label="Закрыть агента" onClick={() => agent.setOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </header>
      ) : null}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3" aria-live="polite">
        {agent.messages.length === 0 ? (
          <div className="space-y-3 pt-2">
            <p className="text-sm font-semibold">Что я умею</p>
            <p className="text-sm text-[var(--muted)]">
              {user?.role === "teacher"
                ? "Покажу пары, непроверенные работы и журнал. Оценку и возврат спрошу подтвердить."
                : user?.role === "staff"
                  ? "Разберу входящие и подготовлю объявление. Смену статуса спрошу подтвердить."
                  : "Покажу пары, задания и сессию. Справку и сдачу работы спрошу подтвердить."}
            </p>
            <div className="flex flex-wrap gap-2">
              {hints.slice(0, 6).map((hint) => (
                <button key={hint} type="button" className="btn btn-glass h-11 px-3 text-sm" onClick={() => void agent.send(hint)}>{hint}</button>
              ))}
            </div>
          </div>
        ) : null}
        {agent.messages.map((message) => (
          <article key={message.id} className={message.role === "user" ? "ml-8" : "mr-2"}>
            <div className={`rounded-3xl px-3.5 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-[var(--primary)] text-[var(--primary-ink)]" : "liquid-glass"}`}>
              <div className={message.role === "user" ? "" : "glass-pad"}>
                {message.caption && message.role === "agent" ? <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">{message.caption}</p> : null}
                {message.steps?.length ? (
                  <ol className="mb-2 space-y-1">
                    {message.steps.map((step, index) => (
                      <li key={index} className={step.status === "error" ? "text-[var(--risk-high-fg)]" : "text-[var(--muted)]"}>
                        {step.label.replace("…", step.status === "error" ? " — не вышло" : step.status === "skipped" ? " — жду" : "")}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {message.cards?.map((card) => (
                  <div key={card.title} className="mt-3 rounded-2xl bg-white/50 p-3 dark:bg-black/20">
                    <p className="font-semibold">{card.title}</p>
                    <dl className="mt-2 space-y-1">
                      {card.rows.map((row) => (
                        <div key={`${row.label}-${row.value}`}>
                          <dt className="text-[11px] uppercase text-[var(--muted)]">{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
                <p className="whitespace-pre-wrap">{message.text}</p>
                {message.citations?.map((citation) => (
                  <blockquote key={citation.slug} className="mt-2 border-l-2 border-[var(--brand)] pl-2 text-xs text-[var(--muted)]">
                    <span className="font-semibold text-[var(--ink)]">{citation.title}. </span>
                    {citation.excerpt}
                  </blockquote>
                ))}
                {message.confirm ? (
                  <div className="mt-3 rounded-2xl bg-white/50 p-3 dark:bg-black/20">
                    <p className="font-semibold">{message.confirm.title}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{message.confirm.summary}</p>
                    <dl className="mt-2 space-y-1">
                      {message.confirm.fields.map((field) => (
                        <div key={field.label}>
                          <dt className="text-[11px] uppercase text-[var(--muted)]">{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex gap-2">
                      <Button onClick={() => void agent.confirm(message.confirm!.pendingId)} disabled={agent.busy}>
                        Подтвердить
                      </Button>
                      <Button variant="glass" onClick={() => void agent.reject(message.confirm!.pendingId)}>
                        Не сейчас
                      </Button>
                    </div>
                  </div>
                ) : null}
                {message.choices?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {message.choices.map((choice) => (
                      <button key={`${choice.clarificationId}-${choice.entityId}`} type="button" className="btn btn-glass h-11 px-3 text-sm" onClick={() => void agent.clarify(choice)}>{choice.label}</button>
                    ))}
                  </div>
                ) : null}
                {message.link ? (
                  <Link className="mt-2 inline-flex min-h-11 items-center text-xs text-[var(--muted)] underline" to={message.link.to}>{message.link.label}</Link>
                ) : null}
                {message.download ? (
                  <a className="btn btn-primary mt-3" href={message.download.href}>
                    {message.download.label}
                  </a>
                ) : null}
                {message.undo ? (
                  <button className="btn btn-quiet mt-2 h-9 px-2 text-xs" disabled={message.undone} onClick={() => void agent.undo(message.undo!.auditId)}>
                    {message.undone ? "Отменено" : message.undo.label}
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
        {agent.busy ? <p className="text-sm text-[var(--muted)]">Думаю…</p> : null}
      </div>
      <form
        className="agent-form px-3"
        onSubmit={(event) => {
          event.preventDefault();
          void agent.send(agent.draft);
        }}
      >
        {agent.messages.length ? (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {hints.slice(0, 3).map((hint) => (
              <button key={hint} type="button" className="btn btn-glass h-11 shrink-0 px-3 text-sm" onClick={() => void agent.send(hint)}>
                {hint}
              </button>
            ))}
          </div>
        ) : null}
        <div className="composer dock flex items-end gap-2 rounded-[28px] p-2">
          <label className="sr-only" htmlFor="agent-command">
            Команда агенту
          </label>
          <textarea
            id="agent-command"
            ref={agent.inputRef}
            rows={1}
            enterKeyHint="send"
            value={agent.draft}
            placeholder="Спросите деканат…"
            className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            onChange={(event) => agent.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void agent.send(agent.draft);
              }
            }}
          />
          {speech ? (
            <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Диктовка" aria-pressed={listening} onClick={dictate}>
              <Mic className="h-5 w-5" />
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary h-11 w-11 px-0" aria-label="Отправить" disabled={agent.busy || !agent.draft.trim()}>
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

export function ModelControls() {
  const agent = useAgent();
  if (agent.gpu === false) return <p className="text-sm text-[var(--muted)]">Локальный режим: ответы собираются на сервере из ваших данных и не уходят в&nbsp;облако.</p>;
  if (agent.modelState === "ready") return <p className="text-sm text-[var(--muted)]">Модель на устройстве: {MODEL_IDS[agent.modelSize].replace("-Instruct-q4f16_1-MLC", "")}</p>;
  if (agent.modelState === "loading") {
    return (
      <div className="mx-4 mb-2 rounded-2xl bg-white/40 p-3 text-xs dark:bg-white/5">
        <p>Скачиваю модель один раз, она останется на устройстве.</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
          <div className="h-full bg-[var(--brand)]" style={{ width: `${Math.round(agent.modelProgress * 100)}%` }} />
        </div>
        <p className="mt-1 text-[var(--muted)]">{Math.round(agent.modelProgress * 100)}% · {agent.modelText}</p>
      </div>
    );
  }
  return (
    <div className="mx-4 mb-2 rounded-2xl bg-white/40 p-3 text-xs dark:bg-white/5">
      <p>Локальная модель отвечает на устройстве и не отправляет оценки в облако. Пока можно говорить в быстром режиме.</p>
      {agent.modelState === "error" ? <p className="mt-1 text-[var(--risk-high-fg)]">{agent.modelText}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="h-9 text-xs" onClick={() => void agent.startModel("default")}>
          Qwen 1.5B
        </Button>
        <Button variant="glass" className="h-9 text-xs" onClick={() => void agent.startModel("light")}>
          Лёгкая 0.5B
        </Button>
        <Button variant="glass" className="h-9 text-xs" onClick={() => void agent.startModel("quality")}>
          Точнее 3B
        </Button>
      </div>
      {agent.serverModel ? (
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={agent.useServer} onChange={(event) => agent.setUseServer(event.target.checked)} />
          Серверная модель вместо браузера
        </label>
      ) : null}
    </div>
  );
}

function statusLine(agent: ReturnType<typeof useAgent>) {
  if (agent.useServer && agent.serverModel) return "Серверная модель";
  if (agent.modelState === "ready") return "Модель на устройстве";
  if (agent.modelState === "loading") return `Загрузка модели ${Math.round(agent.modelProgress * 100)}%`;
  return "Локальный режим";
}

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results?: { 0?: { 0?: { transcript?: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
}
