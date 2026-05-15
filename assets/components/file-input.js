function toElement(value) {
  if (!value) return null;
  return typeof value === 'string' ? document.querySelector(value) : value;
}

async function getFileEntriesFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  return getFileEntriesFromDataTransfer(clipboardData);
}

function readEntryFile(entry) {
  return new Promise((resolve) => {
    entry.file((file) => resolve(file), () => resolve(null));
  });
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve) => {
    const entries = [];

    function readNextBatch() {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }

        entries.push(...batch);
        readNextBatch();
      }, () => resolve(entries));
    }

    readNextBatch();
  });
}

function normalizeRelativePath(value, fallbackName) {
  const path = String(value || fallbackName || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  return path || String(fallbackName || '');
}

function createFileEntry(file, sourcePath) {
  const relativePath = normalizeRelativePath(sourcePath || file.webkitRelativePath, file.name);
  const pathParts = relativePath.split('/').filter(Boolean);
  return {
    file,
    name: file.name || pathParts[pathParts.length - 1] || '未命名文件',
    relativePath,
    pathParts,
    sourcePath: sourcePath || file.webkitRelativePath || file.name || '',
  };
}

function createFileEntries(fileList) {
  return Array.from(fileList || []).map((file) => createFileEntry(file));
}

async function getFileEntriesFromEntry(entry) {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    return file ? [createFileEntry(file, entry.fullPath)] : [];
  }
  if (!entry.isDirectory) return [];

  const entries = await readAllDirectoryEntries(entry.createReader());
  const nestedFileEntries = await Promise.all(entries.map(getFileEntriesFromEntry));
  return nestedFileEntries.flat();
}

async function getFileEntriesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];

  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .filter((item) => item.kind === 'file' && typeof item.webkitGetAsEntry === 'function')
    .map((item) => item.webkitGetAsEntry())
    .filter(Boolean);

  if (!entries.length) return createFileEntries(dataTransfer.files);

  const fileEntries = (await Promise.all(entries.map(getFileEntriesFromEntry))).flat();
  return fileEntries.length ? fileEntries : createFileEntries(dataTransfer.files);
}

function buildFileTree(fileEntries) {
  const root = { type: 'directory', name: '', path: '', children: [] };

  for (const entry of fileEntries) {
    const parts = entry.pathParts.length ? entry.pathParts : [entry.name];
    let node = root;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      if (isFile) {
        node.children.push({
          type: 'file',
          name: part,
          path: currentPath,
          file: entry.file,
          entry,
        });
        continue;
      }

      let child = node.children.find((item) => item.type === 'directory' && item.name === part);
      if (!child) {
        child = { type: 'directory', name: part, path: currentPath, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }

  return root;
}

function isFileDrag(event) {
  return Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('Files');
}

function matchesAccept(file, accept) {
  if (!accept) return true;

  const fileName = file.name || '';
  const fileType = file.type || '';
  return accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token.startsWith('.')) return fileName.toLowerCase().endsWith(token);
      if (token.endsWith('/*')) return fileType.toLowerCase().startsWith(token.slice(0, -1));
      return fileType.toLowerCase() === token;
    });
}

function supportsDirectoryInput() {
  const probe = document.createElement('input');
  probe.type = 'file';
  return 'webkitdirectory' in probe;
}

function createDirectoryInput(input) {
  const directoryInput = document.createElement('input');
  directoryInput.type = 'file';
  directoryInput.className = input.className;
  directoryInput.accept = input.accept || '';
  directoryInput.multiple = true;
  directoryInput.tabIndex = -1;
  directoryInput.setAttribute('aria-hidden', 'true');
  directoryInput.setAttribute('webkitdirectory', '');
  directoryInput.setAttribute('directory', '');
  input.insertAdjacentElement('afterend', directoryInput);
  return directoryInput;
}

function spaceBeforeSubject(subject) {
  return /^[A-Za-z0-9]/.test(subject) ? ' ' : '';
}

function formatDropTitle(subject) {
  if (!subject) return '';
  const sp = spaceBeforeSubject(subject);
  return `拖入${sp}${subject}/文件夹，粘贴或选择资源`;
}

function formatChooseFileText(subject) {
  if (!subject) return '选择文件';
  return `选择${spaceBeforeSubject(subject)}${subject}`;
}

