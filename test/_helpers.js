import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import jsdom from "jsdom";

const { JSDOM } = jsdom;

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const toolPages = [
  "tools/clipboard.html",
  "tools/video-compare.html",
  "tools/image-compare.html",
  "tools/pdf-compare.html",
  "tools/pdf-to-image/index.html",
  "tools/file-meta/index.html",
  "tools/vmess-to-clash/index.html",
  "tools/text-diff/index.html",
];

export const hiddenPages = ["tools/icons.html"];

export const pages = ["index.html", ...toolPages, ...hiddenPages];

export const fileInputPages = [
  "tools/video-compare.html",
  "tools/image-compare.html",
  "tools/pdf-compare.html",
  "tools/pdf-to-image/index.html",
  "tools/file-meta/index.html",
];

export function abs(relativePath) {
  return path.join(root, relativePath);
}

export function exists(relativePath) {
  return existsSync(abs(relativePath));
}

export function read(relativePath) {
  return readFileSync(abs(relativePath), "utf8");
}

/** 从页面路径到 assets/ 的相对前缀，如 tools/file-meta/index.html → ../../assets/ */
export function assetsRelativePrefix(page) {
  const depth = page.split("/").length - 1;
  if (depth === 0) return "assets/";
  return "../".repeat(depth) + "assets/";
}

/** 首页 card 链接用的 href；目录型工具页用 tools/foo/ 而非 tools/foo/index.html */
export function indexHrefFor(page) {
  if (page.endsWith("/index.html")) return page.slice(0, -"index.html".length);
  return page;
}

export async function loadDom(relativePath) {
  const filePath = abs(relativePath);
  const dom = await JSDOM.fromFile(filePath, {
    url: pathToFileURL(filePath).href,
    resources: "usable",
    pretendToBeVisual: true,
  });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === "complete") resolve();
    else dom.window.addEventListener("load", () => resolve(), { once: true });
  });
  return dom;
}
