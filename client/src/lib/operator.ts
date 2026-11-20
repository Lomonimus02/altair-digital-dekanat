const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted || reduced()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
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

export async function glideTo(selector: string, signal: AbortSignal) {
  if (signal.aborted) return;
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return;
  element.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
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
