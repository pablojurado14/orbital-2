# ORBITAL Core — Contrato arquitectónico

> **Versión:** 2.0
> **Fecha:** 28-29 de abril de 2026
> **Estado:** vinculante. Sustituye al v1.0.
> **Bump from v1.0:** ampliación con tipos del modelo mental (`docs/orbital-engine-logic.md` ≡ `logica-reoptimizacion-saas.md`), 6 componentes del motor, 10 acciones primitivas componibles, 12 eventos de entrada. Invariantes y arquitectura del v1.0 conservados.
> **Política:** este contrato es vinculante. La implementación de Sesiones 12-17 debe respetarlo. Cambios al contrato requieren entrada fechada en §10 del master y bump de versión aquí.
> **Referencia del master:** §1.2 tesis estratégica, §1.7 bis principios de diseño del motor, §7 bloque del motor (Sesiones 10-19).

---

## 0. Cambios respecto al v1.0

1. **§5 nuevo** — Tipos del modelo mental: `DurationDistribution`, `MinutesDistribution`, `DayState` y sub-estados, `KPIVector`, `PrimitiveAction` (10 variantes) + `CompositeAction`, `ValidationResult`, `SimulationResult`, `Explanation`, `CycleDecision`, `EngineEvent` (12 variantes).
2. **§6 nuevo** — Mapeo de tipos a los 6 componentes (Predictor, Validator, Generator, Simulator, Scorer, Coordinator).
3. **§7 nuevo** — Mapeo documento ES ↔ código TS.
4. **§8 nuevo** — Apéndice con discrepancias entre el v1.0 markdown y la implementación real de Sesión 9 v1.0, resueltas en este v2.0.
5. **§13 actualizado** — Path migratorio reformulado al bloque del motor (Sesiones 10-19) en lugar del migratorio S9-S11 del v1.0.
6. **Tipos del v1.0 conservados sin cambios**: `ScheduledEvent`, `WaitingCandidate`, `Gap`, `RankedCandidate`, `ScoreBreakdown`, `Suggestion`, `EngineResult`, `ExplanationCode` (14 valores).

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

---

## 2. Principios rectores (sin cambios respecto al v1.0)

### 2.1 Pureza funcional

Toda función exportada por el core es pura: mismo input → mismo output. Sin side effects, sin IO, sin acceso a `Date.now()` ni randomness interna. Si el motor necesita "ahora", se le pasa como parámetro.

### 2.2 Abstracción de dominio total

El core razona sobre primitivas universales (recurso, evento, duración, valor, distribución, restricción), no sobre conceptos de un vertical concreto. Si al leer el código del core pudieras adivinar que es "para dentistas", la abstracción ha fallado.

### 2.3 Códigos, no strings

Todo output destinado a humanos sale del core como **código enumerable** (`ExplanationCode`, `ExplanationMotiveCode`, `DiscardReasonCode`, `ConstraintCode`, `ProjectedEventKind`, `CriticalPointKind`). La traducción a texto humano vive en la capa i18n.

### 2.4 Contratos explícitos

Los tipos del core se definen **en el core**. Las capas externas se adaptan al core, no al revés. Prohibido `import { ... } from "@/data/mock"` dentro de `core/`.

### 2.5 Configurabilidad sobre hardcoding

Lo que en motores anteriores estaba hardcoded (pesos, slot de 30 min, estrategia de detección) pasa a ser **configuración inyectada**.

### 2.6 UTC interno, timezone externo

Todos los timestamps dentro del core son **epoch ms en UTC**. La conversión a TZ del tenant vive en `ui/format.ts`.

### 2.7 Robusto, no optimista (NUEVO en v2.0)

El Scorer (C5) penaliza varianza, no solo valor esperado. Una acción con valor esperado ligeramente peor pero menor varianza puede ganar. La varianza viene del Simulator (C4), calculada de las distribuciones p10/p90 del Predictor (C1).

### 2.8 Anytime, no exhaustivo (NUEVO en v2.0)

El Generator (C3) opera con time-budget. Devuelve la mejor solución encontrada cuando se acaba el presupuesto, no busca el óptimo global. Filosofía de satisficing.

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

`tenantId`, `patientId`, `professionalId`, `roomId`, `equipmentId` se representan como `string` opacos en `lib/core/types.ts`. Si en el futuro hace falta type-safety adicional, se promueven a branded types en `primitives.ts` (cambio aditivo).

---

## 4. Tipos del v1.0 — base del clean core

Definidos en `lib/core/types.ts`. Implementados en Sesión 9 v1.0, consumidos por `decideFillForGap` (función principal del v1.0). Conservan su forma exacta en v2.0.

- `EventStatus = "confirmed" | "delayed" | "cancelled" | "suggested"`
- `DecisionState = "pending" | "accepted" | "rejected"`
- `ExplanationCode` (14 valores) — códigos del Scorer v1.0 sin simulación.
- `ExternalRefs = Readonly<Record<string, string>>`
- `ScheduledEvent` { id, resourceId, start, duration, status, value?, externalRefs? }
- `WaitingCandidate` { id, preferredResourceId?, desiredDuration, value, priority, easeScore, availableNow, externalRefs? }
- `Gap` { resourceId, start, duration, originEventId }
- `ScoreBreakdown` { value, fit, ease, availability, resource, priority }
- `RankedCandidate` { candidateId, totalScore, breakdown, explanationCodes }
- `Suggestion` { gap, recommended, alternatives }
- `EngineResult` { suggestions, recoveredValue, recoveredGaps, decision }