function createSplitTrigger(triggerButton, onMenuClick) {
  if (!triggerButton || triggerButton.closest('.file-input-split-trigger')) return null;

  const wrapper = document.createElement('span');
  wrapper.className = 'file-input-split-trigger';
  triggerButton.insertAdjacentElement('beforebegin', wrapper);
  wrapper.appendChild(triggerButton);

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'file-input-trigger-menu';
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', `${triggerButton.textContent.trim() || '添加文件'} 选项`);
  menuButton.addEventListener('click', onMenuClick);

  const chevron = document.createElement('span');
  chevron.className = 'file-input-trigger-menu__chevron icon-chevron-down';
  chevron.setAttribute('aria-hidden', 'true');
  menuButton.appendChild(chevron);

  wrapper.appendChild(menuButton);

  return menuButton;
}

function formatRejectedText(subject) {
  if (!subject) return '没有可用的文件，请检查文件类型。';
  const sp = spaceBeforeSubject(subject);
  return `没有可用的${sp}${subject}，请使用${sp}${subject}文件。`;
}

function bindFileInputDropZone(options) {
  const zone = toElement(options.zone);
  const input = toElement(options.input);
  const triggerElement = toElement(options.triggerElement || options.dropZone || options.button);
  const triggerButton = toElement(options.triggerButton);
  const status = toElement(options.status);
  const onFiles = options.onFiles;
  const accept = options.accept || (input && input.accept) || '';
  const multiple = options.multiple != null ? options.multiple : Boolean(input && input.multiple);
  const subject = options.subject || '';
  const allowDirectories = options.allowDirectories !== false && supportsDirectoryInput();

  if (!zone || !input || typeof onFiles !== 'function') {
    throw new Error('bindFileInputDropZone requires zone, input, and onFiles.');
  }

  const directoryInput = allowDirectories ? createDirectoryInput(input) : null;

  if (subject) {
    const titleEl = zone.querySelector('.file-drop-title');
    if (titleEl) titleEl.textContent = formatDropTitle(subject);
  }
  const sourceLabels = Object.assign({
    choose: '选择',
    folder: '选择文件夹',
    drop: '拖入',
    paste: '粘贴',
  }, options.sourceLabels || {});

  let hasItems = false;
  let triggerTooltipTimer = 0;
  let triggerTooltipEl = null;
  let pickerMenuEl = null;
  let triggerMenuButton = null;

  function getTriggerTooltipTarget() {
    return triggerButton && (triggerButton.closest('.file-input-split-trigger') || triggerButton);
  }

  function ensureTriggerTooltip() {
    if (triggerTooltipEl || !triggerButton || !subject) return triggerTooltipEl;
    triggerTooltipEl = document.createElement('div');
    triggerTooltipEl.className = 'file-input-trigger-tooltip';
    triggerTooltipEl.setAttribute('role', 'tooltip');
    triggerTooltipEl.textContent = formatDropTitle(subject);
    triggerTooltipEl.hidden = true;
    document.body.appendChild(triggerTooltipEl);
    return triggerTooltipEl;
  }

  function positionTriggerTooltip() {
    if (!triggerTooltipEl || !triggerButton) return;
    const rect = getTriggerTooltipTarget().getBoundingClientRect();
    triggerTooltipEl.style.left = `${rect.left + rect.width / 2}px`;
    triggerTooltipEl.style.top = `${rect.bottom + 8}px`;
  }

  function showTriggerTooltip() {
    if (!triggerButton || triggerButton.hidden) return;
    ensureTriggerTooltip();
    if (!triggerTooltipEl) return;
    positionTriggerTooltip();
    triggerTooltipEl.hidden = false;
    requestAnimationFrame(() => triggerTooltipEl.classList.add('is-visible'));
  }

  function scheduleTriggerTooltip() {
    clearTimeout(triggerTooltipTimer);
    triggerTooltipTimer = window.setTimeout(showTriggerTooltip, 250);
  }

  function hideTriggerTooltip() {
    clearTimeout(triggerTooltipTimer);
    if (!triggerTooltipEl) return;
    triggerTooltipEl.classList.remove('is-visible');
    triggerTooltipEl.hidden = true;
  }

  function setHasItems(value) {
    const next = Boolean(value);
    if (next === hasItems) return;
    hasItems = next;
    zone.hidden = hasItems;
    zone.classList.toggle('is-collapsed', hasItems);
    hideTriggerTooltip();
  }

  const statusId = status && status.id;

  if (!zone.hasAttribute('tabindex')) zone.setAttribute('tabindex', '0');
  if (!zone.hasAttribute('role')) zone.setAttribute('role', 'button');

  function setStatus(message, isError) {
    const hasMessage = Boolean(message);
    zone.classList.toggle('has-error', Boolean(isError));
    if (status) {
      status.textContent = message;
      status.hidden = !hasMessage;
    }
    if (statusId) {
      const describedBy = (zone.getAttribute('aria-describedby') || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const nextDescribedBy = hasMessage
        ? Array.from(new Set([...describedBy, statusId]))
        : describedBy.filter((id) => id !== statusId);
      if (nextDescribedBy.length) {
        zone.setAttribute('aria-describedby', nextDescribedBy.join(' '));
      } else {
        zone.removeAttribute('aria-describedby');
      }
    }
  }

  function setDragging(isDragging) {
    zone.classList.toggle('dragging', isDragging);
  }

  function getSourceLabel(source) {
    return sourceLabels[source] || source || sourceLabels.choose;
  }

  function acceptFileEntries(fileEntries, source, options = {}) {
    const incomingEntries = Array.from(fileEntries || []);
    const incoming = incomingEntries.map((entry) => entry.file);
    if (!incoming.length) return false;

    const acceptedEntries = incomingEntries.filter((entry) => matchesAccept(entry.file, accept));
    const entries = multiple ? acceptedEntries : acceptedEntries.slice(0, 1);
    const files = entries.map((entry) => entry.file);
    const sourceLabel = getSourceLabel(source);
    if (!files.length) {
      setStatus(formatRejectedText(subject), true);
      return false;
    }

    setStatus('', false);
    setHasItems(true);
    const result = onFiles(files, {
      source,
      sourceLabel,
      allFiles: incoming,
      allFileEntries: incomingEntries,
      fileEntries: entries,
      fileTree: buildFileTree(entries),
    });
    return options.returnHandlerResult ? result : true;
  }

  function acceptFiles(fileList, source = 'choose') {
    return acceptFileEntries(createFileEntries(fileList), source, { returnHandlerResult: true });
  }

  input.addEventListener('change', () => {
    acceptFiles(input.files, 'choose');
    input.value = '';
  });

  if (directoryInput) {
    directoryInput.addEventListener('change', () => {
      acceptFiles(directoryInput.files, 'folder');
      directoryInput.value = '';
    });
  }

  function chooseFiles() {
    hidePickerMenu();
    input.click();
  }

  function chooseFolder() {
    hidePickerMenu();
    if (directoryInput) directoryInput.click();
  }

  function createDropActions() {
    if (!directoryInput || zone.querySelector('.file-drop-actions')) return;

    const actions = document.createElement('div');
    actions.className = 'file-drop-actions';

    const fileButton = document.createElement('button');
    fileButton.type = 'button';
    fileButton.className = 'file-drop-action';
    fileButton.textContent = formatChooseFileText(subject);
    fileButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      chooseFiles();
    });

    const folderButton = document.createElement('button');
    folderButton.type = 'button';
    folderButton.className = 'file-drop-action';
    folderButton.textContent = '选择文件夹';
    folderButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      chooseFolder();
    });

    actions.append(fileButton, folderButton);

    if (status && status.parentElement === zone) {
      zone.insertBefore(actions, status);
    } else {
      zone.appendChild(actions);
    }
  }

  function ensurePickerMenu() {
    if (pickerMenuEl || !directoryInput) return pickerMenuEl;

    pickerMenuEl = document.createElement('div');
    pickerMenuEl.className = 'file-input-picker-menu';
    pickerMenuEl.setAttribute('role', 'menu');
    pickerMenuEl.hidden = true;

    const folderButton = document.createElement('button');
    folderButton.type = 'button';
    folderButton.setAttribute('role', 'menuitem');
    folderButton.textContent = '添加文件夹';
    folderButton.addEventListener('click', chooseFolder);

    pickerMenuEl.append(folderButton);
    pickerMenuEl.addEventListener('click', (event) => event.stopPropagation());
    pickerMenuEl.addEventListener('keydown', (event) => {
      const buttons = Array.from(pickerMenuEl.querySelectorAll('button'));
      const activeIndex = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        hidePickerMenu();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (activeIndex + direction + buttons.length) % buttons.length;
      buttons[nextIndex].focus();
    });
    document.body.appendChild(pickerMenuEl);
    return pickerMenuEl;
  }

  function positionPickerMenu(anchor) {
    if (!pickerMenuEl || !anchor) return;
    const target = anchor.closest('.file-input-split-trigger') || anchor;
    const rect = target.getBoundingClientRect();
    pickerMenuEl.style.minWidth = `${Math.round(rect.width)}px`;
    const menuRect = pickerMenuEl.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - menuRect.width - 8)
    );
    const top = Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - menuRect.height - 8));
    pickerMenuEl.style.left = `${left}px`;
    pickerMenuEl.style.top = `${top}px`;
  }

  function hidePickerMenu() {
    if (!pickerMenuEl) return;
    pickerMenuEl.hidden = true;
    if (triggerMenuButton) triggerMenuButton.setAttribute('aria-expanded', 'false');
  }

  function showPickerMenu(anchor) {
    ensurePickerMenu();
    if (!pickerMenuEl) return;
    pickerMenuEl.hidden = false;
    if (triggerMenuButton) triggerMenuButton.setAttribute('aria-expanded', 'true');
    positionPickerMenu(anchor);
  }

  function openFilePicker(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    hideTriggerTooltip();
    chooseFiles();
  }

  function openPickerMenu(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    hideTriggerTooltip();
    if (pickerMenuEl && !pickerMenuEl.hidden) {
      hidePickerMenu();
      return;
    }
    showPickerMenu(triggerMenuButton || triggerButton);
  }

  createDropActions();
  document.addEventListener('click', hidePickerMenu);

  if (triggerElement && triggerElement !== zone) {
    triggerElement.addEventListener('click', openFilePicker);
  }

  if (triggerButton) {
    triggerButton.classList.add('file-input-trigger');
    triggerButton.hidden = false;
    triggerButton.addEventListener('click', openFilePicker);
    if (directoryInput) {
      triggerMenuButton = createSplitTrigger(triggerButton, openPickerMenu);
    }
    const tooltipTarget = getTriggerTooltipTarget();
    tooltipTarget.addEventListener('mouseenter', scheduleTriggerTooltip);
    tooltipTarget.addEventListener('mouseleave', hideTriggerTooltip);
    tooltipTarget.addEventListener('mouseover', (event) => {
      if (!tooltipTarget.contains(event.relatedTarget)) scheduleTriggerTooltip();
    });
    tooltipTarget.addEventListener('mouseout', (event) => {
      if (!tooltipTarget.contains(event.relatedTarget)) hideTriggerTooltip();
    });
    tooltipTarget.addEventListener('focusin', showTriggerTooltip);
    tooltipTarget.addEventListener('focusout', (event) => {
      if (!tooltipTarget.contains(event.relatedTarget)) hideTriggerTooltip();
    });
    window.addEventListener('resize', () => {
      if (triggerTooltipEl && !triggerTooltipEl.hidden) positionTriggerTooltip();
    });
  }

  zone.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.target === input) return;
    if (event.target.closest('button, a, input, select, textarea, label')) return;
    openFilePicker(event);
  });

  zone.addEventListener('keydown', (event) => {
    if (event.target !== zone) return;
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    openFilePicker(event);
  });

  document.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setDragging(true);
  });

  document.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  });

  document.addEventListener('dragleave', (event) => {
    if (
      event.clientX <= 0 ||
      event.clientY <= 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight
    ) {
      setDragging(false);
    }
  });

  document.addEventListener('drop', async (event) => {
    if (!isFileDrag(event) && !(event.dataTransfer && event.dataTransfer.files.length)) return;
    event.preventDefault();
    setDragging(false);
    const fileEntries = await getFileEntriesFromDataTransfer(event.dataTransfer);
    acceptFileEntries(fileEntries, 'drop');
  });

  document.addEventListener('paste', async (event) => {
    const fileEntries = await getFileEntriesFromClipboard(event.clipboardData);
    if (!fileEntries.length) return;

    if (acceptFileEntries(fileEntries, 'paste')) {
      event.preventDefault();
    }
  });

  return {
    acceptFiles,
    setHasItems,
    clear() {
      input.value = '';
      setStatus('', false);
      setHasItems(false);
    },
  };
}

export {
  bindFileInputDropZone as bind,
  formatDropTitle,
  formatRejectedText,
};
