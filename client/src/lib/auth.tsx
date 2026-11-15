import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { PublicUser } from "@shared/domain";
import { api } from "./api";
import { applyTheme } from "./theme";

interface AuthValue {
  user?: PublicUser;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: PublicUser }>("/api/me"),
    retry: false,
  });

  useEffect(() => {
    if (query.data?.user.theme) applyTheme(query.data.user.theme);
  }, [query.data?.user.theme]);

  useEffect(() => {
    const lost = () => {
      queryClient.removeQueries({ queryKey: ["me"] });
      if (location.pathname !== "/login" && !location.pathname.startsWith("/verify")) navigate("/login");
    };
    window.addEventListener("auth:lost", lost);
    return () => window.removeEventListener("auth:lost", lost);
  }, [navigate, queryClient]);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    sessionStorage.clear();
    queryClient.clear();
    navigate("/login");
  };

  return (
    <AuthContext.Provider value={{ user: query.data?.user, loading: query.isLoading, error: query.error as Error | null, refresh: query.refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider");
  return value;
}
