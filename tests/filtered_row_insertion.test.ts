import test from 'node:test';
import assert from 'node:assert/strict';
import { getFilterInsertDefaults, getGroupInsertDefaults, insertRecordsAtAnchor, matchesViewFilters } from '../src/lib/filteredRowInsertion';
import type { Field, FilterRule } from '../src/types';

const fields: Field[] = [
  { id: 'status', name: '状态', type: 'singleSelect', options: [{ id: 'opt_a', name: '待处理', color: 'blue' }, { id: 'opt_b', name: '完成', color: 'green' }] },
  { id: 'prompt', name: '提示词', type: 'text' },
  { id: 'duration', name: '时长', type: 'number' },
  { id: 'image', name: '图片', type: 'aiImage' },
];
const resolve = (value: any, field: Field) => field.type === 'singleSelect' ? field.options?.find(option => option.id === value)?.name || value : value;
const rule = (fieldId: string, operator: FilterRule['operator'], value: any): FilterRule => ({ id: fieldId, fieldId, operator, value });

test('filtered/sorted index cannot misplace insertion: anchor ID determines real position', () => {
  const records = [{ id: 'hidden0' }, { id: 'visibleA' }, { id: 'hidden1' }, { id: 'visibleB' }, { id: 'tail' }];
  const before = JSON.stringify(records);
  assert.deepEqual(insertRecordsAtAnchor(records, 'visibleB', 'above', [{ id: 'new1' }, { id: 'new2' }]).map(r => r.id), ['hidden0', 'visibleA', 'hidden1', 'new1', 'new2', 'visibleB', 'tail']);
  assert.deepEqual(insertRecordsAtAnchor(records, 'visibleA', 'below', [{ id: 'new' }]).map(r => r.id), ['hidden0', 'visibleA', 'new', 'hidden1', 'visibleB', 'tail']);
  assert.equal(JSON.stringify(records), before);
});
test('deleted anchor is a no-op, never silently append', () => {
  const records = [{ id: 'a' }];
  assert.equal(insertRecordsAtAnchor(records, 'deleted', 'below', [{ id: 'new' }]), records);
});
test('repeated insertion uses the latest records, preserving previous additions', () => {
  const first = insertRecordsAtAnchor([{ id: 'a' }], 'a', 'above', [{ id: 'b' }]);
  assert.deepEqual(insertRecordsAtAnchor(first, 'a', 'below', [{ id: 'c' }]).map(r => r.id), ['b', 'a', 'c']);
});
test('single select defaults store option ID and satisfy name-based filtering', () => {
  for (const operator of ['equals', 'has_any'] as const) {
    const rules = [rule('status', operator, operator === 'has_any' ? ['待处理'] : '待处理')];
    const defaults = getFilterInsertDefaults(fields, rules, resolve);
    assert.deepEqual(defaults, { status: 'opt_a' });
    assert.equal(matchesViewFilters({ id: 'new', ...defaults }, fields, rules, resolve), true);
  }
});
test('exact text/number defaults do not copy unrelated prompts or media', () => {
  assert.deepEqual(getFilterInsertDefaults(fields, [rule('duration', 'equals', '5')], resolve), { duration: 5 });
  assert.deepEqual(getFilterInsertDefaults(fields, [rule('prompt', 'equals', 'PV')], resolve), { prompt: 'PV' });
});
test('ambiguous, negative, nonempty and AI media conditions never invent content', () => {
  const rules = [rule('status', 'has_any', ['待处理', '完成']), rule('prompt', 'contains', 'PV'), rule('duration', 'is_not_empty', ''), rule('image', 'equals', 'asset.png')];
  assert.deepEqual(getFilterInsertDefaults(fields, rules, resolve), {});
  assert.deepEqual(getFilterInsertDefaults(fields, [rule('prompt', 'not_equals', 'PV')], resolve), {});
});
test('contradictory filters, unknown/duplicate options cannot autofill', () => {
  assert.deepEqual(getFilterInsertDefaults(fields, [rule('prompt', 'equals', 'PV'), rule('prompt', 'not_equals', 'PV')], resolve), {});
  assert.deepEqual(getFilterInsertDefaults(fields, [rule('status', 'equals', '未知')], resolve), {});
  assert.deepEqual(getFilterInsertDefaults([{ ...fields[0], options: [{ id: 'x', name: '重复', color: '' }, { id: 'y', name: '重复', color: '' }] }], [rule('status', 'equals', '重复')], resolve), {});
});
test('blank row can be temporarily shown without changing persisted values', () => {
  const rules = [rule('prompt', 'contains', 'PV')];
  const records = insertRecordsAtAnchor([{ id: 'source', prompt: 'PV' }, { id: 'hidden' }], 'source', 'below', [{ id: 'new' }]);
  const pending = new Set(['new']);
  assert.deepEqual(records.filter(r => pending.has(r.id) || matchesViewFilters(r, fields, rules, resolve)).map(r => r.id), ['source', 'new']);
  pending.clear();
  assert.deepEqual(records.filter(r => matchesViewFilters(r, fields, rules, resolve)).map(r => r.id), ['source']);
  assert.deepEqual(records[1], { id: 'new' });
});
test('existing empty/nonempty/contains filters retain their semantics', () => {
  assert.equal(matchesViewFilters({ id: 'x', image: [] }, fields, [rule('image', 'is_empty', '')], resolve), true);
  assert.equal(matchesViewFilters({ id: 'x', prompt: 'HELLO PV' }, fields, [rule('prompt', 'contains', 'pv')], resolve), true);
  assert.equal(matchesViewFilters({ id: 'x' }, fields, [rule('prompt', 'has_any', ['__EMPTY__'])], resolve), true);
});

