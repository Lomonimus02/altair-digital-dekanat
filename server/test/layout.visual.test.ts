import { expect, it } from "vitest";
import { chromium } from "playwright-core";

const base = "http://127.0.0.1:5317";

it("колонка агента стоит справа на 1280, 1440 и 1920", async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const login = await page.request.post(`${base}/api/auth/login`, {
    data: { login: "orlov.pn", password: "Altair-teacher-58" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const journal = `${base}/teach/journal?group=${encodeURIComponent("БИ-3-26-04")}&discipline=${encodeURIComponent("Базы данных")}`;

  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(journal);
    await page.getByRole("heading", { name: "Журнал" }).waitFor();
    const closed = await page.locator("#content").boundingBox();
    expect(closed && closed.width).toBeGreaterThan(width - 320);
    await page.getByRole("button", { name: "Спросить" }).click();
    const column = page.getByTestId("agent-column");
    await column.waitFor();
    const agentBox = await column.boundingBox();
    const content = await page.locator("#content").boundingBox();
    expect(agentBox && content).toBeTruthy();
    expect(agentBox!.x).toBeGreaterThan(content!.x + content!.width - 8);
    expect(agentBox!.y).toBeLessThan(8);
    expect(agentBox!.width).toBeGreaterThanOrEqual(380);
    expect(agentBox!.width).toBeLessThanOrEqual(420);
    const input = await column.locator("#agent-command").boundingBox();
    expect(input!.y).toBeGreaterThan(500);
    expect(input!.y + input!.height).toBeLessThanOrEqual(900);
    const row = page.locator("tr", { hasText: "Белова Мария Игоревна" });
    const name = await row.getByRole("rowheader").boundingBox();
    const visit = await row.getByRole("button", { name: "Не отмечен" }).boundingBox();
    const chip = await row.getByRole("button", { name: /Незачёт/ }).boundingBox();
    const mark = await row.getByText(/Семинар/).boundingBox();
    expect(name && visit && chip && mark).toBeTruthy();
    expect(name!.x + name!.width).toBeLessThanOrEqual(visit!.x + 4);
    expect(chip!.x + chip!.width).toBeLessThanOrEqual(mark!.x + 8);
    await page.getByRole("button", { name: "Закрыть агента" }).click();
    await expect.poll(async () => page.getByTestId("agent-column").count()).toBe(0);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Спросить" }).click();
  await page.locator("#agent-command").fill("что у меня сегодня");
  await page.locator("#agent-command").press("Enter");
  await page.getByTestId("agent-column").getByText(/На проверке/).first().waitFor();
  await browser.close();
}, 90_000);
