import {
  appendFileSection,
  el,
  formatAspectRatio,
  formatPixelCount,
  latin1ToString,
  makeGrid,
  readAsciiBytes,
} from './shared.js';

const JPEG_SOI = [0xFF, 0xD8];
const JPEG_SOFS = new Set([
  0xC0, 0xC1, 0xC2, 0xC3,
  0xC5, 0xC6, 0xC7,
  0xC9, 0xCA, 0xCB,
  0xCD, 0xCE, 0xCF,
]);

const JPEG_MARKER_NAMES = {
  0xC0: 'SOF0',
  0xC1: 'SOF1',
  0xC2: 'SOF2',
  0xC3: 'SOF3',
  0xC4: 'DHT',
  0xC5: 'SOF5',
  0xC6: 'SOF6',
  0xC7: 'SOF7',
  0xC8: 'JPG',
  0xC9: 'SOF9',
  0xCA: 'SOF10',
  0xCB: 'SOF11',
  0xCC: 'DAC',
  0xCD: 'SOF13',
  0xCE: 'SOF14',
  0xCF: 'SOF15',
  0xD0: 'RST0',
  0xD1: 'RST1',
  0xD2: 'RST2',
  0xD3: 'RST3',
  0xD4: 'RST4',
  0xD5: 'RST5',
  0xD6: 'RST6',
  0xD7: 'RST7',
  0xD8: 'SOI',
  0xD9: 'EOI',
  0xDA: 'SOS',
  0xDB: 'DQT',
  0xDD: 'DRI',
  0xE0: 'APP0',
  0xE1: 'APP1',
  0xE2: 'APP2',
  0xE3: 'APP3',
  0xE4: 'APP4',
  0xE5: 'APP5',
  0xE6: 'APP6',
  0xE7: 'APP7',
  0xE8: 'APP8',
  0xE9: 'APP9',
  0xEA: 'APP10',
  0xEB: 'APP11',
  0xEC: 'APP12',
  0xED: 'APP13',
  0xEE: 'APP14',
  0xEF: 'APP15',
  0xFE: 'COM',
};

const JPEG_SOF_KINDS = {
  0xC0: 'Baseline DCT（SOF0）',
  0xC1: 'Extended sequential DCT（SOF1）',
  0xC2: 'Progressive DCT（SOF2）',
  0xC3: 'Lossless（SOF3）',
  0xC5: 'Differential sequential DCT（SOF5）',
  0xC6: 'Differential progressive DCT（SOF6）',
  0xC7: 'Differential lossless（SOF7）',
  0xC9: 'Extended sequential DCT, arithmetic（SOF9）',
  0xCA: 'Progressive DCT, arithmetic（SOF10）',
  0xCB: 'Lossless, arithmetic（SOF11）',
  0xCD: 'Differential sequential DCT, arithmetic（SOF13）',
  0xCE: 'Differential progressive DCT, arithmetic（SOF14）',
  0xCF: 'Differential lossless, arithmetic（SOF15）',
};

const EXIF_ORIENTATION = {
  1: '正常（0°）',
  2: '水平翻转',
  3: '旋转 180°',
  4: '垂直翻转',
  5: '顺时针 90° 后水平翻转',
  6: '顺时针 90°',
  7: '逆时针 90° 后水平翻转',
  8: '逆时针 90°',
};

export function match(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return true;
  return (file.type || '').toLowerCase() === 'image/jpeg';
}

export async function inspect(file, container) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  if (buf.byteLength < 4) throw new Error('文件过短，不是有效的 JPEG');
  if (view.getUint8(0) !== JPEG_SOI[0] || view.getUint8(1) !== JPEG_SOI[1]) {
    throw new Error('不是有效的 JPEG（签名不匹配）');
  }

  const segments = readJpegSegments(view);
  const decoded = decodeJpegSegments(view, segments);
  renderJpegMeta(container, file, segments, decoded);
}

