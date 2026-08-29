import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import { buildPayload, parseCommandLineJson, redactSecrets, selectResponsePath } from './table_action_client.mjs';
import {
  IMPLEMENTED_ACTIONS,
  buildActionRequestSchema,
  describeAction
} from '../agent_api/action_definitions.js';

test('generated JSON Schema stays identical to the Action Definition source', () => {
  const generated = JSON.parse(fs.readFileSync(new URL('../agent_api/table_action_api_v0.1.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(generated, buildActionRequestSchema());
  assert.equal(generated['x-phase'], 'phase4.7');
  assert.equal(generated['x-app-version'], '2.6.5');
  assert.equal(generated.allOf.length, IMPLEMENTED_ACTIONS.length);
});

test('every implemented action has precise help and params schema', () => {
  for (const action of IMPLEMENTED_ACTIONS) {
    const definition = describeAction(action);
    assert.equal(definition.name, action);
    assert.equal(typeof definition.summary, 'string');
    assert.equal(definition.summary.length > 0, true);
    assert.equal(definition.paramsSchema.type, 'object');
    assert.equal(definition.paramsSchema.additionalProperties, false);
    assert.equal(definition.exampleRequest.action, action);
  }
});

test('params-file preserves Chinese text and Windows paths without shell escaping', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'table-action-cli-'));
  try {
    const paramsPath = path.join(tempRoot, 'params.json');
    fs.writeFileSync(paramsPath, JSON.stringify({
      tableId: 'table_x',
      updates: [{ rowId: 'row_x', fieldId: 'field_x', value: ['F:\\素材\\测试视频.mp4'] }]
    }), 'utf8');
    const payload = buildPayload(['cell.batch_set', `--params-file=${paramsPath}`, '--confirmed']);
    assert.equal(payload.params.updates[0].value[0], 'F:\\素材\\测试视频.mp4');
    assert.equal(payload.confirmed, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('request-file supplies a complete request and detects action mismatch', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'table-action-request-'));
  try {
    const requestPath = path.join(tempRoot, 'request.json');
    fs.writeFileSync(requestPath, JSON.stringify({ version: '0.1', action: 'table.list', params: {} }), 'utf8');
    const payload = buildPayload([`--request-file=${requestPath}`]);
    assert.equal(payload.action, 'table.list');
    assert.throws(() => buildPayload(['row.query', `--request-file=${requestPath}`]), /Action mismatch/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('stdin and generation idempotency flags build valid payloads', () => {
  const stdinPayload = buildPayload(['row.get', '--stdin'], '{"tableId":"table_x","rowId":"row_x"}');
  assert.equal(stdinPayload.params.rowId, 'row_x');

  const generation = buildPayload([
    'generation.run',
    '--idempotency-key=phase46-generation-001',
    '--params={"tableId":"table_x","fieldId":"field_ai","rowIds":["row_x"]}'
  ]);
  assert.equal(generation.idempotencyKey, 'phase46-generation-001');
  assert.equal(generation.params.idempotencyKey, 'phase46-generation-001');
  const validate = new Ajv({ allErrors: true, jsonPointers: true, schemaId: 'auto' }).compile(buildActionRequestSchema());
  assert.equal(validate(generation), true, JSON.stringify(validate.errors));
});

test('CLI rejects multiple JSON input sources and redacts sensitive keys', () => {
  assert.throws(() => buildPayload(['table.list', '--params={}', '--stdin'], '{}'), /exactly one/);
  assert.deepEqual(redactSecrets({ token: 'secret', nested: { apiKey: 'key', value: 1 } }), {
    token: '[REDACTED]', nested: { apiKey: '[REDACTED]', value: 1 }
  });
});

test('Windows-mangled inline params recover without eval and preserve paths', () => {
  const payload = buildPayload(['row.query', '--params={\\tableId\\:\\table_x\\,\\limit\\:20}']);
  assert.deepEqual(payload.params, { tableId: 'table_x', limit: 20 });

  const pathPayload = buildPayload(['export.preview', '--params={\\tableId\\:\\table_x\\,\\format\\:\\csv\\}']);
  assert.equal(pathPayload.params.format, 'csv');
  assert.deepEqual(parseCommandLineJson("{'tableId':'table_x','limit':20}"), { tableId: 'table_x', limit: 20 });
  assert.throws(() => parseCommandLineJson('{tableId:(()=>globalThis.pwned=true)()}'), /never evaluates JavaScript/);
  assert.equal(globalThis.pwned, undefined);
});

test('CLI response selection returns only the requested branch and rejects missing paths', () => {
  const response = { ok: true, data: { jobs: [{ localJobId: 'job_1', phase: 'polling' }] } };
  assert.deepEqual(selectResponsePath(response, 'data.jobs'), response.data.jobs);
  assert.throws(() => selectResponsePath(response, 'data.missing'), /Response path not found/);
});
