import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { exists, read, pages, toolPages, hiddenPages, loadDom, indexHrefFor } from "./_helpers.js";

test("每个页面文件都存在", () => {
  for (const page of pages) {
    assert.ok(exists(page), `${page} should exist`);
  }
});

test("首页通过 <a href> 链接到所有工具页和 hidden 页", async () => {
  const dom = await loadDom("index.html");
  const hrefs = new Set(
    [...dom.window.document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"))
  );
  for (const page of [...toolPages, ...hiddenPages]) {
    assert.ok(hrefs.has(indexHrefFor(page)), `index.html should link to ${page}`);
  }
  dom.window.close();
});

test("HTML 中本地 href/src 引用都能解析到现有文件", () => {
  const attrPattern = /\b(?:href|src)="([^"]+)"/g;
  for (const page of pages) {
    const html = read(page);
    for (const match of html.matchAll(attrPattern)) {
      const ref = match[1];
      if (ref.includes("${")) continue;
      if (/^(?:https?:|data:|mailto:|tel:|#)/.test(ref)) continue;
      const [pathname] = ref.split(/[?#]/);
      const resolved = path.normalize(path.join(path.dirname(page), pathname));
      assert.ok(exists(resolved), `${page} references missing file: ${ref}`);
    }
  }
});

test("不依赖 CDN，运行时依赖都来自本地 vendor", () => {
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(
      html,
      /<script[^>]+src="https?:\/\//,
      `${page} should not load scripts from CDN`
    );
    assert.doesNotMatch(
      html,
      /<link[^>]+rel="stylesheet"[^>]+href="https?:\/\//,
      `${page} should not load CSS from CDN`
    );
  }

  for (const vendorFile of [
    "vendor/pdfjs/pdf.min.js",
    "vendor/pdfjs/pdf.worker.min.js",
    "vendor/jspdf/jspdf.umd.min.js",
  ]) {
    assert.ok(exists(vendorFile), `${vendorFile} should exist`);
  }
});
