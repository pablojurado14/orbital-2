import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData) {
  "use server";

  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    redirect("/login?error=invalid");
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=invalid");
    }
    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const showError = params.error === "invalid";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md border border-slate-200 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">ORBITAL</h1>
          <p className="text-sm text-slate-500 mt-1">Inicia sesión para continuar</p>
        </div>

        <form action={loginAction} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
            <input
              type="email"
              name="email"
              required
              autoFocus
              className="w-full p-2 border rounded mt-1 bg-white"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Contraseña</label>
            <input
              type="password"
              name="password"
              required
              className="w-full p-2 border rounded mt-1 bg-white"
            />
          </div>

          {showError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Email o contraseña incorrectos.
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-slate-900 text-white p-3 rounded-xl font-bold mt-2 hover:bg-slate-800 transition-colors"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}