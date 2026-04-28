# ORBITAL Core — Contrato arquitectónico

> **Versión:** 2.1
> **Fecha:** 28 de abril de 2026 (cierre Sesión 11A)
> **Estado:** vinculante. Sustituye al v2.0.
> **Bump from v2.0:** añadida §11.5 (multi-tenant lógico — Sesión 11A) y §13 path migratorio actualizado. Sin cambios en §1-§10 ni en los tipos del modelo mental.
> **Política:** este contrato es vinculante. La implementación de Sesiones 12-17 debe respetarlo. Cambios al contrato requieren entrada fechada en §10 del master y bump de versión aquí.
> **Referencia del master:** §1.2 tesis estratégica, §1.7 bis principios de diseño del motor, §6 roadmap del bloque del motor (Sesiones 11B-19).

---

## 0. Cambios respecto al v2.0

1. **§11.5 nuevo** — Multi-tenant lógico vía `lib/tenant.ts`. El clean core sigue siendo agnóstico de tenant; el aislamiento se aplica en la capa de adaptación.
2. **§13 actualizado** — Sesión 10 y Sesión 11A marcadas como cerradas. Path migratorio reflejando estado real.
3. **§4-§10 sin cambios** — los tipos del modelo mental, los 6 componentes y el mapeo ES↔TS son estables desde v2.0.

---

## 1. Propósito

El motor de ORBITAL es la pieza **reutilizable entre verticales** (dental → ambulatorio → hospital) y **entre mercados** (ES → PT → DACH → LatAm). Esa reutilización solo es posible si el motor no tiene acoplamiento a ninguna de esas dimensiones.

**Qué hace el motor:**

1. Recibe eventos del exterior (12 tipos) y reconstruye `DayState`.
2. Razona en ciclos "observar-pensar-proponer" disparados por evento o por reloj proactivo.
3. Genera acciones candidatas componiendo primitivas de un catálogo cerrado (10 tipos).
4. Valida cada candidata contra restricciones duras y blandas.
5. Simula cada candidata aplicada al estado para proyectar KPIs.
6. Puntúa con función lineal ponderada + penalización por varianza + coste de cambio.
7. Compara contra "no actuar" y propone si supera umbral.
8. Devuelve `CycleDecision` con propuesta + explicación + alternativas consideradas + nivel de autonomía.

**Qué NO hace:**

- No toca persistencia (sin Prisma, sin SQL, sin ORM).
- No habla ningún idioma humano (ni ES, ni EN, ni DE).
- No conoce vocabulario de dominio ("gabinete", "endodoncia").
- No conoce monedas ni símbolos monetarios.
- No asume unidades concretas de tiempo (no "slots de 30 min").
- No devuelve colores, iconos, ni decisiones visuales.
- No hace llamadas de red ni IO.
- **No conoce el concepto de tenant (multi-tenant lógico vive en capa de adaptación, ver §11.5).**

---

## 2. Principios rectores

### 2.1 Pureza funcional

Toda función exportada por el core es pura: mismo input → mismo output. Sin side effects, sin IO, sin acceso a `Date.now()` ni randomness interna.

### 2.2 Abstracción de dominio total

El core razona sobre primitivas universales (recurso, evento, duración, valor, distribución, restricción), no sobre conceptos de un vertical concreto.

### 2.3 Códigos, no strings

Todo output destinado a humanos sale del core como **código enumerable** (`ExplanationCode`, `ExplanationMotiveCode`, `DiscardReasonCode`, `ConstraintCode`, `ProjectedEventKind`, `CriticalPointKind`).

### 2.4 Contratos explícitos

Los tipos del core se definen **en el core**. Las capas externas se adaptan al core, no al revés.

### 2.5 Configurabilidad sobre hardcoding

Pesos, slot, estrategia de detección — configuración inyectada, no hardcoded.

### 2.6 UTC interno, timezone externo

Todos los timestamps dentro del core son **epoch ms en UTC**.

### 2.7 Robusto, no optimista

El Scorer (C5) penaliza varianza. Acciones con valor esperado peor pero menor varianza pueden ganar.

### 2.8 Anytime, no exhaustivo

El Generator (C3) opera con time-budget. Devuelve la mejor solución encontrada, no busca el óptimo global.

---

## 3. Primitivas fundamentales

