const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
const { app, BrowserWindow } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const inputImage = process.argv[2] ? path.resolve(process.argv[2]) : null;
const outputImage = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(os.tmpdir(), `smart-crop-headshot-${path.basename(inputImage || 'preview', path.extname(inputImage || ''))}.png`);
const mime = new Map([
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.wasm', 'application/wasm'],
  ['.task', 'application/octet-stream'],
  ['.tflite', 'application/octet-stream'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

if (!inputImage || !fs.existsSync(inputImage)) {
  console.error('Usage: electron tests/smart_crop_headshot_smoke.cjs <portrait.jpg> [preview.png]');
  process.exit(2);
}

const bundle = esbuild.buildSync({
  entryPoints: [path.join(projectRoot, 'src/lib/smartCrop.ts')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  globalName: 'SmartCrop',
  target: ['chrome120'],
  logLevel: 'silent'
}).outputFiles[0].text;

const page = `<!doctype html><meta charset="utf-8"><script src="/smart-crop-bundle.js"></script><script>
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
      if (event.data?.type === 'status' || event.data?.type === 'ready') stage = event.data?.text || event.data?.type;
      if (event.data?.id !== payload.id) return;
      clearTimeout(timer);
      worker.terminate();
      if (event.data.type === 'error') reject(new Error(event.data.error));
      else resolve(event.data.value);
    };
    worker.postMessage(payload, transfer);
  });
}

async function loadImage(downscale) {
  const response = await fetch('/input-image');
  const blob = await response.blob();
  let image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const naturalWidth = image.width;
  const naturalHeight = image.height;
  if (downscale && Math.max(naturalWidth, naturalHeight) > 256) {
    const scale = 256 / Math.max(naturalWidth, naturalHeight);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(naturalWidth * scale)), Math.max(1, Math.round(naturalHeight * scale)));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    image = canvas.transferToImageBitmap();
  }
  return { image, naturalWidth, naturalHeight };
}

window.__headshotSmoke = (async () => {
  const poseInput = await loadImage(true);
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
  const segInput = await loadImage(true);
  const seg = await runWorker('/smart_crop/segmentation-worker.js', {
    id: 2,
    type: 'segment',
    image: segInput.image,
    width: segInput.naturalWidth,
    height: segInput.naturalHeight,
    preferred: 'multiclass'
  }, [segInput.image], 45000);
  const analysis = SmartCrop.mergePoseAndSegmentation(pose, seg);
  const presets = await (await fetch('/smart_crop/presets.json')).json();
  const preset = presets.find(item => item.id === 'face_swap_1_1');
  if (!preset) throw new Error('face_swap_1_1 preset is missing');
  const crop = SmartCrop.solveTightHeadshotCrop(analysis, preset);
  const source = await loadImage(false);
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 768;
  canvas.getContext('2d').drawImage(
    source.image,
    crop.left,
    crop.top,
    crop.right - crop.left,
    crop.bottom - crop.top,
    0,
    0,
    canvas.width,
    canvas.height
  );
  source.image.close();
  const personId = analysis?.parameters?.openpose_json?.[0]?.people?.[0]?.person_id || 'P1';
  const poseValues = analysis?.parameters?.openpose_json?.[0]?.people?.[0]?.pose_keypoints_2d || [];
  const pointOf = index => ({ x: poseValues[index * 3], y: poseValues[index * 3 + 1], score: poseValues[index * 3 + 2] });
  const boundsOf = rows => {
    if (!Array.isArray(rows) || !rows.length) return null;
    return {
      left: Math.min(...rows.map(row => row[0])),
      top: Math.min(...rows.map(row => row[1])),
      right: Math.max(...rows.map(row => row[2])),
      bottom: Math.max(...rows.map(row => row[1] + row[3]))
    };
  };
  return {
    width: analysis.width,
    height: analysis.height,
    crop,
    cropFraction: (crop.bottom - crop.top) / analysis.height,
    semanticHeadRows: analysis?.parameters?.boundary?.person_head_row_spans?.[personId]?.length || 0,
    semanticHeadBounds: boundsOf(analysis?.parameters?.boundary?.person_head_row_spans?.[personId]),
    fullPersonBounds: boundsOf(analysis?.parameters?.boundary?.person_row_spans?.[personId]),
    keypoints: { nose: pointOf(0), neck: pointOf(1), rightEye: pointOf(14), leftEye: pointOf(15), rightEar: pointOf(16), leftEar: pointOf(17) },
    poseMs: pose?.parameters?.timing?.total_ms,
    segMs: seg?.timing?.total_ms,
    preview: canvas.toDataURL('image/png')
  };
})();
</script>`;

const server = http.createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  if (request.url === '/smart-crop-bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(bundle);
    return;
  }
  if (request.url === '/input-image') {
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
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'hong-smart-crop-headshot-smoke-')));
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    await win.loadURL(`http://127.0.0.1:${address.port}/`);
    const result = await win.webContents.executeJavaScript('window.__headshotSmoke');
    const previewBytes = Buffer.from(result.preview.split(',', 2)[1], 'base64');
    fs.writeFileSync(outputImage, previewBytes);
    delete result.preview;
    result.previewPath = outputImage;
    console.log(`SMART_CROP_HEADSHOT_OK ${JSON.stringify(result)}`);
    win.destroy();
  } catch (error) {
    console.error(`SMART_CROP_HEADSHOT_FAILED ${error?.stack || error?.message || error}`);
    process.exitCode = 1;
  } finally {
    server.close();
    app.quit();
  }
});
