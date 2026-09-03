import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';
import { createInMemoryWorkspace } from './table_action_api.js';

function request(action, params = {}, extra = {}) {
  return { version: '0.1', action, params, ...extra };
}

const base = {
  activeTableId: 'table_1',
  projectName: 'Test',
  tables: [{
    id: 'table_1',
    name: 'Master',
    data: {
      fields: [
        { id: 'fld_text', name: 'Text', type: 'text' },
        { id: 'fld_status', name: 'Status', type: 'singleSelect', options: [
          { id: 'opt_ok', name: '通过', color: 'green' },
          { id: 'opt_no', name: '失败', color: 'red' }
        ]}
      ],
      records: [
        { id: 'rec_1', fld_text: 'A', fld_status: 'opt_ok' },
        { id: 'rec_2', fld_text: '', fld_status: 'opt_no' }
      ]
    }
  }]
};

test('read capabilities and tables', () => {
  const ws = createInMemoryWorkspace(base);
  const caps = ws.execute(request('system.get_capabilities'));
  assert.equal(caps.ok, true);
  assert.equal(caps.data.phase, 'phase4.7');
  assert.equal(caps.data.appVersion, '2.6.6');
  assert.equal(caps.data.actionDefinitionVersion, '1.1');
  assert.equal(caps.data.detail, 'summary');
  assert.deepEqual(Object.keys(caps.data.implementedActions[0]), ['name']);
  assert.equal(caps.data.features.actionDefinitions, true);
  assert.equal(caps.data.features.mcpReadyActionSchemas, true);
  const described = ws.execute(request('system.describe_action', { action: 'field.configure_ai' }));
  assert.equal(described.ok, true);
  assert.equal(described.data.action.paramsSchema.required.includes('config'), true);
  const list = ws.execute(request('table.list'));
  assert.equal(list.data.tables.length, 1);
});