```typescript
// lib/core/primitives.ts
export type ResourceId = string;
export type EventId = string;
export type CandidateId = string;
export type InstantUTC = number;       // epoch ms en UTC
export type DurationMs = number;       // ms — sin asumir slots
export type MonetaryAmount = number;   // sin moneda
export type ScoreRatio = number;       // [0, 1]

export const SLOT_30_MIN_MS: DurationMs = 30 * 60 * 1000;
export const SLOT_15_MIN_MS: DurationMs = 15 * 60 * 1000;
```

`tenantId`, `patientId`, `professionalId`, `roomId`, `equipmentId` se representan como `string` opacos en `lib/core/types.ts`. Si en el futuro hace falta type-safety adicional, se promueven a branded types (cambio aditivo).

---

## 4. Tipos del v1.0 — base del clean core

Definidos en `lib/core/types.ts`. Implementados en Sesión 9 v1.0. Conservan su forma exacta en v2.0/v2.1.

- `EventStatus = "confirmed" | "delayed" | "cancelled" | "suggested"`
- `DecisionState = "pending" | "accepted" | "rejected"`
- `ExplanationCode` (14 valores) — códigos del Scorer v1.0 sin simulación.
- `ExternalRefs = Readonly<Record<string, string>>`
- `ScheduledEvent { id, resourceId, start, duration, status, value?, externalRefs? }`
- `WaitingCandidate { id, preferredResourceId?, desiredDuration, value, priority, easeScore, availableNow, externalRefs? }`
- `Gap { resourceId, start, duration, originEventId }`
- `ScoreBreakdown { value, fit, ease, availability, resource, priority }`
- `RankedCandidate { candidateId, totalScore, breakdown, explanationCodes }`
- `Suggestion { gap, recommended, alternatives }`
- `EngineResult { suggestions, recoveredValue, recoveredGaps, decision }`

---

## 5. Tipos del modelo mental (Sesión 10)

### 5.1 Distribuciones probabilísticas

```typescript
export interface DurationDistribution {
  readonly mean: DurationMs;
  readonly stdDev: DurationMs;
  readonly p10: DurationMs;
  readonly p50: DurationMs;
  readonly p90: DurationMs;
}

export interface MinutesDistribution {
  readonly mean: DurationMs;     // mean libre (puede ser negativo)
  readonly stdDev: DurationMs;
  readonly p10: DurationMs;
  readonly p50: DurationMs;
  readonly p90: DurationMs;
}

export interface TimeRange {
  readonly start: InstantUTC;
  readonly end: InstantUTC;
}
```

### 5.2 Estado del día

`DayState` es el "tablero" reconstruido en cada ciclo del Coordinator (C6). Política Sesión 10: reconstruir cada ciclo (no cachear).

```typescript
export interface DayState {
  readonly tenantId: string;
  readonly date: InstantUTC;
  readonly currentInstant: InstantUTC;
  readonly rooms: ReadonlyArray<RoomState>;
  readonly professionals: ReadonlyArray<ProfessionalState>;
  readonly equipment: ReadonlyArray<EquipmentState>;
  readonly appointments: ReadonlyArray<AppointmentState>;
  readonly pendingEvents: ReadonlyArray<EngineEvent>;
  readonly currentProjectedKPIs: KPIVector;
}
```

Sub-estados: `RoomState`, `ProfessionalState`, `EquipmentState`, `AppointmentState` (con `estimatedEndDistribution: DurationDistribution` y `detectedRisks: AppointmentRisks`).

### 5.3 Vector de KPIs

```typescript
export interface KPIVector {
  readonly effectiveUtilization: ScoreRatio;     // [0, 1]
  readonly expectedOvertime: DurationMs;
  readonly meanWaitTime: DurationMs;
  readonly expectedForcedCancellations: number;
  readonly projectedBillableValue: MonetaryAmount;
  readonly risk: number;                         // varianza ponderada
}
```

`risk` es **derivado**, no input directo: el Simulator (C4) lo calcula a partir de las varianzas de los demás KPIs.

### 5.4 Acciones primitivas y compuestas

10 primitivas como discriminated union sobre `kind`:

`move`, `compress`, `expand`, `advance`, `postpone`, `reassign_professional`, `reassign_resource`, `fill_from_waitlist`, `cancel_and_reschedule`, `no_op`.

```typescript
export type CompositeAction = ReadonlyArray<PrimitiveAction>;
```

Helper `validateCompositionCoherence(c)` verifica coherencia estructural. `no_op` siempre presente como acción candidata explícita.

### 5.5 Validación de restricciones

