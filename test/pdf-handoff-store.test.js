import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PDF_HANDOFF_MAX_AGE_MS,
  isExpiredPdfHandoff,
} from "../assets/pdf-handoff-store.js";
import { read } from "./_helpers.js";

test("PDF 临时传递记录默认保留一小时", () => {
  assert.equal(DEFAULT_PDF_HANDOFF_MAX_AGE_MS, 60 * 60 * 1000);
  const cutoff = 10_000;
  assert.equal(isExpiredPdfHandoff({ createdAt: cutoff }, cutoff), false);
  assert.equal(isExpiredPdfHandoff({ createdAt: cutoff - 1 }, cutoff), true);
  assert.equal(isExpiredPdfHandoff({}, cutoff), true);
});

test("PDF 临时传递记录读取后立即删除", () => {
  const store = read("assets/pdf-handoff-store.js");
  assert.match(store, /export function takePdfHandoff\s*\(/);
  assert.match(store, /db\.transaction\(STORE_NAME,\s*['"]readwrite['"]\)/);
  assert.match(store, /if \(record\) store\.delete\(id\)/);
});

test("主页和两个 PDF 页面都会清理过期记录", () => {
  for (const page of [
    "index.html",
    "tools/pdf-to-image/index.html",
    "tools/pdf-compare.html",
  ]) {
    const html = read(page);
    assert.match(html, /pdf-handoff-store\.js/);
    assert.match(html, /cleanupExpiredPdfHandoffs\(\)\.catch/);
  }
});

test("PDF 转换页在打开对比失败时回滚临时记录", () => {
  const html = read("tools/pdf-to-image/index.html");
  assert.match(html, /await putPdfHandoff\(\{/);
  assert.match(html, /await deletePdfHandoff\(handoffId\)/);
});
