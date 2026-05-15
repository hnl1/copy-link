import { create as createThemeToggle } from '../theme-toggle.js';
import { createClearButton } from '../file-input/index.js';

function createHomeLink(href, label) {
  href = href || '../index.html';
  label = label || '主页';
  const a = document.createElement('a');
  a.className = 'back-link icon-btn icon-home';
  a.href = href;
  a.setAttribute('aria-label', label);
  a.title = label;
  return a;
}

export function mount(options) {
  options = options || {};
  const title = options.title || '';
  const controls = Array.isArray(options.controls) ? options.controls : [];
  const back = options.back || '../index.html';
  const includeTheme = options.themeToggle !== false;

  if (!document.body) {
    throw new Error('ToolHeader.mount must run after <body> is available');
  }

  const header = document.createElement('header');
  header.className = 'tool-header';

  header.appendChild(createHomeLink(back, '主页'));

  let themeBtn = null;
  if (includeTheme) {
    themeBtn = createThemeToggle();
    header.appendChild(themeBtn);
  }

  const h1 = document.createElement('h1');
  h1.textContent = title;
  header.appendChild(h1);

  const actions = document.createElement('div');
  actions.className = 'header-actions';
  controls.forEach((el) => { if (el) actions.appendChild(el); });

  let clearBtn = null;
  if (options.clearButton) {
    clearBtn = createClearButton(options.clearButton);
    actions.appendChild(clearBtn.el);
  }

  if (actions.childNodes.length) header.appendChild(actions);

  document.body.insertBefore(header, document.body.firstChild);

  return { headerEl: header, controlsEl: actions, themeBtn, clearBtn };
}
