"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Configuración</h1>
        <p className="text-slate-600">
          Gestiona los recursos estructurales, personal médico y parámetros operativos de la clínica.
        </p>
      </header>
      <nav className="mb-6 flex gap-2">
        <SettingsTab href="/settings/gabinetes" label="Gabinetes" pathname={pathname} />
        <SettingsTab href="/settings/dentistas" label="Dentistas" pathname={pathname} />
        <SettingsTab href="/settings/tratamientos" label="Tratamientos" pathname={pathname} />
        <SettingsTab href="/settings/horarios" label="Horarios" pathname={pathname} />
      </nav>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingsTab({
  href,
  label,
  pathname,
}: {
  href: string;
  label: string;
  pathname: string;
}) {
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={
        isActive
          ? "px-4 py-2 text-sm font-bold rounded-xl bg-white text-slate-900 border border-slate-200 shadow-sm transition-colors"
          : "px-4 py-2 text-sm font-bold rounded-xl bg-transparent text-slate-500 border border-transparent hover:text-slate-900 hover:bg-white/60 transition-colors"
      }
    >
      {label}
    </Link>
  );
}