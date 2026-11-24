import { isReviewImage, reviewLocalPath } from './reviewMedia';

export type SmartCropPreset = {
  id: string;
  label: string;
  group: string;
  description: string;
  aspect: string;
  aspectMode?: 'fixed' | 'approximate';
  aspectCandidates?: string[];
  framing: { start: string; end: string };
  protection: { start: string; end: string; hands: string };
  spacing: { top: number; right: number; bottom: number; left: number };
  allow_virtual: boolean;
  enabled: boolean;
  needsContour?: boolean;
  strategy?: 'anatomy' | 'tight_headshot';
  headshot?: {
    topMargin?: number;
    minTopMargin?: number;
    sideMargin?: number;
    shoulderDepth?: number;
  };
};

export type SmartCropOverrides = {
  aspect?: string;
  aspectMode?: 'fixed' | 'approximate';
  aspectCandidates?: string[];
  headshot?: Partial<NonNullable<SmartCropPreset['headshot']>>;
  framing?: Partial<SmartCropPreset['framing']>;
  protection?: Partial<SmartCropPreset['protection']>;
  spacing?: Partial<SmartCropPreset['spacing']>;
};

export type SmartCropTarget = {
  rowId: string;
  fieldId: string;
  index: number;
  item: any;
};

export type SmartCropChange = SmartCropTarget & {
  cropData: any;
  warnings: string[];
};

export type SegmentationResult = {
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  width: number;
  height: number;
  modelKind?: 'multiclass' | 'binary';
  modelInfo?: any;
  timing?: any;
};

const assetUrl = (path: string) => new URL(`smart_crop/${path}`, document.baseURI).href;
let presetsPromise: Promise<SmartCropPreset[]> | null = null;
let enginePromise: Promise<any> | null = null;

let worker: Worker | null = null;
let workerSequence = 0;
const workerWaiters = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

let segWorker: Worker | null = null;
let segWorkerSequence = 0;
const segWorkerWaiters = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

const poseCache = new Map<string, any>();
const contourCache = new Map<string, SegmentationResult>();
const POSE_DB_NAME = 'hong-ai-table-smart-crop';
const POSE_STORE_NAME = 'pose-results';

function openPoseDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POSE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(POSE_STORE_NAME)) request.result.createObjectStore(POSE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('姿态缓存数据库不可用'));
  });
}

async function readPersistedCache(key: string) {
  const database = await openPoseDatabase();
  try {
    return await new Promise<any>((resolve, reject) => {
      const transaction = database.transaction(POSE_STORE_NAME, 'readonly');
      const request = transaction.objectStore(POSE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('智能裁切缓存读取失败'));
    });
  } finally {
    database.close();
  }
}

async function writePersistedCache(key: string, value: any) {
  const database = await openPoseDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(POSE_STORE_NAME, 'readwrite');
      transaction.objectStore(POSE_STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('智能裁切缓存写入失败'));
    });
  } finally {
    database.close();
  }
}

export function listSmartCropPresets(): Promise<SmartCropPreset[]> {
  if (!presetsPromise) {
    presetsPromise = fetch(assetUrl('presets.json'))
      .then(response => {
        if (!response.ok) throw new Error(`裁切预设加载失败: HTTP ${response.status}`);
        return response.json();
      })
      .then((value: SmartCropPreset[]) => value.filter(item => item.enabled !== false));
  }
  return presetsPromise;
}

