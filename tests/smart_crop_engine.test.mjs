import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadManualCrop() {
  const context = vm.createContext({ console, structuredClone });
  context.globalThis = context;
  context.module = { exports: {} };
  vm.runInContext(fs.readFileSync(new URL('../public/smart_crop/engine/manual-next-crop-policy.js', import.meta.url), 'utf8'), context);
  context.module = { exports: {} };
  vm.runInContext(fs.readFileSync(new URL('../public/smart_crop/engine/manual-next-policy.js', import.meta.url), 'utf8'), context);
  return context.module.exports;
}

function pose() {
  const points = Array.from({ length: 18 * 3 }, () => 0);
  const set = (index, x, y) => {
    points[index * 3] = x;
    points[index * 3 + 1] = y;
    points[index * 3 + 2] = 0.99;
  };
  set(0, 500, 180);
  set(1, 500, 300);
  set(2, 650, 350);
  set(5, 350, 350);
  set(8, 450, 700);
  set(11, 550, 700);
  set(9, 450, 1100);
  set(12, 550, 1100);
  set(10, 450, 1400);
  set(13, 550, 1400);
  return points;
}

test('generic crop uses semantic clothes width beyond the skeletal corridor', () => {
  const engine = loadManualCrop();
  const rule = engine.defaults();
  rule.name = 'wide skirt';
  rule.aspect = '1:1';
  rule.output = { width: 1024, height: 1024 };
  rule.allow_virtual = false;
  rule.max_extension_fraction = 0;
  rule.avoid_regions = [];
  rule.framing = { start: 'above_waist', end: 'above_knee' };
  rule.protection = { ...rule.protection, start: 'hip', end: 'above_knee', hands: 'none', preference_extension_limit: 0 };
  rule.spacing = { unit: 'percent', top: 0, right: 0, bottom: 0, left: 0 };
  const narrowPersonRows = Array.from({ length: 50 }, (_, index) => [360, 600 + index * 8, 640, 8]);
  const wideSkirtRows = Array.from({ length: 45 }, (_, index) => [100, 720 + index * 8, 900, 8]);
  const result = engine.solve({
    rule,
    width: 1000,
    height: 1500,
    poses: [{ people: [{ person_id: 'P1', pose_keypoints_2d: pose() }] }],
    parameters: {
      boundary: {
        row_spans: narrowPersonRows,
        person_row_spans: { P1: narrowPersonRows },
        person_part_row_spans: { P1: { clothes: wideSkirtRows } }
      }
    }
  });
  assert.ok(result.anatomy.bounds.left <= 100, 'wide left skirt edge should remain protected');
  assert.ok(result.anatomy.bounds.right >= 900, 'wide right skirt edge should remain protected');
  assert.match(result.trace.join('\n'), /服装轮廓 已参与/);
});
