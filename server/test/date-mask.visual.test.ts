import { expect, it } from "vitest";
import { chromium, type Locator, type Page } from "playwright-core";

async function typeDigits(page: Page, field: Locator, digits: string) {
  await field.click();
  await field.press("Control+A");
  await field.press("Backspace");
  for (const digit of digits) await field.press(digit);
}

async function pasteText(field: Locator, text: string) {
  await field.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, text);
}

it("маска журнала набирает дату по цифре и принимает ISO", async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const login = await page.request.post("http://127.0.0.1:5317/api/auth/login", { data: { login: "orlov.pn", password: "Altair-teacher-58" } });
    expect(login.ok(), await login.text()).toBe(true);
    await page.goto("http://127.0.0.1:5317/teach/journal");
    await page.getByRole("button", { name: "Даты" }).click();
    const from = page.getByLabel("С", { exact: true });
    await typeDigits(page, from, "01112026");
    await expect.poll(() => from.inputValue()).toBe("01.11.2026");
    await from.press("Backspace");
    await expect.poll(() => from.inputValue()).toBe("01.11.202");
    await from.press("Backspace");
    await expect.poll(() => from.inputValue()).toBe("01.11.20");
    await from.press("End");
    await from.press("2");
    await from.press("6");
    await expect.poll(() => from.inputValue()).toBe("01.11.2026");
    await from.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.setSelectionRange(3, 3);
    });
    await from.press("Backspace");
    await expect.poll(() => from.inputValue()).toBe("01.12.026");
    const to = page.getByLabel("По", { exact: true });
    await pasteText(to, "2026-11-17");
    await expect.poll(() => to.inputValue()).toBe("17.11.2026");
    await page.getByRole("button", { name: "Закрыть" }).click();
    await page.getByRole("button", { name: "+ Работа" }).click();
    const workDate = page.getByLabel("Дата работы");
    await pasteText(workDate, "2026-11-01");
    await expect.poll(() => workDate.inputValue()).toBe("01.11.2026");
    await workDate.click();
    await workDate.press("Control+A");
    await workDate.press("Backspace");
    for (const digit of "2511") await workDate.press(digit);
    await expect.poll(() => workDate.inputValue()).toBe("25.11");
    await page.screenshot({ path: "/opt/cursor/artifacts/after-date-mask-390.png" });
  } finally {
    await browser.close();
  }
}, 60_000);
