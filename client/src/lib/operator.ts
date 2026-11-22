const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted || reduced()) return Promise.resolve();
  return delay(ms, signal);
}

function delay(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function waitForPage(page: string, signal: AbortSignal, timeout = 2500) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(finish, timeout);
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string }>).detail;
      if (!detail?.page || detail.page === page) finish();
    };
    function finish() {
      window.clearTimeout(timer);
      window.removeEventListener("altair-page-ready", onReady);
      resolve();
    }
    window.addEventListener("altair-page-ready", onReady);
  });
}

export async function waitForElement(selector: string, signal: AbortSignal, timeout = 4000) {
  const start = performance.now();
  while (!signal.aborted && performance.now() - start < timeout) {
    const node = document.querySelector(selector);
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ inline: "center", block: "center", behavior: reduced() ? "auto" : "smooth" });
      await delay(reduced() ? 0 : 120, signal);
      const again = document.querySelector(selector);
      return again instanceof HTMLElement ? again : node;
    }
    await delay(80, signal);
  }
  return null;
}

export function moveCursor(element: Element | null, on: boolean) {
  if (!(element instanceof HTMLElement)) {
    window.dispatchEvent(new CustomEvent("altair-cursor", { detail: { on: false, x: 0, y: 0 } }));
    return;
  }
  const box = element.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent("altair-cursor", {
    detail: { on, x: box.left + Math.min(28, box.width / 2), y: box.top + Math.min(24, box.height / 2) },
  }));
}

function visible(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function reveal(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const behavior = reduced() ? "auto" as const : "smooth" as const;
  const topNodes = [...document.querySelectorAll("header, thead, [data-agent-peek]")];
  const bottomNodes = [...document.querySelectorAll("[data-agent-sheet], .mobile-nav-pill, [data-agent-action='nav-agent']")];
  const topLimit = Math.max(72, ...topNodes.map((node) => {
    const edge = node.getBoundingClientRect();
    return edge.bottom > 0 && edge.top < 160 ? edge.bottom : 0;
  }));
  const sheet = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--agent-sheet-h")) || 0;
  const bottomLimit = Math.min(...bottomNodes.map((node) => node.getBoundingClientRect().top).filter((top) => top > 80), window.innerHeight - sheet) - 16;
  if (box.top < topLimit) window.scrollBy({ top: box.top - topLimit - 8, behavior });
  else if (box.bottom > bottomLimit) window.scrollBy({ top: box.bottom - bottomLimit, behavior });
}

function scrollParent(node: HTMLElement): HTMLElement | Window {
  let current = node.parentElement;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return window;
}

function settle(node: HTMLElement | Window) {
  return new Promise<void>((resolve) => {
    let timer = window.setTimeout(done, reduced() ? 0 : 420);
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(done, 80);
    };
    function done() {
      node.removeEventListener("scroll", onScroll);
      resolve();
    }
    node.addEventListener("scroll", onScroll, { passive: true });
  });
}

export async function scrollCellIntoView(cell: HTMLElement, grid: HTMLElement) {
  const behavior = reduced() ? "auto" as const : "smooth" as const;
  const nameCol = grid.querySelector("th.sticky.left-0");
  const percentCol = grid.querySelector("th.sticky.right-0");
  const nameW = nameCol instanceof HTMLElement ? nameCol.getBoundingClientRect().width : 120;
  const percentW = percentCol instanceof HTMLElement ? percentCol.getBoundingClientRect().width : 56;
  const gridBox = grid.getBoundingClientRect();
  const box = cell.getBoundingClientRect();
  const leftLimit = gridBox.left + nameW + 12;
  const rightLimit = gridBox.right - percentW - 12;
  let deltaX = 0;
  if (box.left < leftLimit) deltaX = box.left - leftLimit;
  else if (box.right > rightLimit) deltaX = box.right - rightLimit;
  if (deltaX) grid.scrollBy({ left: deltaX, behavior });
  const scroller = scrollParent(cell);
  const reserved = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--agent-sheet-h")) || 240;
  const header = document.querySelector("header");
  const topLimit = Math.max(72, header instanceof HTMLElement ? header.getBoundingClientRect().bottom : 0) + 8;
  const bottomLimit = window.innerHeight - reserved - 48;
  const next = cell.getBoundingClientRect();
  let deltaY = 0;
  if (next.top < topLimit) deltaY = next.top - topLimit;
  else if (next.bottom > bottomLimit) deltaY = next.bottom - bottomLimit;
  const scrollByY = (distance: number) => {
    const before = cell.getBoundingClientRect().top;
    if (scroller instanceof Window) window.scrollBy({ top: distance, behavior: "auto" });
    else scroller.scrollBy({ top: distance, behavior: "auto" });
    if (Math.abs(cell.getBoundingClientRect().top - before) < 1) window.scrollBy({ top: distance, behavior: "auto" });
  };
  if (deltaY) scrollByY(deltaY);
  const sheet = document.querySelector("[data-agent-sheet]");
  if (sheet instanceof HTMLElement && sheet.getBoundingClientRect().height > 80) {
    const sheetTop = sheet.getBoundingClientRect().top;
    const placed = cell.getBoundingClientRect();
    if (placed.bottom > sheetTop - 36) scrollByY(placed.bottom - sheetTop + 48);
  }
  if (deltaX) await settle(grid);
}

export async function glideTo(selector: string, signal: AbortSignal) {
  if (signal.aborted) return;
  const mobile = window.matchMedia("(max-width: 767px)").matches;
  const preferred = mobile && selector.includes("nav-journal") ? ".mobile-nav-pill [data-agent-action='nav-journal']" : selector;
  const element = [...document.querySelectorAll(preferred)].find((node) => node instanceof HTMLElement && visible(node));
  if (!(element instanceof HTMLElement)) return;
  reveal(element);
  await wait(160, signal);
  moveCursor(element, true);
  element.classList.add("agent-shown");
  if (!element.hasAttribute("data-agent-live")) window.setTimeout(() => element.classList.remove("agent-shown"), reduced() ? 0 : 900);
  await wait(220, signal);
}