function readJpegSegments(view) {
  const segments = [];
  let offset = 2;
  while (offset + 1 < view.byteLength) {
    if (view.getUint8(offset) !== 0xFF) break;
    const markerStart = offset;
    offset += 1;
    while (offset < view.byteLength && view.getUint8(offset) === 0xFF) offset += 1;
    if (offset >= view.byteLength) break;
    const code = view.getUint8(offset);
    offset += 1;
    const name = JPEG_MARKER_NAMES[code] || `0xFF${code.toString(16).toUpperCase().padStart(2, '0')}`;

    if (code === 0xD9) {
      segments.push({ code, name, offset: markerStart, length: 0, dataStart: offset, truncated: false });
      break;
    }
    if (code === 0xD8 || code === 0x01 || (code >= 0xD0 && code <= 0xD7)) {
      segments.push({ code, name, offset: markerStart, length: 0, dataStart: offset, truncated: false });
      continue;
    }

    if (offset + 2 > view.byteLength) {
      segments.push({ code, name, offset: markerStart, length: 0, dataStart: offset, truncated: true });
      break;
    }
    const length = view.getUint16(offset);
    const dataStart = offset + 2;
    const dataEnd = dataStart + length - 2;
    if (length < 2 || dataEnd > view.byteLength) {
      segments.push({ code, name, offset: markerStart, length, dataStart, truncated: true });
      break;
    }
    segments.push({ code, name, offset: markerStart, length, dataStart, truncated: false });
    offset = dataEnd;
    if (code === 0xDA) break;
  }
  return segments;
}

function decodeJpegSegments(view, segments) {
  const out = {
    sof: null,
    jfif: null,
    exif: null,
    comments: [],
  };
  for (const segment of segments) {
    if (segment.truncated || !segment.length) continue;
    const dataLen = segment.length - 2;
    const data = new Uint8Array(view.buffer, view.byteOffset + segment.dataStart, dataLen);
    if (JPEG_SOFS.has(segment.code)) {
      out.sof = parseJpegSOF(segment.code, data);
      continue;
    }
    if (segment.code === 0xE0) {
      const jfif = parseJfif(data);
      if (jfif) out.jfif = jfif;
      continue;
    }
    if (segment.code === 0xE1) {
      const exif = parseExif(data);
      if (exif) out.exif = exif;
      continue;
    }
    if (segment.code === 0xFE) {
      out.comments.push(parseJpegComment(data));
    }
  }
  return out;
}

function parseJpegSOF(code, data) {
  if (data.length < 6) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const precision = dv.getUint8(0);
  const height = dv.getUint16(1);
  const width = dv.getUint16(3);
  const numComponents = dv.getUint8(5);
  const components = [];
  let compOffset = 6;
  for (let i = 0; i < numComponents && compOffset + 3 <= data.length; i++) {
    components.push({
      id: dv.getUint8(compOffset),
      sampling: dv.getUint8(compOffset + 1),
      quantTableId: dv.getUint8(compOffset + 2),
    });
    compOffset += 3;
  }
  return {
    code,
    kind: JPEG_SOF_KINDS[code] || nameForJpegMarker(code),
    precision,
    width,
    height,
    numComponents,
    components,
  };
}

function nameForJpegMarker(code) {
  return JPEG_MARKER_NAMES[code] || `0xFF${code.toString(16).toUpperCase().padStart(2, '0')}`;
}

function parseJfif(data) {
  if (data.length < 9) return null;
  const id = readAsciiBytes(data, 0, 5);
  if (id !== 'JFIF\0' && id !== 'JFXX\0') return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    identifier: id.startsWith('JFIF') ? 'JFIF' : 'JFXX',
    version: `${dv.getUint8(5)}.${String(dv.getUint8(6)).padStart(2, '0')}`,
    units: dv.getUint8(7),
    densityX: dv.getUint16(8),
    densityY: dv.getUint16(10),
    thumbnailSize: data.length >= 14 ? `${dv.getUint8(12)} × ${dv.getUint8(13)}` : null,
  };
}

