import test from 'node:test';
import assert from 'node:assert/strict';
import { applySmartCropMediaPatches, applySmartCropOverrides, buildSmartCropCellUpdates, chooseApproximateAspect, classifySmartCropFailure, createSmartCropMediaPatches, fitCropInsideSource, imageMimeFromPath, mergePoseAndSegmentation, pixelBoxToGridCropData, resolveSmartCropProtection, resolveSmartCropTargets, smartCropConstraintContract, smartCropPreviewEvidence, solveTightHeadshotCrop } from '../src/lib/smartCrop';
import { restoreCropViewport } from '../src/lib/reviewMedia';

test('local image blobs receive a decoder-friendly MIME type', () => {
  assert.equal(imageMimeFromPath('F:/portraits/person.JPG'), 'image/jpeg');
  assert.equal(imageMimeFromPath('F:/portraits/person.jpeg?rev=2'), 'image/jpeg');
  assert.equal(imageMimeFromPath('F:/portraits/person.png'), 'image/png');
  assert.equal(imageMimeFromPath('F:/portraits/person.webp'), 'image/webp');
});

test('pixel crop adapter preserves the exact original-pixel rectangle', () => {
  const crop = pixelBoxToGridCropData(
    { left: 120, top: 80, right: 720, bottom: 880 },
    1200,
    1600,
    { presetId: 'upper_body_3_4' }
  );
  assert.equal(crop.ratio, 3 / 4);
  assert.deepEqual(crop.sourceBox, { left: 120, top: 80, right: 720, bottom: 880, unit: 'px' });
  const restored = restoreCropViewport(crop, 600, 800, 600, 800);
  const left = (600 * restored.scale / 2 - restored.x - 600 / 2) / restored.scale * (1200 / 600);
  const top = (800 * restored.scale / 2 - restored.y - 800 / 2) / restored.scale * (1600 / 800);
  assert.ok(Math.abs(left - 120) < 1e-6);
  assert.ok(Math.abs(top - 80) < 1e-6);
});

test('smart crop preview evidence exposes exact boxes and overwrite risk without mutating the old crop', () => {
  const previous = { ratio: 1, sourceBox: { left: 0, top: 0, right: 100, bottom: 100, unit: 'px' } };
  const cropData = pixelBoxToGridCropData(
    { left: 100, top: 200, right: 700, bottom: 1000 },
    1200,
    1600,
    { presetId: 'upper_body_3_4' }
  );
  const evidence = smartCropPreviewEvidence({ item: { url: 'F:/portrait.png', cropData: previous }, cropData });
  assert.deepEqual(evidence.sourceBoxPx, { left: 100, top: 200, right: 700, bottom: 1000, unit: 'px' });
  assert.deepEqual(evidence.sourceBoxRatio, { x: 1 / 12, y: 0.125, width: 0.5, height: 0.5, unit: 'ratio' });
  assert.deepEqual(evidence.sourceImage, { width: 1200, height: 1600 });
  assert.equal(evidence.wouldOverwrite, true);
  assert.deepEqual(evidence.replacedCrop, previous);
  assert.notStrictEqual(evidence.replacedCrop, previous);
});