```typescript
export interface ValidationResult {
  readonly valid: boolean;
  readonly hardViolations: ReadonlyArray<ConstraintViolation>;
  readonly softViolations: ReadonlyArray<ConstraintViolation>;
}
```

12 códigos de restricción (`ConstraintCode`): clinical_safety, legal_regulatory, physical, professional_hours, professional_break, patient_preference, patient_tolerance, patient_availability, resource_availability, chaining, information_dependency, economic_dependency.

### 5.6 Simulación

```typescript
export interface SimulationResult {
  readonly expectedKPIs: KPIVector;       // valores p50
  readonly varianceKPIs: KPIVector;       // varianza por KPI
  readonly projectedEvents: ReadonlyArray<ProjectedEvent>;
  readonly criticalPoints: ReadonlyArray<CriticalPoint>;
}
```

**Decisión Sesión 10:** Simulator (C4) inicial determinista (p50 + varianza analítica desde p10/p90). Monte Carlo se difiere a post-piloto.

### 5.7 Decisión y explicación

```typescript
export interface CycleDecision {
  readonly proposal: CompositeAction | null;
  readonly explanation: Explanation;
  readonly autonomyLevel: AutonomyLevel;
  readonly autoExecutedActions: ReadonlyArray<PrimitiveAction>;
}

export interface Explanation {
  readonly recommendedAction: CompositeAction;
  readonly motiveCode: ExplanationMotiveCode;
  readonly consideredAlternatives: ReadonlyArray<ConsideredAlternative>;
  readonly ifRejectedKPIs: KPIVector;
  readonly projectedKPIs: KPIVector;
}
```

`AutonomyLevel`: `auto_executable | quick_suggestion | detailed_suggestion | notify_only`. `consideredAlternatives` ordenado por `score` descendente.

### 5.8 Eventos — API de entrada al motor

12 tipos como discriminated union sobre `kind`. Cada evento dispara una llamada al Coordinator (C6).

| `kind` | Tipo |
|---|---|
| `patient_arrival` | `PatientArrivalEvent` |
| `appointment_started` | `AppointmentStartedEvent` |
| `in_progress_update` | `InProgressUpdateEvent` |
| `appointment_completed` | `AppointmentCompletedEvent` |
| `cancellation` | `CancellationEvent` |
| `no_show_detected` | `NoShowDetectedEvent` |
| `walk_in` | `WalkInEvent` |
| `professional_absence` | `ProfessionalAbsenceEvent` |
| `equipment_unavailable` | `EquipmentUnavailableEvent` |
| `constraint_change` | `ConstraintChangeEvent` |
| `proactive_tick` | `ProactiveTickEvent` |
| `manual_signal` | `ManualSignalEvent` |

---

## 6. Componentes del motor

### C1 — Predictor

```
predictDuration(context)         → DurationDistribution
predictNoShow(appointmentId)     → ScoreRatio
predictLateness(appointmentId)   → MinutesDistribution
predictAdviceAcceptance(...)     → ScoreRatio
updateInProgress(id, signals)    → DurationDistribution
```

Implementación inicial (Sesión 12): distribuciones del catálogo maestro (`Procedure.referenceDuration*` y `ProcedureActivation.learnedDuration*`, añadidas en Sesión 11B) + reglas de fallback. ML diferido a post-piloto.

### C2 — Validator

```
validate(state, action)                → ValidationResult
listCompatible(appointment, kind)      → ReadonlyArray<ResourceId>
```

Implementación: motor de reglas tipadas que opera sobre `ConstraintCode` (Sesión 13).

### C3 — Generator

```
generateCandidates(state, trigger, budgetMs) → ReadonlyArray<CompositeAction>
```

Implementación: búsqueda local greedy con time-budget + anytime algorithm (Sesión 14). Devuelve "no_op" siempre como candidata.

### C4 — Simulator

```
simulate(state, action) → SimulationResult
```

Implementación inicial determinista (Sesión 15).

### C5 — Scorer

```
score(simulationResult, weights, changeCost) → number
```

Combinación lineal ponderada + penalización por varianza + penalización por coste de cambio (Sesión 16). La "personalidad" del motor para cada clínica vive aquí.

### C6 — Coordinator

```
runCycle(event) → CycleDecision
```

Único componente que conoce el flujo completo (Sesión 17):

1. Reconstruye `DayState` (consultando schema, aplicando filtros `clinicId`).
2. Pide predicciones al Predictor.
3. Pide candidatas al Generator.
4. Para cada candidata: Validator → Simulator → Scorer.
5. Compara contra `no_op` simulado igual.
6. Si supera umbral, construye `CycleDecision` con `Explanation`.
7. Según política de autonomía: ejecuta o entrega al humano.

