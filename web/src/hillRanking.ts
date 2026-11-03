/**
 * Proposed local ordering for a future King of the Hill slot.
 *
 * No historical Pump eligibility rule or threshold is verified in this
 * repository, so this module does not copy one and does not claim parity.
 * `liveLeader` stays null and `displayAuthorized` stays false. The website
 * preview must keep showing that there is no live leader. Sample market
 * cards are not ordered. Ranking is not investment advice, a safety audit,
 * or a return promise, and there is no paid-placement input.
 *
 * Proposed metric, for native SOL curves only: higher `realQuoteReserves`
 * in minor units. Different quote mints are withheld because those amounts
 * are not comparable. Ties resolve by the earliest `create` event slot, then
 * that event's index, then the mint's base58 text. `curve_complete` and
 * `migrated` tokens drop out immediately; nothing adds a migration delay.
 * Only a finalized page with a recent indexer timestamp is ordered. Processed
 * or confirmed pages are skipped because they can be reorged. Calling the
 * function again is the refresh: the proposed top changes when the ordered
 * inputs change, and there is no sticky champion.
 */
import {
  indexerTimestampAgeAt,
  type IndexedCurveAccount,
  type IndexedEvent,
  type IndexedToken,
  type ReadOnlyState,
} from "./indexerAdapter.ts";

export const HILL_METRIC = "real-quote-reserves-minor-units" as const;

export const HILL_RULE_SUMMARY =
  "Proposed order uses native-SOL real quote reserves only. It is not a historical Pump threshold, not a live leader, and not investment advice.";

export type HillWithholdReason =
  | "graduated"
  | "quote-mint-not-comparable"
  | "missing-create-event";

export type HillUnavailableReason =
  | "sample-not-ranked"
  | "chain-data-unavailable"
  | "awaiting-finality"
  | "stale-indexer-timestamp"
  | "freshness-clock-mismatch"
  | "no-eligible-token";

export type HillRanking = Readonly<{
  liveLeader: null;
  displayAuthorized: false;
  historicalParity: false;
  metric: typeof HILL_METRIC;
  ruleSummary: typeof HILL_RULE_SUMMARY;
  proposedOrder: readonly string[];
  withheld: readonly Readonly<{ mint: string; reason: HillWithholdReason }>[];
  unavailableReason: HillUnavailableReason | null;
}>;

export type HillTurnover = Readonly<{
  proposedTop: string | null;
  dethroned: boolean;
}>;

const CAPABILITY_FLAGS = [
  "canConnectWallet",
  "canSign",
  "canSubmit",
  "canTrade",
  "canDonate",
  "canStream",
] as const;

function assertFreshnessPolicy(nowMs: number, maxAgeMs: number): void {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0
  ) {
    throw new TypeError("Invalid freshness policy");
  }
}

function assertInert(state: ReadOnlyState<unknown>): void {
  const capabilities = state.capabilities;
  if (!capabilities) {
    throw new TypeError("Ranking input is missing capabilities");
  }
  for (const flag of CAPABILITY_FLAGS) {
    if (capabilities[flag] !== false) {
      throw new TypeError(
        "Ranking input must not grant transaction capabilities",
      );
    }
  }
}

function closed(reason: HillUnavailableReason): HillRanking {
  return Object.freeze({
    liveLeader: null,
    displayAuthorized: false as const,
    historicalParity: false as const,
    metric: HILL_METRIC,
    ruleSummary: HILL_RULE_SUMMARY,
    proposedOrder: Object.freeze([]),
    withheld: Object.freeze([]),
    unavailableReason: reason,
  });
}

function earliestCreates(
  events: readonly IndexedEvent[],
): Map<string, IndexedEvent> {
  const creates = new Map<string, IndexedEvent>();
  for (const event of events) {
    if (event.kind !== "create") continue;
    const current = creates.get(event.mint);
    if (
      !current ||
      BigInt(event.slot) < BigInt(current.slot) ||
      (event.slot === current.slot && event.eventIndex < current.eventIndex)
    ) {
      creates.set(event.mint, event);
    }
  }
  return creates;
}

