export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readCsrf() {
  const match = document.cookie.match(/(?:^|; )csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

let sessionEpoch = 0;

/** Помечает, что сессия только что установлена. Ответ 401 от запроса, начатого раньше, сессию не сбрасывает. */
export function acceptSession() {
  sessionEpoch += 1;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const epoch = sessionEpoch;
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") headers.set("x-csrf-token", readCsrf());
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: "include" });
  } catch {
    throw new ApiError(0, "network", "Нет связи с сервером");
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (response.status === 401 && !path.startsWith("/api/auth/login") && epoch === sessionEpoch) {
    window.dispatchEvent(new Event("auth:lost"));
  }
  if (!response.ok) throw new ApiError(response.status, data?.error ?? "error", data?.message ?? "Не получилось выполнить запрос");
  return data as T;
}