test('smart crop contract distinguishes soft framing from hard protection', () => {
  const contract = smartCropConstraintContract({
    id: 'lower_body', label: 'lower body', group: 'test', description: 'test', aspect: '3:4',
    framing: { start: 'knee', end: 'soles' },
    protection: { start: 'hip', end: 'ankle', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true
  });
  assert.equal(contract.semantics.framing.mode, 'soft_preference');
  assert.equal(contract.semantics.protection.mode, 'hard_content_containment');
  assert.equal(contract.semantics.aspect.mode, 'outer_box_geometry');
  assert.match(contract.warnings.join('\n'), /protection\.start=hip.*framing\.start=knee/);
});

test('protection guard rejects a crop that misses the required soles', () => {
  assert.throws(
    () => resolveSmartCropProtection(
      { left: 100, top: 2432, right: 1900, bottom: 3674 },
      { left: 300, top: 3000, right: 1700, bottom: 4066 },
      2000,
      4500,
      { presetId: 'lower_body' }
    ),
    (error: any) => error.code === 'PROTECTION_CLIPPED' && error.details.clippedSides.includes('bottom')
  );
});

test('protection resolution reports aspect expansion beyond the requested start without calling it clipping', () => {
  const resolution = resolveSmartCropProtection(
    { left: 100, top: 1126, right: 2305, bottom: 4066 },
    { left: 300, top: 3088, right: 2100, bottom: 4066 },
    2400,
    4400,
    { presetId: 'lower_body' }
  );
  assert.equal(resolution.expansionPx.top, 1962);
  assert.match(resolution.warnings.join('\n'), /protection 起点上方额外保留 1962px/);
});

test('tight headshot contract only advertises constraints used by its dedicated solver', () => {
  const contract = smartCropConstraintContract({
    id: 'face', label: 'face', group: 'test', description: 'test', aspect: '1:1',
    framing: { start: 'head', end: 'shoulders' },
    protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot', headshot: { topMargin: 0.14, sideMargin: 0.15, shoulderDepth: 0.4 }
  });
  assert.equal(contract.strategy, 'tight_headshot');
  assert.equal(contract.semantics.headshot.mode, 'dedicated_solver');
  assert.equal(contract.effective.framing, undefined);
  assert.equal(contract.effective.protection, undefined);
  assert.deepEqual(contract.effective.headshot, { topMargin: 0.14, sideMargin: 0.15, shoulderDepth: 0.4 });
});

test('smart crop classifies bent-pose anchor ordering failures for agents', () => {
  const failure = classifySmartCropFailure(new Error('framing顺序与躯干方向冲突'));
  assert.equal(failure.code, 'ANCHOR_ORDER_CONFLICT');
  assert.equal(failure.details?.constraint, 'framing');
  assert.match(failure.details?.reason || '', /弯腿|坐姿/);
});

test('smart crop changes preserve untouched media items and string URLs', () => {
  const records = [{ id: 'r1', media: ['F:/a.png', { url: 'F:/b.png', rating: 4 }] }];
  const updates = buildSmartCropCellUpdates([{
    rowId: 'r1', fieldId: 'media', index: 1, item: records[0].media[1], warnings: [], cropData: { ratio: 1 }
  }], records);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].value[0], 'F:/a.png');
  assert.deepEqual(updates[0].value[1], { url: 'F:/b.png', rating: 4, cropData: { ratio: 1 } });
});

test('smart crop writeback follows media identity after reordering instead of stale array index', () => {
  const original = [{ id: 'r1', media: [{ url: 'F:/a.png' }, { url: 'F:/b.png' }] }];
  const patches = createSmartCropMediaPatches([{
    rowId: 'r1', fieldId: 'media', index: 1, item: original[0].media[1], warnings: [], cropData: { ratio: 1 }
  }]);
  const current = [{ id: 'r1', media: [{ url: 'F:/b.png', rating: 5 }, { url: 'F:/a.png' }] }];
  const result = applySmartCropMediaPatches(patches, current);
  assert.equal(result.applied, 1);
  assert.equal(result.skipped.length, 0);
  assert.deepEqual(result.updates[0].value[0], { url: 'F:/b.png', rating: 5, cropData: { ratio: 1 } });
  assert.deepEqual(result.updates[0].value[1], { url: 'F:/a.png' });
});

test('smart crop writeback rejects deleted or replaced media without touching the cell', () => {
  const patches = createSmartCropMediaPatches([{
    rowId: 'r1', fieldId: 'media', index: 0, item: { url: 'F:/old.png' }, warnings: [], cropData: { ratio: 1 }
  }]);
  const result = applySmartCropMediaPatches(patches, [{ id: 'r1', media: [{ url: 'F:/new.png' }] }]);
  assert.equal(result.applied, 0);
  assert.equal(result.updates.length, 0);
  assert.equal(result.skipped[0].code, 'MEDIA_CHANGED');
});

