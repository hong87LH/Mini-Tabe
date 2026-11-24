export const MODEL = {
  id: 'pose-full-4eaa5eb7',
  sha256: '4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad',
  size: 9398198
};

const modelPath = 'spaces/pollen-robotics/red_light_green_light/resolve/646f37439db94d42d70c76811299b95e223be322/reachy_mini_red_light_green_light/pose_landmarker_full.task';
const sources = [
  { name: '国内 HF-Mirror', url: `https://hf-mirror.com/${modelPath}` },
  { name: 'Google 官方', url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task' },
  { name: 'Hugging Face', url: `https://huggingface.co/${modelPath}` }
];
export async function verify(bytes) {
  if (bytes.byteLength !== MODEL.size) throw new Error('姿态模型长度不符');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== MODEL.sha256) throw new Error('姿态模型 SHA-256 不符，拒绝使用');
  return bytes;
}

export async function loadModel(_preferred = 'cloud', report = () => {}) {
  const errors = [];
  for (const source of sources) {
    try {
      report(`下载或读取 HTTP 缓存中的姿态模型 · ${source.name}`);
      const response = await fetch(source.url, { cache: 'force-cache', credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await verify(await response.arrayBuffer());
      return { bytes, source: source.name, storage: 'Chromium HTTP Cache' };
    } catch (error) {
      errors.push(`${source.name}: ${error.message}`);
    }
  }
  throw new Error(`姿态模型云下载失败。${errors.join('；')}`);
}
