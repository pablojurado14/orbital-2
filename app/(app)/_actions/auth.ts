"use server";

import { signOut, auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: "not_authenticated" | "wrong_current" | "too_short" | "too_long" | "mismatch" | "unknown" };

export async function changePasswordAction(formData: FormData): Promise<ChangePasswordResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "not_authenticated" };

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) return { ok: false, error: "mismatch" };
  if (newPassword.length < 8) return { ok: false, error: "too_short" };
  if (Buffer.byteLength(newPassword, "utf8") > 72) return { ok: false, error: "too_long" };

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true },
    });
    if (!user || !user.passwordHash) return { ok: false, error: "wrong_current" };

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return { ok: false, error: "wrong_current" };

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return { ok: true };
  } catch {
    return { ok: false, error: "unknown" };
  }
}