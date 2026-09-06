import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailScheduler, normalizeThumbnailPath, thumbnailKey } from '../thumbnail_scheduler.js';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('actual ThumbnailImage waits for intersection and cancels offscreen queued loads', async () => {
  const source = fs.readFileSync(new URL('../src/components/Grid.tsx', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const thumbnailObservers ='), source.indexOf('type LocateCellRequest ='));
  let effect, cleanup, callback;
  const element = {};
  const queue = createThumbnailScheduler(1);
  let release;
  const blocker = queue.request('busy', () => new Promise(r => { release = r; }));
  await new Promise(r => setTimeout(r, 0));
  let requested = 0, native = 0;
  const context = {
    exports: {}, Map, console, React: { createElement: () => ({}) },
    useState: () => ['', () => {}], useRef: () => ({ current: element }), useEffect: fn => { effect = fn; },
    thumbnailCache: new Map(),
    IntersectionObserver: class { constructor(cb) { callback = cb; } observe() {} unobserve() {} },
    getOrGenerateThumbnail: (path, file, wanted) => { requested++; return queue.request(path, async () => { native++; return 'data:image/png;base64,a'; }, wanted); }
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(block + '\nglobalThis.Component = ThumbnailImage;', { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }), context);
  context.Component({ path: 'F:/test.png', alt: 'test', className: '' }); cleanup = effect();
  assert.equal(requested, 0);
  callback([{ target: element, isIntersecting: true }]);
  callback([{ target: element, isIntersecting: false }]);
  release('done'); await blocker; await new Promise(r => setTimeout(r, 0));
  assert.equal(native, 0);
  callback([{ target: element, isIntersecting: true }]);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(native, 1);
  cleanup();
  callback([{ target: element, isIntersecting: true }]);
  assert.equal(native, 1);
});

test('missing system thumbnail restores native img alt and refresh can recover', async () => {
  const source = fs.readFileSync(new URL('../src/components/Grid.tsx', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const thumbnailObservers ='), source.indexOf('type LocateCellRequest ='));
  let effect, callback, index = 0, result = '', calls = 0;
  const state = [];
  const element = {};
  const context = {
    exports: {}, Map, console, React: { createElement: (tag, props, ...children) => ({ tag, props, children }) },
    useState: initial => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
    useRef: () => ({ current: element }), useEffect: fn => { effect = fn; },
    thumbnailCache: new Map(),
    IntersectionObserver: class { constructor(cb) { callback = cb; } observe() {} unobserve() {} },
    getOrGenerateThumbnail: async (path, file, wanted) => { calls++; wanted(); return result; }
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(block + '\nglobalThis.Component = ThumbnailImage;', { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }), context);
  const props = { path: '//nas/missing.jpg', alt: 'missing.jpg', className: 'w-full h-full object-cover' };
  const render = () => { index = 0; return context.Component(props); };
  render(); const cleanup = effect();
  assert.equal(calls, 0);
  callback([{ target: element, isIntersecting: true }]);
  await new Promise(r => setTimeout(r, 0));
  const failed = render();
  assert.equal(failed.tag, 'img');
  assert.equal(failed.props.alt, 'missing.jpg');
  assert.equal(failed.props.className, props.className);
  assert.equal(failed.props.src, 'data:image/png;base64,AA==');
  props.alt = props.path;
  assert.equal(render().props.alt, props.path);
  cleanup(); result = 'data:image/png;base64,recovered'; props.refreshKey = 1;
  render(); const cleanupRefresh = effect();
  callback([{ target: element, isIntersecting: true }]);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(render().props.src, result);
  assert.equal(calls, 2);
  cleanupRefresh();
});

test('native thumbnail concurrency is bounded and duplicate paths share work', async () => {
  const queue = createThumbnailScheduler(3);
  let active = 0, peak = 0, calls = 0;
  const run = async () => { calls++; active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return 'thumbnail'; };
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => queue.request(String(i % 10), run)));
  assert.equal(results.length, 100); assert.equal(calls, 10); assert.equal(peak, 3);
  assert.equal(queue.stats().deduplicated, 90); assert.equal(queue.stats().active, 0);
});
test('offscreen queued work is skipped while another visible subscriber keeps shared work', async () => {
  const queue = createThumbnailScheduler(1);
  let release;
  const first = queue.request('first', () => new Promise(r => { release = r; }));
  await new Promise(r => setTimeout(r, 0));
  let visible = true;
  const hidden = queue.request('hidden', () => { throw Error('must not run'); }, () => visible);
  const shared = queue.request('shared', async () => 'ok', () => visible);
  const other = queue.request('shared', async () => 'wrong', () => true);
  visible = false; release('first');
  assert.deepEqual(await Promise.all([first, hidden, shared, other]), ['first', null, 'ok', 'ok']);
  assert.equal(queue.stats().skipped, 1);
  assert.equal(await queue.request('hidden', async () => 'reentered'), 'reentered');
});
test('failure releases slots and subsequent refresh starts a fresh request', async () => {
  const queue = createThumbnailScheduler(1);
  await assert.rejects(queue.request('x', async () => { throw Error('native'); }), /native/);
  assert.equal(await queue.request('x', async () => 'new'), 'new');
  assert.equal(await queue.request('x', async () => 'newer'), 'newer');
  assert.equal(queue.stats().failed, 1);
});
test('path separators share a key but different sizes stay independent', () => {
  assert.equal(thumbnailKey('\\\\nas\\share\\x.png', { width:150,height:150 }), thumbnailKey('//nas/share/x.png', { width:150,height:150 }));
  assert.notEqual(thumbnailKey('x', { width:150,height:150 }), thumbnailKey('x', { width:400,height:400 }));
});

test('Windows drive paths are normalized before native thumbnail generation', () => {
  assert.equal(normalizeThumbnailPath('F:/images/frame.png', 'win32'), 'F:\\images\\frame.png');
  assert.equal(normalizeThumbnailPath('F:\\images\\frame.png', 'win32'), 'F:\\images\\frame.png');
  assert.equal(normalizeThumbnailPath('//nas/share/frame.png', 'win32'), '//nas/share/frame.png');
  assert.equal(normalizeThumbnailPath('/mnt/images/frame.png', 'linux'), '/mnt/images/frame.png');
});

test('visible thumbnail selection respects horizontal and vertical clipping', () => {
  const source = fs.readFileSync(new URL('../src/lib/reviewMedia.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('type Rect ='), source.indexOf('// Match the native'));
  const context = { exports: {}, window: { innerWidth: 1000, innerHeight: 800 }, getComputedStyle: () => ({ overflowX: 'auto', overflowY: 'auto' }) };
  vm.createContext(context);
  vm.runInContext(ts.transpile(block, { module: ts.ModuleKind.CommonJS }), context);
  const root = { parentElement: null, getBoundingClientRect: () => ({ left:100,right:500,top:100,bottom:500 }) };
  const element = (box, rendered = true) => ({ parentElement: root, getClientRects: () => rendered ? [box] : [], getBoundingClientRect: () => box });
  const visible = context.exports.isThumbnailVisible;
  assert.equal(visible(element({ left:110,right:160,top:110,bottom:160 }), root), true);
  assert.equal(visible(element({ left:510,right:560,top:110,bottom:160 }), root), false);
  assert.equal(visible(element({ left:110,right:160,top:510,bottom:560 }), root), false);
  assert.equal(visible(element({ left:110,right:160,top:110,bottom:160 }, false), root), false);
});

test('toolbar refresh deduplicates local visible paths and updates only matching mounted cells', async () => {
  const source = fs.readFileSync(new URL('../src/components/Grid.tsx', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('export async function refreshVisibleGridThumbnails'), source.indexOf('const ThumbnailImage ='));
  const calls = [], events = [];
  const node = (path, visible = true) => ({ path, visible, isConnected: true, getAttribute: () => path, dispatchEvent: event => events.push([path,event.detail]) });
  const nodes = [node('C:/a.png'),node('C:/a.png'),node('C:/b.mp4'),node('C:/hidden.png',false),node('https://remote/x.png')];
  const context = {
    exports: {}, window: { electronAPI: {} }, URL, CustomEvent: class { constructor(name, options) { this.detail = options.detail; } },
    isThumbnailVisible: element => element.visible, reviewLocalPath: path => path.startsWith('C:') ? path : null,
    refreshReviewImages: async (paths, fn) => { for (const path of new Set(paths)) await fn(path); },
    loadFreshReviewThumbnail: async path => { calls.push(path); return 'thumb:' + path; },
    thumbnailRevisions: new Map(), thumbnailCache: new Map(), fullImageBlobCache: new Map()
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(block, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), context);
  await context.exports.refreshVisibleGridThumbnails({ querySelectorAll: () => nodes });
  assert.deepEqual(calls, ['C:/a.png','C:/b.mp4']);
  assert.equal(events.length, 3);
  assert.equal(context.thumbnailRevisions.get('C:/a.png'), 1);
});
