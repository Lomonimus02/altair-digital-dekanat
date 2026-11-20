import { useEffect, useState } from "react";
import { useAgent } from "../lib/agent";

export function OperatorChrome() {
  const agent = useAgent();
  const [cursor, setCursor] = useState<{ x: number; y: number; on: boolean }>({ x: 0, y: 0, on: false });
  useEffect(() => {
    const onMove = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number; on: boolean }>).detail;
      setCursor(detail);
    };
    window.addEventListener("altair-cursor", onMove);
    return () => window.removeEventListener("altair-cursor", onMove);
  }, []);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <>
      {cursor.on ? (
        <div
          className="pointer-events-none fixed z-[90] h-8 w-8"
          style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`, transition: reduce ? "none" : "transform 280ms cubic-bezier(.2,.8,.2,1)" }}
          aria-hidden
        >
          <span className="block h-4 w-4 rounded-full border-2 border-[var(--primary)] bg-white/90 shadow" />
        </div>
      ) : null}
      {agent.operator ? (
        <div className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[90] mx-auto flex max-w-md items-center gap-2 rounded-full bg-slate-900/92 px-3 py-2 text-white shadow-lg" role="status">
          <span className="min-w-0 flex-1 truncate text-sm">{agent.operator}</span>
          <button type="button" className="h-11 shrink-0 rounded-full bg-white/15 px-3 text-sm" onClick={agent.stop}>Стоп</button>
        </div>
      ) : null}
    </>
  );
}