test('Tang group insertion inherits only grouping fields, not the whole row', () => {
  const anchor = { id: 'source', prompt: 'Tang谷子', duration: 8, image: [{ url: 'result.png' }] };
  assert.deepEqual(getGroupInsertDefaults(fields, [{ fieldId: 'prompt' }], anchor), { prompt: 'Tang谷子' });
});
test('nested groups preserve all levels and raw single select IDs', () => {
  assert.deepEqual(getGroupInsertDefaults(fields, [{ fieldId: 'status' }, { fieldId: 'duration' }], { id: 'a', status: 'opt_b', duration: 8 }), { status: 'opt_b', duration: 8 });
});
test('multiselect grouping preserves option IDs without sharing arrays', () => {
  const tags: Field = { ...fields[0], id: 'tags', type: 'multiSelect' };
  const anchor = { id: 'a', tags: ['opt_a', 'opt_b'] };
  const defaults = getGroupInsertDefaults([tags], [{ fieldId: 'tags' }], anchor);
  assert.deepEqual(defaults, { tags: ['opt_a', 'opt_b'] });
  assert.notEqual(defaults.tags, anchor.tags);
});
test('disabled grouping or missing anchor does not autofill', () => {
  assert.deepEqual(getGroupInsertDefaults(fields, [], { id: 'a', prompt: 'Tang谷子' }), {});
  assert.deepEqual(getGroupInsertDefaults(fields, [{ fieldId: 'prompt' }], undefined), {});
});
test('empty group remains empty; zero and false remain valid grouping values', () => {
  const groupFields: Field[] = [...fields, { id: 'done', name: '完成', type: 'checkbox' }];
  assert.deepEqual(getGroupInsertDefaults(groupFields, [{ fieldId: 'prompt' }, { fieldId: 'duration' }, { fieldId: 'done' }], { id: 'a', duration: 0, done: false }), { duration: 0, done: false });
});
test('grouping never copies generated results, media or unknown fields', () => {
  assert.deepEqual(getGroupInsertDefaults(fields, [{ fieldId: 'image' }, { fieldId: 'unknown' }], { id: 'a', image: [{ url: 'a.png' }], unknown: 'x' }), {});
});
test('group defaults and compatible filters keep real insertion position and membership', () => {
  const anchor = { id: 'a', prompt: 'Tang谷子', status: 'opt_b' };
  const rules = [rule('status', 'equals', '完成')];
  const defaults = { ...getFilterInsertDefaults(fields, rules, resolve), ...getGroupInsertDefaults(fields, [{ fieldId: 'prompt' }], anchor) };
  for (const side of ['above', 'below'] as const) {
    const records = insertRecordsAtAnchor([{ id: 'hidden' }, anchor, { id: 'tail' }], 'a', side, [{ id: 'new', ...defaults }]);
    const inserted = records.find(r => r.id === 'new')!;
    assert.equal(inserted.prompt, anchor.prompt);
    assert.equal(matchesViewFilters(inserted, fields, rules, resolve), true);
    assert.equal(records.findIndex(r => r.id === 'new'), side === 'above' ? 1 : 2);
  }
});
