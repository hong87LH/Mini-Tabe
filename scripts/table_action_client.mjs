#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import JSON5 from 'json5';
import {
  IMPLEMENTED_ACTIONS,
  TABLE_ACTION_API_VERSION,
  buildActionRequestSchema,
  describeAction
} from '../agent_api/action_definitions.js';

const SECRET_KEY_PATTERN = /token|secret|credential|authorization|api[-_]?key|access[-_]?key/i;

function optionValue(args, name) {
  const prefix = `--${name}=`;
  const found = args.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function hasOption(args, name) {
  return args.includes(`--${name}`);
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON root must be an object');
    return value;
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${error.message}`);
  }
}

function restoreWindowsBoundaryQuotes(text) {
  const chars = [...text];
  const significantBefore = index => {
    for (let i = index - 1; i >= 0; i -= 1) if (!/\s/.test(chars[i])) return chars[i];
    return '';
  };
  const significantAfter = index => {
    for (let i = index + 1; i < chars.length; i += 1) if (!/\s/.test(chars[i])) return chars[i];
    return '';
  };
  return chars.map((char, index) => {
    if (char !== '\\') return char;
    const before = significantBefore(index);
    const after = significantAfter(index);
    return '{[,:'.includes(before) || '}:,]'.includes(after) ? '"' : char;
  }).join('');
}

export function parseCommandLineJson(text, label = '--params') {
  const input = String(text || '').replace(/^\uFEFF/, '').trim();
  const candidates = [input];
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
    candidates.push(input.slice(1, -1));
  }
  if (input.includes('\\"')) candidates.push(input.replace(/\\"/g, '"'));
  if (!input.includes('"') && input.includes('\\')) candidates.push(restoreWindowsBoundaryQuotes(input));
  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    for (const parser of [JSON.parse, JSON5.parse]) {
      try {
        const value = parser(candidate);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON root must be an object');
        return value;
      } catch (error) {
        lastError = error;
      }
    }
  }
  const preview = input.length > 160 ? `${input.slice(0, 157)}...` : input;
  throw new Error(`Invalid JSON from ${label}: ${lastError?.message || 'unable to parse'}\n` +
    `Received: ${preview}\n` +
    `Windows tip: prefer --params-file=params.json or pipe JSON with --stdin. The CLI safely repairs common \\" shell mangling but never evaluates JavaScript.`);
}

function readJsonFile(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  return parseJson(fs.readFileSync(resolved, 'utf8'), `${label} (${resolved})`);
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecrets(entry)
  ]));
}

export function selectResponsePath(value, selectPath) {
  let output = value;
  for (const segment of String(selectPath || '').split('.').filter(Boolean)) {
    if (output === null || output === undefined || typeof output !== 'object' || !(segment in output)) {
      throw new Error(`Response path not found: ${selectPath}`);
    }
    output = output[segment];
  }
  return output;
}

function formatGeneralHelp() {
  return `AI Table Studio Action API Client v${TABLE_ACTION_API_VERSION}\n\n` +
    `The client calls an already running localhost Action API. It does not start Electron.\n\n` +
    `Usage:\n` +
    `  node scripts/table_action_client.mjs <action> --token=TOKEN --params='{"key":"value"}'\n` +
    `  node scripts/table_action_client.mjs <action> --token=TOKEN --params-file=params.json\n` +
    `  node scripts/table_action_client.mjs --request-file=request.json --token=TOKEN\n` +
    `  Get-Content params.json | node scripts/table_action_client.mjs <action> --stdin --token=TOKEN\n\n` +
    `Discovery:\n` +
    `  node scripts/table_action_client.mjs <action> --help\n` +
    `  node scripts/table_action_client.mjs system.describe_action --token=TOKEN --params-file=describe.json\n\n` +
    `Validation and diagnostics:\n` +
    `  --validate-only       Validate locally without HTTP or token\n` +
    `  --print-request       Print the final request with secrets redacted\n` +
    `  --compact             Emit compact JSON instead of pretty JSON\n` +
    `  --select=PATH         Print only a response branch such as data.jobs\n` +
    `  --expected-revision=N Add optimistic concurrency protection\n` +
    `  --idempotency-key=KEY Add a mutation idempotency key\n` +
    `  --dry-run             Ask the API to calculate without committing\n` +
    `  --confirmed           Confirm an operation that requires confirmation\n\n` +
    `Input sources are mutually exclusive: --params, --params-file, --stdin, --request-file.\n` +
    `Implemented actions: ${IMPLEMENTED_ACTIONS.length}. Use <action> --help for the exact Schema.`;
}

function formatActionHelp(action) {
  const definition = describeAction(action);
  if (!definition) throw new Error(`Unknown action: ${action}\nUse --help to list available actions.`);
  return `${definition.name}\n${definition.summary}\n\n` +
    `Permission: ${definition.permission}\n` +
    `Write: ${definition.write}\n` +
    `Runtime: ${definition.runtime}\n` +
    `Confirmation: ${definition.confirmation}\n` +
    `Dry run: ${definition.supportsDryRun}\n` +
    `${definition.notes.length ? `Notes:\n${definition.notes.map(note => `  - ${note}`).join('\n')}\n\n` : ''}` +
    `Params JSON Schema:\n${JSON.stringify(definition.paramsSchema, null, 2)}\n\n` +
    `Example request:\n${JSON.stringify(definition.exampleRequest, null, 2)}`;
}

