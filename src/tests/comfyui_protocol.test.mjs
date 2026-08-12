import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ComfyUIClient, normalizeComfyUIMegapixels } from '../comfyui/comfyui_client.js';
import {
  deleteWorkflowValue,
  listComfyUIWorkflows,
  loadComfyUIWorkflow,
  setWorkflowValue
} from '../comfyui/workflow_registry.js';

test('MiniMax H3 workflow is registered with local aliases', () => {
  const entries = listComfyUIWorkflows();
  const h3 = entries.find(item => item.id === 'minimax-h3-first-last-router');
  assert.ok(h3);
  assert.ok(h3.aliases.includes('minimax-h3-local'));
  assert.ok(h3.aliases.includes('h3-fl'));
  assert.deepEqual(h3.capabilities.inputImages, { min: 0, max: 2 });
  assert.deepEqual(h3.capabilities.resolutions, ['360P', '480P', '720P', '1080P']);
  assert.deepEqual(h3.capabilities.aspectRatios, ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']);
});

test('two H3 router models are registered', () => {
  const entries = listComfyUIWorkflows();
  const firstLast = entries.find(item => item.id === 'minimax-h3-first-last-router');
  const reference = entries.find(item => item.id === 'minimax-h3-reference-router');
  assert.ok(firstLast.aliases.includes('minimax-h3-first-last-local'));
  assert.ok(reference.aliases.includes('minimax-h3-reference-local'));
  assert.ok(reference.aliases.includes('h3-ref'));
  assert.ok(reference.aliases.includes('minimax-h3-Ref-local'));
  assert.deepEqual(reference.capabilities.inputImages, { min: 0, max: 9 });
  assert.deepEqual(reference.capabilities.inputVideos, { min: 0, max: 3 });
  assert.deepEqual(reference.capabilities.inputAudio, { min: 0, max: 3 });
});

test('first-last router accepts text-only generation and removes first-frame input', async t => {
  let submittedPrompt = null;
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/prompt') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        submittedPrompt = JSON.parse(body).prompt;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ prompt_id: 'text-only-id', number: 1, node_errors: {} }));
      });
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new ComfyUIClient('', `http://127.0.0.1:${server.address().port}`);
  await client.createTask('h3-fl', 'text only', { images: [], resolution: '360P', aspectRatio: '3:4', duration: 3, sound: false });
  assert.equal(submittedPrompt['136'], undefined);
  assert.equal(submittedPrompt['131'].inputs.first_frame, undefined);
  assert.equal(submittedPrompt['131'].inputs.prompt, 'text only');
});

