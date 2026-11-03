/**
 * Local presentation for an already-public per-token comment snapshot.
 *
 * Moderation, opt-in, rate limits, and token resolution stay in the separate
 * discussion service. This module does not authenticate anyone, rank
 * communities, or display rewards. `liveActivity` stays false: a snapshot is
 * not live community activity and sample data must not be presented as one.
 *
 * Render `comment.text` only as a text node. The plain-text helper never
 * wraps comments in markup.
 */

export const MAX_COMMENT_TEXT_BYTES = 600;
export const MAX_COMMENTS = 50;
export const DISCUSSION_RENDER_MODE = "text-node" as const;

const MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DATE_MS = 8_640_000_000_000_000;
const PUBLIC_STATUSES = new Set(["pending", "approved", "rejected", "hidden"]);
const REWARD_KEYS = new Set([
  "airdrop",
  "airdropAmount",
  "reward",
  "rewardEligibility",
  "rewards",
]);
const CONTROL_OR_OVERRIDE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/u;

export class DiscussionPreviewError extends Error {
  readonly code:
    | "invalid_comment"
    | "invalid_mint"
    | "invalid_snapshot"
    | "reward_not_displayable"
    | "too_many_comments";

  constructor(code: DiscussionPreviewError["code"]) {
    super(code);
    this.name = "DiscussionPreviewError";
    this.code = code;
  }
}

export type DiscussionCommentView = Readonly<{
  id: string;
  text: string;
  createdAt: number;
  label: string;
}>;

export type DiscussionPreview = Readonly<{
  mint: string;
  state: "available" | "unavailable";
  liveActivity: false;
  rewardsShown: false;
  renderMode: typeof DISCUSSION_RENDER_MODE;
  regionLabel: string;
  emptyLabel: string | null;
  comments: readonly DiscussionCommentView[];
  omittedCount: number;
}>;

function fail(code: DiscussionPreviewError["code"]): never {
  throw new DiscussionPreviewError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoRewardKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (REWARD_KEYS.has(key)) fail("reward_not_displayable");
  }
}

function requireMint(mint: string): string {
  if (typeof mint !== "string" || !MINT_PATTERN.test(mint))
    fail("invalid_mint");
  return mint;
}

function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function commentText(value: unknown): string {
  if (typeof value !== "string" || !wellFormed(value)) fail("invalid_comment");
  if (value.trim() === "" || value.trim() !== value) fail("invalid_comment");
  if (CONTROL_OR_OVERRIDE.test(value)) fail("invalid_comment");
  if (new TextEncoder().encode(value).length > MAX_COMMENT_TEXT_BYTES) {
    fail("invalid_comment");
  }
  return value;
}

function commentId(value: unknown, seen: Set<string>): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || seen.has(value)) {
    fail("invalid_comment");
  }
  seen.add(value);
  return value;
}

function commentTime(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_DATE_MS
  ) {
    fail("invalid_comment");
  }
  return value;
}

function unavailable(mint: string): DiscussionPreview {
  return Object.freeze({
    mint,
    state: "unavailable",
    liveActivity: false,
    rewardsShown: false,
    renderMode: DISCUSSION_RENDER_MODE,
    regionLabel: "Comments are unavailable in this preview.",
    emptyLabel: null,
    comments: Object.freeze([]),
    omittedCount: 0,
  });
}

export function presentDiscussionThread(
  mint: string,
  snapshot: unknown,
): DiscussionPreview {
  const checkedMint = requireMint(mint);
  if (!isRecord(snapshot)) fail("invalid_snapshot");
  assertNoRewardKeys(snapshot);
  if (snapshot.state === "unavailable") return unavailable(checkedMint);
  if (snapshot.state !== "available" || !Array.isArray(snapshot.comments)) {
    fail("invalid_snapshot");
  }
  if (snapshot.comments.length > MAX_COMMENTS) fail("too_many_comments");

  const seen = new Set<string>();
  const visible: Array<{ id: string; text: string; createdAt: number }> = [];
  let omittedCount = 0;

  for (const entry of snapshot.comments) {
    if (!isRecord(entry)) fail("invalid_comment");
    assertNoRewardKeys(entry);
    if (entry.mint !== checkedMint) fail("invalid_comment");
    const id = commentId(entry.id, seen);
    const text = commentText(entry.text);
    const createdAt = commentTime(entry.createdAt);
    const status = entry.status;
    if (
      status !== undefined &&
      (typeof status !== "string" || !PUBLIC_STATUSES.has(status))
    ) {
      fail("invalid_comment");
    }
    if (status === undefined || status === "approved") {
      visible.push({ id, text, createdAt });
    } else {
      omittedCount += 1;
    }
  }

  const comments = Object.freeze(
    visible.map((comment, index) =>
      Object.freeze({
        id: comment.id,
        text: comment.text,
        createdAt: comment.createdAt,
        label: `Comment ${index + 1} of ${visible.length}. ${new Date(comment.createdAt).toISOString()} UTC.`,
      }),
    ),
  );

  return Object.freeze({
    mint: checkedMint,
    state: "available",
    liveActivity: false,
    rewardsShown: false,
    renderMode: DISCUSSION_RENDER_MODE,
    regionLabel: "Local comment preview. Not live community activity.",
    emptyLabel:
      comments.length === 0
        ? "No visible comments in this local snapshot."
        : null,
    comments,
    omittedCount,
  });
}

/** Plain text only. Callers render comment text as text, never as HTML. */
export function discussionPlainText(preview: DiscussionPreview): string {
  const lines = [preview.regionLabel];
  if (preview.emptyLabel) lines.push(preview.emptyLabel);
  for (const comment of preview.comments) {
    lines.push(comment.label, comment.text, "");
  }
  return lines.join("\n");
}
