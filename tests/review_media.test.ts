import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLocalPath, isReviewImage, intersectsReviewViewport, refreshReviewImages, loadFreshReviewThumbnail, restoreCropViewport, SYSTEM_THUMBNAIL_SIZE } from '../src/lib/reviewMedia';

test('Photoshop uses decoded local originals, not preview/blob URLs', () => {
  assert.equal(reviewLocalPath('file:///F:/素材/a%20b.png'), 'F:/素材/a b.png');
  assert.equal(reviewLocalPath('local-img://F%3A%5C素材%5Ca.png'), 'F:\\素材\\a.png');
  assert.equal(reviewLocalPath('file://server/share/a.png'), '//server/share/a.png');
  assert.equal(reviewLocalPath('F:\\素材\\a#1.png'), 'F:\\素材\\a#1.png');
  for (const url of ['https://example.com/a.png', 'blob:test', 'data:image/png;base64,abc', 'relative.png']) assert.equal(reviewLocalPath(url), null);
});
test('media classification excludes video/audio even in attachment columns', () => {
  assert.equal(isReviewImage('F:/a.png'), true);
  assert.equal(isReviewImage('https://example.com/id', 'image/png'), true);
  for (const path of ['F:/a.mp4', 'F:/a.wav', 'https://example.com/v.webm?token=x']) assert.equal(isReviewImage(path), false);
  assert.equal(isReviewImage('unknown', 'video'), false);
});
test('saved crop viewport preserves the same source rectangle when preview size changes', () => {
  const crop = {
    scale: 3.780481908411403,
    x: 58.57939810363517,
    y: 1410.9594381999266,
    imgW: 298.535719535556,
    imgH: 941.6250290203379,
    maskW: 845,
    maskH: 475.3125
  };
  const sourceRect = (value: typeof crop) => ({
    x: (value.imgW * value.scale / 2 - value.x - value.maskW / 2) / (value.imgW * value.scale),
    y: (value.imgH * value.scale / 2 - value.y - value.maskH / 2) / (value.imgH * value.scale),
    width: value.maskW / (value.imgW * value.scale),
    height: value.maskH / (value.imgH * value.scale)
  });
  const currentImgW = 360;
  const currentImgH = currentImgW * 3785 / 1200;
  const restored = restoreCropViewport(crop, currentImgW, currentImgH, crop.maskW, crop.maskH);
  const reopened = sourceRect({ ...crop, ...restored, imgW: currentImgW, imgH: currentImgH });
  const saved = sourceRect(crop);
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(reopened[key] - saved[key]) < 5e-6, `${key} drifted`);
});
test('crop viewport restoration is unchanged at the original preview size', () => {
  const crop = { scale: 2.5, x: -120, y: 85, imgW: 400, imgH: 600, maskW: 845, maskH: 475.3125 };
  const restored = restoreCropViewport(crop, crop.imgW, crop.imgH, crop.maskW, crop.maskH);
  assert.ok(Math.abs(restored.scale - crop.scale) < 1e-12);
  assert.ok(Math.abs(restored.x - crop.x) < 1e-12);
  assert.ok(Math.abs(restored.y - crop.y) < 1e-12);
});
test('visible area selection excludes offscreen, folded and zero-size thumbnails', () => {
  const viewport = { top: 100, bottom: 700, left: 0, right: 1000 };
  assert.equal(intersectsReviewViewport({ top: 90, bottom: 150, left: 10, right: 210 }, viewport), true);
  assert.equal(intersectsReviewViewport({ top: 700, bottom: 900, left: 10, right: 210 }, viewport), false);
  assert.equal(intersectsReviewViewport({ top: 0, bottom: 0, left: 0, right: 0 }, viewport), false);
  assert.equal(intersectsReviewViewport({ top: 200, bottom: 300, left: 1000, right: 1200 }, viewport), false);
});
test('refresh deduplicates paths, bounds concurrency, and isolates failed files', async () => {
  let active = 0, maximum = 0;
  const visited: string[] = [];
  const result = await refreshReviewImages(['a', 'b', 'a', 'bad', 'c'], async path => {
    visited.push(path); active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (path === 'bad') throw new Error('missing');
  });
  assert.equal(maximum, 2);
  assert.equal(visited.length, 4);
  assert.deepEqual(result, { succeeded: 3, failures: ['bad'] });
});
test('empty view causes no disk reads', async () => {
  assert.deepEqual(await refreshReviewImages([], async () => { throw new Error('unexpected'); }), { succeeded: 0, failures: [] });
});
test('missing system thumbnails fail explicitly without original-image fallback', async () => {
  for (const value of [null, '', 'file:///F:/original.png', 'blob:original']) {
    await assert.rejects(loadFreshReviewThumbnail('F:/missing.png', async () => value), /System thumbnail unavailable/);
  }
  await assert.rejects(loadFreshReviewThumbnail('F:/a.png'), /requires Electron/);
  await assert.rejects(loadFreshReviewThumbnail('F:/a.png', async () => { throw new Error('native failure'); }), /native failure/);
});
test('refresh requests native 150px thumbnails using decoded local paths', async () => {
  const calls: unknown[] = [];
  const thumbnail = 'data:image/png;base64,system-thumbnail';
  const result = await loadFreshReviewThumbnail('file:///F:/素材/a%20b.png', async (path, size) => {
    calls.push({ path, size });
    return thumbnail;
  });
  assert.equal(result, thumbnail);
  assert.deepEqual(calls, [{ path: 'F:/素材/a b.png', size: { width: 150, height: 150 } }]);
  assert.deepEqual(SYSTEM_THUMBNAIL_SIZE, { width: 150, height: 150 });
});
test('every refresh re-requests the native thumbnail without retaining the previous result', async () => {
  let calls = 0;
  const native = async (_path: string, size: { width: number; height: number }) => {
    assert.deepEqual(size, { width: 150, height: 150 });
    size.width = 400; // A consumer cannot mutate the shared dimensions.
    return `data:image/png;base64,revision-${++calls}`;
  };
  assert.equal(await loadFreshReviewThumbnail('F:/a.png', native), 'data:image/png;base64,revision-1');
  assert.equal(await loadFreshReviewThumbnail('F:/a.png', native), 'data:image/png;base64,revision-2');
  assert.equal(calls, 2);
});
test('network and browser-only images are not downloaded or decoded by refresh', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not download originals'); });
  let nativeCalls = 0;
  for (const path of ['https://example.com/a.png', 'blob:original', 'data:image/png;base64,abc']) {
    await assert.rejects(loadFreshReviewThumbnail(path, async () => { nativeCalls++; return null; }), /requires a local image/);
  }
  assert.equal(nativeCalls, 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

// Exercise actual Grid clipboard handlers, keeping regression coverage in this existing file.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { normalizeAttachmentItems, hydrateReviewProps, stripPreviewOnlyProps } from '../src/lib/attachmentUtils';

const gridSource = readFileSync(new URL('../src/components/Grid.tsx', import.meta.url), 'utf8');
const clipboardSource = gridSource.slice(gridSource.indexOf('function encodeTSV('), gridSource.indexOf('type InternalMediaClipboardPayload'))
  + gridSource.slice(gridSource.indexOf('const clonePersistableMediaItem ='), gridSource.indexOf('const copyMediaToClipboardMagic'))
  + gridSource.slice(gridSource.indexOf('    const isNativeEditableTarget ='), gridSource.indexOf("    window.addEventListener('copy', handleCopy)"))
  + ';globalThis.handlers = { handleCopy, handleCut, handlePaste };';
const clipboardJs = ts.transpileModule(clipboardSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function clipboardHarness(records: any[], fields: any[]) {
  const context: any = {
    data: { records, fields }, visibleFields: fields, selectionBox: { minR: 0, maxR: 0, minC: 0, maxC: 0 },
    selectionStart: { r: 0, c: 0 }, extraSelectedCells: [], cutBox: null, globalAttachmentPropsMap: new Map(),
    normalizeAttachmentItems, hydrateReviewProps, stripPreviewOnlyProps, internalMediaClipboardPayload: null, INTERNAL_MEDIA_CLIPBOARD_TYPE: 'web application/x-hongs-media-item',
    normalizeLocalPathForStorage: (v: any) => String(v || '').trim(),
    isNetworkJobCellItem: (v: any) => v?.type === 'networkJob' && typeof v.jobId === 'string',
    HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLElement: class {},
    setCutBox: (v: any) => { context.cutBox = v; },
    onUpdateRecordsBatch: (updates: any[]) => { for (const u of updates) records.find(r => r.id === u.recordId)[u.fieldId] = u.value; },
    onPasteRecordsBatch: (updates: any[], added: any[]) => { records.push(...added); context.onUpdateRecordsBatch(updates); },
  };
  vm.runInNewContext(clipboardJs, context);
  const payload = new Map<string, string>();
  const event = { target: null, preventDefault() {}, clipboardData: { setData: (k: string, v: string) => payload.set(k, v), getData: (k: string) => payload.get(k) || '' } };
  const select = (r: number, c = 0, maxR = r, maxC = c) => { context.selectionBox = { minR: r, maxR, minC: c, maxC }; context.selectionStart = { r, c }; context.extraSelectedCells = []; };
  return { context, payload, event, select, copy: () => context.handlers.handleCopy(event), cut: () => context.handlers.handleCut(event), paste: () => context.handlers.handlePaste(event) };
}
const plain = (value: any) => JSON.parse(JSON.stringify(value));

test('cut and copy preserve complete crop, trim, review, and job payloads', () => {
  const media = [{ url: 'F:/crop.png', cropData: { x: 4, y: 5, scale: 2, ratio: '1:1' }, rating: 5, annotations: [{ id: 'a' }] }, { url: 'F:/clip.mp4', trimData: { startMs: 200, endMs: 1500 } }, { type: 'networkJob', jobId: 'running' }];
  for (const cut of [false, true]) {
    const rows: any[] = [{ id: 'source', media }, { id: 'target', media: [] }];
    const h = clipboardHarness(rows, [{ id: 'media', type: 'attachment' }]);
    cut ? h.cut() : h.copy(); h.select(1); h.paste();
    assert.deepEqual(plain(rows[1].media), media);
    assert.deepEqual(rows[0].media, cut ? '' : media);
  }
});

test('overlapping and same-cell cut paste never clears the destination', () => {
  const rows = [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }, { id: 'c', t: 'C' }];
  const h = clipboardHarness(rows, [{ id: 't', type: 'text' }]);
  h.select(0, 0, 1); h.cut(); h.select(1); h.paste();
  assert.deepEqual(rows.map(r => r.t), ['', 'A', 'B']);
  h.select(1); h.cut(); h.paste(); assert.equal(rows[1].t, 'A');
});

test('cut uses TSV escaping and retains zero, boolean true, and option IDs', () => {
  const text = 'line 1\nline 2\t"quoted"';
  const rows: any[] = [{ id: 'a', t: text, n: 0, b: true, s: 'option-id', m: ['option-id'] }, { id: 'b' }];
  const fields = [{ id: 't', type: 'text' }, { id: 'n', type: 'number' }, { id: 'b', type: 'checkbox' }, { id: 's', type: 'singleSelect', options: [{ id: 'option-id', name: 'Option' }] }, { id: 'm', type: 'multiSelect', options: [{ id: 'option-id', name: 'Option' }] }];
  const h = clipboardHarness(rows, fields); h.select(0, 0, 0, 4); h.cut();
  assert.ok(h.payload.get('text/plain')!.startsWith('"line 1\nline 2\t""quoted"""'));
  h.select(1); h.paste(); assert.deepEqual(plain(rows[1]), { id: 'b', t: text, n: 0, b: true, s: 'option-id', m: ['option-id'] });
});

test('sparse cut preserves unselected source and destination cells', () => {
  const rows = [{ id: 'a', a: 'A', b: 'keep-source', c: 'C' }, { id: 'b', a: '', b: 'keep-target', c: '' }];
  const h = clipboardHarness(rows, ['a', 'b', 'c'].map(id => ({ id, type: 'text' })));
  h.context.extraSelectedCells = [{ r: 0, c: 2 }]; h.cut(); h.select(1); h.paste();
  assert.deepEqual(rows, [{ id: 'a', a: '', b: 'keep-source', c: '' }, { id: 'b', a: 'A', b: 'keep-target', c: 'C' }]);
});

test('unrelated clipboard and already-pasted cut cannot clear the original source', () => {
  const rows = [{ id: 'a', t: 'A' }, { id: 'b', t: '' }];
  const h = clipboardHarness(rows, [{ id: 't', type: 'text' }]);
  h.cut(); h.payload.delete('application/x-bitable-copy'); h.payload.set('text/plain', 'external'); h.select(1); h.paste();
  assert.equal(rows[0].t, 'A'); assert.equal(rows[1].t, 'external');
  h.select(0); h.cut(); h.select(1); h.paste(); rows[0].t = 'new'; h.paste(); assert.equal(rows[0].t, 'new');
});

test('cut clears stable IDs after reorder, but retains edits made since cut', () => {
  const rows = [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }, { id: 'c', t: '' }];
  const h = clipboardHarness(rows, [{ id: 't', type: 'text' }]);
  h.cut(); rows.reverse(); h.select(0); h.paste(); assert.equal(rows[2].t, ''); assert.equal(rows[0].t, 'A');
  h.select(1); h.cut(); rows[1].t = 'edited'; h.select(0); h.paste(); assert.equal(rows[1].t, 'edited');
});

test('cut retains source cells clipped by the destination table boundary', () => {
  const rows = [{ id: 'a', a: 'A', b: 'B' }, { id: 'b', a: '', b: '' }];
  const h = clipboardHarness(rows, ['a', 'b'].map(id => ({ id, type: 'text' })));
  h.select(0, 0, 0, 1); h.cut(); h.select(1, 1); h.paste();
  assert.deepEqual(rows, [{ id: 'a', a: '', b: 'B' }, { id: 'b', a: '', b: 'A' }]);
});

test('intelligent text skill suggestions display names without long descriptions', () => {
  const start = gridSource.indexOf('<datalist id={`txt-skill-suggestions-');
  const options = gridSource.slice(start, gridSource.indexOf('</datalist>', start));
  assert.ok(start > 0 && options.includes('value={skill.displayName} />'));
  assert.ok(!options.includes('skill.description') && !options.includes('skill.source'));
});

test('raw clipboard preserves commas and line breaks in individual attachment paths', () => {
  const media = ['F:/name,part.png', { url: 'F:/second,part.png', cropData: { scale: 2 } }];
  const rows: any[] = [{ id: 'a', media }, { id: 'b', media: [] }];
  const h = clipboardHarness(rows, [{ id: 'media', type: 'attachment' }]);
  h.cut(); h.select(1); h.paste();
  assert.deepEqual(plain(rows[1].media), [{ url: media[0] }, media[1]]);
});

test('single media paste drops only image crop and preserves reviews and audio/video trim', () => {
  const original = { url: 'F:/a.png', cropData: { scale: 2, x: 4 }, trimData: { startMs: 500, endMs: 1500 }, rating: 5, annotations: [{ id: 'note' }], status: 'approved' };
  const { cropData, ...expected } = original;
  for (const mode of ['custom', 'remembered']) {
    const rows: any[] = [{ id: 'source', media: [original] }, { id: 'target', media: [] }];
    const h = clipboardHarness(rows, [{ id: 'media', type: 'attachment' }]);
    h.payload.set('text/plain', original.url);
    const payload = { plainText: original.url, item: original, copiedAt: Date.now() };
    if (mode === 'custom') h.payload.set('application/x-hongs-media-item', JSON.stringify(payload));
    else h.context.internalMediaClipboardPayload = payload;
    h.select(1); h.paste();
    assert.deepEqual(plain(rows[1].media), [expected]);
    assert.deepEqual(rows[0].media, [original]);
  }
});

test('single-media copy payload excludes only cropData and keeps review/trim attributes', async () => {
  const start = gridSource.indexOf('type InternalMediaClipboardPayload');
  const end = gridSource.indexOf('const copyImageToClipboardMagic', start);
  const source = ts.transpileModule(gridSource.slice(start, end) + ';globalThis.copyMedia = copyMediaToClipboardMagic;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let written: any;
  const context: any = { Blob, stripPreviewOnlyProps, normalizeLocalPathForStorage: (v: any) => String(v || ''), window: { ClipboardItem: class { constructor(public data: any) { written = data; } } }, navigator: { clipboard: { write: async () => {} } } };
  vm.runInNewContext(source, context);
  const original = { url: 'F:/a,b.png', cropData: { scale: 3 }, trimData: { endMs: 3000 }, rating: 5, annotations: [{ text: 'keep note' }] };
  await context.copyMedia(original);
  const payload = JSON.parse(await written['web application/x-hongs-media-item'].text());
  const { cropData, ...expected } = original;
  assert.deepEqual(payload.item, expected);
  assert.equal(await written['text/plain'].text(), original.url);
});
