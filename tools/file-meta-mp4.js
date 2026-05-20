import {
  appendFileSection,
  el,
  formatAspectRatio,
  formatDuration,
  formatPixelCount,
  makeGrid,
  readAsciiView,
} from './file-meta-shared.js';

export function match(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.mp4')) return true;
  return (file.type || '').toLowerCase() === 'video/mp4';
}

export async function inspect(file, container) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const boxes = readMp4Boxes(view, 0, view.byteLength);
  const ftyp = boxes.find((box) => box.type === 'ftyp');
  if (!ftyp) throw new Error('不是有效的 MP4（缺少 ftyp box）');

  const moov = boxes.find((box) => box.type === 'moov');
  const parsed = {
    ftyp: parseFtyp(view, ftyp),
    movie: moov ? parseMoov(view, moov) : null,
  };
  renderMp4Meta(container, file, boxes, parsed);
}

function readMp4Boxes(view, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const boxStart = offset;
    let size = view.getUint32(offset);
    const type = readAsciiView(view, offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) {
        boxes.push({ type, size: end - boxStart, offset: boxStart, end, dataStart: end, truncated: true });
        break;
      }
      size = readUint64(view, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - boxStart;
    }
    const boxEnd = boxStart + size;
    if (size < headerSize || boxEnd > end) {
      boxes.push({
        type,
        size: Math.max(0, end - boxStart),
        offset: boxStart,
        end,
        dataStart: Math.min(end, boxStart + headerSize),
        truncated: true,
      });
      break;
    }
    boxes.push({ type, size, offset: boxStart, end: boxEnd, dataStart: boxStart + headerSize });
    offset = boxEnd;
  }
  return boxes;
}

function readMp4ChildBoxes(view, box) {
  return readMp4Boxes(view, box.dataStart, box.end);
}

function findMp4Child(view, box, type) {
  return readMp4ChildBoxes(view, box).find((child) => child.type === type) || null;
}

function parseFtyp(view, box) {
  const brands = [];
  for (let offset = box.dataStart + 8; offset + 4 <= box.end; offset += 4) {
    brands.push(readAsciiView(view, offset, offset + 4));
  }
  return {
    majorBrand: readAsciiView(view, box.dataStart, box.dataStart + 4),
    minorVersion: view.getUint32(box.dataStart + 4),
    compatibleBrands: brands,
  };
}

function parseMoov(view, moov) {
  const children = readMp4ChildBoxes(view, moov);
  const mvhd = children.find((box) => box.type === 'mvhd');
  const tracks = children
    .filter((box) => box.type === 'trak')
    .map((trak) => parseTrak(view, trak))
    .filter(Boolean);
  return {
    mvhd: mvhd ? parseMvhd(view, mvhd) : null,
    tracks,
  };
}

function parseMvhd(view, box) {
  const p = box.dataStart;
  const version = view.getUint8(p);
  if (version === 1) {
    const created = readMp4Time(view, p + 4, true);
    const modified = readMp4Time(view, p + 12, true);
    const timescale = view.getUint32(p + 20);
    const duration = readUint64(view, p + 24);
    return { version, created, modified, timescale, duration };
  }
  const created = readMp4Time(view, p + 4, false);
  const modified = readMp4Time(view, p + 8, false);
  const timescale = view.getUint32(p + 12);
  const duration = view.getUint32(p + 16);
  return { version, created, modified, timescale, duration };
}

function parseTrak(view, trak) {
  const tkhd = findMp4Child(view, trak, 'tkhd');
  const mdia = findMp4Child(view, trak, 'mdia');
  const mdhd = mdia ? findMp4Child(view, mdia, 'mdhd') : null;
  const hdlr = mdia ? findMp4Child(view, mdia, 'hdlr') : null;
  const stsd = findNestedMp4Child(view, mdia, ['minf', 'stbl', 'stsd']);
  return {
    tkhd: tkhd ? parseTkhd(view, tkhd) : null,
    mdhd: mdhd ? parseMdhd(view, mdhd) : null,
    hdlr: hdlr ? parseHdlr(view, hdlr) : null,
    codecs: stsd ? parseStsd(view, stsd) : [],
  };
}

function findNestedMp4Child(view, box, path) {
  let current = box;
  for (const type of path) {
    if (!current) return null;
    current = findMp4Child(view, current, type);
  }
  return current;
}

function parseTkhd(view, box) {
  const p = box.dataStart;
  const version = view.getUint8(p);
  const flags = (view.getUint8(p + 1) << 16) | (view.getUint8(p + 2) << 8) | view.getUint8(p + 3);
  const trackIdOffset = version === 1 ? p + 20 : p + 12;
  const durationOffset = version === 1 ? p + 32 : p + 20;
  const duration = version === 1 ? readUint64(view, durationOffset) : view.getUint32(durationOffset);
  const width = view.getUint32(box.end - 8) / 65536;
  const height = view.getUint32(box.end - 4) / 65536;
  return {
    version,
    flags,
    trackId: view.getUint32(trackIdOffset),
    duration,
    width,
    height,
  };
}

function parseMdhd(view, box) {
  const p = box.dataStart;
  const version = view.getUint8(p);
  if (version === 1) {
    const timescale = view.getUint32(p + 20);
    const duration = readUint64(view, p + 24);
    return { version, timescale, duration };
  }
  const timescale = view.getUint32(p + 12);
  const duration = view.getUint32(p + 16);
  return { version, timescale, duration };
}

