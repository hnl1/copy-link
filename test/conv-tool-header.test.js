import assert from "node:assert/strict";
import test from "node:test";
import { read, toolPages } from "./_helpers.js";

test("工具页都通过共享 ToolHeader 模块挂载", () => {
  for (const page of toolPages) {
    const html = read(page);
    assert.match(
      html,
      /from\s+['"]\.\.\/assets\/components\/tool-header\/index\.js['"]/,
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
  const css = read("assets/components/tool-header/index.css");
  assert.match(css, /\.tool-header\s*\{[\s\S]*position:\s*sticky;/);
  assert.match(css, /\.tool-header\s*\{[\s\S]*top:\s*0;/);
});
