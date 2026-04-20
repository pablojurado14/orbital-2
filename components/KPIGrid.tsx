import React from "react";

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
  marker: string;
};

export const KPIGrid: React.FC<KPIGridProps> = ({ metrics }) => {
  const { appointmentsCount, occupancy, recoveredGaps, recoveredRevenue } = metrics;

  const kpis: KPIItem[] = [
    {
      label: "Ocupación",
      value: `${occupancy}%`,
      accent: "text-blue-700",
      accentBg: "bg-blue-50",
      marker: "OC",
    },
    {
      label: "Citas hoy",
      value: appointmentsCount.toString(),
      accent: "text-purple-700",
      accentBg: "bg-purple-50",
      marker: "CI",
    },
    {
      label: "Huecos recuperados",
      value: recoveredGaps.toString(),
      accent: "text-green-700",
      accentBg: "bg-green-50",
      marker: "HR",
    },
    {
      label: "Ingresos recuperados",
      value: `${recoveredRevenue}€`,
      accent: "text-orange-700",
      accentBg: "bg-orange-50",
      marker: "IR",
    },
  ];

  return (
    <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm"
        >
          <div className="mb-4 flex items-center justify-between">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-lg text-sm font-bold ${kpi.accentBg} ${kpi.accent}`}
            >
              {kpi.marker}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-500">{kpi.label}</p>
            <h3 className="text-2xl font-bold text-slate-900">{kpi.value}</h3>
          </div>
        </div>
      ))}
    </div>
  );
};