// Plain-language preview copy for the current development configuration.
// These figures describe the provisional Beam component only. They are not a
// live quote, a custody decision, or a transaction.

export const FEE_COMMUNITY_BPS = 42;
export const FEE_TREASURY_BPS = 5;
export const FEE_FOUNDER_BPS = 3;
export const FEE_COMPONENT_BPS =
  FEE_COMMUNITY_BPS + FEE_TREASURY_BPS + FEE_FOUNDER_BPS;

export function bpsToPercentLabel(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError("basis points must be an integer from 0 to 10000");
  }
  return `${(bps / 100).toFixed(2)}%`;
}

export const feeComponentSummary = `${bpsToPercentLabel(FEE_COMMUNITY_BPS)} community / ${bpsToPercentLabel(FEE_TREASURY_BPS)} treasury / ${bpsToPercentLabel(FEE_FOUNDER_BPS)} founder`;

export type HowStep = {
  index: string;
  title: string;
  paragraphs: readonly string[];
};

export const howItWorks = {
  kicker: "THE BEAM PATH",
  title: "From spark to orbit.",
  subtitle:
    "These notes follow the current development configuration. This preview does not launch a token, collect a fee, or open a pool.",
  steps: [
    {
      index: "01",
      title: "Launch",
      paragraphs: [
        "The development program can mint an admin-configured supply onto a bonding curve. This preview does not publish a graduation price, a SOL threshold, or a presale or team schedule.",
        "Mayhem creation is rejected. Create token saves a browser-local draft and does not submit a transaction.",
      ],
    },
    {
      index: "02",
      title: "Fees",
      paragraphs: [
        `The specified Beam component is ${bpsToPercentLabel(FEE_COMMUNITY_BPS)} community, ${bpsToPercentLabel(FEE_TREASURY_BPS)} treasury, and ${bpsToPercentLabel(FEE_FOUNDER_BPS)} founder. That ${bpsToPercentLabel(FEE_COMPONENT_BPS)} figure is not an all-in quote: creator payout funding is still undecided, and creator, migration, and Raydium pool fees stay separate.`,
        "That component is not collected on trades here. Holder rewards, flagship buybacks, and burns are not running, and none of them promises a return.",
      ],
    },
    {
      index: "03",
      title: "Graduate",
      paragraphs: [
        "Raydium AMM v4 is the selected venue. Its adapter is not active, so this preview cannot create a pool. AMM v4 does not accept Token-2022 mints, so those curve launches have no graduation path until a reviewed plan exists.",
        "The superseded CPMM candidate fails closed and is not the selected venue. Its unused source would burn any LP it received, which would leave no LP fee claim. AMM v4 custody, lock, and burn are undecided; burning that LP would give up the pool fee.",
      ],
    },
  ] as const satisfies readonly HowStep[],
  availability:
    "Wallet connection, trading, donations, callouts, livestreams, and migration are unavailable. Sample cards are not chain data. The program is not deployed.",
} as const;

export function howItWorksPlainText(): string {
  return [
    howItWorks.kicker,
    howItWorks.title,
    howItWorks.subtitle,
    ...howItWorks.steps.flatMap((step) => [
      step.index,
      step.title,
      ...step.paragraphs,
    ]),
    howItWorks.availability,
  ].join("\n");
}