Estos tipos son la base sobre la que se construye el motor completo. Los componentes C1-C6 los consumen y los extienden con los tipos del modelo mental (§5), pero no los redefinen.

---

## 5. Tipos del modelo mental — Sesión 10 (NUEVO en v2.0)

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

**Uso**: el Predictor (C1) devuelve `DurationDistribution` para tiempos positivos (duración de procedimientos) y `MinutesDistribution` para señales firmadas (impuntualidad: negativo si llega antes, positivo si llega tarde). El Simulator (C4) consume ambas para construir varianza.

### 5.2 Estado del día

`DayState` es el "tablero" reconstruido en cada ciclo del Coordinator (C6), agregado a partir de la base de datos. La política de Sesión 10 es reconstruir cada ciclo (no cachear) — robusto a caídas, escalable horizontalmente.

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

Sub-estados: `RoomState`, `ProfessionalState`, `EquipmentState`, `AppointmentState` (con `estimatedEndDistribution: DurationDistribution` y `detectedRisks: AppointmentRisks`). Definiciones completas en `lib/core/types.ts`.

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

`risk` es **derivado**, no input directo: el Simulator (C4) lo calcula a partir de las varianzas de los demás KPIs, ponderadas según pesos de la clínica. Ver invariante I-12 en §12.2.

### 5.4 Acciones primitivas y compuestas

10 primitivas como discriminated union sobre `kind`:

`move`, `compress`, `expand`, `advance`, `postpone`, `reassign_professional`, `reassign_resource`, `fill_from_waitlist`, `cancel_and_reschedule`, `no_op`.

```typescript
export type CompositeAction = ReadonlyArray<PrimitiveAction>;
```

Las acciones se **componen**: una solución típica es "mover López a Torres + invitar waitlist al hueco resultante de García". Helper `validateCompositionCoherence(c)` verifica coherencia estructural. `no_op` siempre presente como acción candidata explícita (invariante I-13 en §12.2).

### 5.5 Validación de restricciones

```typescript
export interface ValidationResult {
  readonly valid: boolean;                // true si no hay hard violations
  readonly hardViolations: ReadonlyArray<ConstraintViolation>;
  readonly softViolations: ReadonlyArray<ConstraintViolation>;
}
```

Restricciones duras invalidan la acción; soft penalizan el score. 12 códigos de restricción (`ConstraintCode`): clinical_safety, legal_regulatory, physical, professional_hours, professional_break, patient_preference, patient_tolerance, patient_availability, resource_availability, chaining, information_dependency, economic_dependency.

### 5.6 Simulación

```typescript
export interface SimulationResult {
  readonly expectedKPIs: KPIVector;       // valores p50
  readonly varianceKPIs: KPIVector;       // varianza por KPI
  readonly projectedEvents: ReadonlyArray<ProjectedEvent>;
  readonly criticalPoints: ReadonlyArray<CriticalPoint>;
}
```

**Decisión Sesión 10 (master §10):** la implementación inicial del Simulator (C4) es **determinista**, usando p50 como valor esperado y varianza calculada analíticamente desde p10/p90 del Predictor. Monte Carlo con N muestras se difiere a sesión post-piloto cuando haya datos reales.

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

`AutonomyLevel`: `auto_executable | quick_suggestion | detailed_suggestion | notify_only` (4 niveles del modelo mental capa 9).

`consideredAlternatives` está ordenado por `score` descendente (invariante I-14 en §12.2).

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

Bus de eventos asíncrono recomendado entre SaaS y motor (cola persistente, escala independiente). Implementación concreta del bus se decide en Sesión 17.

---

## 6. Componentes del motor (NUEVO en v2.0)

Los 6 componentes del modelo mental, con sus tipos de entrada y salida.

### C1 — Predictor

```
predictDuration(context)         → DurationDistribution
predictNoShow(appointmentId)     → ScoreRatio
predictLateness(appointmentId)   → MinutesDistribution
predictAdviceAcceptance(...)     → ScoreRatio
updateInProgress(id, signals)    → DurationDistribution
```

Implementación inicial (Sesión 12): distribuciones del catálogo maestro + reglas de fallback. ML (gradient boosting) se difiere a post-piloto.

### C2 — Validator

```
validate(state, action)                → ValidationResult
listCompatible(appointment, kind)      → ReadonlyArray<ResourceId>
```

Implementación: motor de reglas tipadas que opera sobre los códigos `ConstraintCode`.

### C3 — Generator

```
generateCandidates(state, trigger, budgetMs) → ReadonlyArray<CompositeAction>
```

Implementación: búsqueda local greedy con time-budget + anytime algorithm. Devuelve "no_op" siempre como candidata.

### C4 — Simulator

```
simulate(state, action) → SimulationResult
```