export function formatValidationErrors(action, errors = []) {
  const lines = ['SCHEMA_VALIDATION_FAILED', `Action: ${action}`];
  for (const error of errors) lines.push(`- ${error.dataPath || error.path || '/'}: ${error.message}`);
  lines.push(`Hint: run node scripts/table_action_client.mjs ${action} --help`);
  if (errors.some(error => (error.dataPath || error.path) === '.expectedRevision' || (error.dataPath || error.path) === '/expectedRevision')) {
    lines.push('Use --expected-revision=N; expectedRevision must be a JSON integer.');
  }
  return lines.join('\n');
}

export function buildPayload(args, stdinText = '') {
  const positional = args.filter(arg => !arg.startsWith('--'));
  const positionalAction = positional[0] || null;
  const paramsArg = optionValue(args, 'params');
  const paramsFile = optionValue(args, 'params-file');
  const requestFile = optionValue(args, 'request-file');
  const useStdin = hasOption(args, 'stdin');
  const sourceCount = Number(paramsArg !== null) + Number(paramsFile !== null) + Number(requestFile !== null) + Number(useStdin);
  if (sourceCount > 1) throw new Error('Use exactly one of --params, --params-file, --stdin, or --request-file.');

  let payload = requestFile ? readJsonFile(requestFile, '--request-file') : {};
  const fileAction = typeof payload.action === 'string' ? payload.action : null;
  if (positionalAction && fileAction && positionalAction !== fileAction) {
    throw new Error(`Action mismatch: command line uses ${positionalAction}, request file uses ${fileAction}.`);
  }
  const action = positionalAction || fileAction || 'system.get_capabilities';

  let params = payload.params;
  if (paramsArg !== null) params = parseCommandLineJson(paramsArg, '--params');
  if (paramsFile !== null) params = readJsonFile(paramsFile, '--params-file');
  if (useStdin) params = parseJson(stdinText, 'stdin');
  if (!params || typeof params !== 'object' || Array.isArray(params)) params = {};

  payload = {
    ...payload,
    version: payload.version || TABLE_ACTION_API_VERSION,
    action,
    requestId: payload.requestId || `cli_${Date.now()}`,
    actor: payload.actor || { type: 'agent', name: optionValue(args, 'actor') || 'node-cli' },
    dryRun: hasOption(args, 'dry-run') ? true : !!payload.dryRun,
    confirmed: hasOption(args, 'confirmed') ? true : !!payload.confirmed,
    params
  };

  const revision = optionValue(args, 'expected-revision');
  if (revision !== null) {
    if (!/^\d+$/.test(revision)) throw new Error('--expected-revision must be a non-negative integer.');
    payload.expectedRevision = Number(revision);
  }
  const idempotencyKey = optionValue(args, 'idempotency-key');
  if (idempotencyKey !== null) {
    if (!idempotencyKey) throw new Error('--idempotency-key cannot be empty.');
    payload.idempotencyKey = idempotencyKey;
    if (action === 'generation.run' && !payload.params.idempotencyKey) payload.params.idempotencyKey = idempotencyKey;
  }
  return payload;
}

export async function runCli(args = process.argv.slice(2)) {
  const positional = args.filter(arg => !arg.startsWith('--'));
  if (hasOption(args, 'help') || hasOption(args, 'h')) {
    console.log(positional[0] ? formatActionHelp(positional[0]) : formatGeneralHelp());
    return 0;
  }

  const stdinText = hasOption(args, 'stdin') ? fs.readFileSync(0, 'utf8') : '';
  const payload = buildPayload(args, stdinText);
  const validate = new Ajv({ allErrors: true, jsonPointers: true, schemaId: 'auto' }).compile(buildActionRequestSchema());
  if (!validate(payload)) {
    console.error(formatValidationErrors(payload.action, validate.errors || []));
    return 2;
  }

  const pretty = !hasOption(args, 'compact');
  const stringify = value => JSON.stringify(value, null, pretty ? 2 : 0);
  if (hasOption(args, 'print-request')) console.error(stringify(redactSecrets(payload)));

  if (hasOption(args, 'validate-only')) {
    console.log(stringify({ ok: true, validated: true, action: payload.action, request: redactSecrets(payload) }));
    return 0;
  }

  const token = optionValue(args, 'token') || process.env.HONGS_TABLE_ACTION_TOKEN || '';
  if (!token) {
    console.error('Missing token. Use --token=... or HONGS_TABLE_ACTION_TOKEN. Local validation succeeded, but HTTP was not sent.');
    return 2;
  }
  const portValue = optionValue(args, 'port') || process.env.HONGS_TABLE_ACTION_PORT || '17321';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${portValue}`);
    return 2;
  }

  const response = await fetch(`http://127.0.0.1:${port}/v0.1/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({ ok: false, error: { message: 'Invalid JSON response' } }));
  const selectPath = optionValue(args, 'select');
  const output = selectPath ? selectResponsePath(body, selectPath) : body;
  console.log(stringify(output));
  if ((!response.ok || !body.ok) && body?.error?.code === 'SCHEMA_VALIDATION_FAILED') {
    console.error(formatValidationErrors(payload.action, body.error.details || []));
  }
  return response.ok && body.ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 2;
  }
}
