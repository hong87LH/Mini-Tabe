import { createThumbnailScheduler, thumbnailKey } from '../../thumbnail_scheduler.js';

const nativeThumbnails = createThumbnailScheduler(3);
let refreshSequence = 0;
export const thumbnailLoadStats = () => nativeThumbnails.stats();
export function requestSystemThumbnail(path: string, size: { width: number; height: number }, getThumbnail: (path: string, size: { width: number; height: number }) => Promise<string | null>, wanted = () => true) {
  return nativeThumbnails.request(thumbnailKey(path, size), () => getThumbnail(path, size), wanted);
}

export function reviewLocalPath(value: string): string | null {
  let path = String(value || '').trim();
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
      if (url.hostname) path = `//${url.hostname}${path}`;
      else if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } catch { return null; }
  } else if (/^local-img:\/\//i.test(path)) {
    try { path = decodeURIComponent(path.replace(/^local-img:\/\//i, '')); } catch { return null; }
  }
  return /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path) ? path : null;
}

export function isReviewImage(path: string, type?: string): boolean {
  if (type === 'video' || type === 'audio' || /^(video|audio)\//i.test(type || '')) return false;
  if (/\.(mp4|webm|mov|mkv|mp3|wav|flac|m4a|aac|ogg|opus)([?#]|$)/i.test(path)) return false;
  return type === 'image' || /^image\//i.test(type || '') || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|psd)([?#]|$)/i.test(path) || /^(data:image\/|https?:\/\/|blob:|local-img:\/\/)/i.test(path);
}

type Rect = { top: number; bottom: number; left: number; right: number };
// Intersect with every scroll/clip ancestor, not just the browser viewport.
export function isThumbnailVisible(element: Element, root: Element): boolean {
  if (!element.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  let bounds = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const box = parent.getBoundingClientRect();
    if (parent === root || /auto|scroll|hidden|clip/.test(style.overflowX)) {
      bounds.left = Math.max(bounds.left, box.left); bounds.right = Math.min(bounds.right, box.right);
    }
    if (parent === root || /auto|scroll|hidden|clip/.test(style.overflowY)) {
      bounds.top = Math.max(bounds.top, box.top); bounds.bottom = Math.min(bounds.bottom, box.bottom);
    }
    if (parent === root) break;
  }
  return bounds.right > bounds.left && bounds.bottom > bounds.top && intersectsReviewViewport(rect, bounds);
}
export function intersectsReviewViewport(rect: Rect, viewport: Rect): boolean {
  return rect.bottom > rect.top && rect.right > rect.left && rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right;
}

// Match the native thumbnail size used by the table and initial review load.
export const SYSTEM_THUMBNAIL_SIZE = Object.freeze({ width: 150, height: 150 });

// Limit native thumbnail requests to two visible images at a time.
export async function refreshReviewImages(paths: string[], refresh: (path: string) => Promise<void>) {
  const queue = [...new Set(paths)];
  const failures: string[] = [];
  let succeeded = 0;
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const path = queue.shift()!;
      try { await refresh(path); succeeded++; } catch { failures.push(path); }
    }
  }));
  return { succeeded, failures };
}

export async function loadFreshReviewThumbnail(
  path: string,
  getThumbnail?: (path: string, size: { width: number; height: number }, options?: { fresh: boolean }) => Promise<string | null>
) {
  const localPath = reviewLocalPath(path);
  if (!localPath) throw new Error('System thumbnail refresh requires a local image');
  if (!getThumbnail) throw new Error('System thumbnail refresh requires Electron');
  // Bypass the JS thumbnail cache, but never fall back to reading the original.
  const thumbnail = await nativeThumbnails.request(`refresh:${++refreshSequence}:${localPath}`, () => getThumbnail(localPath, { ...SYSTEM_THUMBNAIL_SIZE }, { fresh: true }));
  if (!thumbnail || !thumbnail.startsWith('data:image/')) throw new Error('System thumbnail unavailable');
  return thumbnail;
}
