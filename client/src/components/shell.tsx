import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, CalendarDays, ClipboardList, FileText, GraduationCap, House, Inbox, LogOut, Megaphone, Menu, Moon, ScrollText, Sparkles, Sun, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { AgentProvider, useAgent } from "../lib/agent";
import { useAuth } from "../lib/auth";
import { AgentSheet, useKeyboardInset } from "./agent-sheet";
import { AgentPanel } from "./agent-panel";
import { ContestNote, Mark } from "./ui";
import { OperatorChrome } from "./operator-chrome";

export function Shell() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <AgentProvider user={user}>
      <Frame logout={logout} />
    </AgentProvider>
  );
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function Frame({ logout }: { logout: () => Promise<void> }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const reduce = useReducedMotion();
  const [settledPath, setSettledPath] = useState<string | null>(null);
  useEffect(() => {
    if (reduce) return;
    const timer = window.setTimeout(() => setSettledPath(location.pathname), 280);
    return () => window.clearTimeout(timer);
  }, [location.pathname, reduce]);
  const wide = useMedia("(min-width: 768px)");
  const xl = useMedia("(min-width: 1280px)");
  const agent = useAgent();
  const [more, setMore] = useState(false);
  useKeyboardInset();
  const notes = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ notifications: { readAt: string | null }[] }>("/api/notifications"),
    refetchInterval: 20_000,
  });
  const unread = notes.data?.notifications.filter((item) => !item.readAt).length ?? 0;

  useEffect(() => {
    const source = new EventSource("/api/notifications/stream");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type?: string };
      if (data.type === "notifications") {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        void queryClient.invalidateQueries({ queryKey: ["requests"] });
        void queryClient.invalidateQueries({ queryKey: ["brief"] });
        void queryClient.invalidateQueries({ queryKey: ["staff"] });
      }
    };
    return () => source.close();
  }, [queryClient]);


  useEffect(() => {
    if (user?.role === "teacher") {
      void queryClient.prefetchQuery({ queryKey: ["schedule", "", "", ""], queryFn: () => api("/api/schedule?when=today") });
      return;
    }
    if (user?.role !== "student") return;
    void queryClient.prefetchQuery({ queryKey: ["schedule", "", "", ""], queryFn: () => api("/api/schedule?when=today") });
    void queryClient.prefetchQuery({ queryKey: ["grades", ""], queryFn: () => api("/api/grades") });
    void queryClient.prefetchQuery({ queryKey: ["requests"], queryFn: () => api("/api/requests") });
  }, [queryClient, user?.role]);

  const student = user?.role === "student";
  const teacher = user?.role === "teacher";
  const links = teacher
    ? [
        { to: "/teach", label: "Сегодня", icon: House, end: true, action: "nav-teach" },
        { to: "/schedule", label: "Расписание", short: "Пары", icon: CalendarDays, action: "nav-schedule" },
        { to: "/teach/journal", label: "Журнал", icon: GraduationCap, action: "nav-journal" },
        { to: "/teach/homework", label: "Проверка", icon: FileText, action: "nav-queue" },
        { to: "/teach/assignments", label: "Задания", icon: ClipboardList, action: "nav-assignments" },
        { to: "/teach/announce", label: "Группы", icon: Megaphone },
        { to: "/notifications", label: "Уведомления", icon: Bell, badge: unread, action: "nav-notifications" },
        { to: "/profile", label: "Профиль", icon: UserRound },
      ]
    : student
    ? [
        { to: "/", label: "Главная", icon: House, end: true, action: "nav-home" },
        { to: "/schedule", label: "Расписание", short: "Пары", icon: CalendarDays, action: "nav-schedule" },
        { to: "/homework", label: "Задания", icon: FileText, action: "nav-homework" },
        { to: "/grades", label: "Оценки", icon: GraduationCap, action: "nav-grades" },
        { to: "/requests", label: "Заявки", icon: ScrollText, action: "nav-requests" },
        { to: "/notifications", label: "Уведомления", icon: Bell, badge: unread, action: "nav-notifications" },
        { to: "/regulations", label: "Регламенты", icon: ScrollText },
        { to: "/audit", label: "Журнал агента", icon: Sparkles },
        { to: "/profile", label: "Профиль", icon: UserRound },
      ]
    : [
        { to: "/staff", label: "Входящие", icon: Inbox, end: true, action: "nav-staff" },
        { to: "/staff/announcements", label: "Новости", icon: Megaphone, action: "nav-news" },
        { to: "/notifications", label: "Уведомления", icon: Bell, badge: unread, action: "nav-notifications" },
        { to: "/regulations", label: "Регламенты", icon: ScrollText },
        { to: "/audit", label: "Журнал", icon: Sparkles },
        { to: "/profile", label: "Профиль", icon: UserRound },
        { to: "/staff/journal", label: "Журнал оценок", icon: GraduationCap },
      ];
  const tabs = teacher ? links.slice(0, 4) : student ? links.slice(0, 4) : [links[0], links[1], links[4]];
  const tabTargets = new Set(tabs.map((link) => link.to));
  const moreLinks = links.filter((link) => !tabTargets.has(link.to));

  const agentColumn = agent.open && xl;
  return (
    <div className={`min-h-dvh md:grid md:grid-cols-[72px_minmax(0,1fr)] ${agentColumn ? "xl:grid-cols-[248px_minmax(0,1fr)_400px]" : "xl:grid-cols-[248px_minmax(0,1fr)]"}`}>
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-white focus:px-3 focus:py-2">
        К содержанию
      </a>
      <aside className="sticky top-0 hidden h-dvh min-h-0 flex-col gap-3 overflow-hidden p-3 md:flex">
        <Brand />
        <nav className="liquid-glass min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2" aria-label="Разделы">
          <div className="glass-pad space-y-1">
            {links.map((link) => (
              <SideLink key={link.to} {...link} ariaLabel={link.to === "/notifications" ? unreadLabel(unread) : undefined} />
            ))}
          </div>
        </nav>
        <div className="flex flex-col items-center gap-2 xl:hidden">
          <button type="button" className="mobile-nav-pill grid h-11 w-11 place-items-center rounded-full" aria-label="Спросить деканат" onClick={() => { agent.setPreferChat(true); agent.setPeek(false); agent.setOpen(true); }}>
            <Sparkles className="h-5 w-5 text-[var(--primary)]" />
          </button>
          <ThemeButton />
          <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Выйти" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <UserChip onLogout={() => void logout()} />
      </aside>
      <div className="min-w-0" style={{ overflowX: "clip" }}>
        <header className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] md:hidden">
          <Brand compact />
          <div className="flex items-center gap-2">
            <ThemeButton />
            <NavLink to="/notifications" className="btn btn-glass relative h-11 w-11 px-0" aria-label={unreadLabel(unread)}>
              <Bell className="h-5 w-5" />
              {unread ? <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--primary)] px-1 text-[10px] text-[var(--primary-ink)]">{unread}</span> : null}
            </NavLink>
          </div>
        </header>
        <main id="content" className="mx-auto w-full min-w-0 px-4 pb-4 pt-4 md:px-6 md:pb-10 md:pt-6">
          <AnimatePresence initial={false}>
            <motion.div
              key={location.pathname}
              className={reduce || settledPath === location.pathname ? "page-settled" : undefined}
              initial={reduce ? false : location.pathname.split("/").length > 2 ? { opacity: 0, x: 28 } : { opacity: 0 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduce ? 0 : 0.22 }}
              onAnimationComplete={() => setSettledPath(location.pathname)}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {agentColumn ? (
        <div data-testid="agent-column" className="sticky top-0 z-30 hidden h-dvh min-h-0 min-w-0 border-l border-black/5 xl:flex xl:flex-col">
          <AgentPanel variant="dock" />
        </div>
      ) : null}
      {wide && !xl ? <AgentSheet mode="drawer" /> : !wide ? (
        <>
          {!agent.open || agent.peek ? <MobileNav tabs={tabs} onMore={() => setMore(true)} onAgent={() => { agent.setPreferChat(true); agent.setPeek(false); agent.setOpen(true); }} /> : null}
          <OperatorChrome />
          <AgentSheet mode="sheet" />
          <MoreSheet open={more} links={moreLinks} onClose={() => setMore(false)} onLogout={() => void logout()} />
        </>
      ) : null}
    </div>
  );
}

