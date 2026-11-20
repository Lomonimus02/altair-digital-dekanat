import { useQuery } from "@tanstack/react-query";
import { STATUS_LABEL, type RequestStatus } from "@shared/domain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { useAuth } from "../lib/auth";
import { ModelControls } from "../components/agent-panel";
import { BackLink, Button, Choice, ContestNote, EmptyState, ErrorState, Glass, LoadingBlock, Mark } from "../components/ui";

export function NotificationsPage() {
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: Note[] }>("/api/notifications") });
  const run = useAction();
  if (notes.isLoading) return <LoadingBlock />;
  if (notes.error) return <ErrorState text="Уведомления не загрузились" onRetry={() => void notes.refetch()} />;
  const items = notes.data?.notifications ?? [];
  return (
    <div className="space-y-3" data-agent-target="notifications">
      <div className="sticky top-0 z-20 flex min-w-0 flex-wrap items-center justify-between gap-2 bg-[var(--bg,transparent)] py-1">
        <h1 className="min-w-0">Уведомления</h1>
        <Button className="h-11 shrink-0 whitespace-nowrap px-4" variant="glass" data-agent-action="notification-read-all" onClick={() => void run("mark_notifications_read", { all: true })}>Прочитать все</Button>
      </div>
      {items.length === 0 ? <EmptyState title="Тихо" text="Новых объявлений и напоминаний нет." /> : items.map((note) => {
        const body = (
          <div className="flex min-h-11 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-semibold">{note.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{note.body}</p>
            </div>
            {!note.readAt ? (
              <button type="button" className="btn btn-quiet h-11 shrink-0 px-3" data-agent-action="notification-read" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void run("mark_notifications_read", { ids: [note.id] }); }}>Прочитано</button>
            ) : null}
          </div>
        );
        return (
          <SwipeNote key={note.id} onRead={() => void run("mark_notifications_read", { ids: [note.id] })}>
            {note.href ? <Link to={note.href} className="liquid-glass block"><div className="glass-pad p-4">{body}</div></Link> : <Glass>{body}</Glass>}
          </SwipeNote>
        );
      })}
    </div>
  );
}

function SwipeNote({ children, onRead }: { children: ReactNode; onRead: () => void }) {
  const [x, setX] = useState(0);
  const start = useRef(0);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="relative overflow-hidden rounded-[1.75rem]">
      <div className="absolute inset-y-0 right-0 flex w-28 items-stretch">
        <button type="button" className="w-full bg-[var(--primary)] text-sm font-semibold text-[var(--primary-ink)]" data-agent-action="notification-read" onClick={onRead}>Прочитано</button>
      </div>
      <div
        className="relative"
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
      </div>
    </div>
  );
}

interface Note { id: number; title: string; body: string; href: string | null; readAt: string | null }

export function ProfilePage() {
  const { user } = useAuth();
  const run = useAction();
  if (!user) return null;
  const rows = [
    ["ФИО", user.fullName],
    ["Факультет / институт", user.institute],
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
            <p className="line-clamp-2 text-xl font-semibold">{user.fullName}</p>
            <p className="text-sm text-[var(--muted)]">{user.role === "teacher" ? "Преподаватель" : user.role === "staff" ? "Учебный офис" : "Студент"}</p>
            {user.groupName ? <span className="mt-1 inline-flex rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">{user.groupName}</span> : user.role === "teacher" ? <p className="text-sm text-[var(--muted)]">БИ-3-26-04 · ЮР-1-26-02</p> : user.role === "staff" ? <p className="text-sm text-[var(--muted)]">Сотрудник учебного офиса</p> : null}
          </div>
        </div>
        <dl className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-t border-white/40 py-2 text-sm">
              <dt className="text-[var(--muted)]">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
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
  const [status, setStatus] = useState("in_progress");
  const [error, setError] = useState("");
  const detail = useQuery({
    queryKey: ["staff", id],
    queryFn: () => api<{ request: { id: number; title: string; purpose: string | null; body: string | null; status: RequestStatus }; student: { fullName: string; groupName: string | null } | null; events: { id: number; status: RequestStatus; comment: string | null }[]; triage: { category: string; summary: string; suggestedReply: string; suggestedStatus: string } }>(`/api/staff/requests/${id}`),
  });
  if (detail.isLoading) return <LoadingBlock />;
  if (detail.error || !detail.data) return <ErrorState text="Заявка недоступна" />;
  const triage = detail.data.triage;
  return (
    <div className="space-y-4" data-agent-target={`staff-request-${id}`}>
      <BackLink to="/staff" />
      <h1 className="line-clamp-2">{detail.data.request.title}</h1>
      <p className="text-sm text-[var(--muted)]">№{detail.data.request.id} · {STATUS_LABEL[detail.data.request.status]}</p>
      <Glass>
        <p className="text-xs uppercase text-[var(--muted)]">{triage.category}</p>
        <p className="mt-1 text-sm">{detail.data.student?.fullName} · {detail.data.student?.groupName}</p>
        <p className="mt-3 text-sm">{triage.summary}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">{detail.data.request.body}</p>
      </Glass>
      <Glass>
        <h2 className="font-display text-lg">Ответ</h2>
        <textarea className="field mt-3 min-h-28 py-3" value={comment || triage.suggestedReply} onChange={(event) => setComment(event.target.value)} />
        <div className="mt-3 space-y-3">
          <Choice label="Статус" value={status} options={[{ value: "in_progress", label: "В работе" }, { value: "ready", label: "Готова" }, { value: "issued", label: "Выдана" }, { value: "rejected", label: "Отклонена" }]} onChange={setStatus} />
          <Button onClick={() => {
            setError("");
            void run("staff_set_status", { requestId: Number(id), status, comment: comment || triage.suggestedReply }).catch((err: Error) => setError(err.message));
          }}>Сохранить статус</Button>
        </div>
        {error ? <p className="mt-2 text-sm text-[var(--risk-high-fg)]">{error}</p> : null}
        <p className="mt-2 text-xs text-[var(--muted)]">Предложенный статус: {STATUS_LABEL[triage.suggestedStatus as RequestStatus] ?? triage.suggestedStatus}</p>
      </Glass>
      <Glass>
        <ol className="timeline space-y-3 pl-4">
          {detail.data.events.map((event) => (
            <li key={event.id}><p className="font-semibold">{STATUS_LABEL_SAFE[event.status]}</p><p className="text-sm text-[var(--muted)]">{event.comment}</p></li>
          ))}
        </ol>
      </Glass>
    </div>
  );
}

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
        <Glass key={item.id}><h2 className="font-semibold">{item.title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{item.body}</p></Glass>
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
