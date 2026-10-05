import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/download",
  "/forgot-password",
  "/reset-password",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  // Build/runtime assets must stay reachable anonymously: sw.js is the
  // service worker (redirects are disallowed for SW scripts) and env.js is a
  // config file fetched at boot (a login redirect returns HTML and breaks
  // JSON parsing). The matcher below already excludes other static paths.
  "/sw.js",
  "/env.js",
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get("session");

  if (!session || !session.value || session.value.split(".").length !== 3) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const base64Payload = session.value.split(".")[1];
    if (!base64Payload) throw new Error("Missing JWT payload segment");
    // Decode base64url -> base64 -> JSON
    const normalized = base64Payload.replace(/-/g, "+").replace(/_/g, "=");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  } catch {
    // Invalid/malformed JWT — treat as unauthenticated without leaking details
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons).*)"],
};
