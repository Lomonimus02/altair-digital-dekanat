import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@shared/domain";
import { acceptSession, api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ContestNote, Mark } from "../components/ui";

/** Только вымышленные демо-аккаунты конкурса; настоящих логинов здесь нет. */
const DEMO = [
  ["Студент · БИ-3-26-04", "sorokin.mo", "Altair-student-31"],
  ["Студентка · ЮР-1-26-02", "volkova.as", "Altair-student-17"],
  ["Учебный офис", "lebedeva.ip", "Altair-staff-204"],
  ["Преподаватель", "orlov.pn", "Altair-teacher-58"],
] as const;

function homeFor(role: string) {
  if (role === "staff") return "/staff";
  if (role === "teacher") return "/teach";
  return "/";
}

export function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!loading && user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const session = await api<{ user: PublicUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      });
      acceptSession();
      queryClient.setQueryData(["me"], { user: session.user });
      navigate(homeFor(session.user.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <form onSubmit={(event) => void submit(event)} className="liquid-glass w-full max-w-md">
        <div className="glass-pad space-y-4 p-6 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <Mark />
            <h1 className="mt-4 text-2xl font-display">Вход в систему</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Альтаир — цифровой деканат: расписание, оценки, справки и новости в одном месте</p>
          </div>
          <div>
            <label htmlFor="login" className="mb-1 block text-sm font-semibold">Логин</label>
            <input id="login" className="field" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} required />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold">Пароль</label>
            <div className="relative">
              <input id="password" className="field pr-14" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button type="button" className="absolute right-1 top-1 grid h-11 w-11 place-items-center text-[var(--primary)]" aria-label={show ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShow((value) => !value)}>
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <section aria-labelledby="demo-title" className="rounded-2xl bg-black/[0.04] p-3 dark:bg-white/[0.06]">
            <p id="demo-title" className="text-sm font-semibold">Тестовые аккаунты</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Нажмите, чтобы подставить логин и пароль.</p>
            <ul className="mt-2 grid gap-1.5">
              {DEMO.map(([label, account, secret]) => (
                <li key={account}>
                  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10" aria-label={`${label}: подставить ${account}`} onClick={() => { setLogin(account); setPassword(secret); }}>
                    <span className="min-w-0 font-semibold">{label}</span>
                    <span className="shrink-0 text-right font-mono text-xs leading-tight text-[var(--muted)]"><span className="block whitespace-nowrap">{account}</span><span className="block whitespace-nowrap">{secret}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {error ? <p className="text-sm text-[var(--risk-high-fg)]">{error}</p> : null}
          <button type="submit" className="btn btn-primary w-full" disabled={pending}>
            {pending ? "Входим…" : "Войти"}
          </button>
          <ContestNote className="text-center" />
        </div>
      </form>
    </main>
  );
}
