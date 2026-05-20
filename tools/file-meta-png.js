import {
  appendFileSection,
  el,
  formatAspectRatio,
  formatPixelCount,
  latin1ToString,
  makeGrid,
} from './file-meta-shared.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

const COLOR_TYPES = {
  0: '灰度',
  2: 'RGB',
  3: '调色板（索引）',
  4: '灰度 + Alpha',
  6: 'RGBA',
};

const SRGB_INTENTS = {
  0: '感知（Perceptual）',
  1: '相对色度（Relative colorimetric）',
  2: '饱和度（Saturation）',
  3: '绝对色度（Absolute colorimetric）',
};

export function match(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.png')) return true;
  return (file.type || '').toLowerCase() === 'image/png';
}

export async function inspect(file, container) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  if (buf.byteLength < 8) throw new Error('文件过短，不是有效的 PNG');
  for (let i = 0; i < 8; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) throw new Error('不是有效的 PNG（签名不匹配）');
  }

  const chunks = [];
  let offset = 8;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > view.byteLength) {
      chunks.push({ type, length, truncated: true, offset });
      break;
    }
    const data = new Uint8Array(buf, dataStart, length);
    chunks.push({ type, length, data, offset });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }

  const decoded = await decodeChunks(chunks);
  renderPngMeta(container, file, chunks, decoded);
}

async function decodeChunks(chunks) {
  const out = {
    ihdr: null,
    phys: null,
    time: null,
    gama: null,
    srgb: null,
    iccp: null,
    texts: [],
  };
  for (const chunk of chunks) {
    if (chunk.truncated) continue;
    switch (chunk.type) {
      case 'IHDR': out.ihdr = parseIHDR(chunk.data); break;
      case 'pHYs': out.phys = parsePHYs(chunk.data); break;
      case 'tIME': out.time = parseTIME(chunk.data); break;
      case 'gAMA': out.gama = parseGAMA(chunk.data); break;
      case 'sRGB': out.srgb = parseSRGB(chunk.data); break;
      case 'iCCP': out.iccp = await parseICCP(chunk.data); break;
      case 'tEXt': out.texts.push(parseTEXt(chunk.data)); break;
      case 'iTXt': out.texts.push(await parseITXt(chunk.data)); break;
      case 'zTXt': out.texts.push(await parseZTXt(chunk.data)); break;
    }
  }
  return out;
}

function parseIHDR(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    width: dv.getUint32(0),
    height: dv.getUint32(4),
    bitDepth: dv.getUint8(8),
    colorType: dv.getUint8(9),
    compression: dv.getUint8(10),
    filter: dv.getUint8(11),
    interlace: dv.getUint8(12),
  };
}

function parsePHYs(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ppuX: dv.getUint32(0),
    ppuY: dv.getUint32(4),
    unit: dv.getUint8(8),
  };
}

function parseTIME(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    year: dv.getUint16(0),
    month: dv.getUint8(2),
    day: dv.getUint8(3),
    hour: dv.getUint8(4),
    minute: dv.getUint8(5),
    second: dv.getUint8(6),
  };
}

function parseGAMA(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return dv.getUint32(0) / 100000;
}

function parseSRGB(data) {
  return data[0];
}

function findNullByte(data, start) {
  for (let i = start; i < data.length; i++) {
    if (data[i] === 0) return i;
  }
  return -1;
}

function parseTEXt(data) {
  const sep = findNullByte(data, 0);
  if (sep < 0) return { kind: 'tEXt', keyword: '', value: latin1ToString(data, 0, data.length) };
  return {
    kind: 'tEXt',
    keyword: latin1ToString(data, 0, sep),
    value: latin1ToString(data, sep + 1, data.length),
  };
}

async function parseZTXt(data) {
  const sep = findNullByte(data, 0);
  const keyword = sep < 0 ? '' : latin1ToString(data, 0, sep);
  const compMethod = sep >= 0 ? data[sep + 1] : 0;
  const payload = sep >= 0 ? data.subarray(sep + 2) : data;
  let value;
  try {
    const decompressed = await inflate(payload);
    value = new TextDecoder('latin1').decode(decompressed);
  } catch (err) {
    value = `[zTXt 解压失败：${err.message || err}]`;
  }
  return { kind: 'zTXt', keyword, value, compMethod };
}

async function parseITXt(data) {
  const k0 = findNullByte(data, 0);
  if (k0 < 0) return { kind: 'iTXt', keyword: '', value: '' };
  const keyword = latin1ToString(data, 0, k0);
  const compFlag = data[k0 + 1];
  const langStart = k0 + 3;
  const langEnd = findNullByte(data, langStart);
  const language = langEnd < 0 ? '' : latin1ToString(data, langStart, langEnd);
  const transStart = langEnd + 1;
  const transEnd = findNullByte(data, transStart);
  const translated = transEnd < 0 ? '' : new TextDecoder('utf-8').decode(data.subarray(transStart, transEnd));
  const textStart = transEnd + 1;
  let value;
  if (compFlag) {
    try {
      const decompressed = await inflate(data.subarray(textStart));
      value = new TextDecoder('utf-8').decode(decompressed);
    } catch (err) {
      value = `[iTXt 解压失败：${err.message || err}]`;
    }
  } else {
    value = new TextDecoder('utf-8').decode(data.subarray(textStart));
  }
  return { kind: 'iTXt', keyword, value, language, translated, compressed: Boolean(compFlag) };
}

