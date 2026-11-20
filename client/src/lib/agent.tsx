import { formatDdMm } from "@shared/dates";
import type { AnswerCard, ChoiceChip, Citation, ConfirmCard, PublicUser, UiDirective } from "@shared/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import { playTurn } from "./operator";
import { applyDirectives } from "./theme";
import { hasWebGPU, loadModel, proposeLocally, suggestedSize, type ModelSize } from "./webllm";

export interface AgentMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  caption?: string;
  steps?: { label: string; status: "ok" | "error" | "skipped" | "wait"; tool?: string }[];
  confirm?: ConfirmCard;
  citations?: Citation[];
  download?: { href: string; label: string };
  undo?: { auditId: number; label: string };
  undone?: boolean;
  link?: { to: string; label: string };
  cards?: AnswerCard[];
  choices?: ChoiceChip[];
}

interface AgentValue {
  messages: AgentMessage[];
  draft: string;
  setDraft: (value: string) => void;
  busy: boolean;
  open: boolean;
  setOpen: (value: boolean) => void;
  peek: boolean;
  setPeek: (value: boolean) => void;
  peekLine: string;
  ask: (text: string) => void;
  send: (text?: string) => Promise<void>;
  confirm: (pendingId: string) => Promise<void>;
  clarify: (choice: ChoiceChip) => Promise<void>;
  reject: (pendingId: string) => Promise<void>;
  undo: (auditId: number) => Promise<void>;
  run: (action: string, args?: Record<string, unknown>) => Promise<void>;
  gpu: boolean | null;
  modelState: "idle" | "loading" | "ready" | "error";
  modelProgress: number;
  modelText: string;
  modelSize: ModelSize;
  startModel: (size?: ModelSize) => Promise<void>;
  serverModel: boolean;
  useServer: boolean;
  setUseServer: (value: boolean) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  operator: string | null;
  stop: () => void;
}

const AgentContext = createContext<AgentValue | null>(null);

function rid() {
  return Math.random().toString(36).slice(2);
}

