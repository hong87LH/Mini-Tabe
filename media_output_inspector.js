import fs from 'node:fs';

const FORMAT_META = Object.freeze({
  png: { extension: '.png', mimeType: 'image/png', category: 'raster' },
  jpeg: { extension: '.jpg', mimeType: 'image/jpeg', category: 'raster' },
  webp: { extension: '.webp', mimeType: 'image/webp', category: 'raster' },
  gif: { extension: '.gif', mimeType: 'image/gif', category: 'animated' },
  svg: { extension: '.svg', mimeType: 'image/svg+xml', category: 'vector' }
});

function startsWithBytes(buffer, bytes) {
  return buffer.length >= bytes.length && bytes.every((value, index) => buffer[index] === value);
}

function looksLikeSvg(buffer) {
  const text = buffer.subarray(0, 65536).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (!text) return false;
  const withoutPreamble = text
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^<!doctype[\s\S]*?>\s*/i, '')
    .replace(/^<!--([\s\S]*?)-->\s*/i, '');
  return /^<svg(?:\s|>)/i.test(withoutPreamble);
}

export function detectMediaFormatFromBuffer(buffer, contentType = '') {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  let format = null;
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) format = 'png';
  else if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) format = 'jpeg';
  else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') format = 'webp';
  else if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) format = 'gif';
  else if (looksLikeSvg(buffer)) format = 'svg';

  if (!format) {
    const normalizedType = String(contentType || '').toLowerCase().split(';', 1)[0].trim();
    format = Object.entries(FORMAT_META).find(([, meta]) => meta.mimeType === normalizedType)?.[0] || null;
  }
  return format ? { format, ...FORMAT_META[format] } : null;
}

export async function inspectMediaFile(filePath, contentType = '') {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, 65536);
    const buffer = Buffer.alloc(size);
    if (size > 0) await handle.read(buffer, 0, size, 0);
    return detectMediaFormatFromBuffer(buffer, contentType);
  } finally {
    await handle.close();
  }
}

export function normalizeRequestedImageFormat(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'jpg') return 'jpeg';
  return FORMAT_META[normalized] ? normalized : null;
}

export function imageFormatMeta(format) {
  const normalized = normalizeRequestedImageFormat(format);
  return normalized ? { format: normalized, ...FORMAT_META[normalized] } : null;
}