function parseHdlr(view, box) {
  const handlerType = readAsciiView(view, box.dataStart + 8, box.dataStart + 12);
  const nameStart = box.dataStart + 24;
  const name = nameStart < box.end ? readNullTerminatedUtf8(view, nameStart, box.end) : '';
  return { handlerType, name };
}

function parseStsd(view, box) {
  const codecs = [];
  let offset = box.dataStart + 8;
  const count = view.getUint32(box.dataStart + 4);
  for (let i = 0; i < count && offset + 8 <= box.end; i++) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > box.end) break;
    codecs.push(readAsciiView(view, offset + 4, offset + 8));
    offset += size;
  }
  return codecs;
}

function readUint64(view, offset) {
  return view.getUint32(offset) * 4294967296 + view.getUint32(offset + 4);
}

function readMp4Time(view, offset, is64Bit) {
  const seconds = is64Bit ? readUint64(view, offset) : view.getUint32(offset);
  if (!seconds) return null;
  return new Date((seconds - 2082844800) * 1000);
}

function readNullTerminatedUtf8(view, start, end) {
  let stop = start;
  while (stop < end && view.getUint8(stop) !== 0) stop++;
  return new TextDecoder('utf-8').decode(new Uint8Array(view.buffer, view.byteOffset + start, stop - start));
}

function formatMp4Date(date) {
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatHandlerType(handlerType) {
  const names = {
    vide: '视频',
    soun: '音频',
    text: '文本',
    sbtl: '字幕',
    subp: '字幕',
    meta: '元数据',
  };
  return names[handlerType] ? `${names[handlerType]}（${handlerType}）` : handlerType;
}

function renderMp4Meta(container, file, boxes, parsed) {
  container.innerHTML = '';
  appendFileSection(container, file);

  container.appendChild(el('section', { class: 'meta-section' },
    el('h2', { text: '容器（ftyp）' }),
    makeGrid([
      ['Major brand', parsed.ftyp.majorBrand],
      ['Minor version', String(parsed.ftyp.minorVersion)],
      ['Compatible brands', parsed.ftyp.compatibleBrands.join(', ')],
    ]),
  ));

  if (parsed.movie?.mvhd) {
    const mvhd = parsed.movie.mvhd;
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: '影片（mvhd）' }),
      makeGrid([
        ['时长', formatDuration(mvhd.duration, mvhd.timescale)],
        ['Timescale', String(mvhd.timescale)],
        ['创建时间', formatMp4Date(mvhd.created)],
        ['修改时间', formatMp4Date(mvhd.modified)],
        ['Track 数量', String(parsed.movie.tracks.length)],
      ]),
    ));
  }

  if (parsed.movie?.tracks.length) {
    const table = el('table', { class: 'chunks-table' });
    table.appendChild(el('thead', null,
      el('tr', null,
        el('th', { text: '#' }),
        el('th', { text: '类型' }),
        el('th', { text: 'Track ID' }),
        el('th', { text: '时长' }),
        el('th', { text: '尺寸' }),
        el('th', { text: '总像素量' }),
        el('th', { text: 'Codec' }),
        el('th', { text: '名称' }),
      ),
    ));
    const tbody = el('tbody');
    parsed.movie.tracks.forEach((track, i) => {
      const width = track.tkhd?.width || 0;
      const height = track.tkhd?.height || 0;
      const size = width && height
        ? `${Math.round(width)} × ${Math.round(height)}（宽高比 ${formatAspectRatio(Math.round(width), Math.round(height))}）`
        : '—';
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', { text: formatHandlerType(track.hdlr?.handlerType || '未知') }),
        el('td', { class: 'num', text: track.tkhd?.trackId ? String(track.tkhd.trackId) : '—' }),
        el('td', { text: formatDuration(track.mdhd?.duration ?? track.tkhd?.duration, track.mdhd?.timescale ?? parsed.movie.mvhd?.timescale) }),
        el('td', { text: size }),
        el('td', { text: width && height ? formatPixelCount(width, height) : '—' }),
        el('td', { class: 'mono', text: track.codecs.length ? track.codecs.join(', ') : '—' }),
        el('td', { text: track.hdlr?.name || '—' }),
      ));
    });
    table.appendChild(tbody);
    container.appendChild(el('section', { class: 'meta-section' },
      el('h2', { text: `Tracks（共 ${parsed.movie.tracks.length} 个）` }),
      table,
    ));
  }

  const table = el('table', { class: 'chunks-table' });
  table.appendChild(el('thead', null,
    el('tr', null,
      el('th', { text: '#' }),
      el('th', { text: 'Box' }),
      el('th', { text: '大小（字节）' }),
      el('th', { text: '偏移' }),
    ),
  ));
  const tbody = el('tbody');
  boxes.forEach((box, i) => {
    tbody.appendChild(el('tr', null,
      el('td', { class: 'num', text: String(i + 1) }),
      el('td', { class: 'mono', text: box.type + (box.truncated ? '（截断）' : '') }),
      el('td', { class: 'num', text: box.size.toLocaleString() }),
      el('td', { class: 'num mono', text: '0x' + box.offset.toString(16) }),
    ));
  });
  table.appendChild(tbody);
  container.appendChild(el('section', { class: 'meta-section' },
    el('h2', { text: `顶层 Box（共 ${boxes.length} 个）` }),
    table,
  ));
}
