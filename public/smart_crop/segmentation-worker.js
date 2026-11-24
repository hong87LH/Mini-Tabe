let segmenter = null;
let modelInfo = null;
const visionWasmCdn = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const report = text => postMessage({ type: 'status', text });

async function ready(preferred) {
  if (segmenter) return;
  const { loadSegmentationModel } = self.__SegModelCache
    || await import(new URL('./segmentation-model-cache.js', self.location.href).href);
  const asset = await loadSegmentationModel(preferred, report);
  const { ImageSegmenter, FilesetResolver } = self.__Vision
    || await import(new URL('./vendor/vision_bundle.mjs', self.location.href).href);
  report('加载或读取缓存中的轮廓分割运行时');
  const files = self.__MAKE_WASM_FILESET
    ? await self.__MAKE_WASM_FILESET(FilesetResolver)
    : await FilesetResolver.forVisionTasks(visionWasmCdn);
  report('初始化独立轮廓分割引擎');
  // Deliberately use single-mask categoryMask (Uint8Array) and disable confidenceMasks
  // to stay off PoseLandmarker/ImageSegmenter's Float32Array vector mask callback path.
  segmenter = await ImageSegmenter.createFromOptions(files, {
    baseOptions: {
      modelAssetBuffer: new Uint8Array(asset.bytes),
      delegate: 'CPU'
    },
    runningMode: 'IMAGE',
    outputCategoryMask: true,
    outputConfidenceMasks: false
  });
  modelInfo = {
    modelId: asset.modelId,
    model: asset.model,
    kind: asset.kind,
    source: asset.source,
    storage: asset.storage,
    delegate: 'WASM CPU',
    wasmSource: visionWasmCdn
  };
  postMessage({ type: 'ready', info: modelInfo });
}

let sequence = Promise.resolve();

onmessage = event => {
  const message = event.data;
  sequence = sequence.catch(() => {}).then(async () => {
    try {
      await ready(message.preferred);
      if (message.type === 'init') {
        postMessage({ id: message.id, type: 'result', value: modelInfo });
        return;
      }
      report('正在生成人像轮廓蒙版');
      const started = performance.now();
      let maskCopy = null;
      let maskWidth = 0;
      let maskHeight = 0;
      segmenter.segment(message.image, result => {
        try {
          const categoryMask = result?.categoryMask;
          if (categoryMask) {
            maskWidth = categoryMask.width;
            maskHeight = categoryMask.height;
            const raw = categoryMask.getAsUint8Array();
            maskCopy = new Uint8Array(raw.length);
            maskCopy.set(raw);
          }
        } finally {
          result?.close?.();
        }
      });
      message.image?.close?.();
      if (!maskCopy || !(maskWidth > 0 && maskHeight > 0)) {
        throw new Error('轮廓分割模型未返回有效分类蒙版');
      }
      const value = {
        mask: maskCopy,
        maskWidth,
        maskHeight,
        width: message.width,
        height: message.height,
        modelKind: modelInfo.kind,
        modelInfo,
        timing: {
          total_ms: Math.round(performance.now() - started),
          cache_note: '独立 Worker 本地轮廓分割；图片未上传'
        }
      };
      report('轮廓蒙版生成完成');
      postMessage({ id: message.id, type: 'result', value }, [maskCopy.buffer]);
    } catch (error) {
      message.image?.close?.();
      if (/Aborted|memory access|out of bounds|unreachable/i.test(String(error?.message || ''))) {
        try { segmenter?.close?.(); } catch {}
        segmenter = null;
        modelInfo = null;
      }
      postMessage({ id: message.id, type: 'error', error: error?.message || String(error) });
    }
  });
};
