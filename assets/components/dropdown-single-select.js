/**
 * 通用下拉单选：按钮展示当前项 + 面板中选一项带右侧勾选。
 * 选项、当前值、默认值均由调用方传入。
 * 样式见同目录 dropdown-single-select.css（须在 common.css 之后加载）。
 */
function toElement(host) {
  if (!host) return null;
  return typeof host === 'string' ? document.querySelector(host) : host;
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * @param {{
 *   host: Element|string,
 *   options: Array<{ value: string|number, label: string }>,
 *   value?: string|number,
 *   defaultValue?: string|number,
 *   title?: string,
 *   onChange?: (value: string|number) => void,
 * }} config
 * @returns {{ getValue: () => string|number, setValue: (v: string|number) => void, getTrigger: () => HTMLButtonElement|null, destroy: () => void }}
 */
function mount(config) {
  const host = toElement(config.host);
  if (!host) throw new Error('DropdownSingleSelect: host not found');

  const options = config.options || [];
  const raw =
    config.value != null ? config.value : config.defaultValue != null ? config.defaultValue : undefined;
  let value;
  if (options.length) {
    const found = raw != null ? options.find((o) => valuesEqual(o.value, raw)) : null;
    value = found ? found.value : options[0].value;
  } else {
    value = raw;
  }

  const onChange = typeof config.onChange === 'function' ? config.onChange : function () {};
  const title = config.title || '';

  while (host.firstChild) host.removeChild(host.firstChild);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dropdown-single__trigger';
  if (title) trigger.title = title;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'dropdown-single__label';

  const chevron = document.createElement('span');
  chevron.className = 'dropdown-single__chevron icon-chevron-down';
  chevron.setAttribute('aria-hidden', 'true');

  trigger.appendChild(labelSpan);
  trigger.appendChild(chevron);
  host.appendChild(trigger);

  const menu = document.createElement('div');
  menu.className = 'dropdown-single__panel';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  const optionRows = options.map((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dropdown-single__option';
    b.setAttribute('role', 'menuitemradio');
    b.dataset.value = String(opt.value);

    const labelEl = document.createElement('span');
    labelEl.className = 'dropdown-single__option-label';
    labelEl.textContent = opt.label;
    b.appendChild(labelEl);

    const check = document.createElement('span');
    check.className = 'dropdown-single__check icon-menu-check';
    check.setAttribute('aria-hidden', 'true');
    b.appendChild(check);

    b.addEventListener('click', () => {
      setValue(opt.value);
      closeMenu();
      onChange(opt.value);
    });
    menu.appendChild(b);
    return { row: b, opt };
  });

  document.body.appendChild(menu);

  function labelFor(v) {
    const o = options.find((x) => valuesEqual(x.value, v));
    return o ? o.label : '';
  }

  function syncCheckedState() {
    optionRows.forEach(({ row, opt }) => {
      row.setAttribute('aria-checked', valuesEqual(opt.value, value) ? 'true' : 'false');
    });
  }

  function updateLabel() {
    labelSpan.textContent = labelFor(value);
  }

  function positionMenu() {
    const rect = trigger.getBoundingClientRect();
    menu.style.minWidth = `${Math.round(rect.width)}px`;
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;
  }

  function openMenu() {
    syncCheckedState();
    menu.hidden = false;
    positionMenu();
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
  }

  function closeMenu() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', positionMenu);
    window.removeEventListener('scroll', positionMenu, true);
  }

  function onDocDown(e) {
    if (menu.contains(e.target) || trigger.contains(e.target)) return;
    closeMenu();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      closeMenu();
      trigger.focus();
    }
  }

  trigger.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  function setValue(v) {
    if (!options.some((o) => valuesEqual(o.value, v))) return;
    value = v;
    updateLabel();
    syncCheckedState();
  }

  function getValue() {
    return value;
  }

  setValue(value);

  function destroy() {
    closeMenu();
    if (menu.parentNode) menu.parentNode.removeChild(menu);
    while (host.firstChild) host.removeChild(host.firstChild);
  }

  return { getValue, setValue, getTrigger: () => trigger, destroy };
}

export { mount };
