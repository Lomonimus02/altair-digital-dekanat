/**
 * @vitest-environment happy-dom
 */
import type { PublicUser } from "@shared/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../lib/auth";
import { LoginPage } from "./login";

const student: PublicUser = {
  id: 1,
  login: "sorokin.mo",
  role: "student",
  fullName: "Сорокин Максим Олегович",
  addressName: "Максим Олегович",
  initials: "СМ",
  institute: "Институт экономики и цифрового управления",
  direction: "38.03.05 Бизнес-информатика",
  course: 3,
  groupName: "БИ-3-26-04",
  recordBook: "26-04183",
  theme: "system",
  showCancelled: true,
};

const staff: PublicUser = {
  ...student,
  id: 3,
  login: "lebedeva.ip",
  role: "staff",
  fullName: "Лебедева Ирина Павловна",
  addressName: "Ирина Павловна",
  initials: "ЛИ",
  institute: "Учебный офис",
  direction: null,
  course: null,
  groupName: null,
  recordBook: null,
};

afterEach(() => {
  cleanup();
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch(role: "student" | "staff") {
  const account = role === "staff" ? staff : student;
  let signedIn = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/auth/login")) {
      signedIn = true;
      return json(200, { user: account, csrfToken: "csrf-token" });
    }
    if (url.includes("/api/me")) {
      if (!signedIn) return json(401, { error: "unauthorized", message: "Нужно войти" });
      return json(200, { user: account, contest: "" });
    }
    return json(404, { error: "not_found" });
  };
}

function renderLogin() {
  window.history.pushState({}, "", "/login");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<h1>Панель управления</h1>} />
            <Route path="/staff" element={<h1>Учебный офис</h1>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

async function submit(loginName: string) {
  fireEvent.change(screen.getByLabelText("Логин"), { target: { value: loginName } });
  fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "Altair-student-31" } });
  fireEvent.submit(screen.getByRole("button", { name: "Войти" }).closest("form")!);
}

describe("вход открывает кабинет без перезагрузки", () => {
  it("студент попадает на панель, даже если /api/me уже ответил 401 и кэш сброшен", async () => {
    installFetch("student");
    renderLogin();
    await screen.findByRole("heading", { name: "Вход в систему" });
    await waitFor(() => expect(screen.getByLabelText("Логин")).toBeTruthy());
    await submit("sorokin.mo");
    expect(await screen.findByRole("heading", { name: "Панель управления" })).toBeTruthy();
    expect(screen.queryByLabelText("Логин")).toBeNull();
  });

  it("сотрудник попадает во входящие", async () => {
    installFetch("staff");
    renderLogin();
    await screen.findByRole("heading", { name: "Вход в систему" });
    await submit("lebedeva.ip");
    expect(await screen.findByRole("heading", { name: "Учебный офис" })).toBeTruthy();
    expect(screen.queryByLabelText("Логин")).toBeNull();
  });

  it("поздний 401 от /api/me не возвращает на страницу входа", async () => {
    let release: (response: Response) => void = () => undefined;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/login")) return json(200, { user: student, csrfToken: "csrf-token" });
      if (url.includes("/api/me")) return new Promise((resolve) => { release = resolve; });
      return json(404, { error: "not_found" });
    };
    renderLogin();
    await screen.findByRole("heading", { name: "Вход в систему" });
    await submit("sorokin.mo");
    expect(await screen.findByRole("heading", { name: "Панель управления" })).toBeTruthy();
    release(json(401, { error: "unauthorized", message: "Нужно войти" }));
    await waitFor(() => expect(screen.queryByLabelText("Логин")).toBeNull());
    expect(screen.getByRole("heading", { name: "Панель управления" })).toBeTruthy();
  });
});
