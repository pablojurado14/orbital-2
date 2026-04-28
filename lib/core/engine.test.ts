/**
 * ORBITAL Core — Tests del motor
 * -----------------------------------------------------------------------------
 * Cubre los 7 invariantes definidos en core-contract.md §9.
 *
 * Notas Sesión 10:
 *  - Tests reescritos contra la API real de Sesión 9 v1.0. Las aserciones que
 *    usaban `result.gaps`, `result.rankingsByGap` o `s.value` se reformulan
 *    porque la API actual embebe el gap dentro de cada Suggestion y no expone
 *    rankings separados.
 *  - Helper `rankingForOrigin(result, originEventId)` reconstruye el ranking
 *    completo (recommended + alternatives) para los tests que lo necesitan.
 */

import { describe, it, expect } from "vitest";
import { decideFillForGap } from "./engine";
import { DEFAULT_CONFIG, validateConfig } from "./config";
import type {
  EngineResult,
  RankedCandidate,
  ScheduledEvent,
  WaitingCandidate,
} from "./types";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function makeEvent(overrides: Partial<ScheduledEvent>): ScheduledEvent {
  return {
    id: "ev-1",
    resourceId: "res-1",
    start: Date.UTC(2026, 3, 28, 9, 0, 0),
    duration: 30 * MIN,
    status: "confirmed",
    value: 100,
    externalRefs: {},
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<WaitingCandidate>): WaitingCandidate {
  return {
    id: "cand-1",
    desiredDuration: 30 * MIN,
    value: 100,
    availableNow: true,
    easeScore: 0.5,
    priority: 0.5,
    externalRefs: {},
    ...overrides,
  };
}

/**
 * Helper: reconstruye el ranking completo (recommended + alternatives)
 * de un gap concreto identificado por su originEventId.
 * Devuelve [] si no hay suggestion para ese gap.
 */
function rankingForOrigin(
  result: EngineResult,
  originEventId: string,
): readonly RankedCandidate[] {
  const sug = result.suggestions.find((s) => s.gap.originEventId === originEventId);
  if (!sug) return [];
  return [sug.recommended, ...sug.alternatives];
}

/**
 * Seed equivalente al estado real de producción (Sesión 8 dashboard).
 * David Q. cancelado en 10:30 Gab.4 → gap.
 * Mónica T. debe ser top candidate con score ~0.98 (fidelidad con v7.3).
 */
function buildSeedScenario() {
  const today = Date.UTC(2026, 3, 28, 0, 0, 0);

  const events: ScheduledEvent[] = [
    makeEvent({ id: "ev-ana",    resourceId: "gab-1", start: today + 9 * HOUR,             duration: 30 * MIN, status: "confirmed", value: 45 }),
    makeEvent({ id: "ev-carlos", resourceId: "gab-1", start: today + 9 * HOUR + 30 * MIN,  duration: 60 * MIN, status: "confirmed", value: 120 }),
    makeEvent({ id: "ev-isabel", resourceId: "gab-2", start: today + 10 * HOUR,            duration: 60 * MIN, status: "confirmed", value: 160 }),
    makeEvent({ id: "ev-laura",  resourceId: "gab-3", start: today + 11 * HOUR,            duration: 60 * MIN, status: "delayed",   value: 70 }),
    makeEvent({ id: "ev-david",  resourceId: "gab-4", start: today + 10 * HOUR + 30 * MIN, duration: 60 * MIN, status: "cancelled", value: 150 }),
  ];

  const waitingList: WaitingCandidate[] = [
    makeCandidate({
      id: "cand-monica",
      desiredDuration: 60 * MIN,
      value: 180,
      preferredResourceId: "gab-4",
      availableNow: true,
      easeScore: 1.0,
      priority: 0.8,
    }),
    makeCandidate({
      id: "cand-luis",
      desiredDuration: 90 * MIN,
      value: 400,
      preferredResourceId: "gab-2",
      availableNow: false,
      easeScore: 0.4,
      priority: 1.0,
    }),
    makeCandidate({
      id: "cand-jorge",
      desiredDuration: 30 * MIN,
      value: 60,
      // sin preferredResourceId → resource "neutral"
      availableNow: true,
      easeScore: 1.0,
      priority: 0.6,
    }),
    makeCandidate({
      id: "cand-pilar",
      desiredDuration: 60 * MIN,
      value: 90,
      preferredResourceId: "gab-4",
      availableNow: true,
      easeScore: 0.8,
      priority: 0.4,
    }),
  ];

  return { events, waitingList };
}

// =============================================================================
// 1. PUREZA
// =============================================================================

describe("decideFillForGap — pureza", () => {
  it("dos llamadas con mismo input devuelven outputs deep-equal", () => {
    const { events, waitingList } = buildSeedScenario();
    const r1 = decideFillForGap(events, waitingList);
    const r2 = decideFillForGap(events, waitingList);
    expect(r1).toEqual(r2);
  });
});

// =============================================================================
// 2. NO MUTACIÓN
// =============================================================================

describe("decideFillForGap — no mutación", () => {
  it("no muta events ni waitingList", () => {
    const { events, waitingList } = buildSeedScenario();
    const eventsCopy = JSON.parse(JSON.stringify(events));
    const waitingCopy = JSON.parse(JSON.stringify(waitingList));
    decideFillForGap(events, waitingList);
    expect(events).toEqual(eventsCopy);
    expect(waitingList).toEqual(waitingCopy);
  });
});

// =============================================================================
// 3. INVARIANTE DE PESOS
// =============================================================================

describe("validateConfig — invariante de pesos", () => {
  it("acepta DEFAULT_CONFIG", () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it("rechaza pesos que no suman 1.0", () => {
    const bad = {
      ...DEFAULT_CONFIG,
      weights: {
        value: 0.5, fit: 0.5, ease: 0.5,
        availability: 0, resource: 0, priority: 0,
      },
    };
    expect(() => validateConfig(bad)).toThrow(/debe sumar 1\.0/);
  });

  it("rechaza pesos negativos", () => {
    const bad = {
      ...DEFAULT_CONFIG,
      weights: {
        value: -0.1, fit: 0.35, ease: 0.2,
        availability: 0.1, resource: 0.05, priority: 0.1,
      },
    };
    expect(() => validateConfig(bad)).toThrow(/no puede ser negativo/);
  });
});

// =============================================================================
// 4. INVARIANTE DE RESULTADO
// =============================================================================

describe("decideFillForGap — invariante de resultado", () => {
  it("toda suggestion contiene un gap que apunta a un evento cancelado real", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList);
    for (const s of result.suggestions) {
      expect(s.gap).toBeDefined();
      const originEvent = events.find((e) => e.id === s.gap.originEventId);
      expect(originEvent).toBeDefined();
      expect(originEvent?.status).toBe("cancelled");
    }
  });

  it("recoveredValue=0 cuando decision='pending'", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList, DEFAULT_CONFIG, "pending");
    expect(result.recoveredValue).toBe(0);
    expect(result.recoveredGaps).toBe(0);
  });

  it("recoveredValue=sum(value de los recommended) cuando decision='accepted'", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList, DEFAULT_CONFIG, "accepted");
    const expectedSum = result.suggestions.reduce((sum, s) => {
      const cand = waitingList.find((c) => c.id === s.recommended.candidateId);
      return sum + (cand?.value ?? 0);
    }, 0);
    expect(result.recoveredValue).toBe(expectedSum);
    expect(result.recoveredGaps).toBe(result.suggestions.length);
  });

  it("recoveredValue=0 y recoveredGaps=0 cuando decision='rejected'", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList, DEFAULT_CONFIG, "rejected");
    expect(result.recoveredValue).toBe(0);
    expect(result.recoveredGaps).toBe(0);
  });
});

