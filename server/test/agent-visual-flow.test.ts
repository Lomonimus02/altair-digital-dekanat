import { mkdirSync } from "node:fs";
import { expect, it } from "vitest";
import { chromium, type Page } from "playwright-core";

const frames = "/opt/cursor/artifacts/agent-flow-frames";

async function shot(page: Page, name: string) {
  mkdirSync(frames, { recursive: true });
  await page.screenshot({ path: `${frames}/${name}.png` });
}

async function runFlow(page: Page, width: number, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("http://127.0.0.1:5317/teach/journal");
  await page.evaluate((next) => {
    document.documentElement.classList.toggle("dark", next === "dark");
  }, theme);
  await page.getByRole("heading", { name: "Журнал" }).waitFor();
  const sheet = page.locator("[data-agent-sheet]");
  await expect.poll(() => sheet.count()).toBe(1);
  const identity = await sheet.evaluate((element) => {
    (window as unknown as { __sheet?: Element }).__sheet = element;
    return true;
  });
  expect(identity).toBe(true);
  await page.getByRole("button", { name: "Спросить деканат" }).click();
  await page.locator("#agent-command").waitFor();
  await shot(page, `${width}-${theme}-expanded`);
  await page.locator("#agent-command").fill("поставь 5 Сорокину за контрольную 16.11 по базам");
  await page.keyboard.press("Enter");
  const samples: { t: number; peek: string; connected: boolean }[] = [];
  const started = Date.now();
  let card = false;
  while (Date.now() - started < 8000) {
    const sample = await page.evaluate(() => {
      const node = (window as unknown as { __sheet?: Element }).__sheet;
      const peek = document.querySelector("[data-agent-peek]");
      return { connected: Boolean(node?.isConnected), peek: peek?.textContent ?? "", card: Boolean(document.querySelector("[data-agent-confirm-card]")) };
    });
    samples.push({ t: Date.now() - started, peek: sample.peek, connected: sample.connected });
    expect(sample.connected).toBe(true);
    if (sample.card && (await page.locator("[data-agent-confirm-card]").getByText("Поставить оценку").count())) {
      card = true;
      break;
    }
    await page.waitForTimeout(120);
  }
  expect(card, samples.map((item) => item.peek).join(" | ")).toBe(true);
  await page.waitForTimeout(900);
  const buttons = await page.evaluate(() => {
    const labels = ["Подтвердить", "Не сейчас"];
    return labels.map((label) => {
      const root = document.querySelector("[data-agent-confirm-card]") ?? document;
      const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
      if (!(button instanceof HTMLElement)) return { label, ok: false };
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const inside = box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth && box.height > 20;
      return { label, ok: inside && Boolean(hit && (hit === button || button.contains(hit))), top: box.top, bottom: box.bottom, height: box.height };
    });
  });
  await shot(page, `${width}-${theme}-card`);
  expect(buttons.every((item) => item.ok), JSON.stringify(buttons)).toBe(true);
  const gaps = samples.slice(1).map((item, index) => item.t - samples[index].t);
  expect(Math.max(...gaps, 0)).toBeLessThanOrEqual(700);
  const visible = await page.evaluate(() => {
    const cell = document.querySelector("[data-agent-live]");
    if (!(cell instanceof HTMLElement)) return { ok: false, reason: "no-live" };
    const box = cell.getBoundingClientRect();
    const grid = cell.closest("[data-scroll-x]");
    const name = grid?.querySelector("th.sticky.left-0")?.getBoundingClientRect();
    const percent = grid?.querySelector("th.sticky.right-0")?.getBoundingClientRect();
    const card = document.querySelector("[data-agent-sheet]")?.getBoundingClientRect();
    const header = document.querySelector("header")?.getBoundingClientRect();
    const topLimit = Math.max(header?.bottom ?? 0, 0);
    const leftLimit = (name?.right ?? 0) + 4;
    const rightLimit = (percent?.left ?? window.innerWidth) - 4;
    const bottomLimit = (card?.top ?? window.innerHeight) - 4;
    const inside = box.top >= topLimit && box.top + box.height * 0.7 <= bottomLimit && box.left >= leftLimit && box.right <= rightLimit && box.width > 8 && box.height > 8;
    const points = [0.5, 0.32, 0.68].flatMap((x) => [0.35, 0.65].map((y) => [box.left + box.width * x, box.top + box.height * y])).slice(0, 5);
    const cover = points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      const own = Boolean(hit && (hit === cell || cell.contains(hit)));
      return own ? "cell" : `${hit?.tagName ?? "none"}.${(hit as HTMLElement | null)?.className?.toString().slice(0, 40) ?? ""}`;
    });
    const hits = cover.every((item) => item === "cell");
    return { ok: inside && hits, inside, hits, cover, box, topLimit, leftLimit, rightLimit, bottomLimit };
  });
  expect(visible.ok, JSON.stringify(visible)).toBe(true);
}

it("панель агента не размонтируется, а цель остаётся на экране", async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  try {
    const login = await page.request.post("http://127.0.0.1:5317/api/auth/login", { data: { login: "orlov.pn", password: "Altair-teacher-58" } });
    expect(login.ok(), await login.text()).toBe(true);
    await runFlow(page, 360, "dark");
    await runFlow(page, 390, "light");
    await runFlow(page, 412, "dark");
  } finally {
    await browser.close();
  }
}, 90_000);
