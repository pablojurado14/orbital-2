import Link from "next/link";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Configuración</h1>
        <p className="text-slate-600">
          Gestiona los recursos estructurales, personal médico y parámetros operativos de la clínica.
        </p>
      </header>

      <nav className="mb-6 flex gap-2 border-b border-slate-200">
        <SettingsTab href="/settings/gabinetes" label="Gabinetes" />
        <SettingsTab href="/settings/dentistas" label="Dentistas" />
        <SettingsTab href="/settings/tratamientos" label="Tratamientos" />
        <SettingsTab href="/settings/horarios" label="Horarios" />
      </nav>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingsTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors border-b-2 border-transparent hover:border-slate-300"
    >
      {label}
    </Link>
  );
}