async function parseICCP(data) {
  const sep = findNullByte(data, 0);
  if (sep < 0) return { name: '', size: 0 };
  const name = latin1ToString(data, 0, sep);
  const compressed = data.subarray(sep + 2);
  let size = compressed.length;
  try {
    const decompressed = await inflate(compressed);
    size = decompressed.length;
  } catch (_) { /* fall back to compressed size */ }
  return { name, size };
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持 DecompressionStream');
  }
  const stream = new Response(new Blob([bytes])).body
    .pipeThrough(new DecompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function formatPngTime(t) {
  if (!t) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)} UTC`;
}

function formatPHYs(p) {
  if (!p) return null;
  if (p.unit === 1) {
    const dpiX = p.ppuX * 0.0254;
    const dpiY = p.ppuY * 0.0254;
    return `${dpiX.toFixed(2)} × ${dpiY.toFixed(2)} DPI（每米 ${p.ppuX.toLocaleString()} × ${p.ppuY.toLocaleString()} 像素）`;
  }
  return `比例 ${p.ppuX} : ${p.ppuY}（单位未知）`;
}

function renderPngMeta(container, file, chunks, decoded) {
  container.innerHTML = '';
  appendFileSection(container, file);

  if (decoded.ihdr) {
    const h = decoded.ihdr;
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: '图像（IHDR）' }),
      makeGrid([
        ['尺寸', `${h.width} × ${h.height} 像素（宽高比 ${formatAspectRatio(h.width, h.height)}）`],
        ['总像素量', formatPixelCount(h.width, h.height)],
        ['位深', `${h.bitDepth} bit`],
        ['颜色类型', `${COLOR_TYPES[h.colorType] ?? '未知'}（colorType ${h.colorType}）`],
        ['压缩方式', h.compression === 0 ? 'Deflate（标准）' : `未知（${h.compression}）`],
        ['滤波方式', h.filter === 0 ? '自适应（标准）' : `未知（${h.filter}）`],
        ['隔行扫描', h.interlace === 0 ? '无' : h.interlace === 1 ? 'Adam7' : `未知（${h.interlace}）`],
      ]),
    ));
  }

  const colorBits = [];
  if (decoded.phys) colorBits.push(['物理像素密度', formatPHYs(decoded.phys)]);
  if (decoded.gama != null) colorBits.push(['Gamma', decoded.gama.toFixed(5)]);
  if (decoded.srgb != null) colorBits.push(['sRGB 渲染意图', `${SRGB_INTENTS[decoded.srgb] ?? '未知'}（${decoded.srgb}）`]);
  if (decoded.iccp) colorBits.push(['ICC 色彩配置', `${decoded.iccp.name || '（无名称）'} · ${decoded.iccp.size.toLocaleString()} B`]);
  if (decoded.time) colorBits.push(['PNG 内嵌修改时间', formatPngTime(decoded.time)]);
  if (colorBits.length) {
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: '色彩与时间' }),
      makeGrid(colorBits),
    ));
  }

  if (decoded.texts.length) {
    const rows = decoded.texts.map((t) => {
      const label = t.kind === 'iTXt' && t.language
        ? `${t.keyword}（${t.kind} · ${t.language}${t.compressed ? ' · 压缩' : ''}）`
        : `${t.keyword || '（空）'}（${t.kind}）`;
      return [label, t.value];
    });
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: '文本元数据' }),
      makeGrid(rows),
    ));
  }

  const table = el('table', { class: 'chunks-table' });
  table.appendChild(el('thead', null,
    el('tr', null,
      el('th', { text: '#' }),
      el('th', { text: 'Chunk' }),
      el('th', { text: '长度（字节）' }),
      el('th', { text: '偏移' }),
    ),
  ));
  const tbody = el('tbody');
  chunks.forEach((c, i) => {
    tbody.appendChild(el('tr', null,
      el('td', { class: 'num', text: String(i + 1) }),
      el('td', { class: 'mono', text: c.type + (c.truncated ? '（截断）' : '') }),
      el('td', { class: 'num', text: c.length.toLocaleString() }),
      el('td', { class: 'num mono', text: '0x' + c.offset.toString(16) }),
    ));
  });
  table.appendChild(tbody);
  container.appendChild(el('section', { class: 'meta-section' },
    el('h2', { text: `所有 Chunk（共 ${chunks.length} 个）` }),
    table,
  ));
}
