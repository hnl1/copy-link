import * as png from './file-meta-png.js';
import * as jpeg from './file-meta-jpeg.js';
import * as mp4 from './file-meta-mp4.js';

export const inspectors = [png, jpeg, mp4];

export function isSupportedFile(file) {
  return inspectors.some((inspector) => inspector.match(file));
}

export async function inspectFile(file, container) {
  const inspector = inspectors.find((item) => item.match(file));
  if (!inspector) throw new Error('不支持的文件类型');
  await inspector.inspect(file, container);
}

export { match as isMp4 } from './file-meta-mp4.js';