function parseExif(data) {
  if (data.length < 14) return null;
  const id = readAsciiBytes(data, 0, 6);
  if (id !== 'Exif\0\0') return null;
  return parseTiffIfds(data, 6);
}

function parseTiffIfds(data, start) {
  if (start + 8 > data.length) return null;
  const byteOrder = readAsciiBytes(data, start, start + 2);
  const littleEndian = byteOrder === 'II';
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const dv = new DataView(data.buffer, data.byteOffset + start, data.byteLength - start);
  if (readTiffUint16(dv, 2, littleEndian) !== 42) return null;
  const ifd0Offset = readTiffUint32(dv, 4, littleEndian);
  const ifd0 = readTiffIfd(data, start, ifd0Offset, littleEndian);
  if (!ifd0) return { byteOrder, tags: new Map() };

  const tags = new Map(ifd0.tags);
  const exifPointer = ifd0.tags.get(0x8769);
  if (exifPointer != null) {
    const exifIfd = readTiffIfd(data, start, exifPointer, littleEndian);
    if (exifIfd) mergeTiffTags(tags, exifIfd.tags);
  }
  const gpsPointer = ifd0.tags.get(0x8825);
  if (gpsPointer != null) {
    const gpsIfd = readTiffIfd(data, start, gpsPointer, littleEndian);
    if (gpsIfd) mergeTiffTags(tags, gpsIfd.tags);
  }
  return { byteOrder, tags };
}

function mergeTiffTags(target, source) {
  for (const [tag, value] of source.entries()) {
    if (!target.has(tag)) target.set(tag, value);
  }
}

function readTiffIfd(data, tiffStart, ifdOffset, littleEndian) {
  const abs = tiffStart + ifdOffset;
  if (abs + 2 > data.length) return null;
  const dv = new DataView(data.buffer, data.byteOffset + abs, data.byteLength - abs);
  const count = readTiffUint16(dv, 0, littleEndian);
  const tags = new Map();
  let entryOffset = 2;
  for (let i = 0; i < count; i++) {
    if (entryOffset + 12 > dv.byteLength) break;
    const tag = readTiffUint16(dv, entryOffset, littleEndian);
    const type = readTiffUint16(dv, entryOffset + 2, littleEndian);
    const valueCount = readTiffUint32(dv, entryOffset + 4, littleEndian);
    const valueOrOffset = readTiffUint32(dv, entryOffset + 8, littleEndian);
    const value = readTiffTagValue(
      data,
      tiffStart,
      abs + entryOffset + 8,
      type,
      valueCount,
      valueOrOffset,
      littleEndian,
    );
    if (value != null) tags.set(tag, value);
    entryOffset += 12;
  }
  return { tags };
}

function readTiffTagValue(data, tiffStart, inlineOffset, type, count, valueOrOffset, littleEndian) {
  const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const size = (typeSizes[type] || 0) * count;
  if (!size) return null;
  const valueOffset = size <= 4 ? inlineOffset : tiffStart + valueOrOffset;
  const valueSize = size <= 4 ? 4 : size;
  if (valueOffset < 0 || valueOffset + valueSize > data.length) return null;
  const dv = new DataView(data.buffer, data.byteOffset + valueOffset, valueSize);

  switch (type) {
    case 1:
    case 6:
    case 7:
      return count === 1 ? data[valueOffset] : Array.from(data.subarray(valueOffset, valueOffset + count));
    case 2:
      return readAsciiBytes(data, valueOffset, valueOffset + count).replace(/\0+$/, '');
    case 3:
      return count === 1 ? readTiffUint16(dv, 0, littleEndian) : readTiffUint16Array(dv, 0, count, littleEndian);
    case 4:
    case 9:
      return count === 1 ? readTiffUint32(dv, 0, littleEndian) : readTiffUint32Array(dv, 0, count, littleEndian);
    case 5:
    case 10:
      return count === 1 ? readTiffRational(dv, 0, littleEndian) : readTiffRationalArray(dv, 0, count, littleEndian);
    default:
      return null;
  }
}

