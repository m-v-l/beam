import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_TRANSACTION_CAPABILITIES,
  parseIndexerPage,
  sampleState,
  type CandidateState,
} from "../src/indexerAdapter.ts";
import {
  HILL_METRIC,
  HILL_RULE_SUMMARY,
  hillTurnover,
  rankHill,
  type HillRanking,
} from "../src/hillRanking.ts";

const programId = "GdaQ7RHbGKGEL5Px66tQP78S67XcgxYAzFUwja71qSJP";
const creator = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
const mintA = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const curveA = "CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8";
const mintB = "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR";
const curveB = "GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq";
const mintC = "LbUiWL3xVV8hTFYBVdbTNrpDo41NKS6o3LHHuDzjfcY";
const curveC = "QWmroo4YnnMqYW3cnxWkFdaTxGD3P7vMSzwMHGbUzwF";
const quoteMint = "YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf";
const pool = "cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN";
const nowMs = 1_800_000_000_000;
const maxAgeMs = 30_000;
const parseOptions = { expectedProgramId: programId, nowMs, maxAgeMs };
const rankOptions = { nowMs, maxAgeMs };

type Lifecycle = "on_curve" | "curve_complete" | "migrated";

type TokenSpec = {
  mint: string;
  curve: string;
  reserves: string;
  tokenReserves?: string;
  lifecycle?: Lifecycle;
  quoteMint?: string | null;
  tokenProgram?: "spl_token" | "token_2022";
  creates?: { slot: string; eventIndex: number; mark: string }[];
  extra?: {
    kind: "buy" | "sell" | "migrate" | "curve_complete";
    slot: string;
    eventIndex: number;
    mark: string;
  }[];
};

function signature(mark: string): string {
  return `${"1".repeat(63)}${mark}`;
}

function candidate(
  specs: readonly TokenSpec[],
  overrides?: { finality?: string; indexedAtMs?: number; slot?: string },
): CandidateState {
  const sourceSlot = overrides?.slot ?? "1000";
  const input = {
    schemaVersion: 1,
    source: {
      chain: "solana",
      indexerId: "hill-fixture",
      programId,
      slot: sourceSlot,
      finality: overrides?.finality ?? "finalized",
      indexedAtMs: overrides?.indexedAtMs ?? nowMs - 1_000,
      cursor: null,
    },
    tokens: specs.map((spec, index) => {
      const lifecycle = spec.lifecycle ?? "on_curve";
      return {
        mint: spec.mint,
        tokenProgram: spec.tokenProgram ?? "spl_token",
        creator,
        curveAccount: spec.curve,
        quoteMint: spec.quoteMint === undefined ? null : spec.quoteMint,
        name: `Fixture ${index}`,
        symbol: `F${index}`,
        metadataUri: "https://example.invalid/hill.json",
        lifecycle,
        ammV4Pool: lifecycle === "migrated" ? pool : null,
      };
    }),
    accounts: specs.map((spec) => {
      const lifecycle = spec.lifecycle ?? "on_curve";
      return {
        address: spec.curve,
        ownerProgram: programId,
        mint: spec.mint,
        quoteMint: spec.quoteMint === undefined ? null : spec.quoteMint,
        realTokenReserves: spec.tokenReserves ?? "1",
        realQuoteReserves: spec.reserves,
        complete: lifecycle !== "on_curve",
        migrated: lifecycle === "migrated",
      };
    }),
    events: specs.flatMap((spec, index) => {
      const creates = spec.creates ?? [
        { slot: "10", eventIndex: 0, mark: String(index + 2) },
      ];
      return [
        ...creates.map((create) => ({
          signature: signature(create.mark),
          eventIndex: create.eventIndex,
          slot: create.slot,
          mint: spec.mint,
          kind: "create" as const,
        })),
        ...(spec.extra ?? []).map((event) => ({
          signature: signature(event.mark),
          eventIndex: event.eventIndex,
          slot: event.slot,
          mint: spec.mint,
          kind: event.kind,
        })),
      ];
    }),
  };
  return parseIndexerPage(input, parseOptions);
}

function assertWithheldDisplay(ranking: HillRanking): void {
  assert.equal(ranking.liveLeader, null);
  assert.equal(ranking.displayAuthorized, false);
  assert.equal(ranking.historicalParity, false);
  assert.equal(ranking.metric, HILL_METRIC);
  assert.equal(ranking.ruleSummary, HILL_RULE_SUMMARY);
}

