import React from "react";
import { Activity, Calendar, TrendingUp, Euro, type LucideIcon } from "lucide-react";

interface KPIGridProps {
  metrics: {
    appointmentsCount: number;
    occupancy: number;
    recoveredGaps: number;
    recoveredRevenue: number;
  };
}

type KPIItem = {
  label: string;
  value: string;
  accent: string;
  accentBg: string;
  icon: LucideIcon;
};

export const KPIGrid: React.FC<KPIGridProps> = ({ metrics }) => {
  const { appointmentsCount, occupancy, recoveredGaps, recoveredRevenue } = metrics;

  const kpis: KPIItem[] = [
    {
      label: "Ocupación",
      value: `${occupancy}%`,
      accent: "text-blue-700",
      accentBg: "bg-blue-50",
      icon: Activity,
    },
    {
      label: "Citas hoy",
      value: appointmentsCount.toString(),
      accent: "text-purple-700",
      accentBg: "bg-purple-50",
      icon: Calendar,
    },
    {
      label: "Huecos recuperados",
      value: recoveredGaps.toString(),
      accent: "text-green-700",
      accentBg: "bg-green-50",
      icon: TrendingUp,
    },
    {
      label: "Ingresos recuperados",
      value: `${recoveredRevenue}€`,
      accent: "text-orange-700",
      accentBg: "bg-orange-50",
      icon: Euro,
    },
  ];

  return (
    <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <div
            key={kpi.label}
            className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-lg ${kpi.accentBg} ${kpi.accent}`}
              >
                <Icon className="h-5 w-5" />
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-500">{kpi.label}</p>
              <h3 className="text-2xl font-bold text-slate-900">{kpi.value}</h3>
            </div>
          </div>
        );
      })}
    </div>
  );
};