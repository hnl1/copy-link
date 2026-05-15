import assert from "node:assert/strict";
import test from "node:test";
import {
  isPdfFile,
  makeOutputName,
  getDisplayPathSeparator,
  getPdfDisplayName,
  getPdfOutputPath,
  formatFileSize,
  formatHms,
  formatDuration,
  calculateCrc32,
  getZipDateTime,
  normalizeZipPath,
  makeUniqueZipPaths,
  createLocalFileHeader,
  createCentralDirectoryHeader,
  createZipBlob,
} from "../tools/pdf-to-image-utils.js";

test("isPdfFile recognises PDFs by mime or extension", () => {
  assert.equal(isPdfFile({ type: "application/pdf", name: "a.pdf" }), true);
  assert.equal(isPdfFile({ type: "", name: "a.PDF" }), true);
  assert.equal(isPdfFile({ type: "", name: "a.pdf.txt" }), false);
  assert.equal(isPdfFile({ type: "image/png", name: "a.png" }), false);
  assert.equal(isPdfFile(null), false);
  assert.equal(isPdfFile(undefined), false);
});

test("makeOutputName appends -images suffix and strips .pdf", () => {
  assert.equal(makeOutputName("foo.pdf"), "foo-images.pdf");
  assert.equal(makeOutputName("foo.PDF"), "foo-images.pdf");
  assert.equal(makeOutputName("foo"), "foo-images.pdf");
  assert.equal(makeOutputName(""), "converted-images.pdf");
  assert.equal(makeOutputName(undefined), "converted-images.pdf");
});

test("getDisplayPathSeparator picks separator by platform", () => {
  assert.equal(getDisplayPathSeparator("MacIntel"), "/");
  assert.equal(getDisplayPathSeparator("Linux x86_64"), "/");
  assert.equal(getDisplayPathSeparator("Win32"), "\\");
  assert.equal(getDisplayPathSeparator("Windows NT 10.0"), "\\");
  assert.equal(getDisplayPathSeparator(""), "/");
});

test("getPdfDisplayName joins folder paths with the platform separator", () => {
  const file = { name: "a.pdf" };
  assert.equal(getPdfDisplayName(file, null, "MacIntel"), "a.pdf");
  assert.equal(getPdfDisplayName(file, { relativePath: "a.pdf" }, "MacIntel"), "a.pdf");
  assert.equal(
    getPdfDisplayName(file, { relativePath: "dir/sub/a.pdf" }, "MacIntel"),
    "dir/sub/a.pdf"
  );
  assert.equal(
    getPdfDisplayName(file, { relativePath: "dir/sub/a.pdf" }, "Win32"),
    "dir\\sub\\a.pdf"
  );
  assert.equal(
    getPdfDisplayName({ name: "" }, null, "MacIntel"),
    "未命名 PDF"
  );
});

test("getPdfOutputPath replaces the leaf file name in the relative path", () => {
  const file = { name: "a.pdf" };
  assert.equal(getPdfOutputPath(file, null, "a-images.pdf"), "a-images.pdf");
  assert.equal(
    getPdfOutputPath(file, { relativePath: "a.pdf" }, "a-images.pdf"),
    "a-images.pdf"
  );
  assert.equal(
    getPdfOutputPath(file, { relativePath: "dir/sub/a.pdf" }, "a-images.pdf"),
    "dir/sub/a-images.pdf"
  );
});

test("formatFileSize picks the right unit and rejects nonsense", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(1024), "1.0 KB");
  assert.equal(formatFileSize(1024 * 1024), "1.0 MB");
  assert.equal(formatFileSize(1024 * 1024 * 1024), "1.00 GB");
  assert.equal(formatFileSize(-1), "");
  assert.equal(formatFileSize(NaN), "");
  assert.equal(formatFileSize(Infinity), "");
});

test("formatHms renders zero-padded HH:MM:SS", () => {
  assert.equal(formatHms(0), "00:00:00");
  assert.equal(formatHms(1500), "00:00:01");
  assert.equal(formatHms(60_000), "00:01:00");
  assert.equal(formatHms(3_600_000), "01:00:00");
  assert.equal(formatHms(3_661_000), "01:01:01");
  assert.equal(formatHms(-1), "00:00:00");
});

