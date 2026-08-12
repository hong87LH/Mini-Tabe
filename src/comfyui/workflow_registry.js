import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKFLOW_ROOT = path.join(__dirname, 'workflows');
const PLUGIN_CATALOG_PATH = path.join(__dirname, 'plugin_catalog.json');

function readJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(content);
}

function listManifestPaths() {
  if (!fs.existsSync(WORKFLOW_ROOT)) return [];
  return fs.readdirSync(WORKFLOW_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(WORKFLOW_ROOT, entry.name, 'manifest.json'))
    .filter(filePath => fs.existsSync(filePath));
}

export function listComfyUIWorkflows() {
  return listManifestPaths().map(manifestPath => {
    const manifest = readJson(manifestPath);
    return {
      id: manifest.id,
      aliases: manifest.aliases || [],
      name: manifest.name,
      mediaType: manifest.mediaType,
      capabilities: manifest.capabilities || {},
      pluginRequirements: manifest.pluginRequirements || []
    };
  });
}

export function loadComfyUIPluginCatalog() {
  return readJson(PLUGIN_CATALOG_PATH);
}

export function resolveWorkflowPluginRequirements(manifest, mode = null) {
  const catalog = loadComfyUIPluginCatalog();
  return (manifest.pluginRequirements || [])
    .filter(requirement => !mode || !Array.isArray(requirement.modes) || requirement.modes.includes(mode))
    .map(requirement => {
      const plugin = catalog.plugins?.[requirement.pluginId];
      if (!plugin) throw new Error(`Unknown ComfyUI plugin catalog id: ${requirement.pluginId}`);
      return { id: requirement.pluginId, modes: requirement.modes || [], ...plugin };
    });
}

export function loadComfyUIWorkflow(modelName, requestedMode) {
  const normalizedModel = String(modelName || '').trim().toLowerCase();
  const manifestPath = listManifestPaths().find(candidate => {
    const manifest = readJson(candidate);
    const names = [manifest.id, ...(manifest.aliases || [])]
      .map(value => String(value).trim().toLowerCase());
    return names.includes(normalizedModel);
  });

  if (!manifestPath) {
    const known = listComfyUIWorkflows().flatMap(item => [item.id, ...item.aliases]);
    throw new Error(`未注册的 ComfyUI 工作流模型：${modelName}。可用模型：${known.join(', ')}`);
  }

  const manifest = readJson(manifestPath);
  const modeInput = String(requestedMode || manifest.defaults?.mode || 'fast').toLowerCase();
  const mode = ['quality', 'pro', 'original'].includes(modeInput) ? 'quality' : 'fast';
  const templateName = manifest.templates?.[mode];
  if (!templateName) throw new Error(`工作流 ${manifest.id} 未配置 ${mode} 模板`);

  const workflowDir = path.dirname(manifestPath);
  const templatePath = path.resolve(workflowDir, templateName);
  if (!templatePath.startsWith(path.resolve(workflowDir) + path.sep)) {
    throw new Error('工作流模板路径越界');
  }
  if (!fs.existsSync(templatePath)) throw new Error(`工作流模板不存在：${templatePath}`);

  return {
    manifest,
    mode,
    workflow: readJson(templatePath),
    templatePath
  };
}

export function setWorkflowValue(workflow, dottedPath, value) {
  const parts = String(dottedPath || '').split('.').filter(Boolean);
  if (parts.length === 0) throw new Error('工作流绑定路径为空');
  let current = workflow;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index];
    if (!current[key] || typeof current[key] !== 'object') {
      throw new Error(`工作流绑定路径不存在：${dottedPath}`);
    }
    current = current[key];
  }
  current[parts.at(-1)] = value;
}

export function deleteWorkflowValue(workflow, dottedPath) {
  const parts = String(dottedPath || '').split('.').filter(Boolean);
  if (parts.length === 0) return;
  let current = workflow;
  for (let index = 0; index < parts.length - 1; index++) {
    current = current?.[parts[index]];
    if (!current || typeof current !== 'object') return;
  }
  delete current[parts.at(-1)];
}