function loadScript(url: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-smart-crop-src="${url}"]`) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') return resolve();
    const script = existing || document.createElement('script');
    script.dataset.smartCropSrc = url;
    script.src = url;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error(`裁切求解器加载失败: ${url}`));
    if (!existing) document.head.appendChild(script);
  });
}

async function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      await loadScript(assetUrl('engine/manual-next-crop-policy.js'));
      await loadScript(assetUrl('engine/manual-next-policy.js'));
      const value = (globalThis as any).ManualCrop;
      if (!value?.solve) throw new Error('裁切求解器未正确初始化');
      return value;
    })();
  }
  return enginePromise;
}

function ensureWorker() {
  if (worker) return worker;
  // MediaPipe's FilesetResolver loads its Emscripten glue through importScripts.
  // A classic worker is required here; module workers reject importScripts and
  // the upstream bundle then falls back to the non-standard `self.import` hook.
  worker = new Worker(assetUrl('recognition-worker.js'));
  worker.onmessage = event => {
    const message = event.data;
    if (!message?.id) return;
    const waiter = workerWaiters.get(message.id);
    if (!waiter) return;
    workerWaiters.delete(message.id);
    if (message.type === 'error') waiter.reject(new Error(message.error || '姿态识别失败'));
    else waiter.resolve(message.value);
  };
  worker.onerror = event => {
    const error = new Error(event.message || '姿态识别 Worker 失败');
    for (const waiter of workerWaiters.values()) waiter.reject(error);
    workerWaiters.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function ensureSegmentationWorker() {
  if (segWorker) return segWorker;
  segWorker = new Worker(assetUrl('segmentation-worker.js'));
  segWorker.onmessage = event => {
    const message = event.data;
    if (!message?.id) return;
    const waiter = segWorkerWaiters.get(message.id);
    if (!waiter) return;
    segWorkerWaiters.delete(message.id);
    if (message.type === 'error') waiter.reject(new Error(message.error || '轮廓分割失败'));
    else waiter.resolve(message.value);
  };
  segWorker.onerror = event => {
    const error = new Error(event.message || '轮廓分割 Worker 失败');
    for (const waiter of segWorkerWaiters.values()) waiter.reject(error);
    segWorkerWaiters.clear();
    segWorker?.terminate();
    segWorker = null;
  };
  return segWorker;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function imageMimeFromPath(path: string) {
  const cleanPath = String(path || '').split(/[?#]/, 1)[0].toLowerCase();
  if (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg')) return 'image/jpeg';
  if (cleanPath.endsWith('.png')) return 'image/png';
  if (cleanPath.endsWith('.webp')) return 'image/webp';
  if (cleanPath.endsWith('.gif')) return 'image/gif';
  if (cleanPath.endsWith('.bmp')) return 'image/bmp';
  if (cleanPath.endsWith('.avif')) return 'image/avif';
  if (cleanPath.endsWith('.tif') || cleanPath.endsWith('.tiff')) return 'image/tiff';
  return 'application/octet-stream';
}

async function readImageSource(url: string) {
  const localPath = reviewLocalPath(url);
  const electronApi = (window as any).electronAPI;
  if (localPath) {
    if (!electronApi?.readLocalFile) throw new Error('本地图片识别需要 Electron');
    const status = await electronApi.getLocalFileStatus?.(localPath);
    if (status?.exists === false) throw new Error('本地图片文件不存在');
    const base64 = await electronApi.readLocalFile(localPath);
    if (!base64) throw new Error('无法读取本地图片');
    return new Blob([base64ToBytes(base64)], { type: imageMimeFromPath(localPath) });
  }
  if (/^data:/i.test(url)) return (await fetch(url)).blob();
  if (/^https?:|^blob:/i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`图片加载失败: HTTP ${response.status}`);
    return response.blob();
  }
  throw new Error('智能裁切仅支持可读取的图片附件');
}

async function resolveCacheIdentity(url: string) {
  const localPath = reviewLocalPath(url);
  const electronApi = (window as any).electronAPI;
  const status = localPath ? await electronApi?.getLocalFileStatus?.(localPath) : null;
  return {
    localPath,
    cacheKey: `${localPath || url}|${status?.size || ''}|${status?.mtimeMs || ''}`
  };
}

async function prepareInferenceBitmap(url: string, maxSide = 256) {
  const blob = await readImageSource(url);
  const sourceBitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const naturalWidth = sourceBitmap.width;
  const naturalHeight = sourceBitmap.height;
  let bitmap = sourceBitmap;
  if (typeof OffscreenCanvas !== 'undefined' && Math.max(naturalWidth, naturalHeight) > maxSide) {
    const scale = maxSide / Math.max(naturalWidth, naturalHeight);
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(naturalWidth * scale)),
      Math.max(1, Math.round(naturalHeight * scale))
    );
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(sourceBitmap, 0, 0, canvas.width, canvas.height);
      bitmap = canvas.transferToImageBitmap();
      sourceBitmap.close();
    }
  }
  return { bitmap, naturalWidth, naturalHeight };
}

async function recognize(url: string) {
  const { localPath, cacheKey } = await resolveCacheIdentity(url);
  if (poseCache.has(cacheKey)) return poseCache.get(cacheKey);
  if (localPath) {
    try {
      const persisted = await readPersistedCache(`smart-crop-pose-v1:${cacheKey}`);
      if (persisted) {
        poseCache.set(cacheKey, persisted);
        return persisted;
      }
    } catch {
      // IndexedDB can be unavailable in restricted renderer contexts; memory cache remains valid.
    }
  }
  const { bitmap, naturalWidth, naturalHeight } = await prepareInferenceBitmap(url, 256);
  const id = ++workerSequence;
  const message: any = {
    id,
    type: 'analyze',
    image: bitmap,
    width: naturalWidth,
    height: naturalHeight,
    mode: 'single',
    transform: { edge: 1, contentWidth: 1, contentHeight: 1, offsetX: 0, offsetY: 0 },
    preferred: 'bundled'
  };
  const transfers: Transferable[] = [bitmap];
  const result = await new Promise<any>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      if (!workerWaiters.has(id)) return;
      workerWaiters.delete(id);
      worker?.terminate();
      worker = null;
      reject(new Error('人物识别超时，请重试；若连续发生，请检查图片是否损坏或格式异常'));
    }, 45000);
    workerWaiters.set(id, {
      resolve: value => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      reject: error => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    });
    ensureWorker().postMessage(message, transfers);
  });
  poseCache.set(cacheKey, result);
  if (localPath) {
    try { await writePersistedCache(`smart-crop-pose-v1:${cacheKey}`, result); } catch { /* memory-only fallback */ }
  }
  return result;
}

async function segment(url: string): Promise<SegmentationResult> {
  const { localPath, cacheKey } = await resolveCacheIdentity(url);
  if (contourCache.has(cacheKey)) return contourCache.get(cacheKey)!;
  if (localPath) {
    try {
      const persisted = await readPersistedCache(`smart-crop-contour-v1:${cacheKey}`);
      if (persisted?.mask?.length && persisted.maskWidth > 0 && persisted.maskHeight > 0) {
        const hydrated: SegmentationResult = {
          ...persisted,
          mask: persisted.mask instanceof Uint8Array ? persisted.mask : new Uint8Array(persisted.mask)
        };
        contourCache.set(cacheKey, hydrated);
        return hydrated;
      }
    } catch {
      // Ignore cache read error and proceed to live segmentation.
    }
  }
  const { bitmap, naturalWidth, naturalHeight } = await prepareInferenceBitmap(url, 256);
  const id = ++segWorkerSequence;
  const message: any = {
    id,
    type: 'segment',
    image: bitmap,
    width: naturalWidth,
    height: naturalHeight,
    preferred: 'multiclass'
  };
  const result = await new Promise<SegmentationResult>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      if (!segWorkerWaiters.has(id)) return;
      segWorkerWaiters.delete(id);
      segWorker?.terminate();
      segWorker = null;
      reject(new Error('轮廓分割超时'));
    }, 30000);
    segWorkerWaiters.set(id, {
      resolve: value => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      reject: error => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    });
    ensureSegmentationWorker().postMessage(message, [bitmap]);
  });
  contourCache.set(cacheKey, result);
  if (localPath) {
    try { await writePersistedCache(`smart-crop-contour-v1:${cacheKey}`, result); } catch { /* memory-only fallback */ }
  }
  return result;
}

function extractValidPersonPoints(person: any, width: number, height: number, maskWidth: number, maskHeight: number) {
  const values = person?.pose_keypoints_2d;
  if (!Array.isArray(values)) return [];
  const points: Array<{ mx: number; my: number; x: number; y: number; index: number }> = [];
  for (let i = 0; i * 3 + 2 < values.length; i += 1) {
    const x = Number(values[i * 3]);
    const y = Number(values[i * 3 + 1]);
    const s = Number(values[i * 3 + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || s < 0.25) continue;
    if (x < 0 || x > width || y < 0 || y > height) continue;
    const mx = Math.max(0, Math.min(maskWidth - 1, Math.floor((x / width) * maskWidth)));
    const my = Math.max(0, Math.min(maskHeight - 1, Math.floor((y / height) * maskHeight)));
    points.push({ mx, my, x, y, index: i });
  }
  return points;
}

function scanMaskToRowSpans(
  predicate: (idx: number) => boolean,
  maskWidth: number,
  maskHeight: number,
  width: number,
  height: number
): Array<[number, number, number, number]> {
  const rows: Array<[number, number, number, number]> = [];
  const rowHeight = height / maskHeight;
  for (let y = 0; y < maskHeight; y += 1) {
    let start = -1;
    const base = y * maskWidth;
    for (let x = 0; x <= maskWidth; x += 1) {
      const fg = x < maskWidth && predicate(base + x);
      if (fg && start < 0) start = x;
      else if (!fg && start >= 0) {
        rows.push([(start / maskWidth) * width, (y / maskHeight) * height, (x / maskWidth) * width, rowHeight]);
        start = -1;
      }
    }
  }
  return rows;
}

export function mergePoseAndSegmentation(poseAnalysis: any, segResult: SegmentationResult | null | undefined) {
  if (!poseAnalysis || !segResult?.mask?.length || !(segResult.maskWidth > 0 && segResult.maskHeight > 0)) {
    return poseAnalysis;
  }
  const width = Number(poseAnalysis.width || segResult.width);
  const height = Number(poseAnalysis.height || segResult.height);
  if (!(width > 0 && height > 0)) return poseAnalysis;

  const { mask, maskWidth: mw, maskHeight: mh } = segResult;
  const total = mw * mh;
  if (mask.length < total) return poseAnalysis;

  const people = (poseAnalysis?.parameters?.openpose_json || []).flatMap((frame: any) => frame?.people || []);
  const personPoints = people.map((person: any, idx: number) => ({
    id: person?.person_id || `P${idx + 1}`,
    points: extractValidPersonPoints(person, width, height, mw, mh)
  }));

  // Auto-verify foreground polarity for binary selfie_segmenter models (some output 0=person, 255=bg).
  let foregroundIsZero = false;
  if (segResult.modelKind === 'binary') {
    let zeroHits = 0;
    let nonZeroHits = 0;
    for (const p of personPoints) {
      for (const pt of p.points) {
        if (mask[pt.my * mw + pt.mx] === 0) zeroHits += 1;
        else nonZeroHits += 1;
      }
    }
    if (zeroHits > nonZeroHits) foregroundIsZero = true;
  }

  const isForeground = (idx: number) => (foregroundIsZero ? mask[idx] === 0 : mask[idx] !== 0);
  const row_spans = scanMaskToRowSpans(isForeground, mw, mh, width, height);
  const person_row_spans: Record<string, Array<[number, number, number, number]>> = {};
  const person_head_row_spans: Record<string, Array<[number, number, number, number]>> = {};
  const person_part_row_spans: Record<string, Record<string, Array<[number, number, number, number]>>> = {};

  if (personPoints.length > 0 && row_spans.length > 0) {
    // 4-neighbor connected-component labeling on the compact segmentation grid.
    const compLabels = new Int32Array(total);
    const compBoxes: Array<{ minX: number; minY: number; maxX: number; maxY: number; count: number }> = [
      { minX: 0, minY: 0, maxX: 0, maxY: 0, count: 0 }
    ];
    const queue = new Int32Array(total);
    let compCount = 0;

    for (let i = 0; i < total; i += 1) {
      if (!isForeground(i) || compLabels[i] !== 0) continue;
      compCount += 1;
      let head = 0;
      let tail = 0;
      compLabels[i] = compCount;
      queue[tail++] = i;
      let minX = mw;
      let minY = mh;
      let maxX = -1;
      let maxY = -1;
      let count = 0;

      while (head < tail) {
        const cur = queue[head++];
        const cx = cur % mw;
        const cy = (cur - cx) / mw;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        count += 1;

        if (cx > 0) {
          const n = cur - 1;
          if (compLabels[n] === 0 && isForeground(n)) { compLabels[n] = compCount; queue[tail++] = n; }
        }
        if (cx + 1 < mw) {
          const n = cur + 1;
          if (compLabels[n] === 0 && isForeground(n)) { compLabels[n] = compCount; queue[tail++] = n; }
        }
        if (cy > 0) {
          const n = cur - mw;
          if (compLabels[n] === 0 && isForeground(n)) { compLabels[n] = compCount; queue[tail++] = n; }
        }
        if (cy + 1 < mh) {
          const n = cur + mw;
          if (compLabels[n] === 0 && isForeground(n)) { compLabels[n] = compCount; queue[tail++] = n; }
        }
      }
      compBoxes.push({ minX, minY, maxX, maxY, count });
    }

    // Score each connected component against each person's keypoints (with 2px radius tolerance).
    const compHits: number[][] = Array.from({ length: compCount + 1 }, () => new Array(personPoints.length).fill(0));
    for (let pIdx = 0; pIdx < personPoints.length; pIdx += 1) {
      for (const pt of personPoints[pIdx].points) {
        const hitComps = new Set<number>();
        for (let dy = -2; dy <= 2; dy += 1) {
          const ny = pt.my + dy;
          if (ny < 0 || ny >= mh) continue;
          for (let dx = -2; dx <= 2; dx += 1) {
            const nx = pt.mx + dx;
            if (nx < 0 || nx >= mw) continue;
            const label = compLabels[ny * mw + nx];
            if (label > 0) hitComps.add(label);
          }
        }
        for (const label of hitComps) compHits[label][pIdx] += 1;
      }
    }

    const personBBoxes = personPoints.map(p => {
      if (!p.points.length) return null;
      return {
        minX: Math.min(...p.points.map(pt => pt.mx)),
        minY: Math.min(...p.points.map(pt => pt.my)),
        maxX: Math.max(...p.points.map(pt => pt.mx)),
        maxY: Math.max(...p.points.map(pt => pt.my))
      };
    });

    const boxDistance = (a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) => {
      const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
      const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
      return Math.hypot(dx, dy);
    };

    // -2 = shared by multiple people (split per-pixel), -1 = unassigned, >=0 = unique person index
    const compOwner = new Int32Array(compCount + 1).fill(-1);
    const maxAttachDist = Math.max(mw, mh) * 0.14;

    for (let c = 1; c <= compCount; c += 1) {
      const hits = compHits[c];
      const matched = hits.map((h, idx) => ({ idx, h })).filter(item => item.h > 0);
      if (matched.length === 1) {
        compOwner[c] = matched[0].idx;
      } else if (matched.length > 1) {
        compOwner[c] = -2;
      } else {
        let bestIdx = -1;
        let bestDist = maxAttachDist;
        for (let pIdx = 0; pIdx < personBBoxes.length; pIdx += 1) {
          const pb = personBBoxes[pIdx];
          if (!pb) continue;
          const dist = boxDistance(compBoxes[c], pb);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = pIdx;
          }
        }
        compOwner[c] = bestIdx;
      }
    }

    const pixelOwner = new Int16Array(total).fill(-1);
    const hasAnyOwner = compOwner.some((v, idx) => idx > 0 && v !== -1);

    for (let i = 0; i < total; i += 1) {
      const c = compLabels[i];
      if (c <= 0) continue;
      const owner = compOwner[c];
      if (owner >= 0) {
        pixelOwner[i] = owner;
      } else if (owner === -2) {
        const px = i % mw;
        const py = (i - px) / mw;
        let bestP = -1;
        let bestD2 = Infinity;
        for (let pIdx = 0; pIdx < personPoints.length; pIdx += 1) {
          if (compHits[c][pIdx] <= 0) continue;
          for (const pt of personPoints[pIdx].points) {
            const d2 = (px - pt.mx) * (px - pt.mx) + (py - pt.my) * (py - pt.my);
            if (d2 < bestD2) {
              bestD2 = d2;
              bestP = pIdx;
            }
          }
        }
        pixelOwner[i] = bestP;
      } else if (!hasAnyOwner && personPoints.length === 1) {
        pixelOwner[i] = 0;
      }
    }

    for (let pIdx = 0; pIdx < personPoints.length; pIdx += 1) {
      const rows = scanMaskToRowSpans(idx => pixelOwner[idx] === pIdx, mw, mh, width, height);
      const personId = personPoints[pIdx].id;
      if (rows.length) person_row_spans[personId] = rows;

      if (segResult.modelKind === 'multiclass') {
        const parts = {
          hair: scanMaskToRowSpans(idx => pixelOwner[idx] === pIdx && mask[idx] === 1, mw, mh, width, height),
          body_skin: scanMaskToRowSpans(idx => pixelOwner[idx] === pIdx && mask[idx] === 2, mw, mh, width, height),
          face: scanMaskToRowSpans(idx => pixelOwner[idx] === pIdx && mask[idx] === 3, mw, mh, width, height),
          clothes: scanMaskToRowSpans(idx => pixelOwner[idx] === pIdx && mask[idx] === 4, mw, mh, width, height),
          accessories: scanMaskToRowSpans(idx => pixelOwner[idx] === pIdx && mask[idx] === 5, mw, mh, width, height)
        };
        person_part_row_spans[personId] = parts;
        const headRows = scanMaskToRowSpans(
          idx => pixelOwner[idx] === pIdx && (mask[idx] === 1 || mask[idx] === 3),
          mw,
          mh,
          width,
          height
        );
        if (headRows.length) person_head_row_spans[personId] = headRows;
      }
    }
  }

  return {
    ...poseAnalysis,
    parameters: {
      ...(poseAnalysis.parameters || {}),
      boundary: {
        row_spans,
        person_row_spans,
        person_head_row_spans,
        person_part_row_spans,
        method: 'dual_model_image_segmenter',
        matched: row_spans.length > 0,
        modelKind: segResult.modelKind || 'multiclass',
        categoryMap: segResult.modelKind === 'multiclass'
          ? { background: 0, hair: 1, body_skin: 2, face: 3, clothes: 4, accessories: 5 }
          : null
      },
      segmentation_model: segResult.modelInfo || null
    }
  };
}

function materializeRule(preset: SmartCropPreset, defaults: any) {
  const [aspectW, aspectH] = preset.aspect.split(':').map(Number);
  const width = aspectW === aspectH ? 1024 : aspectW * 300;
  const height = aspectH === aspectW ? 1024 : aspectH * 300;
  return {
    ...defaults,
    name: preset.label,
    category: preset.group,
    aspect: preset.aspect,
    framing: { ...preset.framing },
    protection: { ...defaults.protection, ...preset.protection, preference_extension_limit: 0 },
    avoid_regions: [],
    spacing: { unit: 'percent', ...preset.spacing },
    output: { width, height },
    allow_virtual: preset.allow_virtual === true,
    max_extension_fraction: preset.allow_virtual === true ? 0.25 : 0
  };
}

export function pixelBoxToGridCropData(
  box: { left: number; top: number; right: number; bottom: number },
  naturalW: number,
  naturalH: number,
  metadata: { presetId: string; overrides?: SmartCropOverrides; effectiveAspect?: string; aspectMode?: 'fixed' | 'approximate'; warnings?: string[]; engineVersion?: string }
) {
  const left = Math.max(0, Math.min(naturalW, box.left));
  const top = Math.max(0, Math.min(naturalH, box.top));
  const right = Math.max(left + 1, Math.min(naturalW, box.right));
  const bottom = Math.max(top + 1, Math.min(naturalH, box.bottom));
  const maskW = right - left;
  const maskH = bottom - top;
  return {
    scale: 1,
    x: naturalW / 2 - (left + right) / 2,
    y: naturalH / 2 - (top + bottom) / 2,
    ratio: maskW / maskH,
    imgW: naturalW,
    imgH: naturalH,
    naturalW,
    naturalH,
    maskW,
    maskH,
    isOutpaint: false,
    sourceBox: { left, top, right, bottom, unit: 'px' },
    smartCrop: {
      presetId: metadata.presetId,
      ...(metadata.overrides && Object.keys(metadata.overrides).length ? { overrides: structuredClone(metadata.overrides) } : {}),
      ...(metadata.effectiveAspect ? { effectiveAspect: metadata.effectiveAspect } : {}),
      ...(metadata.aspectMode ? { aspectMode: metadata.aspectMode } : {}),
      engineVersion: metadata.engineVersion || 'manual-crop/v1+mediapipe-dual',
      warnings: metadata.warnings || []
    }
  };
}

const SMART_CROP_ASPECTS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']);
const SMART_CROP_STARTS = new Set(['head', 'shoulders', 'above_waist', 'hip']);
const SMART_CROP_ENDS = new Set(['shoulders', 'waist_hip', 'hip', 'below_hip', 'mid_thigh', 'above_knee', 'knee', 'calf', 'ankle', 'soles']);
const SMART_CROP_HANDS = new Set(['none', 'prefer_one', 'prefer_all', 'require_one', 'require_all']);

function smartCropNumber(value: unknown, name: string, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${name} 必须在 ${minimum}–${maximum} 之间`);
  }
  return number;
}

