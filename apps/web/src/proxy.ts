import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/brand"];

/**
 * Fast redirect for visitors with no session cookies at all. The API still
 * authorises every request; this only avoids rendering protected screens.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has("nora_at") || request.cookies.has("nora_session");
  if (hasSession) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?)$).*)"],
};