test('schema write requires confirmation', () => {
  const ws = createInMemoryWorkspace(base);
  const denied = ws.execute(request('field.create', {
    tableId: 'table_1', name: 'Prompt', type: 'text', config: {}
  }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'CONFIRMATION_REQUIRED');

  const ok = ws.execute(request('field.create', {
    tableId: 'table_1', name: 'Prompt', type: 'text', config: {}
  }, { confirmed: true }));
  assert.equal(ok.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.fields.length, 3);
});

test('dry run does not mutate workspace', () => {
  const ws = createInMemoryWorkspace(base);
  const before = JSON.stringify(ws.getSnapshot());
  const res = ws.execute(request('table.create', { name: 'New' }, { dryRun: true }));
  assert.equal(res.ok, true);
  assert.equal(res.data.dryRun, true);
  assert.equal(JSON.stringify(ws.getSnapshot()), before);
});

test('query resolves select display names', () => {
  const ws = createInMemoryWorkspace(base);
  const res = ws.execute(request('row.query', {
    tableId: 'table_1',
    fields: ['fld_text', 'fld_status'],
    filter: { logic: 'and', conditions: [
      { fieldId: 'fld_status', operator: 'equals', value: '通过' }
    ] }
  }));
  assert.equal(res.ok, true);
  assert.equal(res.data.rows.length, 1);
  assert.equal(res.data.rows[0].id, 'rec_1');
});

test('overwrite non-empty cell requires confirmation', () => {
  const ws = createInMemoryWorkspace(base);
  const denied = ws.execute(request('cell.set', {
    tableId: 'table_1', rowId: 'rec_1', fieldId: 'fld_text', value: 'B'
  }));
  assert.equal(denied.error.code, 'CONFIRMATION_REQUIRED');
  const ok = ws.execute(request('cell.set', {
    tableId: 'table_1', rowId: 'rec_1', fieldId: 'fld_text', value: 'B'
  }, { confirmed: true }));
  assert.equal(ok.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[0].fld_text, 'B');
});

test('single select accepts exact display name', () => {
  const ws = createInMemoryWorkspace(base);
  const ok = ws.execute(request('cell.set', {
    tableId: 'table_1', rowId: 'rec_2', fieldId: 'fld_status', value: '通过'
  }, { confirmed: true }));
  assert.equal(ok.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[1].fld_status, 'opt_ok');
});

test('cell write respects existing cellLinks groups', () => {
  const linked = structuredClone(base);
  linked.tables[0].data.cellLinks = {
    'rec_1-fld_text': 'group_1',
    'rec_2-fld_text': 'group_1'
  };
  const ws = createInMemoryWorkspace(linked);
  const res = ws.execute(request('cell.set', {
    tableId: 'table_1', rowId: 'rec_1', fieldId: 'fld_text', value: 'Linked'
  }, { confirmed: true }));
  assert.equal(res.ok, true);
  const records = ws.getSnapshot().tables[0].data.records;
  assert.equal(records[0].fld_text, 'Linked');
  assert.equal(records[1].fld_text, 'Linked');
  assert.equal(res.effects.cellsAffected, 2);
});


test('field.reorder moves a field before or after another field and requires confirmation', () => {
  const ws = createInMemoryWorkspace(base);

  const denied = ws.execute(request('field.reorder', {
    tableId: 'table_1', fieldId: 'fld_status', beforeFieldId: 'fld_text'
  }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'CONFIRMATION_REQUIRED');

  const before = ws.execute(request('field.reorder', {
    tableId: 'table_1', fieldId: 'fld_status', beforeFieldId: 'fld_text'
  }, { confirmed: true }));
  assert.equal(before.ok, true);
  assert.deepEqual(ws.getSnapshot().tables[0].data.fields.map(f => f.id), ['fld_status', 'fld_text']);
  assert.equal(before.data.fromIndex, 1);
  assert.equal(before.data.toIndex, 0);
  assert.equal(before.effects.fieldsReordered, 1);

  const after = ws.execute(request('field.reorder', {
    tableId: 'table_1', fieldId: 'fld_status', afterFieldId: 'fld_text'
  }, { confirmed: true }));
  assert.equal(after.ok, true);
  assert.deepEqual(ws.getSnapshot().tables[0].data.fields.map(f => f.id), ['fld_text', 'fld_status']);
});

test('field.reorder supports explicit zero-based toIndex', () => {
  const ws = createInMemoryWorkspace(base);
  const created = ws.execute(request('field.create', {
    tableId: 'table_1', name: 'Prompt', type: 'text', config: {}
  }, { confirmed: true }));
  assert.equal(created.ok, true);
  const promptId = created.data.field.id;

  const moved = ws.execute(request('field.reorder', {
    tableId: 'table_1', fieldId: promptId, toIndex: 0
  }, { confirmed: true }));
  assert.equal(moved.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.fields[0].id, promptId);
});

test('field type mutation is blocked in phase 1', () => {
  const ws = createInMemoryWorkspace(base);
  const res = ws.execute(request('field.update', {
    tableId: 'table_1', fieldId: 'fld_text', patch: { type: 'number' }
  }, { confirmed: true }));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'INVALID_FIELD_CONFIG');
});

function mediaWorkspace() {
  return {
    activeTableId: 'table_media',
    projectName: 'Media Test',
    tables: [{
      id: 'table_media',
      name: 'Media',
      data: {
        fields: [
          { id: 'fld_product', name: '产品图', type: 'attachment' },
          { id: 'fld_motion', name: '动作参考', type: 'attachment' },
          { id: 'fld_audio', name: '声音参考', type: 'attachment' },
          { id: 'fld_prompt', name: '视频提示词', type: 'aiText', aiTextConfig: { sourceImageTemplate: '{产品图}{动作参考}{声音参考}' } },
          { id: 'fld_ai_video', name: 'AI视频', type: 'aiVideo', aiVideoConfig: { sourceImageTemplate: '{产品图}', sourceVideoTemplate: '{动作参考}', sourceAudioTemplate: '{声音参考}' } },
          { id: 'fld_plain', name: '普通文本', type: 'text' }
        ],
        records: [
          {
            id: 'rec_media_1',
            fld_product: [{ url: 'D:/asset/product.jpg', cropData: { x: 0.1, y: -0.2, scale: 1.3, ratio: 0.75 }, mappedUrl: 'preview-only' }],
            fld_motion: [{ url: 'D:/asset/walk.mp4', type: 'video/mp4', trimData: { startMs: 8200, endMs: 18200, mode: 'preset', presetDurationMs: 10000 } }],
            fld_audio: [{ url: 'D:/asset/music.mp3', type: 'audio/mpeg', trimData: { startMs: 12000, endMs: 27000, mode: 'preset', presetDurationMs: 15000 } }]
          },
          { id: 'rec_media_2', fld_product: [], fld_motion: [], fld_audio: [] }
        ]
      }
    }]
  };
}

test('phase3.5 capabilities expose media and generation actions', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const caps = ws.execute(request('system.get_capabilities'));
  assert.equal(caps.ok, true);
  assert.equal(caps.data.phase, 'phase4.7');
  const names = caps.data.implementedActions.map(item => item.name);
  assert.equal(names.includes('field.reorder'), true);
  assert.equal(names.includes('media.get'), true);
  assert.equal(names.includes('media.copy_instance'), true);
  assert.equal(names.includes('media.get_effective_context'), true);
});

