"use client";

import { useState } from "react";
import AgendaGrid from "@/components/AgendaGrid";
import NewAppointmentModal from "@/components/NewAppointmentModal";

type AppointmentStatus = "confirmed" | "delayed" | "cancelled" | "suggested";

type Appointment = {
  id?: number;
  start: string;
  gabinete: string;
  patient: string;
  type: string;
  durationSlots: number;
  status: AppointmentStatus;
  value: number;
};

type Gabinete = { id: number; name: string };
type Patient = { id: number; name: string };
type Dentist = { id: number; name: string };
type Treatment = { id: number; name: string; duration: number; price: number | null };

type Props = {
  appointments: Appointment[];
  gabinetes: Gabinete[];
  patients: Patient[];
  dentists: Dentist[];
  treatments: Treatment[];
  date: string;
};

export default function CitasClient({
  appointments,
  gabinetes,
  patients,
  dentists,
  treatments,
  date,
}: Props) {
  const [newSlot, setNewSlot] = useState<{ gabinete: Gabinete; startTime: string } | null>(null);

  const handleEmptySlotClick = (gabineteName: string, hour: string) => {
    const gab = gabinetes.find((g) => g.name === gabineteName);
    if (!gab) return;
    setNewSlot({ gabinete: gab, startTime: hour });
  };

  return (
    <>
      <AgendaGrid
        appointments={appointments}
        gabinetes={gabinetes.map((g) => g.name)}
        editable={true}
        onEmptySlotClick={handleEmptySlotClick}
        gabinetesForMove={gabinetes}
      />

      {newSlot ? (
        <NewAppointmentModal
          gabinete={newSlot.gabinete}
          startTime={newSlot.startTime}
          date={date}
          patients={patients}
          dentists={dentists}
          treatments={treatments}
          onClose={() => setNewSlot(null)}
        />
      ) : null}
    </>
  );
}