function withholdReason(
  token: IndexedToken,
  account: IndexedCurveAccount,
  creates: ReadonlyMap<string, IndexedEvent>,
): HillWithholdReason | null {
  if (
    token.lifecycle !== "on_curve" ||
    account.complete ||
    account.migrated ||
    token.ammV4Pool !== null
  ) {
    return "graduated";
  }
  if (token.quoteMint !== null || account.quoteMint !== null) {
    return "quote-mint-not-comparable";
  }
  if (!creates.has(token.mint)) return "missing-create-event";
  return null;
}

/** Order one already-parsed read-only page. Performs no I/O and no display. */
export function rankHill(
  state: ReadOnlyState<unknown>,
  options: Readonly<{ nowMs: number; maxAgeMs: number }>,
): HillRanking {
  assertFreshnessPolicy(options.nowMs, options.maxAgeMs);
  assertInert(state);
  if (state.kind === "sample") return closed("sample-not-ranked");
  if (state.kind === "unavailable") return closed("chain-data-unavailable");
  if (state.checkedAtMs !== options.nowMs) {
    return closed("freshness-clock-mismatch");
  }
  if (state.page.source.finality !== "finalized") {
    return closed("awaiting-finality");
  }
  if (
    indexerTimestampAgeAt(
      state.page.source,
      options.nowMs,
      options.maxAgeMs,
    ) !== "recent"
  ) {
    return closed("stale-indexer-timestamp");
  }

  const accounts = new Map(
    state.page.accounts.map((account) => [account.address, account]),
  );
  const creates = earliestCreates(state.page.events);
  const withheld: { mint: string; reason: HillWithholdReason }[] = [];
  const eligible: {
    mint: string;
    reserves: bigint;
    slot: bigint;
    eventIndex: number;
  }[] = [];

  for (const token of state.page.tokens) {
    const account = accounts.get(token.curveAccount);
    if (!account) throw new TypeError("Token is missing its curve account");
    if (account.mint !== token.mint || account.quoteMint !== token.quoteMint) {
      throw new TypeError("Token and curve account disagree");
    }
    const reason = withholdReason(token, account, creates);
    if (reason) {
      withheld.push({ mint: token.mint, reason });
      continue;
    }
    const create = creates.get(token.mint);
    if (!create) throw new TypeError("Eligible token is missing its create");
    eligible.push({
      mint: token.mint,
      reserves: BigInt(account.realQuoteReserves),
      slot: BigInt(create.slot),
      eventIndex: create.eventIndex,
    });
  }

  eligible.sort((left, right) => {
    if (left.reserves !== right.reserves) {
      return left.reserves > right.reserves ? -1 : 1;
    }
    if (left.slot !== right.slot) return left.slot < right.slot ? -1 : 1;
    if (left.eventIndex !== right.eventIndex) {
      return left.eventIndex - right.eventIndex;
    }
    if (left.mint === right.mint) return 0;
    return left.mint < right.mint ? -1 : 1;
  });
  withheld.sort((left, right) =>
    left.mint < right.mint ? -1 : left.mint > right.mint ? 1 : 0,
  );

  if (eligible.length === 0) {
    return Object.freeze({
      ...closed("no-eligible-token"),
      withheld: Object.freeze(withheld.map((row) => Object.freeze(row))),
    });
  }

  return Object.freeze({
    liveLeader: null,
    displayAuthorized: false as const,
    historicalParity: false as const,
    metric: HILL_METRIC,
    ruleSummary: HILL_RULE_SUMMARY,
    proposedOrder: Object.freeze(eligible.map((row) => row.mint)),
    withheld: Object.freeze(withheld.map((row) => Object.freeze(row))),
    unavailableReason: null,
  });
}

/** Refresh result. A changed or cleared proposed top dethrones the previous one. */
export function hillTurnover(
  previousProposedTop: string | null,
  ranking: HillRanking,
): HillTurnover {
  if (previousProposedTop !== null && previousProposedTop.length === 0) {
    throw new TypeError("previousProposedTop must be a mint or null");
  }
  const proposedTop =
    ranking.unavailableReason === null
      ? (ranking.proposedOrder[0] ?? null)
      : null;
  return Object.freeze({
    proposedTop,
    dethroned:
      previousProposedTop !== null && previousProposedTop !== proposedTop,
  });
}
