export const SEGMENTATION_MODELS = [
  {
    id: 'selfie-multiclass-256x256',
    name: 'MediaPipe Selfie Multiclass 256x256',
    kind: 'multiclass',
    minBytes: 1_000_000,
    maxBytes: 40_000_000,
    sources: [
      {
        name: 'Google 官方 (Multiclass)',
        url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
      }
    ]
  },
  {
    id: 'selfie-segmenter-float16',
    name: 'MediaPipe Selfie Segmenter Float16',
    kind: 'binary',
    minBytes: 100_000,
    maxBytes: 10_000_000,
    sources: [
      {
        name: 'Google 官方 (Selfie Binary)',
        url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
      }
    ]
  }
];

function validateModelBytes(bytes, spec) {
  if (!bytes || bytes.byteLength < spec.minBytes || bytes.byteLength > spec.maxBytes) {
    throw new Error(`分割模型 ${spec.id} 文件大小异常 (${bytes?.byteLength || 0} bytes)`);
  }
  return bytes;
}

export async function loadSegmentationModel(preferred = 'multiclass', report = () => {}) {
  const ordered = preferred === 'binary'
    ? [...SEGMENTATION_MODELS].reverse()
    : SEGMENTATION_MODELS;
  const errors = [];

  for (const spec of ordered) {
    for (const source of spec.sources) {
      try {
        report(`下载或读取 HTTP 缓存中的轮廓分割模型 · ${source.name}`);
        const response = await fetch(source.url, { cache: 'force-cache', credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = validateModelBytes(await response.arrayBuffer(), spec);
        return {
          bytes,
          modelId: spec.id,
          model: spec.name,
          kind: spec.kind,
          source: source.name,
          storage: 'Chromium HTTP Cache'
        };
      } catch (error) {
        errors.push(`${source.name}: ${error.message}`);
      }
    }
  }

  throw new Error(`轮廓分割模型下载失败。${errors.join('；')}`);
}
