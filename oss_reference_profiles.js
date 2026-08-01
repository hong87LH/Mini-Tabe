export const OSS_REFERENCE_PROFILES = {
  'legacy-webp-q90-v1': {
    id: 'legacy-webp-q90-v1',
    prefix: 'references-node',
    csvFilename: 'oss_references_node.csv',
    cloudCsvPath: 'references-node/oss_references_node.csv',
    format: 'webp',
    quality: 90,
    preserveDimensions: true,
    useDHashAutoReuse: true
  },

  'gemini-jpeg-q95-v1': {
    id: 'gemini-jpeg-q95-v1',
    prefix: 'references-node-gemini-jpeg-v1',
    csvFilename: 'oss_references_gemini_jpeg_node.csv',
    cloudCsvPath: 'references-node-gemini-jpeg-v1/oss_references_gemini_jpeg_node.csv',
    format: 'jpeg',
    quality: 95,
    chromaSubsampling: '4:4:4',
    preserveDimensions: true,
    useDHashAutoReuse: false
  }
};

export function getOssReferenceProfile(id) {
  return (
    OSS_REFERENCE_PROFILES[id] ||
    OSS_REFERENCE_PROFILES['legacy-webp-q90-v1']
  );
}
