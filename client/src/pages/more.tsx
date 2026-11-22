import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { moscowToday } from "@shared/dates";
import { REQUEST_NEXT, STATUS_LABEL, type RequestStatus } from "@shared/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { useAuth } from "../lib/auth";
import { ModelControls } from "../components/agent-panel";
import { Fact, NotificationItem, RequestItem, SectionHeader } from "../components/items";
import { fmtDate, glueLast, noticeView } from "../lib/format";
import { BackLink, Button, Choice, ContestNote, EmptyState, ErrorState, Glass, LoadingBlock, Mark } from "../components/ui";

export function NotificationsPage() {
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: Note[] }>("/api/notifications") });
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const run = useAction();
  const [showRead, setShowRead] = useState(false);
  const [kind, setKind] = useState("all");
  const { user } = useAuth();
  if (notes.isLoading) return <LoadingBlock />;
  if (notes.error) return <ErrorState text="Уведомления не загрузились" onRetry={() => void notes.refetch()} />;
  const items = (notes.data?.notifications ?? []).filter((note) => showRead ? Boolean(note.readAt) : !note.readAt).filter((note) => kind === "all" || noticeKind(note) === kind);
  const mark = (ids: number[] | "all") => {
    queryClient.setQueryData<{ notifications: Note[] }>(["notifications"], (old) => {
      if (!old) return old;
      const now = new Date().toISOString();
      return { notifications: old.notifications.map((note) => (ids === "all" || ids.includes(note.id)) && !note.readAt ? { ...note, readAt: now } : note) };
    });
    void run("mark_notifications_read", ids === "all" ? { all: true } : { ids });
  };
  return (
    <div className="stagger space-y-3" data-agent-target="notifications">
      <div className="notice-head sticky top-0 z-20 -mx-4 space-y-2 px-4 pb-5 pt-1">
        <h1>Уведомления</h1>
        {showRead || items.length === 0 ? null : <Button className="h-11 w-full whitespace-nowrap" variant="glass" data-agent-action="notification-read-all" onClick={() => mark("all")}>Прочитать все</Button>}
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10" role="group" aria-label="Какие уведомления">
        <button type="button" className={`h-11 whitespace-nowrap rounded-full text-sm font-semibold ${showRead ? "" : "bg-[var(--primary)] text-[var(--primary-ink)]"}`} aria-pressed={!showRead} onClick={() => setShowRead(false)}>Новые</button>
        <button type="button" className={`h-11 whitespace-nowrap rounded-full text-sm font-semibold ${showRead ? "bg-[var(--primary)] text-[var(--primary-ink)]" : ""}`} aria-pressed={showRead} onClick={() => setShowRead(true)}>Прочитанные</button>
      </div>
      {user?.role === "student" ? <Upcoming /> : null}
      <div className="chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Тип уведомлений">
        {NOTICE_KINDS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={kind === id} className={`btn h-11 shrink-0 px-3 ${kind === id ? "btn-primary" : "btn-quiet"}`} onClick={() => setKind(id)}>{label}</button>
        ))}
      </div>
      {items.length === 0 ? <EmptyState title={showRead ? "Пусто" : "Тихо"} text={showRead ? "Прочитанных уведомлений нет." : "Новых объявлений и напоминаний нет."} /> : ["Сегодня", "На неделе", "Раньше"].map((bucket) => {
        const group = items.filter((note) => noteBucket(note) === bucket);
        if (!group.length) return null;
        return (
          <section key={bucket} className="space-y-2">
            <SectionHeader title={bucket} />
            <AnimatePresence initial={false}>
              {group.map((note) => {
                const view = noticeView(note);
                return (
                  <motion.div key={note.id} className="overflow-hidden" exit={reduce ? undefined : { opacity: 0, height: 0 }} transition={{ duration: 0.22 }}>
                    <SwipeNote unread={!note.readAt} onRead={() => mark([note.id])}>
                      <NotificationItem type={view.type} title={view.title} body={view.body} at={note.createdAt ?? new Date().toISOString()} unread={!note.readAt} href={note.href ?? undefined} />
                    </SwipeNote>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}

const NOTICE_KINDS = [["all", "Все"], ["announcement", "Объявления"], ["deadline", "Сроки и задания"], ["schedule", "Расписание"], ["grade", "Оценки"], ["request", "Заявки"]] as const;

function noticeKind(note: Note) {
  const type = noticeView(note).type;
  if (type === "work" || type === "returned") return "deadline";
  return type;
}

/** Напоминания о сроках и свежие объявления деканата — сверху, даже если уведомления прочитаны. */
function Upcoming() {
  const homework = useQuery({ queryKey: ["homework"], queryFn: () => api<{ homework: { id: number; title: string; discipline: string; deadline: string; submission: { status: string } | null }[] }>("/api/homework") });
  const news = useQuery({ queryKey: ["announcements"], queryFn: () => api<{ announcements: { id: number; title: string; body: string; createdAt?: string }[] }>("/api/announcements") });
  const today = moscowToday();
  const soon = (homework.data?.homework ?? [])
    .filter((work) => work.deadline >= today && (!work.submission || ["not_started", "in_progress", "returned"].includes(work.submission.status)))
    .map((work) => ({ ...work, days: Math.round((Date.parse(work.deadline) - Date.parse(today)) / 86_400_000) }))
    .filter((work) => work.days <= 7)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 3);
  const latest = (news.data?.announcements ?? []).slice(0, 2);
  if (!soon.length && !latest.length) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {soon.length ? (
        <Glass target="notice-deadlines">
          <p className="text-sm font-semibold">Скоро сроки</p>
          <ul className="mt-2 space-y-1">
            {soon.map((work) => (
              <li key={work.id}>
                <Link to={`/homework/${work.id}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
                  <span className="min-w-0 truncate">{work.title}<span className="block text-xs text-[var(--muted)]">{work.discipline}</span></span>
                  <span className={`shrink-0 text-xs font-semibold ${work.days <= 1 ? "text-[var(--risk-high-fg)]" : "text-[var(--muted)]"}`}>{work.days === 0 ? "сегодня" : work.days === 1 ? "завтра" : `${fmtDate(work.deadline, "short")} · ${work.days} дн.`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Glass>
      ) : null}
      {latest.length ? (
        <Glass target="notice-news">
          <p className="text-sm font-semibold">Объявления деканата</p>
          <ul className="mt-2 space-y-2">
            {latest.map((item) => (
              <li key={item.id} className="text-sm"><p className="font-semibold">{item.title}</p><p className="line-clamp-2 text-[var(--muted)]">{item.body}</p></li>
            ))}
          </ul>
        </Glass>
      ) : null}
    </div>
  );
}

function SwipeNote({ children, onRead, unread = false }: { children: ReactNode; onRead: () => void; unread?: boolean }) {
  const [x, setX] = useState(0);
  const start = useRef(0);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layer = useRef<HTMLDivElement>(null);
  const open = x < -8;
  useEffect(() => {
    if (layer.current) layer.current.inert = !open;
  }, [open]);
  return (
    <div className="relative overflow-hidden rounded-[1.75rem]">
      <div ref={layer} className="absolute inset-y-0 right-0 flex w-28 items-stretch" style={{ opacity: open ? 1 : 0, visibility: open ? "visible" : "hidden" }} aria-hidden={open ? undefined : true}>
        <button type="button" className="w-full bg-[var(--primary)] text-sm font-semibold text-[var(--primary-ink)]" tabIndex={open ? 0 : -1} data-agent-action="notification-read" onClick={onRead}>Прочитано</button>
      </div>
      <div
        className="note-card relative"
        style={{ transform: `translateX(${x}px)`, transition: reduced ? "none" : "transform 180ms ease" }}
        onTouchStart={(event) => { start.current = event.touches[0]?.clientX ?? 0; }}
        onTouchMove={(event) => {
          const dx = (event.touches[0]?.clientX ?? 0) - start.current;
          if (dx < 0) setX(Math.max(dx, -112));
        }}
        onTouchEnd={() => {
          if (x < -72) onRead();
          setX(0);
        }}
      >
        {children}
        {unread ? (
          <button
            type="button"
            className="note-read"
            data-agent-action="notification-read"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRead();
            }}
          >
            Прочитано
          </button>
        ) : null}
      </div>
    </div>
  );
}

function noteBucket(note: Note) {
  const day = (note.createdAt ?? "").slice(0, 10);
  const today = moscowToday();
  if (!day || day === today) return "Сегодня";
  const age = (Date.parse(today) - Date.parse(day)) / 86_400_000;
  return age < 7 ? "На неделе" : "Раньше";
}

interface Note { id: number; kind?: string; title: string; body: string; href: string | null; readAt: string | null; createdAt?: string }

export function ProfilePage() {
  const { user } = useAuth();
  const run = useAction();
  if (!user) return null;
  const rows = [
    ["ФИО", user.fullName],
    ["Факультет (институт)", user.institute],
    ["Направление", user.direction],
    ["Курс", user.course ? String(user.course) : null],
    ["Группа", user.groupName],
    ["Номер зачётки", user.recordBook],
  ].filter((row) => row[1]);
  return (
    <div className="space-y-4" data-agent-target="profile">
      <BackLink to="/" />
      <h1>Профиль</h1>
      <Glass>
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--primary)] text-lg text-[var(--primary-ink)]">{user.initials}</span>
          <div className="min-w-0">
            <p className="t-title item-title">{user.fullName}</p>
            <p className="t-muted">{user.role === "teacher" ? "Преподаватель" : user.role === "staff" ? "Учебный офис" : "Студент"}</p>
            {user.groupName ? <span className="t-chip mt-1 inline-flex rounded-full bg-white/70 px-2 py-1">{user.groupName}</span> : null}
          </div>
        </div>
        <dl className="space-y-2">
          {rows.map(([label, value]) => (
            <Fact key={label} label={String(label)} value={String(value)} />
          ))}
        </dl>
        <p className="mt-3 text-xs text-[var(--muted)]">ФИО, группа и направление приходят из учебного офиса. Ошибку можно исправить заявлением.</p>
      </Glass>
      <Glass>
        <h2 className="text-lg font-semibold">Настройки</h2>
        <div className="mt-3">
          <Choice label="Тема" value={user.theme} options={[{ value: "system", label: "Как в системе" }, { value: "light", label: "Светлая" }, { value: "dark", label: "Тёмная" }]} onChange={(value) => void run("update_settings", { theme: value })} />
        </div>
        <button type="button" role="switch" aria-checked={user.showCancelled} className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm" onClick={() => void run("update_settings", { showCancelled: !user.showCancelled })}>
          <span>Показывать отменённые пары</span>
          <span className={`h-7 w-12 rounded-full p-1 ${user.showCancelled ? "bg-[var(--primary)]" : "bg-black/15"}`}><span className={`block h-5 w-5 rounded-full bg-white transition ${user.showCancelled ? "translate-x-5" : ""}`} /></span>
        </button>
      </Glass>
      <Glass>
        <h2 className="text-lg font-semibold">Локальный режим</h2>
        <div className="mt-2"><ModelControls /></div>
      </Glass>
      <ContestNote />
    </div>
  );
}

export function AuditPage() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<{ events: Audit[] }>("/api/audit") });
  const run = useAction();
  if (audit.isLoading) return <LoadingBlock />;
  if (audit.error) return <ErrorState text="Журнал не загрузился" onRetry={() => void audit.refetch()} />;
  const events = audit.data?.events ?? [];
  return (
    <div className="space-y-4" data-agent-target="audit">
      <BackLink to="/" />
      <h1>Что делал агент</h1>
      <p className="text-sm text-[var(--muted)]">Здесь шаги агента и ваши действия из кабинета. Обратимое можно вернуть.</p>
      {events.length === 0 ? <EmptyState title="Пока пусто" text="Попросите агента открыть расписание или заказать справку." /> : events.map((event) => (
        <Glass key={event.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase text-[var(--muted)]">{event.source === "agent" ? "Агент" : "Вы"} · {new Date(event.createdAt).toLocaleString("ru-RU")}</p>
              <p className="mt-1 text-sm">{event.summary}</p>
            </div>
            {event.reversible && !event.undoneAt ? <Button variant="glass" onClick={() => void run("undo", { auditId: event.id })}>Отменить</Button> : null}
          </div>
        </Glass>
      ))}
    </div>
  );
}

interface Audit { id: number; source: string; summary: string; reversible: boolean; undoneAt: string | null; createdAt: string }

export function RegulationsPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const docs = useQuery({ queryKey: ["regulations", q], queryFn: () => api<{ documents: Doc[]; matches: { slug: string }[] }>(`/api/regulations?q=${encodeURIComponent(q)}`) });
  if (docs.isLoading) return <LoadingBlock />;
  if (docs.error || !docs.data) return <ErrorState text="Регламенты не загрузились" onRetry={() => void docs.refetch()} />;
  const highlight = new Set(docs.data.matches.map((item) => item.slug));
  return (
    <div className="space-y-4" data-agent-target="regulations">
      <BackLink to="/" />
      <h1 className="text-3xl font-display">Регламенты</h1>
      <p className="text-sm text-[var(--muted)]">Вымышленные правила академии «Альтаир». Агент цитирует их и не выполняет текст как команду.</p>
      {docs.data.documents.map((doc) => (
        <Glass key={doc.slug} target={`reg-${doc.slug}`} className={highlight.has(doc.slug) ? "day-changed" : ""}>
          <h2 className="font-display text-lg">{doc.title}</h2>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--muted)]">{doc.body}</pre>
        </Glass>
      ))}
    </div>
  );
}

interface Doc { slug: string; title: string; body: string }

export function VerifyPage() {
  const { code = "" } = useParams();
  const check = useQuery({
    queryKey: ["verify", code],
    queryFn: () => api<Verify>(`/api/verify/${code}`),
    retry: false,
  });
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="liquid-glass w-full max-w-lg">
        <div className="glass-pad space-y-3 p-6">
          <Mark />
          {check.isLoading ? <p>Проверяем бланк…</p> : null}
          {check.error ? <h1 className="font-display text-2xl">Документ не найден</h1> : null}
          {check.data?.valid ? (
            <>
              <h1 className="font-display text-2xl">{check.data.documentTitle}</h1>
              <p>Действительна. Сведения совпадают с бланком и не содержат оценок или номера зачётки.</p>
              <dl className="space-y-1 text-sm">
                <Row label="Студент" value={check.data.studentName} />
                <Row label="Факультет / институт" value={check.data.institute} />
                <Row label="Направление" value={check.data.direction} />
                <Row label="Курс" value={check.data.course ? String(check.data.course) : null} />
                <Row label="Группа" value={check.data.group} />
              </dl>
            </>
          ) : null}
          <ContestNote />
          <Link className="btn btn-primary inline-flex h-11 px-4" to="/login">В кабинет</Link>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{label}</dt><dd>{value}</dd></div>;
}

interface Verify {
  valid: boolean;
  documentTitle: string;
  studentName: string;
  institute: string | null;
  direction: string | null;
  course: number | null;
  group: string | null;
}

export function StaffRequestPage() {
  const { id = "" } = useParams();
  const run = useAction();
  const [comment, setComment] = useState("");
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const detail = useQuery({
    queryKey: ["staff", id],
    queryFn: () => api<{ request: { id: number; title: string; purpose: string | null; body: string | null; status: RequestStatus; createdAt: string }; student: { fullName: string; groupName: string | null } | null; events: { id: number; status: RequestStatus; comment: string | null }[]; triage: { category: string; summary: string; suggestedReply: string; suggestedStatus: string } }>(`/api/staff/requests/${id}`),
  });
  if (detail.isLoading) return <LoadingBlock />;
  if (detail.error || !detail.data) return <ErrorState text="Заявка недоступна" />;
  const triage = detail.data.triage;
  const allowed = STAFF_CHOICES.filter((option) => (REQUEST_NEXT[detail.data.request.status] ?? []).includes(option.value as never));
  const suggested = allowed.find((option) => option.value === triage.suggestedStatus)?.value;
  const status = allowed.some((option) => option.value === picked) ? picked : suggested ?? allowed[0]?.value ?? "";
  const setStatus = setPicked;
  return (
    <div className="space-y-4" data-agent-target={`staff-request-${id}`}>
      <BackLink to="/staff" />
      <h1 className="t-page item-title">{detail.data.request.title}</h1>
      <RequestItem href={`/staff/requests/${id}`} number={detail.data.request.id} title={detail.data.request.title} statusLabel={STATUS_LABEL[detail.data.request.status]} createdAt={detail.data.request.createdAt} student={detail.data.student?.fullName} group={detail.data.student?.groupName ?? undefined} purpose={detail.data.request.purpose ?? undefined} />
      <Glass>
        <Fact label="Студент" value={detail.data.student?.fullName ?? "Студент"} />
        <Fact label="Группа" value={detail.data.student?.groupName ?? "Группа"} />
        <p className="mt-3 text-sm">{triage.summary}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">{detail.data.request.body}</p>
      </Glass>
      <Glass>
        <label className="mt-3 block text-sm font-semibold" htmlFor={`staff-reply-${id}`}>
          Комментарий к ответу
          <textarea id={`staff-reply-${id}`} className="field mt-1 min-h-28 py-3" value={comment || triage.suggestedReply} onChange={(event) => setComment(event.target.value)} />
        </label>
        {allowed.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">Заявка закрыта: статус «{STATUS_LABEL_SAFE[detail.data.request.status]}» больше не меняется.</p> : <div className="mt-3 space-y-3">
          <Choice label="Статус" value={status} options={allowed} onChange={setStatus} />
          <Button onClick={() => {
            setError("");
            void run("staff_set_status", { requestId: Number(id), status, comment: comment || triage.suggestedReply }).catch((err: Error) => setError(err.message));
          }}>Сохранить статус</Button>
        </div>}
        {error ? <p className="mt-2 text-sm text-[var(--risk-high-fg)]">{error}</p> : null}
        <p className="mt-2 text-xs text-[var(--muted)]">Предложенный статус: {STATUS_LABEL[triage.suggestedStatus as RequestStatus] ?? triage.suggestedStatus}</p>
      </Glass>
      <Glass>
        <ol className="timeline space-y-3 pl-4">
          {detail.data.events.map((event) => (
            <li key={event.id}><p className="font-semibold">{STATUS_LABEL_SAFE[event.status]}</p><p className="text-sm text-[var(--muted)]">{event.comment ? glueLast(event.comment) : null}</p></li>
          ))}
        </ol>
      </Glass>
    </div>
  );
}

const STAFF_CHOICES = [{ value: "in_progress", label: "В работе" }, { value: "ready", label: "Готова" }, { value: "issued", label: "Выдана" }, { value: "rejected", label: "Отклонена" }];

const STATUS_LABEL_SAFE: Record<string, string> = {
  submitted: "Подана",
  in_progress: "В работе",
  ready: "Готова",
  issued: "Выдана",
  rejected: "Отклонена",
  withdrawn: "Отозвана",
};

export function StaffAnnouncePage() {
  const run = useAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => {
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<{ field: string; value: string }>).detail;
      if (detail.field === "announce-title") setTitle(detail.value);
      if (detail.field === "announce-body") setBody(detail.value);
    };
    window.addEventListener("altair-fill", onFill);
    return () => window.removeEventListener("altair-fill", onFill);
  }, []);
  const list = useQuery({ queryKey: ["announcements"], queryFn: () => api<{ announcements: { id: number; title: string; body: string }[] }>("/api/announcements") });
  return (
    <div className="space-y-4" data-agent-target="announcements">
      <BackLink to="/staff" />
      <h1>Объявления</h1>
      <Glass>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void run("staff_publish_announcement", { title, body }).then(() => {
            setDone("Опубликовано, студенты получили уведомление.");
            setTitle("");
            setBody("");
            void list.refetch();
          });
        }}>
          <input className="field" data-agent-field="announce-title" placeholder="Заголовок" value={title} onChange={(event) => setTitle(event.target.value)} required />
          <textarea className="field min-h-28 py-3" data-agent-field="announce-body" placeholder="Текст" value={body} onChange={(event) => setBody(event.target.value)} required />
          <Button data-agent-action="staff-publish">Опубликовать</Button>
          {done ? <p className="text-sm">{done}</p> : null}
        </form>
      </Glass>
      {list.data?.announcements.map((item) => (
        <NotificationItem key={item.id} type="announcement" title={item.title} body={item.body} at="2026-11-21" unread={false} />
      ))}
    </div>
  );
}

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <EmptyState title="Такой страницы нет" text="Вернитесь в кабинет." action={<Link className="btn btn-primary" to="/">На главную</Link>} />
    </main>
  );
}