export function applySmartCropOverrides(basePreset: SmartCropPreset, overrides?: SmartCropOverrides | null): SmartCropPreset {
  if (!overrides || !Object.keys(overrides).length) return structuredClone(basePreset);
  const allowed = new Set(['aspect', 'aspectMode', 'aspectCandidates', 'headshot', 'framing', 'protection', 'spacing']);
  const unknown = Object.keys(overrides).find(key => !allowed.has(key));
  if (unknown) throw new Error(`不支持的临时裁切参数: ${unknown}`);
  const preset = structuredClone(basePreset);
  if (overrides.aspect !== undefined) {
    if (!SMART_CROP_ASPECTS.has(overrides.aspect)) throw new Error(`不支持的临时画幅: ${overrides.aspect}`);
    preset.aspect = overrides.aspect;
  }
  if (overrides.aspectMode !== undefined) {
    if (!['fixed', 'approximate'].includes(overrides.aspectMode)) throw new Error(`不支持的比例模式: ${overrides.aspectMode}`);
    if (preset.strategy === 'tight_headshot' && overrides.aspectMode === 'approximate') throw new Error('紧凑头像暂不支持近似比例模式');
    preset.aspectMode = overrides.aspectMode;
  }
  if (overrides.aspectCandidates !== undefined) {
    if (!Array.isArray(overrides.aspectCandidates) || !overrides.aspectCandidates.length || overrides.aspectCandidates.length > 5) throw new Error('aspectCandidates 需要包含 1–5 个常见比例');
    const candidates = [...new Set(overrides.aspectCandidates)];
    const invalid = candidates.find(aspect => !SMART_CROP_ASPECTS.has(aspect));
    if (invalid) throw new Error(`不支持的候选画幅: ${invalid}`);
    preset.aspectCandidates = candidates;
  }
  if (overrides.headshot !== undefined) {
    if (preset.strategy !== 'tight_headshot') throw new Error('headshot 临时参数只适用于紧凑头像预设');
    const source = overrides.headshot;
    const allowedHeadshot = new Set(['topMargin', 'minTopMargin', 'sideMargin', 'shoulderDepth']);
    const unknownHeadshot = Object.keys(source).find(key => !allowedHeadshot.has(key));
    if (unknownHeadshot) throw new Error(`不支持的头像临时参数: ${unknownHeadshot}`);
    const headshot = { ...(preset.headshot || {}) };
    if (source.topMargin !== undefined) headshot.topMargin = smartCropNumber(source.topMargin, 'topMargin', 0, 0.5);
    if (source.minTopMargin !== undefined) headshot.minTopMargin = smartCropNumber(source.minTopMargin, 'minTopMargin', 0, 0.25);
    if (source.sideMargin !== undefined) headshot.sideMargin = smartCropNumber(source.sideMargin, 'sideMargin', 0, 0.5);
    if (source.shoulderDepth !== undefined) headshot.shoulderDepth = smartCropNumber(source.shoulderDepth, 'shoulderDepth', 0, 2);
    if ((headshot.minTopMargin ?? 0) > (headshot.topMargin ?? 0.1)) throw new Error('minTopMargin 不能大于 topMargin');
    preset.headshot = headshot;
  }
  if (overrides.framing !== undefined) {
    if (preset.strategy === 'tight_headshot') throw new Error('紧凑头像请使用 headshot 参数，不接受 framing 临时覆盖');
    if (overrides.framing.start !== undefined && !SMART_CROP_STARTS.has(overrides.framing.start)) throw new Error(`未知 framing.start: ${overrides.framing.start}`);
    if (overrides.framing.end !== undefined && !SMART_CROP_ENDS.has(overrides.framing.end)) throw new Error(`未知 framing.end: ${overrides.framing.end}`);
    preset.framing = { ...preset.framing, ...overrides.framing };
  }
  if (overrides.protection !== undefined) {
    if (preset.strategy === 'tight_headshot') throw new Error('紧凑头像请使用 headshot 参数，不接受 protection 临时覆盖');
    if (overrides.protection.start !== undefined && !SMART_CROP_STARTS.has(overrides.protection.start)) throw new Error(`未知 protection.start: ${overrides.protection.start}`);
    if (overrides.protection.end !== undefined && !SMART_CROP_ENDS.has(overrides.protection.end)) throw new Error(`未知 protection.end: ${overrides.protection.end}`);
    if (overrides.protection.hands !== undefined && !SMART_CROP_HANDS.has(overrides.protection.hands)) throw new Error(`未知 protection.hands: ${overrides.protection.hands}`);
    preset.protection = { ...preset.protection, ...overrides.protection };
  }
  if (overrides.spacing !== undefined) {
    if (preset.strategy === 'tight_headshot') throw new Error('紧凑头像请使用 headshot 参数，不接受 spacing 临时覆盖');
    const spacing = { ...preset.spacing };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (overrides.spacing[side] !== undefined) spacing[side] = smartCropNumber(overrides.spacing[side], `spacing.${side}`, 0, 50);
    }
    preset.spacing = spacing;
  }
  return preset;
}