test('smart crop writeback refuses indistinguishable duplicate sources after concurrent edits', () => {
  const patches = createSmartCropMediaPatches([{
    rowId: 'r1', fieldId: 'media', index: 0, item: { url: 'F:/same.png' }, warnings: [], cropData: { ratio: 1 }
  }]);
  const result = applySmartCropMediaPatches(patches, [{ id: 'r1', media: [{ url: 'F:/same.png' }, { url: 'F:/same.png' }] }]);
  assert.equal(result.applied, 0);
  assert.equal(result.updates.length, 0);
  assert.equal(result.skipped[0].details.reason, 'missing_or_ambiguous');
});

test('legacy ratio crop restores deterministically at the current preview size', () => {
  const restored = restoreCropViewport({ unit: 'ratio', x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, 1000, 800, 500, 400);
  assert.equal(restored.scale, 1);
  assert.equal(restored.x, 150);
  assert.equal(restored.y, 40);
});

test('non-virtual smart crop keeps its aspect while fitting back inside the source', () => {
  const fitted = fitCropInsideSource({ left: -80, top: 100, right: 720, bottom: 900 }, 640, 960);
  assert.ok(fitted.left >= 0);
  assert.ok(fitted.top >= 0);
  assert.ok(fitted.right <= 640);
  assert.ok(fitted.bottom <= 960);
  assert.ok(Math.abs((fitted.right - fitted.left) / (fitted.bottom - fitted.top) - 1) < 1e-9);
});

test('temporary smart crop overrides merge safely without mutating the shared preset', () => {
  const base = {
    id: 'face_swap_1_1', label: '头像', group: '人像', description: '', aspect: '1:1',
    framing: { start: 'head', end: 'shoulders' }, protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 6, right: 5, bottom: 4, left: 5 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot' as const, headshot: { topMargin: 0.14, minTopMargin: 0.06, sideMargin: 0.15, shoulderDepth: 0.4 }
  };
  const effective = applySmartCropOverrides(base, { aspect: '3:4', headshot: { topMargin: 0.2, shoulderDepth: 0.65 } });
  assert.equal(effective.aspect, '3:4');
  assert.deepEqual(effective.headshot, { topMargin: 0.2, minTopMargin: 0.06, sideMargin: 0.15, shoulderDepth: 0.65 });
  assert.equal(base.aspect, '1:1');
  assert.equal(base.headshot.topMargin, 0.14);
  assert.throws(() => applySmartCropOverrides(base, { headshot: { topMargin: 0.05, minTopMargin: 0.08 } }), /不能大于/);
  assert.throws(() => applySmartCropOverrides(base, { framing: { end: 'hip' } }), /紧凑头像/);
});

test('smart crop override errors expose stable caller-facing codes', () => {
  const bodyPreset = {
    id: 'pants_3_4', label: '裤子', group: '服装', description: '', aspect: '3:4',
    framing: { start: 'above_waist', end: 'ankle' }, protection: { start: 'hip', end: 'ankle', hands: 'none' },
    spacing: { top: 2, right: 2, bottom: 2, left: 2 }, allow_virtual: false, enabled: true,
    strategy: 'anatomy' as const
  };
  const effective = applySmartCropOverrides(bodyPreset, {
    framing: { start: 'knee', end: 'soles', startOffset: -0.1, endOffset: 0.05 },
    protection: { start: 'above_knee', end: 'ankle', startOffset: 0.05, hands: 'none' }
  });
  assert.deepEqual(effective.framing, { start: 'knee', end: 'soles', startOffset: -0.1, endOffset: 0.05 });
  assert.equal(effective.protection.start, 'above_knee');
  assert.throws(
    () => applySmartCropOverrides(bodyPreset, { framing: { startOffset: 1.2 } }),
    (error: any) => error.code === 'INVALID_CROP_OVERRIDE' && /startOffset/.test(error.message)
  );
  assert.throws(
    () => applySmartCropOverrides(bodyPreset, { headshot: { topMargin: 0.1 } }),
    (error: any) => error.code === 'PARAM_NOT_APPLICABLE'
  );
});

test('agent smart crop target resolution reports every invalid or unsupported target', () => {
  const records = [{
    id: 'r1',
    media: [{ url: 'F:/portrait.png', cropData: { ratio: 1 } }, { url: 'F:/clip.mp4', type: 'video/mp4' }],
    empty: [],
    text: 'not media'
  }];
  const fields = [
    { id: 'media', type: 'attachment' },
    { id: 'empty', type: 'attachment' },
    { id: 'text', type: 'text' }
  ];
  const result = resolveSmartCropTargets(records, fields, {
    targets: [
      { rowId: 'r1', fieldId: 'media', index: 0 },
      { rowId: 'r1', fieldId: 'media', index: 5 },
      { rowId: 'r1', fieldId: 'empty' },
      { rowId: 'r1', fieldId: 'text' },
      { rowId: 'missing', fieldId: 'media' },
      { rowId: 'r1', fieldId: 'missing' }
    ]
  });
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].item.cropData.ratio, 1);
  assert.deepEqual(result.skipped.map(item => item.reason), [
    'TARGET_INDEX_OUT_OF_RANGE',
    'NO_MEDIA_IN_TARGET',
    'INVALID_FIELD_TYPE',
    'ROW_NOT_FOUND',
    'FIELD_NOT_FOUND'
  ]);
  assert.equal(result.requestedTotal, 6);
});

