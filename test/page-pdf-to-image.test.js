import assert from "node:assert/strict";
import test from "node:test";
import { exists, read, loadDom } from "./_helpers.js";

const PAGE = "tools/pdf-to-image.html";
const UTILS = "tools/pdf-to-image-utils.js";

test("pdf-to-image 使用更短的页面名（PDF 转图片版）", () => {
  const html = read(PAGE);
  assert.match(html, /<title>PDF 转图片版<\/title>/);
  assert.match(html, /title:\s*'PDF 转图片版'/);
});

test("pdf-to-image 不再暴露高级输出选项（scale / format / quality / 预览）", async () => {
  const dom = await loadDom(PAGE);
  const { document } = dom.window;
  for (const id of ["scale", "format", "quality", "preview-canvas"]) {
    assert.equal(
      document.getElementById(id),
      null,
      `pdf-to-image should not expose #${id}`
    );
  }
  dom.window.close();
});

test("pdf-to-image 文件夹导入显示目录路径（utils 暴露相关 helper）", () => {
  const html = read(PAGE);
  const utils = read(UTILS);

  assert.match(utils, /export function getDisplayPathSeparator\(/);
  assert.match(utils, /export function getPdfDisplayName\(/);
  assert.match(utils, /export function getPdfOutputPath\(/);
  assert.match(utils, /relativePath\.split\('\/'\)\.filter\(Boolean\)\.join\(getDisplayPathSeparator\b/);
  assert.match(html, /addPdfFiles\(files, detail\.sourceLabel, detail\.fileEntries\)/);
});

test("pdf-to-image 多文件下载打包为 zip", () => {
  const html = read(PAGE);
  const utils = read(UTILS);

  assert.match(utils, /export async function createZipBlob\(/);
  assert.match(html, /async function downloadAllGenerated\(\)/);
  assert.match(html, /generatedItems\.length === 1/);
  assert.match(html, /downloadBlob\(item\.outputBlob, item\.outputName\)/);
  assert.match(html, /path:\s*item\.outputPath \|\| item\.outputName/);
  assert.match(html, /pdf-to-image-results\.zip/);
});

test("pdf-to-image: drop-zone 与 pdf-list 是 <main> 的直接子元素", async () => {
  const dom = await loadDom(PAGE);
  const { document } = dom.window;

  const main = document.querySelector("main");
  const dropHint = document.getElementById("drop-hint");
  const pdfList = document.getElementById("pdf-list");

  assert.ok(main, "main element should exist");
  assert.ok(dropHint, "#drop-hint should exist");
  assert.ok(pdfList, "#pdf-list should exist");
  assert.equal(dropHint.parentElement, main);
  assert.equal(pdfList.parentElement, main);

  assert.equal(document.querySelector(".panel.upload-panel"), null);
  assert.equal(document.querySelector("main .form"), null);

  dom.window.close();
});

test("pdf-to-image: #pdf-list[hidden] 实际 computed 为 display:none，去掉 hidden 后回到 flex", async () => {
  const dom = await loadDom(PAGE);
  const { document, getComputedStyle } = dom.window;

  const pdfList = document.getElementById("pdf-list");
  assert.ok(pdfList.hasAttribute("hidden"));
  assert.equal(getComputedStyle(pdfList).display, "none");

  pdfList.removeAttribute("hidden");
  assert.equal(getComputedStyle(pdfList).display, "flex");

  dom.window.close();
});

test("pdf-to-image: drop-zone 四向 margin = 40px，min-height 不再写死视口计算", async () => {
  const dom = await loadDom(PAGE);
  const { document, getComputedStyle } = dom.window;

  const dropHint = document.getElementById("drop-hint");
  const cs = getComputedStyle(dropHint);

  assert.equal(cs.marginTop, "40px");
  assert.equal(cs.marginBottom, "40px");
  assert.equal(cs.marginLeft, "40px");
  assert.equal(cs.marginRight, "40px");

  assert.doesNotMatch(
    cs.minHeight,
    /100vh|144/,
    "min-height should not be the brittle hardcoded calc(100vh - 144px)"
  );

  dom.window.close();
});

test("pdf-to-image utils 模块对外暴露纯函数集合，并被页面 import", () => {
  assert.ok(exists(UTILS), `${UTILS} should exist`);
  const utils = read(UTILS);
  for (const name of [
    "isPdfFile",
    "makeOutputName",
    "getDisplayPathSeparator",
    "getPdfDisplayName",
    "getPdfOutputPath",
    "formatFileSize",
    "formatHms",
    "formatDuration",
    "calculateCrc32",
    "createZipBlob",
  ]) {
    assert.match(utils, new RegExp(`export[^\\n]+\\b${name}\\b`), `${UTILS} should export ${name}`);
  }

  const html = read(PAGE);
  assert.match(
    html,
    /<script\s+type="module">[\s\S]*from\s+['"]\.\/pdf-to-image-utils\.js['"]/,
    "pdf-to-image.html should import the utils module"
  );
  // 这两条防止把已抽到 utils 的函数又在 inline script 里复制一份。
  assert.doesNotMatch(html, /\bfunction\s+formatFileSize\b/);
  assert.doesNotMatch(html, /\bfunction\s+calculateCrc32\b/);
});

test("pdf-to-image 使用共享上传 prompt（drop zone 类齐全）", async () => {
  const dom = await loadDom(PAGE);
  const { document } = dom.window;

  assert.ok(document.querySelector(".file-drop-zone"));
  assert.ok(document.querySelector(".visually-hidden-file"));
  assert.ok(document.querySelector(".file-drop-icon"));
  assert.ok(document.querySelector(".file-drop-title"));
  const status = document.querySelector(".file-drop-status");
  assert.ok(status && status.hasAttribute("hidden"));

  // 让共享 drop zone 自己根据 subject 生成提示标题
  assert.match(read(PAGE), /\bsubject:\s*'PDF'/);

  dom.window.close();
});