function MobileNav({
  tabs,
  onMore,
  onAgent,
}: {
  tabs: { to: string; label: string; short?: string; icon: typeof House; end?: boolean; action?: string }[];
  onMore: () => void;
  onAgent: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const next = window.scrollY;
      setHidden(next > last && next > 48);
      last = next;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav
      className={`fixed inset-x-4 z-50 mx-auto grid w-[calc(100%-2rem)] max-w-md grid-cols-[minmax(0,1fr)_auto] items-center gap-2 transition-transform duration-300 ease-out md:hidden ${hidden ? "translate-y-[calc(100%+2rem)]" : "translate-y-0"}`}
      style={{ bottom: "max(16px, env(safe-area-inset-bottom))" }}
      aria-label="Нижняя навигация"
    >
      <div className="mobile-nav-pill grid min-h-14 min-w-0 auto-cols-fr grid-flow-col items-center rounded-full px-1">
        {tabs.map((link) => (
          <TabLink key={link.to} link={link} />
        ))}
        <button type="button" data-agent-action="nav-more" className="flex min-h-11 min-w-0 flex-col items-center justify-center rounded-full px-0.5 py-1 active:scale-95 motion-reduce:active:scale-100" onClick={onMore}>
          <Menu className="h-5 w-5" />
          <span className="max-w-full truncate text-[11px] font-medium leading-tight">Ещё</span>
        </button>
      </div>
      <button type="button" data-agent-action="nav-agent" className="mobile-nav-pill grid h-14 w-14 shrink-0 place-items-center rounded-full active:scale-95 motion-reduce:active:scale-100" aria-label="Спросить деканат" onClick={onAgent}>
        <Sparkles className="h-6 w-6 text-[var(--primary)]" />
      </button>
    </nav>
  );
}

