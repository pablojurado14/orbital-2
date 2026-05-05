-- Habilita Row Level Security en tablas tenant-aware.
-- Las queries deben ejecutarse dentro de una transaccion con
-- SET LOCAL app.current_clinic_id = N
-- mediante el wrapper withClinic (lib/tenant-prisma.ts).
--
-- Tablas EXCLUIDAS de RLS:
-- - ClinicSettings: identidad de la clinica, no tenant-aware
-- - Procedure: catalogo global compartido entre clinicas
-- - EquipmentRoom, AppointmentEquipment: tenancy heredada via FK
-- - User, Account, Session, VerificationToken: Auth.js PrismaAdapter
--   accede sin sesion durante login/register; tenancy enforced en codigo
--
-- Edge case conocido (deuda RLS-ROLE-OWNER-BYPASS-V1):
-- Sin FORCE, el role OWNER bypassea RLS. Cierre futuro: app_role no-owner.

ALTER TABLE "DaySchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DaySchedule"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "Equipment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Equipment"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "ProcedureActivation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcedureActivation"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "ConstraintRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConstraintRule"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WaitlistEntry"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "RejectedCandidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RejectedCandidate"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "Gabinete" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Gabinete"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "Dentist" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Dentist"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "TreatmentType" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreatmentType"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Patient"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Appointment"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);

ALTER TABLE "RuntimeState" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RuntimeState"
  USING ("clinicId" = current_setting('app.current_clinic_id', true)::int)
  WITH CHECK ("clinicId" = current_setting('app.current_clinic_id', true)::int);