export function AgentProvider({ user, children }: { user: PublicUser; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storageKey = `altair-chat:${user.id}`;
  const [messages, setMessages] = useState<AgentMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "[]");
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpenState] = useState(false);
  const [peek, setPeek] = useState(false);
  const [peekLine, setPeekLine] = useState("");
  const setOpen = (value: boolean) => {
    setOpenState(value);
    if (!value) setPeek(false);
  };
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [modelState, setModelState] = useState<AgentValue["modelState"]>("idle");
  const [modelProgress, setModelProgress] = useState(0);
  const [modelText, setModelText] = useState("");
  const [modelSize, setModelSize] = useState<ModelSize>(suggestedSize());
  const [useServer, setUseServer] = useState(false);
  const ready = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const config = useQuery({ queryKey: ["agent-config"], queryFn: () => api<{ serverModel: boolean }>("/api/agent/config") });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
  }, [messages, storageKey]);

  useEffect(() => {
    void hasWebGPU().then(setGpu);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const play = async (ui: UiDirective[] = [], steps: AgentMessage["steps"] = [], flash = false) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && steps.length > 1) await new Promise((resolve) => setTimeout(resolve, Math.min(700, steps.length * 180)));
    applyDirectives(ui, navigate, queryClient, { flash });
  };

  const send = async (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || busy) return;
    setDraft("");
    setPeek(false);
    setOpen(true);
    const history = messages.slice(-6).map((item) => ({ role: item.role === "user" ? "user" as const : "assistant" as const, content: item.text.slice(0, 500) }));
    setMessages((current) => [...current, { id: rid(), role: "user", text: message }]);
    setBusy(true);
    try {
      let proposal: unknown;
      let mode: "device" | "server" | "fallback" = "fallback";
      if (ready.current && !useServer) {
        try {
          proposal = await proposeLocally(user.role, message, history);
          mode = "device";
        } catch {
          proposal = undefined;
        }
      } else if (useServer && config.data?.serverModel) mode = "server";
      let response: Turn;
      try {
        response = await api<Turn>("/api/agent/turn", {
          method: "POST",
          body: JSON.stringify({ message, history, mode, proposal }),
        });
      } catch (error) {
        if (!proposal) throw error;
        response = await api<Turn>("/api/agent/turn", { method: "POST", body: JSON.stringify({ message, mode: "fallback" }) });
      }
      const navigateTo = response.ui?.find((item) => item.type === "navigate");
      const wide = window.matchMedia("(min-width: 768px)").matches;
      const say = response.say;
      const abort = new AbortController();
      abortRef.current = abort;
      const tools = (response.steps ?? []).flatMap((step) => (step.tool ? [step.tool] : []));
      const first = response.steps?.find((step) => step.status === "ok")?.label ?? "Выполняю…";
      setOperator(first);
      if (!wide) {
        setPeekLine(first);
        setPeek(true);
        setOpen(true);
      }
      inputRef.current?.blur();
      await playTurn({
        tools,
        open: response.open ?? navigateTo?.to,
        fields: response.confirm?.fields ?? [],
        navigate,
        signal: abort.signal,
        onStep: (label) => {
          setOperator(label);
          if (!wide) setPeekLine(label);
        },
      });
      if (!abort.signal.aborted) await play(response.ui?.filter((item) => item.type !== "navigate"), response.steps, Boolean(navigateTo));
      setOperator(null);
      window.dispatchEvent(new CustomEvent("altair-cursor", { detail: { on: false, x: 0, y: 0 } }));
      if (abort.signal.aborted) {
        if (response.confirm) {
          await api("/api/agent/reject", { method: "POST", body: JSON.stringify({ pendingId: response.confirm.pendingId }) }).catch(() => undefined);
        }
        toast("Остановлено");
        setMessages((current) => [...current, { id: rid(), role: "agent", text: "Остановлено. Ничего не отправил." }]);
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: rid(),
          role: "agent",
          text: say,
          caption: response.caption === "Быстрый режим" ? "Локальный режим" : response.caption,
          steps: response.steps,
          confirm: response.confirm,
          citations: response.citations,
          download: response.download,
          undo: response.undo,
          link: response.link,
          cards: response.cards,
          choices: response.choices,
        },
      ]);
      if (!wide) {
        setPeek(false);
        setOpen(true);
      }
    } catch (error) {
      const textError = error instanceof ApiError ? error.message : "Не получилось ответить";
      setMessages((current) => [...current, { id: rid(), role: "agent", text: textError }]);
    } finally {
      setOperator(null);
      setBusy(false);
    }
  };

  const clarify = async (choice: ChoiceChip) => {
    if (busy) return;
    setPeek(false);
    setOpen(true);
    setMessages((current) => [...current, { id: rid(), role: "user", text: choice.label }]);
    setBusy(true);
    try {
      const response = await api<Turn>("/api/agent/clarify", {
        method: "POST",
        body: JSON.stringify({ clarificationId: choice.clarificationId, entityId: choice.entityId }),
      });
      const navigateTo = response.ui?.find((item) => item.type === "navigate");
      const wide = window.matchMedia("(min-width: 768px)").matches;
      setMessages((current) => [
        ...current,
        {
          id: rid(),
          role: "agent",
          text: response.say,
          caption: response.caption,
          confirm: response.confirm,
          cards: response.cards,
          choices: response.choices,
          download: response.download,
          undo: response.undo,
        },
      ]);
      if (navigateTo && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
      }
      await play(response.ui, [], Boolean(navigateTo));
      if (navigateTo && !wide) {
        setPeekLine(specificPeek(navigateTo.to, response.say));
        setPeek(true);
      }
    } catch (error) {
      const textError = error instanceof ApiError ? error.message : "Не получилось выбрать";
      setMessages((current) => [...current, { id: rid(), role: "agent", text: textError }]);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (pendingId: string) => {
    setBusy(true);
    try {
      const response = await api<ActionResult>("/api/agent/confirm", { method: "POST", body: JSON.stringify({ pendingId }) });
      const navigateTo = response.ui?.find((item) => item.type === "navigate");
      const wide = window.matchMedia("(min-width: 768px)").matches;
      setMessages((current) => [
        ...current.map((item) => (item.confirm?.pendingId === pendingId ? { ...item, confirm: undefined } : item)),
        { id: rid(), role: "agent", text: response.summary, download: response.download, undo: response.undoOffer, cards: response.cards },
      ]);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && navigateTo) {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
      }
      applyDirectives(response.ui, navigate, queryClient, { flash: Boolean(navigateTo) });
      if (response.undoOffer) {
        toast(response.summary, {
          action: { label: "Отменить", onClick: () => void undo(response.undoOffer!.auditId) },
        });
      }
      if (navigateTo && !wide) {
        setPeekLine(specificPeek(navigateTo.to, response.summary));
        setPeek(true);
      }
    } catch (error) {
      const textError = error instanceof ApiError ? error.message : "Не получилось подтвердить";
      setMessages((current) => [...current, { id: rid(), role: "agent", text: textError }]);
    } finally {
      setBusy(false);
    }
  };

  const reject = async (pendingId: string) => {
    await api("/api/agent/reject", { method: "POST", body: JSON.stringify({ pendingId }) }).catch(() => undefined);
    setMessages((current) => current.map((item) => (item.confirm?.pendingId === pendingId ? { ...item, confirm: undefined, text: `${item.text}\n\nПодтверждение отменено.` } : item)));
  };

  const run = async (action: string, args: Record<string, unknown> = {}) => {
    const response = await api<ActionResult>("/api/actions", { method: "POST", body: JSON.stringify({ action, args }) });
    applyDirectives(response.ui, navigate, queryClient);
    return response as unknown as void;
  };

  const undo = async (auditId: number) => {
    await run("undo", { auditId });
    setMessages((current) => current.map((item) => (item.undo?.auditId === auditId ? { ...item, undone: true } : item)).concat({ id: rid(), role: "agent", text: "Вернул предыдущее состояние." }));
  };

  const startModel = async (size?: ModelSize) => {
    const picked = size ?? modelSize;
    setModelSize(picked);
    setModelState("loading");
    setModelProgress(0);
    try {
      await loadModel(picked, (progress, text) => {
        setModelProgress(progress);
        setModelText(text);
      });
      ready.current = true;
      setModelState("ready");
    } catch (error) {
      ready.current = false;
      setModelState("error");
      setModelText(error instanceof Error ? error.message : "Модель не запустилась");
    }
  };

  const value: AgentValue = {
    messages,
    draft,
    setDraft,
    busy,
    open,
    setOpen,
    peek,
    setPeek,
    peekLine,
    ask: (text: string) => {
      setDraft(text);
      setPeek(false);
      setOpen(true);
    },
    send,
    confirm,
    clarify,
    reject,
    undo,
    run: async (action, args) => {
      await run(action, args);
    },
    gpu,
    modelState,
    modelProgress,
    modelText,
    modelSize,
    startModel,
    serverModel: Boolean(config.data?.serverModel),
    useServer,
    setUseServer,
    inputRef,
    operator,
    stop: () => {
      abortRef.current?.abort();
      setOperator(null);
      window.dispatchEvent(new CustomEvent("altair-cursor", { detail: { on: false, x: 0, y: 0 } }));
    },
  };

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

function navSentence(to: string) {
  if (to.startsWith("/schedule")) return "Открываю расписание.";
  if (to.startsWith("/grades")) return "Открываю оценки.";
  if (to.startsWith("/homework")) return "Открываю задания.";
  if (to.startsWith("/requests")) return "Открываю заявки.";
  if (to.startsWith("/teach")) return "Открываю кабинет преподавателя.";
  if (to.startsWith("/staff")) return "Открываю учебный офис.";
  return "Открываю раздел.";
}

function specificPeek(to: string, say: string) {
  const request = to.match(/\/requests\/(\d+)/);
  if (request) return `Показал заявку №${request[1]}`;
  const title = say.match(/«([^»]+)»/)?.[1];
  const url = new URL(to, "http://altair.local");
  if (to.includes("/teach/journal")) {
    const group = url.searchParams.get("group");
    const discipline = url.searchParams.get("discipline");
    return group && discipline ? `Показал журнал ${group}, ${discipline}` : "Показал журнал";
  }
  if (to.includes("/teach/homework/")) return title ? `Показал «${title}»` : "Показал работу";
  if (to.includes("/homework/")) return title ? `Показал «${title}»` : "Показал задание";
  if (to.startsWith("/schedule")) {
    const date = url.searchParams.get("date");
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `Показал расписание ${formatDdMm(date)}` : "Показал расписание";
  }
  if (to.startsWith("/grades")) return "Показал оценки";
  if (to.startsWith("/requests")) return "Показал заявки";
  return title ? `Показал «${title}»` : "Показал раздел";
}

export function useAgent() {
  const value = useContext(AgentContext);
  if (!value) throw new Error("AgentProvider");
  return value;
}

interface Turn {
  say: string;
  caption: string;
  steps: AgentMessage["steps"];
  ui: UiDirective[];
  confirm?: ConfirmCard;
  citations?: Citation[];
  download?: { href: string; label: string };
  undo?: { auditId: number; label: string };
  cards?: AnswerCard[];
  choices?: ChoiceChip[];
  link?: { to: string; label: string };
  open?: string;
}

interface ActionResult {
  summary: string;
  ui?: UiDirective[];
  download?: { href: string; label: string };
  undoOffer?: { auditId: number; label: string };
  cards?: AnswerCard[];
}