// =============================================================================
// 5. MONOTONICIDAD
// =============================================================================

describe("decideFillForGap — monotonicidad", () => {
  it("candidato dominante en todos los factores tiene mayor score", () => {
    const today = Date.UTC(2026, 3, 28, 0, 0, 0);
    const events: ScheduledEvent[] = [
      makeEvent({
        id: "ev-cancel", resourceId: "gab-1",
        start: today + 10 * HOUR, duration: 60 * MIN,
        status: "cancelled", value: 100,
      }),
    ];
    const dominant = makeCandidate({
      id: "cand-dom", desiredDuration: 60 * MIN, value: 200,
      preferredResourceId: "gab-1", availableNow: true,
      easeScore: 1.0, priority: 1.0,
    });
    const dominated = makeCandidate({
      id: "cand-sub", desiredDuration: 60 * MIN, value: 100,
      preferredResourceId: "gab-1", availableNow: true,
      easeScore: 0.5, priority: 0.5,
    });

    const result = decideFillForGap(events, [dominant, dominated]);
    expect(result.suggestions).toHaveLength(1);
    const sug = result.suggestions[0];
    expect(sug.recommended.candidateId).toBe("cand-dom");
    expect(sug.alternatives).toHaveLength(1);
    expect(sug.recommended.totalScore).toBeGreaterThan(sug.alternatives[0].totalScore);
  });
});

