import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^\uFEFF/, '');

test('release version is 2.5.5 in package metadata', () => {
  const pkg = JSON.parse(read('../package.json'));
  const lock = JSON.parse(read('../package-lock.json'));
  assert.equal(pkg.version, '2.5.5');
  assert.equal(lock.version, '2.5.5');
  assert.equal(lock.packages[''].version, '2.5.5');
});

test('reference Fast workflow loads Turbo LoRA and declares Hongs compatibility node', () => {
  const fast = JSON.parse(read('../comfyui/workflows/minimax-h3-reference-router/fast_api.json'));
  const manifest = JSON.parse(read('../comfyui/workflows/minimax-h3-reference-router/manifest.json'));
  assert.equal(fast['142'].class_type, 'MiniMaxH3TurboLoRA');
  assert.ok(manifest.requiredNodeTypes.includes('MiniMaxH3TurboLoRA'));
  assert.equal(manifest.routing.fastMixedReferenceFix.nodeType, 'H3TurboMixedReferenceFix');
  assert.ok(manifest.requiredNodeTypes.includes('H3TurboMixedReferenceFix'));
});

test('every workflow plugin requirement resolves to a catalog entry with install guidance', async () => {
  const { listComfyUIWorkflows, loadComfyUIPluginCatalog } = await import('../comfyui/workflow_registry.js');
  const catalog = loadComfyUIPluginCatalog();
  for (const workflow of listComfyUIWorkflows()) {
    assert.ok(workflow.pluginRequirements.length > 0, `${workflow.id} has no plugin requirements`);
    for (const requirement of workflow.pluginRequirements) {
      const plugin = catalog.plugins[requirement.pluginId];
      assert.ok(plugin, `${workflow.id} references unknown plugin ${requirement.pluginId}`);
      assert.ok(plugin.repository, `${requirement.pluginId} has no repository`);
      assert.ok(plugin.providedNodeTypes.length > 0, `${requirement.pluginId} has no node mapping`);
      if (plugin.kind === 'custom_node') assert.ok(plugin.installCommand, `${requirement.pluginId} has no install command`);
    }
  }
});

test('protocol checker discovers template nodes by type instead of fixed workflow node ids', () => {
  const source = read('../scripts/check_comfyui_protocol.mjs');
  assert.match(source, /node\.class_type === 'BasicScheduler'/);
  assert.match(source, /node\.class_type === 'KSamplerSelect'/);
  assert.doesNotMatch(source, /workflow\['135'\]/);
});

test('local ComfyUI polling is excluded from the remote-provider total timeout', () => {
  const source = read('../network_polling.js');
  assert.match(source, /if \(job\.provider !== 'comfyui'\)/);
  assert.match(source, /phase: 'failed'.*message: 'Timeout'/s);
});

test('audio thumbnail has one central music overlay and no bottom music badge', () => {
  const source = read('../src/components/Grid.tsx');
  const thumbnailStart = source.indexOf('const ThumbnailImage =');
  const thumbnailEnd = source.indexOf('type LocateCellRequest', thumbnailStart);
  const thumbnail = source.slice(thumbnailStart, thumbnailEnd);
  assert.equal((thumbnail.match(/<Music2\b/g) || []).length, 1);
  assert.doesNotMatch(thumbnail, /absolute\s+bottom[^>]*>[\s\S]{0,300}<Music2/);
});

test('optional ComfyUI BAT path is passed only to local ComfyUI jobs', () => {
  const grid = read('../src/components/Grid.tsx');
  const settings = read('../src/components/ApiSettings.tsx');
  const runner = read('../media_job_runner.js');
  assert.match(settings, /bitable_comfyui_bat_path/);
  assert.match(settings, /selectComfyUIBat/);
  assert.match(grid, /imgSet\.provider === 'comfyui'.*bitable_comfyui_bat_path/);
  assert.match(grid, /vidSet\.provider === 'comfyui'.*bitable_comfyui_bat_path/);
  assert.match(runner, /provider === 'comfyui'/);
  assert.match(runner, /ensureComfyUIAvailable/);
});

test('ComfyUI launcher permits localhost only and keeps its command window visible', () => {
  const launcher = read('../comfyui_launcher.js');
  assert.match(launcher, /127\.0\.0\.1/);
  assert.match(launcher, /localhost/);
  assert.match(launcher, /windowsHide: false/);
  assert.match(launcher, /\['\/d', '\/k', 'call', resolvedBat\]/);
});
