import assert from "node:assert/strict";
import test from "node:test";
import {
  tokenizeWords,
  splitLines,
  myersDiff,
  diffTokens,
  diffLineParts,
  computeDiff,
} from "../tools/text-diff/utils.js";

test("tokenizeWords keeps words whole and splits CJK / punctuation per char", () => {
  assert.deepEqual(tokenizeWords("abc 中文, x"), ["abc", " ", "中", "文", ",", " ", "x"]);
});

test("splitLines handles CRLF / CR / LF", () => {
  assert.deepEqual(splitLines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
});

test("myersDiff returns the concrete edit script", () => {
  const segs = myersDiff([1, 2, 3], [1, 3]);
  assert.deepEqual(segs, [
    { type: "equal", value: [1] },
    { type: "delete", value: [2] },
    { type: "equal", value: [3] },
  ]);
});

test("myersDiff returns null when edit distance exceeds maxD", () => {
  assert.equal(myersDiff([1, 2, 3, 4], [5, 6, 7, 8], { maxD: 2 }), null);
});

test("diffTokens trims common prefix/suffix and diffs the middle", () => {
  const segs = diffTokens(["a", "b", "c", "d"], ["a", "x", "d"]);
  assert.deepEqual(segs, [
    { type: "equal", value: ["a"] },
    { type: "delete", value: ["b", "c"] },
    { type: "insert", value: ["x"] },
    { type: "equal", value: ["d"] },
  ]);
});

test("diffTokens falls back to whole replace when over maxD", () => {
  const segs = diffTokens([1, 2, 3, 4], [5, 6, 7, 8], { maxD: 1 });
  assert.deepEqual(segs, [
    { type: "delete", value: [1, 2, 3, 4] },
    { type: "insert", value: [5, 6, 7, 8] },
  ]);
});

test("diffLineParts highlights inserted words on the right, keeps original on the left", () => {
  const { left, right } = diffLineParts("hello world", "hello brave world");
  assert.deepEqual(left, [{ type: "equal", text: "hello world" }]);
  assert.deepEqual(right, [
    { type: "equal", text: "hello " },
    { type: "add", text: "brave " },
    { type: "equal", text: "world" },
  ]);
});

test("computeDiff aligns a single changed line into one replace pair", () => {
  const { sideRows, unifiedRows, stats } = computeDiff("foo bar baz", "foo qux baz");
  assert.deepEqual(stats, { added: 1, removed: 1, same: 0 });

  assert.equal(sideRows.length, 1);
  const row = sideRows[0];
  assert.equal(row.left?.type, "del");
  assert.equal(row.right?.type, "add");
  assert.equal(row.left?.no, 1);
  assert.equal(row.right?.no, 1);
  assert.ok(row.left?.parts.some((p) => p.type === "del" && p.text === "bar"));
  assert.ok(row.right?.parts.some((p) => p.type === "add" && p.text === "qux"));

  assert.equal(unifiedRows.length, 2);
  assert.equal(unifiedRows[0].type, "del");
  assert.equal(unifiedRows[1].type, "add");
});

test("computeDiff numbers lines and reports added/removed counts", () => {
  const a = "line1\nline2\nline3";
  const b = "line1\nline2-changed\nline3\nline4";
  const { unifiedRows, stats } = computeDiff(a, b);
  assert.equal(stats.same, 2);
  assert.equal(stats.removed, 1);
  assert.equal(stats.added, 2);

  const equalRows = unifiedRows.filter((r) => r.type === "equal");
  assert.equal(equalRows[0].aNo, 1);
  assert.equal(equalRows[0].bNo, 1);

  const addRows = unifiedRows.filter((r) => r.type === "add");
  assert.ok(addRows.some((r) => r.bNo === 4));
});

test("computeDiff treats identical text as all-equal rows", () => {
  const { sideRows, stats } = computeDiff("same\ntext", "same\ntext");
  assert.equal(stats.added, 0);
  assert.equal(stats.removed, 0);
  assert.equal(stats.same, 2);
  assert.ok(sideRows.every((r) => r.left?.type === "equal" && r.right?.type === "equal"));
});

test("computeDiff does a word-level diff on a single minified line", () => {
  const a = '{"a":1,"b":2,"c":3}';
  const b = '{"a":1,"b":20,"c":3}';
  const { sideRows } = computeDiff(a, b);
  assert.equal(sideRows.length, 1);
  const right = sideRows[0].right;
  assert.ok(right?.parts.some((p) => p.type === "add"));
  const addedText = right?.parts.filter((p) => p.type === "add").map((p) => p.text).join("");
  assert.match(addedText ?? "", /0/);
});
