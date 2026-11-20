import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAgent } from "../lib/agent";
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
    if (!agent.open) return;
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const lockScroll = mode === "sheet";
    const previous = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";
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
    const focusTimer = window.setTimeout(() => agent.inputRef.current?.focus(), 280);
    return () => {
      if (lockScroll) document.body.style.overflow = previous;
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

  const height = "min(85dvh, 720px)";
  const transition = reduce ? { duration: 0.01 } : { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const };

  return (
    <AnimatePresence>
      {agent.open ? (
        <>
          {!agent.peek ? (
          <motion.button
            key="agent-backdrop"
            type="button"
            aria-label="Закрыть агента"
            className="fixed inset-0 z-[70] bg-slate-900/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: "none" }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            onClick={() => agent.setOpen(false)}
          />
          ) : null}
          {agent.peek ? (
            <motion.button
              key="agent-peek"
              type="button"
              className="sheet-solid fixed z-[80] flex min-h-14 w-[min(18rem,calc(100%-6.5rem))] items-center justify-between gap-3 rounded-full px-4 text-left"
              style={{ left: 12, right: 12, bottom: "calc(6.25rem + env(safe-area-inset-bottom))", width: "auto" }}
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0, pointerEvents: "none" }}
              transition={transition}
              onClick={() => agent.setPeek(false)}
            >
              <span className="min-w-0 truncate text-sm font-semibold">{agent.peekLine} · Вернуться в чат</span>
            </motion.button>
          ) : mode === "sheet" ? (
            <motion.section
              key="agent-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Агент деканата"
              drag="y"
              dragControls={drag}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.55 }}
              onDragEnd={onDragEnd}
              className="sheet-solid fixed inset-x-0 z-[80] flex flex-col overflow-hidden rounded-t-[28px]"
              style={{
                bottom: "max(var(--kb, 0px), var(--vv-kb, 0px), env(keyboard-inset-height, 0px))",
                height,
                maxHeight: "calc(100dvh - max(var(--kb, 0px), var(--vv-kb, 0px), env(keyboard-inset-height, 0px)) - env(safe-area-inset-top) - 12px)",
              }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={transition}
            >
              <div
                className="flex h-11 shrink-0 cursor-grab touch-none items-center justify-center"
                onPointerDown={(event) => drag.start(event)}
              >
                <span className="h-1.5 w-10 rounded-full bg-slate-400/70" />
              </div>
              <div className="flex items-center justify-between gap-2 px-4 pb-1">
                <button type="button" className="min-w-0 text-left" onClick={() => agent.setPeek(false)}>
                  <p className="flex items-center gap-2 text-base font-semibold">
                    <Sparkles className="h-4 w-4 text-[var(--brand)]" /> Агент деканата
                  </p>
                  <p className="text-xs text-[var(--muted)]">Локальный режим</p>
                </button>
                <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Закрыть" onClick={() => agent.setOpen(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <AgentPanel variant="sheet" chrome={false} />
            </motion.section>
          ) : (
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
          )}
        </>
      ) : null}
    </AnimatePresence>
  );
}
