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

test('reference router rejects empty inputs without changing the selected workflow', async () => {
  const client = new ComfyUIClient('', 'http://127.0.0.1:1');
  await assert.rejects(() => client.createTask('minimax-h3-Ref-local', 'reference text only', {
    images: [], videos: [], audio: [], resolution: '360P', aspectRatio: '16:9', duration: 8, sound: false
  }), /至少需要 1 个图片、视频或音频参考素材/);
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
      let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
      request.on('end', () => { submittedPrompt = JSON.parse(body).prompt; sendJson({ prompt_id: 'reference-router-id', number: 1, node_errors: {} }); });
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-reference-router-'));
  const image = path.join(tempDir, 'image.jpg');
  const video = path.join(tempDir, 'video.mp4');
  const audio = path.join(tempDir, 'audio.wav');
  fs.writeFileSync(image, Buffer.from([1])); fs.writeFileSync(video, Buffer.from([2])); fs.writeFileSync(audio, Buffer.from([3]));
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
          outputs: { '92': { images: [{ filename: 'result.mp4', subfolder: 'video/mock', type: 'output' }] } }
        }
      });
      return;
    }

    if (request.url === '/queue') {
      sendJson({ queue_running: [], queue_pending: [] });
      return;
    }

    response.writeHead(404); response.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-provider-test-'));
  const inputPath = path.join(tempDir, 'input.jpg');
  fs.writeFileSync(inputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const client = new ComfyUIClient('', endpoint);
  const created = await client.createTask('minimax-h3-local', 'test movement', {
    images: [inputPath], resolution: '720P', aspectRatio: '3:4', mode: 'quality', duration: 3, sound: false, seed: 12345
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


test('Qwen image routes 0/1/2/3/5 references without H3 nodes or reference padding', async () => {
  const client = new ComfyUIClient('', 'http://127.0.0.1:1');
  const uploads = [];
  client.uploadImage = async image => { uploads.push(image); return image; };
  let submitted;
  client.request = async (_url, options) => {
    submitted = JSON.parse(options.body).prompt;
    return { json: async () => ({ prompt_id: 'qwen-mock', node_errors: {} }) };
  };
  const entry = listComfyUIWorkflows().find(item => item.id === 'qwen-image-2.1');
  assert.equal(entry.mediaType, 'image');
  const declared = loadComfyUIWorkflow('qwen-image-2.1-local').workflow;
  assert.deepEqual(declared['90'], { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } });
  assert.deepEqual(declared['8'].inputs.latent_image, ['7', 2]);
  for (const count of [0, 1, 2, 3, 5]) {
    uploads.length = 0;
    const images = Array.from({ length: count }, (_, i) => `ref-${i}.png`);
    await client.createTask('qwen-image-2.1-local', 'keep reference roles', count ? { images, imageSize: '1.5K', seed: 42 } : { images, imageSize: '1.5K', aspectRatio: '3:4', seed: 42 });
    assert.deepEqual(uploads, images);
    const links = Object.keys(submitted['7'].inputs).filter(key => key.startsWith('images.'));
    assert.equal(links.length, count);
    images.forEach((image, i) => {
      assert.deepEqual(submitted['7'].inputs[`images.image_${i + 1}`], [String(100 + i), 0]);
      assert.equal(submitted[String(100 + i)].inputs.image, image);
    });
    assert.equal(submitted['7'].inputs.resolution, 1536);
    assert.equal(submitted['7'].inputs.prompt, 'keep reference roles');
    assert.equal(submitted['8'].inputs.steps, 25);
    assert.equal(submitted['8'].inputs.seed, 42);
    assert.equal(submitted['8'].inputs.cfg, 1);
    assert.equal(submitted['10'].class_type, 'SaveImage');
    assert.match(submitted['10'].inputs.filename_prefix, /^image\//);
    assert.ok(Object.values(submitted).every(node => !/Video|MiniMax/.test(node.class_type)));
    if (count) {
      assert.equal(submitted['90'], undefined);
      assert.deepEqual(submitted['8'].inputs.latent_image, ['7', 2]);
    } else {
      assert.deepEqual(submitted['8'].inputs.latent_image, ['90', 0]);
      assert.equal(submitted['90'].inputs.width, 1344);
      assert.equal(submitted['90'].inputs.height, 1760);
    }
  }
});

test('Qwen validates resolution and references before uploads, wraps only transparent alias', async () => {
  const { normalizeQwenImageResolution } = await import('../comfyui/comfyui_client.js');
  for (const [value, expected] of [[0.5,512],['0.5K',512],[1,1024],['1.5k',1536],['2K',2048],['1024x1024',1024],[undefined,1024]]) {
    assert.equal(normalizeQwenImageResolution(value), expected);
  }
  for (const value of ['4K',2.1,0,-1,'bad','0.3MP','{missing}']) assert.throws(() => normalizeQwenImageResolution(value), /最高 2K/);
  const client = new ComfyUIClient('', 'http://127.0.0.1:1');
  client.uploadImage = async () => { throw Error('unexpected upload'); };
  await assert.rejects(client.createTask('qwen-image-2.1-local','x',{images:['a'],imageSize:'4K'}), /最高 2K/);
  await assert.rejects(client.createTask('qwen-image-2.1-local','x',{images:Array(6).fill('a')}), /0-5/);
  await assert.rejects(client.createTask('qwen-image-2.1-local','x',{videos:['a.mp4']}), /0-0/);
  await assert.rejects(client.createTask('qwen-image-2.1-local','x',{aspectRatio:'NaN'}), /比例/);
  let submitted;
  client.request = async (_url, options) => {
    submitted = JSON.parse(options.body).prompt;
    return { json: async () => ({ prompt_id: 'alpha-mock' }) };
  };
  await client.createTask('qwen-image-2.1-transparent-local','a teapot',{imageSize:0.5});
  assert.match(submitted['7'].inputs.prompt, /RGBA.*a teapot.*alpha channel.*transparent background/);
  assert.equal(submitted['7'].inputs.resolution, 512);
  assert.equal(submitted['90'].class_type, 'EmptyLatentImage');
  assert.equal(submitted['90'].inputs.width, 512);
  const wrapped = submitted['7'].inputs.prompt;
  await client.createTask('qwen-image-2.1-transparent-local',wrapped);
  assert.equal(submitted['7'].inputs.prompt, wrapped);
});

test('Qwen health rejects empty object_info and reports core dependency', async () => {
  const client = new ComfyUIClient('', 'http://127.0.0.1:1');
  client.request = async url => ({ json: async () => url === '/system_stats' ? {system:{comfyui_version:'old'}} : {} });
  const health = await client.healthCheck('qwen-image-2.1-local');
  assert.equal(health.ok, false);
  assert.ok(health.workflow.missingNodeTypes.includes('TextEncodeQwenImage21'));
  assert.equal(health.workflow.missingPlugins[0].id, 'comfyui-core-qwen21');
});

test('ComfyUI PNG output filename survives history parsing', async () => {
  const client = new ComfyUIClient('', 'http://127.0.0.1:1');
  client.request = async () => ({ json: async () => ({qwen:{status:{completed:true},outputs:{'10':{images:[{filename:'alpha.png',subfolder:'image/qwen21',type:'output'}]}}}}) });
  const result = await client.getTaskStatus('qwen');
  assert.equal(result.data.status, 'completed');
  assert.equal(new URL(result.data.result_url).searchParams.get('filename'), 'alpha.png');
});

test('ComfyUI rejects an image workflow submitted through the video job path', async () => {
  const client = new ComfyUIClient('', 'http://127.0.0.1:1');
  await assert.rejects(client.createTask('qwen-image-2.1-local','x',{mediaType:'video'}), /不能用于 video/);
  await assert.rejects(client.createTask('minimax-h3-local','x',{mediaType:'image'}), /不能用于 image/);
});

test('Qwen native T2I latent supports auto and ratio labels; I2I can override ratio or fall back to the first image', async () => {
  const client = new ComfyUIClient('', 'http://127.0.0.1:1');
  let submitted;
  client.uploadImage = async name => name;
  client.request = async (_url, options) => { submitted = JSON.parse(options.body).prompt; return {json:async()=>({prompt_id:'mock'})}; };
  for (const ratio of ['1:1','auto','4:5','1:2','3:4 (Portrait Standard)',' 3 ： 4 ']) {
    await client.createTask('qwen-image-2.1-local','test',{imageSize:'0.5K',aspectRatio:ratio});
    assert.equal(submitted['90'].class_type,'EmptyLatentImage');
    assert.equal(submitted['90'].inputs.batch_size,1);
    assert.deepEqual(submitted['8'].inputs.latent_image,['90',0]);
  }
  await client.createTask('qwen-image-2.1-local','test',{images:['reference.png'],quality:'auto'});
  assert.equal(submitted['90'],undefined);
  assert.deepEqual(submitted['8'].inputs.latent_image,['7',2]);
  await client.createTask('qwen-image-2.1-local','test',{images:['reference.png'],aspectRatio:'auto'});
  assert.equal(submitted['90'],undefined);
  assert.deepEqual(submitted['8'].inputs.latent_image,['7',2]);
  await client.createTask('qwen-image-2.1-local','test',{images:['reference.png'],aspectRatio:'1:1'});
  assert.deepEqual(submitted['8'].inputs.latent_image,['90',0]);
  assert.equal(submitted['90'].inputs.width,1024);
  assert.equal(submitted['90'].inputs.height,1024);
  await assert.rejects(client.createTask('qwen-image-2.1-local','test',{images:['reference.png'],aspectRatio:'bad'}), /图生图比例覆盖/);
  for (const [quality,steps] of [['auto',25],['high',30],['max',40]]) {
    await client.createTask('qwen-image-2.1-local','test',{images:['reference.png'],aspectRatio:'9:16',quality,mode:'enhanced'});
    assert.equal(submitted['90'].class_type,'EmptyLatentImage');
    assert.deepEqual(submitted['8'].inputs.latent_image,['90',0]);
    assert.equal(submitted['90'].inputs.width,768);
    assert.equal(submitted['90'].inputs.height,1376);
    assert.equal(submitted['8'].inputs.steps,steps);
    assert.equal(submitted['3'].inputs.clip_name,'qwen3vl_8b_int8_convrot.safetensors');
  }
});

test('image controls default to standard/auto and accept field display labels', async () => {
  const {normalizeImageControls}=await import('../lingwu_image_model_profiles.js');
  assert.deepEqual(normalizeImageControls(),{mode:'standard',quality:'auto'});
  assert.deepEqual(normalizeImageControls({mode:'增强',quality:'极致'}),{mode:'enhanced',quality:'max'});
  assert.throws(()=>normalizeImageControls({mode:'{missing}'}),/模式/);
});


test('image mode UI aliases preserve legacy controls and map provider contracts', async () => {
  const {normalizeImageControls,buildImageControlParams,buildLingwuImageParams,buildLegacyLingwuParams}=await import('../lingwu_image_model_profiles.js');
  assert.deepEqual(normalizeImageControls({mode:'auto'}),{mode:'standard',quality:'auto'});
  assert.deepEqual(normalizeImageControls({mode:'high',quality:'max'}),{mode:'enhanced',quality:'max'});
  const nano='gemini-3.1-flash-image-preview';
  for(const mode of ['auto','high']) for(const quality of ['auto','high','max']) {
    const thinkingLevel=mode==='high'?'high':'minimal';
    assert.deepEqual(buildImageControlParams(nano,{mode,quality}),{thinkingLevel});
    assert.deepEqual(buildImageControlParams(nano,{mode,quality},'gemini'),{thinkingConfig:{thinkingLevel}});
    assert.deepEqual(buildImageControlParams('tt-image-2.5',{mode,quality}),{version:mode==='high'?'sunburst':'flare',quality});
  }
  assert.deepEqual(buildImageControlParams('tt-image-2.5-sunburst',{}),{version:'sunburst',quality:'auto'});
  for(const model of ['gpt-image-2','gpt-image-2-guan','unknown-model']) {
    const old={imageSize:'1K',aspectRatio:'4:3',images:['a.png']};
    assert.deepEqual(buildLingwuImageParams({model,params:old}),buildLegacyLingwuParams(old));
    assert.deepEqual(buildImageControlParams(model,{mode:'high',quality:'max'}),{mode:'high',quality:'max'});
    assert.deepEqual(buildImageControlParams(model,{}),{});
  }
  for(const imageSize of ['1K','2K','4K']) for(const aspectRatio of ['1:1','4:3','16:9']) {
    const old={imageSize,aspectRatio};
    assert.deepEqual(buildLingwuImageParams({model:'tt-image-2.5',params:old}),{...buildLegacyLingwuParams(old),version:'flare',quality:'auto'});
  }
  assert.deepEqual(buildLingwuImageParams({model:'doubao-seedream-5-0-260128',params:{imageSize:'1K',aspectRatio:'4:3'}}),{size:'2K',aspect_ratio:'4:3'});
  assert.equal(buildLingwuImageParams({model:nano,params:{imageSize:'0.5K',quality:'max'}}).imageSize,'0.5K');
});

test('image adapters submit exact model and controls to local mock transport, including references', async () => {
  const {LingwuClient}=await import('../lingwu_client.js');
  const {buildLingwuImageParams}=await import('../lingwu_image_model_profiles.js');
  const captured=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    captured.push({url:req.url,body:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({task_id:'mock-only'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const client=new LingwuClient('mock-only',`http://127.0.0.1:${server.address().port}`);
    for(const model of ['tt-image-2.5','gemini-3.1-flash-image-preview','gemini-3-pro-image-preview','gpt-image-2','gpt-image-2-guan','doubao-seedream-5-0-260128']) {
      for(const images of [[],['https://example.invalid/reference.png']]) {
        const params=buildLingwuImageParams({model,params:{imageSize:'1K',aspectRatio:'1:1',mode:'high',quality:'max',images}});
        await client.createTask(model,'test',params,1);
        const sent=captured.at(-1);
        assert.equal(sent.url,'/v1/media/generate');
        assert.equal(sent.body.model,model);assert.equal(sent.body.count,1);
        assert.deepEqual(sent.body.params.images,images);
        if(model==='gemini-3.1-flash-image-preview') {
          assert.equal(sent.body.params.thinkingLevel,'high');
          assert.ok(!('quality' in sent.body.params));assert.ok(!('mode' in sent.body.params));
        }
        if(model==='tt-image-2.5') {
          assert.equal(sent.body.params.size,'1024x1024');assert.equal(sent.body.params.version,'sunburst');assert.equal(sent.body.params.quality,'max');
          assert.ok(!('resolution' in sent.body.params));assert.ok(!('aspect_ratio' in sent.body.params));
        }
      }
    }
    assert.equal(captured.length,12);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
