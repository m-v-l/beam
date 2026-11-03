import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DiscussionPreviewError,
  MAX_COMMENT_TEXT_BYTES,
  MAX_COMMENTS,
  discussionPlainText,
  presentDiscussionThread,
} from "../src/discussionPresentation.ts";

const mint = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const otherMint = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";

function comment(
  id: string,
  text: string,
  createdAt: number,
  extra: Record<string, unknown> = {},
) {
  return { id, mint, text, createdAt, ...extra };
}

function present(
  comments: readonly Record<string, unknown>[],
  state: "available" | "unavailable" = "available",
) {
  return presentDiscussionThread(mint, { state, comments });
}

test("approved comments stay in snapshot order and render as text", () => {
  const markup = '<script>alert(1)</script> & "quotes"';
  const preview = present([
    comment("2", "older note", 1_700_000_000_000, {
      status: "approved",
      likes: 99,
      subject: "secret-subject-should-not-leak",
    }),
    comment("10", markup, 1_700_000_000_100),
  ]);

  assert.equal(preview.liveActivity, false);
  assert.equal(preview.rewardsShown, false);
  assert.equal(preview.renderMode, "text-node");
  assert.equal(preview.state, "available");
  assert.equal(preview.omittedCount, 0);
  assert.equal(preview.emptyLabel, null);
  assert.deepEqual(
    preview.comments.map((entry) => entry.id),
    ["2", "10"],
  );
  assert.equal(preview.comments[1]?.text, markup);
  assert.equal(
    preview.comments[0]?.label,
    "Comment 1 of 2. 2023-11-14T22:13:20.000Z UTC.",
  );
  assert.deepEqual(Object.keys(preview.comments[0] ?? {}), [
    "id",
    "text",
    "createdAt",
    "label",
  ]);

  const plain = discussionPlainText(preview);
  assert.match(
    plain,
    /^Local comment preview\. Not live community activity\.\n/,
  );
  assert.ok(plain.includes(markup));
  assert.equal(plain.includes("<div"), false);
  assert.equal(plain.includes("secret-subject-should-not-leak"), false);
  assert.equal(plain.includes(mint), false);
  assert.equal(plain.includes("likes"), false);
});

test("pending, rejected, and hidden comments are omitted", () => {
  const preview = present([
    comment("1", "waiting", 10, { status: "pending" }),
    comment("2", "kept", 20, { status: "approved" }),
    comment("3", "nope", 30, { status: "rejected" }),
    comment("4", "opted out", 40, { status: "hidden" }),
  ]);

  assert.deepEqual(
    preview.comments.map((entry) => entry.text),
    ["kept"],
  );
  assert.equal(preview.omittedCount, 3);
  assert.equal(preview.comments[0]?.label.startsWith("Comment 1 of 1."), true);
});

test("an available snapshot with nothing visible is an empty local thread", () => {
  const preview = present([
    comment("1", "still pending", 10, { status: "pending" }),
  ]);
  assert.equal(preview.state, "available");
  assert.equal(preview.comments.length, 0);
  assert.equal(preview.omittedCount, 1);
  assert.equal(
    preview.emptyLabel,
    "No visible comments in this local snapshot.",
  );
  assert.equal(
    discussionPlainText(preview),
    "Local comment preview. Not live community activity.\nNo visible comments in this local snapshot.",
  );
});

test("unavailable snapshots drop every comment and do not leak rewards", () => {
  const preview = presentDiscussionThread(mint, {
    state: "unavailable",
    comments: [comment("1", "hidden thread", 10, { reward: "1000" })],
  });
  assert.equal(preview.state, "unavailable");
  assert.equal(preview.comments.length, 0);
  assert.equal(preview.omittedCount, 0);
  assert.equal(
    preview.regionLabel,
    "Comments are unavailable in this preview.",
  );
  assert.equal(discussionPlainText(preview).includes("hidden thread"), false);
  assert.equal(discussionPlainText(preview).includes("1000"), false);
});

test("reward and airdrop fields are refused instead of displayed", () => {
  for (const key of [
    "reward",
    "rewards",
    "airdrop",
    "airdropAmount",
    "rewardEligibility",
  ]) {
    assert.throws(
      () => present([comment("1", "hello", 10, { [key]: "later" })]),
      (error: unknown) =>
        error instanceof DiscussionPreviewError &&
        error.code === "reward_not_displayable",
    );
  }
  assert.throws(
    () =>
      presentDiscussionThread(mint, {
        state: "available",
        comments: [],
        airdrop: true,
      }),
    (error: unknown) =>
      error instanceof DiscussionPreviewError &&
      error.code === "reward_not_displayable",
  );
});

test("malformed snapshots and comment text fail closed", () => {
  const cases: Array<() => void> = [
    () =>
      presentDiscussionThread("not-a-mint", {
        state: "available",
        comments: [],
      }),
    () => presentDiscussionThread(mint, null),
    () => presentDiscussionThread(mint, { state: "sample", comments: [] }),
    () => presentDiscussionThread(mint, { state: "available" }),
    () => present([comment("1", "hello", 10, { mint: otherMint })]),
    () => present([comment("1", "hello", 10), comment("1", "again", 11)]),
    () => present([comment("../x", "hello", 10)]),
    () => present([comment("1", "  hello", 10)]),
    () => present([comment("1", "hello\u0000", 10)]),
    () => present([comment("1", "left\u202Eright", 10)]),
    () => present([comment("1", "isolate\u2066text", 10)]),
    () => present([comment("1", "hello", 1.5)]),
    () => present([comment("1", "hello", 10, { status: "published" })]),
    () =>
      present(
        Array.from({ length: MAX_COMMENTS + 1 }, (_, index) =>
          comment(String(index + 1), "hello", index),
        ),
      ),
    () => present([comment("1", "x".repeat(MAX_COMMENT_TEXT_BYTES + 1), 10)]),
  ];
  for (const run of cases) {
    assert.throws(
      run,
      (error: unknown) => error instanceof DiscussionPreviewError,
    );
  }
});

test("supplementary characters stay intact and lone surrogates fail", () => {
  const preview = present([comment("1", "ok \u{1F680}", 0)]);
  assert.equal(preview.comments[0]?.text, "ok \u{1F680}");
  assert.throws(
    () => present([comment("1", "bad \uD800", 0)]),
    (error: unknown) =>
      error instanceof DiscussionPreviewError &&
      error.code === "invalid_comment",
  );
});

test("newlines fit in the text node and the comment cap is exact", () => {
  const preview = present([
    comment("1", "line one\nline two", 0),
    ...Array.from({ length: MAX_COMMENTS - 1 }, (_, index) =>
      comment(String(index + 2), "ok", index + 1),
    ),
  ]);
  assert.equal(preview.comments.length, MAX_COMMENTS);
  assert.equal(preview.comments[0]?.text, "line one\nline two");
  assert.equal(
    new TextEncoder().encode("x".repeat(MAX_COMMENT_TEXT_BYTES)).length,
    MAX_COMMENT_TEXT_BYTES,
  );
  const exact = present([comment("1", "x".repeat(MAX_COMMENT_TEXT_BYTES), 0)]);
  assert.equal(exact.comments[0]?.text.length, MAX_COMMENT_TEXT_BYTES);
});
