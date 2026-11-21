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

function reveal(element: HTMLElement) {
  const covers = [...document.querySelectorAll("[data-agent-peek], .form-sticky, .mobile-nav-pill")]
    .map((node) => node.getBoundingClientRect().top)
    .filter((top) => top > 0 && top < window.innerHeight - 8);
  const limit = (covers.length ? Math.min(...covers) : window.innerHeight) - 16;
  const box = element.getBoundingClientRect();
  const behavior = reduced() ? "auto" : "smooth";
  if (box.bottom > limit) window.scrollBy({ top: box.bottom - limit, behavior });
  else if (box.top < 72) window.scrollBy({ top: box.top - 72, behavior });
}

export async function glideTo(selector: string, signal: AbortSignal) {
  if (signal.aborted) return;
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return;
  reveal(element);
  await wait(160, signal);
  moveCursor(element, true);
  element.classList.add("agent-shown");
  window.setTimeout(() => element.classList.remove("agent-shown"), reduced() ? 0 : 900);
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
    onStep("Открываю журнал…");
    document.body.dataset.operator = "1";
    await glideTo("[data-agent-action='nav-journal']", signal);
    if (open) navigate(open);
    const params = open ? new URL(open, "http://altair.local").searchParams : null;
    const focus = params?.get("focus") ?? "";
    const student = params?.get("student") ?? "";
    const cell = student && focus ? await waitForElement(`[data-agent-cell="${student}:${focus}"]`, signal) : null;
    if (cell instanceof HTMLElement) {
      cell.setAttribute("data-agent-live", "1");
      await glideTo("[data-agent-live='1']", signal);
      cell.click();
      window.dispatchEvent(new CustomEvent("altair-open-cell", { detail: { id: cell.getAttribute("data-agent-cell") } }));
      await wait(180, signal);
    }
    const pairs = fill && Object.keys(fill).length ? Object.entries(fill) : [["journal-value", fields.find((field) => field.label === "Оценка")?.value ?? ""] as const];
    for (const [name, value] of pairs) {
      if (!name || !value) continue;
      await glideTo(`[data-agent-field='${name}']`, signal);
      await typeField(name, value, signal);
    }
    await glideTo("[data-agent-action='journal-save']", signal);
    onStep("Жду подтверждение…");
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