test("formatDuration scales between seconds, minutes, hours", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(900), "1s");
  assert.equal(formatDuration(59_000), "59s");
  assert.equal(formatDuration(60_000), "1m 0s");
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatDuration(3_600_000), "1h 0m 0s");
  assert.equal(formatDuration(3_725_000), "1h 2m 5s");
});

test("calculateCrc32 matches well-known reference values", () => {
  const encoder = new TextEncoder();
  assert.equal(calculateCrc32(new Uint8Array(0)), 0);
  assert.equal(calculateCrc32(encoder.encode("123456789")), 0xcbf43926);
  assert.equal(calculateCrc32(encoder.encode("hello")), 0x3610a686);
});

test("getZipDateTime encodes DOS time/date", () => {
  const date = new Date(2024, 4, 14, 12, 30, 22);
  const { time, date: zipDate } = getZipDateTime(date);
  assert.equal(time, (12 << 11) | (30 << 5) | (22 >> 1));
  assert.equal(zipDate, ((2024 - 1980) << 9) | ((4 + 1) << 5) | 14);
  const old = getZipDateTime(new Date(1970, 0, 1));
  assert.equal(old.date, (0 << 9) | (1 << 5) | 1);
});

test("normalizeZipPath strips leading slashes, dots and backslashes", () => {
  assert.equal(normalizeZipPath("/foo/bar.pdf"), "foo/bar.pdf");
  assert.equal(normalizeZipPath("foo\\bar.pdf"), "foo/bar.pdf");
  assert.equal(normalizeZipPath("./foo/../bar.pdf"), "foo/bar.pdf");
  assert.equal(normalizeZipPath("", "fallback.pdf"), "fallback.pdf");
  assert.equal(normalizeZipPath(null, null), "converted.pdf");
});

test("makeUniqueZipPaths disambiguates duplicates", () => {
  const entries = makeUniqueZipPaths([
    { path: "a.pdf", name: "a.pdf" },
    { path: "a.pdf", name: "a.pdf" },
    { path: "dir/a.pdf", name: "a.pdf" },
    { path: "dir/a.pdf", name: "a.pdf" },
    { path: "dir/a.pdf", name: "a.pdf" },
  ]);
  assert.deepEqual(
    entries.map((e) => e.path),
    ["a.pdf", "a (2).pdf", "dir/a.pdf", "dir/a (2).pdf", "dir/a (3).pdf"]
  );
});

test("createLocalFileHeader / createCentralDirectoryHeader produce correct ZIP signatures", () => {
  const nameBytes = new TextEncoder().encode("a.pdf");
  const local = createLocalFileHeader(nameBytes, 0xdeadbeef, 1024, 0, 0);
  const view = new DataView(local.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(26, true), nameBytes.length);
  assert.equal(view.getUint32(14, true), 0xdeadbeef);
  assert.equal(view.getUint32(18, true), 1024);

  const central = createCentralDirectoryHeader(nameBytes, 0xdeadbeef, 1024, 42, 0, 0);
  const cview = new DataView(central.buffer);
  assert.equal(cview.getUint32(0, true), 0x02014b50);
  assert.equal(cview.getUint32(42, true), 42);
});

test("createZipBlob assembles a valid PK archive end-of-central-directory", async () => {
  class FakeBlob {
    constructor(parts) {
      const chunks = parts.map((part) => {
        if (part instanceof Uint8Array) return part;
        if (part instanceof FakeBlob) return part._bytes;
        if (ArrayBuffer.isView(part)) return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
        return new TextEncoder().encode(String(part));
      });
      const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      this._bytes = merged;
      this.size = merged.byteLength;
    }
    async arrayBuffer() {
      return this._bytes.buffer.slice(
        this._bytes.byteOffset,
        this._bytes.byteOffset + this._bytes.byteLength
      );
    }
  }

  const entry = {
    path: "a.pdf",
    name: "a.pdf",
    blob: new FakeBlob([new Uint8Array([1, 2, 3, 4])]),
  };
  const zip = await createZipBlob([entry], FakeBlob);
  assert.ok(zip instanceof FakeBlob);
  const bytes = zip._bytes;
  const eocd = new DataView(bytes.buffer, bytes.byteLength - 22);
  assert.equal(eocd.getUint32(0, true), 0x06054b50);
  assert.equal(eocd.getUint16(8, true), 1);
  assert.equal(eocd.getUint16(10, true), 1);
});
