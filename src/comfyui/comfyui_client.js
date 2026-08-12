import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteWorkflowValue,
  listComfyUIWorkflows,
  loadComfyUIWorkflow,
  resolveWorkflowPluginRequirements,
  setWorkflowValue
} from './workflow_registry.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus']);

function normalizeLocalReference(value) {
  let normalized = String(value || '').trim();
  if (/^file:\/\//i.test(normalized)) {
    try {
      return fileURLToPath(normalized);
    } catch {
      normalized = decodeURIComponent(normalized.replace(/^file:\/\//i, ''));
    }
  }
  if (/^local-img:\/\//i.test(normalized)) {
    normalized = decodeURIComponent(normalized.replace(/^local-img:\/\//i, ''));
  } else if (/^local-video:\/\//i.test(normalized)) {
    normalized = decodeURIComponent(normalized.replace(/^local-video:\/\//i, ''));
  } else if (/^local-audio:\/\//i.test(normalized)) {
    normalized = decodeURIComponent(normalized.replace(/^local-audio:\/\//i, ''));
  }
  if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
  return normalized;
}

function randomSeed() {
  return crypto.randomBytes(6).readUIntBE(0, 6);
}

function normalizeAspectRatio(value, manifest) {
  const cleaned = String(value || manifest.defaults?.aspectRatio || '16:9')
    .replace(/：/g, ':')
    .trim();
  const mapped = manifest.maps?.aspectRatio?.[cleaned];
  if (!mapped) throw new Error(`工作流 ${manifest.id} 不支持画幅 ${cleaned}`);
  return mapped;
}

function parseAspectRatio(value, manifest) {
  const cleaned = String(value || manifest.defaults?.aspectRatio || '16:9')
    .replace(/：/g, ':')
    .trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`工作流 ${manifest.id} 无法按画幅 ${cleaned} 计算清晰度`);
  const widthRatio = Number(match[1]);
  const heightRatio = Number(match[2]);
  if (!(widthRatio > 0) || !(heightRatio > 0)) {
    throw new Error(`工作流 ${manifest.id} 的画幅无效：${cleaned}`);
  }
  return { widthRatio, heightRatio };
}

function megapixelsForShortSide(shortSide, aspectRatio, manifest) {
  const { widthRatio, heightRatio } = parseAspectRatio(aspectRatio, manifest);
  const longToShort = Math.max(widthRatio, heightRatio) / Math.min(widthRatio, heightRatio);
  return Number(((shortSide * shortSide * longToShort) / 1_000_000).toFixed(6));
}

export function normalizeComfyUIMegapixels(value, aspectRatio, manifest) {
  const input = value ?? manifest.defaults?.resolution ?? '720P';
  const raw = String(input).trim().toUpperCase().replace(/\s+/g, '');

  const tierShortSide = manifest.maps?.resolutionTiers?.[raw];
  if (tierShortSide !== undefined) {
    return megapixelsForShortSide(Number(tierShortSide), aspectRatio, manifest);
  }

  // 兼容引用字段中的 0.3、0.7、0.78MP 等原始百万像素值。
  const numericMatch = raw.match(/^(\d+(?:\.\d+)?)(?:MP)?$/);
  if (numericMatch) {
    const megapixels = Number(numericMatch[1]);
    const min = Number(manifest.maps?.rawMegapixels?.min ?? 0.1);
    const max = Number(manifest.maps?.rawMegapixels?.max ?? 16);
    if (Number.isFinite(megapixels) && megapixels >= min && megapixels <= max) {
      return megapixels;
    }
    throw new Error(`工作流 ${manifest.id} 的百万像素值需在 ${min}-${max}MP 之间：${value}`);
  }

  // 兼容仍使用固定 resolution 映射的其他 manifest。
  const legacyMapped = manifest.maps?.resolution?.[raw];
  if (legacyMapped !== undefined) return legacyMapped;

  const tiers = Object.keys(manifest.maps?.resolutionTiers || {});
  throw new Error(`工作流 ${manifest.id} 不支持清晰度 ${value}。可用档位：${tiers.join(', ')}；也可输入原始 MP 数字`);
}

function normalizeDuration(value, manifest) {
  const duration = Number(value ?? manifest.defaults?.duration ?? 5);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30) {
    throw new Error(`无效的视频时长：${value}`);
  }
  return duration;
}

function collectOutputFiles(outputs) {
  const files = [];
  for (const [nodeId, nodeOutput] of Object.entries(outputs || {})) {
    for (const value of Object.values(nodeOutput || {})) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item === 'object' && item.filename) {
          files.push({ nodeId, ...item });
        }
      }
    }
  }
  return files;
}

export class ComfyUIClient {
  constructor(_apiKey, endpoint) {
    this.endpoint = String(endpoint || 'http://127.0.0.1:8188').replace(/\/+$/, '');
  }

  async request(pathname, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.endpoint}${pathname}`, {
        ...options,
        signal: controller.signal
      });
      if (!response.ok) {
        const details = await response.text().catch(() => '');
        const error = new Error(`ComfyUI HTTP ${response.status}: ${details || response.statusText}`);
        error.httpStatus = response.status;
        throw error;
      }
      return response;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`连接 ComfyUI 超时：${this.endpoint}`);
      }
      if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED') {
        throw new Error(`无法连接 ComfyUI：${this.endpoint}，请先启动 ComfyUI`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(modelName = null) {
    const system = await (await this.request('/system_stats')).json();
    let workflow = null;
    if (modelName) {
      const loaded = loadComfyUIWorkflow(modelName, 'fast');
      const missingNodeTypes = [];
      for (const nodeType of loaded.manifest.requiredNodeTypes || []) {
        const response = await fetch(`${this.endpoint}/object_info/${encodeURIComponent(nodeType)}`);
        if (!response.ok) missingNodeTypes.push(nodeType);
      }
      workflow = {
        id: loaded.manifest.id,
        name: loaded.manifest.name,
        missingNodeTypes,
        requiredPlugins: resolveWorkflowPluginRequirements(loaded.manifest, loaded.mode),
        missingPlugins: resolveWorkflowPluginRequirements(loaded.manifest, loaded.mode)
          .map(plugin => ({
            ...plugin,
            missingNodeTypes: (plugin.providedNodeTypes || []).filter(nodeType => missingNodeTypes.includes(nodeType))
          }))
          .filter(plugin => plugin.missingNodeTypes.length > 0)
      };
    }
    return {
      ok: true,
      endpoint: this.endpoint,
      comfyuiVersion: system?.system?.comfyui_version,
      device: system?.devices?.[0]?.name,
      workflow,
      registeredWorkflows: listComfyUIWorkflows()
    };
  }

  async readReference(reference) {
    const value = String(reference || '').trim();
    if (!value) throw new Error('素材地址为空');

    if (/^https?:\/\//i.test(value)) {
      const response = await this.requestAbsolute(value, {}, 120000);
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const urlPath = new URL(value).pathname;
      return { buffer, contentType, filename: path.basename(urlPath) || 'reference.bin' };
    }

    if (/^data:/i.test(value)) {
      const match = value.match(/^data:([^;,]+);base64,(.+)$/s);
      if (!match) throw new Error('不支持的 data URL 素材格式');
      const extension = match[1].split('/')[1] || 'bin';
      return {
        buffer: Buffer.from(match[2], 'base64'),
        contentType: match[1],
        filename: `reference.${extension}`
      };
    }

    const localPath = normalizeLocalReference(value);
    if (!fs.existsSync(localPath)) throw new Error(`本地素材不存在：${localPath}`);
    const extension = path.extname(localPath).toLowerCase();
    const contentType = extension === '.png' ? 'image/png'
      : extension === '.webp' ? 'image/webp'
      : extension === '.gif' ? 'image/gif'
      : extension === '.mp4' ? 'video/mp4'
      : extension === '.webm' ? 'video/webm'
      : extension === '.mov' ? 'video/quicktime'
      : extension === '.wav' ? 'audio/wav'
      : extension === '.mp3' ? 'audio/mpeg'
      : extension === '.flac' ? 'audio/flac'
      : extension === '.m4a' ? 'audio/mp4'
      : extension === '.ogg' || extension === '.opus' ? 'audio/ogg'
      : 'image/jpeg';
    return {
      buffer: await fs.promises.readFile(localPath),
      contentType,
      filename: path.basename(localPath)
    };
  }

  async requestAbsolute(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`下载远程素材失败 HTTP ${response.status}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async uploadMedia(reference, mediaType = 'image') {
    const source = await this.readReference(reference);
    const fallback = mediaType === 'video' ? '.mp4' : mediaType === 'audio' ? '.wav' : '.jpg';
    const extension = path.extname(source.filename) || fallback;
    const safeFilename = `reference_${mediaType}_${crypto.randomUUID()}${extension.toLowerCase()}`;
    const form = new FormData();
    // ComfyUI 的 /upload/image 是通用 input 文件上传入口，LoadVideo/LoadAudio 也从 input 目录读取。
    form.append('image', new Blob([source.buffer], { type: source.contentType }), safeFilename);
    form.append('type', 'input');
    form.append('subfolder', 'lingwu_comfyui');
    form.append('overwrite', 'true');
    const response = await this.request('/upload/image', { method: 'POST', body: form }, 120000);
    const result = await response.json();
    const uploadedName = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    if (!uploadedName) throw new Error(`ComfyUI 上传素材未返回文件名：${JSON.stringify(result)}`);
    return uploadedName.replace(/\\/g, '/');
  }

  async uploadImage(reference) {
    return this.uploadMedia(reference, 'image');
  }

  async createTask(model, prompt, params = {}, _count = 1) {
    let loaded = loadComfyUIWorkflow(model, params.mode);
    let { manifest } = loaded;
    const merged = { ...(manifest.defaults || {}), ...(params || {}) };
    const images = Array.isArray(merged.images) ? merged.images.filter(Boolean) : [];
    const videos = Array.isArray(merged.videos) ? merged.videos.filter(Boolean) : [];
    const audio = Array.isArray(merged.audio) ? merged.audio.filter(Boolean) : [];
    const modalityCount = [images, videos, audio].filter(items => items.length > 0).length;
    const requestedMode = String(params.mode || manifest.defaults?.mode || 'fast').toLowerCase();
    const mixedMode = manifest.routing?.mixedModalitiesMode;
    if (mixedMode && modalityCount > 1 && !['quality', 'pro', 'original'].includes(requestedMode)) {
      loaded = loadComfyUIWorkflow(model, mixedMode);
      manifest = loaded.manifest;
    }
    const { workflow, mode } = loaded;
    const minImages = Number(manifest.capabilities?.inputImages?.min || 0);
    const maxImages = Number(manifest.capabilities?.inputImages?.max || 0);
    if (images.length < minImages || images.length > maxImages) {
      throw new Error(`${manifest.name} 需要 ${minImages}-${maxImages} 张输入图片，当前为 ${images.length} 张`);
    }
    const minVideos = Number(manifest.capabilities?.inputVideos?.min || 0);
    const maxVideos = Number(manifest.capabilities?.inputVideos?.max || 0);
    const minAudio = Number(manifest.capabilities?.inputAudio?.min || 0);
    const maxAudio = Number(manifest.capabilities?.inputAudio?.max || 0);
    if (videos.length < minVideos || videos.length > maxVideos) throw new Error(`${manifest.name} 需要 ${minVideos}-${maxVideos} 个参考视频，当前为 ${videos.length} 个`);
    if (audio.length < minAudio || audio.length > maxAudio) throw new Error(`${manifest.name} 需要 ${minAudio}-${maxAudio} 个参考音频，当前为 ${audio.length} 个`);
    if (manifest.capabilities?.minTotalReferences && images.length + videos.length + audio.length < Number(manifest.capabilities.minTotalReferences)) {
      throw new Error(`${manifest.name} 至少需要 ${manifest.capabilities.minTotalReferences} 个图片、视频或音频参考素材`);
    }

    const uploadedImages = [];
    for (const image of images) uploadedImages.push(await this.uploadImage(image));
    const uploadedVideos = [];
    for (const video of videos) uploadedVideos.push(await this.uploadMedia(video, 'video'));
    const uploadedAudio = [];
    for (const audioReference of audio) uploadedAudio.push(await this.uploadMedia(audioReference, 'audio'));

    let finalPrompt = String(prompt || '').trim();
    if (manifest.routing?.type === 'reference-multimodal') {
      const tags = [
        ...uploadedImages.map((_, index) => `<Picture ${index + 1}>`),
        ...uploadedVideos.map((_, index) => `<Video ${index + 1}>`),
        ...uploadedAudio.map((_, index) => `<Audio ${index + 1}>`)
      ];
      const missingTags = tags.filter(tag => !finalPrompt.includes(tag));
      if (missingTags.length) finalPrompt = `${missingTags.join(' ')} Use the referenced media as identity, motion, style and sound guidance. ${finalPrompt}`.trim();
    }
    setWorkflowValue(workflow, manifest.bindings.prompt, finalPrompt);
    setWorkflowValue(workflow, manifest.bindings.aspectRatio, normalizeAspectRatio(merged.aspectRatio || merged.aspect_ratio, manifest));
    setWorkflowValue(
      workflow,
      manifest.bindings.megapixels,
      normalizeComfyUIMegapixels(
        merged.resolution ?? merged.imageSize,
        merged.aspectRatio || merged.aspect_ratio,
        manifest
      )
    );
    setWorkflowValue(workflow, manifest.bindings.duration, normalizeDuration(merged.duration, manifest));
    setWorkflowValue(workflow, manifest.bindings.seed, Number.isSafeInteger(Number(merged.seed)) && Number(merged.seed) >= 0 ? Number(merged.seed) : randomSeed());

    const outputToken = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    setWorkflowValue(workflow, manifest.bindings.outputPrefix, `video/lingwu_comfyui/${manifest.id}/${outputToken}`);
    if (manifest.bindings.firstImage && uploadedImages[0]) {
      setWorkflowValue(workflow, manifest.bindings.firstImage, uploadedImages[0]);
    } else if (manifest.bindings.firstImage && manifest.secondImage) {
      delete workflow['136'];
      deleteWorkflowValue(workflow, `${manifest.secondImage.conditioningNodeId}.inputs.first_frame`);
    }

    if (uploadedImages[1] && manifest.secondImage) {
      workflow[manifest.secondImage.loadNodeId] = {
        inputs: { image: uploadedImages[1] },
        class_type: 'LoadImage',
        _meta: { title: '第二张输入图片' }
      };
      workflow[manifest.secondImage.conditioningNodeId].inputs[manifest.secondImage.conditioningInput] = [
        manifest.secondImage.loadNodeId,
        0
      ];
    }

    if (manifest.routing?.type === 'reference-multimodal') {
      const conditioningNodeId = String(manifest.routing.conditioningNodeId);
      const conditioning = workflow[conditioningNodeId];
      if (!conditioning?.inputs) throw new Error(`多参路由节点不存在：${conditioningNodeId}`);
      uploadedImages.forEach((filename, index) => {
        const nodeId = String(Number(manifest.routing.dynamicNodeBase || 200) + index);
        workflow[nodeId] = { inputs: { image: filename }, class_type: 'LoadImage', _meta: { title: `参考图片 ${index + 1}` } };
        conditioning.inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
      });
      uploadedVideos.forEach((filename, index) => {
        const loadId = String(Number(manifest.routing.dynamicNodeBase || 200) + 20 + index * 2);
        const splitId = String(Number(manifest.routing.dynamicNodeBase || 200) + 21 + index * 2);
        workflow[loadId] = { inputs: { file: filename }, class_type: 'LoadVideo', _meta: { title: `参考视频 ${index + 1}` } };
        workflow[splitId] = { inputs: { video: [loadId, 0] }, class_type: 'GetVideoComponents', _meta: { title: `拆分参考视频 ${index + 1}` } };
        conditioning.inputs[`ref_videos.ref_video_${index}`] = [splitId, 0];
        // 当前 Turbo 插件中同时连接配套视频音轨会触发张量分段冲突，故仅路由视频帧。
      });
      uploadedAudio.forEach((filename, index) => {
        const nodeId = String(Number(manifest.routing.dynamicNodeBase || 200) + 50 + index);
        workflow[nodeId] = { inputs: { audio: filename }, class_type: 'LoadAudio', _meta: { title: `参考音频 ${index + 1}` } };
        conditioning.inputs[`ref_audios.ref_audio_${index}`] = [nodeId, 0];
      });

      const turboMixedFix = manifest.routing.fastMixedReferenceFix;
      const hasVisualReference = uploadedImages.length > 0 || uploadedVideos.length > 0;
      if (mode === 'fast' && hasVisualReference && uploadedAudio.length > 0 && turboMixedFix) {
        const fixNodeId = String(turboMixedFix.nodeId);
        const guiderNodeId = String(turboMixedFix.guiderNodeId);
        const guider = workflow[guiderNodeId];
        if (!guider?.inputs) throw new Error(`Turbo mixed-reference guider node is missing: ${guiderNodeId}`);
        workflow[fixNodeId] = {
          inputs: {
            conditioning: [conditioningNodeId, 0],
            shared_reference_time: Number(turboMixedFix.sharedReferenceTime ?? 1.0)
          },
          class_type: turboMixedFix.nodeType,
          _meta: { title: 'H3 Turbo Mixed Reference Fix (3-to-2)' }
        };
        guider.inputs.conditioning = [fixNodeId, 0];
      }
    }

    const wantsSound = merged.sound === true || String(merged.sound).toLowerCase() === 'true';
    if (!wantsSound && manifest.bindings.createVideoAudio) {
      deleteWorkflowValue(workflow, manifest.bindings.createVideoAudio);
    }

    const clientId = `lingwu-comfyui-${crypto.randomUUID()}`;
    const response = await this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    }, 120000);
    const result = await response.json();
    if (!result.prompt_id) {
      throw new Error(`ComfyUI 未返回 prompt_id：${JSON.stringify(result)}`);
    }
    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      throw new Error(`ComfyUI 工作流校验失败：${JSON.stringify(result.node_errors)}`);
    }
    return {
      data: {
        task_id: result.prompt_id,
        provider: 'comfyui',
        workflow: manifest.id,
        mode,
        queue_number: result.number
      }
    };
  }

  async getTaskStatus(taskId) {
    const history = await (await this.request(`/history/${encodeURIComponent(taskId)}`)).json();
    const record = history?.[taskId];
    if (record) {
      const state = record.status?.status_str;
      if (state === 'error' || state === 'failed') {
        const lastMessage = [...(record.status?.messages || [])].reverse().find(item => item?.[0] === 'execution_error');
        return { data: { task_id: taskId, status: 'failed', state: 'failed', is_final: true, error: lastMessage?.[1]?.exception_message || 'ComfyUI 生成失败' } };
      }
      if (record.status?.completed || state === 'success') {
        const files = collectOutputFiles(record.outputs);
        if (files.length === 0) {
          return { data: { task_id: taskId, status: 'failed', state: 'failed', is_final: true, error: 'ComfyUI 已完成，但没有找到保存节点输出' } };
        }
        const urls = files.map(file => {
          const query = new URLSearchParams({
            filename: file.filename,
            subfolder: file.subfolder || '',
            type: file.type || 'output'
          });
          return `${this.endpoint}/view?${query.toString()}`;
        });
        const preferred = urls[files.findIndex(file => VIDEO_EXTENSIONS.has(path.extname(file.filename).toLowerCase()))] || urls[0];
        return {
          data: {
            task_id: taskId,
            status: 'completed',
            state: 'completed',
            is_final: true,
            result_url: preferred,
            result_urls: urls
          }
        };
      }
      return { data: { task_id: taskId, status: 'running', state: 'running', is_final: false } };
    }

    const queue = await (await this.request('/queue')).json();
    const findPrompt = list => (list || []).some(item => Array.isArray(item) && item[1] === taskId);
    if (findPrompt(queue.queue_running)) {
      return { data: { task_id: taskId, status: 'running', state: 'running', is_final: false } };
    }
    if (findPrompt(queue.queue_pending)) {
      return { data: { task_id: taskId, status: 'queued', state: 'queued', is_final: false } };
    }
    return { data: { task_id: taskId, status: 'pending', state: 'pending', is_final: false } };
  }
}
