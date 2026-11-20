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
    window.dispatchEvent(new CustomEvent("altair-cursor", { detail: { on: false } }));
    return;
  }
  const box = element.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent("altair-cursor", {
    detail: { on, x: box.left + Math.min(28, box.width / 2), y: box.top + box.height / 2 },
  }));
}

export async function glideTo(selector: string, signal: AbortSignal) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return;
  element.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
  await wait(reduced() ? 0 : 180, signal);
  moveCursor(element, true);
  element.classList.add("agent-shown");
  await wait(reduced() ? 0 : 220, signal);
  window.setTimeout(() => element.classList.remove("agent-shown"), reduced() ? 0 : 700);
}

export async function typeField(field: string, value: string, signal: AbortSignal) {
  const step = reduced() ? value.length : 1;
  for (let i = step; i <= value.length; i += step) {
    if (signal.aborted) return;
    window.dispatchEvent(new CustomEvent("altair-fill", { detail: { field, value: value.slice(0, i) } }));
    await wait(16, signal);
  }
}

export async function playTurn(
  tools: string[],
  fields: { label: string; value: string }[],
  navigate: (to: string) => void,
  signal: AbortSignal,
) {
  const openSchedule = tools.includes("get_schedule");
  const openRequests = tools.includes("list_requests") || tools.includes("create_request") || tools.includes("cancel_request");
  const openHomework = tools.includes("list_homework") || tools.includes("submit_homework") || tools.includes("save_homework");
  const openGrades = tools.includes("get_grades") || tools.includes("get_session_navigator");
  const openNotes = tools.includes("mark_notifications_read");
  const target = openSchedule
    ? "[data-agent-action='nav-schedule']"
    : openRequests
      ? "[data-agent-action='nav-requests'], [data-agent-action='request-new']"
      : openHomework
        ? "[data-agent-action='nav-homework']"
        : openGrades
          ? "[data-agent-action='nav-grades']"
          : openNotes
            ? "[data-agent-action='nav-notifications'], [data-agent-action='notification-read-all']"
            : "";
  if (target) await glideTo(target, signal);
  if (tools.includes("create_request")) {
    navigate("/requests/new");
    await wait(360, signal);
    const purpose = fields.find((field) => field.label === "Назначение")?.value;
    const comment = fields.find((field) => field.label === "Комментарий")?.value;
    if (purpose) await typeField("purpose", purpose, signal);
    if (comment) await typeField("comment", comment, signal);
    await glideTo("[data-agent-action='request-submit']", signal);
  }
  if (tools.includes("submit_homework")) {
    const body = fields.find((field) => /текст|коммент|работа/i.test(field.label))?.value;
    if (body) await typeField("homework-body", body, signal);
    await glideTo("[data-agent-action='homework-submit']", signal);
  }
}