test('media.get exposes cropData and trimData without preview-only props', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const image = ws.execute(request('media.get', { tableId: 'table_media', rowId: 'rec_media_1', fieldId: 'fld_product' }));
  assert.equal(image.ok, true);
  assert.equal(image.data.items[0].mediaType, 'image');
  assert.equal(image.data.items[0].cropData.scale, 1.3);
  assert.equal('mappedUrl' in image.data.items[0].item, false);

  const video = ws.execute(request('media.get', { tableId: 'table_media', rowId: 'rec_media_1', fieldId: 'fld_motion' }));
  assert.equal(video.data.items[0].mediaType, 'video');
  assert.equal(video.data.items[0].trimData.startMs, 8200);
  assert.equal(video.data.items[0].trimData.endMs, 18200);
});

test('media.copy_instance preserves cropData and trimData', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const imageCopy = ws.execute(request('media.copy_instance', {
    tableId: 'table_media',
    source: { rowId: 'rec_media_1', fieldId: 'fld_product', index: 0 },
    target: { rowId: 'rec_media_2', fieldId: 'fld_product' },
    mode: 'append'
  }));
  assert.equal(imageCopy.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[1].fld_product[0].cropData.scale, 1.3);
  assert.equal('mappedUrl' in ws.getSnapshot().tables[0].data.records[1].fld_product[0], false);

  const videoCopy = ws.execute(request('media.copy_instance', {
    tableId: 'table_media',
    source: { rowId: 'rec_media_1', fieldId: 'fld_motion', index: 0 },
    target: { rowId: 'rec_media_2', fieldId: 'fld_motion' },
    mode: 'append'
  }));
  assert.equal(videoCopy.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[1].fld_motion[0].trimData.presetDurationMs, 10000);
});

test('media.attach appends new paths but blocks direct cropData/trimData injection', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const ok = ws.execute(request('media.attach', {
    tableId: 'table_media', rowId: 'rec_media_2', fieldId: 'fld_product',
    items: [{ type: 'image', path: 'D:/asset/new.jpg' }], mode: 'append'
  }));
  assert.equal(ok.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[1].fld_product[0].url, 'D:/asset/new.jpg');

  const denied = ws.execute(request('media.attach', {
    tableId: 'table_media', rowId: 'rec_media_2', fieldId: 'fld_motion',
    items: [{ type: 'video', path: 'D:/asset/new.mp4', trimData: { startMs: 0, endMs: 5000 } }], mode: 'append'
  }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'INVALID_REQUEST');
});

test('media.list_by_row groups media-capable fields', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const res = ws.execute(request('media.list_by_row', { tableId: 'table_media', rowId: 'rec_media_1' }));
  assert.equal(res.ok, true);
  assert.equal(res.data.fields.length, 3);
  const all = res.data.fields.flatMap(group => group.items);
  assert.equal(all.some(item => item.mediaType === 'video'), true);
  assert.equal(all.some(item => item.mediaType === 'audio'), true);
});

test('media.get_effective_context resolves ordered smart-field references', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const res = ws.execute(request('media.get_effective_context', {
    tableId: 'table_media', rowId: 'rec_media_1', fieldId: 'fld_ai_video'
  }));
  assert.equal(res.ok, true);
  assert.equal(res.data.sourceField.id, 'fld_ai_video');
  assert.deepEqual(res.data.items.map(item => item.token), ['<Picture 1>', '<Video 1>', '<Audio 1>']);
  assert.equal(res.data.items[1].trimData.startMs, 8200);
});

