import type { NextAuthConfig } from "next-auth";

/**
 * Auth.js v5 config edge-compatible.
 *
 * Sesión 19.5: solo Credentials provider (email + password) por ahora.
 * El callback `authorized` controla qué rutas requieren login. Hoy:
 * todo excepto /login y /api/auth/* requiere usuario autenticado.
 *
 * Esta config NO importa Prisma ni bcryptjs porque corre en edge runtime
 * desde el middleware. La validación real de credentials vive en auth.ts.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      const isOnAuthApi = nextUrl.pathname.startsWith("/api/auth");

      if (isOnLogin) {
        // Si ya estás logueado y vas a /login, redirige al dashboard.
        if (isLoggedIn) {
          return Response.redirect(new URL("/", nextUrl));
        }
        return true;
      }

      if (isOnAuthApi) {
        return true;
      }

      // Toda otra ruta requiere login.
      return isLoggedIn;
    },
    jwt({ token, user }) {
      // Cuando un usuario hace login, copiamos clinicId + role al JWT.
      // En llamadas posteriores, `user` es undefined; los datos persisten
      // en `token`.
      if (user) {
        token.clinicId = (user as { clinicId: number }).clinicId;
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      // Exponemos clinicId + role en la session para que getCurrentClinicId()
      // pueda leerlos.
      if (session.user) {
        (session.user as { clinicId?: number }).clinicId = token.clinicId as number;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;