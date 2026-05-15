import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { abs, exists, read, pages, toolPages, hiddenPages } from "./_helpers.js";

test("图标渲染细节只在 assets/styles/icon-button.css 内（消费方不能直接写 mask / --icon-url）", () => {
  // .icon-{name} 是图标的唯一对外接口；其它文件不能写 mask / --icon-url / var(--icon-X)。
  const filesToCheck = [
    "assets/styles/tokens.css",
    "assets/styles/tool-page.css",
    "assets/styles/card-page.css",
    "assets/styles/icons.css",
    "assets/components/tool-header/index.css",
    "assets/components/tool-header/index.js",
    "assets/components/file-input/index.css",
    "assets/components/file-input/index.js",
    "assets/components/theme-toggle.js",
    "index.html",
    ...toolPages,
  ];

  const forbidden = [
    { pattern: /\b(?:-webkit-)?mask(?:-image|-mode|-size|-position|-repeat)?\s*:/, label: "mask 相关 CSS 属性" },
    { pattern: /--icon-url\b/, label: "--icon-url 变量" },
    { pattern: /var\(--icon-(?:home|computer|sun|moon|trash|close)\)/, label: "var(--icon-X) 直接引用" },
  ];

  for (const file of filesToCheck) {
    const content = read(file);
    for (const { pattern, label } of forbidden) {
      assert.doesNotMatch(
        content,
        pattern,
        `${file} 不应该包含 ${label}——图标渲染细节应只在 assets/styles/icon-button.css 内`
      );
    }
  }
});

test("图标定义集中在 assets/styles/icons.css，tokens.css 通过 @import 引入", () => {
  const tokensCss = read("assets/styles/tokens.css");
  const iconCss = read("assets/styles/icons.css");
  const iconButtonCss = read("assets/styles/icon-button.css");
  const iconPage = read("tools/icons.html");

  assert.match(tokensCss, /@import url\("\.\/icons\.css"\);/);
  assert.match(tokensCss, /@import url\("\.\/icon-button\.css"\);/);
  assert.doesNotMatch(tokensCss, /--icon-(?:home|computer|sun|moon|trash|close):\s*url\(/);

  for (const icon of ["home", "computer", "sun", "moon", "trash", "close"]) {
    assert.match(iconCss, new RegExp(`--icon-${icon}:\\s*url\\(`));
    assert.match(iconButtonCss, new RegExp(`mask-image:\\s*var\\(--icon-${icon}\\)`));
    assert.match(iconPage, new RegExp(`icon-${icon}`));
  }
});

async function loadFaviconMap() {
  const mod = await import(new URL("../assets/favicons.js", import.meta.url));
  assert.ok(mod.MAP && typeof mod.MAP === "object", "favicons.js should export MAP");
  return mod.MAP;
}

test("favicon 配置覆盖每个页面，且每个页面都加载 favicons.js", async () => {
  assert.ok(exists("assets/favicons.js"), "assets/favicons.js should exist");
  const MAP = await loadFaviconMap();

  for (const page of pages) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(MAP, page),
      `favicons.js should declare a favicon for ${page}`
    );
    assert.ok(MAP[page], `${page} favicon should be a non-empty string`);
  }
  for (const page of Object.keys(MAP)) {
    assert.ok(pages.includes(page), `favicons.js declares unknown page ${page}`);
  }

  for (const page of pages) {
    const html = read(page);
    const expectedSrc = page === "index.html" ? "assets/favicons.js" : "../assets/favicons.js";
    assert.match(
      html,
      new RegExp(`<script type="module" src="${expectedSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"></script>`),
      `${page} should load the shared favicon module`
    );
    assert.doesNotMatch(
      html,
      /<link[^>]+rel="icon"/,
      `${page} should not hardcode a favicon link; let favicons.js inject it`
    );
  }
});

