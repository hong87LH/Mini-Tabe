// Shared by the image UI and provider adapters. Missing settings preserve legacy defaults.
export function normalizeImageControls(params = {}) {
  const modeAliases = { auto: 'standard', high: 'enhanced', standard: 'standard', '标准': 'standard', enhanced: 'enhanced', '增强': 'enhanced' };
  const qualityAliases = { auto: 'auto', '自动': 'auto', high: 'high', '高': 'high', max: 'max', '极致': 'max' };
  const mode = modeAliases[String(params.mode || 'standard').trim().toLowerCase()];
  const quality = qualityAliases[String(params.quality || 'auto').trim().toLowerCase()];
  if (!mode) throw new Error('图片生成模式须为 auto 或 high');
  if (!quality) throw new Error('图片画质须为 auto、high（高）或 max（极致）');
  return { mode, quality };
}

export const isNano2ImageModel = model => ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image', 'banana-2'].includes(normalizeLingwuModelName(model));
export const isTT25ImageModel = model => /^tt-image-2\.5(?:-flare|-sunburst)?$/.test(normalizeLingwuModelName(model));

export function buildImageControlParams(model, params = {}, protocol = 'media') {
  const controls = normalizeImageControls(params);
  if (isNano2ImageModel(model)) {
    const thinkingLevel = controls.mode === 'enhanced' ? 'high' : 'minimal';
    return protocol === 'gemini' ? { thinkingConfig: { thinkingLevel } } : { thinkingLevel };
  }
  if (isTT25ImageModel(model)) {
    // An explicitly selected variant remains the default until the user selects a mode.
    const version = params.mode ? (controls.mode === 'enhanced' ? 'sunburst' : 'flare')
      : normalizeLingwuModelName(model).endsWith('-sunburst') ? 'sunburst' : 'flare';
    return { version, quality: controls.quality };
  }
  // Unknown models keep explicit values; legacy tables do not gain new request keys.
  return { ...(params.mode ? { mode: controls.mode === 'enhanced' ? 'high' : 'auto' } : {}), ...(params.quality ? { quality: controls.quality } : {}) };
}

export const LEGACY_LINGWU_PROFILE = {
  id: 'legacy-lingwu-image-v1',
  requestMode: 'legacy-size',
  referenceProfileId: 'legacy-webp-q90-v1'
};

export const LINGWU_IMAGE_MODEL_PROFILES = {
  'doubao-seedream-5-0-260128': {
    id: 'lingwu-doubao-seedream-5',
    requestMode: 'jimeng',
    referenceProfileId: 'legacy-webp-q90-v1',
    allowedImageSizes: ['2K', '3K'],
  },
  'gemini-3-pro-image-preview': {
    id: 'lingwu-gemini-pro-v1',
    requestMode: 'gemini-media',
    referenceProfileId: 'gemini-jpeg-q95-v1',
    allowedImageSizes: ['1K', '2K', '4K'],
    allowedAspectRatios: [
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9'
    ],
    maxReferenceImages: 14
  },

  'gemini-3.1-flash-image-preview': {
    id: 'lingwu-gemini-flash-v1',
    requestMode: 'gemini-media',
    referenceProfileId: 'gemini-jpeg-q95-v1',
    allowedImageSizes: ['1K', '2K', '4K'],
    allowedAspectRatios: [
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9'
    ],
    maxReferenceImages: 14
  }
};

export function normalizeLingwuModelName(model) {
  return String(model || '')
    .trim()
    .toLowerCase();
}

export function getLingwuImageModelProfile(model) {
  if (isNano2ImageModel(model)) return { ...LINGWU_IMAGE_MODEL_PROFILES['gemini-3.1-flash-image-preview'], allowedImageSizes: ['0.5K','1K','2K','4K'] };
  return (
    LINGWU_IMAGE_MODEL_PROFILES[
      normalizeLingwuModelName(model)
    ] ||
    LEGACY_LINGWU_PROFILE
  );
}

