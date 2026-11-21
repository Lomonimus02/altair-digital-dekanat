import { useQuery } from "@tanstack/react-query";
import { REQUEST_KINDS, STATUS_LABEL, type RequestStatus } from "@shared/domain";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAction } from "../lib/action";
import { RequestItem, SectionHeader } from "../components/items";
import { glueLast } from "../lib/format";
import { BackLink, Button, Choice, EmptyState, ErrorState, Glass, LoadingBlock, Pill } from "../components/ui";

interface RequestRow {
  id: number;
  kind: string;
  title: string;
  purpose: string | null;
  body: string | null;
  status: RequestStatus;
  statusLabel: string;
  rejectionReason: string | null;
  resultNote: string | null;
  downloadable: boolean;
  createdAt: string;
}

export function RequestsPage() {
  const list = useQuery({ queryKey: ["requests"], queryFn: () => api<{ requests: RequestRow[] }>("/api/requests") });
  if (list.isLoading) return <LoadingBlock />;
  if (list.error) return <ErrorState text="Заявки не загрузились" onRetry={() => void list.refetch()} />;
  return (
    <div className="stagger space-y-4 pb-16 md:pb-0" data-agent-target="requests">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1>Заявки и справки</h1>
          <p className="text-sm text-[var(--muted)]">Справка об обучении появляется сразу. Остальное уходит в учебный офис.</p>
        </div>
        <Link className="btn btn-primary max-md:sr-only" to="/requests/new" data-agent-action="request-new">Новая</Link>
      </div>
      {list.data?.requests.length ? (
        <>
          <SectionHeader title="Заявки" count={list.data.requests.length} />
          {list.data.requests.map((row) => (
            <div key={row.id} data-agent-target={`request-${row.id}`}>
              <RequestItem href={`/requests/${row.id}`} number={row.id} title={row.title} statusLabel={STATUS_LABEL[row.status]} createdAt={row.createdAt} purpose={row.purpose ?? undefined} />
            </div>
          ))}
        </>
      ) : (
        <EmptyState title="Заявок нет" text="Можно заказать справку об обучении — бланк будет готов сразу." action={<Link className="btn btn-primary" to="/requests/new" data-agent-action="request-new">Заказать</Link>} />
      )}
      <Link className="btn btn-primary fixed inset-x-4 z-40 md:hidden" style={{ bottom: "calc(5.75rem + env(safe-area-inset-bottom))" }} to="/requests/new" data-agent-action="request-new">Новая заявка</Link>
    </div>
  );
}

export function NewRequestPage() {
  const run = useAction();
  const navigate = useNavigate();
  const [kind, setKind] = useState<string>(REQUEST_KINDS[0].id);
  const [purpose, setPurpose] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<{ field: string; value: string }>).detail;
      if (detail.field === "purpose") setPurpose(detail.value);
      if (detail.field === "comment") setComment(detail.value);
      if (detail.field === "kind") setKind(detail.value);
    };
    window.addEventListener("altair-fill", onFill);
    return () => window.removeEventListener("altair-fill", onFill);
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await run("create_request", { kind, purpose: purpose || undefined, comment: comment || undefined });
      const target = response.ui?.find((item) => item.type === "navigate" && item.to.startsWith("/requests/"));
      if (target && target.type === "navigate") navigate(target.to);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не отправилось");
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="mx-auto max-w-xl space-y-4" onSubmit={(event) => void submit(event)} data-agent-target="new-request">
      <BackLink to="/requests" />
      <h1>Новая заявка</h1>
      <Glass>
        <p className="mb-2 text-sm font-semibold">Что нужно</p>
        <Choice label="Что нужно" value={kind} options={REQUEST_KINDS.map((item) => ({ value: item.id, label: `${item.title}${item.instant ? " · сразу" : ""}` }))} onChange={setKind} />
        <label className="mt-3 block text-sm font-semibold">
          Назначение
          <input className="field mt-1" data-agent-field="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Куда и зачем" />
        </label>
        <label className="mt-3 block text-sm font-semibold">
          Комментарий
          <textarea className="field mt-1 min-h-28 py-3" data-agent-field="comment" value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        {error ? <p className="mt-3 text-sm text-[var(--risk-high-fg)]">{error}</p> : null}
        <div className="form-sticky mt-4">
          <Button disabled={pending} data-agent-action="request-submit">{pending ? "Отправляем…" : "Подать"}</Button>
        </div>
      </Glass>
    </form>
  );
}

export function RequestPage() {
  const { id = "" } = useParams();
  const run = useAction();
  const detail = useQuery({
    queryKey: ["requests", id],
    queryFn: () => api<{ request: RequestRow; events: { id: number; status: RequestStatus; comment: string | null; createdAt: string }[] }>(`/api/requests/${id}`),
  });
  if (detail.isLoading || (detail.isFetching && !detail.data)) return (
    <div className="space-y-3" aria-busy="true">
      <div data-ui="notification"><div data-ui-part="title" className="t-title">Загрузка</div></div>
      <div className="skeleton h-11 w-28" />
      <div className="skeleton h-10 w-2/3" />
      <div className="skeleton h-36 w-full" />
      <div className="skeleton h-24 w-full" />
    </div>
  );
  if (detail.error || !detail.data) return <ErrorState text="Заявка не найдена или недоступна" />;
  const row = detail.data.request;
  return (
    <div className="space-y-4" data-agent-target={`request-${row.id}`}>
      <BackLink to="/requests" />
      <h1 className="t-page item-title" title={row.title}>{row.title}</h1>
      <RequestItem href={`/requests/${row.id}`} number={row.id} title={row.title} statusLabel={STATUS_LABEL[row.status]} createdAt={row.createdAt} purpose={row.purpose ?? undefined} />
      <Glass>
        <p className="text-sm">{row.purpose}</p>
        {row.body ? <p className="mt-2 text-sm text-[var(--muted)]">{row.body}</p> : null}
        {row.resultNote ? <p className="mt-3 text-sm">Ответ офиса: {row.resultNote}</p> : null}
        {row.rejectionReason ? <p className="mt-3 text-sm text-[var(--risk-high-fg)]">Причина отказа: {row.rejectionReason}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {row.downloadable ? <a className="btn btn-primary" href={`/api/requests/${row.id}/pdf`}>Скачать PDF</a> : null}
          {row.status === "submitted" || row.status === "in_progress" ? (
            <Button variant="glass" data-agent-action="request-cancel" onClick={() => void run("cancel_request", { requestId: row.id })}>Отозвать</Button>
          ) : null}
        </div>
      </Glass>
      <Glass>
        <h2 className="font-display text-lg">Статус</h2>
        <ol className="timeline mt-3 space-y-3 pl-4">
          {detail.data.events.map((event) => (
            <li key={event.id}>
              <p className="font-semibold">{STATUS_LABEL[event.status]}</p>
              <p className="text-sm text-[var(--muted)]">{event.comment ? glueLast(event.comment) : null}</p>
            </li>
          ))}
        </ol>
      </Glass>
    </div>
  );
}

function tone(status: RequestStatus): "low" | "mid" | "high" {
  if (status === "rejected") return "high";
  if (status === "in_progress" || status === "submitted") return "mid";
  return "low";
}
