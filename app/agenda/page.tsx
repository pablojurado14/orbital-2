export default function AgendaPage() {
  const gabinetes = ["Gab. 1", "Gab. 2", "Gab. 3", "Gab. 4"];

  const horas = [
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
  ];

  const citas = [
    { hora: "09:00", paciente: "Ana R.", tipo: "Revisión", gabinete: 0 },
    { hora: "09:00", paciente: "Pedro L.", tipo: "Extracción", gabinete: 1 },
    { hora: "09:00", paciente: "Elena T.", tipo: "Ortodoncia", gabinete: 2 },
    { hora: "09:00", paciente: "Pablo E.", tipo: "Revisión", gabinete: 3 },

    { hora: "09:30", paciente: "Carlos M.", tipo: "Empaste", gabinete: 0 },
    { hora: "09:30", paciente: "Lucía N.", tipo: "Limpieza", gabinete: 1 },

    { hora: "10:00", paciente: "Isabel V.", tipo: "Implante rev.", gabinete: 1 },
    { hora: "10:00", paciente: "Raúl B.", tipo: "Empaste x2", gabinete: 2 },

    { hora: "10:30", paciente: "Laura P.", tipo: "Limpieza", gabinete: 0 },
    { hora: "10:30", paciente: "David Q.", tipo: "Empaste x3", gabinete: 3 },

    { hora: "11:00", paciente: "Nuria C.", tipo: "Limpieza", gabinete: 2 },

    { hora: "11:30", paciente: "Javier D.", tipo: "Endodoncia", gabinete: 0 },
    { hora: "11:30", paciente: "Sara H.", tipo: "Empaste", gabinete: 1 },

    { hora: "12:00", paciente: "Óscar M.", tipo: "Revisión", gabinete: 2 },
    { hora: "12:00", paciente: "Carmen F.", tipo: "Limpieza", gabinete: 3 },

    { hora: "12:30", paciente: "Luis A.", tipo: "Revisión", gabinete: 1 },

    { hora: "13:00", paciente: "Marta S.", tipo: "Corona", gabinete: 0 },
    { hora: "13:00", paciente: "Beatriz G.", tipo: "Empaste", gabinete: 2 },
    { hora: "13:00", paciente: "Andrés J.", tipo: "Empaste", gabinete: 3 },
  ];

  return (
    <div className="min-h-screen bg-stone-100 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Agenda del día</h1>
          <p className="mt-1 text-sm text-slate-600">
            Vista en tiempo real — Orbital monitoriza cada gabinete
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Ocupación actual
            </div>
            <div className="mt-2 text-3xl font-semibold text-teal-600">87%</div>
            <div className="mt-1 text-xs text-slate-500">Meta 90%</div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Citas hoy
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">24</div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Huecos recuperados
            </div>
            <div className="mt-2 text-3xl font-semibold text-teal-600">0</div>
          </div>

          <div className="rounded-2xl bg-slate-900 p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Ingresos recuperados
            </div>
            <div className="mt-2 text-3xl font-semibold text-teal-400">€0</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="grid grid-cols-5 border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
            <div className="p-4">Hora</div>
            {gabinetes.map((gabinete) => (
              <div key={gabinete} className="border-l border-slate-200 p-4 text-center">
                {gabinete}
              </div>
            ))}
          </div>

          {horas.map((hora) => (
            <div
              key={hora}
              className="grid grid-cols-5 border-b border-slate-100 last:border-b-0"
            >
              <div className="bg-slate-50 p-4 text-sm font-medium text-slate-600">
                {hora}
              </div>

              {gabinetes.map((_, gabineteIndex) => {
                const cita = citas.find(
                  (c) => c.hora === hora && c.gabinete === gabineteIndex
                );

                return (
                  <div
                    key={`${hora}-${gabineteIndex}`}
                    className="min-h-[84px] border-l border-slate-100 p-2"
                  >
                    {cita ? (
                      <div className="h-full rounded-xl bg-teal-500 p-3 text-white shadow-sm">
                        <div className="text-sm font-semibold">{cita.paciente}</div>
                        <div className="mt-1 text-xs text-teal-50">{cita.tipo}</div>
                        <div className="mt-2 text-[11px] text-teal-100">{cita.hora}</div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
                        Libre
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}