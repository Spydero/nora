const BASE = "/api/v1";
const CSRF_COOKIE = "nora_csrf";
const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout", "/auth/csrf"];

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly correlationId?: string,
    readonly fields: FieldError[] = [],
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function getCsrfToken(): Promise<string> {
  csrfToken ??= readCookie(CSRF_COOKIE);
  if (csrfToken) return csrfToken;
  const res = await fetch(`${BASE}/auth/csrf`, { credentials: "same-origin" });
  const body = (await res.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; retryable?: boolean; correlation_id?: string; details?: { fields?: FieldError[] } };
  } | null;
  const error = body?.error;
  return new ApiError(
    res.status,
    error?.code ?? "HTTP_ERROR",
    error?.message ?? "Something went wrong. Please try again.",
    error?.retryable ?? false,
    error?.correlation_id,
    error?.details?.fields ?? [],
  );
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET" && method !== "HEAD") headers["x-csrf-token"] = await getCsrfToken();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Rotates the refresh token once, sharing the result between concurrent callers. */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const res = await send("/auth/refresh", "POST");
    if (res.ok) return true;
    const error = await toApiError(res);
    return error.code === "REFRESH_RACE";
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? "GET";
  let res = await send(path, method, options.body);

  if (res.status === 403) {
    const error = await toApiError(res.clone());
    if (error.code === "CSRF_TOKEN_INVALID") {
      csrfToken = null;
      res = await send(path, method, options.body);
    }
  }

  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path) && (await refreshSession())) {
    res = await send(path, method, options.body);
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