---

## 7. Mapeo documento ES ↔ código TS

| Documento (`logica-reoptimizacion-saas.md`) | Código TypeScript |
|---|---|
| `EstadoDelDía` | `DayState` |
| `EstadoSala` | `RoomState` |
| `EstadoProfesional` | `ProfessionalState` |
| `EstadoEquipamiento` | `EquipmentState` |
| `EstadoCita` | `AppointmentState` |
| `DistribuciónDuración` | `DurationDistribution` |
| `DistribuciónMinutos` | `MinutesDistribution` |
| `AccionPrimitiva` | `PrimitiveAction` |
| `AccionCompuesta` | `CompositeAction` |
| `VectorKPIs` | `KPIVector` |
| `ResultadoValidacion` | `ValidationResult` |
| `ResultadoSimulacion` | `SimulationResult` |
| `DecisionDelCiclo` | `CycleDecision` |
| `ObjetoExplicacion` | `Explanation` |
| `EventoLlegadaPaciente` | `PatientArrivalEvent` |
| `EventoCitaIniciada` | `AppointmentStartedEvent` |
| `EventoActualizacionInProgress` | `InProgressUpdateEvent` |
| `EventoCitaCompletada` | `AppointmentCompletedEvent` |
| `EventoCancelacionPaciente` | `CancellationEvent` |
| `EventoNoShowDetectado` | `NoShowDetectedEvent` |
| `EventoWalkIn` | `WalkInEvent` |
| `EventoAusenciaProfesional` | `ProfessionalAbsenceEvent` |
| `EventoIndisponibilidadEquipo` | `EquipmentUnavailableEvent` |
| `EventoCambioRestriccion` | `ConstraintChangeEvent` |
| `EventoTickProactivo` | `ProactiveTickEvent` |
| `EventoSeñalManual` | `ManualSignalEvent` |

Decisión de nomenclatura: el código está en inglés porque el clean core es infra reutilizable inter-vertical e inter-mercado.

---

## 8. Discrepancias del v1.0 markdown vs implementación real (resueltas en v2.0)

El contrato v1.0 markdown describía una API ligeramente distinta de la que terminó en `lib/core/types.ts` de Sesión 9 v1.0. Resolución (mantenida en v2.1): la implementación real es la fuente de verdad.

| Concepto | v1.0 markdown decía | Real (y v2.1) |
|---|---|---|
| `Gap.sourceEventId` | sí | renombrado a `originEventId` |
| `Gap.lostValue` | sí | eliminado (se deriva en capa dental) |
| `Gap.gapType` | sí | eliminado (Fase 2 — natural gaps) |
| `Suggestion` plana | sí | anidada `{ gap, recommended, alternatives }` |
| `EngineResult.gaps[]` separado | sí | embebido en cada `Suggestion` |
| `EngineResult.rankingsByGap` | sí | embebido `Suggestion.{recommended, alternatives}` |
| `EngineResult.recoveredGapsCount` | sí | renombrado a `recoveredGaps` |
| `WaitingCandidate.requiredDuration` | sí | renombrado a `desiredDuration` |
| `ExplanationCode.AVAILABILITY_IMMEDIATE/LIMITED` | sí | renombrado a `AVAILABILITY_HIGH/LOW` |
| `ExplanationCode.FIT_LOOSE` | sí | conservado |
| `ExplanationCode.PRIORITY_LOW` | sí | eliminado (no se usa) |
| `ExplanationCode.VALUE_MEDIUM` | no | añadido (umbral medio) |

---

## 9. Función principal del v1.0 — `decideFillForGap`

Sin cambios respecto al v1.0/v2.0. Sigue siendo la entrada del clean core hasta que el Coordinator (C6) la reemplace en Sesión 17.

```typescript
export function decideFillForGap(
  events: ReadonlyArray<ScheduledEvent>,
  waitingList: ReadonlyArray<WaitingCandidate>,
  config: EngineConfig = DEFAULT_CONFIG,
  decision: DecisionState = "pending",
): EngineResult;
```

Pura, sin IO, sin mutación.

---

## 10. Estrategias configurables

`EngineConfig` define `weights` (suman 1.0 ± 0.001), `fit`, `availability`, `resource`, `gapDetection`. Sin cambios respecto al v1.0.

---

## 11. Capas externas

`adapters/prisma.ts`: traduce Prisma → core types. Importa del core, nunca al revés.