test("sample and unavailable pages are not ordered and have no live leader", () => {
  const sample = rankHill(
    sampleState([{ id: "nova", progress: 87, marketCap: "$84.2K" }]),
    rankOptions,
  );
  assert.equal(sample.unavailableReason, "sample-not-ranked");
  assert.deepEqual(sample.proposedOrder, []);
  assertWithheldDisplay(sample);

  const unavailable = rankHill(
    {
      kind: "unavailable",
      reason: "indexer down",
      capabilities: NO_TRANSACTION_CAPABILITIES,
    },
    rankOptions,
  );
  assert.equal(unavailable.unavailableReason, "chain-data-unavailable");
  assert.deepEqual(unavailable.proposedOrder, []);
  assertWithheldDisplay(unavailable);
  assert.equal(hillTurnover(mintA, unavailable).dethroned, true);
  assert.equal(hillTurnover(mintA, unavailable).proposedTop, null);
});

test("processed, confirmed, stale, and mismatched pages are not ordered", () => {
  const specs: TokenSpec[] = [{ mint: mintA, curve: curveA, reserves: "500" }];
  for (const finality of ["processed", "confirmed"]) {
    const ranking = rankHill(candidate(specs, { finality }), rankOptions);
    assert.equal(ranking.unavailableReason, "awaiting-finality");
    assert.deepEqual(ranking.proposedOrder, []);
    assertWithheldDisplay(ranking);
  }

  const stale = rankHill(
    candidate(specs, { indexedAtMs: nowMs - maxAgeMs - 1 }),
    rankOptions,
  );
  assert.equal(stale.unavailableReason, "stale-indexer-timestamp");
  assert.deepEqual(stale.proposedOrder, []);

  const parsed = candidate(specs);
  const mismatch = rankHill(parsed, { nowMs: nowMs + 1, maxAgeMs });
  assert.equal(mismatch.unavailableReason, "freshness-clock-mismatch");
  assert.throws(
    () => rankHill(parsed, { nowMs, maxAgeMs: 0 }),
    /Invalid freshness policy/,
  );
});

test("orders native-SOL curves by quote reserves, not token reserves or input order", () => {
  const higherQuoteLast: TokenSpec[] = [
    {
      mint: mintA,
      curve: curveA,
      reserves: "99",
      tokenReserves: "999999",
    },
    {
      mint: mintB,
      curve: curveB,
      reserves: "100",
      tokenReserves: "1",
      tokenProgram: "token_2022",
    },
  ];
  const forward = rankHill(candidate(higherQuoteLast), rankOptions);
  const reverse = rankHill(
    candidate([...higherQuoteLast].reverse()),
    rankOptions,
  );
  assert.deepEqual(forward.proposedOrder, [mintB, mintA]);
  assert.deepEqual(reverse.proposedOrder, [mintB, mintA]);
  assert.equal(forward.unavailableReason, null);
  assertWithheldDisplay(forward);

  const wide = rankHill(
    candidate([
      { mint: mintA, curve: curveA, reserves: "999" },
      {
        mint: mintB,
        curve: curveB,
        reserves: "1000",
      },
      {
        mint: mintC,
        curve: curveC,
        reserves: "18446744073709551615",
      },
    ]),
    rankOptions,
  );
  assert.deepEqual(wide.proposedOrder, [mintC, mintB, mintA]);
});

test("tie-breaks by earliest create slot, then event index, then mint text", () => {
  const bySlot = rankHill(
    candidate([
      {
        mint: mintA,
        curve: curveA,
        reserves: "40",
        creates: [
          { slot: "100", eventIndex: 0, mark: "2" },
          { slot: "20", eventIndex: 1, mark: "3" },
        ],
      },
      {
        mint: mintB,
        curve: curveB,
        reserves: "40",
        creates: [{ slot: "30", eventIndex: 0, mark: "4" }],
      },
    ]),
    rankOptions,
  );
  assert.deepEqual(bySlot.proposedOrder, [mintA, mintB]);

  const byIndex = rankHill(
    candidate([
      {
        mint: mintB,
        curve: curveB,
        reserves: "40",
        creates: [{ slot: "15", eventIndex: 4, mark: "5" }],
      },
      {
        mint: mintA,
        curve: curveA,
        reserves: "40",
        creates: [{ slot: "15", eventIndex: 2, mark: "6" }],
      },
    ]),
    rankOptions,
  );
  assert.deepEqual(byIndex.proposedOrder, [mintA, mintB]);

  const byMint = rankHill(
    candidate([
      {
        mint: mintB,
        curve: curveB,
        reserves: "40",
        creates: [{ slot: "15", eventIndex: 1, mark: "7" }],
      },
      {
        mint: mintA,
        curve: curveA,
        reserves: "40",
        creates: [{ slot: "15", eventIndex: 1, mark: "8" }],
      },
    ]),
    rankOptions,
  );
  assert.deepEqual(byMint.proposedOrder, [mintA, mintB]);
  assert.ok(mintA < mintB);
});

