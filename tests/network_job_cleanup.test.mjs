import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLocalStaleCandidate,
  inspectJobForStaleCleanup,
  removeNetworkJobPlaceholders
} from '../network_job_cleanup.js';

const now = Date.parse('2026-08-29T13:00:00.000Z');
const old = '2026-08-29T11:00:00.000Z';
const baseJob = {
  localJobId: 'job_stale', provider: 'comfyui', phase: 'polling', taskId: 'task_stale',
  createdAt: old, updatedAt: old, resultUrl: null, localPath: null
};

test('completed, failed, cancelled and result-bearing Jobs are never stale-cleaned', async () => {
  for (const phase of ['completed', 'failed', 'cancelled', 'submission_unknown']) {
    const result = await inspectJobForStaleCleanup({ ...baseJob, phase }, { now, staleAfterMs: 30 * 60 * 1000, remoteProbe: async () => ({ state: 'pending' }) });
    assert.equal(result.eligible, false);
    assert.equal(result.code, 'TERMINAL_JOB');
  }
  const result = classifyLocalStaleCandidate({ ...baseJob, resultUrl: 'http://result/video.mp4' }, { now });
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'RESULT_AVAILABLE');
});

test('recent or remotely active ComfyUI Jobs are protected', async () => {
  const recent = await inspectJobForStaleCleanup({ ...baseJob, updatedAt: '2026-08-29T12:50:00.000Z' }, {
    now, staleAfterMs: 30 * 60 * 1000, remoteProbe: async () => ({ state: 'pending' })
  });
  assert.equal(recent.code, 'TOO_RECENT');

  for (const state of ['queued', 'running']) {
    const active = await inspectJobForStaleCleanup(baseJob, {
      now, staleAfterMs: 30 * 60 * 1000, remoteProbe: async () => ({ state, is_final: false })
    });
    assert.equal(active.eligible, false);
    assert.equal(active.code, 'REMOTE_ACTIVE');
  }
});

test('remote failure, completion, unknown providers and unreachable ComfyUI are protected', async () => {
  const terminal = await inspectJobForStaleCleanup(baseJob, {
    now, staleAfterMs: 30 * 60 * 1000, remoteProbe: async () => ({ state: 'completed', is_final: true })
  });
  assert.equal(terminal.code, 'REMOTE_TERMINAL');

  const otherProvider = await inspectJobForStaleCleanup({ ...baseJob, provider: 'lingwu' }, { now });
  assert.equal(otherProvider.code, 'PROVIDER_NOT_VERIFIABLE');

  const unreachable = await inspectJobForStaleCleanup(baseJob, {
    now, staleAfterMs: 30 * 60 * 1000, remoteProbe: async () => { throw new Error('ECONNREFUSED'); }
  });
  assert.equal(unreachable.eligible, false);
  assert.equal(unreachable.code, 'REMOTE_UNREACHABLE');
});

test('only an old nonterminal Job missing from ComfyUI queue and history is eligible', async () => {
  for (const phase of ['polling', 'running', 'queued']) {
    const stale = await inspectJobForStaleCleanup({ ...baseJob, phase }, {
      now, staleAfterMs: 30 * 60 * 1000, remoteProbe: async () => ({ state: 'pending', status: 'pending', is_final: false })
    });
    assert.equal(stale.eligible, true);
    assert.equal(stale.classification, 'stale_missing');
    assert.equal(stale.code, 'REMOTE_TASK_MISSING');
  }
});

test('placeholder cleanup removes only matching networkJob items and preserves completed media', () => {
  const tables = [{
    id: 'table_1', data: {
      fields: [{ id: 'field_video', type: 'aiVideo' }],
      records: [
        { id: 'row_mixed', field_video: ['F:/completed.mp4', { type: 'networkJob', jobId: 'job_stale' }, { type: 'networkJob', jobId: 'job_live' }] },
        { id: 'row_stale', field_video: [{ type: 'networkJob', jobId: 'job_stale' }] }
      ]
    }
  }];
  const result = removeNetworkJobPlaceholders(tables, ['job_stale'], { tableId: 'table_1' });
  assert.equal(result.removedPlaceholders, 2);
  assert.equal(result.affectedCells, 2);
  assert.deepEqual(result.tables[0].data.records[0].field_video, ['F:/completed.mp4', { type: 'networkJob', jobId: 'job_live' }]);
  assert.deepEqual(result.tables[0].data.records[1].field_video, []);
  assert.equal(tables[0].data.records[0].field_video.length, 3, 'input workspace must remain unchanged');
});
