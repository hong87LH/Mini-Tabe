import { ComfyUIClient } from '../comfyui/comfyui_client.js';
import { listComfyUIWorkflows, loadComfyUIWorkflow } from '../comfyui/workflow_registry.js';

const endpoint = process.env.COMFYUI_ENDPOINT || 'http://127.0.0.1:8188';
const model = process.env.COMFYUI_MODEL || 'minimax-h3-local';

const workflows = listComfyUIWorkflows();
const fast = loadComfyUIWorkflow(model, 'fast');
const quality = loadComfyUIWorkflow(model, 'quality');
const client = new ComfyUIClient('', endpoint);

function summarizeTemplate(workflow) {
  const nodes = Object.values(workflow || {});
  const scheduler = nodes.find(node => node.class_type === 'BasicScheduler');
  const sampler = nodes.find(node => node.class_type === 'KSamplerSelect');
  return {
    steps: scheduler?.inputs?.steps ?? null,
    sampler: sampler?.inputs?.sampler_name ?? null
  };
}

let health;
try {
  health = await client.healthCheck(model);
} catch (error) {
  health = { ok: false, endpoint, error: error.message };
}

const result = {
  registeredWorkflows: workflows,
  templates: {
    fast: summarizeTemplate(fast.workflow),
    quality: summarizeTemplate(quality.workflow)
  },
  health
};

console.log(JSON.stringify(result, null, 2));
