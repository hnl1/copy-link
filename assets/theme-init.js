// 同步设置 data-theme 属性，避免暗色模式下的 FOUC。
// 这是项目里唯一的非 module 脚本——必须在首次渲染前同步执行，而 type="module" 的脚本都是 defer 的。
(function () {
  let pref = null;
  try {
    pref = localStorage.getItem('f-tools-theme');
  } catch (e) {}
  if (pref !== 'light' && pref !== 'dark') pref = 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
})();
