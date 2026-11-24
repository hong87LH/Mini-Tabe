const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const inputImage = process.argv[2] ? path.resolve(process.argv[2]) : null;
const preferredSeg = process.argv[3] || 'multiclass';
const mime = new Map([
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.wasm', 'application/wasm'],
  ['.task', 'application/octet-stream'],
  ['.tflite', 'application/octet-stream'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
]);

const page = `<!doctype html><meta charset="utf-8"><script>
function runWorker(url, payload, transfer, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stage = 'starting';
    const worker = new Worker(url);
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(url + ' timeout at ' + stage));
    }, timeoutMs);
    worker.onerror = event => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || (url + ' runtime error')));
    };
    worker.onmessage = event => {
      if (event.data?.type === 'status' || event.data?.type === 'ready') {
        stage = event.data?.text || event.data?.type;
      }
      if (event.data?.id !== payload.id) return;
      clearTimeout(timer);
      worker.terminate();
      if (event.data.type === 'error') reject(new Error(event.data.error));
      else resolve(event.data.value);
    };
    worker.postMessage(payload, transfer);
  });
}

async function makeBitmap() {
  let image;
  if (${JSON.stringify(Boolean(inputImage))}) {
    const response = await fetch('/input-image');
    const blob = await response.blob();
    image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } else {
    const canvas = new OffscreenCanvas(96, 128);
    const context = canvas.getContext('2d');
    context.fillStyle = '#f3f4f6';
    context.fillRect(0, 0, 96, 128);
    image = canvas.transferToImageBitmap();
  }
  const naturalWidth = image.width;
  const naturalHeight = image.height;
  if (Math.max(naturalWidth, naturalHeight) > 256) {
    const scale = 256 / Math.max(naturalWidth, naturalHeight);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(naturalWidth * scale)), Math.max(1, Math.round(naturalHeight * scale)));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    image = canvas.transferToImageBitmap();
  }
  return { image, naturalWidth, naturalHeight };
}

window.__smartCropDualSmoke = (async () => {
  const poseInput = await makeBitmap();
  const pose = await runWorker('/smart_crop/recognition-worker.js', {
    id: 1,
    type: 'analyze',
    image: poseInput.image,
    width: poseInput.naturalWidth,
    height: poseInput.naturalHeight,
    mode: 'single',
    transform: { edge: 1, contentWidth: 1, contentHeight: 1, offsetX: 0, offsetY: 0 },
    preferred: 'cloud'
  }, [poseInput.image], 45000);

  const segInput = await makeBitmap();
  const seg = await runWorker('/smart_crop/segmentation-worker.js', {
    id: 2,
    type: 'segment',
    image: segInput.image,
    width: segInput.naturalWidth,
    height: segInput.naturalHeight,
    preferred: ${JSON.stringify(preferredSeg)}
  }, [segInput.image], 45000);

  const histogram = {};
  for (let i = 0; i < seg.mask.length; i += 1) {
    const k = String(seg.mask[i]);
    histogram[k] = (histogram[k] || 0) + 1;
  }
  const peopleCount = (pose?.parameters?.openpose_json || []).reduce((sum, f) => sum + (f?.people?.length || 0), 0);
  return {
    width: pose.width,
    height: pose.height,
    peopleCount,
    poseMs: pose?.parameters?.timing?.total_ms,
    segModel: seg.modelInfo?.model,
    segKind: seg.modelKind,
    segMaskSize: [seg.maskWidth, seg.maskHeight],
    segMs: seg.timing?.total_ms,
    histogram
  };
})();
</script>`;

const server = http.createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  if (request.url === '/input-image' && inputImage && fs.existsSync(inputImage)) {
    response.writeHead(200, { 'content-type': mime.get(path.extname(inputImage).toLowerCase()) || 'application/octet-stream' });
    fs.createReadStream(inputImage).pipe(response);
    return;
  }
  const relativePath = decodeURIComponent(request.url || '').replace(/^\/+/, '');
  const filePath = path.resolve(publicRoot, relativePath);
  if (!filePath.startsWith(publicRoot + path.sep) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': mime.get(path.extname(filePath)) || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
});

app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'hong-smart-crop-seg-smoke-')));
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    await win.loadURL(`http://127.0.0.1:${address.port}/`);
    const result = await win.webContents.executeJavaScript('window.__smartCropDualSmoke');
    console.log(`SMART_CROP_DUAL_SMOKE_OK ${JSON.stringify(result)}`);
    win.destroy();
  } catch (error) {
    console.error(`SMART_CROP_DUAL_SMOKE_FAILED ${error?.message || error}`);
    process.exitCode = 1;
  } finally {
    server.close();
    app.quit();
  }
});