test('plain text effective context can use an explicit temporary smart reference', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const res = ws.execute(request('media.get_effective_context', {
    tableId: 'table_media', rowId: 'rec_media_1', fieldId: 'fld_plain', temporaryReferenceFieldId: 'fld_ai_video'
  }));
  assert.equal(res.ok, true);
  assert.equal(res.data.sourceField.id, 'fld_ai_video');
  assert.equal(res.data.items.length, 3);
});


test('phase3.5 capabilities expose generation and job runtime actions', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const caps = ws.execute(request('system.get_capabilities'));
  const names = caps.data.implementedActions.map(item => item.name);
  for (const name of ['generation.preview', 'generation.run', 'job.list', 'job.get', 'job.retry', 'job.cancel', 'job.cleanup_stale.preview', 'job.cleanup_stale']) {
    assert.equal(names.includes(name), true, name);
  }
  assert.equal(caps.data.features.generationRuntime, true);
  assert.equal(caps.data.features.idempotentGeneration, true);
  assert.equal(caps.data.features.staleJobCleanup, true);
  const full = ws.execute(request('system.get_capabilities', { detail: 'full' }));
  assert.equal(full.data.detail, 'full');
  assert.equal(typeof full.data.implementedActions[0].permission, 'string');
});

test('generation.preview validates target field and returns runtime marker', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const res = ws.execute(request('generation.preview', {
    tableId: 'table_media', fieldId: 'fld_ai_video', rowIds: ['rec_media_1'], mode: 'missing_only'
  }));
  assert.equal(res.ok, true);
  assert.equal(res.data.runtimeRequired, true);
  assert.equal(res.data.runtimeAction, 'generation.preview');
});

test('generation.run requires explicit confirmation and idempotency key', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const invalid = ws.execute(request('generation.run', {
    tableId: 'table_media', fieldId: 'fld_ai_video', rowIds: ['rec_media_1'], mode: 'missing_only', idempotencyKey: 'short'
  }, { confirmed: true }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_REQUEST');

  const denied = ws.execute(request('generation.run', {
    tableId: 'table_media', fieldId: 'fld_ai_video', rowIds: ['rec_media_1'], mode: 'missing_only', idempotencyKey: 'agent-video-0001'
  }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'CONFIRMATION_REQUIRED');

  const ok = ws.execute(request('generation.run', {
    tableId: 'table_media', fieldId: 'fld_ai_video', rowIds: ['rec_media_1'], mode: 'missing_only', idempotencyKey: 'agent-video-0001'
  }, { confirmed: true }));
  assert.equal(ok.ok, true);
  assert.equal(ok.data.runtimeRequired, true);
  assert.equal(ok.data.runtimeAction, 'generation.run');
});

test('generation actions reject non-AI target fields and missing rows', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const badField = ws.execute(request('generation.preview', {
    tableId: 'table_media', fieldId: 'fld_plain', rowIds: ['rec_media_1']
  }));
  assert.equal(badField.ok, false);
  assert.equal(badField.error.code, 'INVALID_FIELD_TYPE');

  const badRow = ws.execute(request('generation.preview', {
    tableId: 'table_media', fieldId: 'fld_ai_video', rowIds: ['missing_row']
  }));
  assert.equal(badRow.ok, false);
  assert.equal(badRow.error.code, 'ROW_NOT_FOUND');
});

test('job read actions return runtime markers', () => {
  const ws = createInMemoryWorkspace(base);
  const list = ws.execute(request('job.list', { limit: 20 }));
  assert.equal(list.ok, true);
  assert.equal(list.data.runtimeAction, 'job.list');
  const get = ws.execute(request('job.get', { jobId: 'job_xxx' }));
  assert.equal(get.ok, true);
  assert.equal(get.data.runtimeAction, 'job.get');
  const preview = ws.execute(request('job.cleanup_stale.preview', { tableId: 'table_1', staleAfterMinutes: 30 }));
  assert.equal(preview.ok, true);
  assert.equal(preview.data.runtimeAction, 'job.cleanup_stale.preview');
  const deniedCleanup = ws.execute(request('job.cleanup_stale', { tableId: 'table_1', staleAfterMinutes: 30 }));
  assert.equal(deniedCleanup.ok, false);
  assert.equal(deniedCleanup.error.code, 'CONFIRMATION_REQUIRED');
  const cleanup = ws.execute(request('job.cleanup_stale', { tableId: 'table_1', staleAfterMinutes: 30 }, { confirmed: true }));
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.data.runtimeAction, 'job.cleanup_stale');
});