function readTiffUint16(dv, offset, littleEndian) {
  return dv.getUint16(offset, littleEndian);
}

function readTiffUint32(dv, offset, littleEndian) {
  return dv.getUint32(offset, littleEndian);
}

function readTiffUint16Array(dv, offset, count, littleEndian) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(readTiffUint16(dv, offset + i * 2, littleEndian));
  return out;
}

function readTiffUint32Array(dv, offset, count, littleEndian) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(readTiffUint32(dv, offset + i * 4, littleEndian));
  return out;
}

function readTiffRational(dv, offset, littleEndian) {
  const num = readTiffUint32(dv, offset, littleEndian);
  const den = readTiffUint32(dv, offset + 4, littleEndian);
  return den === 0 ? 0 : num / den;
}

function readTiffRationalArray(dv, offset, count, littleEndian) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(readTiffRational(dv, offset + i * 8, littleEndian));
  return out;
}

function parseJpegComment(data) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(data);
  } catch (_) {
    return latin1ToString(data, 0, data.length);
  }
}

function formatJfifDensity(jfif) {
  if (!jfif) return null;
  const { units, densityX, densityY } = jfif;
  if (units === 0) return `仅比例 ${densityX} : ${densityY}（无物理单位）`;
  if (units === 1) return `${densityX} × ${densityY} DPI`;
  if (units === 2) return `${densityX} × ${densityY} DPCM（约 ${(densityX * 2.54).toFixed(2)} × ${(densityY * 2.54).toFixed(2)} DPI）`;
  return `${densityX} × ${densityY}（单位 ${units}）`;
}

function formatExifResolution(tags) {
  const xRes = tags.get(0x011A);
  const yRes = tags.get(0x011B);
  const unit = tags.get(0x0128);
  if (xRes == null && yRes == null) return null;
  const x = xRes ?? yRes;
  const y = yRes ?? xRes;
  if (unit === 2) return `${formatRational(x)} × ${formatRational(y)} DPI`;
  if (unit === 3) {
    const dpiX = Number(formatRational(x)) * 2.54;
    const dpiY = Number(formatRational(y)) * 2.54;
    return `${formatRational(x)} × ${formatRational(y)} DPCM（约 ${dpiX.toFixed(2)} × ${dpiY.toFixed(2)} DPI）`;
  }
  if (unit === 1 || unit == null) return `${formatRational(x)} × ${formatRational(y)}（无单位）`;
  return `${formatRational(x)} × ${formatRational(y)}（单位 ${unit}）`;
}

function formatRational(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2).replace(/\.?0+$/, '');
  }
  return String(value);
}

function formatJpegComponents(sof) {
  if (!sof) return null;
  if (sof.numComponents === 1) return '灰度（1 分量）';
  if (sof.numComponents === 3) return 'YCbCr / RGB（3 分量）';
  if (sof.numComponents === 4) return 'CMYK（4 分量）';
  return `${sof.numComponents} 分量`;
}

function formatJpegSampling(sof) {
  if (!sof?.components.length) return null;
  return sof.components.map((c) => {
    const h = (c.sampling >> 4) & 0x0F;
    const v = c.sampling & 0x0F;
    return `分量 ${c.id}：${h}×${v} 采样，量化表 ${c.quantTableId}`;
  }).join('\n');
}

function formatDisplayDimensions(width, height, orientation) {
  if (!width || !height) return null;
  const swap = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
  const displayW = swap ? height : width;
  const displayH = swap ? width : height;
  if (!swap || displayW === width) return null;
  return `${displayW} × ${displayH} 像素（按 Orientation 校正后的显示尺寸）`;
}

