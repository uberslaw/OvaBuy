import { auth } from "@/auth";
import { logDiagnostic } from "@/lib/diagnostics";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const publicPaths = ["/login", "/api/auth", "/api/health"];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  logDiagnostic("request", {
    method: req.method,
    pathname,
    authenticated: isLoggedIn,
  });

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
