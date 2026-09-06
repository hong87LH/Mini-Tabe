// Run with Electron: electron scripts/benchmark_thumbnails.cjs --manifest=paths.json --output=report.json
// Manifest: JSON array of up to 100 absolute local/UNC image paths. Originals are read only.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aitable-thumb-benchmark-'));
app.setPath('userData', scratch);
app.setPath('sessionData', scratch);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const { createThumbnailScheduler } = await import(pathToFileURL(path.resolve(__dirname, '../thumbnail_scheduler.js')));
  let sources;
  if (arg('manifest')) {
    sources = JSON.parse(fs.readFileSync(arg('manifest'), 'utf8'));
    if (!Array.isArray(sources) || !sources.length || sources.length > 100 || sources.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw Error('Expected 1–100 absolute image paths');
  } else {
    const sharp = require('sharp');
    sources = [];
    for (let i = 0; i < 30; i++) {
      const file = path.join(scratch, `synthetic-${i}.png`);
      await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: i * 7, g: 100, b: 200 } } }).png().toFile(file);
      sources.push(file);
    }
  }
  const run = async (files, label) => {
    const scheduler = createThumbnailScheduler(3);
    const started = performance.now();
    const results = await Promise.all(files.map(file => scheduler.request(file, async () => {
      try {
        await fs.promises.access(file);
        const image = await nativeImage.createThumbnailFromPath(file, { width: 150, height: 150 });
        return !image.isEmpty();
      } catch { return false; }
    })));
    return { label, elapsedMs: performance.now() - started, succeeded: results.filter(Boolean).length, failed: results.filter(x => !x).length, ...scheduler.stats() };
  };
  const report = { kind: arg('manifest') ? 'source-versus-local-copy' : 'synthetic-local-only', samples: sources.length, scratch, cacheNote: 'First pass is not a guaranteed cold Windows/SMB cache. No system caches were cleared.', measurements: [] };
  report.measurements.push(await run(sources, 'source-first-pass'));
  report.measurements.push(await run(sources, 'source-repeat'));
  if (arg('manifest')) {
    const copies = [];
    for (let i = 0; i < sources.length; i++) {
      const copy = path.join(scratch, `copy-${i}${path.extname(sources[i])}`);
      await fs.promises.copyFile(sources[i], copy); copies.push(copy);
    }
    report.measurements.push(await run(copies, 'local-copy-first-pass'));
    report.measurements.push(await run(copies, 'local-copy-repeat'));
  }
  const output = path.resolve(arg('output') || path.join(scratch, 'report.json'));
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  console.log(`Report: ${output}`);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