function smartCropAspectValue(aspect: string) {
  const [width, height] = aspect.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : NaN;
}

export function chooseApproximateAspect(naturalAspect: number, preferredAspect: string, candidates: string[]) {
  if (!(naturalAspect > 0) || !Number.isFinite(naturalAspect)) return preferredAspect;
  const preferred = smartCropAspectValue(preferredAspect);
  const unique = [...new Set([preferredAspect, ...candidates])].filter(aspect => SMART_CROP_ASPECTS.has(aspect));
  if (!unique.length) return preferredAspect;
  return unique.reduce((best, aspect) => {
    const ratio = smartCropAspectValue(aspect);
    const shapeDistance = Math.abs(Math.log(ratio / naturalAspect));
    const preferenceDistance = Number.isFinite(preferred) ? Math.abs(Math.log(ratio / preferred)) * 0.15 : 0;
    const score = shapeDistance + preferenceDistance;
    return !best || score < best.score ? { aspect, score } : best;
  }, null as { aspect: string; score: number } | null)!.aspect;
}

function solveAnatomyCrop(engine: any, analysis: any, poses: any[], preset: SmartCropPreset) {
  const solveWithAspect = (aspect: string) => {
    const rule = materializeRule({ ...preset, aspect }, engine.defaults());
    return engine.solve({
      rule,
      width: analysis.width,
      height: analysis.height,
      poses,
      parameters: analysis.parameters
    });
  };
  if (preset.aspectMode !== 'approximate') return { result: solveWithAspect(preset.aspect), effectiveAspect: preset.aspect };

  const candidates = [...new Set([preset.aspect, ...(preset.aspectCandidates || ['1:1', '3:4', '4:3', '9:16', '16:9'])])]
    .filter(aspect => SMART_CROP_ASPECTS.has(aspect));
  const attempts: Array<{ aspect: string; result: any; score: number }> = [];
  let firstError: any = null;
  for (const aspect of candidates) {
    try {
      const result = solveWithAspect(aspect);
      const bounds = result?.anatomy?.bounds;
      const naturalAspect = bounds && bounds.right > bounds.left && bounds.bottom > bounds.top
        ? (bounds.right - bounds.left) / (bounds.bottom - bounds.top)
        : smartCropAspectValue(preset.aspect);
      const preferredByShape = chooseApproximateAspect(naturalAspect, preset.aspect, candidates);
      const shapeScore = Math.abs(Math.log(smartCropAspectValue(aspect) / smartCropAspectValue(preferredByShape)));
      const missingPenalty = Math.max(0, Number(result?.canvas?.missing_area_fraction) || 0) * 20;
      const blockedPenalty = result?.blocked ? 100 : 0;
      const framingPenalty = result?.preference_applied === false ? 0.25 : 0;
      attempts.push({ aspect, result, score: blockedPenalty + missingPenalty + framingPenalty + shapeScore });
    } catch (error) {
      firstError ||= error;
    }
  }
  if (!attempts.length) throw firstError || new Error('近似比例没有可用候选');
  attempts.sort((left, right) => left.score - right.score);
  const selected = attempts[0];
  selected.result.warnings = [
    ...(Array.isArray(selected.result.warnings) ? selected.result.warnings : []),
    `近似比例：基于人体锚点与服装轮廓，从 ${candidates.join(' / ')} 中选择 ${selected.aspect}`
  ];
  return { result: selected.result, effectiveAspect: selected.aspect };
}