export function normalizeGeminiImageSize(imageSize, profile = {}) {
  if (!imageSize) return '1K';
  const upper = String(imageSize).toUpperCase();
  if ((profile.allowedImageSizes || ['1K', '2K', '4K']).includes(upper)) return upper;
  return '1K';
}

export function normalizeGeminiAspectRatio(aspectRatio, profile) {
  if (!aspectRatio) return '1:1';
  const allowed = profile.allowedAspectRatios || ['1:1'];
  if (allowed.includes(aspectRatio)) return aspectRatio;
  // If not exactly matching, we could map it, but for now just fallback to 1:1 or return as is?
  // The plan just says `normalizeGeminiAspectRatio`.
  return aspectRatio; // Assuming exact match or let server handle
}

export function buildLegacyLingwuParams(input) {
  const params = { ...input };
  if (params.imageSize && params.aspectRatio && !params.size) {
      const key = `${params.imageSize}_${params.aspectRatio}`.toLowerCase();
      const EXACT_MAP = {
          "1k_1:1":  "1024x1024",
          "1k_2:3":  "1024x1536",
          "1k_3:2":  "1536x1024",
          "1k_3:4":  "960x1280",
          "1k_4:3":  "1280x960",
          "1k_9:16": "1088x1920",
          "1k_16:9": "1920x1088",
          "2k_1:1":  "2048x2048",
          "2k_2:3":  "2048x3072",
          "2k_3:2":  "3072x2048",
          "2k_3:4":  "1920x2560",
          "2k_4:3":  "2560x1920",
          "2k_9:16": "1440x2560",
          "2k_16:9": "2560x1440",
          "4k_1:1":  "2880x2880",
          "4k_2:3":  "2304x3456",
          "4k_3:2":  "3456x2304",
          "4k_3:4":  "2400x3200",
          "4k_4:3":  "3200x2400",
          "4k_9:16": "2160x3840",
          "4k_16:9": "3840x2160",
      };
      const APPROX_MAP = {
          "1k_21:9": "1920x1088",
          "1k_4:5":  "960x1280",
          "1k_5:4":  "1280x960",
          "1k_1:2":  "1024x1536",
          "1k_2:1":  "1536x1024",
          "2k_21:9": "2560x1440",
          "2k_4:5":  "1920x2560",
          "2k_5:4":  "2560x1920",
          "4k_21:9": "3840x2160",
          "4k_4:5":  "2400x3200",
          "4k_5:4":  "3200x2400",
      };
      params.size = EXACT_MAP[key] || APPROX_MAP[key] || (params.imageSize.includes('x') ? params.imageSize : "auto");
      delete params.imageSize;
      delete params.aspectRatio;
  }
  return params;
}


export function convert_to_jimeng(input) {
  const JIMENG_SIZE_MAP_5 = {
    "0.5K": "2K",
    "1K":   "2K",
    "2K":   "2K",
    "3K":   "3K",
    "4K":   "3K",
  };
  
  const params = { ...input };
  if (params.imageSize) {
    let sizeKey = String(params.imageSize).toUpperCase();
    params.size = JIMENG_SIZE_MAP_5[sizeKey] || "2K"; // Default to 2K if unknown
    delete params.imageSize;
  }
  if (params.aspectRatio) {
    params.aspect_ratio = params.aspectRatio;
    delete params.aspectRatio;
  }
  return params;
}

export function buildLingwuImageParams({ model, params }) {
  const profile = getLingwuImageModelProfile(model);
  const input = { ...(params || {}) };
  
  const controlParams = buildImageControlParams(model, input);
  delete input.mode;
  delete input.quality;
  Object.assign(input, controlParams);


  if (profile.requestMode === 'gemini-media') {
    const imageSize = normalizeGeminiImageSize(input.imageSize, profile);
    const aspectRatio = normalizeGeminiAspectRatio(input.aspectRatio, profile);
    return {
      ...input,
      imageSize,
      aspectRatio
    };
  }

  if (profile.requestMode === 'jimeng') {
    return convert_to_jimeng(input);
  }

  return buildLegacyLingwuParams(input);
}