test('job retry and cancel require confirmation', () => {
  const ws = createInMemoryWorkspace(base);
  for (const action of ['job.retry', 'job.cancel']) {
    const denied = ws.execute(request(action, { jobId: 'job_xxx' }));
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'CONFIRMATION_REQUIRED');
    const ok = ws.execute(request(action, { jobId: 'job_xxx' }, { confirmed: true }));
    assert.equal(ok.ok, true);
    assert.equal(ok.data.runtimeAction, action);
  }
});

test('phase3.5 context advertises interactive runtime and table.activate changes context only', () => {
  const input = structuredClone(base);
  input.tables.push({ id: 'table_2', name: 'Second', data: { fields: [], records: [] } });
  const ws = createInMemoryWorkspace(input);
  const context = ws.execute(request('context.get_current'));
  assert.equal(context.ok, true);
  assert.equal(context.data.runtimeAction, 'context.get_current');
  assert.equal(context.data.selectionAvailable, false);

  const activated = ws.execute(request('table.activate', { tableId: 'table_2' }));
  assert.equal(activated.ok, true);
  assert.equal(ws.getSnapshot().activeTableId, 'table_2');
  assert.equal(activated.undoToken, null);
});

test('view.get and view.update manage non-destructive current view state', () => {
  const ws = createInMemoryWorkspace(base);
  const updated = ws.execute(request('view.update', {
    tableId: 'table_1', viewMode: 'grid', patch: {
      sort: { fieldId: 'fld_text', direction: 'desc' },
      filter: { logic: 'and', conditions: [{ fieldId: 'fld_status', operator: 'equals', value: '通过' }] }
    }
  }));
  assert.equal(updated.ok, true);
  const get = ws.execute(request('view.get', { tableId: 'table_1', viewMode: 'grid' }));
  assert.equal(get.data.view.sort.direction, 'desc');
  assert.equal(get.data.view.filter.conditions.length, 1);
});

test('field.duplicate copies values and inserts beside source', () => {
  const ws = createInMemoryWorkspace(base);
  const res = ws.execute(request('field.duplicate', {
    tableId: 'table_1', fieldId: 'fld_text', copyValues: true
  }, { confirmed: true }));
  assert.equal(res.ok, true);
  const snap = ws.getSnapshot();
  const fields = snap.tables[0].data.fields;
  assert.equal(fields[1].id, res.data.field.id);
  assert.equal(snap.tables[0].data.records[0][res.data.field.id], 'A');
});

