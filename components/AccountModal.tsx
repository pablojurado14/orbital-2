"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { changePasswordAction, type ChangePasswordResult } from "@/app/(app)/_actions/auth";

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string | null;
}

export default function AccountModal({ isOpen, onClose, userEmail }: AccountModalProps) {
  const [result, setResult] = useState<ChangePasswordResult | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Reset estado al cerrar
  useEffect(() => {
    if (!isOpen) {
      setResult(null);
      formRef.current?.reset();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const r = await changePasswordAction(formData);
      setResult(r);
      if (r.ok) form.reset();
    });
  }

  const errorText = (() => {
    if (!result || result.ok) return null;
    switch (result.error) {
      case "not_authenticated": return "Sesión no válida. Recarga e intenta de nuevo.";
      case "wrong_current": return "La contraseña actual no es correcta.";
      case "too_short": return "La nueva contraseña debe tener al menos 8 caracteres.";
      case "too_long": return "La nueva contraseña es demasiado larga (máximo 72 caracteres).";
      case "mismatch": return "La nueva contraseña y la confirmación no coinciden.";
      default: return "No se pudo cambiar la contraseña. Inténtalo de nuevo.";
    }
  })();

  if (!mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 16,
          padding: 28,
          width: "100%",
          maxWidth: 440,
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: "#64748B",
            fontSize: 20,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>

        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0F2744", marginBottom: 4 }}>
          Mi cuenta
        </h2>
        {userEmail !== null && (
          <p style={{ fontSize: 12, color: "#64748B", marginBottom: 20 }}>{userEmail}</p>
        )}

        <form ref={formRef} onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Contraseña actual" name="currentPassword" autoComplete="current-password" />
          <Field label="Nueva contraseña" name="newPassword" autoComplete="new-password" hint="Mínimo 8 caracteres." />
          <Field label="Confirmar nueva contraseña" name="confirmPassword" autoComplete="new-password" />

          {result?.ok === true && (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#DCFCE7", color: "#166534", fontSize: 13 }}>
              Contraseña actualizada correctamente.
            </div>
          )}
          {errorText !== null && (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#FEE2E2", color: "#991B1B", fontSize: 13 }}>
              {errorText}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                background: "transparent",
                color: "#64748B",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid #CBD5E1",
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                background: pending ? "#94A3B8" : "#0F2744",
                color: "white",
                fontSize: 14,
                fontWeight: 600,
                border: "none",
                cursor: pending ? "wait" : "pointer",
                flex: 1,
              }}
            >
              {pending ? "Guardando..." : "Cambiar contraseña"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function Field({ label, name, autoComplete, hint }: { label: string; name: string; autoComplete: string; hint?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#0F2744" }}>{label}</span>
      <input
        type="password"
        name={name}
        autoComplete={autoComplete}
        required
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #CBD5E1",
          fontSize: 14,
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      {hint !== undefined && (
        <span style={{ fontSize: 11, color: "#64748B" }}>{hint}</span>
      )}
    </label>
  );
}