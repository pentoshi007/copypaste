import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config — imported by middleware.ts.
 * No DB / bcrypt access here (those are Node-only).
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [], // defined in auth.ts (Node runtime)
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnApp = nextUrl.pathname === "/";
      const isOnAuth =
        nextUrl.pathname === "/login" || nextUrl.pathname === "/signup";

      if (isOnApp) {
        return isLoggedIn; // redirect unauthed → /login
      }
      if (isOnAuth) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/", nextUrl));
        }
        return true;
      }
      return true;
    },
  },
};