test('mixed image and audio references honor fast Turbo mode', async t => {
  let submittedPrompt = null;
  let uploadIndex = 0;
  const server = http.createServer((request, response) => {
    const send = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.method === 'POST' && request.url === '/upload/image') { request.resume(); send({ name: uploadIndex++ ? 'audio.mp3' : 'image.jpg', subfolder: 'lingwu_comfyui' }); return; }
    if (request.method === 'POST' && request.url === '/prompt') {
      let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
      request.on('end', () => { submittedPrompt = JSON.parse(body).prompt; send({ prompt_id: 'mixed-id', number: 1, node_errors: {} }); }); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-mixed-'));
  const image = path.join(tempDir, 'image.jpg'); const audio = path.join(tempDir, 'audio.mp3');
  fs.writeFileSync(image, Buffer.from([1])); fs.writeFileSync(audio, Buffer.from([2]));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const client = new ComfyUIClient('', `http://127.0.0.1:${server.address().port}`);
  const created = await client.createTask('h3-ref', 'mixed', { mode: 'fast', images: [image], audio: [audio], resolution: '360P', aspectRatio: '3:4', duration: 3 });
  assert.equal(created.data.mode, 'fast');
  assert.equal(submittedPrompt['124'].inputs.steps, 6);
  assert.equal(submittedPrompt['142'].class_type, 'MiniMaxH3TurboLoRA');
  assert.equal(submittedPrompt['280'].class_type, 'H3TurboMixedReferenceFix');
  assert.deepEqual(submittedPrompt['280'].inputs.conditioning, ['136', 0]);
  assert.equal(submittedPrompt['280'].inputs.shared_reference_time, 1);
  assert.deepEqual(submittedPrompt['126'].inputs.conditioning, ['280', 0]);
});

test('H3 Turbo mixed-reference fix is inserted only for Fast visual plus audio inputs', async t => {
  const submittedPrompts = [];
  let uploadIndex = 0;
  const uploadNames = ['a.jpg', 'b.jpg', 'clip.mp4', 'one.mp3', 'two.mp3'];
  const server = http.createServer((request, response) => {
    const send = value => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.method === 'POST' && request.url === '/upload/image') {
      request.resume();
      send({ name: uploadNames[uploadIndex++ % uploadNames.length], subfolder: 'lingwu_comfyui', type: 'input' });
      return;
    }
    if (request.method === 'POST' && request.url === '/prompt') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        submittedPrompts.push(JSON.parse(body).prompt);
        send({ prompt_id: `matrix-${submittedPrompts.length}`, number: 1, node_errors: {} });
      });
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-fix-matrix-'));
  const files = Object.fromEntries(['a.jpg', 'b.jpg', 'clip.mp4', 'one.mp3', 'two.mp3'].map(name => {
    const file = path.join(tempDir, name);
    fs.writeFileSync(file, Buffer.from([1]));
    return [name, file];
  }));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const client = new ComfyUIClient('', `http://127.0.0.1:${server.address().port}`);
  const common = { resolution: '360P', aspectRatio: '3:4', duration: 3, sound: false };

  await client.createTask('h3-ref', 'two images and audio', { ...common, mode: 'fast', images: [files['a.jpg'], files['b.jpg']], audio: [files['one.mp3']] });
  await client.createTask('h3-ref', 'video and audio', { ...common, mode: 'fast', videos: [files['clip.mp4']], audio: [files['one.mp3']] });
  await client.createTask('h3-ref', 'image video audio', { ...common, mode: 'fast', images: [files['a.jpg']], videos: [files['clip.mp4']], audio: [files['one.mp3']] });
  await client.createTask('h3-ref', 'image and two audio', { ...common, mode: 'fast', images: [files['a.jpg']], audio: [files['one.mp3'], files['two.mp3']] });
  await client.createTask('h3-ref', 'image only', { ...common, mode: 'fast', images: [files['a.jpg']] });
  await client.createTask('h3-ref', 'audio only', { ...common, mode: 'fast', audio: [files['one.mp3']] });
  await client.createTask('h3-ref', 'quality mixed', { ...common, mode: 'quality', images: [files['a.jpg']], audio: [files['one.mp3']] });

  for (const prompt of submittedPrompts.slice(0, 4)) {
    assert.equal(prompt['280'].class_type, 'H3TurboMixedReferenceFix');
    assert.deepEqual(prompt['126'].inputs.conditioning, ['280', 0]);
  }
  for (const prompt of submittedPrompts.slice(4)) {
    assert.equal(prompt['280'], undefined);
    assert.deepEqual(prompt['126'].inputs.conditioning, ['136', 0]);
  }
});

test('resolution tiers map by short side and raw MP remains compatible', () => {
  const { manifest } = loadComfyUIWorkflow('minimax-h3-local', 'fast');
  assert.equal(normalizeComfyUIMegapixels('360p', '16:9', manifest), 0.2304);
  assert.equal(normalizeComfyUIMegapixels('480P', '3:4', manifest), 0.3072);
  assert.equal(normalizeComfyUIMegapixels('720P', '2:3', manifest), 0.7776);
  assert.equal(normalizeComfyUIMegapixels('1080p', '9:16', manifest), 2.0736);
  assert.equal(normalizeComfyUIMegapixels('0.78MP', '2:3', manifest), 0.78);
  assert.equal(normalizeComfyUIMegapixels('0.3', '16:9', manifest), 0.3);
});

test('reference router uploads and assigns image, video and audio inputs', async t => {
  let submittedPrompt = null;
  let uploadIndex = 0;
  const uploadNames = ['image.jpg', 'reference.mp4', 'reference.wav'];
  const server = http.createServer((request, response) => {
    const sendJson = value => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.method === 'POST' && request.url === '/upload/image') {
      request.resume();
      sendJson({ name: uploadNames[uploadIndex++], subfolder: 'lingwu_comfyui', type: 'input' });
      return;
    }
    if (request.method === 'POST' && request.url === '/prompt') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        submittedPrompt = JSON.parse(body).prompt;
        sendJson({ prompt_id: 'reference-router-id', number: 1, node_errors: {} });
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-reference-router-'));
  const image = path.join(tempDir, 'image.jpg');
  const video = path.join(tempDir, 'video.mp4');
  const audio = path.join(tempDir, 'audio.wav');
  fs.writeFileSync(image, Buffer.from([1]));
  fs.writeFileSync(video, Buffer.from([2]));
  fs.writeFileSync(audio, Buffer.from([3]));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const client = new ComfyUIClient('', `http://127.0.0.1:${server.address().port}`);
  await client.createTask('minimax-h3-reference-local', 'fashion motion', {
    images: [image], videos: [video], audio: [audio], resolution: '360P', aspectRatio: '2:3', duration: 3, sound: true, seed: 7
  });
  assert.match(submittedPrompt['136'].inputs.prompt, /<Picture 1> <Video 1> <Audio 1>/);
  assert.deepEqual(submittedPrompt['136'].inputs['ref_images.ref_image_0'], ['200', 0]);
  assert.deepEqual(submittedPrompt['136'].inputs['ref_videos.ref_video_0'], ['221', 0]);
  assert.deepEqual(submittedPrompt['136'].inputs['ref_audios.ref_audio_0'], ['250', 0]);
  assert.equal(submittedPrompt['200'].class_type, 'LoadImage');
  assert.equal(submittedPrompt['220'].class_type, 'LoadVideo');
  assert.equal(submittedPrompt['221'].class_type, 'GetVideoComponents');
  assert.equal(submittedPrompt['250'].class_type, 'LoadAudio');
  assert.equal(submittedPrompt['136'].inputs['ref_video_audios.ref_video_audio_0'], undefined);
  assert.equal(submittedPrompt['115'].inputs.megapixels, 0.1944);
});

test('fast mode resolves to Turbo six-step template', () => {
  const loaded = loadComfyUIWorkflow('minimax-h3-local', 'fast');
  assert.equal(loaded.mode, 'fast');
  assert.equal(loaded.workflow['124'].inputs.steps, 6);
  assert.equal(loaded.workflow['134'].class_type, 'MiniMaxH3TurboLoRA');
});

test('quality mode resolves to original twenty-step template', () => {
  const loaded = loadComfyUIWorkflow('minimax-h3-local', 'quality');
  assert.equal(loaded.mode, 'quality');
  assert.equal(loaded.workflow['124'].inputs.steps, 20);
  assert.equal(loaded.workflow['135'].inputs.sampler_name, 'res_multistep');
  assert.equal(loaded.workflow['134'], undefined);
});

test('manifest bindings modify only requested workflow values', () => {
  const loaded = loadComfyUIWorkflow('minimax-h3-local', 'fast');
  const workflow = loaded.workflow;
  setWorkflowValue(workflow, loaded.manifest.bindings.prompt, 'test prompt');
  setWorkflowValue(workflow, loaded.manifest.bindings.megapixels, 0.9);
  setWorkflowValue(workflow, loaded.manifest.bindings.aspectRatio, '16:9 (Widescreen)');
  deleteWorkflowValue(workflow, loaded.manifest.bindings.createVideoAudio);
  assert.equal(workflow['131'].inputs.prompt, 'test prompt');
  assert.equal(workflow['115'].inputs.megapixels, 0.9);
  assert.equal(workflow['115'].inputs.aspect_ratio, '16:9 (Widescreen)');
  assert.equal(workflow['130'].inputs.audio, undefined);
});

test('ComfyUI client uploads local input, maps generic parameters and parses video output', async t => {
  let submittedPrompt = null;
  const server = http.createServer((request, response) => {
    const sendJson = value => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };

    if (request.method === 'POST' && request.url === '/upload/image') {
      request.resume();
      sendJson({ name: 'mock_input.jpg', subfolder: 'lingwu_comfyui', type: 'input' });
      return;
    }

    if (request.method === 'POST' && request.url === '/prompt') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        submittedPrompt = JSON.parse(body).prompt;
        sendJson({ prompt_id: 'mock-prompt-id', number: 7, node_errors: {} });
      });
      return;
    }

    if (request.url === '/history/mock-prompt-id') {
      sendJson({
        'mock-prompt-id': {
          status: { status_str: 'success', completed: true, messages: [] },
          outputs: {
            '92': {
              images: [{ filename: 'result.mp4', subfolder: 'video/mock', type: 'output' }]
            }
          }
        }
      });
      return;
    }

    if (request.url === '/queue') {
      sendJson({ queue_running: [], queue_pending: [] });
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-provider-test-'));
  const inputPath = path.join(tempDir, 'input.jpg');
  fs.writeFileSync(inputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const client = new ComfyUIClient('', endpoint);
  const created = await client.createTask('minimax-h3-local', 'test movement', {
    images: [inputPath],
    resolution: '720P',
    aspectRatio: '3:4',
    mode: 'quality',
    duration: 3,
    sound: false,
    seed: 12345
  });

  assert.equal(created.data.task_id, 'mock-prompt-id');
  assert.equal(submittedPrompt['131'].inputs.prompt, 'test movement');
  assert.equal(submittedPrompt['115'].inputs.megapixels, 0.6912);
  assert.equal(submittedPrompt['115'].inputs.aspect_ratio, '3:4 (Portrait Standard)');
  assert.equal(submittedPrompt['124'].inputs.steps, 20);
  assert.equal(submittedPrompt['133'].inputs.value, 3);
  assert.equal(submittedPrompt['129'].inputs.noise_seed, 12345);
  assert.equal(submittedPrompt['136'].inputs.image, 'lingwu_comfyui/mock_input.jpg');
  assert.equal(submittedPrompt['130'].inputs.audio, undefined);

  const status = await client.getTaskStatus('mock-prompt-id');
  assert.equal(status.data.status, 'completed');
  assert.match(status.data.result_url, /\/view\?/);
  assert.match(status.data.result_url, /filename=result\.mp4/);
});
