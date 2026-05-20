export function isPdfFile(file) {
  return Boolean(file) && (
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name || '')
  );
}

export function makeOutputName(fileName) {
  const baseName = (fileName || 'converted').replace(/\.pdf$/i, '');
  return `${baseName}-images.pdf`;
}

export function getDisplayPathSeparator(platform) {
  return /Win/i.test(platform || '') ? '\\' : '/';
}

export function getPdfDisplayName(file, fileEntry, platform) {
  const fileName = (file && file.name) || '未命名 PDF';
  const relativePath = fileEntry && fileEntry.relativePath;
  if (!relativePath || relativePath === fileName) return fileName;
  return relativePath.split('/').filter(Boolean).join(getDisplayPathSeparator(platform));
}

export function getPdfOutputPath(file, fileEntry, outputName) {
  const fileName = file && file.name;
  const relativePath = fileEntry && fileEntry.relativePath;
  if (!relativePath || relativePath === fileName) return outputName;
  const parts = relativePath.split('/').filter(Boolean);
  parts[parts.length - 1] = outputName;
  return parts.join('/');
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatHms(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${minutes}m ${seconds}s`;
  return `${hours}h ${remainingMinutes}m ${seconds}s`;
}

const ZIP_MAX_32BIT_SIZE = 0xffffffff;
let crc32Table = null;

function getCrc32Table() {
  if (crc32Table) return crc32Table;
  crc32Table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crc32Table[index] = value >>> 0;
  }
  return crc32Table;
}

export function calculateCrc32(buffer) {
  const table = getCrc32Table();
  const bytes = new Uint8Array(buffer);
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function getZipDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function normalizeZipPath(value, fallbackName) {
  const path = String(value || fallbackName || 'converted.pdf')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return path || fallbackName || 'converted.pdf';
}

export function makeUniqueZipPaths(entries) {
  const seen = new Map();
  return entries.map((entry) => {
    const normalizedPath = normalizeZipPath(entry.path, entry.name);
    const count = seen.get(normalizedPath) || 0;
    seen.set(normalizedPath, count + 1);
    if (!count) return Object.assign({}, entry, { path: normalizedPath });

    const slashIndex = normalizedPath.lastIndexOf('/');
    const directory = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : '';
    const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';
    return Object.assign({}, entry, {
      path: `${directory}${baseName} (${count + 1})${extension}`,
    });
  });
}

export function createLocalFileHeader(nameBytes, crc32, size, zipTime, zipDate) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, zipTime, true);
  view.setUint16(12, zipDate, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

export function createCentralDirectoryHeader(nameBytes, crc32, size, offset, zipTime, zipDate) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, zipTime, true);
  view.setUint16(14, zipDate, true);
  view.setUint32(16, crc32, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

export async function createZipBlob(entries, BlobCtor = Blob) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const zipEntries = makeUniqueZipPaths(entries);
  let offset = 0;

  for (const entry of zipEntries) {
    const blob = entry.blob;
    if (blob.size > ZIP_MAX_32BIT_SIZE || offset > ZIP_MAX_32BIT_SIZE) {
      throw new Error('ZIP 文件过大，浏览器端暂不支持超过 4GB 的打包。');
    }

    const nameBytes = encoder.encode(entry.path);
    const { time, date } = getZipDateTime();
    const crc32 = calculateCrc32(await blob.arrayBuffer());
    const localHeader = createLocalFileHeader(nameBytes, crc32, blob.size, time, date);
    const centralHeader = createCentralDirectoryHeader(nameBytes, crc32, blob.size, offset, time, date);

    localParts.push(localHeader, blob);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + blob.size;
  }

  const centralDirectorySize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, zipEntries.length, true);
  view.setUint16(10, zipEntries.length, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, offset, true);
  view.setUint16(20, 0, true);

  return new BlobCtor([...localParts, ...centralParts, end], { type: 'application/zip' });
}