// =============================================================================
// 6. ESTABILIDAD
// =============================================================================

describe("decideFillForGap — estabilidad", () => {
  it("mismo set de candidatos en orden distinto produce mismo ranking", () => {
    const { events, waitingList } = buildSeedScenario();
    const reversed = [...waitingList].reverse();
    const r1 = decideFillForGap(events, waitingList);
    const r2 = decideFillForGap(events, reversed);
    const ranking1 = rankingForOrigin(r1, "ev-david");
    const ranking2 = rankingForOrigin(r2, "ev-david");
    expect(ranking1.map((r) => r.candidateId)).toEqual(
      ranking2.map((r) => r.candidateId),
    );
  });
});

// =============================================================================
// 7. FIDELIDAD NUMÉRICA CON v7.3
// =============================================================================

describe("decideFillForGap — fidelidad numérica con v7.3", () => {
  it("top candidate del seed es Mónica T. con score 0.98", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList);
    expect(result.suggestions).toHaveLength(1);
    const sug = result.suggestions[0];
    expect(sug.gap.originEventId).toBe("ev-david");
    expect(sug.recommended.candidateId).toBe("cand-monica");
    expect(sug.recommended.totalScore).toBeCloseTo(0.98, 2);
  });

  it("Luis F. (90 min en gap de 60 min) descartado por hard_filter", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList);
    const ranking = rankingForOrigin(result, "ev-david");
    expect(ranking.find((r) => r.candidateId === "cand-luis")).toBeUndefined();
  });

  it("orden completo de viables: Mónica > Pilar > Jorge", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList);
    const ranking = rankingForOrigin(result, "ev-david");
    expect(ranking.map((r) => r.candidateId)).toEqual([
      "cand-monica",
      "cand-pilar",
      "cand-jorge",
    ]);
  });

  it("explicación de Mónica incluye FIT_EXACT y RESOURCE_MATCH", () => {
    const { events, waitingList } = buildSeedScenario();
    const result = decideFillForGap(events, waitingList);
    const monica = result.suggestions[0].recommended;
    expect(monica.explanationCodes).toContain("FIT_EXACT");
    expect(monica.explanationCodes).toContain("RESOURCE_MATCH");
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("decideFillForGap — edge cases", () => {
  it("events vacío devuelve resultado vacío", () => {
    const result = decideFillForGap([], []);
    expect(result.suggestions).toEqual([]);
    expect(result.recoveredValue).toBe(0);
    expect(result.recoveredGaps).toBe(0);
  });

  it("sin gaps (no hay cancelled) devuelve resultado vacío", () => {
    const events: ScheduledEvent[] = [
      makeEvent({ id: "ev-1", status: "confirmed" }),
      makeEvent({ id: "ev-2", status: "delayed" }),
    ];
    const candidates = [makeCandidate({})];
    const result = decideFillForGap(events, candidates);
    expect(result.suggestions).toEqual([]);
  });

  it("gap sin candidatos viables: suggestions vacío", () => {
    const today = Date.UTC(2026, 3, 28, 0, 0, 0);
    const events: ScheduledEvent[] = [
      makeEvent({
        id: "ev-cancel", resourceId: "gab-1",
        start: today + 10 * HOUR, duration: 30 * MIN,
        status: "cancelled", value: 50,
      }),
    ];
    const candidates = [makeCandidate({ id: "cand-big", desiredDuration: 60 * MIN })];
    const result = decideFillForGap(events, candidates);
    expect(result.suggestions).toEqual([]);
    expect(result.recoveredGaps).toBe(0);
  });
});