Implementación inicial determinista (p50 + varianza analítica), Monte Carlo en versión post-piloto.

### C5 — Scorer

```
score(simulationResult, weights, changeCost) → number
```

Combinación lineal ponderada + penalización por varianza + penalización por coste de cambio. La "personalidad" del motor para cada clínica vive aquí.

### C6 — Coordinator

```
runCycle(event) → CycleDecision
```

Único componente que conoce el flujo completo:

1. Reconstruye `DayState`.
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

Decisión de nomenclatura: el código está en inglés porque el clean core es infra reutilizable inter-vertical e inter-mercado (ES → PT → DACH → LatAm). Los conceptos del modelo mental viven en castellano en el documento por razones de mercado inicial pero en el código se traducen para coherencia con el resto del repo (ya en inglés desde Sesión 9 v1.0).

---

## 8. Discrepancias del v1.0 markdown vs implementación real (resueltas en v2.0)

El contrato v1.0 en su forma markdown describía una API ligeramente distinta de la que terminó en `lib/core/types.ts` de Sesión 9 v1.0. Resolución: la implementación real es la fuente de verdad.

| Concepto | v1.0 markdown decía | Real (y v2.0) |
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

Adicionalmente: la API real no diferencia "no hay gap" vs "hay gap sin candidato viable" en su output (ambos casos: `suggestions: []`). Si esa visibilidad se requiere para UX (mostrar "hay hueco pero no hay candidato"), se reintroduce en Sesión 18 al migrar callers.

---

## 9. Función principal del v1.0 — `decideFillForGap`

Sin cambios respecto al v1.0. Sigue siendo la entrada del clean core v1.0 hasta que el Coordinator (C6) la reemplace en Sesión 17.

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

### 12.2 Invariantes nuevos en v2.0

| ID | Invariante | Test |
|---|---|---|
| I-8 | `DurationDistribution`: `mean > 0`, `stdDev >= 0`, `p10 >= 0`, `p10 <= p50 <= p90` | `types.test.ts` |
| I-9 | `MinutesDistribution`: `stdDev >= 0`, `p10 <= p50 <= p90` (mean libre) | `types.test.ts` |
| I-10 | `validateCompositionCoherence`: composición vacía es inválida | `types.test.ts` |
| I-11 | `validateCompositionCoherence`: detecta duplicados y conflictos por `eventId` | `types.test.ts` |
| I-12 | `KPIVector.risk` es derivado de varianza, no input directo del usuario | (verificado en Simulator C4 — Sesión 15) |
| I-13 | `no_op` siempre presente como candidata en cada ciclo del Coordinator | (verificado en C6 — Sesión 17) |
| I-14 | `Explanation.consideredAlternatives` ordenado por `score` DESC | `types.test.ts` |
| I-15 | `CompositeAction` con `no_op` no coexiste con otras primitivas | `types.test.ts` |

---

## 13. Path migratorio

### Sesión 10 (cerrando) — Tipos del modelo mental + contrato v2.0

1. Ampliar `lib/core/types.ts` con tipos del modelo mental.
2. Crear `lib/core/types.test.ts` con invariantes I-8 a I-15.
3. Reescribir `docs/core-contract.md` como v2.0.
4. Realinear `lib/core/engine.ts`, `lib/core/engine.test.ts`, `lib/adapters/prisma.ts`, `lib/domains/dental.ts` con la API real (deuda de Sesión 9 v1.0 detectada con primer `tsc --noEmit`).

### Sesión 11 — Schema ampliado

Catálogo maestro versionado, vectores de capacidades, restricciones como entidades de primera clase, scores predictivos por paciente, equipamiento con modalidad fijo/itinerante.

### Sesiones 12-17 — Componentes C1 a C6

Un componente por sesión. Cada componente respeta su contrato (§6) y puede sustituirse sin tocar los demás.

### Sesión 18 — Migración masiva de callers

`route.ts`, `OrbitalPanel.tsx`, `AgendaGrid.tsx` consumen los nuevos tipos directamente. La capa dental ya no traduce nombres heredados (`recoveredGapsCount` → `recoveredGaps` en la UI).

### Sesión 19 — Borrado del legacy

`lib/orbital-engine.ts` se borra. Solo el clean core ejecuta lógica.

---

## 14. Evolución prevista

- **Multi-gap óptimo**: cambiar `gapDetection` a `all_cancelled` + algoritmo de matching (p.ej. húngaro). La estructura `EngineResult.suggestions[]` ya lo permite.
- **Huecos naturales** (Fase 2): `gapType: "natural"` reintroducido si hace falta diferenciar de cancelados.
- **ML del Predictor**: sustituye distribuciones del catálogo por modelos entrenados con datos de pilotos. No cambia el contrato del C1.
- **Monte Carlo en Simulator**: sustituye determinismo p50 + varianza analítica. No cambia el contrato del C4.
- **Restricciones contextuales avanzadas**: añadir códigos a `ConstraintCode`. Cambio aditivo.

Si alguna evolución futura no encaja en este contrato, se documenta como bump de versión (2.x → 3.0) con entrada en §10 del master.