test('field options can upsert update reorder and safely remove', () => {
  const ws = createInMemoryWorkspace(base);
  const added = ws.execute(request('field.options.upsert', {
    tableId: 'table_1', fieldId: 'fld_status', options: [{ name: '待复审' }]
  }, { confirmed: true }));
  assert.equal(added.ok, true);
  const newOpt = added.data.options.find(o => o.name === '待复审');
  assert.ok(newOpt?.id);

  const updated = ws.execute(request('field.options.update', {
    tableId: 'table_1', fieldId: 'fld_status', optionId: newOpt.id, name: '返工'
  }, { confirmed: true }));
  assert.equal(updated.ok, true);
  assert.equal(updated.data.options.some(o => o.name === '返工'), true);

  const reordered = ws.execute(request('field.options.reorder', {
    tableId: 'table_1', fieldId: 'fld_status', optionId: newOpt.id, toIndex: 0
  }, { confirmed: true }));
  assert.equal(reordered.data.options[0].id, newOpt.id);

  const blocked = ws.execute(request('field.options.remove', {
    tableId: 'table_1', fieldId: 'fld_status', optionId: 'opt_ok'
  }, { confirmed: true }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'WRITE_CONFLICT');

  const removed = ws.execute(request('field.options.remove', {
    tableId: 'table_1', fieldId: 'fld_status', optionId: 'opt_ok', clearValues: true
  }, { confirmed: true }));
  assert.equal(removed.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[0].fld_status, null);
});

test('field.configure_ai is safe and field.update rejects direct ai config patch', () => {
  const input = structuredClone(base);
  input.tables[0].data.fields.push({ id: 'fld_video', name: 'AI视频', type: 'aiVideo', prompt: '{Text}', aiVideoConfig: { duration: '5' } });
  const ws = createInMemoryWorkspace(input);
  const denied = ws.execute(request('field.update', {
    tableId: 'table_1', fieldId: 'fld_video', patch: { aiVideoConfig: { duration: '10' } }
  }, { confirmed: true }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'INVALID_FIELD_CONFIG');

  const ok = ws.execute(request('field.configure_ai', {
    tableId: 'table_1', fieldId: 'fld_video', config: {
      prompt: '{Text}', model: 'minimax-h3-local', duration: '{Text}', ratio: '16:9', sound: false
    }
  }, { confirmed: true }));
  assert.equal(ok.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.fields.find(f => f.id === 'fld_video').aiVideoConfig.modelTemplate, 'minimax-h3-local');
  assert.equal(ws.getSnapshot().tables[0].data.fields.find(f => f.id === 'fld_video').aiVideoConfig.duration, '{Text}');
});

test('row.query supports OR, rowIds, sort and runtime current_view marker', () => {
  const ws = createInMemoryWorkspace(base);
  const res = ws.execute(request('row.query', {
    tableId: 'table_1',
    rowIds: ['rec_1', 'rec_2'],
    filter: { logic: 'or', conditions: [
      { fieldId: 'fld_text', operator: 'equals', value: 'A' },
      { fieldId: 'fld_status', operator: 'equals', value: '失败' }
    ] },
    sort: { fieldId: 'fld_text', direction: 'desc' }
  }));
  assert.equal(res.ok, true);
  assert.equal(res.data.rows.length, 2);
  assert.equal(res.data.rows[0].id, 'rec_1');

  const view = ws.execute(request('row.query', { tableId: 'table_1', scope: 'current_view' }));
  assert.equal(view.ok, true);
  assert.equal(view.data.runtimeAction, 'row.query');
});

test('cell.get_meta, cell.link and cell.unlink expose and manage link state', () => {
  const ws = createInMemoryWorkspace(base);
  const linked = ws.execute(request('cell.link', {
    tableId: 'table_1', cells: [
      { rowId: 'rec_1', fieldId: 'fld_text' },
      { rowId: 'rec_2', fieldId: 'fld_text' }
    ]
  }, { confirmed: true }));
  assert.equal(linked.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[1].fld_text, 'A');
  const meta = ws.execute(request('cell.get_meta', { tableId: 'table_1', rowId: 'rec_1', fieldId: 'fld_text' }));
  assert.equal(meta.data.linked, true);
  assert.equal(meta.data.linkedCells.length, 2);
  const unlinked = ws.execute(request('cell.unlink', {
    tableId: 'table_1', cells: [{ rowId: 'rec_2', fieldId: 'fld_text' }]
  }, { confirmed: true }));
  assert.equal(unlinked.ok, true);
  const meta2 = ws.execute(request('cell.get_meta', { tableId: 'table_1', rowId: 'rec_2', fieldId: 'fld_text' }));
  assert.equal(meta2.data.linked, false);
});

test('generation.get_capabilities is exposed as a runtime action', () => {
  const ws = createInMemoryWorkspace(base);
  const res = ws.execute(request('generation.get_capabilities', {}));
  assert.equal(res.ok, true);
  assert.equal(res.data.runtimeAction, 'generation.get_capabilities');
});

test('phase 4 exposes a monotonic workspace revision and rejects stale writes', () => {
  const ws = createInMemoryWorkspace({ ...structuredClone(base), workspaceRevision: 7 });
  const list = ws.execute(request('table.list'));
  assert.equal(list.workspaceRevision, 7);

  const stale = ws.execute(request('cell.set', {
    tableId: 'table_1', rowId: 'rec_2', fieldId: 'fld_text', value: 'stale'
  }, { expectedRevision: 6 }));
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'STALE_WORKSPACE');

  const written = ws.execute(request('cell.set', {
    tableId: 'table_1', rowId: 'rec_2', fieldId: 'fld_text', value: 'fresh'
  }, { expectedRevision: 7 }));
  assert.equal(written.ok, true);
  assert.equal(written.workspaceRevision, 8);
});

test('transaction preview is non-mutating and execute is atomic', () => {
  const ws = createInMemoryWorkspace({ ...structuredClone(base), workspaceRevision: 3 });
  const actions = [
    { action: 'cell.set', params: { tableId: 'table_1', rowId: 'rec_2', fieldId: 'fld_text', value: 'B' } },
    { action: 'row.create', params: { tableId: 'table_1', rows: [{ id: 'rec_tx', values: { fld_text: 'C' } }] } }
  ];
  const preview = ws.execute(request('transaction.preview', { actions }, { expectedRevision: 3 }));
  assert.equal(preview.ok, true);
  assert.equal(preview.effects.rowsCreated, 1);
  assert.equal(ws.getSnapshot().tables[0].data.records.length, 2);

  const executed = ws.execute(request('transaction.execute', { actions }, { expectedRevision: 3, confirmed: true }));
  assert.equal(executed.ok, true);
  assert.equal(executed.workspaceRevision, 4);
  assert.equal(ws.getSnapshot().tables[0].data.records.length, 3);

  const beforeFailure = JSON.stringify(ws.getSnapshot());
  const failed = ws.execute(request('transaction.execute', { actions: [
    { action: 'cell.set', params: { tableId: 'table_1', rowId: 'rec_2', fieldId: 'fld_text', value: 'should-not-stick' } },
    { action: 'cell.set', params: { tableId: 'table_1', rowId: 'missing', fieldId: 'fld_text', value: 'X' } }
  ] }, { expectedRevision: 4, confirmed: true }));
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'TRANSACTION_FAILED');
  assert.equal(JSON.stringify(ws.getSnapshot()), beforeFailure);
});

