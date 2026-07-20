import type {
  CatalystAssessment,
  CatalystEvent,
  Evidence,
  MoveEpisode,
} from "../contracts/catalyst.js";

export function assertPointInTimeCatalystAssessment(input: {
  assessment: CatalystAssessment;
  move: MoveEpisode;
  catalysts: CatalystEvent[];
  evidence: Evidence[];
}): void {
  const { assessment, move, catalysts, evidence } = input;
  if (assessment.moveEpisodeId !== move.id) {
    throw new Error("Assessment and move episode IDs do not match");
  }

  const eventsById = new Map(catalysts.map((event) => [event.id, event]));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const cutoffMs = Date.parse(assessment.cutoffAt);
  const moveStartMs = Date.parse(move.startedAt);
  if (cutoffMs < moveStartMs) {
    throw new Error("Assessment cutoff cannot precede the move episode");
  }

  for (const catalystId of assessment.catalystIds) {
    const event = eventsById.get(catalystId);
    if (!event) {
      throw new Error(
        `Assessment references an unknown catalyst: ${catalystId}`,
      );
    }
    const publishedMs = Date.parse(event.publishedAt);
    const detectedMs = Date.parse(event.detectedAt);
    if (event.instrumentId !== move.instrumentId) {
      throw new Error(
        `Catalyst instrument does not match the move: ${catalystId}`,
      );
    }
    if (publishedMs > cutoffMs) {
      throw new Error(
        `Catalyst was published after the assessment cutoff: ${catalystId}`,
      );
    }
    if (detectedMs > cutoffMs) {
      throw new Error(
        `Catalyst was detected after the assessment cutoff: ${catalystId}`,
      );
    }
    if (
      publishedMs > moveStartMs &&
      (assessment.verdict === "PRIMARY_EVENT_TIMING_MATCH" ||
        assessment.verdict === "ASSOCIATED_PRIMARY_EVENT")
    ) {
      throw new Error(
        `Post-move catalyst cannot be presented as a cause: ${catalystId}`,
      );
    }
  }

  const referencedEvidenceIds = new Set([
    ...assessment.claims.flatMap((claim) => claim.evidenceIds),
    ...assessment.catalystIds.flatMap(
      (catalystId) => eventsById.get(catalystId)?.evidenceIds ?? [],
    ),
  ]);
  for (const evidenceId of referencedEvidenceIds) {
    const item = evidenceById.get(evidenceId);
    if (!item) {
      throw new Error(`Assessment references unknown evidence: ${evidenceId}`);
    }
    if (!item.instrumentIds.includes(move.instrumentId)) {
      throw new Error(
        `Evidence instrument does not match the move: ${evidenceId}`,
      );
    }
    if (Date.parse(item.publishedAt) > cutoffMs) {
      throw new Error(`Evidence was published after the cutoff: ${evidenceId}`);
    }
    if (Date.parse(item.obtainedAt) > cutoffMs) {
      throw new Error(`Evidence was obtained after the cutoff: ${evidenceId}`);
    }
  }
}
