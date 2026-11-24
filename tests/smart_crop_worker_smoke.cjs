const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const inputImage = process.argv[2] ? path.resolve(process.argv[2]) : null;
const mime = new Map([
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.wasm', 'application/wasm'],
  ['.task', 'application/octet-stream'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
]);

const page = `<!doctype html><meta charset="utf-8"><script>
window.__smartCropSmoke = new Promise(async (resolve, reject) => {
  window.__smartCropStage = 'starting';
  const timer = setTimeout(() => reject(new Error('worker smoke timeout at ' + window.__smartCropStage)), 45000);
  try {
    const worker = new Worker('/smart_crop/recognition-worker.js');
    worker.onerror = event => reject(new Error(event.message || 'worker runtime error'));
    worker.onmessage = event => {
      if (event.data?.type === 'status' || event.data?.type === 'ready') {
        window.__smartCropStage = event.data?.text || event.data?.type;
      }
      if (event.data?.id !== 1) return;
      clearTimeout(timer);
      worker.terminate();
      if (event.data.type === 'error') reject(new Error(event.data.error));
      else {
        const value = event.data.value;
        const person = value?.parameters?.openpose_json?.[0]?.people?.[0];
        const points = person?.pose_keypoints_2d || [];
        const point = index => ({ x: points[index * 3], y: points[index * 3 + 1], score: points[index * 3 + 2] });
        const leftShoulder = point(5);
        const rightShoulder = point(2);
        const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
        const cutoff = shoulderY - value.height * 0.02;
        const spans = (value?.parameters?.boundary?.person_row_spans?.P1 || []).filter(span => span[1] <= cutoff);
        const headMask = spans.length ? {
          left: Math.min(...spans.map(span => span[0])),
          top: Math.min(...spans.map(span => span[1])),
          right: Math.max(...spans.map(span => span[2])),
          bottom: Math.max(...spans.map(span => span[1] + span[3]))
        } : null;
        resolve({ width: value?.width, height: value?.height, leftShoulder, rightShoulder, shoulderY, headMask });
      }
    };
    let image;
    if (${JSON.stringify(Boolean(inputImage))}) {
      window.__smartCropStage = 'fetching-image';
      const imageResponse = await fetch('/input-image');
      const imageBlob = await imageResponse.blob();
      window.__smartCropStage = 'decoding-' + imageBlob.type;
      image = await createImageBitmap(imageBlob);
    } else {
      const canvas = new OffscreenCanvas(96, 128);
      const context = canvas.getContext('2d');
      context.fillStyle = '#f3f4f6';
      context.fillRect(0, 0, 96, 128);
      image = canvas.transferToImageBitmap();
    }
    window.__smartCropStage = 'decoded';
    const naturalWidth = image.width;
    const naturalHeight = image.height;
    if (Math.max(naturalWidth, naturalHeight) > 256) {
      const scale = 256 / Math.max(naturalWidth, naturalHeight);
      const canvas = new OffscreenCanvas(Math.round(naturalWidth * scale), Math.round(naturalHeight * scale));
      const canvasContext = canvas.getContext('2d');
      canvasContext.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      image = canvas.transferToImageBitmap();
    }
    worker.postMessage({
      id: 1,
      type: 'analyze',
      image,
      width: naturalWidth,
      height: naturalHeight,
      mode: 'single',
      transform: { edge: 1, contentWidth: 1, contentHeight: 1, offsetX: 0, offsetY: 0 },
      preferred: 'bundled'
    }, [image]);
    window.__smartCropStage = 'posted-to-worker';
  } catch (error) {
    clearTimeout(timer);
    reject(error);
  }
});
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
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'hong-smart-crop-smoke-')));
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    await window.loadURL(`http://127.0.0.1:${address.port}/`);
    const result = await window.webContents.executeJavaScript('window.__smartCropSmoke');
    console.log(`SMART_CROP_WORKER_OK ${JSON.stringify(result)}`);
    window.destroy();
  } catch (error) {
    console.error(`SMART_CROP_WORKER_FAILED ${error?.message || error}`);
    process.exitCode = 1;
  } finally {
    server.close();
    app.quit();
  }
});
