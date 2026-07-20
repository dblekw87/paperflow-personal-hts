import {
  ThemeLeadershipInputSchema,
  ThemeLeadershipReportSchema,
  type ThemeLeadershipInput,
  type ThemeLeadershipReport,
} from "../contracts/theme-leadership.js";

type Fraction = { numerator: bigint; denominator: bigint };

const ZERO: Fraction = { numerator: 0n, denominator: 1n };
const ONE: Fraction = { numerator: 1n, denominator: 1n };
const HUNDRED: Fraction = { numerator: 100n, denominator: 1n };

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function fraction(numerator: bigint, denominator = 1n): Fraction {
  if (denominator === 0n) {
    throw new Error("Division by zero");
  }
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  };
}

function decimal(value: string): Fraction {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid decimal string: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const integer = match[2] ?? "0";
  const places = match[3] ?? "";
  return fraction(
    sign * BigInt(`${integer}${places}`),
    10n ** BigInt(places.length),
  );
}

function add(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtract(left: Fraction, right: Fraction): Fraction {
  return add(left, fraction(-right.numerator, right.denominator));
}

function multiply(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function divide(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}

function compare(left: Fraction, right: Fraction): number {
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function min(left: Fraction, right: Fraction): Fraction {
  return compare(left, right) <= 0 ? left : right;
}

function max(left: Fraction, right: Fraction): Fraction {
  return compare(left, right) >= 0 ? left : right;
}

function clamp(value: Fraction, lower: Fraction, upper: Fraction): Fraction {
  return min(max(value, lower), upper);
}

function format(value: Fraction, scale = 6): string {
  const negative = value.numerator < 0n;
  const absolute = negative ? -value.numerator : value.numerator;
  const multiplier = 10n ** BigInt(scale);
  let scaled =
    (absolute * multiplier + value.denominator / 2n) / value.denominator;
  const integer = scaled / multiplier;
  scaled %= multiplier;
  const fractionPart = scaled
    .toString()
    .padStart(scale, "0")
    .replace(/0+$/, "");
  const rendered =
    fractionPart.length > 0 ? `${integer}.${fractionPart}` : `${integer}`;
  return negative && rendered !== "0" ? `-${rendered}` : rendered;
}

function sum(values: Fraction[]): Fraction {
  return values.reduce(add, ZERO);
}

function isPositive(value: Fraction): boolean {
  return compare(value, ZERO) > 0;
}

function isAtLeast(value: Fraction, threshold: string): boolean {
  return compare(value, decimal(threshold)) >= 0;
}

function activeAt(
  mapping: ThemeLeadershipInput["mappings"][number],
  asOfMs: number,
): boolean {
  return (
    Date.parse(mapping.validFrom) <= asOfMs &&
    (mapping.validTo === null || Date.parse(mapping.validTo) > asOfMs) &&
    Date.parse(mapping.asOf) <= asOfMs &&
    mapping.evidence.every((evidence) => Date.parse(evidence.asOf) <= asOfMs)
  );
}

function scoreStatus(
  score: Fraction,
): "LEADING" | "EMERGING" | "ROTATING" | "WEAK" {
  if (isAtLeast(score, "70")) return "LEADING";
  if (isAtLeast(score, "50")) return "EMERGING";
  if (isAtLeast(score, "35")) return "ROTATING";
  return "WEAK";
}

export function analyzeThemeLeadership(
  rawInput: ThemeLeadershipInput,
): ThemeLeadershipReport {
  const input = ThemeLeadershipInputSchema.parse(rawInput);
  const asOfMs = Date.parse(input.asOf);
  const nodesById = new Map(input.taxonomy.map((node) => [node.id, node]));
  const instrumentsById = new Map(
    input.instruments.map((instrument) => [
      instrument.instrumentId,
      instrument,
    ]),
  );
  const excludedInstrumentIds = input.instruments
    .filter((instrument) =>
      ["ETF", "PREFERRED", "SPAC"].includes(instrument.securityType),
    )
    .map((instrument) => instrument.instrumentId)
    .sort();
  const excluded = new Set(excludedInstrumentIds);
  const warnings: string[] = [];

  const ancestryCache = new Map<string, string[]>();
  const ancestry = (nodeId: string): string[] => {
    const cached = ancestryCache.get(nodeId);
    if (cached) return cached;
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | null = nodeId;
    while (current !== null) {
      if (seen.has(current)) {
        throw new Error(`Taxonomy cycle detected at ${current}`);
      }
      seen.add(current);
      path.unshift(current);
      current = nodesById.get(current)?.parentId ?? null;
    }
    ancestryCache.set(nodeId, path);
    return path;
  };
  for (const node of input.taxonomy) ancestry(node.id);

  const mappingsByInstrument = new Map<
    string,
    ThemeLeadershipInput["mappings"]
  >();
  for (const mapping of input.mappings) {
    if (!activeAt(mapping, asOfMs) || excluded.has(mapping.instrumentId))
      continue;
    const existing = mappingsByInstrument.get(mapping.instrumentId) ?? [];
    existing.push(mapping);
    mappingsByInstrument.set(mapping.instrumentId, existing);
  }

  const effectiveMappings = new Map<string, ThemeLeadershipInput["mappings"]>();
  for (const [instrumentId, mappings] of mappingsByInstrument) {
    const uniqueByNode = new Map<string, (typeof mappings)[number]>();
    for (const mapping of mappings) {
      const existing = uniqueByNode.get(mapping.nodeId);
      const confidenceComparison = existing
        ? compare(decimal(mapping.confidence), decimal(existing.confidence))
        : 1;
      if (
        !existing ||
        confidenceComparison > 0 ||
        (confidenceComparison === 0 &&
          Date.parse(mapping.asOf) > Date.parse(existing.asOf))
      ) {
        uniqueByNode.set(mapping.nodeId, mapping);
      }
    }
    const unique = [...uniqueByNode.values()];
    const specific = unique.filter(
      (candidate) =>
        !unique.some(
          (other) =>
            other.nodeId !== candidate.nodeId &&
            ancestry(other.nodeId).includes(candidate.nodeId),
        ),
    );
    const allocated = sum(
      specific.map((mapping) => decimal(mapping.allocationWeight)),
    );
    if (compare(allocated, ONE) > 0) {
      throw new Error(
        `Active leaf mapping allocation exceeds 1 for ${instrumentId}`,
      );
    }
    effectiveMappings.set(instrumentId, specific);
  }

  const snapshotByInstrument = new Map<
    string,
    ThemeLeadershipInput["snapshots"][number]
  >();
  for (const snapshot of input.snapshots) {
    if (snapshot.sessionDate !== input.sessionDate) {
      throw new Error(
        `Snapshot session date mismatch: ${snapshot.instrumentId}`,
      );
    }
    if (snapshot.elapsedMinutes !== snapshot.baselineElapsedMinutes) {
      throw new Error(
        `Baseline is not aligned to elapsed time: ${snapshot.instrumentId}`,
      );
    }
    const existing = snapshotByInstrument.get(snapshot.instrumentId);
    if (
      !existing ||
      Date.parse(snapshot.observedAt) > Date.parse(existing.observedAt)
    ) {
      snapshotByInstrument.set(snapshot.instrumentId, snapshot);
    }
  }

  const isSnapshotStale = (
    snapshot: ThemeLeadershipInput["snapshots"][number],
  ): boolean =>
    snapshot.dataQuality === "STALE" ||
    snapshot.dataQuality === "MISSING" ||
    asOfMs - Date.parse(snapshot.observedAt) > input.staleAfterSeconds * 1_000;

  type Contribution = {
    instrumentId: string;
    nodeId: string;
    current: Fraction;
    baseline: Fraction | null;
    advancing: boolean;
    stale: boolean;
  };
  const contributions: Contribution[] = [];
  for (const [instrumentId, mappings] of effectiveMappings) {
    const snapshot = snapshotByInstrument.get(instrumentId);
    if (!snapshot) continue;
    const perNodeWeight = new Map<string, Fraction>();
    for (const mapping of mappings) {
      const weight = decimal(mapping.allocationWeight);
      for (const nodeId of ancestry(mapping.nodeId)) {
        const current = perNodeWeight.get(nodeId);
        perNodeWeight.set(nodeId, current ? max(current, weight) : weight);
      }
    }
    for (const [nodeId, weight] of perNodeWeight) {
      contributions.push({
        instrumentId,
        nodeId,
        current: multiply(decimal(snapshot.cumulativeTurnoverKrw), weight),
        baseline:
          snapshot.median20TurnoverKrwSameElapsed === null
            ? null
            : multiply(
                decimal(snapshot.median20TurnoverKrwSameElapsed),
                weight,
              ),
        advancing: compare(decimal(snapshot.changePct), ZERO) > 0,
        stale: isSnapshotStale(snapshot),
      });
    }
  }

  const marketTurnover = decimal(input.marketTurnoverKrw);
  const marketUnavailable =
    !isPositive(marketTurnover) ||
    input.marketDataQuality === "STALE" ||
    input.marketDataQuality === "MISSING" ||
    asOfMs - Date.parse(input.marketTurnoverObservedAt) >
      input.staleAfterSeconds * 1_000;
  if (marketUnavailable) {
    warnings.push("MARKET_TURNOVER_UNAVAILABLE");
  }

  const themes = input.taxonomy
    .map((node) => {
      const all = contributions.filter((item) => item.nodeId === node.id);
      const fresh = all.filter((item) => !item.stale);
      const staleCount = all.length - fresh.length;
      const current = sum(fresh.map((item) => item.current));
      const usableBaselines = fresh.filter(
        (item) => item.baseline !== null && isPositive(item.baseline),
      );
      const baseline =
        usableBaselines.length === fresh.length && fresh.length > 0
          ? sum(usableBaselines.map((item) => item.baseline ?? ZERO))
          : null;
      const acceleration =
        baseline !== null && isPositive(baseline)
          ? divide(current, baseline)
          : null;
      const marketShare = !marketUnavailable
        ? multiply(divide(current, marketTurnover), HUNDRED)
        : null;
      const breadth =
        fresh.length > 0
          ? multiply(
              fraction(
                BigInt(fresh.filter((item) => item.advancing).length),
                BigInt(fresh.length),
              ),
              HUNDRED,
            )
          : null;
      const sorted = [...fresh].sort((left, right) =>
        compare(right.current, left.current),
      );
      const top1 = sorted[0];
      const top1Concentration =
        top1 && isPositive(current)
          ? multiply(divide(top1.current, current), HUNDRED)
          : null;
      const top3Concentration = isPositive(current)
        ? multiply(
            divide(
              sum(sorted.slice(0, 3).map((item) => item.current)),
              current,
            ),
            HUNDRED,
          )
        : null;

      let availability: "AVAILABLE" | "PARTIAL" | "STALE" | "N_A";
      if (all.length > 0 && fresh.length === 0) {
        availability = "STALE";
      } else if (
        fresh.length === 0 ||
        !isPositive(current) ||
        baseline === null ||
        marketShare === null ||
        breadth === null
      ) {
        availability = "N_A";
      } else if (staleCount > 0 || input.marketDataQuality === "DELAYED") {
        availability = "PARTIAL";
      } else {
        availability = "AVAILABLE";
      }

      const topInstrument = top1
        ? instrumentsById.get(top1.instrumentId)
        : undefined;
      let structure:
        "BROAD" | "LARGE_CAP_SINGLE_NAME" | "CONCENTRATED" | "THIN" | null =
        null;
      if (availability === "AVAILABLE" || availability === "PARTIAL") {
        if (fresh.length < 3) {
          structure = "THIN";
        } else if (
          top1Concentration !== null &&
          isAtLeast(top1Concentration, "65") &&
          topInstrument?.isLargeCap === true
        ) {
          structure = "LARGE_CAP_SINGLE_NAME";
        } else if (
          top1Concentration !== null &&
          isAtLeast(top1Concentration, "65")
        ) {
          structure = "CONCENTRATED";
        } else {
          structure = "BROAD";
        }
      }

      let score: Fraction | null = null;
      let status: "LEADING" | "EMERGING" | "ROTATING" | "WEAK" | null = null;
      if (
        (availability === "AVAILABLE" || availability === "PARTIAL") &&
        acceleration !== null &&
        marketShare !== null &&
        breadth !== null &&
        top1Concentration !== null
      ) {
        const shareComponent = multiply(
          clamp(divide(marketShare, decimal("5")), ZERO, ONE),
          decimal("35"),
        );
        const accelerationComponent = multiply(
          clamp(divide(subtract(acceleration, ONE), decimal("2")), ZERO, ONE),
          decimal("30"),
        );
        const breadthComponent = multiply(
          divide(breadth, HUNDRED),
          decimal("20"),
        );
        const diversityComponent = multiply(
          subtract(ONE, divide(top1Concentration, HUNDRED)),
          decimal("15"),
        );
        score = add(
          add(shareComponent, accelerationComponent),
          add(breadthComponent, diversityComponent),
        );
        status = scoreStatus(score);
        if (structure !== "BROAD" && status === "LEADING") status = "ROTATING";
        if (
          status === "EMERGING" &&
          (!isAtLeast(acceleration, "1.5") ||
            structure === "LARGE_CAP_SINGLE_NAME")
        ) {
          status = "ROTATING";
        }
      }

      const pathLabelsKo = ancestry(node.id).map(
        (nodeId) => nodesById.get(nodeId)?.labelKo ?? nodeId,
      );
      return {
        nodeId: node.id,
        labelKo: node.labelKo,
        pathLabelsKo,
        availability,
        status,
        structure,
        leadershipScore: score === null ? null : format(score),
        turnoverKrw: format(current),
        median20TurnoverKrwSameElapsed:
          baseline === null ? null : format(baseline),
        turnoverAcceleration:
          acceleration === null ? null : format(acceleration),
        marketTurnoverSharePct:
          marketShare === null ? null : format(marketShare),
        advancingBreadthPct: breadth === null ? null : format(breadth),
        top1ConcentrationPct:
          top1Concentration === null ? null : format(top1Concentration),
        top3ConcentrationPct:
          top3Concentration === null ? null : format(top3Concentration),
        eligibleConstituentCount: fresh.length,
        advancingConstituentCount: fresh.filter((item) => item.advancing)
          .length,
        contributors: sorted.slice(0, 3).map((item) => {
          const instrument = instrumentsById.get(item.instrumentId);
          if (!instrument) {
            throw new Error(
              `Missing instrument metadata: ${item.instrumentId}`,
            );
          }
          return {
            instrumentId: item.instrumentId,
            nameKo: instrument.nameKo,
            contributionTurnoverKrw: format(item.current),
            contributionSharePct: isPositive(current)
              ? format(multiply(divide(item.current, current), HUNDRED))
              : "0",
            isLargeCap: instrument.isLargeCap,
          };
        }),
      };
    })
    .sort((left, right) => {
      if (left.leadershipScore === null)
        return right.leadershipScore === null ? 0 : 1;
      if (right.leadershipScore === null) return -1;
      return compare(
        decimal(right.leadershipScore),
        decimal(left.leadershipScore),
      );
    });

  const eligibleSnapshots = input.instruments
    .filter((instrument) => !excluded.has(instrument.instrumentId))
    .map((instrument) => ({
      instrument,
      snapshot: snapshotByInstrument.get(instrument.instrumentId),
    }))
    .filter(
      (
        value,
      ): value is {
        instrument: ThemeLeadershipInput["instruments"][number];
        snapshot: ThemeLeadershipInput["snapshots"][number];
      } => value.snapshot !== undefined,
    )
    .sort((left, right) =>
      compare(
        decimal(right.snapshot.cumulativeTurnoverKrw),
        decimal(left.snapshot.cumulativeTurnoverKrw),
      ),
    );

  const stockLeaders = eligibleSnapshots.map(
    ({ instrument, snapshot }, index) => {
      const stale = isSnapshotStale(snapshot);
      const turnover = decimal(snapshot.cumulativeTurnoverKrw);
      const baseline =
        snapshot.median20TurnoverKrwSameElapsed === null
          ? null
          : decimal(snapshot.median20TurnoverKrwSameElapsed);
      const acceleration =
        baseline !== null && isPositive(baseline)
          ? divide(turnover, baseline)
          : null;
      const marketShare = !marketUnavailable
        ? multiply(divide(turnover, marketTurnover), HUNDRED)
        : null;
      const available =
        !stale &&
        isPositive(turnover) &&
        acceleration !== null &&
        marketShare !== null;
      const score = available
        ? add(
            multiply(
              clamp(divide(marketShare ?? ZERO, decimal("3")), ZERO, ONE),
              decimal("60"),
            ),
            add(
              multiply(
                clamp(
                  divide(subtract(acceleration ?? ZERO, ONE), decimal("2")),
                  ZERO,
                  ONE,
                ),
                decimal("25"),
              ),
              compare(decimal(snapshot.changePct), ZERO) > 0
                ? decimal("15")
                : ZERO,
            ),
          )
        : null;
      return {
        rank: index + 1,
        instrumentId: instrument.instrumentId,
        nameKo: instrument.nameKo,
        venue: instrument.venue,
        availability: stale
          ? ("STALE" as const)
          : available
            ? input.marketDataQuality === "DELAYED"
              ? ("PARTIAL" as const)
              : ("AVAILABLE" as const)
            : ("N_A" as const),
        status: score === null ? null : scoreStatus(score),
        leadershipScore: score === null ? null : format(score),
        turnoverKrw: format(turnover),
        turnoverAcceleration:
          acceleration === null ? null : format(acceleration),
        marketTurnoverSharePct:
          marketShare === null ? null : format(marketShare),
        changePct: format(decimal(snapshot.changePct)),
        themeNodeIds: [
          ...new Set(
            (effectiveMappings.get(instrument.instrumentId) ?? []).flatMap(
              (mapping) => ancestry(mapping.nodeId),
            ),
          ),
        ],
      };
    },
  );

  return ThemeLeadershipReportSchema.parse({
    asOf: input.asOf,
    sessionDate: input.sessionDate,
    stockLeaders,
    themes,
    excludedInstrumentIds,
    warnings,
  });
}