test('phase 4.1 table editing supports update duplicate reorder and delete', () => {
  const input = structuredClone(base);
  input.tables.push({ id: 'table_2', name: 'Second', data: { fields: [], records: [] } });
  const ws = createInMemoryWorkspace(input);
  assert.equal(ws.execute(request('table.update', { tableId: 'table_1', patch: { name: 'Renamed' } }, { confirmed: true })).ok, true);
  const duplicated = ws.execute(request('table.duplicate', { tableId: 'table_1', name: 'Copy' }, { confirmed: true }));
  assert.equal(duplicated.ok, true);
  const copyId = duplicated.data.table.id;
  assert.equal(ws.execute(request('table.reorder', { tableId: copyId, toIndex: 0 }, { confirmed: true })).ok, true);
  assert.equal(ws.getSnapshot().tables[0].id, copyId);
  assert.equal(ws.execute(request('table.delete', { tableId: copyId }, { confirmed: true })).ok, true);
  assert.equal(ws.getSnapshot().tables.some(t => t.id === copyId), false);
});

test('phase 4.1 field conversion previews impact and converts values', () => {
  const ws = createInMemoryWorkspace(base);
  const preview = ws.execute(request('field.convert.preview', {
    tableId: 'table_1', fieldId: 'fld_text', targetType: 'number'
  }));
  assert.equal(preview.ok, true);
  assert.equal(preview.data.invalidRows, 1);
  const converted = ws.execute(request('field.convert.run', {
    tableId: 'table_1', fieldId: 'fld_text', targetType: 'number', invalidValuePolicy: 'clear'
  }, { confirmed: true }));
  assert.equal(converted.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.fields[0].type, 'number');
  assert.equal(ws.getSnapshot().tables[0].data.records[0].fld_text, null);
});

test('phase 4.1 row insert duplicate reorder and delete preserve explicit ordering', () => {
  const ws = createInMemoryWorkspace(base);
  const inserted = ws.execute(request('row.insert', {
    tableId: 'table_1', beforeRowId: 'rec_2', rows: [{ id: 'rec_insert', values: { fld_text: 'Inserted' } }]
  }));
  assert.equal(inserted.ok, true);
  assert.deepEqual(ws.getSnapshot().tables[0].data.records.map(r => r.id), ['rec_1', 'rec_insert', 'rec_2']);
  const duplicated = ws.execute(request('row.duplicate', { tableId: 'table_1', rowIds: ['rec_insert'] }));
  assert.equal(duplicated.ok, true);
  const duplicateId = duplicated.data.rows[0].id;
  assert.equal(ws.execute(request('row.reorder', { tableId: 'table_1', rowIds: [duplicateId], toIndex: 0 }, { confirmed: true })).ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[0].id, duplicateId);
  assert.equal(ws.execute(request('row.delete', { tableId: 'table_1', rowIds: [duplicateId] }, { confirmed: true })).ok, true);
});

