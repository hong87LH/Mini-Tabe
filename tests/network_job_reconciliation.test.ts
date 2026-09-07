import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileNetworkJobCells as reconcile } from '../src/lib/networkJobReconciliation';

const marker = (jobId: string) => ({ type: 'networkJob', jobId });
const fields = [{ id: 'field-with-hyphens', type: 'aiVideo' }];
const row = (value: any[]) => [{ id: 'row-with-hyphens', 'field-with-hyphens': value }];
const done = (localJobId: string, localPath: string) => ({ localJobId, localPath, phase: 'completed' });
const run = (values: any[], jobs: any[]) => reconcile(row(values), fields, jobs, p => p);

test('multiple completed jobs merge in one cell without splitting IDs or losing media', () => {
  const existing = { url: 'F:/old.png', rating: 5, cropData: { scale: 2 } };
  const updates = run([existing, marker('a'), marker('b')], [done('b', 'F:/b.mp4'), done('a', 'F:/a.mp4')]);
  assert.deepEqual(updates, [{ recordId: 'row-with-hyphens', fieldId: 'field-with-hyphens', value: [existing, 'F:/a.mp4', 'F:/b.mp4'] }]);
  assert.equal(run(updates[0].value, [done('a', 'F:/a.mp4')]).length, 0);
});
test('same job copied into multiple cells is reconciled in each location', () => {
  const records = [...row([marker('a')]), { id: 'second', 'field-with-hyphens': [marker('a')] }];
  assert.equal(reconcile(records, fields, [done('a', 'F:/a.mp4')], p => p).length, 2);
});
test('deduplicates Windows paths while retaining existing metadata', () => {
  const existing = { url: 'F:\\result.png', rating: 5 };
  assert.deepEqual(run([marker('a'), existing], [done('a', 'f:/result.png')])[0].value, [existing]);
});
test('retains running, unknown, and completed-without-file markers', () => {
  const values = [marker('running'), marker('missing'), marker('no-file')];
  assert.deepEqual(run(values, [{ localJobId: 'running', phase: 'running' }, done('no-file', '')]), []);
});
test('failed and cancelled jobs remove only their own markers', () => {
  assert.deepEqual(run([marker('a'), marker('b'), marker('running'), 'keep.png'], [{ localJobId: 'a', phase: 'failed' }, { localJobId: 'b', phase: 'cancelled' }])[0].value, [marker('running'), 'keep.png']);
});
test('supports attachment fields and leaves unrelated fields untouched', () => {
  assert.equal(reconcile(row([marker('a')]), [{ ...fields[0], type: 'attachment' }], [done('a', 'a.png')], p => p).length, 1);
  assert.equal(reconcile(row([marker('a')]), [{ ...fields[0], type: 'text' }], [done('a', 'a.png')], p => p).length, 0);
});
