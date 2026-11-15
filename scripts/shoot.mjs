import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/opt/cursor/artifacts";
mkdirSync(OUT, { recursive: true });
const PORT = 9333;

const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/altair-shot",
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function debuggerUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      /* ещё стартует */
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools не поднялся");
}

const browserWs = new WebSocket(await debuggerUrl());
await new Promise((resolve, reject) => {
  browserWs.addEventListener("open", resolve);
  browserWs.addEventListener("error", reject);
});

let seq = 0;
const pending = new Map();
browserWs.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(JSON.stringify(data.error)));
    else resolve(data.result);
  }
});

function send(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    browserWs.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Network.enable", {}, sessionId);

async function setSize(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 }, sessionId);
}

async function go(url) {
  await send("Page.navigate", { url }, sessionId);
  await sleep(700);
}

async function evalJs(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "js error";
    throw new Error(text);
  }
  return result.result?.value;
}

async function waitFor(selector, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await evalJs(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return;
    await sleep(200);
  }
  const html = await evalJs(`document.body.innerText.slice(0, 400)`);
  throw new Error(`нет ${selector}: ${html}`);
}

async function shot(name) {
  await sleep(400);
  const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
  console.log("saved", name);
}

async function login(name, password, path = "/") {
  await evalJs(`fetch('/api/auth/login',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({login:${JSON.stringify(name)},password:${JSON.stringify(password)}})}).then(r=>r.text())`);
  await go(`http://127.0.0.1:5317${path}`);
  await sleep(900);
}

async function fill(selector, value) {
  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('нет поля');
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
}

await setSize(1280, 900);
await go("http://127.0.0.1:5317/login");
await waitFor('input[autocomplete="username"]');
await shot("desktop-login-light");

await login("sorokin.mo", "Altair-student-31");
await waitFor("h1");
await shot("desktop-dashboard-light");

await evalJs(`document.querySelector('button[aria-label="Тёмная тема"]').click()`);
await sleep(600);
await shot("desktop-dashboard-dark");
await evalJs(`document.querySelector('button[aria-label="Светлая тема"]').click()`);
await sleep(400);

await go("http://127.0.0.1:5317/schedule");
await shot("desktop-schedule");
await go("http://127.0.0.1:5317/grades");
await shot("desktop-grades");
await go("http://127.0.0.1:5317/requests");
await shot("desktop-requests");

await go("http://127.0.0.1:5317/");
await sleep(500);
await fill("#agent-command", "что у меня завтра?");
await evalJs(`document.querySelector('#agent-command').closest('form').requestSubmit()`);
await sleep(1500);
await shot("desktop-agent-tomorrow");

await setSize(390, 844);
await go("http://127.0.0.1:5317/");
await sleep(600);
await shot("mobile-dashboard");
await go("http://127.0.0.1:5317/schedule");
await shot("mobile-schedule");
await go("http://127.0.0.1:5317/grades");
await shot("mobile-grades");

await setSize(1280, 900);
await evalJs(`fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': (document.cookie.match(/csrf=([^;]+)/)||[])[1] || '' } })`);
await login("lebedeva.ip", "Altair-staff-204", "/staff");
await shot("desktop-staff");

await evalJs(`fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': (document.cookie.match(/csrf=([^;]+)/)||[])[1] || '' } })`);
await login("volkova.as", "Altair-student-17", "/grades");
await shot("desktop-volkova");

chrome.kill();
browserWs.close();
console.log("done");
process.exit(0);
