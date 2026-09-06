import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createTableActionServer } from './table_action_server.js';
import { executeTableActionRequest } from './table_action_api.js';

test('HTTP bridge enforces auth/schema and exposes health/SSE/audit', async () => {
  const previous = {
    enabled: process.env.HONGS_TABLE_ACTION_API,
    token: process.env.HONGS_TABLE_ACTION_TOKEN,
    port: process.env.HONGS_TABLE_ACTION_PORT,
    permissions: process.env.HONGS_TABLE_ACTION_PERMISSIONS
  };
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-table-phase45-'));
  const port = 19000 + Math.floor(Math.random() * 1000);
  process.env.HONGS_TABLE_ACTION_API = '1';
  process.env.HONGS_TABLE_ACTION_TOKEN = 'phase45-server-test';
  process.env.HONGS_TABLE_ACTION_PORT = String(port);
  process.env.HONGS_TABLE_ACTION_PERMISSIONS = 'read,write:data';

  const ipcMain = new EventEmitter();
  let snapshot = {
    workspaceRevision: 0,
    activeTableId: 'table_1',
    projectName: 'HTTP Test',
    tables: [{ id: 'table_1', name: 'Master', data: { fields: [{ id: 'layout_field', name: 'Layout', type: 'text' }], records: [] } }]
  };
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel, payload) => {
        const result = executeTableActionRequest(payload.request, snapshot);
        if (result.response.ok && result.nextWorkspace) snapshot = result.nextWorkspace;
        setImmediate(() => ipcMain.emit('table-action-api:response', {}, { bridgeId: payload.bridgeId, response: result.response }));
      }
    }
  };
  const server = createTableActionServer({
    app: { getPath: () => tempRoot },
    BrowserWindow: { getFocusedWindow: () => fakeWindow, getAllWindows: () => [fakeWindow] },
    ipcMain
  });

  try {
    await server.startIfEnabled();
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await fetch(`${baseUrl}/health`).then(response => response.json());
    assert.equal(health.phase, 'phase4.7');

    const unauthorized = await fetch(`${baseUrl}/v0.1/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '0.1', action: 'system.get_capabilities', params: {} })
    });
    assert.equal(unauthorized.status, 401);

    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer phase45-server-test' };
    const invalid = await fetch(`${baseUrl}/v0.1/actions`, {
      method: 'POST', headers, body: JSON.stringify({ version: '0.1', action: 'not.real', params: {} })
    }).then(response => response.json());
    assert.equal(invalid.error.code, 'SCHEMA_VALIDATION_FAILED');

    const valid = await fetch(`${baseUrl}/v0.1/actions`, {
      method: 'POST', headers, body: JSON.stringify({ version: '0.1', action: 'system.get_capabilities', params: {} })
    }).then(response => response.json());
    assert.equal(valid.ok, true);
    assert.equal(valid.data.phase, 'phase4.7');

    for (const [action, params] of [
      ['field.set_hidden', { tableId: 'table_1', fieldIds: ['layout_field'], hidden: true }],
      ['field.freeze_to', { tableId: 'table_1', fieldId: 'layout_field' }],
      ['field.set_individual_frozen', { tableId: 'table_1', fieldIds: ['layout_field'], frozen: true }]
    ]) {
      const result = await fetch(`${baseUrl}/v0.1/actions`, {
        method: 'POST', headers, body: JSON.stringify({ version: '0.1', action, params })
      }).then(response => response.json());
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    assert.equal(snapshot.tables[0].data.fields[0].hidden, true);
    assert.equal(snapshot.tables[0].data.frozenColId, 'layout_field');
    assert.deepEqual(snapshot.tables[0].data.individualFrozenColIds, ['layout_field']);

    const described = await fetch(`${baseUrl}/v0.1/actions`, {
      method: 'POST', headers, body: JSON.stringify({ version: '0.1', action: 'system.describe_action', params: { action: 'media.move' } })
    }).then(response => response.json());
    assert.equal(described.ok, true);
    assert.match(described.data.action.summary, /不会移动硬盘文件/);

    const escalated = await fetch(`${baseUrl}/v0.1/actions`, {
      method: 'POST', headers, body: JSON.stringify({
        version: '0.1', action: 'transaction.execute', confirmed: true, params: {
          actions: [{ action: 'field.create', params: { tableId: 'table_1', name: 'Forbidden', type: 'text', config: {} } }]
        }
      })
    });
    const escalatedBody = await escalated.json();
    assert.equal(escalated.status, 403);
    assert.equal(escalatedBody.error.code, 'PERMISSION_DENIED');
    assert.deepEqual(escalatedBody.error.details.missingPermissions, ['write:schema']);

    const controller = new AbortController();
    const events = await fetch(`${baseUrl}/v0.1/events`, { headers: { Authorization: 'Bearer phase45-server-test' }, signal: controller.signal });
    const firstEvent = await events.body.getReader().read();
    controller.abort();
    assert.match(new TextDecoder().decode(firstEvent.value), /event: connected/);

    await new Promise(resolve => setTimeout(resolve, 50));
    const auditPath = path.join(tempRoot, 'table-action-api-audit.jsonl');
    assert.equal(fs.existsSync(auditPath), true);
    assert.match(fs.readFileSync(auditPath, 'utf8'), /system\.get_capabilities/);
  } finally {
    await server.stop();
    server.dispose();
    if (previous.enabled === undefined) delete process.env.HONGS_TABLE_ACTION_API; else process.env.HONGS_TABLE_ACTION_API = previous.enabled;
    if (previous.token === undefined) delete process.env.HONGS_TABLE_ACTION_TOKEN; else process.env.HONGS_TABLE_ACTION_TOKEN = previous.token;
    if (previous.port === undefined) delete process.env.HONGS_TABLE_ACTION_PORT; else process.env.HONGS_TABLE_ACTION_PORT = previous.port;
    if (previous.permissions === undefined) delete process.env.HONGS_TABLE_ACTION_PERMISSIONS; else process.env.HONGS_TABLE_ACTION_PERMISSIONS = previous.permissions;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
