export const MAP = {
  'index.html': '🧰',
  'tools/clipboard.html': '🔗',
  'tools/video-compare.html': '🎬',
  'tools/image-compare.html': '🖼️',
  'tools/pdf-compare.html': '📄',
  'tools/pdf-to-image/index.html': '🧾',
  'tools/file-meta/index.html': '🏷️',
  'tools/vmess-to-clash/index.html': '🔀',
  'tools/text-diff/index.html': '🆚',
  'tools/icons.html': '🎨',
};

export function buildFaviconHref(emoji) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function resolvePageKey(pathname) {
  const normalized = (pathname || '').replace(/\/+$/, '');
  const candidates = Object.keys(MAP).sort((a, b) => b.length - a.length);
  for (const key of candidates) {
    if (normalized.endsWith('/' + key) || normalized.endsWith(key)) return key;
  }
  if (normalized === '' || (pathname || '').endsWith('/')) return 'index.html';
  return null;
}

export function setFavicon(emoji) {
  if (!emoji || typeof document === 'undefined') return;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    (document.head || document.documentElement).appendChild(link);
  }
  link.href = buildFaviconHref(emoji);
}

export function applyCurrent() {
  if (typeof location === 'undefined') return;
  const key = resolvePageKey(location.pathname);
  if (key && MAP[key]) setFavicon(MAP[key]);
}

if (typeof document !== 'undefined') applyCurrent();