function segmentDisplayName(segment, decoded) {
  if (segment.code === 0xE0 && decoded.jfif) return `${segment.name}（${decoded.jfif.identifier}）`;
  if (segment.code === 0xE1 && decoded.exif) return `${segment.name}（Exif）`;
  return segment.name;
}

function renderJpegMeta(container, file, segments, decoded) {
  container.innerHTML = '';
  appendFileSection(container, file);

  if (decoded.sof) {
    const sof = decoded.sof;
    const orientation = decoded.exif?.tags.get(0x0112);
    const imageRows = [
      ['尺寸', `${sof.width} × ${sof.height} 像素（宽高比 ${formatAspectRatio(sof.width, sof.height)}）`],
      ['总像素量', formatPixelCount(sof.width, sof.height)],
      ['编码类型', sof.kind],
      ['位深', `${sof.precision} bit`],
      ['颜色', formatJpegComponents(sof)],
      ['采样', formatJpegSampling(sof)],
    ];
    const displaySize = formatDisplayDimensions(sof.width, sof.height, orientation);
    if (displaySize) imageRows.push(['显示尺寸', displaySize]);
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: '图像（SOF）' }),
      makeGrid(imageRows),
    ));
  }

  const metaRows = [];
  if (decoded.jfif) {
    metaRows.push(['JFIF 版本', decoded.jfif.version]);
    metaRows.push(['JFIF 密度', formatJfifDensity(decoded.jfif)]);
    if (decoded.jfif.thumbnailSize && decoded.jfif.thumbnailSize !== '0 × 0') {
      metaRows.push(['JFIF 缩略图', decoded.jfif.thumbnailSize]);
    }
  }
  if (decoded.exif) {
    const tags = decoded.exif.tags;
    const exifResolution = formatExifResolution(tags);
    if (exifResolution) metaRows.push(['EXIF 分辨率', exifResolution]);
    const orient = tags.get(0x0112);
    if (orient != null) {
      metaRows.push(['方向（Orientation）', `${EXIF_ORIENTATION[orient] ?? '未知'}（${orient}）`]);
    }
    const make = tags.get(0x010F);
    const model = tags.get(0x0110);
    if (make || model) metaRows.push(['设备', [make, model].filter(Boolean).join(' ')]);
    const software = tags.get(0x0131);
    if (software) metaRows.push(['软件', software]);
    const dateTime = tags.get(0x0132) || tags.get(0x9003) || tags.get(0x9004);
    if (dateTime) metaRows.push(['拍摄/修改时间', dateTime]);
    const description = tags.get(0x010E);
    if (description) metaRows.push(['描述', description]);
  }
  if (metaRows.length) {
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: '元数据（JFIF / EXIF）' }),
      makeGrid(metaRows),
    ));
  }

  if (decoded.comments.length) {
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: '注释（COM）' }),
      makeGrid(decoded.comments.map((comment, i) => [`#${i + 1}`, comment])),
    ));
  }

  const table = el('table', { class: 'chunks-table' });
  table.appendChild(el('thead', null,
    el('tr', null,
      el('th', { text: '#' }),
      el('th', { text: 'Marker' }),
      el('th', { text: '长度（字节）' }),
      el('th', { text: '偏移' }),
    ),
  ));
  const tbody = el('tbody');
  segments.forEach((segment, i) => {
    const payloadLength = segment.length ? segment.length - 2 : 0;
    tbody.appendChild(el('tr', null,
      el('td', { class: 'num', text: String(i + 1) }),
      el('td', { class: 'mono', text: segmentDisplayName(segment, decoded) + (segment.truncated ? '（截断）' : '') }),
      el('td', { class: 'num', text: payloadLength.toLocaleString() }),
      el('td', { class: 'num mono', text: '0x' + segment.offset.toString(16) }),
    ));
  });
  table.appendChild(tbody);
  container.appendChild(el('section', { class: 'meta-section' },
    el('h2', { text: `所有 Marker（共 ${segments.length} 个）` }),
    table,
  ));
}