test("首页 card / footer 图标 emoji 与 favicons.js MAP 一致", async () => {
  const MAP = await loadFaviconMap();
  const html = read("index.html");

  for (const page of toolPages) {
    const cardPattern = new RegExp(
      `<a[^>]*class="card"[^>]*href="${page.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?<div class="icon">([^<]+)</div>`
    );
    const match = html.match(cardPattern);
    assert.ok(match, `index.html should have a card linking to ${page} with an icon`);
    assert.equal(match[1].trim(), MAP[page]);
  }

  for (const page of hiddenPages) {
    const linkPattern = new RegExp(
      `<a[^>]*class="[^"]*\\bicon-link\\b[^"]*"[^>]*href="${page.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]+)</a>`
    );
    const match = html.match(linkPattern);
    assert.ok(match, `index.html footer should link to ${page} with an icon`);
    assert.equal(match[1].trim(), MAP[page]);
  }
});

const SVG_SOURCE_DIRS = ["assets", "tools"];
const SVG_SOURCE_EXTRA_FILES = ["index.html"];
const SVG_SOURCE_SKIP_DIRS = new Set(["assets/icons", "vendor", "node_modules", "test"]);
// favicons.js 用 data:image/svg+xml 字符串生成 emoji favicon，是合法例外
const SVG_SOURCE_SKIP_FILES = new Set(["assets/favicons.js"]);
const SVG_SOURCE_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs", ".ts"]);

function listSourceFiles() {
  const results = new Set();
  for (const file of SVG_SOURCE_EXTRA_FILES) {
    if (exists(file)) results.add(file);
  }
  const walk = (relDir) => {
    if (SVG_SOURCE_SKIP_DIRS.has(relDir)) return;
    if (!exists(relDir)) return;
    for (const name of readdirSync(abs(relDir))) {
      const relChild = path.posix.join(relDir, name);
      const stat = statSync(abs(relChild));
      if (stat.isDirectory()) {
        walk(relChild);
        continue;
      }
      if (SVG_SOURCE_EXTENSIONS.has(path.extname(name)) && !SVG_SOURCE_SKIP_FILES.has(relChild)) {
        results.add(relChild);
      }
    }
  };
  for (const dir of SVG_SOURCE_DIRS) walk(dir);
  return [...results].sort();
}

test("svg 资源只在 assets/icons 下定义，其它地方不能 inline / 动态构造 <svg>", () => {
  const inlineSvgPattern = /<svg\b/i;
  const dynamicSvgPattern = /createElementNS\(\s*['"`]http:\/\/www\.w3\.org\/2000\/svg['"`]\s*,\s*['"`]svg['"`]/;

  for (const file of listSourceFiles()) {
    const content = read(file);
    assert.doesNotMatch(content, inlineSvgPattern, `${file} 不应包含 inline <svg>，请放到 assets/icons/ 下`);
    assert.doesNotMatch(content, dynamicSvgPattern, `${file} 不应使用 createElementNS 动态构造 <svg>，请改用 .icon-{name}`);
  }
});

test("assets/icons 下的 svg 都在 tools/icons.html 中展示，且双向对齐", () => {
  const svgNames = readdirSync(abs("assets/icons"))
    .filter((name) => name.endsWith(".svg"))
    .map((name) => name.slice(0, -".svg".length))
    .sort();

  const iconPage = read("tools/icons.html");
  const previewPattern = /<span[^>]*class="[^"]*\bicon-preview\b[^"]*\bicon-([a-z][a-z0-9-]*)\b[^"]*"/g;
  const shownIcons = [...iconPage.matchAll(previewPattern)].map((m) => m[1]).sort();

  for (const name of svgNames) {
    assert.ok(
      shownIcons.includes(name),
      `assets/icons/${name}.svg 没有在 tools/icons.html 中展示，请补一张 .icon-${name} 卡片`
    );
  }
  for (const name of shownIcons) {
    assert.ok(
      svgNames.includes(name),
      `tools/icons.html 展示了 .icon-${name}，但 assets/icons/${name}.svg 不存在`
    );
  }
  assert.equal(shownIcons.length, svgNames.length);
});
