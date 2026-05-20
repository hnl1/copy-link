import assert from "node:assert/strict";
import test from "node:test";
import { read, fileInputPages, loadDom } from "./_helpers.js";

test("共享 .file-drop-zone 样式齐全", () => {
  const css = read("assets/components/file-input/index.css");
  for (const selector of [
    /\.file-drop-zone\s*\{/,
    /\.file-drop-zone:hover/,
    /\.file-drop-zone:focus-visible/,
    /\.file-drop-zone\.dragging\s*\{/,
    /\.file-drop-icon\s*\{/,
    /\.file-drop-actions\s*\{/,
    /\.file-drop-status\s*\{/,
    /\.file-input-picker-menu\s*\{/,
    /\.file-input-picker-menu\[hidden\]\s*\{/,
  ]) {
    assert.match(css, selector);
  }
});

test("file-input.js 暴露 drop zone trigger API（triggerElement / 键盘可达）", () => {
  const script = read("assets/components/file-input/index.js");
  assert.match(script, /options\.triggerElement/);
  assert.match(script, /setAttribute\('tabindex', '0'\)/);
  assert.match(script, /setAttribute\('role', 'button'\)/);
  assert.match(script, /addEventListener\('keydown'/);
});

test("file-input.js 支持目录选择", () => {
  const script = read("assets/components/file-input/index.js");
  for (const expected of [
    /webkitdirectory/,
    /createDirectoryInput/,
    /createDropActions/,
    /createFileEntry/,
    /buildFileTree/,
    /fileEntries:\s*entries/,
    /allFileEntries:\s*incomingEntries/,
    /acceptFiles\(directoryInput\.files, 'folder'\)/,
    /textContent = '选择文件夹'/,
    /textContent = '添加文件夹'/,
  ]) {
    assert.match(script, expected);
  }
});

test("clipboard 工具不加载共享 file-input.js", () => {
  assert.doesNotMatch(read("tools/clipboard.html"), /assets\/file-input\.js/);
});

test("file-meta 支持 MP4 文件元信息", () => {
  const html = read("tools/file-meta/index.html");
  assert.match(html, /accept="[^"]*video\/mp4/);
  assert.match(html, /from\s+['"]\.\/inspectors\.js['"]/);
  const mp4 = read("tools/file-meta/mp4.js");
  assert.match(mp4, /\bexport function match\s*\(/);
  assert.match(mp4, /\bexport async function inspect\s*\(/);
});

test("file-meta 支持 JPEG 文件元信息", () => {
  const html = read("tools/file-meta/index.html");
  assert.match(html, /accept="[^"]*image\/jpeg/);
  const jpeg = read("tools/file-meta/jpeg.js");
  assert.match(jpeg, /\bexport function match\s*\(/);
  assert.match(jpeg, /\bexport async function inspect\s*\(/);
});

test("file-meta 支持 PNG 文件元信息", () => {
  const png = read("tools/file-meta/png.js");
  assert.match(png, /\bexport function match\s*\(/);
  assert.match(png, /\bexport async function inspect\s*\(/);
});

test("file-meta 共享模块导出渲染工具", () => {
  const shared = read("tools/file-meta/shared.js");
  for (const name of ["el", "makeGrid", "appendFileSection", "formatBytes", "formatAspectRatio"]) {
    assert.match(shared, new RegExp(`export function ${name}\\s*\\(`));
  }
});

for (const page of fileInputPages) {
  test(`${page} 使用共享 drop zone`, async () => {
    const dom = await loadDom(page);
    const { document } = dom.window;

    const hasSharedImport = [...document.querySelectorAll('script[type="module"]')].some((s) =>
      /from\s+['"][^'"]*assets\/components\/file-input\/index\.js['"]/.test(s.textContent || "")
    );
    assert.ok(hasSharedImport, `${page} should import the shared file input module`);

    const dropZone = document.querySelector(".file-drop-zone");
    assert.ok(dropZone, `${page} should include shared drop zone element`);
    assert.equal(dropZone.getAttribute("role"), "button");
    assert.equal(dropZone.getAttribute("tabindex"), "0");

    const fileInput =
      document.getElementById("file-input") || document.getElementById("pdf-file");
    assert.ok(fileInput, `${page} should keep a file input with id file-input or pdf-file`);
    assert.equal(fileInput.tagName, "INPUT");
    assert.ok(fileInput.classList.contains("visually-hidden-file"));
    assert.ok(fileInput.hasAttribute("accept"));
    assert.ok(fileInput.hasAttribute("multiple"));

    assert.ok(document.querySelector(".file-drop-icon"), `${page} should include drop prompt icon`);
    assert.ok(document.querySelector(".file-drop-title"), `${page} should include drop title host`);
    const status = document.querySelector(".file-drop-status");
    assert.ok(status, `${page} should keep status text in drop zone`);
    assert.ok(status.hasAttribute("hidden"), `${page} status should start hidden`);

    for (const el of document.querySelectorAll("[aria-describedby]")) {
      for (const id of el.getAttribute("aria-describedby").trim().split(/\s+/)) {
        assert.ok(
          document.getElementById(id),
          `${page} aria-describedby references missing id: ${id}`
        );
      }
    }

    const html = read(page);
    assert.match(html, /\bbindFileInputDropZone\s*\(/);
    assert.match(html, /\btriggerElement:\s*dropHint/);

    dom.window.close();
  });
}