test('agent smart crop cell selectors keep images and explicitly skip other media', () => {
  const result = resolveSmartCropTargets(
    [{ id: 'r1', media: ['F:/portrait.jpg', { url: 'F:/voice.mp3', type: 'audio/mpeg' }] }],
    [{ id: 'media', type: 'attachment' }],
    { rowIds: ['r1'], fieldIds: ['media'] }
  );
  assert.equal(result.targets.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'UNSUPPORTED_MEDIA');
});

test('approximate aspect follows the protected garment shape while staying on common ratios', () => {
  const common = ['1:1', '3:4', '4:3', '9:16', '16:9'];
  assert.equal(chooseApproximateAspect(1.02, '3:4', common), '1:1');
  assert.equal(chooseApproximateAspect(0.74, '3:4', common), '3:4');
  assert.equal(chooseApproximateAspect(0.58, '3:4', common), '9:16');
});

test('tight headshot uses the head mask and treats shoulders as a soft framing reference', () => {
  const pose = Array.from({ length: 18 * 3 }, () => 0);
  const setPoint = (index: number, x: number, y: number) => {
    pose[index * 3] = x;
    pose[index * 3 + 1] = y;
    pose[index * 3 + 2] = 0.95;
  };
  setPoint(0, 460, 430);
  setPoint(1, 500, 650);
  setPoint(2, 760, 730);
  setPoint(5, 260, 790);
  const rows = Array.from({ length: 60 }, (_, index) => [160 - index, 80 + index * 10, 760 + index, 10]);
  const crop = solveTightHeadshotCrop({
    width: 1104,
    height: 1654,
    parameters: {
      openpose_json: [{ people: [{ person_id: 'P1', pose_keypoints_2d: pose }] }],
      boundary: { person_row_spans: { P1: rows } }
    }
  }, {
    id: 'face_swap_1_1', label: '', group: '', description: '', aspect: '1:1',
    framing: { start: 'head', end: 'shoulders' }, protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot', headshot: { topMargin: 0.1, sideMargin: 0.15, shoulderDepth: 0.4 }
  });
  assert.ok(Math.abs((crop.right - crop.left) - (crop.bottom - crop.top)) < 1e-6);
  assert.ok(crop.top >= 0 && crop.left >= 0 && crop.right <= 1104 && crop.bottom <= 1654);
  assert.ok(crop.top < 260, 'face-landmark fallback should reserve space above the hairline');
  assert.ok(crop.bottom < 1100, 'headshot should not retain the lower torso');
});

