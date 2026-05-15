import assert from "node:assert/strict";
import test from "node:test";
import { read, toolPages } from "./_helpers.js";

test("工具页都通过共享 ToolHeader 模块挂载（ToolHeader 内部统一引入 home-link）", () => {
  const toolHeaderSrc = read("assets/components/tool-header.js");
  assert.match(
    toolHeaderSrc,
    /from\s+['"]\.\/home-link\.js['"]/,
    "tool-header.js should import home-link.js"
  );

  for (const page of toolPages) {
    const html = read(page);
    assert.match(
      html,
      /from\s+['"]\.\.\/assets\/components\/tool-header\.js['"]/,
      `${page} should import the shared tool-header module`
    );
    assert.match(
      html,
      /\bmountToolHeader\s*\(/,
      `${page} should call mountToolHeader(...)`
    );
  }
});

test(".tool-header 是 sticky", () => {
  const css = read("assets/styles/common.css");
  assert.match(css, /\.tool-header\s*\{[\s\S]*position:\s*sticky;/);
  assert.match(css, /\.tool-header\s*\{[\s\S]*top:\s*0;/);
});