export function fitCropInsideSource(
  box: { left: number; top: number; right: number; bottom: number },
  naturalW: number,
  naturalH: number
) {
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  const scale = Math.min(1, naturalW / width, naturalH / height);
  const fittedWidth = Math.max(1, width * scale);
  const fittedHeight = Math.max(1, height * scale);
  const requestedCenterX = (box.left + box.right) / 2;
  const requestedCenterY = (box.top + box.bottom) / 2;
  const centerX = Math.min(naturalW - fittedWidth / 2, Math.max(fittedWidth / 2, requestedCenterX));
  const centerY = Math.min(naturalH - fittedHeight / 2, Math.max(fittedHeight / 2, requestedCenterY));
  return {
    left: centerX - fittedWidth / 2,
    top: centerY - fittedHeight / 2,
    right: centerX + fittedWidth / 2,
    bottom: centerY + fittedHeight / 2
  };
}

function posePoint(person: any, index: number) {
  const values = person?.pose_keypoints_2d;
  if (!Array.isArray(values)) return null;
  const point = { x: Number(values[index * 3]), y: Number(values[index * 3 + 1]), score: Number(values[index * 3 + 2]) };
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.score > 0.2 ? point : null;
}

function quantile(values: number[], ratio: number) {
  if (!values.length) return NaN;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * ratio));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function validContourRows(value: any, maxY: number, centerX: number, horizontalRadius: number) {
  return (Array.isArray(value) ? value : []).filter((row: any) => {
    if (!Array.isArray(row) || row.length < 4) return false;
    const left = Number(row[0]);
    const top = Number(row[1]);
    const right = Number(row[2]);
    const rowHeight = Number(row[3]);
    if (![left, top, right, rowHeight].every(Number.isFinite) || right <= left || rowHeight <= 0) return false;
    if (top > maxY) return false;
    return right >= centerX - horizontalRadius && left <= centerX + horizontalRadius;
  });
}