test('portrait fallback keeps working without shoulders and supports a 3:4 chest crop', () => {
  const pose = Array.from({ length: 18 * 3 }, () => 0);
  const setPoint = (index: number, x: number, y: number) => {
    pose[index * 3] = x;
    pose[index * 3 + 1] = y;
    pose[index * 3 + 2] = 0.9;
  };
  setPoint(0, 400, 330);
  setPoint(1, 410, 560);
  setPoint(14, 360, 310);
  setPoint(15, 445, 315);
  const crop = solveTightHeadshotCrop({
    width: 900,
    height: 1400,
    parameters: {
      openpose_json: [{ people: [{ person_id: 'P1', pose_keypoints_2d: pose }] }],
      boundary: { person_row_spans: {} }
    }
  }, {
    id: 'portrait_long_hair_3_4', label: '', group: '', description: '', aspect: '3:4',
    framing: { start: 'head', end: 'hip' }, protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot', headshot: { topMargin: 0.1, sideMargin: 0.18, shoulderDepth: 0.95 }
  });
  assert.ok(Math.abs((crop.right - crop.left) / (crop.bottom - crop.top) - 3 / 4) < 1e-9);
  assert.ok(crop.top >= 0 && crop.left >= 0 && crop.right <= 900 && crop.bottom <= 1400);
});

test('semantic head contour controls crop scale while broad shoulders remain context only', () => {
  const pose = Array.from({ length: 18 * 3 }, () => 0);
  const setPoint = (index: number, x: number, y: number) => {
    pose[index * 3] = x;
    pose[index * 3 + 1] = y;
    pose[index * 3 + 2] = 0.95;
  };
  setPoint(0, 500, 400);
  setPoint(1, 500, 620);
  setPoint(2, 750, 700);
  setPoint(5, 250, 700);
  setPoint(14, 450, 380);
  setPoint(15, 550, 380);
  setPoint(16, 400, 410);
  setPoint(17, 600, 410);
  const fullPersonRows = Array.from({ length: 90 }, (_, index) => [100, 100 + index * 10, 900, 10]);
  const headRows = Array.from({ length: 52 }, (_, index) => [300, 100 + index * 10, 700, 10]);
  const preset = {
    id: 'face_swap_1_1', label: '', group: '', description: '', aspect: '1:1',
    framing: { start: 'head', end: 'shoulders' }, protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot' as const, headshot: { topMargin: 0.1, sideMargin: 0.15, shoulderDepth: 0.4 }
  };
  const baseAnalysis = {
    width: 1000,
    height: 1500,
    parameters: {
      openpose_json: [{ people: [{ person_id: 'P1', pose_keypoints_2d: pose }] }],
      boundary: { person_row_spans: { P1: fullPersonRows } }
    }
  };
  const legacyCrop = solveTightHeadshotCrop(baseAnalysis, preset);
  const semanticCrop = solveTightHeadshotCrop({
    ...baseAnalysis,
    parameters: {
      ...baseAnalysis.parameters,
      boundary: {
        ...baseAnalysis.parameters.boundary,
        person_head_row_spans: { P1: headRows }
      }
    }
  }, preset);
  assert.ok((semanticCrop.right - semanticCrop.left) < (legacyCrop.right - legacyCrop.left) - 150);
  assert.ok(semanticCrop.bottom < 900, 'headshot context should stop near the upper shoulders, not the lower torso');
  assert.ok(semanticCrop.top <= 100, 'semantic hair top must remain protected');
});

