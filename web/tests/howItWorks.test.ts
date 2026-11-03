import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEE_COMMUNITY_BPS,
  FEE_COMPONENT_BPS,
  FEE_FOUNDER_BPS,
  FEE_TREASURY_BPS,
  bpsToPercentLabel,
  feeComponentSummary,
  howItWorks,
  howItWorksPlainText,
} from "../src/howItWorks.ts";

const text = howItWorksPlainText();

test("fee labels stay tied to the 42/5/3 component", () => {
  assert.equal(FEE_COMMUNITY_BPS, 42);
  assert.equal(FEE_TREASURY_BPS, 5);
  assert.equal(FEE_FOUNDER_BPS, 3);
  assert.equal(FEE_COMPONENT_BPS, 50);
  assert.equal(bpsToPercentLabel(42), "0.42%");
  assert.equal(bpsToPercentLabel(5), "0.05%");
  assert.equal(bpsToPercentLabel(3), "0.03%");
  assert.equal(bpsToPercentLabel(50), "0.50%");
  assert.equal(
    feeComponentSummary,
    "0.42% community / 0.05% treasury / 0.03% founder",
  );
  assert.throws(() => bpsToPercentLabel(1.5), RangeError);
  assert.throws(() => bpsToPercentLabel(-1), RangeError);
});

test("onboarding states evidenced limits without unpublished promises", () => {
  assert.match(text, /admin-configured supply/);
  assert.match(text, /does not publish a graduation price, a SOL threshold/);
  assert.match(text, /Mayhem creation is rejected/);
  assert.match(text, /browser-local draft/);
  assert.match(text, /0\.42% community, 0\.05% treasury, and 0\.03% founder/);
  assert.match(text, /not an all-in quote/);
  assert.match(text, /creator payout funding is still undecided/);
  assert.match(text, /creator, migration, and Raydium pool fees stay separate/);
  assert.match(text, /not collected on trades here/);
  assert.match(text, /not running, and none of them promises a return/);
  assert.match(text, /Raydium AMM v4 is the selected venue/);
  assert.match(text, /adapter is not active/);
  assert.match(text, /does not accept Token-2022 mints/);
  assert.match(text, /CPMM candidate fails closed/);
  assert.match(text, /would burn any LP it received/);
  assert.match(text, /leave no LP fee claim/);
  assert.match(text, /custody, lock, and burn are undecided/);
  assert.match(text, /The program is not deployed/);
  assert.equal(howItWorks.steps.length, 3);
  assert.deepEqual(
    howItWorks.steps.map((step) => step.title),
    ["Launch", "Fees", "Graduate"],
  );
});

test("onboarding does not import historical thresholds or unsupported claims", () => {
  assert.doesNotMatch(text, /\d+(?:\.\d+)?\s*SOL/i);
  assert.doesNotMatch(text, /no presale|no team allocation|team tokens/i);
  assert.doesNotMatch(text, /instant sell/i);
  assert.doesNotMatch(
    text,
    /guaranteed|audited|price appreciation|all-in quote is/i,
  );
  assert.doesNotMatch(text, /buybacks are active|burns are active/i);
  assert.doesNotMatch(text, /durable liquidity|lasting liquidity|PumpSwap/i);
});
