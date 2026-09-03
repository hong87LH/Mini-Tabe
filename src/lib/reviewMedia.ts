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
  getThumbnail?: (path: string, size: { width: number; height: number }) => Promise<string | null>
) {
  const localPath = reviewLocalPath(path);
  if (!localPath) throw new Error('System thumbnail refresh requires a local image');
  if (!getThumbnail) throw new Error('System thumbnail refresh requires Electron');
  // Bypass the JS thumbnail cache, but never fall back to reading the original.
  const thumbnail = await getThumbnail(localPath, { ...SYSTEM_THUMBNAIL_SIZE });
  if (!thumbnail || !thumbnail.startsWith('data:image/')) throw new Error('System thumbnail unavailable');
  return thumbnail;
}
