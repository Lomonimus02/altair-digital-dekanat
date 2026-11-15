import type { Theme, UiDirective } from "@shared/domain";
import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";

export function applyTheme(theme: Theme) {
  localStorage.setItem("altair-theme", theme);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#080c18" : "#e6fff5");
}

export function flashTarget(id?: string) {
  if (!id) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const run = () => {
    const element = document.querySelector(`[data-agent-target="${CSS.escape(id)}"]`);
    if (!(element instanceof HTMLElement)) return false;
    const box = element.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) return false;
    element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    if (reduced) return true;
    if (box.height > window.innerHeight * 0.75) return true;
    element.classList.add("agent-shown");
    const positioned = getComputedStyle(element).position === "static";
    if (positioned) element.style.position = "relative";
    const badge = document.createElement("p");
    badge.className = "agent-shown-label";
    badge.textContent = "Агент показал это здесь";
    badge.style.top = "0";
    badge.style.left = "0.75rem";
    badge.style.transform = "translateY(calc(-100% - 6px))";
    element.appendChild(badge);
    window.setTimeout(() => {
      element.classList.remove("agent-shown");
      badge.remove();
    }, 1800);
    return true;
  };
  if (!run()) {
    window.setTimeout(run, 280);
    window.setTimeout(run, 900);
  }
}

export function applyDirectives(
  ui: UiDirective[] = [],
  navigate: NavigateFunction,
  queryClient: QueryClient,
  options: { flash?: boolean } = {},
) {
  for (const item of ui) {
    if (item.type === "theme") applyTheme(item.value);
    if (item.type === "invalidate") for (const key of item.keys) void queryClient.invalidateQueries({ queryKey: [key] });
    if (item.type === "navigate") navigate(item.to);
  }
  if (!options.flash) return;
  const highlight = [...ui].reverse().find((item) => item.type === "navigate" && item.highlight);
  if (highlight && highlight.type === "navigate") window.setTimeout(() => flashTarget(highlight.highlight), 450);
}