`domains/dental.ts`: resuelve `externalRefs` opacos a nombres dentales. Hace traducción explícita entre `EngineResult` (core) y `DentalEngineView` (UI). Mantiene los nombres heredados de la UI (`recoveredGapsCount`, `sourceEventId`) hasta Sesión 18.

`ui/i18n/index.ts`: traduce códigos enumerables a strings ES.

`ui/format.ts`: formato de moneda, fechas en TZ del tenant.

`components/styles.ts`: colores, iconos, layout.

Dependencia estricta: `core/` no depende de nada. Adapters dependen del core. Dominios dependen del core. UI depende de dominios y i18n.

### 11.5 Multi-tenant lógico (NUEVO en v2.1 — Sesión 11A)

**El clean core sigue siendo agnóstico de tenant.** El aislamiento multi-tenant se aplica enteramente en la capa de adaptación, no dentro del motor. Materialización:

1. **`lib/tenant.ts`** centraliza el tenant actual:
   ```typescript
   export function getCurrentClinicId(): number {
     return 1;  // hasta Sesión 19.5 (auth real con JWT)
   }
   ```

2. **Todos los `prisma.X.findMany/findFirst/create/update/delete`** filtran por `clinicId: getCurrentClinicId()` en `where` o lo incluyen en `data`. Esta regla es **obligatoria para todas las tablas tenant-aware** (Gabinete, Dentist, TreatmentType, Patient, Appointment, RuntimeState, DaySchedule, y las que vengan en Sesiones 11B-D: Equipment, ProcedureActivation, ConstraintRule, WaitlistEntry).

3. **`Procedure` (catálogo maestro de Sesión 11B) NO lleva `clinicId`** — es referencia global mantenida por la empresa. Las clínicas se vinculan a procedimientos vía `ProcedureActivation` (que sí lleva `clinicId`).

4. **El clean core puede consumir un `DayState` con `tenantId: string`** (definido en `types.ts §5.2`), pero no impone cómo se obtiene ese `tenantId`. La capa de adaptación lo rellena leyendo `getCurrentClinicId()`.

5. **El Coordinator (C6, Sesión 17)** recibe el `tenantId` desde fuera y lo propaga al adapter al reconstruir `DayState`. **No lo deriva el motor** — eso violaría 2.2 (abstracción de dominio total).

**Limitación reconocida (deuda RLS-MULTITENANT en master §4.2):** este aislamiento es lógico, no físico. Postgres no fuerza nada. Aceptable mientras hay un solo tenant. Antes del 2º cliente piloto (Sesión 19.5 o antes), activar Row-Level Security en Postgres + JWT con `clinicaId` claim. La firma de `getCurrentClinicId()` no cambia — solo su implementación.

---

## 12. Invariantes y tests

### 12.1 Invariantes del v1.0 (mantenidos)

| ID | Invariante | Test |
|---|---|---|
| I-1 | Pureza de `decideFillForGap` | `engine.test.ts` |
| I-2 | No mutación de `events` ni `waitingList` | `engine.test.ts` |
| I-3 | `sum(weights) === 1.0 ± 0.001` | `engine.test.ts` |
| I-4 | Toda `Suggestion.gap` apunta a un evento cancelado real | `engine.test.ts` |
| I-5 | Monotonicidad: candidato dominante → mayor score | `engine.test.ts` |
| I-6 | Estabilidad: orden de inputs no afecta ranking | `engine.test.ts` |
| I-7 | Fidelidad numérica con v7.3 (Mónica T. = 0.98) | `engine.test.ts` |

### 12.2 Invariantes del modelo mental (Sesión 10)

| ID | Invariante | Test |
|---|---|---|
| I-8 | `DurationDistribution`: `mean > 0`, `stdDev >= 0`, `p10 >= 0`, `p10 <= p50 <= p90` | `types.test.ts` |
| I-9 | `MinutesDistribution`: `stdDev >= 0`, `p10 <= p50 <= p90` (mean libre) | `types.test.ts` |
| I-10 | `validateCompositionCoherence`: composición vacía es inválida | `types.test.ts` |
| I-11 | `validateCompositionCoherence`: detecta duplicados y conflictos por `eventId` | `types.test.ts` |
| I-12 | `KPIVector.risk` es derivado de varianza, no input directo | (verificado en Simulator C4 — Sesión 15) |
| I-13 | `no_op` siempre presente como candidata en cada ciclo | (verificado en C6 — Sesión 17) |
| I-14 | `Explanation.consideredAlternatives` ordenado por `score` DESC | `types.test.ts` |
| I-15 | `CompositeAction` con `no_op` no coexiste con otras primitivas | `types.test.ts` |

