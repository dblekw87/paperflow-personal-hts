import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import {
  AdvancedQueueStateSchema,
  type AdvancedQueueState,
  type PaperOrderCommand,
} from "../contracts/paper-order.js";
import {
  bigIntToMinorUnits,
  type Currency,
  type PaperAccountSummary,
  type PaperCommitResult,
  type PaperFillMarker,
  PaperMarketEventClaimSchema,
  type PaperMarketEventClaim,
  type PaperMarketEventClaimResult,
  PaperPersistenceCommitInputSchema,
  type PaperPersistenceCommitInput,
  type PaperPosition,
  type StoredPaperOrder,
} from "./contracts.js";

type PaperPersistenceErrorCode =
  | "COMMIT_ID_REUSED_WITH_DIFFERENT_INPUT"
  | "CLIENT_ORDER_ID_REUSED_WITH_DIFFERENT_COMMAND"
  | "INVALID_ORDER_STATE_TRANSITION"
  | "INSUFFICIENT_AVAILABLE_CASH"
  | "INSUFFICIENT_AVAILABLE_POSITION"
  | "PERSISTED_STATE_INVARIANT_BROKEN";

export class PaperPersistenceError extends Error {
  public constructor(
    public readonly code: PaperPersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaperPersistenceError";
  }

  public readonly retryable = false;
}

interface OrderRow {
  readonly id: string;
  readonly account_id: string;
  readonly client_order_id: string;
  readonly command_fingerprint: string;
  readonly instrument_id: string;
  readonly venue: string;
  readonly currency: string;
  readonly side: "BUY" | "SELL";
  readonly order_type: "MARKET" | "LIMIT";
  readonly quantity: string;
  readonly limit_price: string | null;
  readonly time_in_force: "DAY";
  readonly session: "REGULAR";
  readonly submission_mode: "CONFIRM_TICKET" | "ONE_CLICK_ARMED";
  readonly status: StoredPaperOrder["status"];
  readonly filled_quantity: string;
  readonly remaining_quantity: string;
  readonly cancelled_quantity: string;
  readonly reserved_cash_minor: string;
  readonly submitted_at: string;
  readonly updated_at: string;
  readonly simulation_only: number;
}

interface PositionRow {
  readonly account_id: string;
  readonly instrument_id: string;
  readonly venue: string;
  readonly currency: string;
  readonly quantity: string;
  readonly reserved_sell_quantity: string;
  readonly updated_at: string;
}

interface AmountRow {
  readonly amount_minor: string;
}

interface QuantityRow {
  readonly quantity: string;
}

interface ExistingCommitRow {
  readonly order_id: string;
  readonly input_fingerprint: string;
}

interface AdvancedQueueRow {
  readonly account_id: string;
  readonly client_order_id: string;
  readonly instrument_id: string;
  readonly venue: string;
  readonly currency: string;
  readonly side: "BUY" | "SELL";
  readonly limit_price: string;
  readonly remaining_quantity: string;
  readonly ahead_quantity_estimate: string;
  readonly last_displayed_quantity_at_price: string;
  readonly safety_factor: string;
  readonly queue_position_quality: "QUEUE_ESTIMATED";
  readonly session_key: string;
  readonly last_order_book_sequence: string;
  readonly last_trade_sequence: string | null;
  readonly seen_market_event_ids_json: string;
  readonly vi_paused: number;
  readonly simulation_only: number;
}

const OPEN_STATUSES = new Set(["ACCEPTED", "RESTING", "PARTIALLY_FILLED"]);
const TERMINAL_STATUSES = new Set([
  "PARTIALLY_FILLED_CANCELLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
]);

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function paperOrderId(order: PaperOrderCommand): string {
  return `paper-order:${fingerprint([order.accountId, order.clientOrderId])}`;
}

