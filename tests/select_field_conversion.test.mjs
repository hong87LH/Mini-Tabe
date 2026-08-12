import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSelectText, selectValueToText } from '../src/lib/selectFieldConversion.js';

const options = [
  { id: 'valid-a', name: '保留A', color: 'blue' },
  { id: 'valid-b', name: '保留B', color: 'green' }
];

test('select to text drops orphaned option ids', () => {
  assert.equal(selectValueToText(['valid-a', 'deleted-id', 'valid-b'], options), '保留A, 保留B');
  assert.equal(selectValueToText('deleted-id', options), '');
});

test('text to multi-select accepts Chinese and English separators and removes duplicates', () => {
  assert.deepEqual(
    parseSelectText('保留A，新增B; 新增C；保留A\n新增D', true),
    ['保留A', '新增B', '新增C', '新增D']
  );
});

test('empty text becomes an empty selection', () => {
  assert.deepEqual(parseSelectText('  ', true), []);
  assert.deepEqual(parseSelectText(null, false), []);
});
