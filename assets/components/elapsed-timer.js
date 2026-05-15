export function formatHms(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function create(options) {
  options = options || {};
  const element = options.element;
  const getElapsedMs = typeof options.getElapsedMs === 'function' ? options.getElapsedMs : () => 0;
  const intervalMs = options.intervalMs || 1000;
  const onTick = typeof options.onTick === 'function' ? options.onTick : null;
  const format = typeof options.format === 'function' ? options.format : formatHms;
  if (!element) throw new Error('ElapsedTimer.create requires an element.');

  let handle = null;

  function tick() {
    element.textContent = format(getElapsedMs());
    if (onTick) onTick();
  }

  function start() {
    tick();
    if (handle != null) return;
    handle = setInterval(tick, intervalMs);
  }

  function stop() {
    if (handle != null) {
      clearInterval(handle);
      handle = null;
    }
    tick();
  }

  return { render: tick, start, stop };
}
