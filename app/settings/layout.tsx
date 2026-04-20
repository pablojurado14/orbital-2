"use client";

import Sidebar from "@/components/Sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;

  const tabBaseClass = "px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200";
  const tabActiveClass = "bg-white shadow-sm font-bold text-slate-900";
  const tabInactiveClass = "text-slate-600 hover:text-slate-900 hover:bg-slate-200/80";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F5F1EB" }}>
      <Sidebar />
      
      <main className="flex-1 p-6">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Configuración</h1>
            <p className="text-slate-600">
              Gestiona los recursos estructurales, personal médico y parámetros operativos de la clínica.
            </p>
          </header>

          <nav className="flex space-x-2 bg-slate-200/60 p-1.5 rounded-xl mb-8 w-max">
            <Link 
              href="/settings/gabinetes" 
              className={`${tabBaseClass} ${isActive("/settings/gabinetes") ? tabActiveClass : tabInactiveClass}`}
            >
              Gabinetes
            </Link>

            <Link 
              href="/settings/dentistas" 
              className={`${tabBaseClass} ${isActive("/settings/dentistas") ? tabActiveClass : tabInactiveClass}`}
            >
              Dentistas
            </Link>

            <Link 
              href="/settings/tratamientos" 
              className={`${tabBaseClass} ${isActive("/settings/tratamientos") ? tabActiveClass : tabInactiveClass}`}
            >
              Tratamientos
            </Link>

            <Link 
              href="/settings/horarios" 
              className={`${tabBaseClass} ${isActive("/settings/horarios") ? tabActiveClass : tabInactiveClass}`}
            >
              Horarios
            </Link>
          </nav>

          <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}
