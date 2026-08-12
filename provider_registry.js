import { LingwuClient } from './lingwu_client.js';
import { ComfyUIClient } from './comfyui/comfyui_client.js';

export function normalizeProviderName(provider) {
  const normalized = String(provider || 'lingwu').trim().toLowerCase();
  return normalized === 'comfyui' ? 'comfyui' : 'lingwu';
}

export function createMediaProviderClient(provider, credentials = {}) {
  const normalized = normalizeProviderName(provider);
  if (normalized === 'comfyui') {
    return new ComfyUIClient(credentials.apiKey, credentials.endpoint);
  }
  return new LingwuClient(credentials.apiKey, credentials.endpoint);
}
