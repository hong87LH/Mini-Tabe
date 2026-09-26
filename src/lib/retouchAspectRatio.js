/** Local retouch aspect ratio policy. No provider-specific assumptions here. */
/** @type {Array<[number, string]>} */
const RATIOS = [
  [1, '1:1'], [16 / 9, '16:9'], [9 / 16, '9:16'], [4 / 3, '4:3'],
  [3 / 4, '3:4'], [3 / 2, '3:2'], [2 / 3, '2:3'], [21 / 9, '21:9']
];

export function nearestImageAspectRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return RATIOS.reduce((best, current) =>
    Math.abs(current[0] - ratio) < Math.abs(best[0] - ratio) ? current : best
  )[1];
}

/** The first actual image (not the first image carrying cropData) wins. */
export function getFirstRetouchSourceItem(config, fields, record) {
  const template = String(config?.sourceImageTemplate || '');
  const ordered = fields.filter(f =>
    (f.type === 'attachment' || f.type === 'aiImage') && template.includes(`{${f.name}}`)
  ).sort((a, b) => template.indexOf(`{${a.name}}`) - template.indexOf(`{${b.name}}`));
  for (const field of ordered) {
    const value = record[field.id];
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [value];
    const first = items.find(item => {
      const url = typeof item === 'object' ? item?.url : item;
      return typeof url === 'string' && url.trim();
    });
    if (first) return first;
  }
  return null;
}

export function getRetouchCropAspectRatio(config, fields, record) {
  const first = getFirstRetouchSourceItem(config, fields, record);
  if (!first || typeof first !== 'object') return null;
  return nearestImageAspectRatio(first.cropData?.ratio);
}

/**
 * For retouch, crop/image-derived ratio wins. For regular Qwen I2I, auto/unset
 * leaves aspectRatio ABSENT so ComfyUI uses TextEncodeQwenImage21 native latent.
 */
export function imageRatioRequest({ isQwen, hasImages, isRetouchMode, hasRetouchSourceRatio,
  hasCustomRatioTemplate, configuredRatio, resolvedRatio }) {
  if (!isQwen || !hasImages) return resolvedRatio;
  if (isRetouchMode && hasRetouchSourceRatio) return resolvedRatio;
  const explicit = hasCustomRatioTemplate && !!configuredRatio && !/^auto$/i.test(configuredRatio);
  return explicit && !isRetouchMode ? configuredRatio : undefined;
}

/** In local retouch, ensure image_1 is the image being edited, not a prompt-only reference. */
export function retouchReferenceImages(sourceImages = [], promptImages = []) {
  return [...sourceImages, ...promptImages];
}