export async function typeField(field: string, value: string, signal: AbortSignal) {
  const step = reduced() ? value.length || 1 : 1;
  for (let i = step; i <= value.length; i += step) {
    if (signal.aborted) return;
    window.dispatchEvent(new CustomEvent("altair-fill", { detail: { field, value: value.slice(0, i) } }));
    await wait(18, signal);
  }
  if (!value) window.dispatchEvent(new CustomEvent("altair-fill", { detail: { field, value: "" } }));
}

const FIELD: Record<string, string> = {
  Назначение: "purpose",
  Комментарий: "comment",
  Оценка: "journal-value",
  Текст: "homework-body",
  Условие: "description",
  Название: "title",
  Срок: "deadline",
  Группа: "group",
  Предмет: "discipline",
  Заголовок: "announce-title",
};

export async function playTurn(input: {
  tools: string[];
  open?: string;
  fields: { label: string; value: string }[];
  fill?: Record<string, string>;
  navigate: (to: string) => void;
  signal: AbortSignal;
  onStep: (label: string) => void;
}) {
  const { tools, open, fields, fill, navigate, signal, onStep } = input;
  if (tools.some((tool) => ["teacher_set_mark", "teacher_set_attendance", "teacher_add_journal_column"].includes(tool))) {
    const group = open ? new URL(open, "http://altair.local").searchParams.get("group") : "";
    onStep(group ? `Открываю журнал ${group}…` : "Открываю журнал…");
    document.body.dataset.operator = "1";
    await glideTo("[data-agent-action='nav-journal']", signal);
    if (open) navigate(open);
    await waitForPage("journal", signal);
    const params = open ? new URL(open, "http://altair.local").searchParams : null;
    const focus = params?.get("focus") ?? "";
    const student = params?.get("student") ?? "";
    const cell = student && focus ? await waitForElement(`[data-agent-cell="${student}:${focus}"]`, signal, 2500) : null;
    if (!(cell instanceof HTMLElement)) {
      onStep("Не вижу нужную ячейку на экране");
      return;
    }
    document.documentElement.style.setProperty("--agent-sheet-h", "240px");
    const grid = cell.closest("[data-scroll-x]");
    if (grid instanceof HTMLElement) await scrollCellIntoView(cell, grid);
    cell.setAttribute("data-agent-live", "1");
    await glideTo("[data-agent-live='1']", signal);
    if (grid instanceof HTMLElement) await scrollCellIntoView(cell, grid);
    onStep("Жду подтверждение…");
    return;
  }
  if (tools.includes("teacher_grade_homework")) {
    onStep("Открываю работу…");
    document.body.dataset.operator = "1";
    if (open) navigate(open);
    await wait(reduced() ? 0 : 240, signal);
    await glideTo("[data-agent-field='homework-score']", signal);
    await glideTo("[data-agent-action='teach-grade']", signal);
    onStep("Жду подтверждение…");
    return;
  }
  if (tools.includes("mark_notifications_read")) {
    onStep("Открываю уведомления…");
    if (open) navigate(open);
    await glideTo("[data-agent-action='notification-read-all']", signal);
    return;
  }
  onStep(tools[0] ? "Открываю раздел…" : "Смотрю…");
  await wait(480, signal);
  const selector =
    tools.includes("update_settings") ? "[data-agent-action='theme-toggle']"
    : tools.includes("mark_schedule_item") ? "[data-agent-action='schedule-star']"
    : tools.includes("mark_notifications_read") ? "[data-agent-action='notification-read-all']"
    : tools.includes("teacher_list_submissions") ? "[data-agent-action='nav-queue']"
    : tools.includes("staff_list_inbox") || tools.includes("staff_set_status") ? "[data-agent-action='nav-staff']"
    : tools.includes("get_schedule") ? "[data-agent-action='nav-schedule']"
    : tools.includes("list_homework") || tools.includes("submit_homework") ? "[data-agent-action='nav-homework']"
    : tools.includes("get_grades") || tools.includes("get_session_navigator") ? "[data-agent-action='nav-grades']"
    : tools.includes("list_requests") || tools.includes("create_request") ? "[data-agent-action='nav-requests'], [data-agent-action='request-new']"
    : tools.includes("teacher_home") ? "[data-agent-action='nav-teach']"
    : "";
  if (selector) {
    onStep("Открываю раздел…");
    await glideTo(selector, signal);
  }
  if (signal.aborted) return;
  if (open) {
    navigate(open);
    await wait(420, signal);
  }
  if (signal.aborted) return;
  const form = tools.find((tool) => ["create_request", "submit_homework", "teacher_issue_assignment", "staff_publish_announcement"].includes(tool));
  if (form) {
    onStep("Заполняю форму…");
    const pairs = fill && Object.keys(fill).length
      ? Object.entries(fill)
      : fields.map((field) => [FIELD[field.label] ?? "", field.value] as const);
    for (const [name, value] of pairs) {
      if (!name || !value) continue;
      await glideTo(`[data-agent-field='${name}']`, signal);
      await typeField(name, value, signal);
    }
    const submit = form === "create_request" ? "request-submit" : form === "submit_homework" ? "homework-submit" : form === "teacher_issue_assignment" ? "teach-issue" : "staff-publish";
    await glideTo(`[data-agent-action='${submit}']`, signal);
    onStep("Жду подтверждение…");
  }
}
