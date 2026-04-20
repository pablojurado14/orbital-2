"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  disabled?: boolean;
  matchPrefix?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Pacientes", href: "/pacientes" },
  { label: "Citas", href: "/citas", disabled: true },
  { label: "Configuración", href: "/settings/gabinetes", matchPrefix: true },
];

export default function Sidebar() {
  const pathname = usePathname();

  const isActive = (item: NavItem) => {
    if (item.matchPrefix) return pathname.startsWith("/settings");
    return pathname === item.href;
  };

  return (
    <aside
      style={{
        width: 220,
        background: "#0F2744",
        color: "white",
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minHeight: "100vh",
      }}
    >
      <div style={{ padding: "0 4px" }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, color: "white" }}>
          ORBITAL
        </div>
        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Dental Flow</div>
      </div>

      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          borderRadius: 12,
          padding: "12px 14px",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Clínica Demo</div>
        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
          4 gabinetes · 3 doctores
        </div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const disabled = item.disabled === true;

          const baseStyle: React.CSSProperties = {
            display: "block",
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            transition: "background 0.15s, color 0.15s",
          };

          if (disabled) {
            return (
              <span
                key={item.href}
                style={{
                  ...baseStyle,
                  color: "#475569",
                  cursor: "not-allowed",
                }}
                title="Próximamente"
              >
                {item.label}
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...baseStyle,
                color: active ? "white" : "#B6C2D1",
                background: active ? "rgba(0,194,199,0.12)" : "transparent",
                borderLeft: active ? "3px solid #00C2C7" : "3px solid transparent",
                paddingLeft: 9,
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", fontSize: 10, color: "#475569", padding: "0 4px" }}>
        v2.0 · clean core
      </div>
    </aside>
  );
}
