export type MediaFileKind = 'raster' | 'photoshop' | 'vector' | 'video' | 'audio' | 'unknown';
export type MediaAppKind = 'photoshop' | 'vector' | 'system';

const RASTER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff']);
const PHOTOSHOP_EXTENSIONS = new Set(['psd', 'psb']);
const VECTOR_EXTENSIONS = new Set(['ai', 'pdf', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma']);

export const PROFESSIONAL_MEDIA_EXTENSIONS = Object.freeze(['psd', 'psb', 'ai', 'pdf', 'svg']);
export const PROFESSIONAL_MEDIA_ACCEPT = '.psd,.psb,.ai,.pdf,.svg';
export const MEDIA_FILE_ACCEPT = `image/*,video/*,audio/*,${PROFESSIONAL_MEDIA_ACCEPT}`;

export function mediaPathExtension(value: unknown): string {
  const clean = String(value || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
  return clean.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
}

export function getMediaFileInfo(value: unknown, mimeType?: unknown) {
  const extension = mediaPathExtension(value);
  const mime = String(mimeType || '').toLowerCase().split(';', 1)[0];
  let kind: MediaFileKind = 'unknown';
  if (PHOTOSHOP_EXTENSIONS.has(extension)) kind = 'photoshop';
  else if (VECTOR_EXTENSIONS.has(extension) || mime === 'application/pdf' || mime === 'application/postscript' || mime === 'image/svg+xml') kind = 'vector';
  else if (VIDEO_EXTENSIONS.has(extension) || mime.startsWith('video/')) kind = 'video';
  else if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith('audio/')) kind = 'audio';
  else if (RASTER_EXTENSIONS.has(extension) || mime.startsWith('image/')) kind = 'raster';

  const badge = ['gif', 'svg', 'ai', 'pdf', 'psd', 'psb'].includes(extension) ? extension.toUpperCase() : '';
  const appKind: MediaAppKind = kind === 'vector' ? 'vector' : kind === 'raster' || kind === 'photoshop' ? 'photoshop' : 'system';
  const accent = kind === 'vector' ? 'orange' : kind === 'photoshop' ? 'blue' : 'neutral';
  return { extension, mime, kind, badge, appKind, accent };
}

export function isSupportedAttachmentDescriptor(name: unknown, mimeType?: unknown): boolean {
  return getMediaFileInfo(name, mimeType).kind !== 'unknown';
}

export function isSupportedAttachmentFile(file: Pick<File, 'name' | 'type'>): boolean {
  return isSupportedAttachmentDescriptor(file?.name, file?.type);
}

export function isProfessionalMedia(value: unknown, mimeType?: unknown): boolean {
  const kind = getMediaFileInfo(value, mimeType).kind;
  return kind === 'photoshop' || kind === 'vector';
}

export function isInlinePreviewableProfessionalMedia(value: unknown, mimeType?: unknown): boolean {
  const extension = getMediaFileInfo(value, mimeType).extension;
  return extension === 'svg' || extension === 'pdf';
}
