import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAgent } from "../lib/agent";
import { scrollCellIntoView } from "../lib/operator";
import { AgentPanel } from "./agent-panel";

/** Keyboard inset from visualViewport. Writes --vv-kb so a manual --kb test hook still wins via max(). */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const nav = navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } };
    if (nav.virtualKeyboard) nav.virtualKeyboard.overlaysContent = true;
    const update = () => {
      const viewport = window.visualViewport;
      const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      const manual = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb")) || 0;
      const keyboard = Math.max(inset, manual);
      const next = `${Math.round(inset)}px`;
      if (document.documentElement.style.getPropertyValue("--vv-kb") !== next) {
        document.documentElement.style.setProperty("--vv-kb", next);
      }
      const flag = keyboard > 0 ? "1" : "0";
      if (document.documentElement.dataset.keyboard !== flag) document.documentElement.dataset.keyboard = flag;
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);
}

export function AgentSheet({ mode }: { mode: "sheet" | "drawer" }) {
  const agent = useAgent();
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const pushed = useRef(false);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const confirming = agent.messages.some((item) => item.confirm);
    if (mode !== "sheet" || !agent.open || agent.peek || confirming) {
      if (mode === "sheet") document.body.style.overflow = "";
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [agent.open, agent.peek, agent.messages, mode]);

  useEffect(() => {
    if (!agent.open) return;
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    history.pushState({ altairAgent: true }, "");
    pushed.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      pushed.current = false;
      agent.setOpen(false);
    };
    const onPop = () => {
      pushed.current = false;
      agent.setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    const focusTimer = window.setTimeout(() => {
      if (!agent.peek) agent.inputRef.current?.focus();
    }, 280);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      window.clearTimeout(focusTimer);
      pushed.current = false;
      restore.current?.focus();
    };
  }, [agent.open, mode]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) agent.setOpen(false);
  };

  const card = agent.open && !agent.peek && !agent.preferChat && agent.messages.some((item) => item.confirm);
  const phase = !agent.open ? "hidden" : agent.peek ? "peek" : card ? "card" : "expanded";
  const [cardHeight, setCardHeight] = useState(320);
  useLayoutEffect(() => {
    if (phase !== "card") return;
    const node = document.querySelector("[data-agent-confirm-card]");
    if (!(node instanceof HTMLElement)) return;
    const limit = Math.round(window.innerHeight * 0.45);
    const next = Math.min(Math.ceil(node.scrollHeight) + 12, limit);
    if (next > 120 && next !== cardHeight) setCardHeight(next);
    const sheet = document.querySelector("[data-agent-sheet]");
    if (sheet instanceof HTMLElement) document.documentElement.style.setProperty("--agent-sheet-h", `${Math.ceil(sheet.getBoundingClientRect().height)}px`);
    const cell = document.querySelector("[data-agent-live]");
    const grid = cell?.closest("[data-scroll-x]");
    if (cell instanceof HTMLElement && grid instanceof HTMLElement) void scrollCellIntoView(cell, grid);
  }, [phase, cardHeight, agent.messages]);
  useEffect(() => {
    document.body.dataset.agentCard = phase === "card" || phase === "peek" ? "1" : "";
    if (phase !== "card") return;
    const timer = window.setTimeout(() => {
      const node = document.querySelector("[data-agent-sheet]");
      const height = node instanceof HTMLElement ? node.getBoundingClientRect().height : 260;
      document.documentElement.style.setProperty("--agent-sheet-h", `${Math.ceil(height)}px`);
      const cell = document.querySelector("[data-agent-live]");
      const grid = cell?.closest("[data-scroll-x]");
      if (cell instanceof HTMLElement && grid instanceof HTMLElement) void scrollCellIntoView(cell, grid);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [phase, cardHeight]);
  const transition = reduce ? { duration: 0.01 } : { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const };
  if (mode !== "sheet") {
    return (
      <AnimatePresence>
        {agent.open ? (
          <motion.section
            key="agent-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Агент деканата"
            className="sheet-solid fixed bottom-0 right-0 top-0 z-[80] flex w-[min(400px,100%)] flex-col shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={transition}
          >
            <AgentPanel variant="dock" />
          </motion.section>
        ) : null}
      </AnimatePresence>
    );
  }
  return (
    <>
      {phase === "expanded" ? (
        <button type="button" aria-label="Закрыть агента" className="fixed inset-0 z-[70] bg-slate-900/25" onClick={() => agent.setOpen(false)} />
      ) : null}
      <motion.section
        data-agent-sheet=""
        data-agent-peek={phase === "peek" ? "" : undefined}
        role="dialog"
        aria-modal={phase === "expanded" || phase === "card"}
        aria-hidden={phase === "hidden"}
        aria-label="Агент деканата"
        layout={phase === "expanded"}
        drag={phase === "expanded" ? "y" : false}
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.55 }}
        onDragEnd={onDragEnd}
        className={`sheet-solid fixed inset-x-0 z-[80] flex flex-col overflow-hidden rounded-t-[28px] ${phase === "card" ? "agent-card-sheet" : ""}`}
        initial={false}
        animate={phase}
        variants={{
          hidden: { y: "110%", height: 64, pointerEvents: "none" },
          peek: { y: 0, height: 52, pointerEvents: "auto" },
          card: { y: 0, height: cardHeight, pointerEvents: "auto" },
          expanded: { y: 0, height: Math.min(window.innerHeight * 0.85, 720), pointerEvents: "auto" },
        }}
        transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.8 }}
        style={{
          bottom: phase === "peek" ? "calc(var(--nav-h) + env(safe-area-inset-bottom) + 8px)" : "max(var(--kb, 0px), var(--vv-kb, 0px), env(keyboard-inset-height, 0px))",
          top: phase === "card" ? "auto" : undefined,
          height: phase === "card" ? cardHeight : undefined,
          maxHeight: phase === "card" ? "45dvh" : "calc(100dvh - max(var(--kb, 0px), var(--vv-kb, 0px)) - env(safe-area-inset-top) - 12px)",
        }}
      >
        {phase === "peek" ? (
          <button type="button" className="flex h-full min-h-11 items-center px-4 text-left text-sm font-semibold" onClick={() => agent.setPeek(false)}>{agent.peekLine || "Готово"} · В чат</button>
        ) : phase === "card" ? null : (
          <div className="flex h-11 shrink-0 cursor-grab touch-none items-center justify-center" onPointerDown={(event) => drag.start(event)}>
            <span className="h-1.5 w-10 rounded-full bg-slate-400/70" />
          </div>
        )}
        <div className={phase === "peek" || phase === "hidden" ? "hidden" : phase === "card" ? "flex flex-col" : "flex min-h-0 flex-1 flex-col"} data-agent-confirm-card={phase === "card" ? "" : undefined}>
          {phase === "card" ? (
            <button type="button" className="btn btn-quiet absolute right-2 top-2 z-10 h-11 w-11 px-0" aria-label="Закрыть" onClick={() => agent.setOpen(false)}><X className="h-5 w-5" /></button>
          ) : (
            <div className="flex items-center justify-between gap-2 px-4 pb-1">
              <p className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4 w-4 text-[var(--brand)]" /> Агент деканата</p>
              <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Закрыть" onClick={() => agent.setOpen(false)}><X className="h-5 w-5" /></button>
            </div>
          )}
          <AgentPanel variant="sheet" chrome={false} onlyConfirm={phase === "card"} />
        </div>
      </motion.section>
    </>
  );
}
