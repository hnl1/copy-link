export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function makeGrid(rows) {
  const dl = el('dl', { class: 'meta-grid' });
  for (const [k, v] of rows) {
    if (v == null || v === '') continue;
    dl.appendChild(el('dt', { text: k }));
    dl.appendChild(el('dd', { text: v }));
  }
  return dl;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}（${n.toLocaleString()} B）`;
}

export function formatDateLocal(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function formatAspectRatio(width, height) {
  if (!width || !height) return '—';
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.round(width), Math.round(height));
  const ratio = `${width / divisor}:${height / divisor}`;
  if (ratio === '3:7') return `${ratio} / 9:21`;
  return ratio === '7:3' ? `${ratio} / 21:9` : ratio;
}

export function formatPixelCount(width, height) {
  if (!width || !height) return '—';
  const pixels = Math.round(width) * Math.round(height);
  const megapixels = pixels / 1000000;
  return `${pixels.toLocaleString()} 像素（${megapixels.toFixed(megapixels >= 10 ? 1 : 2)} MP）`;
}

export function formatDuration(duration, timescale) {
  if (!duration || !timescale) return '—';
  const seconds = duration / timescale;
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const clock = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  return `${clock}${ms ? `.${String(ms).padStart(3, '0')}` : ''}（${seconds.toFixed(3)} 秒）`;
}

export function readAsciiView(view, start, end) {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(view.getUint8(i));
  return out;
}

export function readAsciiBytes(data, start, end) {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(data[i]);
  return out;
}

export function latin1ToString(data, start, end) {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(data[i]);
  return s;
}

export function appendFileSection(container, file) {
  container.appendChild(el('section', { class: 'meta-section' },
    el('h2', { text: '文件' }),
    makeGrid([
      ['大小', formatBytes(file.size)],
      ['MIME 类型', file.type || '（浏览器未识别）'],
      ['修改时间', file.lastModified ? formatDateLocal(file.lastModified) : null],
    ]),
  ));
}