test("withholds graduated, non-SOL, and create-less tokens without a migration delay", () => {
  const ranking = rankHill(
    candidate([
      { mint: mintA, curve: curveA, reserves: "5" },
      {
        mint: mintB,
        curve: curveB,
        reserves: "999999",
        lifecycle: "curve_complete",
      },
      {
        mint: mintC,
        curve: curveC,
        reserves: "888888",
        lifecycle: "migrated",
        extra: [{ kind: "migrate", slot: "40", eventIndex: 1, mark: "9" }],
      },
    ]),
    rankOptions,
  );
  assert.deepEqual(ranking.proposedOrder, [mintA]);
  assert.deepEqual(ranking.withheld, [
    { mint: mintB, reason: "graduated" },
    { mint: mintC, reason: "graduated" },
  ]);

  const otherQuote = rankHill(
    candidate([
      {
        mint: mintA,
        curve: curveA,
        reserves: "70",
        quoteMint,
      },
    ]),
    rankOptions,
  );
  assert.equal(otherQuote.unavailableReason, "no-eligible-token");
  assert.deepEqual(otherQuote.proposedOrder, []);
  assert.deepEqual(otherQuote.withheld, [
    { mint: mintA, reason: "quote-mint-not-comparable" },
  ]);
  assertWithheldDisplay(otherQuote);

  const noCreate = rankHill(
    candidate([
      {
        mint: mintA,
        curve: curveA,
        reserves: "70",
        creates: [],
        extra: [{ kind: "buy", slot: "12", eventIndex: 0, mark: "A" }],
      },
    ]),
    rankOptions,
  );
  assert.deepEqual(noCreate.withheld, [
    { mint: mintA, reason: "missing-create-event" },
  ]);
  assert.equal(noCreate.unavailableReason, "no-eligible-token");
});

test("refresh replaces the proposed top and never authorizes a display leader", () => {
  const first = rankHill(
    candidate([
      { mint: mintA, curve: curveA, reserves: "200" },
      { mint: mintB, curve: curveB, reserves: "50" },
    ]),
    rankOptions,
  );
  const second = rankHill(
    candidate([
      { mint: mintA, curve: curveA, reserves: "200" },
      { mint: mintB, curve: curveB, reserves: "900" },
    ]),
    rankOptions,
  );
  const opened = hillTurnover(null, first);
  assert.equal(opened.proposedTop, mintA);
  assert.equal(opened.dethroned, false);
  assert.equal(first.liveLeader, null);

  const replaced = hillTurnover(opened.proposedTop, second);
  assert.equal(replaced.proposedTop, mintB);
  assert.equal(replaced.dethroned, true);
  assert.equal(second.displayAuthorized, false);

  const held = hillTurnover(mintB, second);
  assert.equal(held.dethroned, false);
  assert.throws(() => hillTurnover("", second), /previousProposedTop/);
});

test("rejects substituted accounts and transaction capabilities", () => {
  const parsed = candidate([{ mint: mintA, curve: curveA, reserves: "10" }]);
  const substituted = {
    ...parsed,
    page: {
      ...parsed.page,
      accounts: parsed.page.accounts.map((account) => ({
        ...account,
        mint: mintB,
      })),
    },
  };
  assert.throws(() => rankHill(substituted, rankOptions), /disagree/);

  const missing = {
    ...parsed,
    page: { ...parsed.page, accounts: [] },
  };
  assert.throws(
    () => rankHill(missing, rankOptions),
    /missing its curve account/,
  );

  const tradable = {
    ...parsed,
    capabilities: { ...NO_TRANSACTION_CAPABILITIES, canTrade: true },
  };
  assert.throws(
    () => rankHill(tradable, rankOptions),
    /transaction capabilities/,
  );

  const before = parsed.page.tokens.map((token) => token.mint);
  rankHill(parsed, rankOptions);
  assert.deepEqual(
    parsed.page.tokens.map((token) => token.mint),
    before,
  );
});
