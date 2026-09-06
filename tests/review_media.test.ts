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