### 12.3 Invariantes de multi-tenant (Sesión 11A)

| ID | Invariante | Test |
|---|---|---|
| I-16 | Toda query Prisma sobre tabla tenant-aware filtra por `clinicId` | (revisión manual + futuro lint) |
| I-17 | Todo `prisma.X.create` sobre tabla tenant-aware incluye `clinicId` en `data` | (revisión manual + futuro lint) |
| I-18 | `getCurrentClinicId()` es la única fuente del tenant actual | (convención del codebase) |

I-16/17/18 no tienen test automático todavía. Se cubrirán con un lint custom o con RLS Postgres en Sesión 19.5.

---

## 13. Path migratorio

### Sesión 10 — Tipos del modelo mental + contrato v2.0 ✅ CERRADA

1. ✅ `lib/core/types.ts` ampliado con tipos del modelo mental.
2. ✅ `lib/core/types.test.ts` con invariantes I-8 a I-15 (22 tests).
3. ✅ `docs/core-contract.md` v2.0.
4. ✅ Realineado `lib/core/engine.ts`, `lib/core/engine.test.ts`, `lib/core/primitives.ts`, `lib/core/config.ts`, `lib/adapters/prisma.ts`, `lib/domains/dental.ts` con la API real (deuda Sesión 9 v1.0).

### Sesión 11A — Multi-tenant lógico ✅ CERRADA

1. ✅ `ClinicSettings` extendido con `zonaHoraria`, `pesosKpi`, `politicaAutonomia`, `umbralDisparoProactivo`.
2. ✅ `clinicId` (nullable) añadido a Gabinete, Dentist, TreatmentType, Patient, Appointment, RuntimeState.
3. ✅ Migración `20260428150140_extend_clinicsettings_add_clinicid` aplicada.
4. ✅ Backfill `clinicId=1` en 31 filas existentes vía `scripts/backfill-clinicid.ts`.
5. ✅ `lib/tenant.ts` con `getCurrentClinicId()`.
6. ✅ 12 archivos (4 API routes, 5 actions.ts, 6 page.tsx, seed.ts) refactorizados con `clinicId`.
7. ✅ Contrato bumpeado a v2.1 con §11.5.

### Sesión 11B (siguiente) — Catálogo maestro

Tablas nuevas: `Procedure` (global), `Equipment` (por clínica), `ProcedureActivation` (clínica × procedimiento), `EquipmentRoom` (m-n).

### Sesiones 11C-11D — Extensiones del schema

11C: extender Dentist/Gabinete con vectores de capacidades + Patient con scores predictivos.
11D: Appointment runtime extendido + ConstraintRule + WaitlistEntry separado.

### Sesiones 12-17 — Componentes C1 a C6

Un componente por sesión. Cada uno respeta su contrato (§6).

### Sesión 18 — Migración masiva de callers

`route.ts`, `OrbitalPanel.tsx`, `AgendaGrid.tsx` consumen los nuevos tipos directamente. Capa dental ya no traduce nombres heredados.

### Sesión 19 — Borrado del legacy

`lib/orbital-engine.ts` se borra. Solo el clean core ejecuta lógica.

### Sesión 19.5 — RLS Postgres + auth real

Cierra deuda **RLS-MULTITENANT**. `getCurrentClinicId()` lee del JWT en lugar de devolver `1`.

---

## 14. Evolución prevista

- **Multi-gap óptimo**: cambiar `gapDetection` a `all_cancelled` + matching húngaro. La estructura `EngineResult.suggestions[]` ya lo permite.
- **Huecos naturales** (Fase 2): `gapType: "natural"` reintroducido si hace falta.
- **ML del Predictor**: sustituye distribuciones del catálogo por modelos entrenados con datos de pilotos. No cambia el contrato del C1.
- **Monte Carlo en Simulator**: sustituye determinismo. No cambia el contrato del C4.
- **Restricciones contextuales avanzadas**: añadir códigos a `ConstraintCode`. Cambio aditivo.
- **Multi-tenant físico** (DB por clínica para tier enterprise): cambio en `lib/prisma.ts` para resolver conexión por tenant. Clean core sigue intacto.

Si alguna evolución futura no encaja en este contrato, se documenta como bump de versión (2.x → 3.0) con entrada en §10 del master.
