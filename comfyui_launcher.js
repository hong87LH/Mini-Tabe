import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const activeStarts = new Map();

function normalizeEndpoint(endpoint) {
  return String(endpoint || 'http://127.0.0.1:8188').replace(/\/+$/, '');
}

export function isLocalComfyUIEndpoint(endpoint) {
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(normalizeEndpoint(endpoint)).hostname);
  } catch {
    return false;
  }
}

async function probeComfyUI(endpoint, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizeEndpoint(endpoint)}/system_stats`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function validateBatPath(batPath) {
  const resolved = path.resolve(String(batPath || '').trim());
  if (!batPath || !fs.existsSync(resolved)) throw new Error(`ComfyUI startup BAT does not exist: ${batPath}`);
  if (path.extname(resolved).toLowerCase() !== '.bat') throw new Error(`ComfyUI startup path must be a .bat file: ${resolved}`);
  return resolved;
}

async function waitForComfyUI(endpoint, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeComfyUI(endpoint, 3000)) return true;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

export async function ensureComfyUIAvailable({ endpoint, batPath, startupTimeoutMs = 120000 } = {}) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (await probeComfyUI(normalizedEndpoint)) return { ok: true, started: false };
  if (!batPath) return { ok: false, started: false };
  if (!isLocalComfyUIEndpoint(normalizedEndpoint)) throw new Error('Automatic ComfyUI startup is allowed only for localhost endpoints.');

  const resolvedBat = validateBatPath(batPath);
  const startKey = `${normalizedEndpoint}|${resolvedBat.toLowerCase()}`;
  if (!activeStarts.has(startKey)) {
    activeStarts.set(startKey, (async () => {
      const child = spawn('cmd.exe', ['/d', '/k', 'call', resolvedBat], {
        cwd: path.dirname(resolvedBat), detached: true, windowsHide: false, stdio: 'ignore'
      });
      child.unref();
      const ready = await waitForComfyUI(normalizedEndpoint, startupTimeoutMs);
      if (!ready) throw new Error(`ComfyUI did not become ready within ${Math.round(startupTimeoutMs / 1000)} seconds after starting ${resolvedBat}`);
      return { ok: true, started: true, batPath: resolvedBat };
    })().finally(() => activeStarts.delete(startKey)));
  }
  return await activeStarts.get(startKey);
}