function sumTextValues(values: readonly string[]): bigint {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

function mapOrder(row: OrderRow): StoredPaperOrder {
  if (row.simulation_only !== 1) {
    throw new PaperPersistenceError(
      "PERSISTED_STATE_INVARIANT_BROKEN",
      `paper order ${row.client_order_id} is missing simulation-only enforcement`,
    );
  }
  return {
    accountId: row.account_id,
    clientOrderId: row.client_order_id,
    instrumentId: row.instrument_id,
    venue: row.venue,
    currency: row.currency as Currency,
    side: row.side,
    orderType: row.order_type,
    quantity: row.quantity,
    limitPrice: row.limit_price,
    timeInForce: row.time_in_force,
    session: row.session,
    submissionMode: row.submission_mode,
    status: row.status,
    filledQuantity: row.filled_quantity,
    remainingQuantity: row.remaining_quantity,
    cancelledQuantity: row.cancelled_quantity,
    reservedCashMinor: bigIntToMinorUnits(BigInt(row.reserved_cash_minor)),
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    simulationOnly: true,
  };
}

function mapAdvancedQueue(row: AdvancedQueueRow): AdvancedQueueState {
  if (row.simulation_only !== 1) {
    throw new PaperPersistenceError(
      "PERSISTED_STATE_INVARIANT_BROKEN",
      `advanced queue ${row.client_order_id} is not simulation-only`,
    );
  }
  let seenMarketEventIds: unknown;
  try {
    seenMarketEventIds = JSON.parse(row.seen_market_event_ids_json);
  } catch {
    throw new PaperPersistenceError(
      "PERSISTED_STATE_INVARIANT_BROKEN",
      `advanced queue ${row.client_order_id} has invalid event history`,
    );
  }
  return AdvancedQueueStateSchema.parse({
    clientOrderId: row.client_order_id,
    instrumentId: row.instrument_id,
    venue: row.venue,
    currency: row.currency,
    side: row.side,
    limitPrice: row.limit_price,
    remainingQuantity: row.remaining_quantity,
    aheadQuantityEstimate: row.ahead_quantity_estimate,
    lastDisplayedQuantityAtPrice: row.last_displayed_quantity_at_price,
    safetyFactor: row.safety_factor,
    queuePositionQuality: row.queue_position_quality,
    sessionKey: row.session_key,
    lastOrderBookSequence: row.last_order_book_sequence,
    lastTradeSequence: row.last_trade_sequence,
    seenMarketEventIds,
    viPaused: row.vi_paused === 1,
  });
}

function mapPosition(row: PositionRow): PaperPosition {
  const quantity = BigInt(row.quantity);
  const reserved = BigInt(row.reserved_sell_quantity);
  if (reserved > quantity) {
    throw new PaperPersistenceError(
      "PERSISTED_STATE_INVARIANT_BROKEN",
      `reserved sell quantity exceeds position for ${row.instrument_id}`,
    );
  }
  return {
    accountId: row.account_id,
    instrumentId: row.instrument_id,
    venue: row.venue,
    currency: row.currency as Currency,
    quantity: quantity.toString(),
    reservedSellQuantity: reserved.toString(),
    availableQuantity: (quantity - reserved).toString(),
    updatedAt: row.updated_at,
  };
}

function assertTransition(
  previous: OrderRow | undefined,
  status: StoredPaperOrder["status"],
): void {
  if (status === "DRAFT") {
    throw new PaperPersistenceError(
      "INVALID_ORDER_STATE_TRANSITION",
      "DRAFT is a renderer-only state and cannot be persisted",
    );
  }
  if (previous === undefined) return;
  const allowed = new Map<string, ReadonlySet<string>>([
    [
      "ACCEPTED",
      new Set([
        "ACCEPTED",
        "RESTING",
        "PARTIALLY_FILLED",
        "PARTIALLY_FILLED_CANCELLED",
        "FILLED",
        "CANCELLED",
      ]),
    ],
    [
      "RESTING",
      new Set([
        "RESTING",
        "PARTIALLY_FILLED",
        "PARTIALLY_FILLED_CANCELLED",
        "FILLED",
        "CANCELLED",
      ]),
    ],
    [
      "PARTIALLY_FILLED",
      new Set(["PARTIALLY_FILLED", "PARTIALLY_FILLED_CANCELLED", "FILLED"]),
    ],
  ]);
  const nextStatuses = allowed.get(previous.status);
  const allowedTransition =
    nextStatuses?.has(status) ??
    (TERMINAL_STATUSES.has(previous.status) && previous.status === status);
  if (!allowedTransition) {
    throw new PaperPersistenceError(
      "INVALID_ORDER_STATE_TRANSITION",
      `order ${previous.client_order_id} cannot transition from ${previous.status} to ${status}`,
    );
  }
}

function assertExecutionShape(input: PaperPersistenceCommitInput): void {
  const quantity = BigInt(input.order.quantity);
  const filled = BigInt(input.execution.filledQuantity);
  const remaining = BigInt(input.execution.remainingQuantity);
  const cancelled = BigInt(input.execution.cancelledQuantity);
  const status = input.execution.status;
  const invalid =
    (status === "REJECTED" &&
      (filled !== 0n || remaining !== quantity || cancelled !== 0n)) ||
    (["ACCEPTED", "RESTING"].includes(status) &&
      (remaining === 0n || cancelled !== 0n)) ||
    (status === "PARTIALLY_FILLED" &&
      (filled === 0n || remaining === 0n || cancelled !== 0n)) ||
    (status === "FILLED" &&
      (filled !== quantity || remaining !== 0n || cancelled !== 0n)) ||
    (status === "CANCELLED" &&
      (filled !== 0n || remaining !== 0n || cancelled !== quantity)) ||
    (status === "PARTIALLY_FILLED_CANCELLED" &&
      (filled === 0n || remaining !== 0n || cancelled === 0n));
  if (invalid) {
    throw new PaperPersistenceError(
      "INVALID_ORDER_STATE_TRANSITION",
      `execution quantities do not match ${status}`,
    );
  }
}

/**
 * Main/utility-process repository for local simulation state.
 *
 * It intentionally accepts canonical paper-order contracts only and owns no
 * network client, broker account identifier, or live-order endpoint.
 */
export class LocalPaperTradingRepository {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public commitPaperExecution(
    rawInput: PaperPersistenceCommitInput,
  ): PaperCommitResult {
    const input = PaperPersistenceCommitInputSchema.parse(rawInput);
    assertExecutionShape(input);
    const inputFingerprint = fingerprint(input);
    const commandFingerprint = fingerprint(input.order);
    const orderId = paperOrderId(input.order);

    const commit = this.database.transaction((): PaperCommitResult => {
      const existingCommit = this.database
        .prepare(
          `SELECT order_id, input_fingerprint
             FROM paper_execution_commits
            WHERE id = ?`,
        )
        .get(input.commitId) as ExistingCommitRow | undefined;
      if (existingCommit !== undefined) {
        if (
          existingCommit.order_id !== orderId ||
          existingCommit.input_fingerprint !== inputFingerprint
        ) {
          throw new PaperPersistenceError(
            "COMMIT_ID_REUSED_WITH_DIFFERENT_INPUT",
            `paper commit id ${input.commitId} was already used`,
          );
        }
        const replayed = this.findOrderRowById(orderId);
        if (replayed === undefined) {
          throw new PaperPersistenceError(
            "PERSISTED_STATE_INVARIANT_BROKEN",
            `paper commit ${input.commitId} references a missing order`,
          );
        }
        return { idempotent: true, order: mapOrder(replayed) };
      }

      const account = this.database
        .prepare(
          `SELECT id, status
             FROM simulation_accounts
            WHERE id = ?`,
        )
        .get(input.order.accountId) as
        { readonly id: string; readonly status: string } | undefined;
      if (account === undefined || account.status !== "ACTIVE") {
        throw new PaperPersistenceError(
          "PERSISTED_STATE_INVARIANT_BROKEN",
          `active simulation account ${input.order.accountId} was not found`,
        );
      }

      const previous = this.findOrderRow(
        input.order.accountId,
        input.order.clientOrderId,
      );
      if (
        previous !== undefined &&
        previous.command_fingerprint !== commandFingerprint
      ) {
        throw new PaperPersistenceError(
          "CLIENT_ORDER_ID_REUSED_WITH_DIFFERENT_COMMAND",
          `client order id ${input.order.clientOrderId} already belongs to another command`,
        );
      }
      assertTransition(previous, input.execution.status);

      const previousFilled = BigInt(previous?.filled_quantity ?? "0");
      const previousCancelled = BigInt(previous?.cancelled_quantity ?? "0");
      const resultingFilled = BigInt(input.execution.filledQuantity);
      const resultingCancelled = BigInt(input.execution.cancelledQuantity);
      const newFilled = BigInt(input.execution.newlyFilledQuantity);
      if (
        resultingFilled - previousFilled !== newFilled ||
        resultingCancelled < previousCancelled
      ) {
        throw new PaperPersistenceError(
          "INVALID_ORDER_STATE_TRANSITION",
          "cumulative filled/cancelled quantities cannot regress or skip executions",
        );
      }

      const newFillQuantity = sumTextValues(
        input.execution.fills.map((fill) => fill.quantity),
      );
      if (newFillQuantity !== newFilled) {
        throw new PaperPersistenceError(
          "PERSISTED_STATE_INVARIANT_BROKEN",
          "new fill quantities do not match the execution plan",
        );
      }

      const open = OPEN_STATUSES.has(input.execution.status);
      const resultingRemaining = BigInt(input.execution.remainingQuantity);
      const requestedSellReservation =
        input.order.side === "SELL" && open ? resultingRemaining : 0n;

      const otherCashReservations = this.sumOtherCashReservations(
        input.order.accountId,
        input.order.currency,
        orderId,
      );
      const currentCash = this.sumCash(
        input.order.accountId,
        input.order.currency,
      );
      const cashDelta = sumTextValues(
        input.cashLedgerEntries.map((entry) => entry.amountMinor),
      );
      const finalCash = currentCash + cashDelta;
      const requiredCash =
        otherCashReservations + BigInt(input.reservedCashMinor);
      if (finalCash < 0n || finalCash < requiredCash) {
        throw new PaperPersistenceError(
          "INSUFFICIENT_AVAILABLE_CASH",
          `paper execution would leave ${finalCash} minor units against ${requiredCash} reserved`,
        );
      }

      const previousPosition = this.findPositionRow(
        input.order.accountId,
        input.order.instrumentId,
      );
      const currentPosition = BigInt(previousPosition?.quantity ?? "0");
      const otherSellReservations = this.sumOtherSellReservations(
        input.order.accountId,
        input.order.instrumentId,
        orderId,
      );
      if (
        input.order.side === "SELL" &&
        currentPosition <
          newFillQuantity + otherSellReservations + requestedSellReservation
      ) {
        throw new PaperPersistenceError(
          "INSUFFICIENT_AVAILABLE_POSITION",
          `paper sell requires fills/reservations beyond the available position`,
        );
      }

      const positionDelta =
        input.order.side === "BUY" ? newFillQuantity : -newFillQuantity;
      const resultingPosition = currentPosition + positionDelta;
      if (resultingPosition < 0n) {
        throw new PaperPersistenceError(
          "INSUFFICIENT_AVAILABLE_POSITION",
          "short selling is disabled for local paper trading",
        );
      }

      const timestamp = this.now();
      if (previous === undefined) {
        this.database
          .prepare(
            `INSERT INTO paper_orders(
               id, account_id, client_order_id, command_fingerprint,
               instrument_id, venue, currency, side, order_type, quantity,
               limit_price, time_in_force, session, submission_mode, status,
               filled_quantity, remaining_quantity, cancelled_quantity,
               reserved_cash_minor, submitted_at, created_at, updated_at,
               simulation_only
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DAY', 'REGULAR', ?, ?,
               ?, ?, ?, ?, ?, ?, ?, 1
             )`,
          )
          .run(
            orderId,
            input.order.accountId,
            input.order.clientOrderId,
            commandFingerprint,
            input.order.instrumentId,
            input.order.venue,
            input.order.currency,
            input.order.side,
            input.order.orderType,
            input.order.quantity,
            input.order.limitPrice,
            input.order.submissionMode,
            input.execution.status,
            input.execution.filledQuantity,
            input.execution.remainingQuantity,
            input.execution.cancelledQuantity,
            input.reservedCashMinor,
            input.order.submittedAt,
            timestamp,
            timestamp,
          );
      } else {
        this.database
          .prepare(
            `UPDATE paper_orders
                SET status = ?,
                    filled_quantity = ?,
                    remaining_quantity = ?,
                    cancelled_quantity = ?,
                    reserved_cash_minor = ?,
                    updated_at = ?
              WHERE id = ?`,
          )
          .run(
            input.execution.status,
            input.execution.filledQuantity,
            input.execution.remainingQuantity,
            input.execution.cancelledQuantity,
            input.reservedCashMinor,
            timestamp,
            orderId,
          );
      }

      const insertFill = this.database.prepare(
        `INSERT INTO paper_fills(
           id, order_id, market_event_id, price_decimal, quantity,
           gross_notional_decimal, liquidity, fill_model_version,
           occurred_at, created_at, simulation_only
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      );
      for (const fill of input.execution.fills) {
        insertFill.run(
          fill.fillId,
          orderId,
          fill.marketEventId,
          fill.price,
          fill.quantity,
          fill.grossNotional,
          fill.liquidity,
          fill.fillModelVersion,
          input.occurredAt,
          timestamp,
        );
      }

      const insertLedger = this.database.prepare(
        `INSERT INTO cash_ledger(
           id, account_id, currency, amount_minor, entry_type,
           idempotency_key, reference_id, occurred_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const entry of input.cashLedgerEntries) {
        insertLedger.run(
          entry.id,
          entry.accountId,
          entry.currency,
          entry.amountMinor,
          entry.entryType,
          entry.idempotencyKey,
          entry.referenceId ?? input.order.clientOrderId,
          entry.occurredAt,
          timestamp,
        );
      }

      const totalSellReservation =
        input.order.side === "SELL"
          ? otherSellReservations + requestedSellReservation
          : BigInt(previousPosition?.reserved_sell_quantity ?? "0");
      if (resultingPosition > 0n || totalSellReservation > 0n) {
        this.database
          .prepare(
            `INSERT INTO paper_positions(
               account_id, instrument_id, venue, currency, quantity,
               reserved_sell_quantity, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, instrument_id) DO UPDATE SET
               venue = excluded.venue,
               currency = excluded.currency,
               quantity = excluded.quantity,
               reserved_sell_quantity = excluded.reserved_sell_quantity,
               updated_at = excluded.updated_at`,
          )
          .run(
            input.order.accountId,
            input.order.instrumentId,
            input.order.venue,
            input.order.currency,
            resultingPosition.toString(),
            totalSellReservation.toString(),
            timestamp,
          );
      } else if (previousPosition !== undefined) {
        this.database
          .prepare(
            `DELETE FROM paper_positions
              WHERE account_id = ? AND instrument_id = ?`,
          )
          .run(input.order.accountId, input.order.instrumentId);
      }

      this.database
        .prepare(
          `INSERT INTO paper_execution_commits(
             id, order_id, input_fingerprint, occurred_at, created_at,
             simulation_only
           ) VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .run(
          input.commitId,
          orderId,
          inputFingerprint,
          input.occurredAt,
          timestamp,
        );

      const stored = this.findOrderRowById(orderId);
      if (stored === undefined) {
        throw new PaperPersistenceError(
          "PERSISTED_STATE_INVARIANT_BROKEN",
          "paper order disappeared during its transaction",
        );
      }
      return { idempotent: false, order: mapOrder(stored) };
    });

    return commit.immediate();
  }

  public getPaperOrder(
    accountId: string,
    clientOrderId: string,
  ): StoredPaperOrder | null {
    const row = this.findOrderRow(accountId, clientOrderId);
    return row === undefined ? null : mapOrder(row);
  }

  public listPaperOrders(accountId: string): StoredPaperOrder[] {
    const rows = this.database
      .prepare(
        `SELECT *
           FROM paper_orders
          WHERE account_id = ?
          ORDER BY submitted_at, id`,
      )
      .all(accountId) as OrderRow[];
    return rows.map(mapOrder);
  }

  public getAdvancedQueueState(
    accountId: string,
    clientOrderId: string,
  ): AdvancedQueueState | null {
    const row = this.database
      .prepare(
        `SELECT *
           FROM paper_advanced_queue_states
          WHERE account_id = ? AND client_order_id = ?`,
      )
      .get(accountId, clientOrderId) as AdvancedQueueRow | undefined;
    return row === undefined ? null : mapAdvancedQueue(row);
  }

  public saveAdvancedQueueState(
    accountId: string,
    rawState: AdvancedQueueState,
  ): AdvancedQueueState {
    const state = AdvancedQueueStateSchema.parse(rawState);
    const order = this.findOrderRow(accountId, state.clientOrderId);
    if (
      order === undefined ||
      order.instrument_id !== state.instrumentId ||
      order.venue !== state.venue ||
      order.currency !== state.currency ||
      order.side !== state.side ||
      order.limit_price !== state.limitPrice ||
      !OPEN_STATUSES.has(order.status)
    ) {
      throw new PaperPersistenceError(
        "PERSISTED_STATE_INVARIANT_BROKEN",
        "advanced queue state does not match an open local paper order",
      );
    }
    this.database
      .prepare(
        `INSERT INTO paper_advanced_queue_states(
           account_id, client_order_id, instrument_id, venue, currency,
           side, limit_price, remaining_quantity, ahead_quantity_estimate,
           last_displayed_quantity_at_price, safety_factor,
           queue_position_quality, session_key, last_order_book_sequence,
           last_trade_sequence, seen_market_event_ids_json, vi_paused,
           updated_at, simulation_only
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(account_id, client_order_id) DO UPDATE SET
           remaining_quantity = excluded.remaining_quantity,
           ahead_quantity_estimate = excluded.ahead_quantity_estimate,
           last_displayed_quantity_at_price =
             excluded.last_displayed_quantity_at_price,
           safety_factor = excluded.safety_factor,
           queue_position_quality = excluded.queue_position_quality,
           session_key = excluded.session_key,
           last_order_book_sequence = excluded.last_order_book_sequence,
           last_trade_sequence = excluded.last_trade_sequence,
           seen_market_event_ids_json = excluded.seen_market_event_ids_json,
           vi_paused = excluded.vi_paused,
           updated_at = excluded.updated_at`,
      )
      .run(
        accountId,
        state.clientOrderId,
        state.instrumentId,
        state.venue,
        state.currency,
        state.side,
        state.limitPrice,
        state.remainingQuantity,
        state.aheadQuantityEstimate,
        state.lastDisplayedQuantityAtPrice,
        state.safetyFactor,
        state.queuePositionQuality,
        state.sessionKey,
        state.lastOrderBookSequence,
        state.lastTradeSequence,
        JSON.stringify(state.seenMarketEventIds),
        state.viPaused ? 1 : 0,
        this.now(),
      );
    return state;
  }

  public deleteAdvancedQueueState(
    accountId: string,
    clientOrderId: string,
  ): boolean {
    const result = this.database
      .prepare(
        `DELETE FROM paper_advanced_queue_states
          WHERE account_id = ? AND client_order_id = ?`,
      )
      .run(accountId, clientOrderId);
    return result.changes > 0;
  }

  public listPaperFillMarkers(
    accountId: string,
    instrumentId: string,
  ): PaperFillMarker[] {
    const rows = this.database
      .prepare(
        `SELECT f.id, o.client_order_id, o.instrument_id, o.side,
                f.price_decimal, f.quantity, f.market_event_id,
                f.occurred_at, o.quantity AS order_quantity
           FROM paper_fills f
           JOIN paper_orders o ON o.id = f.order_id
          WHERE o.account_id = ? AND o.instrument_id = ?
          ORDER BY f.occurred_at, f.id`,
      )
      .all(accountId, instrumentId) as Array<{
      id: string;
      client_order_id: string;
      instrument_id: string;
      side: "BUY" | "SELL";
      price_decimal: string;
      quantity: string;
      market_event_id: string;
      occurred_at: string;
      order_quantity: string;
    }>;
    return rows.map((row) => ({
      fillId: row.id,
      clientOrderId: row.client_order_id,
      instrumentId: row.instrument_id,
      side: row.side,
      price: row.price_decimal,
      quantity: row.quantity,
      marketEventId: row.market_event_id,
      occurredAt: row.occurred_at,
      partial: BigInt(row.quantity) < BigInt(row.order_quantity),
      simulationOnly: true,
    }));
  }

  public hasPaperFillForMarketEvent(
    accountId: string,
    clientOrderId: string,
    marketEventId: string,
  ): boolean {
    const row = this.database
      .prepare(
        `SELECT 1
           FROM paper_fills f
           JOIN paper_orders o ON o.id = f.order_id
          WHERE o.account_id = ?
            AND o.client_order_id = ?
            AND f.market_event_id = ?
          LIMIT 1`,
      )
      .get(accountId, clientOrderId, marketEventId);
    return row !== undefined;
  }

  public sumPaperFillQuantityForMarketEvent(
    accountId: string,
    marketEventId: string,
  ): string {
    const rows = this.database
      .prepare(
        `SELECT f.quantity
           FROM paper_fills f
           JOIN paper_orders o ON o.id = f.order_id
          WHERE o.account_id = ?
            AND f.market_event_id = ?`,
      )
      .all(accountId, marketEventId) as QuantityRow[];
    return sumTextValues(rows.map((row) => row.quantity)).toString();
  }

  public claimPaperMarketEvent(
    rawClaim: PaperMarketEventClaim,
  ): PaperMarketEventClaimResult {
    const claim = PaperMarketEventClaimSchema.parse(rawClaim);
    const transaction = this.database.transaction(
      (): PaperMarketEventClaimResult => {
        const duplicate = this.database
          .prepare(
            `SELECT 1
               FROM paper_market_event_receipts
              WHERE account_id = ? AND market_event_id = ?`,
          )
          .get(claim.accountId, claim.marketEventId);
        if (duplicate !== undefined) return "DUPLICATE";

        const cursor = this.database
          .prepare(
            `SELECT last_sequence
               FROM paper_market_cursors
              WHERE account_id = ?
                AND instrument_id = ?
                AND session_key = ?`,
          )
          .get(
            claim.accountId,
            claim.instrumentId,
            claim.sessionKey,
          ) as { readonly last_sequence: string } | undefined;
        if (
          cursor !== undefined &&
          BigInt(claim.sequence) <= BigInt(cursor.last_sequence)
        ) {
          return "OUT_OF_ORDER";
        }

        const timestamp = this.now();
        this.database
          .prepare(
            `INSERT INTO paper_market_event_receipts(
               account_id, market_event_id, instrument_id, session_key,
               sequence, observed_at, created_at, simulation_only
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .run(
            claim.accountId,
            claim.marketEventId,
            claim.instrumentId,
            claim.sessionKey,
            claim.sequence,
            claim.observedAt,
            timestamp,
          );
        this.database
          .prepare(
            `INSERT INTO paper_market_cursors(
               account_id, instrument_id, session_key, last_sequence,
               last_market_event_id, observed_at, updated_at, simulation_only
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
             ON CONFLICT(account_id, instrument_id, session_key) DO UPDATE SET
               last_sequence = excluded.last_sequence,
               last_market_event_id = excluded.last_market_event_id,
               observed_at = excluded.observed_at,
               updated_at = excluded.updated_at`,
          )
          .run(
            claim.accountId,
            claim.instrumentId,
            claim.sessionKey,
            claim.sequence,
            claim.marketEventId,
            claim.observedAt,
            timestamp,
          );
        return "ACCEPTED";
      },
    );
    return transaction.immediate();
  }

  public listPositions(accountId: string): PaperPosition[] {
    const rows = this.database
      .prepare(
        `SELECT *
           FROM paper_positions
          WHERE account_id = ?
          ORDER BY instrument_id`,
      )
      .all(accountId) as PositionRow[];
    return rows.map(mapPosition);
  }

  public getAccountSummary(accountId: string): PaperAccountSummary {
    const account = this.database
      .prepare(
        `SELECT id, display_name, base_currency
           FROM simulation_accounts
          WHERE id = ?`,
      )
      .get(accountId) as
      | {
          id: string;
          display_name: string;
          base_currency: string;
        }
      | undefined;
    if (account === undefined) {
      throw new PaperPersistenceError(
        "PERSISTED_STATE_INVARIANT_BROKEN",
        `simulation account ${accountId} was not found`,
      );
    }

    const currencies = this.database
      .prepare(
        `SELECT currency FROM cash_ledger WHERE account_id = ?
         UNION
         SELECT currency FROM paper_orders
          WHERE account_id = ? AND reserved_cash_minor <> '0'
         ORDER BY currency`,
      )
      .all(accountId, accountId) as Array<{ currency: string }>;
    const cashBalances = currencies.map(({ currency }) => {
      const balance = this.sumCash(accountId, currency);
      const reserved = this.sumOtherCashReservations(accountId, currency, "");
      return {
        currency: currency as Currency,
        balanceMinor: bigIntToMinorUnits(balance),
        reservedMinor: bigIntToMinorUnits(reserved),
        availableMinor: bigIntToMinorUnits(balance - reserved),
      };
    });
    const counts = this.database
      .prepare(
        `SELECT
           SUM(CASE WHEN status IN (
             'ACCEPTED', 'RESTING', 'PARTIALLY_FILLED'
           ) THEN 1 ELSE 0 END) AS open_count,
           (SELECT COUNT(*)
              FROM paper_fills f
              JOIN paper_orders fo ON fo.id = f.order_id
             WHERE fo.account_id = ?) AS fill_count
         FROM paper_orders
        WHERE account_id = ?`,
      )
      .get(accountId, accountId) as {
      open_count: number | null;
      fill_count: number;
    };

    return {
      accountId: account.id,
      displayName: account.display_name,
      baseCurrency: account.base_currency as Currency,
      cashBalances,
      positions: this.listPositions(accountId),
      openOrderCount: Number(counts.open_count ?? 0),
      fillCount: Number(counts.fill_count),
    };
  }

  public rebuildPositions(accountId: string): PaperPosition[] {
    const rebuild = this.database.transaction(() => {
      const fillRows = this.database
        .prepare(
          `SELECT o.instrument_id, o.venue, o.currency, o.side,
                  f.quantity, f.occurred_at, f.id
             FROM paper_fills f
             JOIN paper_orders o ON o.id = f.order_id
            WHERE o.account_id = ?
            ORDER BY f.occurred_at, f.id`,
        )
        .all(accountId) as Array<{
        instrument_id: string;
        venue: string;
        currency: string;
        side: "BUY" | "SELL";
        quantity: string;
      }>;
      const positions = new Map<
        string,
        { venue: string; currency: string; quantity: bigint }
      >();
      for (const fill of fillRows) {
        const current = positions.get(fill.instrument_id) ?? {
          venue: fill.venue,
          currency: fill.currency,
          quantity: 0n,
        };
        current.quantity +=
          fill.side === "BUY" ? BigInt(fill.quantity) : -BigInt(fill.quantity);
        if (current.quantity < 0n) {
          throw new PaperPersistenceError(
            "PERSISTED_STATE_INVARIANT_BROKEN",
            `fills rebuild a negative position for ${fill.instrument_id}`,
          );
        }
        positions.set(fill.instrument_id, current);
      }

      const reservationRows = this.database
        .prepare(
          `SELECT instrument_id, venue, currency, remaining_quantity
             FROM paper_orders
            WHERE account_id = ?
              AND side = 'SELL'
              AND status IN ('ACCEPTED', 'RESTING', 'PARTIALLY_FILLED')`,
        )
        .all(accountId) as Array<{
        instrument_id: string;
        venue: string;
        currency: string;
        remaining_quantity: string;
      }>;
      const reservations = new Map<string, bigint>();
      for (const row of reservationRows) {
        reservations.set(
          row.instrument_id,
          (reservations.get(row.instrument_id) ?? 0n) +
            BigInt(row.remaining_quantity),
        );
        if (!positions.has(row.instrument_id)) {
          positions.set(row.instrument_id, {
            venue: row.venue,
            currency: row.currency,
            quantity: 0n,
          });
        }
      }

      this.database
        .prepare("DELETE FROM paper_positions WHERE account_id = ?")
        .run(accountId);
      const insert = this.database.prepare(
        `INSERT INTO paper_positions(
           account_id, instrument_id, venue, currency, quantity,
           reserved_sell_quantity, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const timestamp = this.now();
      for (const [instrumentId, position] of positions) {
        const reserved = reservations.get(instrumentId) ?? 0n;
        if (reserved > position.quantity) {
          throw new PaperPersistenceError(
            "PERSISTED_STATE_INVARIANT_BROKEN",
            `open sells over-reserve ${instrumentId}`,
          );
        }
        if (position.quantity > 0n || reserved > 0n) {
          insert.run(
            accountId,
            instrumentId,
            position.venue,
            position.currency,
            position.quantity.toString(),
            reserved.toString(),
            timestamp,
          );
        }
      }
      return this.listPositions(accountId);
    });
    return rebuild.immediate();
  }

  private findOrderRow(
    accountId: string,
    clientOrderId: string,
  ): OrderRow | undefined {
    return this.database
      .prepare(
        `SELECT *
           FROM paper_orders
          WHERE account_id = ? AND client_order_id = ?`,
      )
      .get(accountId, clientOrderId) as OrderRow | undefined;
  }

  private findOrderRowById(orderId: string): OrderRow | undefined {
    return this.database
      .prepare("SELECT * FROM paper_orders WHERE id = ?")
      .get(orderId) as OrderRow | undefined;
  }

  private findPositionRow(
    accountId: string,
    instrumentId: string,
  ): PositionRow | undefined {
    return this.database
      .prepare(
        `SELECT *
           FROM paper_positions
          WHERE account_id = ? AND instrument_id = ?`,
      )
      .get(accountId, instrumentId) as PositionRow | undefined;
  }

  private sumCash(accountId: string, currency: string): bigint {
    const rows = this.database
      .prepare(
        `SELECT amount_minor
           FROM cash_ledger
          WHERE account_id = ? AND currency = ?`,
      )
      .all(accountId, currency) as AmountRow[];
    return sumTextValues(rows.map((row) => row.amount_minor));
  }

  private sumOtherCashReservations(
    accountId: string,
    currency: string,
    excludedOrderId: string,
  ): bigint {
    const rows = this.database
      .prepare(
        `SELECT reserved_cash_minor AS amount_minor
           FROM paper_orders
          WHERE account_id = ?
            AND currency = ?
            AND id <> ?
            AND status IN ('ACCEPTED', 'RESTING', 'PARTIALLY_FILLED')`,
      )
      .all(accountId, currency, excludedOrderId) as AmountRow[];
    return sumTextValues(rows.map((row) => row.amount_minor));
  }

  private sumOtherSellReservations(
    accountId: string,
    instrumentId: string,
    excludedOrderId: string,
  ): bigint {
    const rows = this.database
      .prepare(
        `SELECT remaining_quantity AS quantity
           FROM paper_orders
          WHERE account_id = ?
            AND instrument_id = ?
            AND side = 'SELL'
            AND id <> ?
            AND status IN ('ACCEPTED', 'RESTING', 'PARTIALLY_FILLED')`,
      )
      .all(accountId, instrumentId, excludedOrderId) as QuantityRow[];
    return sumTextValues(rows.map((row) => row.quantity));
  }
}
