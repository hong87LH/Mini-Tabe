export interface AttachmentReviewProps {
  annotations?: any[];
  rating?: number;
  status?: string;
}

export const stripPreviewOnlyProps = <T extends Record<string, any>>(item: T) => {
  if (!item || typeof item !== 'object') return item;

  const {
    mappedUrl,
    refUrls,
    refCells,
    ...persistable
  } = item;

  return persistable as Omit<T, 'mappedUrl' | 'refUrls' | 'refCells'>;
};

export const normalizeAttachmentKey = (input: unknown): string => {
  if (input == null) return '';

  let value = String(input).trim();
  if (!value) return '';

  try {
    value = decodeURIComponent(value);
  } catch {
    // 保留无法 decode 的原始路径
  }

  const isFileLike =
    /^file:\/\//i.test(value) ||
    /^local-img:\/\//i.test(value) ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    /^\\\\/.test(value);

  if (isFileLike) {
    value = value
      .replace(/^file:\/\//i, '')
      .replace(/^local-img:\/\//i, '')
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/');

    // Windows 本地路径大小写不敏感；HTTP URL 不转换大小写。
    value = value.toLowerCase();
  }

  return value;
};

export const mergeReviewProps = (
  existing: AttachmentReviewProps | undefined,
  item: any
): AttachmentReviewProps => {
  const result: AttachmentReviewProps = { ...(existing || {}) };

  if (Array.isArray(item?.annotations) && item.annotations.length > 0) {
    if (
      !Array.isArray(result.annotations) ||
      item.annotations.length >= result.annotations.length
    ) {
      result.annotations = item.annotations;
    }
  }

  if (typeof item?.rating === 'number' && item.rating > 0) {
    result.rating = item.rating;
  }

  if (
    typeof item?.status === 'string' &&
    item.status !== 'unannotated'
  ) {
    result.status = item.status;
  }

  return result;
};

export const pickGlobalReviewProps = (item: any) => {
  const result: any = {};

  if ('annotations' in item) result.annotations = item.annotations;
  if ('rating' in item) result.rating = item.rating;
  if ('status' in item) result.status = item.status;

  return result;
};

export const normalizeAttachmentItems = (value: any): any[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === 'string' ? { url: item } : item)
      .filter(item => item?.url);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\r\n]+/)
      .map(url => url.trim())
      .filter(Boolean)
      .map(url => ({ url }));
  }

  if (typeof value === 'object' && value.url) {
    return [value];
  }

  return [];
};

export const hydrateReviewProps = (
  item: any,
  reviewMap: Map<string, AttachmentReviewProps>
) => {
  const cleanItem = stripPreviewOnlyProps(item);
  const key = normalizeAttachmentKey(cleanItem.url);
  const globalReview = reviewMap.get(key);

  return globalReview
    ? { ...cleanItem, ...globalReview }
    : cleanItem;
};