function TabLink({ link }: { link: { to: string; label: string; short?: string; icon: typeof House; end?: boolean; action?: string } }) {
  const reduce = useReducedMotion();
  return (
    <NavLink to={link.to} end={link.end} data-agent-action={link.action} className="relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-full px-0.5 py-1 active:scale-95 motion-reduce:active:scale-100">
      {({ isActive }) => (
        <>
          {isActive ? <motion.span layoutId="mobileActive" className="absolute inset-1 rounded-full bg-white/80 dark:bg-white/10" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 350, damping: 30 }} /> : null}
          <link.icon className={`relative h-5 w-5 ${isActive ? "text-[var(--primary)]" : ""}`} />
          <span className="relative max-w-full text-[10px] font-medium leading-tight">{link.short ?? link.label}</span>
        </>
      )}
    </NavLink>
  );
}

function MoreSheet({
  open,
  links,
  onClose,
  onLogout,
}: {
  open: boolean;
  links: { to: string; label: string; icon: typeof House; end?: boolean; badge?: number }[];
  onClose: () => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-[70] bg-slate-900/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Ещё"
            className="sheet-solid fixed inset-x-0 bottom-0 z-[80] max-h-[78dvh] overflow-auto rounded-t-[28px] p-3 pb-[max(16px,env(safe-area-inset-bottom))]"
            initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.38, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="mb-2 flex items-center gap-3 px-2 py-2">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-sm text-[var(--primary-ink)]">{user?.initials}</span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{user?.fullName}</p>
                <p className="truncate text-sm text-[var(--muted)]">{user?.groupName ?? (user?.role === "teacher" ? "Преподаватель" : "Учебный офис")}</p>
              </div>
            </div>
            <div className="space-y-1">
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} onClick={onClose} className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-2xl px-3 text-sm ${isActive ? "bg-[var(--primary)]/15 font-semibold text-[var(--primary)]" : ""}`}>
                  <link.icon className="h-5 w-5" />
                  <span className="flex-1">{link.label}</span>
                  {link.badge ? <span className="rounded-full bg-[var(--primary)] px-1.5 text-[11px] text-[var(--primary-ink)]">{link.badge}</span> : null}
                </NavLink>
              ))}
              <button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-sm" onClick={onLogout}>
                <LogOut className="h-5 w-5" /> Выйти
              </button>
            </div>
            <ContestNote className="px-3 pb-2 pt-3" />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="flex min-h-11 items-center gap-3 text-left" onClick={() => navigate("/")}>
      <Mark size={compact ? 36 : 44} />
      <span className="min-w-0">
        <span className={`${compact ? "" : "hidden xl:block"}`}>
          <span className="flex items-center gap-2 font-display text-lg font-semibold leading-none">
            Альтаир
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink)] dark:bg-white/15 dark:text-white">Концепт</span>
          </span>
          {!compact ? <span className="text-xs text-[var(--muted)]">Цифровой деканат</span> : null}
        </span>
      </span>
    </button>
  );
}

function unreadLabel(unread: number) {
  if (!unread) return "Уведомления";
  const word = unread % 10 === 1 && unread % 100 !== 11 ? "непрочитанное" : "непрочитанных";
  return `Уведомления, ${unread} ${word}`;
}

function SideLink({ to, label, icon: Icon, end, badge, ariaLabel, action }: { to: string; label: string; icon: typeof House; end?: boolean; badge?: number; ariaLabel?: string; action?: string }) {
  const [tip, setTip] = useState<number | null>(null);
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={ariaLabel ?? label}
      data-agent-action={action}
      className="group relative flex h-11 w-11 items-center justify-center gap-2 rounded-2xl text-sm xl:w-full xl:justify-start xl:px-3"
      onMouseEnter={(event) => setTip(event.currentTarget.getBoundingClientRect().top + 6)}
      onMouseLeave={() => setTip(null)}
      onFocus={(event) => setTip(event.currentTarget.getBoundingClientRect().top + 6)}
      onBlur={() => setTip(null)}
    >
      {({ isActive }) => (
        <>
          {isActive ? <motion.span layoutId="sideActive" className="absolute inset-0 rounded-2xl bg-white/75 dark:bg-white/10" transition={{ type: "spring", stiffness: 350, damping: 30 }} /> : null}
          <Icon className="relative h-5 w-5 shrink-0" />
          {tip != null ? <span className="pointer-events-none fixed z-50 whitespace-nowrap rounded-full bg-slate-900 px-2 py-1 text-xs font-medium text-white xl:hidden" style={{ left: "4.75rem", top: tip }}>{label}</span> : null}
          <span className="relative hidden min-w-0 flex-1 truncate xl:block">{label}</span>
          {badge ? <span className="relative hidden rounded-full bg-[var(--primary)] px-1.5 text-xs text-[var(--primary-ink)] xl:inline">{badge}</span> : null}
        </>
      )}
    </NavLink>
  );
}

function UserChip({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth();
  return (
    <div className="liquid-glass hidden p-3 xl:block">
      <div className="glass-pad">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-sm text-[var(--primary-ink)]">{user?.initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{user?.fullName}</p>
            <p className="truncate text-xs text-[var(--muted)]">{user?.groupName ?? (user?.role === "teacher" ? "Преподаватель" : "Учебный офис")}</p>
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <AskButton />
          <ThemeButton />
          <button type="button" className="btn btn-quiet h-11 w-11 px-0" aria-label="Выйти" onClick={onLogout}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AskButton() {
  const agent = useAgent();
  if (agent.open && !agent.peek) return null;
  return (
    <button type="button" className="btn btn-quiet h-11 px-3" onClick={() => { agent.setPreferChat(true); agent.setPeek(false); agent.setOpen(true); }}>
      <Sparkles className="h-4 w-4" /> Спросить
    </button>
  );
}

function ThemeButton() {
  const run = useAction();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const next = dark ? "light" : "dark";
  return (
    <button
      type="button"
      className="btn btn-quiet h-11 w-11 px-0"
      data-agent-action="theme-toggle"
      aria-label={next === "dark" ? "Тёмная тема" : "Светлая тема"}
      onClick={() => {
        setDark(next === "dark");
        void run("update_settings", { theme: next });
      }}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
