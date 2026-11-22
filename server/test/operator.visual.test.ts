import { expect, it } from "vitest";
import { chromium } from "playwright-core";

it("оператор печатает комментарий в настоящую форму работы", async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const login = await page.request.post("http://127.0.0.1:5317/api/auth/login", { data: { login: "sorokin.mo", password: "Altair-student-31" } });
  expect(login.ok(), await login.text()).toBe(true);
  const list = await page.request.get("http://127.0.0.1:5317/api/homework");
  const homework = (await list.json()) as { homework: { id: number; submission: { status: string } }[] };
  const open = homework.homework.find((row) => ["not_started", "in_progress", "returned"].includes(row.submission.status));
  expect(open?.id).toBeTruthy();
  await page.goto(`http://127.0.0.1:5317/homework/${open!.id}`);
  await page.locator("textarea[data-agent-field='homework-body']").waitFor();
  await page.evaluate(() => {
    const value = "Готово";
    window.dispatchEvent(new CustomEvent("altair-fill", { detail: { field: "homework-body", value } }));
  });
  await expect.poll(() => page.locator("textarea[data-agent-field='homework-body']").inputValue()).toBe("Готово");
  await page.screenshot({ path: "/opt/cursor/artifacts/mobile-operator-homework-390.png" });
  await browser.close();
});