test('headshot drops soft shoulder context before it sacrifices the detected hair top', () => {
  const pose = Array.from({ length: 18 * 3 }, () => 0);
  const setPoint = (index: number, x: number, y: number) => {
    pose[index * 3] = x;
    pose[index * 3 + 1] = y;
    pose[index * 3 + 2] = 0.99;
  };
  setPoint(0, 457, 674);
  setPoint(1, 539, 967);
  setPoint(2, 790, 1030);
  setPoint(5, 250, 1030);
  setPoint(14, 347, 605);
  setPoint(15, 554, 568);
  setPoint(16, 303, 627);
  setPoint(17, 668, 562);
  const rows = Array.from({ length: 137 }, (_, index) => [144, 96 + index * 6, 838, 6]);
  const crop = solveTightHeadshotCrop({
    width: 1024,
    height: 1536,
    parameters: {
      openpose_json: [{ people: [{ person_id: 'P1', pose_keypoints_2d: pose }] }],
      boundary: { person_head_row_spans: { P1: rows }, person_row_spans: { P1: rows } }
    }
  }, {
    id: 'face_swap_1_1', label: '', group: '', description: '', aspect: '1:1',
    framing: { start: 'head', end: 'shoulders' }, protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot', headshot: { topMargin: 0.1, sideMargin: 0.15, shoulderDepth: 0.4 }
  });
  assert.ok(crop.top <= 20, 'hair top plus configured top margin should win over optional lower-body context');
  assert.equal(Math.round(crop.right - crop.left), 1024);
  assert.ok(crop.bottom <= 1050, 'square crop should not drift down to retain the torso');
});

test('source-limited headshot may trade ideal top space for shoulders but keeps the hard hair clearance', () => {
  const pose = Array.from({ length: 18 * 3 }, () => 0);
  const setPoint = (index: number, x: number, y: number) => {
    pose[index * 3] = x;
    pose[index * 3 + 1] = y;
    pose[index * 3 + 2] = 0.99;
  };
  setPoint(0, 457, 674);
  setPoint(1, 539, 967);
  setPoint(2, 790, 1030);
  setPoint(5, 250, 1030);
  setPoint(14, 347, 605);
  setPoint(15, 554, 568);
  setPoint(16, 303, 627);
  setPoint(17, 668, 562);
  const rows = Array.from({ length: 137 }, (_, index) => [144, 96 + index * 6, 838, 6]);
  const crop = solveTightHeadshotCrop({
    width: 1024,
    height: 1536,
    parameters: {
      openpose_json: [{ people: [{ person_id: 'P1', pose_keypoints_2d: pose }] }],
      boundary: {
        person_head_row_spans: { P1: rows },
        person_part_row_spans: { P1: { hair: rows.slice(0, 90) } },
        person_row_spans: { P1: rows }
      }
    }
  }, {
    id: 'face_swap_1_1', label: '', group: '', description: '', aspect: '1:1',
    framing: { start: 'head', end: 'shoulders' }, protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot', headshot: { topMargin: 0.14, minTopMargin: 0.06, sideMargin: 0.15, shoulderDepth: 0.4 }
  });
  assert.ok(crop.top > 20, 'limited source should spend some surplus top space on shoulder context');
  assert.ok(96 - crop.top >= (crop.bottom - crop.top) * 0.06 - 1e-6, 'hair must keep the configured minimum breathing room');
  assert.ok(crop.bottom > 1050, 'the recovered space should add a small amount of shoulder context');
});

test('thin semantic hair strands remain a hard boundary even when robust head rows would ignore them', () => {
  const pose = Array.from({ length: 18 * 3 }, () => 0);
  const setPoint = (index: number, x: number, y: number) => {
    pose[index * 3] = x;
    pose[index * 3 + 1] = y;
    pose[index * 3 + 2] = 0.95;
  };
  setPoint(0, 500, 390);
  setPoint(1, 500, 620);
  setPoint(2, 720, 690);
  setPoint(5, 280, 690);
  setPoint(14, 450, 370);
  setPoint(15, 550, 370);
  setPoint(16, 410, 400);
  setPoint(17, 590, 400);
  const mainHead = Array.from({ length: 50 }, (_, index) => [310, 120 + index * 10, 690, 10]);
  const thinHairTip = [496, 70, 504, 6];
  const crop = solveTightHeadshotCrop({
    width: 1000,
    height: 1500,
    parameters: {
      openpose_json: [{ people: [{ person_id: 'P1', pose_keypoints_2d: pose }] }],
      boundary: {
        person_head_row_spans: { P1: [thinHairTip, ...mainHead] },
        person_part_row_spans: { P1: { hair: [thinHairTip, ...mainHead.slice(0, 25)] } },
        person_row_spans: { P1: mainHead }
      }
    }
  }, {
    id: 'face_swap_1_1', label: '', group: '', description: '', aspect: '1:1',
    framing: { start: 'head', end: 'shoulders' }, protection: { start: 'head', end: 'shoulders', hands: 'none' },
    spacing: { top: 0, right: 0, bottom: 0, left: 0 }, allow_virtual: false, enabled: true,
    strategy: 'tight_headshot', headshot: { topMargin: 0.14, sideMargin: 0.15, shoulderDepth: 0.4 }
  });
  assert.ok(crop.top <= 10, 'the highest detected hair pixel must retain visible breathing room');
});

