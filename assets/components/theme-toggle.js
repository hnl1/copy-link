// 注意：FOUC 预防（首屏同步设置 data-theme）由 assets/theme-init.js 负责，
// 那是一段必须阻塞执行的 classic 脚本。本模块只负责切换按钮 UI 与之后的状态变更。

const STORAGE_KEY = 'f-tools-theme';
const TITLES = {
  auto: '跟随系统（点击切到亮色）',
  light: '亮色（点击切到暗色）',
  dark: '暗色（点击切到跟随系统）',
};
const PREF_TO_ICON = { auto: 'icon-computer', light: 'icon-sun', dark: 'icon-moon' };

export function getPref() {
  let p = null;
  try { p = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  return p === 'light' || p === 'dark' ? p : 'auto';
}

export function applyThemeAttrs(pref) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const actual = pref === 'auto' ? (mql.matches ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', actual);
  document.documentElement.setAttribute('data-theme-pref', pref);
  return actual;
}

export function setPref(pref) {
  try {
    if (pref === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch (e) {}
  applyThemeAttrs(pref);
}

export function create() {
  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.className = 'icon-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', '切换主题');

  function refresh() {
    const pref = getPref();
    btn.dataset.pref = pref;
    btn.title = TITLES[pref];
    for (const cls of Object.values(PREF_TO_ICON)) btn.classList.remove(cls);
    btn.classList.add(PREF_TO_ICON[pref]);
  }

  refresh();

  btn.addEventListener('click', () => {
    const cur = getPref();
    setPref(cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto');
    refresh();
  });

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    if (getPref() === 'auto') {
      applyThemeAttrs('auto');
      refresh();
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    applyThemeAttrs(getPref());
    refresh();
  });

  return btn;
}
