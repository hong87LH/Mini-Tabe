#!/usr/bin/env node

const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) || '';

const token = getArg('token') || process.env.HONGS_TABLE_ACTION_TOKEN || '';
const port = Number(getArg('port') || process.env.HONGS_TABLE_ACTION_PORT || 17321);
const tableId = getArg('table');
const count = Math.max(2, Math.min(20, Number(getArg('count') || 6)));
const prefix = getArg('prefix') || `RapidWrite_${Date.now()}`;

if (!token || !tableId) {
  console.error('Usage: node scripts/table_action_rapid_write_test.mjs --table=table_xxx --token=... [--count=6]');
  console.error('Run this ONLY on a disposable API test table; it intentionally creates fields and one row.');
  process.exit(2);
}

const endpoint = `http://127.0.0.1:${port}/v0.1/actions`;

async function action(action, params, options = {}) {
  const payload = {
    version: '0.1',
    action,
    requestId: `stress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    actor: { type: 'agent', name: 'rapid-write-test' },
    dryRun: false,
    confirmed: options.confirmed === true,
    params
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    const err = new Error(`${action} failed: ${body?.error?.code || response.status} ${body?.error?.message || ''}`);
    err.body = body;
    throw err;
  }
  return body;
}

const health = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json());
console.log('[health]', health);

const phaseMatch = /^phase(\d+)(?:\.(\d+))?$/.exec(String(health.phase || ''));
if (!phaseMatch || Number(phaseMatch[1]) < 2) {
  throw new Error(`Rapid-write test requires Phase 2 or later, got ${health.phase || 'unknown'}`);
}

// Do not hard-code a single phase here: this regression test is valid for Phase 2+.
// Also verify that /health and system.get_capabilities advertise the same runtime phase.
const capabilities = await action('system.get_capabilities', {});
const capabilityPhase = capabilities.data?.phase || '';
if (capabilityPhase && capabilityPhase !== health.phase) {
  throw new Error(`Phase mismatch: /health=${health.phase}, capabilities=${capabilityPhase}`);
}
console.log(`[phase] ${health.phase} accepted (rapid-write regression requires phase2+, including phase3.5-style subphases)`);

const names = Array.from({ length: count }, (_, i) => `${prefix}_${String(i + 1).padStart(2, '0')}`);
console.log(`\nSending ${count} field.create requests concurrently...`);

const createResponses = await Promise.all(names.map(name => action('field.create', {
  tableId,
  name,
  type: 'text',
  config: { width: 150 }
}, { confirmed: true })));

const created = createResponses.map(r => r.data.field);
console.log('All HTTP responses returned ok. Verifying committed schema...');

const schema = await action('table.get_schema', { tableId });
const schemaFields = schema.data?.fields || schema.data?.schema?.fields || [];
const schemaIds = new Set(schemaFields.map(f => f.id));
const missing = created.filter(f => !schemaIds.has(f.id));
if (missing.length) {
  console.error('Missing committed fields:', missing.map(f => ({ id: f.id, name: f.name })));
  throw new Error(`Rapid-write regression: ${missing.length}/${created.length} successful field.create responses are missing from schema.`);
}

console.log('Schema contains every successfully returned field. Creating a row that references all new field IDs...');
const values = Object.fromEntries(created.map((f, i) => [f.id, `value_${i + 1}`]));
const row = await action('row.create', { tableId, rows: [{ values }] });
console.log('row.create ok:', row.data);

console.log('\nPASS: rapid concurrent writes were serialized and ACKed after commit.');
console.log(`Created ${created.length} fields and 1 row in test table ${tableId}.`);