test('mergePoseAndSegmentation assigns connected components to P1 and P2 separately', () => {
  const makePose = (cx: number) => {
    const pose = Array.from({ length: 18 * 3 }, () => 0);
    const setPoint = (index: number, x: number, y: number) => {
      pose[index * 3] = x;
      pose[index * 3 + 1] = y;
      pose[index * 3 + 2] = 0.95;
    };
    setPoint(0, cx, 300);
    setPoint(1, cx, 420);
    setPoint(2, cx - 50, 440);
    setPoint(5, cx + 50, 440);
    return pose;
  };

  const mw = 100;
  const mh = 100;
  const mask = new Uint8Array(mw * mh);
  // Left person blob (x: 15..35, y: 15..70), Right person blob (x: 65..85, y: 20..75)
  for (let y = 15; y < 70; y += 1) {
    for (let x = 15; x < 35; x += 1) mask[y * mw + x] = y < 30 ? 1 : 4;
  }
  for (let y = 20; y < 75; y += 1) {
    for (let x = 65; x < 85; x += 1) mask[y * mw + x] = y < 35 ? 1 : 4;
  }

  const merged = mergePoseAndSegmentation({
    width: 1000,
    height: 1000,
    parameters: {
      openpose_json: [{
        people: [
          { person_id: 'P1', pose_keypoints_2d: makePose(250) },
          { person_id: 'P2', pose_keypoints_2d: makePose(750) }
        ]
      }]
    }
  }, { mask, maskWidth: mw, maskHeight: mh, width: 1000, height: 1000, modelKind: 'multiclass' });

  assert.equal(merged.parameters.boundary.method, 'dual_model_image_segmenter');
  assert.equal(merged.parameters.boundary.matched, true);
  const p1Rows = merged.parameters.boundary.person_row_spans.P1;
  const p2Rows = merged.parameters.boundary.person_row_spans.P2;
  const p1HeadRows = merged.parameters.boundary.person_head_row_spans.P1;
  const p2HeadRows = merged.parameters.boundary.person_head_row_spans.P2;
  assert.ok(p1Rows.length > 0 && p2Rows.length > 0);
  assert.ok(p1HeadRows.length > 0 && p2HeadRows.length > 0);
  assert.ok(Math.max(...p1Rows.map((r: number[]) => r[2])) <= 360, 'P1 contour should stay on left person');
  assert.ok(Math.min(...p2Rows.map((r: number[]) => r[0])) >= 640, 'P2 contour should stay on right person');
  assert.ok(Math.max(...p1HeadRows.map((r: number[]) => r[1] + r[3])) <= 300, 'P1 head contour must exclude clothes');
  assert.ok(Math.max(...p2HeadRows.map((r: number[]) => r[1] + r[3])) <= 350, 'P2 head contour must exclude clothes');
  assert.ok(merged.parameters.boundary.person_part_row_spans.P1.clothes.length > 0);
  assert.deepEqual(merged.parameters.boundary.categoryMap, {
    background: 0, hair: 1, body_skin: 2, face: 3, clothes: 4, accessories: 5
  });
});

test('mergePoseAndSegmentation gracefully degrades when segmentation is missing', () => {
  const poseOnly = { width: 800, height: 1000, parameters: { openpose_json: [{ people: [] }] } };
  assert.strictEqual(mergePoseAndSegmentation(poseOnly, null), poseOnly);
});