function reliableContourTop(rows: any[], minimumSpanWidth: number) {
  const widthsByTop = new Map<number, number>();
  for (const row of rows) {
    const top = Number(row[1]);
    const width = Number(row[2]) - Number(row[0]);
    widthsByTop.set(top, (widthsByTop.get(top) || 0) + width);
  }
  const substantialTops = [...widthsByTop.entries()]
    .filter(([, spanWidth]) => spanWidth >= minimumSpanWidth)
    .map(([top]) => top);
  if (substantialTops.length) return Math.min(...substantialTops);
  return Math.min(...rows.map((row: any) => Number(row[1])));
}

export function solveTightHeadshotCrop(analysis: any, preset: SmartCropPreset) {
  const width = Number(analysis?.width);
  const height = Number(analysis?.height);
  const people = (analysis?.parameters?.openpose_json || []).flatMap((frame: any) => frame?.people || []);
  if (!(width > 0 && height > 0) || !people.length) throw new Error('未识别到可用于头像裁切的人物');

  const candidates = people.map((person: any) => {
    const leftShoulder = posePoint(person, 5);
    const rightShoulder = posePoint(person, 2);
    const nose = posePoint(person, 0);
    const neck = posePoint(person, 1);
    const facePoints = [0, 14, 15, 16, 17].map(index => posePoint(person, index)).filter(Boolean);
    const confidence = [leftShoulder, rightShoulder, nose, neck, ...facePoints].filter(Boolean).reduce((sum: number, point: any) => sum + point.score, 0);
    return { person, leftShoulder, rightShoulder, nose, neck, facePoints, confidence };
  }).filter((candidate: any) => candidate.nose || candidate.facePoints.length >= 2);
  if (!candidates.length) throw new Error('缺少可靠的头部参考点');
  candidates.sort((a: any, b: any) => b.confidence - a.confidence);
  const primary = candidates[0];
  const personId = primary.person.person_id || 'P1';
  const faceXs = primary.facePoints.map((point: any) => point.x);
  const faceYs = primary.facePoints.map((point: any) => point.y);
  const faceCenterX = faceXs.length
    ? (Math.min(...faceXs) + Math.max(...faceXs)) / 2
    : primary.nose.x;
  const faceCenterY = faceYs.length
    ? (Math.min(...faceYs) + Math.max(...faceYs)) / 2
    : primary.nose.y;
  const faceWidth = faceXs.length >= 2
    ? Math.max(...faceXs) - Math.min(...faceXs)
    : Math.abs((primary.nose?.x || 0) - (primary.neck?.x || 0)) * 2;
  const headUnit = Math.max(1, faceWidth, primary.nose && primary.neck
    ? Math.hypot(primary.nose.x - primary.neck.x, primary.nose.y - primary.neck.y)
    : 0);
  const neckY = primary.neck?.y
    ?? (faceYs.length ? Math.max(...faceYs) + headUnit * 0.55 : faceCenterY + headUnit * 0.55);
  const shoulderTop = primary.leftShoulder && primary.rightShoulder
    ? Math.min(primary.leftShoulder.y, primary.rightShoulder.y)
    : primary.leftShoulder?.y ?? primary.rightShoulder?.y ?? Infinity;
  const headBandBottom = Math.min(shoulderTop, neckY + headUnit * 0.18);
  const horizontalRadius = Math.max(headUnit * 2.4, faceWidth * 3.2);
  const boundary = analysis?.parameters?.boundary || {};
  const semanticRows = validContourRows(boundary.person_head_row_spans?.[personId], headBandBottom, faceCenterX, horizontalRadius);
  const hairRows = validContourRows(boundary.person_part_row_spans?.[personId]?.hair, headBandBottom, faceCenterX, horizontalRadius);
  const fallbackRows = validContourRows(boundary.person_row_spans?.[personId], headBandBottom, faceCenterX, horizontalRadius);
  const rows = semanticRows.length ? semanticRows : fallbackRows;

  let headBounds: { left: number; top: number; right: number; bottom: number };
  if (rows.length) {
    const facePad = headUnit * 0.12;
    const hardHairLeft = hairRows.length ? Math.min(...hairRows.map((row: any) => Number(row[0]))) : Infinity;
    const hardHairTop = hairRows.length ? Math.min(...hairRows.map((row: any) => Number(row[1]))) : Infinity;
    const hardHairRight = hairRows.length ? Math.max(...hairRows.map((row: any) => Number(row[2]))) : -Infinity;
    headBounds = {
      left: Math.min(hardHairLeft, quantile(rows.map((row: any) => Number(row[0])), 0.01), Math.min(...faceXs, faceCenterX) - facePad),
      top: Number.isFinite(hardHairTop)
        ? hardHairTop
        : reliableContourTop(rows, Math.max(width * 0.008, headUnit * 0.08)),
      right: Math.max(hardHairRight, quantile(rows.map((row: any) => Number(row[2])), 0.99), Math.max(...faceXs, faceCenterX) + facePad),
      bottom: Math.min(headBandBottom, Math.max(neckY, quantile(rows.map((row: any) => Number(row[1]) + Number(row[3])), 0.99)))
    };
  } else {
    const fallbackHeadWidth = Math.max(headUnit * 1.35, faceWidth * 1.9, 1);
    const fallbackHeadHeight = Math.max(headUnit * 1.45, fallbackHeadWidth * 1.05);
    headBounds = {
      left: faceCenterX - fallbackHeadWidth / 2,
      top: faceCenterY - fallbackHeadHeight * 0.62,
      right: faceCenterX + fallbackHeadWidth / 2,
      bottom: Math.max(neckY, faceCenterY + fallbackHeadHeight * 0.38)
    };
  }

  const headWidth = Math.max(1, headBounds.right - headBounds.left);
  const structuralHeadHeight = Math.max(1, headUnit * 1.15, neckY - headBounds.top);
  const topMargin = Math.max(0, preset.headshot?.topMargin ?? 0.1);
  const minTopMargin = Math.min(topMargin, Math.max(0, preset.headshot?.minTopMargin ?? 0.06));
  const sideMargin = Math.max(0, preset.headshot?.sideMargin ?? 0.15);
  const shoulderDepth = Math.max(0, preset.headshot?.shoulderDepth ?? 0.4);
  const [aspectWidth, aspectHeight] = preset.aspect.split(':').map(Number);
  const ratio = aspectWidth > 0 && aspectHeight > 0 ? aspectWidth / aspectHeight : 1;
  const sidePadding = headWidth * sideMargin;
  const topPadding = structuralHeadHeight * topMargin;
  const protectedLeft = headBounds.left - sidePadding;
  const protectedRight = headBounds.right + sidePadding;
  const contextBottom = neckY + structuralHeadHeight * shoulderDepth;
  const contentWidth = protectedRight - protectedLeft;
  const contentHeight = Math.max(1, contextBottom - headBounds.top + topPadding);
  const maximumInSourceHeight = Math.min(height, width / ratio);
  const cropHeight = Math.min(Math.max(contentHeight, contentWidth / ratio), maximumInSourceHeight);
  const cropWidth = cropHeight * ratio;
  const minCenterX = protectedRight - cropWidth / 2;
  const maxCenterX = protectedLeft + cropWidth / 2;
  const centerX = minCenterX <= maxCenterX
    ? Math.min(maxCenterX, Math.max(minCenterX, faceCenterX))
    : (protectedLeft + protectedRight) / 2;
  const preferredTop = headBounds.top - topPadding;
  const minimumTopPadding = cropHeight * minTopMargin;
  const latestHairSafeTop = headBounds.top - minimumTopPadding;
  const contextAlignedTop = contextBottom - cropHeight;
  const top = preferredTop < 0
    ? Math.min(latestHairSafeTop, Math.max(0, contextAlignedTop))
    : preferredTop;
  return fitCropInsideSource({ left: centerX - cropWidth / 2, top, right: centerX + cropWidth / 2, bottom: top + cropHeight }, width, height);
}