test('phase 4.1 range editing supports clear copy and fill', () => {
  const ws = createInMemoryWorkspace(base);
  const copy = ws.execute(request('cell.copy_range', {
    tableId: 'table_1', source: { rowIds: ['rec_1'], fieldIds: ['fld_text'] }, target: { rowIds: ['rec_2'], fieldIds: ['fld_text'] }
  }, { confirmed: true }));
  assert.equal(copy.ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[1].fld_text, 'A');
  assert.equal(ws.execute(request('cell.fill', {
    tableId: 'table_1', rowIds: ['rec_1', 'rec_2'], fieldId: 'fld_text', value: 'Filled'
  }, { confirmed: true })).ok, true);
  assert.equal(ws.execute(request('cell.clear', {
    tableId: 'table_1', cells: [{ rowId: 'rec_2', fieldId: 'fld_text' }]
  }, { confirmed: true })).ok, true);
  assert.equal(ws.getSnapshot().tables[0].data.records[1].fld_text, null);
});

test('phase 4.1 semantic media editing validates trim and crop', () => {
  const ws = createInMemoryWorkspace(mediaWorkspace());
  const setTrim = ws.execute(request('media.set_trim', {
    tableId: 'table_media', rowId: 'rec_media_1', fieldId: 'fld_motion', index: 0, startMs: 1000, endMs: 4000, durationMs: 10000
  }, { confirmed: true }));
  assert.equal(setTrim.ok, true);
  assert.deepEqual(ws.getSnapshot().tables[0].data.records[0].fld_motion[0].trimData, { startMs: 1000, endMs: 4000 });
  const invalid = ws.execute(request('media.set_trim', {
    tableId: 'table_media', rowId: 'rec_media_1', fieldId: 'fld_motion', index: 0, startMs: 5000, endMs: 4000
  }, { confirmed: true }));
  assert.equal(invalid.error.code, 'INVALID_REQUEST');
  const crop = ws.execute(request('media.set_crop', {
    tableId: 'table_media', rowId: 'rec_media_1', fieldId: 'fld_product', index: 0,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6, unit: 'ratio' }
  }, { confirmed: true }));
  assert.equal(crop.ok, true);
});

test('phase 4 runtime operations are exposed without mutating the pure workspace', () => {
  const ws = createInMemoryWorkspace(base);
  for (const [action, params] of [
    ['workspace.get_dirty_state', {}],
    ['undo.get_status', {}],
    ['batch.list', {}],
    ['export.preview', { tableId: 'table_1', format: 'csv' }],
    ['job.get_result', { jobId: 'job_1' }]
  ]) {
    const result = ws.execute(request(action, params));
    assert.equal(result.ok, true, action);
    assert.equal(result.data.runtimeAction, action);
  }
});

test('all mutation idempotency replays a successful write without duplicating it', () => {
  const ws = createInMemoryWorkspace(base);
  const payload = request('row.create', { tableId: 'table_1', rows: [{ values: { fld_text: 'Once' } }] }, { idempotencyKey: 'phase4-row-once' });
  const first = ws.execute(payload);
  const replay = ws.execute(payload);
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.idempotentReplay, true);
  assert.equal(ws.getSnapshot().tables[0].data.records.length, 3);
  const conflict = ws.execute(request('row.create', { tableId: 'table_1', rows: [{ values: { fld_text: 'Different' } }] }, { idempotencyKey: 'phase4-row-once' }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
});

test('HTTP JSON Schema accepts phase 4 envelope and rejects unknown actions', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('./table_action_api_v0.1.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ allErrors: true, jsonPointers: true, schemaId: 'auto' }).compile(schema);
  assert.equal(validate(request('transaction.preview', { actions: [{ action: 'row.delete', params: { tableId: 'table_1', rowIds: ['rec_1'] } }] }, { expectedRevision: 1, idempotencyKey: 'preview-001' })), true);
  assert.equal(validate(request('not.real', {})), false);
});