export function normalizeSmartCropItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  if (typeof value === 'string' && value.trim()) return value.split(',').map(url => ({ url: url.trim() }));
  return [];
}

export function isSmartCropImageItem(item: any) {
  const url = typeof item === 'string' ? item : item?.url;
  return typeof url === 'string' && isReviewImage(url, item?.type) && !/\.(svg|pdf|ai|psd|psb)([?#]|$)/i.test(url);
}

export async function solveSmartCropTargets(
  targets: SmartCropTarget[],
  presetId: string,
  onProgress?: (progress: { completed: number; total: number; target: SmartCropTarget; status: 'processing' | 'done' | 'failed'; error?: string }) => void,
  overrides?: SmartCropOverrides | null
) {
  const presets = await listSmartCropPresets();
  const basePreset = presets.find(item => item.id === presetId);
  if (!basePreset) throw new Error(`未知智能裁切预设: ${presetId}`);
  const preset = applySmartCropOverrides(basePreset, overrides);
  const engine = preset.strategy === 'tight_headshot' ? null : await getEngine();
  const changes: SmartCropChange[] = [];
  const failures: Array<SmartCropTarget & { error: string }> = [];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    onProgress?.({ completed: targetIndex, total: targets.length, target, status: 'processing' });
    try {
      const url = typeof target.item === 'string' ? target.item : target.item?.url;
      if (!url || !isSmartCropImageItem(target.item)) throw new Error('目标不是可识别的图片附件');
      let analysis = await recognize(url);
      const poses = analysis?.parameters?.openpose_json;
      if (!Array.isArray(poses) || !poses.some((frame: any) => frame?.people?.length)) throw new Error('未识别到可靠人物');

      const extraWarnings: string[] = [];
      if (preset.needsContour !== false && !analysis?.parameters?.boundary?.matched) {
        try {
          const seg = await segment(url);
          analysis = mergePoseAndSegmentation(analysis, seg);
        } catch (segError: any) {
          extraWarnings.push(`轮廓分割未就绪（${segError?.message || '已降级'}），已自动退回骨骼关键点裁切`);
        }
      }

      let crop: any;
      let warnings: string[] = [];
      let effectiveAspect = preset.aspect;
      if (preset.strategy === 'tight_headshot') {
        crop = solveTightHeadshotCrop(analysis, preset);
        warnings = [
          analysis?.parameters?.boundary?.matched
            ? '紧凑头像策略：已结合人像轮廓保留头发和面部，肩部仅作下沿参考'
            : '紧凑头像策略：完整保留头发和面部；肩部仅作下沿构图参考，允许截断',
          ...extraWarnings
        ];
      } else {
        const solved = solveAnatomyCrop(engine!, analysis, poses, preset);
        const result = solved.result;
        effectiveAspect = solved.effectiveAspect;
        warnings = [...(Array.isArray(result.warnings) ? result.warnings.map(String) : []), ...extraWarnings];
        crop = result.crop;
        if (result.blocked) {
          if (!preset.allow_virtual && crop) {
            crop = fitCropInsideSource(crop, analysis.width, analysis.height);
            warnings.push('理想画幅超出原图，已保持比例自动收缩到原图范围内');
          } else {
            throw new Error('人物范围与裁切规则冲突，无法生成安全画幅');
          }
        } else if (!preset.allow_virtual && crop && (
          crop.left < 0 || crop.top < 0 || crop.right > analysis.width || crop.bottom > analysis.height
        )) {
          crop = fitCropInsideSource(crop, analysis.width, analysis.height);
          warnings.push('裁切框已保持比例平移到原图范围内');
        }
      }
      changes.push({
        ...target,
        warnings,
        cropData: pixelBoxToGridCropData(crop, analysis.width, analysis.height, {
          presetId,
          overrides: overrides || undefined,
          effectiveAspect,
          aspectMode: preset.aspectMode || 'fixed',
          warnings
        })
      });
      onProgress?.({ completed: targetIndex + 1, total: targets.length, target, status: 'done' });
    } catch (error: any) {
      const message = error?.message || String(error);
      failures.push({ ...target, error: message });
      onProgress?.({ completed: targetIndex + 1, total: targets.length, target, status: 'failed', error: message });
    }
  }
  return { preset, overrides: overrides || null, changes, failures, total: targets.length };
}

export function buildSmartCropCellUpdates(changes: SmartCropChange[], records: any[]) {
  const byCell = new Map<string, SmartCropChange[]>();
  for (const change of changes) {
    const key = `${change.rowId}\u0000${change.fieldId}`;
    byCell.set(key, [...(byCell.get(key) || []), change]);
  }
  const updates: Array<{ recordId: string; fieldId: string; value: any }> = [];
  for (const [key, cellChanges] of byCell) {
    const [recordId, fieldId] = key.split('\u0000');
    const record = records.find(item => item.id === recordId);
    if (!record) continue;
    const items = normalizeSmartCropItems(record[fieldId]).map((item, index) => {
      const change = cellChanges.find(value => value.index === index);
      if (!change) return item;
      const base = typeof item === 'string' ? { url: item } : item;
      return { ...base, cropData: change.cropData };
    });
    updates.push({ recordId, fieldId, value: items });
  }
  return updates;
}
