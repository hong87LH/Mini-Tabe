// AI Table Studio v2.6.5 Table Action API v0.1 - Phase 4.7 stale-job safety and compact discovery
// Pure ESM module: no React/Electron dependency. It receives a workspace snapshot,
// validates an action, and returns the next snapshot. The renderer decides when to commit.

import {
  TABLE_ACTION_API_VERSION as DEFINED_API_VERSION,
  TABLE_ACTION_API_PHASE as DEFINED_API_PHASE,
  TABLE_ACTION_APP_VERSION,
  ACTION_DEFINITION_VERSION,
  IMPLEMENTED_ACTIONS as DEFINED_ACTIONS,
  PLANNED_ACTIONS as DEFINED_PLANNED_ACTIONS,
  describeAction,
  getActionMetadata as getDefinedActionMetadata
} from './action_definitions.js';

export const TABLE_ACTION_API_VERSION = DEFINED_API_VERSION;
export const TABLE_ACTION_API_PHASE = DEFINED_API_PHASE;

export const FIELD_TYPES = [
  'text', 'number', 'singleSelect', 'multiSelect', 'date', 'checkbox',
  'person', 'url', 'attachment', 'aiText', 'formula', 'aiImage', 'rating', 'aiVideo'
];

export const IMPLEMENTED_ACTIONS = DEFINED_ACTIONS;
export const PLANNED_ACTIONS = DEFINED_PLANNED_ACTIONS;

const ACTION_META = Object.fromEntries(IMPLEMENTED_ACTIONS.map(action => [action, getDefinedActionMetadata(action)]));

export function getActionMetadata(action) {
  return getDefinedActionMetadata(action);
}

const FILTER_OPERATORS = new Set([
  'equals', 'not_equals', 'contains', 'not_contains',
  'empty', 'not_empty', 'in', 'gt', 'gte', 'lt', 'lte'
]);

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) {}
  }
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0);
}

function effects(overrides = {}) {
  return {
    tablesAffected: 0,
    fieldsAffected: 0,
    tablesCreated: 0,
    fieldsCreated: 0,
    fieldsReordered: 0,
    rowsCreated: 0,
    rowsAffected: 0,
    cellsAffected: 0,
    mediaAffected: 0,
    jobsCreated: 0,
    ...overrides
  };
}

function success(request, data, actionEffects = effects(), options = {}) {
  return {
    ok: true,
    version: TABLE_ACTION_API_VERSION,
    action: request.action,
    requestId: request.requestId || null,
    permission: ACTION_META[request.action]?.permission || 'read',
    data: data ?? {},
    effects: actionEffects,
    warnings: options.warnings || [],
    requiresConfirmation: !!options.requiresConfirmation,
    undoToken: options.undoToken || null
  };
}

function failure(request, code, message, details = {}, retryable = false) {
  return {
    ok: false,
    version: TABLE_ACTION_API_VERSION,
    action: request?.action || null,
    requestId: request?.requestId || null,
    error: { code, message, retryable, details }
  };
}

function normalizeRequest(raw) {
  if (!isObject(raw)) return { error: ['INVALID_REQUEST', 'Request must be an object'] };
  if (raw.version !== TABLE_ACTION_API_VERSION) {
    return { error: ['INVALID_REQUEST', `Unsupported version: ${raw.version ?? '(missing)'}`] };
  }
  if (!IMPLEMENTED_ACTIONS.includes(raw.action)) {
    const planned = PLANNED_ACTIONS.includes(raw.action);
    return { error: ['INVALID_REQUEST', planned
      ? `Action ${raw.action} is reserved but not implemented in Phase 3.5`
      : `Unknown action: ${raw.action}`] };
  }
  if (!isObject(raw.params)) return { error: ['INVALID_REQUEST', 'params must be an object'] };
  return {
    request: {
      version: TABLE_ACTION_API_VERSION,
      action: raw.action,
      requestId: raw.requestId ? String(raw.requestId) : null,
      actor: isObject(raw.actor) ? clone(raw.actor) : null,
      dryRun: raw.dryRun === true,
      confirmed: raw.confirmed === true,
      expectedRevision: raw.expectedRevision === undefined || raw.expectedRevision === null
        ? null
        : Number(raw.expectedRevision),
      idempotencyKey: String(raw.idempotencyKey || raw.params?.idempotencyKey || '').trim() || null,
      params: clone(raw.params)
    }
  };
}

function normalizeSnapshot(snapshot) {
  if (!isObject(snapshot) || !Array.isArray(snapshot.tables)) {
    throw new Error('Workspace snapshot must contain tables[]');
  }
  return {
    tables: clone(snapshot.tables),
    activeTableId: snapshot.activeTableId || snapshot.tables[0]?.id || null,
    projectName: snapshot.projectName || 'Untitled Project',
    workspaceRevision: Number.isInteger(snapshot.workspaceRevision) && snapshot.workspaceRevision >= 0
      ? snapshot.workspaceRevision
      : 0
  };
}

function findTable(workspace, tableId) {
  return workspace.tables.find(t => t.id === tableId) || null;
}

function getRequiredTable(request, workspace) {
  const tableId = String(request.params.tableId || '');
  if (!tableId) return { error: failure(request, 'INVALID_REQUEST', 'tableId is required') };
  const table = findTable(workspace, tableId);
  if (!table) return { error: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
  if (!table.data || !Array.isArray(table.data.fields) || !Array.isArray(table.data.records)) {
    return { error: failure(request, 'INVALID_REQUEST', `Table data is invalid: ${tableId}`, { tableId }) };
  }
  return { table, tableId };
}

function fieldById(table, fieldId) {
  return table.data.fields.find(f => f.id === fieldId) || null;
}

function rowById(table, rowId) {
  return table.data.records.find(r => r.id === rowId) || null;
}

function fieldDisplayValue(field, raw) {
  if (raw === null || raw === undefined) return raw;
  if (field?.type === 'singleSelect') {
    return field.options?.find(o => o.id === raw)?.name ?? raw;
  }
  if (field?.type === 'multiSelect') {
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(v => field.options?.find(o => o.id === v)?.name ?? v);
  }
  if ((field?.type === 'attachment' || field?.type === 'aiImage' || field?.type === 'aiVideo') && Array.isArray(raw)) {
    return raw.map(item => {
      if (typeof item === 'string') return item;
      return item?.name || item?.url || item?.path || '';
    }).filter(Boolean);
  }
  return raw;
}

function compareValue(field, raw, operator, expected) {
  if (operator === 'empty') return isEmptyValue(raw);
  if (operator === 'not_empty') return !isEmptyValue(raw);

  const display = fieldDisplayValue(field, raw);
  const scalar = Array.isArray(display) ? display : [display];
  const normalized = scalar.map(v => String(v ?? '').trim().toLowerCase());

  if (operator === 'equals') {
    if (Array.isArray(display)) return normalized.includes(String(expected ?? '').trim().toLowerCase());
    return String(display ?? '').trim().toLowerCase() === String(expected ?? '').trim().toLowerCase();
  }
  if (operator === 'not_equals') return !compareValue(field, raw, 'equals', expected);
  if (operator === 'contains') {
    const needle = String(expected ?? '').toLowerCase();
    return normalized.some(v => v.includes(needle));
  }
  if (operator === 'not_contains') return !compareValue(field, raw, 'contains', expected);
  if (operator === 'in') {
    const candidates = (Array.isArray(expected) ? expected : [expected]).map(v => String(v ?? '').trim().toLowerCase());
    return normalized.some(v => candidates.includes(v));
  }

  const left = Number(Array.isArray(display) ? display[0] : display);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === 'gt') return left > right;
  if (operator === 'gte') return left >= right;
  if (operator === 'lt') return left < right;
  if (operator === 'lte') return left <= right;
  return false;
}

function formatRow(table, row, fieldIds = null) {
  const ids = fieldIds || table.data.fields.map(f => f.id);
  const values = {};
  const displayValues = {};
  for (const fieldId of ids) {
    const field = fieldById(table, fieldId);
    if (!field) continue;
    values[fieldId] = clone(row[fieldId]);
    displayValues[fieldId] = clone(fieldDisplayValue(field, row[fieldId]));
  }
  return { id: row.id, values, displayValues };
}

function validateFieldValue(field, value) {
  if (!field) return { ok: false, message: 'Field does not exist' };
  if (value === null || value === undefined || value === '') return { ok: true, value };

  if (field.type === 'number' || field.type === 'rating') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return { ok: false, message: `Expected a number for ${field.name}` };
    return { ok: true, value: n };
  }
  if (field.type === 'checkbox') {
    if (typeof value !== 'boolean') return { ok: false, message: `Expected boolean for ${field.name}` };
    return { ok: true, value };
  }
  if (field.type === 'singleSelect') {
    const options = field.options || [];
    const exact = options.find(o => o.id === value || o.name === value);
    if (!exact) return { ok: false, message: `Unknown option for ${field.name}: ${String(value)}` };
    return { ok: true, value: exact.id };
  }
  if (field.type === 'multiSelect') {
    const options = field.options || [];
    const input = Array.isArray(value) ? value : [value];
    const resolved = [];
    for (const item of input) {
      const exact = options.find(o => o.id === item || o.name === item);
      if (!exact) return { ok: false, message: `Unknown option for ${field.name}: ${String(item)}` };
      if (!resolved.includes(exact.id)) resolved.push(exact.id);
    }
    return { ok: true, value: resolved };
  }
  if (field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') {
    if (!Array.isArray(value)) return { ok: false, message: `Media field ${field.name} expects an array` };
    return { ok: true, value: clone(value) };
  }
  return { ok: true, value: clone(value) };
}

function appendValue(field, current, incoming) {
  if (field.type === 'multiSelect') {
    const a = Array.isArray(current) ? current : [];
    const b = Array.isArray(incoming) ? incoming : [incoming];
    return Array.from(new Set([...a, ...b]));
  }
  if (field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') {
    const a = Array.isArray(current) ? current : [];
    const b = Array.isArray(incoming) ? incoming : [incoming];
    return [...a, ...clone(b)];
  }
  if (typeof current === 'string' || typeof incoming === 'string') {
    return `${current ?? ''}${incoming ?? ''}`;
  }
  if (Array.isArray(current)) return [...current, ...(Array.isArray(incoming) ? incoming : [incoming])];
  return incoming;
}

function writeCell(table, rowId, fieldId, incomingValue, writeMode = 'replace') {
  const field = fieldById(table, fieldId);
  if (!field) return { error: ['FIELD_NOT_FOUND', `Field not found: ${fieldId}`] };
  const row = rowById(table, rowId);
  if (!row) return { error: ['ROW_NOT_FOUND', `Row not found: ${rowId}`] };

  const current = row[fieldId];
  if (writeMode === 'if_empty' && !isEmptyValue(current)) {
    return { table, changedCells: [], skipped: true };
  }

  let candidate = incomingValue;
  if (writeMode === 'append') candidate = appendValue(field, current, incomingValue);
  const validated = validateFieldValue(field, candidate);
  if (!validated.ok) return { error: ['INVALID_VALUE', validated.message] };

  if (JSON.stringify(current) === JSON.stringify(validated.value)) {
    return { table, changedCells: [], skipped: true };
  }

  const data = table.data;
  const nextRecords = data.records.map(r => ({ ...r }));
  const groupId = data.cellLinks?.[`${rowId}-${fieldId}`];
  const changedCells = [];

  for (const rec of nextRecords) {
    const linked = groupId && data.cellLinks?.[`${rec.id}-${fieldId}`] === groupId;
    if (rec.id === rowId || linked) {
      if (JSON.stringify(rec[fieldId]) !== JSON.stringify(validated.value)) {
        rec[fieldId] = clone(validated.value);
        changedCells.push({ rowId: rec.id, fieldId });
      }
    }
  }

  return {
    table: { ...table, data: { ...data, records: nextRecords } },
    changedCells,
    skipped: changedCells.length === 0
  };
}


const MEDIA_FIELD_TYPES = new Set(['attachment', 'aiImage', 'aiVideo', 'url']);
const SMART_FIELD_TYPES = new Set(['aiText', 'aiImage', 'aiVideo']);

function stripPreviewOnlyMediaProps(item) {
  if (!isObject(item)) return item;
  const next = clone(item);
  delete next.mappedUrl;
  delete next.refUrls;
  delete next.refCells;
  return next;
}

function normalizeMediaItems(value, fieldType = null) {
  if (value === null || value === undefined || value === '') return [];
  if (fieldType === 'url') {
    const url = typeof value === 'string' ? value.trim() : String(value?.url || value?.path || '').trim();
    return url ? [{ url }] : [];
  }
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return { url: item };
      if (!isObject(item)) return null;
      const clean = stripPreviewOnlyMediaProps(item);
      if (!clean.url && clean.path) clean.url = clean.path;
      return clean;
    }).filter(item => item && String(item.url || '').trim());
  }
  if (typeof value === 'string') {
    return value.split(/[,\r\n]+/).map(v => v.trim()).filter(Boolean).map(url => ({ url }));
  }
  if (isObject(value)) {
    const clean = stripPreviewOnlyMediaProps(value);
    if (!clean.url && clean.path) clean.url = clean.path;
    return clean.url ? [clean] : [];
  }
  return [];
}

function detectMediaType(item, url = '') {
  const explicit = String(item?.mediaType || item?.kind || '').toLowerCase();
  if (['image', 'video', 'audio'].includes(explicit)) return explicit;
  const mime = String(item?.type || item?.mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  const raw = String(url || item?.url || item?.path || '').split(/[?#]/)[0].toLowerCase();
  if (/\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv|mpeg|mpg|3gp)$/.test(raw)) return 'video';
  if (/\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|aiff|aif)$/.test(raw)) return 'audio';
  return 'image';
}

function makeMediaInstance(tableId, rowId, field, item, index) {
  const clean = stripPreviewOnlyMediaProps(item) || {};
  const url = String(clean.url || clean.path || '').trim();
  const mediaType = detectMediaType(clean, url);
  return {
    id: `media:${tableId}:${rowId}:${field.id}:${index}`,
    index,
    rowId,
    fieldId: field.id,
    fieldName: field.name,
    fieldType: field.type,
    mediaType,
    url,
    path: url,
    name: clean.name || null,
    cropData: clean.cropData ? clone(clean.cropData) : null,
    trimData: clean.trimData ? clone(clean.trimData) : null,
    item: clean
  };
}

function getMediaCell(table, rowId, fieldId) {
  const field = fieldById(table, fieldId);
  if (!field) return { error: ['FIELD_NOT_FOUND', `Field not found: ${fieldId}`] };
  if (!MEDIA_FIELD_TYPES.has(field.type)) {
    return { error: ['INVALID_FIELD_TYPE', `Field is not media-capable: ${field.name}`, { fieldId, fieldType: field.type }] };
  }
  const row = rowById(table, rowId);
  if (!row) return { error: ['ROW_NOT_FOUND', `Row not found: ${rowId}`] };
  const items = normalizeMediaItems(row[fieldId], field.type);
  return { field, row, items };
}

function getSmartFieldMediaTemplates(field) {
  if (field?.type === 'aiText') return [String(field.aiTextConfig?.sourceImageTemplate || '')].filter(Boolean);
  if (field?.type === 'aiImage') return [String(field.aiImageConfig?.sourceImageTemplate || '')].filter(Boolean);
  if (field?.type === 'aiVideo') {
    return [
      String(field.aiVideoConfig?.sourceImageTemplate || ''),
      String(field.aiVideoConfig?.sourceVideoTemplate || ''),
      String(field.aiVideoConfig?.sourceAudioTemplate || '')
    ].filter(Boolean);
  }
  return [];
}

function getSmartFieldMediaSourceFields(sourceField, allFields) {
  const templates = getSmartFieldMediaTemplates(sourceField);
  if (!templates.length) return [];
  const firstPosition = new Map();
  let offset = 0;
  for (const template of templates) {
    for (const candidate of allFields) {
      if (!MEDIA_FIELD_TYPES.has(candidate.type)) continue;
      const index = template.indexOf(`{${candidate.name}}`);
      if (index < 0) continue;
      const position = offset + index;
      const previous = firstPosition.get(candidate.id);
      if (previous === undefined || position < previous) firstPosition.set(candidate.id, position);
    }
    offset += template.length + 1;
  }
  return allFields
    .filter(field => firstPosition.has(field.id))
    .sort((a, b) => (firstPosition.get(a.id) || 0) - (firstPosition.get(b.id) || 0));
}

function resolveEffectiveMediaContext(table, row, targetField, temporaryReferenceFieldId = null) {
  let sourceField = null;
  if (SMART_FIELD_TYPES.has(targetField.type)) {
    const ownSources = getSmartFieldMediaSourceFields(targetField, table.data.fields);
    if (ownSources.length) sourceField = targetField;
    else if (temporaryReferenceFieldId) {
      const candidate = fieldById(table, temporaryReferenceFieldId);
      if (candidate && SMART_FIELD_TYPES.has(candidate.type)) sourceField = candidate;
    }
  } else if (targetField.type === 'text' && temporaryReferenceFieldId) {
    const candidate = fieldById(table, temporaryReferenceFieldId);
    if (candidate && SMART_FIELD_TYPES.has(candidate.type)) sourceField = candidate;
  }
  if (!sourceField) return { sourceField: null, items: [] };

  const sourceFields = getSmartFieldMediaSourceFields(sourceField, table.data.fields);
  const counters = { image: 0, video: 0, audio: 0 };
  const output = [];
  for (const sourceMediaField of sourceFields) {
    const items = normalizeMediaItems(row[sourceMediaField.id], sourceMediaField.type);
    items.forEach((item, index) => {
      const instance = makeMediaInstance(table.id, row.id, sourceMediaField, item, index);
      counters[instance.mediaType] += 1;
      const sequence = counters[instance.mediaType];
      const token = instance.mediaType === 'audio'
        ? `<Audio ${sequence}>`
        : instance.mediaType === 'video'
          ? `<Video ${sequence}>`
          : `<Picture ${sequence}>`;
      output.push({ ...instance, sequence, token, label: token.slice(1, -1), sourceFieldName: sourceMediaField.name });
    });
  }
  return {
    sourceField: { id: sourceField.id, name: sourceField.name, type: sourceField.type },
    items: output
  };
}

function mediaValueFromItems(field, items) {
  if (field.type === 'url') return items[0]?.url || '';
  return items.map(item => stripPreviewOnlyMediaProps(item));
}

function mediaEffects(changedCells = 1) {
  return effects({ rowsAffected: changedCells ? 1 : 0, cellsAffected: changedCells, mediaAffected: changedCells ? 1 : 0 });
}

function replaceFieldNameToken(text, oldName, newName) {
  if (typeof text !== 'string' || !oldName || oldName === newName) return text;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\{${escaped}\\}`, 'g'), `{${newName}}`);
}

function renameReferences(fields, fieldId, oldName, newName) {
  return fields.map(field => {
    if (field.id === fieldId) return { ...field, name: newName };
    const next = clone(field);
    if (next.prompt) next.prompt = replaceFieldNameToken(next.prompt, oldName, newName);
    for (const configName of ['aiTextConfig', 'aiImageConfig', 'aiVideoConfig']) {
      if (!next[configName]) continue;
      const cfg = { ...next[configName] };
      for (const key of Object.keys(cfg)) {
        if (typeof cfg[key] === 'string') cfg[key] = replaceFieldNameToken(cfg[key], oldName, newName);
      }
      next[configName] = cfg;
    }
    return next;
  });
}


const DEFAULT_OPTION_COLORS = [
  'bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-amber-100 text-amber-700',
  'bg-purple-100 text-purple-700', 'bg-pink-100 text-pink-700', 'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700', 'bg-slate-100 text-slate-700'
];

function uniqueFieldName(table, baseName) {
  const existing = new Set(table.data.fields.map(field => String(field.name).trim().toLowerCase()));
  if (!existing.has(String(baseName).trim().toLowerCase())) return baseName;
  let index = 2;
  while (existing.has(`${String(baseName).trim().toLowerCase()} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function normalizeSelectField(field) {
  if (!field || !['singleSelect', 'multiSelect'].includes(field.type)) return null;
  return field;
}

function optionUsage(table, field, optionId) {
  const rowIds = [];
  for (const row of table.data.records) {
    const value = row[field.id];
    const used = field.type === 'multiSelect'
      ? Array.isArray(value) && value.includes(optionId)
      : value === optionId;
    if (used) rowIds.push(row.id);
  }
  return rowIds;
}

function filterRows(table, rows, filter) {
  if (!filter) return rows;
  if (!isObject(filter) || !['and', 'or'].includes(filter.logic) || !Array.isArray(filter.conditions)) {
    throw Object.assign(new Error('filter must use logic=and|or and conditions[]'), { code: 'INVALID_REQUEST' });
  }
  for (const condition of filter.conditions) {
    if (!isObject(condition) || !fieldById(table, condition.fieldId)) {
      throw Object.assign(new Error(`Filter field not found: ${condition?.fieldId || ''}`), { code: 'FIELD_NOT_FOUND' });
    }
    if (!FILTER_OPERATORS.has(condition.operator)) {
      throw Object.assign(new Error(`Unsupported filter operator: ${condition.operator}`), { code: 'INVALID_REQUEST' });
    }
  }
  const test = row => {
    const values = filter.conditions.map(condition => {
      const field = fieldById(table, condition.fieldId);
      return compareValue(field, row[condition.fieldId], condition.operator, condition.value);
    });
    return filter.logic === 'or' ? values.some(Boolean) : values.every(Boolean);
  };
  return rows.filter(test);
}

function sortRows(table, rows, sort) {
  if (!sort) return rows;
  const list = Array.isArray(sort) ? sort : [sort];
  for (const rule of list) {
    if (!isObject(rule) || !fieldById(table, rule.fieldId)) {
      throw Object.assign(new Error(`Sort field not found: ${rule?.fieldId || ''}`), { code: 'FIELD_NOT_FOUND' });
    }
    if (!['asc', 'desc'].includes(rule.direction)) {
      throw Object.assign(new Error(`Invalid sort direction: ${rule.direction}`), { code: 'INVALID_REQUEST' });
    }
  }
  const next = [...rows];
  next.sort((a, b) => {
    for (const rule of list) {
      const field = fieldById(table, rule.fieldId);
      const va = fieldDisplayValue(field, a[rule.fieldId]);
      const vb = fieldDisplayValue(field, b[rule.fieldId]);
      const left = Array.isArray(va) ? va.join(', ') : va;
      const right = Array.isArray(vb) ? vb.join(', ') : vb;
      let cmp = 0;
      if (typeof left === 'number' && typeof right === 'number') cmp = left - right;
      else cmp = String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) return rule.direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return next;
}


function uiFilterToApi(rule) {
  const operatorMap = { is_empty: 'empty', is_not_empty: 'not_empty', has_any: 'in' };
  return {
    fieldId: String(rule?.fieldId || ''),
    operator: operatorMap[rule?.operator] || rule?.operator || 'contains',
    value: clone(rule?.value)
  };
}

function apiFilterToUi(table, filter) {
  if (filter === null) return [];
  if (!isObject(filter) || filter.logic !== 'and' || !Array.isArray(filter.conditions)) {
    throw Object.assign(new Error('View filters currently support logic=and with conditions[]. Use row.query for OR queries.'), { code: 'INVALID_REQUEST' });
  }
  const operatorMap = { empty: 'is_empty', not_empty: 'is_not_empty', in: 'has_any' };
  const supported = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'empty', 'not_empty', 'in']);
  return filter.conditions.map(condition => {
    if (!fieldById(table, condition?.fieldId)) throw Object.assign(new Error(`Filter field not found: ${condition?.fieldId || ''}`), { code: 'FIELD_NOT_FOUND' });
    if (!supported.has(condition.operator)) throw Object.assign(new Error(`View filter does not support operator: ${condition.operator}`), { code: 'INVALID_REQUEST' });
    return {
      id: makeId('filter'),
      fieldId: String(condition.fieldId),
      operator: operatorMap[condition.operator] || condition.operator,
      value: clone(condition.value)
    };
  });
}

function canonicalViewState(table, state = {}) {
  const filterConfig = Array.isArray(state.filterConfig) ? state.filterConfig : [];
  return {
    filter: { logic: 'and', conditions: filterConfig.map(uiFilterToApi) },
    filterEnabled: !state.isFilterTempDisabled,
    sort: clone(state.sortConfig || null),
    group: clone(state.groupConfig || []),
    groupEnabled: !state.isGroupTempDisabled,
    foldedGroups: clone(state.foldedGroups || []),
    rowHeight: state.rowHeight || 'medium',
    gallerySettings: clone(state.gallerySettings || null)
  };
}

function normalizeAiConfig(field, rawConfig) {
  if (!['aiText', 'aiImage', 'aiVideo'].includes(field.type)) {
    return { error: `field.configure_ai requires aiText / aiImage / aiVideo: ${field.name}` };
  }
  if (!isObject(rawConfig)) return { error: 'config must be an object' };

  const commonAllowed = new Set(['prompt', 'refFields', 'model', 'sourceImage']);
  const byType = {
    aiText: new Set(['skill']),
    aiImage: new Set(['count', 'size', 'folderPath', 'resolution', 'ratio', 'filenameTemplate', 'isRetouchMode', 'saveToSourceFolder', 'scaleToSource']),
    aiVideo: new Set(['duration', 'resolution', 'ratio', 'sound', 'mode', 'enhancePrompt', 'offPeak', 'folderPath', 'filenameTemplate', 'sourceVideo', 'sourceAudio'])
  };
  const allowed = new Set([...commonAllowed, ...byType[field.type]]);
  const unknown = Object.keys(rawConfig).filter(key => !allowed.has(key));
  if (unknown.length) return { error: `Unsupported ${field.type} config keys: ${unknown.join(', ')}`, unknown };

  const patch = {};
  if ('prompt' in rawConfig) patch.prompt = String(rawConfig.prompt ?? '');
  if ('refFields' in rawConfig) {
    if (!Array.isArray(rawConfig.refFields)) return { error: 'refFields must be an array' };
    patch.refFields = rawConfig.refFields.map(String);
  }

  if (field.type === 'aiText') {
    const cfg = { ...(field.aiTextConfig || {}) };
    if ('model' in rawConfig) cfg.modelTemplate = String(rawConfig.model ?? '');
    if ('sourceImage' in rawConfig) cfg.sourceImageTemplate = String(rawConfig.sourceImage ?? '');
    if ('skill' in rawConfig) cfg.skillTemplate = String(rawConfig.skill ?? '');
    patch.aiTextConfig = cfg;
  } else if (field.type === 'aiImage') {
    const cfg = { ...(field.aiImageConfig || {}) };
    if ('model' in rawConfig) cfg.modelTemplate = String(rawConfig.model ?? '');
    if ('sourceImage' in rawConfig) cfg.sourceImageTemplate = String(rawConfig.sourceImage ?? '');
    for (const key of ['size', 'folderPath', 'resolution', 'ratio', 'filenameTemplate']) {
      if (key in rawConfig) cfg[key] = String(rawConfig[key] ?? '');
    }
    if ('count' in rawConfig) {
      const count = Number(rawConfig.count);
      if (!Number.isInteger(count) || count < 1 || count > 20) return { error: 'count must be an integer between 1 and 20' };
      cfg.count = count;
    }
    for (const key of ['isRetouchMode', 'saveToSourceFolder', 'scaleToSource']) {
      if (key in rawConfig) cfg[key] = rawConfig[key] === true;
    }
    patch.aiImageConfig = cfg;
  } else {
    const cfg = { ...(field.aiVideoConfig || {}) };
    if ('model' in rawConfig) cfg.modelTemplate = String(rawConfig.model ?? '');
    if ('sourceImage' in rawConfig) cfg.sourceImageTemplate = String(rawConfig.sourceImage ?? '');
    if ('sourceVideo' in rawConfig) cfg.sourceVideoTemplate = String(rawConfig.sourceVideo ?? '');
    if ('sourceAudio' in rawConfig) cfg.sourceAudioTemplate = String(rawConfig.sourceAudio ?? '');
    for (const key of ['duration', 'resolution', 'ratio', 'mode', 'folderPath', 'filenameTemplate']) {
      if (key in rawConfig) cfg[key] = String(rawConfig[key] ?? '');
    }
    for (const key of ['sound', 'enhancePrompt', 'offPeak']) {
      if (key in rawConfig) cfg[key] = rawConfig[key] === true || rawConfig[key] === 'true' ? 'true' : 'false';
    }
    patch.aiVideoConfig = cfg;
  }
  return { patch };
}

function validateRefFields(table, refFields) {
  if (!Array.isArray(refFields)) return null;
  const missing = refFields.filter(id => !fieldById(table, id));
  return missing.length ? missing : null;
}

function mergeEffects(target, source) {
  const next = { ...target };
  for (const key of Object.keys(effects())) next[key] = Number(next[key] || 0) + Number(source?.[key] || 0);
  return next;
}

function replaceTable(workspace, tableIndex, table) {
  const tables = [...workspace.tables];
  tables[tableIndex] = table;
  return { ...workspace, tables };
}

function uniqueTableName(workspace, baseName) {
  let name = String(baseName || 'Untitled Table').trim() || 'Untitled Table';
  if (!workspace.tables.some(table => String(table.name).trim().toLowerCase() === name.toLowerCase())) return name;
  let suffix = 2;
  while (workspace.tables.some(table => String(table.name).trim().toLowerCase() === `${name} ${suffix}`.toLowerCase())) suffix += 1;
  return `${name} ${suffix}`;
}

function convertFieldValue(value, targetType, field) {
  if (isEmptyValue(value)) return { ok: true, value: null };
  if (targetType === field.type) return { ok: true, value: clone(value) };
  if (targetType === 'text' || targetType === 'url') {
    if (Array.isArray(value)) return { ok: true, value: value.map(item => isObject(item) ? (item.name || item.url || JSON.stringify(item)) : String(item)).join(', ') };
    return { ok: true, value: isObject(value) ? JSON.stringify(value) : String(value) };
  }
  if (targetType === 'number' || targetType === 'rating') {
    const numeric = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(numeric)) return { ok: false, reason: 'NOT_A_NUMBER' };
    return { ok: true, value: targetType === 'rating' ? Math.max(0, Math.min(5, numeric)) : numeric };
  }
  if (targetType === 'checkbox') {
    if (typeof value === 'boolean') return { ok: true, value };
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是', 'checked'].includes(normalized)) return { ok: true, value: true };
    if (['false', '0', 'no', 'n', '否', 'unchecked'].includes(normalized)) return { ok: true, value: false };
    return { ok: false, reason: 'NOT_A_BOOLEAN' };
  }
  if (targetType === 'date') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { ok: false, reason: 'INVALID_DATE' };
    return { ok: true, value: parsed.toISOString() };
  }
  if (targetType === 'singleSelect' || targetType === 'multiSelect') {
    const values = Array.isArray(value) ? value : [value];
    const names = values.map(item => String(item)).filter(Boolean);
    return { ok: true, value: targetType === 'singleSelect' ? (names[0] || null) : names };
  }
  return { ok: false, reason: `UNSUPPORTED_CONVERSION_TO_${targetType}` };
}

function inspectFieldConversion(table, field, targetType) {
  let convertibleRows = 0;
  const invalid = [];
  let emptyRows = 0;
  for (const row of table.data.records) {
    if (isEmptyValue(row[field.id])) { emptyRows += 1; continue; }
    const converted = convertFieldValue(row[field.id], targetType, field);
    if (converted.ok) convertibleRows += 1;
    else invalid.push({ rowId: row.id, reason: converted.reason });
  }
  return { totalRows: table.data.records.length, convertibleRows, invalidRows: invalid.length, emptyRows, invalid: invalid.slice(0, 100) };
}

function resolveRowInsertionIndex(records, params) {
  const selectors = ['beforeRowId', 'afterRowId', 'toIndex'].filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '');
  if (selectors.length > 1) return { error: 'Use only one of beforeRowId, afterRowId, or toIndex' };
  if (params.beforeRowId !== undefined) {
    const index = records.findIndex(row => row.id === String(params.beforeRowId));
    return index < 0 ? { error: `Row not found: ${params.beforeRowId}` } : { index };
  }
  if (params.afterRowId !== undefined) {
    const index = records.findIndex(row => row.id === String(params.afterRowId));
    return index < 0 ? { error: `Row not found: ${params.afterRowId}` } : { index: index + 1 };
  }
  if (params.toIndex !== undefined) {
    const index = Number(params.toIndex);
    return !Number.isInteger(index) || index < 0 || index > records.length ? { error: `toIndex must be between 0 and ${records.length}` } : { index };
  }
  return { index: records.length };
}

function mediaCellWithIndex(request, table) {
  const rowId = String(request.params.rowId || '');
  const fieldId = String(request.params.fieldId || '');
  const cell = getMediaCell(table, rowId, fieldId);
  if (cell.error) return { error: failure(request, cell.error[0], cell.error[1], cell.error[2] || { rowId, fieldId }) };
  const index = Number(request.params.index ?? 0);
  if (!Number.isInteger(index) || index < 0 || index >= cell.items.length) {
    return { error: failure(request, 'MEDIA_NOT_FOUND', `Media index not found: ${request.params.index ?? 0}`, { rowId, fieldId, index }) };
  }
  return { ...cell, rowId, fieldId, index };
}

function writeMediaItems(workspace, table, tableIndex, rowId, field, items) {
  const records = table.data.records.map(row => row.id === rowId ? { ...row, [field.id]: mediaValueFromItems(field, items) } : row);
  return replaceTable(workspace, tableIndex, { ...table, data: { ...table.data, records } });
}

function applyAction(request, workspace) {
  const action = request.action;

  if (action === 'system.describe_action') {
    const targetAction = String(request.params.action || '').trim();
    const definition = describeAction(targetAction);
    if (!definition) {
      return { response: failure(request, 'ACTION_NOT_FOUND', `Action definition not found: ${targetAction}`, { action: targetAction }) };
    }
    return { response: success(request, { action: definition }) };
  }

  if (action === 'system.get_capabilities') {
    const detail = request.params.detail === 'full' ? 'full' : 'summary';
    const actionGroups = Object.entries(IMPLEMENTED_ACTIONS.reduce((groups, name) => {
      const group = name.split('.')[0];
      groups[group] = (groups[group] || 0) + 1;
      return groups;
    }, {})).map(([name, count]) => ({ name, count }));
    return {
      response: success(request, {
        apiVersion: TABLE_ACTION_API_VERSION,
        phase: TABLE_ACTION_API_PHASE,
        appVersion: TABLE_ACTION_APP_VERSION,
        actionDefinitionVersion: ACTION_DEFINITION_VERSION,
        detail,
        implementedActions: IMPLEMENTED_ACTIONS.map(name => detail === 'full' ? ({
          name, ...ACTION_META[name], summary: describeAction(name)?.summary || '', schemaAvailable: true
        }) : ({ name })),
        actionGroups,
        plannedActions: PLANNED_ACTIONS,
        fieldTypes: FIELD_TYPES,
        features: {
          actionDefinitions: true,
          describeAction: true,
          mcpReadyActionSchemas: true,
          dryRun: true,
          confirmationGate: true,
          workspaceRevision: true,
          expectedRevision: true,
          undo: 'tokenized-api-undo-redo',
          transaction: true,
          atomicTransaction: true,
          idempotentMutations: true,
          workspaceSave: true,
          standardizedEffects: true,
          permissionScopes: true,
          auditLog: true,
          serverSentEvents: true,
          batchRuntime: true,
          exportRuntime: true,
          interactiveContext: true,
          currentViewQuery: true,
          safeAiFieldConfig: true,
          selectOptionManagement: true,
          cellLinkManagement: true,
          generationRuntime: true,
          jobRuntime: true,
          staleJobCleanup: true,
          compactCapabilityDiscovery: true,
          projectedJobList: true,
          windowsCliJsonRecovery: true,
          idempotentGeneration: true,
          mediaInstanceAware: true,
          mediaCopyPreservesEdits: true,
          effectiveMediaContext: true,
          localHttpBridge: true
        }
      })
    };
  }

  if (['workspace.get_dirty_state', 'workspace.save', 'undo.get_status', 'undo.apply', 'redo.apply'].includes(action)) {
    if ((action === 'undo.apply' || action === 'redo.apply') && request.params.undoToken !== undefined && !String(request.params.undoToken).trim()) {
      return { response: failure(request, 'INVALID_REQUEST', 'undoToken cannot be empty when provided') };
    }
    return { response: success(request, { runtimeRequired: true, runtimeAction: action, params: clone(request.params) }) };
  }

  if (action === 'transaction.preview' || action === 'transaction.execute') {
    const items = request.params.actions;
    if (!Array.isArray(items) || items.length < 1 || items.length > 500) {
      return { response: failure(request, 'INVALID_REQUEST', 'actions must contain 1-500 transaction steps') };
    }
    let current = clone(workspace);
    let combined = effects();
    const steps = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!isObject(item) || !IMPLEMENTED_ACTIONS.includes(item.action) || !isObject(item.params)) {
        return { response: failure(request, 'TRANSACTION_FAILED', `Invalid transaction step at index ${index}`, { stepIndex: index }) };
      }
      const meta = ACTION_META[item.action];
      if (!meta?.write || meta.runtime || item.action.startsWith('transaction.') || item.action.startsWith('undo.') || item.action.startsWith('redo.')) {
        return { response: failure(request, 'TRANSACTION_FAILED', `Action cannot run inside a data transaction: ${item.action}`, { stepIndex: index, action: item.action }) };
      }
      const childRequest = {
        version: TABLE_ACTION_API_VERSION,
        action: item.action,
        requestId: request.requestId ? `${request.requestId}:${index}` : null,
        actor: request.actor,
        dryRun: false,
        confirmed: true,
        expectedRevision: null,
        idempotencyKey: null,
        params: clone(item.params)
      };
      let result;
      try { result = applyAction(childRequest, current); }
      catch (error) {
        return { response: failure(request, 'TRANSACTION_FAILED', error?.message || String(error), { stepIndex: index, action: item.action }) };
      }
      if (!result.response?.ok) {
        return { response: failure(request, 'TRANSACTION_FAILED', `Step ${index + 1} failed: ${result.response?.error?.message || item.action}`, {
          stepIndex: index, action: item.action, cause: result.response?.error || null
        }) };
      }
      if (result.nextWorkspace) current = result.nextWorkspace;
      combined = mergeEffects(combined, result.response.effects);
      steps.push({ index, action: item.action, data: clone(result.response.data), effects: clone(result.response.effects) });
    }
    const data = { steps, actionCount: steps.length, atomic: true, preview: action === 'transaction.preview' };
    return action === 'transaction.preview'
      ? { response: success(request, data, combined) }
      : { nextWorkspace: current, response: success(request, data, combined) };
  }

  if (action === 'table.update') {
    const tableId = String(request.params.tableId || '');
    const index = workspace.tables.findIndex(table => table.id === tableId);
    if (index < 0) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    const patch = isObject(request.params.patch) ? request.params.patch : null;
    if (!patch) return { response: failure(request, 'INVALID_REQUEST', 'patch is required') };
    const allowed = new Set(['name', 'description', 'icon']);
    const unknown = Object.keys(patch).filter(key => !allowed.has(key));
    if (unknown.length) return { response: failure(request, 'INVALID_REQUEST', `Unsupported table.update keys: ${unknown.join(', ')}`) };
    if ('name' in patch) {
      const name = String(patch.name || '').trim();
      if (!name) return { response: failure(request, 'INVALID_REQUEST', 'Table name cannot be empty') };
      if (workspace.tables.some(table => table.id !== tableId && String(table.name).trim().toLowerCase() === name.toLowerCase())) {
        return { response: failure(request, 'WRITE_CONFLICT', `Table name already exists: ${name}`) };
      }
    }
    const nextTable = { ...workspace.tables[index], ...clone(patch) };
    return { nextWorkspace: replaceTable(workspace, index, nextTable), response: success(request, { table: { id: nextTable.id, name: nextTable.name } }, effects({ tablesAffected: 1 })) };
  }

  if (action === 'table.duplicate') {
    const tableId = String(request.params.tableId || '');
    const index = workspace.tables.findIndex(table => table.id === tableId);
    if (index < 0) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    const source = workspace.tables[index];
    const id = String(request.params.newTableId || '').trim() || makeId('table');
    if (workspace.tables.some(table => table.id === id)) return { response: failure(request, 'WRITE_CONFLICT', `Table ID already exists: ${id}`) };
    const name = uniqueTableName(workspace, request.params.name || `${source.name} Copy`);
    const duplicate = { ...clone(source), id, name };
    if (request.params.copyRecords === false) duplicate.data.records = [];
    const tables = [...workspace.tables]; tables.splice(index + 1, 0, duplicate);
    return { nextWorkspace: { ...workspace, tables }, response: success(request, { table: { id, name }, sourceTableId: tableId }, effects({ tablesCreated: 1, tablesAffected: 1 })) };
  }

  if (action === 'table.delete') {
    const tableId = String(request.params.tableId || '');
    const index = workspace.tables.findIndex(table => table.id === tableId);
    if (index < 0) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    if (workspace.tables.length === 1) return { response: failure(request, 'WRITE_CONFLICT', 'The last table cannot be deleted') };
    const removed = workspace.tables[index];
    const tables = workspace.tables.filter(table => table.id !== tableId);
    const activeTableId = workspace.activeTableId === tableId ? tables[Math.min(index, tables.length - 1)].id : workspace.activeTableId;
    return { nextWorkspace: { ...workspace, tables, activeTableId }, response: success(request, {
      deletedTable: { id: removed.id, name: removed.name }, affectedFields: removed.data?.fields?.length || 0, affectedRows: removed.data?.records?.length || 0
    }, effects({ tablesAffected: 1, fieldsAffected: removed.data?.fields?.length || 0, rowsAffected: removed.data?.records?.length || 0 })) };
  }

  if (action === 'table.reorder') {
    const tableId = String(request.params.tableId || '');
    const fromIndex = workspace.tables.findIndex(table => table.id === tableId);
    if (fromIndex < 0) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    const toIndex = Number(request.params.toIndex);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= workspace.tables.length) return { response: failure(request, 'INVALID_REQUEST', `toIndex must be between 0 and ${workspace.tables.length - 1}`) };
    const tables = [...workspace.tables]; const [moved] = tables.splice(fromIndex, 1); tables.splice(toIndex, 0, moved);
    return { nextWorkspace: { ...workspace, tables }, response: success(request, { tableId, fromIndex, toIndex, order: tables.map(table => table.id) }, effects({ tablesAffected: fromIndex === toIndex ? 0 : 1 })) };
  }

  if (action === 'context.get_current') {
    const table = findTable(workspace, workspace.activeTableId);
    const mode = table?.activeViewMode || 'grid';
    const viewState = table?.viewStates?.[mode] || {};
    return {
      response: success(request, {
        projectName: workspace.projectName,
        activeTable: table ? { id: table.id, name: table.name } : null,
        activeViewMode: mode,
        filterConfig: clone(viewState.filterConfig || []),
        sortConfig: clone(viewState.sortConfig || null),
        groupConfig: clone(viewState.groupConfig || []),
        activeCell: null,
        selection: null,
        selectionAvailable: false,
        runtimeRequired: !!table,
        runtimeAction: table ? 'context.get_current' : null,
        params: table ? { tableId: table.id } : {}
      })
    };
  }

  if (action === 'table.list') {
    return {
      response: success(request, {
        tables: workspace.tables.map(t => ({
          id: t.id,
          name: t.name,
          icon: t.icon || null,
          fields: t.data?.fields?.length || 0,
          records: t.data?.records?.length || 0,
          active: t.id === workspace.activeTableId
        }))
      })
    };
  }

  if (action === 'table.get_schema') {
    const result = getRequiredTable(request, workspace);
    if (result.error) return { response: result.error };
    return {
      response: success(request, {
        table: { id: result.table.id, name: result.table.name, icon: result.table.icon || null },
        fields: clone(result.table.data.fields),
        stats: { records: result.table.data.records.length }
      })
    };
  }

  if (action === 'table.create') {
    const name = String(request.params.name || '').trim();
    if (!name) return { response: failure(request, 'INVALID_REQUEST', 'name is required') };
    if (workspace.tables.some(t => String(t.name).trim().toLowerCase() === name.toLowerCase())) {
      return { response: failure(request, 'WRITE_CONFLICT', `Table name already exists: ${name}`) };
    }
    const id = String(request.params.tableId || '').trim() || makeId('table');
    if (workspace.tables.some(t => t.id === id)) return { response: failure(request, 'WRITE_CONFLICT', `Table ID already exists: ${id}`) };
    const newTable = {
      id,
      name,
      description: request.params.description ? String(request.params.description) : undefined,
      icon: request.params.icon || undefined,
      activeViewMode: 'grid',
      viewStates: {},
      data: { fields: [], records: [] }
    };
    const next = { ...workspace, tables: [...workspace.tables, newTable] };
    if (request.params.activate !== false) next.activeTableId = id;
    return {
      nextWorkspace: next,
      response: success(request, { table: { id, name }, active: next.activeTableId === id }, effects({ tablesCreated: 1, tablesAffected: 1 }))
    };
  }


  if (action === 'table.activate') {
    const tableId = String(request.params.tableId || '');
    if (!tableId) return { response: failure(request, 'INVALID_REQUEST', 'tableId is required') };
    const target = findTable(workspace, tableId);
    if (!target) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    if (workspace.activeTableId === tableId) {
      return { response: success(request, { table: { id: target.id, name: target.name }, active: true, changed: false }) };
    }
    return {
      nextWorkspace: { ...workspace, activeTableId: tableId },
      response: success(request, { table: { id: target.id, name: target.name }, active: true, changed: true })
    };
  }

  if (action === 'view.get') {
    const tableId = String(request.params.tableId || workspace.activeTableId || '');
    const table = findTable(workspace, tableId);
    if (!table) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    const mode = request.params.viewMode || table.activeViewMode || 'grid';
    if (!['grid', 'gallery'].includes(mode)) return { response: failure(request, 'INVALID_REQUEST', `Unsupported viewMode: ${mode}`) };
    const state = clone(table.viewStates?.[mode] || {});
    return { response: success(request, {
      table: { id: table.id, name: table.name },
      viewMode: mode,
      active: table.id === workspace.activeTableId && mode === (table.activeViewMode || 'grid'),
      view: canonicalViewState(table, state)
    }) };
  }

  if (action === 'view.update') {
    const tableId = String(request.params.tableId || workspace.activeTableId || '');
    const table = findTable(workspace, tableId);
    if (!table) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    const tableIndex = workspace.tables.findIndex(t => t.id === tableId);
    const mode = request.params.viewMode || table.activeViewMode || 'grid';
    if (!['grid', 'gallery'].includes(mode)) return { response: failure(request, 'INVALID_REQUEST', `Unsupported viewMode: ${mode}`) };
    const patch = isObject(request.params.patch) ? clone(request.params.patch) : null;
    if (!patch || Object.keys(patch).length === 0) return { response: failure(request, 'INVALID_REQUEST', 'patch must be a non-empty object') };
    const allowed = new Set(['filter', 'filterEnabled', 'sort', 'group', 'groupEnabled', 'foldedGroups', 'rowHeight', 'gallerySettings']);
    const unknown = Object.keys(patch).filter(key => !allowed.has(key));
    if (unknown.length) return { response: failure(request, 'INVALID_REQUEST', `Unsupported view.update keys: ${unknown.join(', ')}`) };
    const currentState = table.viewStates?.[mode] || {};
    const nextState = { ...currentState };
    try {
      if ('filter' in patch) nextState.filterConfig = apiFilterToUi(table, patch.filter);
      if ('filterEnabled' in patch) nextState.isFilterTempDisabled = patch.filterEnabled !== true;
      if ('sort' in patch) {
        if (patch.sort === null) nextState.sortConfig = null;
        else {
          if (!isObject(patch.sort) || !fieldById(table, patch.sort.fieldId) || !['asc', 'desc'].includes(patch.sort.direction)) {
            throw Object.assign(new Error('sort must contain a valid fieldId and asc|desc direction'), { code: 'INVALID_REQUEST' });
          }
          nextState.sortConfig = { fieldId: String(patch.sort.fieldId), direction: patch.sort.direction };
        }
      }
      if ('group' in patch) {
        if (!Array.isArray(patch.group)) throw Object.assign(new Error('group must be an array'), { code: 'INVALID_REQUEST' });
        nextState.groupConfig = patch.group.map(group => {
          if (!isObject(group) || !fieldById(table, group.fieldId) || !['asc', 'desc'].includes(group.direction)) {
            throw Object.assign(new Error('Each group item requires valid fieldId and asc|desc direction'), { code: 'INVALID_REQUEST' });
          }
          return { fieldId: String(group.fieldId), direction: group.direction };
        });
      }
      if ('groupEnabled' in patch) nextState.isGroupTempDisabled = patch.groupEnabled !== true;
      if ('foldedGroups' in patch) {
        if (!Array.isArray(patch.foldedGroups)) throw Object.assign(new Error('foldedGroups must be an array'), { code: 'INVALID_REQUEST' });
        nextState.foldedGroups = patch.foldedGroups.map(String);
      }
      if ('rowHeight' in patch) {
        if (!['short', 'medium', 'tall', 'extra'].includes(patch.rowHeight)) throw Object.assign(new Error(`Unsupported rowHeight: ${patch.rowHeight}`), { code: 'INVALID_REQUEST' });
        nextState.rowHeight = patch.rowHeight;
      }
      if ('gallerySettings' in patch) nextState.gallerySettings = clone(patch.gallerySettings);
    } catch (error) {
      return { response: failure(request, error?.code || 'INVALID_REQUEST', error?.message || String(error)) };
    }
    const nextTable = {
      ...table,
      activeViewMode: request.params.activate === true ? mode : (table.activeViewMode || 'grid'),
      viewStates: { ...(table.viewStates || {}), [mode]: nextState }
    };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { tableId, viewMode: mode, view: canonicalViewState(nextTable, nextState), activeViewMode: nextTable.activeViewMode })
    };
  }


  if (action === 'generation.get_capabilities') {
    return { response: success(request, { runtimeRequired: true, runtimeAction: action, params: {} }) };
  }

  if (action === 'job.list') {
    const limit = Math.max(1, Math.min(500, Number(request.params.limit) || 100));
    if (request.params.status !== undefined && !Array.isArray(request.params.status)) {
      return { response: failure(request, 'INVALID_REQUEST', 'status must be an array when provided') };
    }
    return { response: success(request, { runtimeRequired: true, runtimeAction: action, params: { ...clone(request.params), detail: request.params.detail === 'full' ? 'full' : 'summary', limit } }) };
  }

  if (action === 'job.get' || action === 'job.retry' || action === 'job.cancel' || action === 'job.get_result' || action === 'job.delete_history') {
    const jobId = String(request.params.jobId || '');
    if (!jobId) return { response: failure(request, 'INVALID_REQUEST', 'jobId is required') };
    return { response: success(request, { runtimeRequired: true, runtimeAction: action, params: { jobId } }) };
  }

  if (action === 'job.cleanup_stale.preview' || action === 'job.cleanup_stale') {
    const tableId = String(request.params.tableId || '').trim();
    if (!tableId) return { response: failure(request, 'INVALID_REQUEST', 'tableId is required') };
    if (!findTable(workspace, tableId)) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`) };
    const staleAfterMinutes = Math.max(5, Math.min(10080, Number(request.params.staleAfterMinutes) || 30));
    const limit = Math.max(1, Math.min(500, Number(request.params.limit) || 100));
    return { response: success(request, {
      runtimeRequired: true,
      runtimeAction: action,
      params: { ...clone(request.params), tableId, staleAfterMinutes, limit }
    }) };
  }

  if (action === 'job.bind_result') {
    const jobId = String(request.params.jobId || '');
    const target = request.params.target;
    if (!jobId || !isObject(target) || !target.tableId || !target.rowId || !target.fieldId) {
      return { response: failure(request, 'INVALID_REQUEST', 'job.bind_result requires jobId and target {tableId,rowId,fieldId}') };
    }
    return { response: success(request, { runtimeRequired: true, runtimeAction: action, params: clone(request.params) }, effects({ rowsAffected: 1, cellsAffected: 1, mediaAffected: 1 })) };
  }

  if (['batch.list', 'batch.get', 'batch.cancel', 'batch.retry_failed', 'batch.list_results'].includes(action)) {
    if (action !== 'batch.list' && !String(request.params.batchId || '').trim()) return { response: failure(request, 'INVALID_REQUEST', 'batchId is required') };
    return { response: success(request, { runtimeRequired: true, runtimeAction: action, params: clone(request.params) }) };
  }

  if (['export.preview', 'export.attachments', 'export.csv', 'export.json'].includes(action)) {
    const tableId = String(request.params.tableId || workspace.activeTableId || '');
    if (!findTable(workspace, tableId)) return { response: failure(request, 'TABLE_NOT_FOUND', `Table not found: ${tableId}`, { tableId }) };
    if (action !== 'export.preview' && !String(request.params.folderPath || '').trim()) {
      return { response: failure(request, 'INVALID_REQUEST', `${action} requires folderPath for non-interactive export`) };
    }
    return { response: success(request, { runtimeRequired: true, runtimeAction: action, params: { ...clone(request.params), tableId } }) };
  }

  const required = getRequiredTable(request, workspace);
  if (required.error) return { response: required.error };
  const table = required.table;
  const tableIndex = workspace.tables.findIndex(t => t.id === table.id);

  if (action === 'field.delete') {
    const fieldId = String(request.params.fieldId || '');
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    const fields = table.data.fields.filter(item => item.id !== fieldId).map(item => {
      const next = clone(item);
      if (Array.isArray(next.refFields)) next.refFields = next.refFields.filter(id => id !== fieldId);
      const token = `{${field.name}}`;
      if (typeof next.prompt === 'string') next.prompt = next.prompt.split(token).join('');
      for (const configName of ['aiTextConfig', 'aiImageConfig', 'aiVideoConfig']) {
        if (!isObject(next[configName])) continue;
        for (const key of Object.keys(next[configName])) {
          if (typeof next[configName][key] === 'string') next[configName][key] = next[configName][key].split(token).join('');
        }
      }
      return next;
    });
    const affectedRows = table.data.records.filter(row => !isEmptyValue(row[fieldId])).length;
    const records = table.data.records.map(row => { const next = { ...row }; delete next[fieldId]; return next; });
    const cellLinks = Object.fromEntries(Object.entries(table.data.cellLinks || {}).filter(([key]) => !key.endsWith(`-${fieldId}`)));
    const nextTable = { ...table, data: { ...table.data, fields, records, cellLinks } };
    return { nextWorkspace: replaceTable(workspace, tableIndex, nextTable), response: success(request, {
      deletedField: { id: field.id, name: field.name, type: field.type }, affectedRows
    }, effects({ fieldsAffected: 1, rowsAffected: affectedRows, cellsAffected: affectedRows })) };
  }

  if (action === 'field.convert.preview' || action === 'field.convert.run') {
    const fieldId = String(request.params.fieldId || '');
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    const targetType = String(request.params.targetType || '');
    if (!FIELD_TYPES.includes(targetType) || ['aiText', 'aiImage', 'aiVideo', 'formula', 'attachment'].includes(targetType)) {
      return { response: failure(request, 'INVALID_FIELD_TYPE', `Unsupported conversion target: ${targetType}`) };
    }
    const inspection = inspectFieldConversion(table, field, targetType);
    if (action === 'field.convert.preview') return { response: success(request, { fieldId, sourceType: field.type, targetType, ...inspection }) };
    const policy = request.params.invalidValuePolicy || 'reject';
    if (!['reject', 'clear', 'keep'].includes(policy)) return { response: failure(request, 'INVALID_REQUEST', `Invalid invalidValuePolicy: ${policy}`) };
    if (inspection.invalidRows && policy === 'reject') {
      return { response: failure(request, 'FIELD_CONVERSION_INVALID', 'Some values cannot be converted. Use invalidValuePolicy=clear|keep after reviewing preview.', inspection) };
    }
    let options = clone(request.params.options || field.options || []);
    const records = table.data.records.map(row => {
      const result = convertFieldValue(row[fieldId], targetType, field);
      let value = result.ok ? result.value : policy === 'keep' ? clone(row[fieldId]) : null;
      if (targetType === 'singleSelect' || targetType === 'multiSelect') {
        const names = (Array.isArray(value) ? value : [value]).filter(Boolean).map(String);
        for (const name of names) {
          if (!options.some(option => option.name === name)) options.push({ id: makeId('opt'), name, color: DEFAULT_OPTION_COLORS[options.length % DEFAULT_OPTION_COLORS.length] });
        }
        const ids = names.map(name => options.find(option => option.name === name)?.id).filter(Boolean);
        value = targetType === 'singleSelect' ? (ids[0] || null) : ids;
      }
      return { ...row, [fieldId]: value };
    });
    const nextField = { ...field, type: targetType };
    for (const key of ['aiTextConfig', 'aiImageConfig', 'aiVideoConfig', 'formula']) delete nextField[key];
    if (targetType === 'singleSelect' || targetType === 'multiSelect') nextField.options = options;
    else delete nextField.options;
    const fields = table.data.fields.map(item => item.id === fieldId ? nextField : item);
    const nextTable = { ...table, data: { ...table.data, fields, records } };
    return { nextWorkspace: replaceTable(workspace, tableIndex, nextTable), response: success(request, {
      field: clone(nextField), sourceType: field.type, targetType, policy, ...inspection
    }, effects({ fieldsAffected: 1, rowsAffected: table.data.records.length, cellsAffected: inspection.convertibleRows + inspection.invalidRows })) };
  }

  if (action === 'row.insert' || action === 'row.duplicate') {
    let created = [];
    let insertionParams = request.params;
    if (action === 'row.duplicate') {
      const rowIds = Array.isArray(request.params.rowIds) ? request.params.rowIds.map(String) : [];
      if (!rowIds.length || rowIds.length > 500) return { response: failure(request, 'INVALID_REQUEST', 'rowIds must contain 1-500 IDs') };
      const sources = rowIds.map(id => rowById(table, id));
      const missing = rowIds.filter((id, index) => !sources[index]);
      if (missing.length) return { response: failure(request, 'ROW_NOT_FOUND', 'One or more rows do not exist', { rowIds: missing }) };
      created = sources.map(source => ({ ...clone(source), id: makeId('rec') }));
      if (request.params.toIndex === undefined && request.params.beforeRowId === undefined && request.params.afterRowId === undefined) {
        const lastIndex = Math.max(...rowIds.map(id => table.data.records.findIndex(row => row.id === id)));
        insertionParams = { ...request.params, toIndex: lastIndex + 1 };
      }
    } else {
      const rows = request.params.rows;
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) return { response: failure(request, 'INVALID_REQUEST', 'rows must contain 1-500 items') };
      const reserved = new Set(table.data.records.map(row => row.id));
      for (const input of rows) {
        if (!isObject(input) || !isObject(input.values || {})) return { response: failure(request, 'INVALID_REQUEST', 'Each row must contain values{}') };
        const id = String(input.id || '').trim() || makeId('rec');
        if (reserved.has(id)) return { response: failure(request, 'WRITE_CONFLICT', `Row ID already exists: ${id}`) };
        reserved.add(id);
        const row = { id };
        for (const [fieldId, rawValue] of Object.entries(input.values || {})) {
          const field = fieldById(table, fieldId);
          if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
          const validated = validateFieldValue(field, rawValue);
          if (!validated.ok) return { response: failure(request, 'INVALID_VALUE', validated.message, { fieldId }) };
          row[fieldId] = clone(validated.value);
        }
        created.push(row);
      }
    }
    const position = resolveRowInsertionIndex(table.data.records, insertionParams);
    if (position.error) return { response: failure(request, position.error.startsWith('Row not found') ? 'ROW_NOT_FOUND' : 'INVALID_REQUEST', position.error) };
    const records = [...table.data.records]; records.splice(position.index, 0, ...created);
    const nextTable = { ...table, data: { ...table.data, records } };
    const cellCount = created.reduce((sum, row) => sum + Object.keys(row).filter(key => key !== 'id').length, 0);
    return { nextWorkspace: replaceTable(workspace, tableIndex, nextTable), response: success(request, {
      rows: created.map(row => formatRow(nextTable, row)), toIndex: position.index
    }, effects({ rowsCreated: created.length, rowsAffected: created.length, cellsAffected: cellCount })) };
  }

  if (action === 'row.delete') {
    const rowIds = Array.isArray(request.params.rowIds) ? request.params.rowIds.map(String) : [];
    if (!rowIds.length || rowIds.length > 500) return { response: failure(request, 'INVALID_REQUEST', 'rowIds must contain 1-500 IDs') };
    const missing = rowIds.filter(id => !rowById(table, id));
    if (missing.length) return { response: failure(request, 'ROW_NOT_FOUND', 'One or more rows do not exist', { rowIds: missing }) };
    const removed = new Set(rowIds);
    const records = table.data.records.filter(row => !removed.has(row.id));
    const cellLinks = Object.fromEntries(Object.entries(table.data.cellLinks || {}).filter(([key]) => !rowIds.some(id => key.startsWith(`${id}-`))));
    const nextTable = { ...table, data: { ...table.data, records, cellLinks } };
    const cellsAffected = table.data.records.filter(row => removed.has(row.id)).reduce((sum, row) => sum + Object.keys(row).filter(key => key !== 'id' && !isEmptyValue(row[key])).length, 0);
    return { nextWorkspace: replaceTable(workspace, tableIndex, nextTable), response: success(request, { deletedRowIds: rowIds }, effects({ rowsAffected: rowIds.length, cellsAffected })) };
  }

  if (action === 'row.reorder') {
    const rowIds = Array.isArray(request.params.rowIds) ? request.params.rowIds.map(String) : [];
    if (!rowIds.length || new Set(rowIds).size !== rowIds.length) return { response: failure(request, 'INVALID_REQUEST', 'rowIds must be a non-empty unique list') };
    const missing = rowIds.filter(id => !rowById(table, id));
    if (missing.length) return { response: failure(request, 'ROW_NOT_FOUND', 'One or more rows do not exist', { rowIds: missing }) };
    const toIndex = Number(request.params.toIndex);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > table.data.records.length - rowIds.length) return { response: failure(request, 'INVALID_REQUEST', `toIndex must be between 0 and ${table.data.records.length - rowIds.length}`) };
    const selected = rowIds.map(id => rowById(table, id));
    const records = table.data.records.filter(row => !rowIds.includes(row.id));
    records.splice(toIndex, 0, ...selected);
    const nextTable = { ...table, data: { ...table.data, records } };
    return { nextWorkspace: replaceTable(workspace, tableIndex, nextTable), response: success(request, { rowIds, toIndex, order: records.map(row => row.id) }, effects({ rowsAffected: rowIds.length })) };
  }

  if (action === 'cell.clear' || action === 'cell.fill') {
    const cells = action === 'cell.fill'
      ? (Array.isArray(request.params.rowIds) ? request.params.rowIds.map(rowId => ({ rowId: String(rowId), fieldId: String(request.params.fieldId || '') })) : [])
      : (Array.isArray(request.params.cells) ? request.params.cells : []);
    if (!cells.length || cells.length > 2000) return { response: failure(request, 'INVALID_REQUEST', `${action} targets must contain 1-2000 cells`) };
    let currentTable = table;
    const changed = new Map();
    for (const cell of cells) {
      const result = writeCell(currentTable, String(cell.rowId || ''), String(cell.fieldId || ''), action === 'cell.clear' ? null : request.params.value, 'replace');
      if (result.error) return { response: failure(request, result.error[0], result.error[1], { rowId: cell.rowId, fieldId: cell.fieldId }) };
      currentTable = result.table;
      result.changedCells.forEach(item => changed.set(`${item.rowId}:${item.fieldId}`, item));
    }
    const changedCells = [...changed.values()];
    return { nextWorkspace: replaceTable(workspace, tableIndex, currentTable), response: success(request, { changedCells }, effects({
      rowsAffected: new Set(changedCells.map(item => item.rowId)).size, cellsAffected: changedCells.length
    })) };
  }

  if (action === 'cell.copy_range') {
    const source = request.params.source;
    const target = request.params.target;
    if (!isObject(source) || !isObject(target) || !Array.isArray(source.rowIds) || !Array.isArray(source.fieldIds) || !Array.isArray(target.rowIds) || !Array.isArray(target.fieldIds)) {
      return { response: failure(request, 'INVALID_REQUEST', 'source/target require rowIds[] and fieldIds[]') };
    }
    const sourceCells = source.rowIds.flatMap(rowId => source.fieldIds.map(fieldId => ({ rowId: String(rowId), fieldId: String(fieldId) })));
    const targetCells = target.rowIds.flatMap(rowId => target.fieldIds.map(fieldId => ({ rowId: String(rowId), fieldId: String(fieldId) })));
    if (!sourceCells.length || !targetCells.length || (sourceCells.length !== 1 && sourceCells.length !== targetCells.length)) {
      return { response: failure(request, 'INVALID_REQUEST', 'Source range must contain one cell or match the target cell count') };
    }
    const sourceValues = [];
    for (const cell of sourceCells) {
      const row = rowById(table, cell.rowId); const field = fieldById(table, cell.fieldId);
      if (!row) return { response: failure(request, 'ROW_NOT_FOUND', `Row not found: ${cell.rowId}`) };
      if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${cell.fieldId}`) };
      sourceValues.push(clone(row[cell.fieldId]));
    }
    let currentTable = table;
    const changed = new Map();
    for (let index = 0; index < targetCells.length; index += 1) {
      const cell = targetCells[index];
      const result = writeCell(currentTable, cell.rowId, cell.fieldId, sourceValues[sourceValues.length === 1 ? 0 : index], 'replace');
      if (result.error) return { response: failure(request, result.error[0], result.error[1], { rowId: cell.rowId, fieldId: cell.fieldId }) };
      currentTable = result.table;
      result.changedCells.forEach(item => changed.set(`${item.rowId}:${item.fieldId}`, item));
    }
    const changedCells = [...changed.values()];
    return { nextWorkspace: replaceTable(workspace, tableIndex, currentTable), response: success(request, { changedCells }, effects({
      rowsAffected: new Set(changedCells.map(item => item.rowId)).size, cellsAffected: changedCells.length
    })) };
  }

  if (['media.remove', 'media.reorder', 'media.set_crop', 'media.clear_crop', 'media.set_trim', 'media.clear_trim', 'media.set_rating'].includes(action)) {
    const located = mediaCellWithIndex(request, table);
    if (located.error) return { response: located.error };
    const items = located.items.map(item => clone(item));
    if (action === 'media.remove') items.splice(located.index, 1);
    else if (action === 'media.reorder') {
      const toIndex = Number(request.params.toIndex);
      if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= items.length) return { response: failure(request, 'INVALID_REQUEST', `toIndex must be between 0 and ${items.length - 1}`) };
      const [item] = items.splice(located.index, 1); items.splice(toIndex, 0, item);
    } else if (action === 'media.set_crop') {
      const crop = request.params.crop;
      if (!isObject(crop) || crop.unit !== 'ratio' || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(Number(crop[key])))) {
        return { response: failure(request, 'INVALID_REQUEST', 'crop requires ratio x/y/width/height') };
      }
      const normalized = { x: Number(crop.x), y: Number(crop.y), width: Number(crop.width), height: Number(crop.height), unit: 'ratio' };
      if (normalized.x < 0 || normalized.y < 0 || normalized.width <= 0 || normalized.height <= 0 || normalized.x + normalized.width > 1 || normalized.y + normalized.height > 1) {
        return { response: failure(request, 'INVALID_REQUEST', 'Crop ratio must stay inside the source media bounds') };
      }
      items[located.index].cropData = normalized;
    } else if (action === 'media.clear_crop') delete items[located.index].cropData;
    else if (action === 'media.set_trim') {
      const startMs = Number(request.params.startMs); const endMs = Number(request.params.endMs); const durationMs = request.params.durationMs === undefined ? null : Number(request.params.durationMs);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || (Number.isFinite(durationMs) && endMs > durationMs)) {
        return { response: failure(request, 'INVALID_REQUEST', 'Trim requires 0 <= startMs < endMs <= durationMs (when supplied)') };
      }
      items[located.index].trimData = { startMs, endMs };
    } else if (action === 'media.clear_trim') delete items[located.index].trimData;
    else if (action === 'media.set_rating') {
      const rating = Number(request.params.rating);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5) return { response: failure(request, 'INVALID_REQUEST', 'rating must be between 0 and 5') };
      items[located.index].rating = rating;
    }
    const nextWorkspace = writeMediaItems(workspace, table, tableIndex, located.rowId, located.field, items);
    return { nextWorkspace, response: success(request, {
      rowId: located.rowId, fieldId: located.fieldId, index: located.index,
      items: items.map((item, index) => makeMediaInstance(table.id, located.rowId, located.field, item, index))
    }, effects({ rowsAffected: 1, cellsAffected: 1, mediaAffected: 1 })) };
  }

  if (action === 'media.move') {
    const source = isObject(request.params.source) ? request.params.source : {};
    const target = isObject(request.params.target) ? request.params.target : {};
    const sourceRequest = { ...request, params: { ...request.params, rowId: source.rowId, fieldId: source.fieldId, index: source.index ?? 0 } };
    const located = mediaCellWithIndex(sourceRequest, table);
    if (located.error) return { response: located.error };
    const targetCell = getMediaCell(table, String(target.rowId || ''), String(target.fieldId || ''));
    if (targetCell.error) return { response: failure(request, targetCell.error[0], targetCell.error[1], targetCell.error[2] || target) };
    if (located.rowId === String(target.rowId) && located.fieldId === String(target.fieldId)) return { response: failure(request, 'INVALID_REQUEST', 'Use media.reorder when source and target are the same cell') };
    const sourceItems = located.items.map(item => clone(item));
    const [moved] = sourceItems.splice(located.index, 1);
    const targetItems = targetCell.items.map(item => clone(item));
    const toIndex = target.index === undefined ? targetItems.length : Number(target.index);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > targetItems.length) return { response: failure(request, 'INVALID_REQUEST', `target.index must be between 0 and ${targetItems.length}`) };
    targetItems.splice(toIndex, 0, moved);
    let nextWorkspace = writeMediaItems(workspace, table, tableIndex, located.rowId, located.field, sourceItems);
    const updatedTable = findTable(nextWorkspace, table.id);
    nextWorkspace = writeMediaItems(nextWorkspace, updatedTable, tableIndex, String(target.rowId), targetCell.field, targetItems);
    return { nextWorkspace, response: success(request, { source, target: { ...target, index: toIndex } }, effects({ rowsAffected: located.rowId === target.rowId ? 1 : 2, cellsAffected: 2, mediaAffected: 1 })) };
  }

  if (action === 'generation.preview' || action === 'generation.run') {
    if (table.id !== workspace.activeTableId) {
      return { response: failure(request, 'TABLE_NOT_ACTIVE', 'Phase 3 generation runtime currently requires the target table to be the active table in AI Table Studio.', { tableId: table.id, activeTableId: workspace.activeTableId }, true) };
    }
    const fieldId = String(request.params.fieldId || '');
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    if (!['aiText', 'aiImage', 'aiVideo'].includes(field.type)) {
      return { response: failure(request, 'INVALID_FIELD_TYPE', `generation actions require aiText / aiImage / aiVideo: ${field.name}`, { fieldType: field.type }) };
    }
    const rowIds = Array.isArray(request.params.rowIds) ? request.params.rowIds.map(String) : [];
    if (rowIds.length < 1 || rowIds.length > 500) {
      return { response: failure(request, 'INVALID_REQUEST', 'rowIds must contain 1-500 row IDs') };
    }
    const missingRows = rowIds.filter(id => !rowById(table, id));
    if (missingRows.length) return { response: failure(request, 'ROW_NOT_FOUND', 'One or more rows do not exist', { rowIds: missingRows }) };
    const mode = request.params.mode || 'missing_only';
    if (!['missing_only', 'force'].includes(mode)) {
      return { response: failure(request, 'INVALID_REQUEST', `Unsupported generation mode: ${mode}`) };
    }
    if (action === 'generation.run') {
      const key = String(request.params.idempotencyKey || '').trim();
      if (key.length < 8 || key.length > 200) {
        return { response: failure(request, 'INVALID_REQUEST', 'generation.run requires idempotencyKey with 8-200 characters') };
      }
    }
    return {
      response: success(request, {
        runtimeRequired: true,
        runtimeAction: action,
        params: { ...clone(request.params), tableId: table.id, fieldId, rowIds, mode }
      }, effects({ rowsAffected: rowIds.length }))
    };
  }


  if (action === 'cell.get_meta') {
    const rowId = String(request.params.rowId || '');
    const fieldId = String(request.params.fieldId || '');
    const row = rowById(table, rowId);
    if (!row) return { response: failure(request, 'ROW_NOT_FOUND', `Row not found: ${rowId}`) };
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    const key = `${rowId}-${fieldId}`;
    const groupId = table.data.cellLinks?.[key] || null;
    const linkedCells = groupId
      ? Object.entries(table.data.cellLinks || {}).filter(([, value]) => value === groupId).map(([cellKey]) => {
          const suffix = `-${fieldId}`;
          return { rowId: cellKey.endsWith(suffix) ? cellKey.slice(0, -suffix.length) : cellKey.split('-')[0], fieldId };
        })
      : [];
    return { response: success(request, {
      rowId, fieldId, linked: !!groupId, linkGroupId: groupId, linkedCells,
      valueEmpty: isEmptyValue(row[fieldId])
    }) };
  }

  if (action === 'cell.link') {
    const cells = Array.isArray(request.params.cells) ? request.params.cells : [];
    if (cells.length < 2 || cells.length > 500) return { response: failure(request, 'INVALID_REQUEST', 'cells must contain 2-500 cells') };
    const normalized = [];
    for (const cell of cells) {
      const rowId = String(cell?.rowId || '');
      const fieldId = String(cell?.fieldId || '');
      if (!rowById(table, rowId)) return { response: failure(request, 'ROW_NOT_FOUND', `Row not found: ${rowId}`) };
      if (!fieldById(table, fieldId)) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
      normalized.push({ rowId, fieldId });
    }
    const fieldIds = new Set(normalized.map(cell => cell.fieldId));
    if (fieldIds.size !== 1) return { response: failure(request, 'INVALID_REQUEST', 'cell.link currently mirrors the UI vertical-link behavior and requires all cells to use the same fieldId') };
    const groupId = makeId('group');
    const master = normalized[0];
    const masterRow = rowById(table, master.rowId);
    const masterValue = clone(masterRow?.[master.fieldId]);
    let nextTable = { ...table, data: { ...table.data, cellLinks: { ...(table.data.cellLinks || {}) } } };
    const links = { ...(nextTable.data.cellLinks || {}) };
    normalized.forEach(cell => { links[`${cell.rowId}-${cell.fieldId}`] = groupId; });
    nextTable = { ...nextTable, data: { ...nextTable.data, cellLinks: links } };
    let changedCells = 0;
    for (let index = 1; index < normalized.length; index += 1) {
      const cell = normalized[index];
      const result = writeCell(nextTable, cell.rowId, cell.fieldId, masterValue, 'replace');
      if (result.error) return { response: failure(request, result.error[0], result.error[1], { rowId: cell.rowId, fieldId: cell.fieldId }) };
      nextTable = result.table;
      changedCells += result.changedCells.length;
    }
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { groupId, cells: normalized, master, masterValue }, effects({ rowsAffected: normalized.length, cellsAffected: changedCells }))
    };
  }

  if (action === 'cell.unlink') {
    const cells = Array.isArray(request.params.cells) ? request.params.cells : [];
    if (cells.length < 1 || cells.length > 500) return { response: failure(request, 'INVALID_REQUEST', 'cells must contain 1-500 cells') };
    const links = { ...(table.data.cellLinks || {}) };
    const removed = [];
    for (const cell of cells) {
      const rowId = String(cell?.rowId || '');
      const fieldId = String(cell?.fieldId || '');
      if (!rowById(table, rowId)) return { response: failure(request, 'ROW_NOT_FOUND', `Row not found: ${rowId}`) };
      if (!fieldById(table, fieldId)) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
      const key = `${rowId}-${fieldId}`;
      if (links[key]) {
        removed.push({ rowId, fieldId, groupId: links[key] });
        delete links[key];
      }
    }
    const nextTable = { ...table, data: { ...table.data, cellLinks: links } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { removed, unchanged: cells.length - removed.length }, effects({ cellsAffected: removed.length }))
    };
  }

  if (action === 'media.get') {
    const rowId = String(request.params.rowId || '');
    const fieldId = String(request.params.fieldId || '');
    const cell = getMediaCell(table, rowId, fieldId);
    if (cell.error) return { response: failure(request, cell.error[0], cell.error[1], cell.error[2] || { rowId, fieldId }) };
    return {
      response: success(request, {
        field: { id: cell.field.id, name: cell.field.name, type: cell.field.type },
        rowId,
        items: cell.items.map((item, index) => makeMediaInstance(table.id, rowId, cell.field, item, index))
      })
    };
  }

  if (action === 'media.list_by_row') {
    const rowId = String(request.params.rowId || '');
    const row = rowById(table, rowId);
    if (!row) return { response: failure(request, 'ROW_NOT_FOUND', `Row not found: ${rowId}`) };
    const requestedFieldIds = Array.isArray(request.params.fieldIds) ? request.params.fieldIds.map(String) : null;
    const fields = table.data.fields.filter(field => MEDIA_FIELD_TYPES.has(field.type) && (!requestedFieldIds || requestedFieldIds.includes(field.id)));
    if (requestedFieldIds) {
      const missing = requestedFieldIds.filter(id => !fieldById(table, id));
      if (missing.length) return { response: failure(request, 'FIELD_NOT_FOUND', 'One or more fields do not exist', { fieldIds: missing }) };
    }
    const groups = fields.map(field => {
      const items = normalizeMediaItems(row[field.id], field.type);
      return {
        field: { id: field.id, name: field.name, type: field.type },
        items: items.map((item, index) => makeMediaInstance(table.id, rowId, field, item, index))
      };
    }).filter(group => group.items.length > 0 || request.params.includeEmpty === true);
    return { response: success(request, { rowId, fields: groups }) };
  }

  if (action === 'media.get_effective_context') {
    const rowId = String(request.params.rowId || '');
    const fieldId = String(request.params.fieldId || '');
    const targetField = fieldById(table, fieldId);
    if (!targetField) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    if (!SMART_FIELD_TYPES.has(targetField.type) && targetField.type !== 'text') {
      return { response: failure(request, 'INVALID_FIELD_TYPE', `Effective media context is only available for text / smart fields: ${targetField.name}`, { fieldType: targetField.type }) };
    }
    const row = rowById(table, rowId);
    if (!row) return { response: failure(request, 'ROW_NOT_FOUND', `Row not found: ${rowId}`) };
    const temporaryReferenceFieldId = request.params.temporaryReferenceFieldId ? String(request.params.temporaryReferenceFieldId) : null;
    if (temporaryReferenceFieldId) {
      const temp = fieldById(table, temporaryReferenceFieldId);
      if (!temp) return { response: failure(request, 'FIELD_NOT_FOUND', `Temporary reference field not found: ${temporaryReferenceFieldId}`) };
      if (!SMART_FIELD_TYPES.has(temp.type)) {
        return { response: failure(request, 'INVALID_FIELD_TYPE', 'temporaryReferenceFieldId must point to aiText / aiImage / aiVideo') };
      }
    }
    const resolved = resolveEffectiveMediaContext(table, row, targetField, temporaryReferenceFieldId);
    return {
      response: success(request, {
        rowId,
        targetField: { id: targetField.id, name: targetField.name, type: targetField.type },
        sourceField: resolved.sourceField,
        temporaryReferenceFieldId,
        items: resolved.items
      }, effects(), { warnings: resolved.items.length ? [] : ['No effective media references were resolved for this row.'] })
    };
  }

  if (action === 'media.attach') {
    const rowId = String(request.params.rowId || '');
    const fieldId = String(request.params.fieldId || '');
    const mode = request.params.mode || 'append';
    if (!['append', 'replace'].includes(mode)) return { response: failure(request, 'INVALID_REQUEST', `Invalid media attach mode: ${mode}`) };
    const cell = getMediaCell(table, rowId, fieldId);
    if (cell.error) return { response: failure(request, cell.error[0], cell.error[1], cell.error[2] || { rowId, fieldId }) };
    if (cell.field.type === 'url' && mode === 'append') {
      return { response: failure(request, 'INVALID_FIELD_TYPE', 'URL fields do not support append media mode; use replace.') };
    }
    const inputs = request.params.items;
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 50) {
      return { response: failure(request, 'INVALID_REQUEST', 'items must contain 1-50 media paths') };
    }
    const incoming = [];
    for (const raw of inputs) {
      if (!isObject(raw)) return { response: failure(request, 'INVALID_REQUEST', 'Each media item must be an object') };
      const url = String(raw.path || raw.url || '').trim();
      if (!url) return { response: failure(request, 'INVALID_REQUEST', 'Each media item requires path or url') };
      const requestedType = raw.type ? String(raw.type) : null;
      if (requestedType && !['image', 'video', 'audio'].includes(requestedType)) {
        return { response: failure(request, 'INVALID_REQUEST', `Unsupported media type: ${requestedType}`) };
      }
      // Phase 2 deliberately does not accept cropData / trimData here. Existing edited instances
      // should be transferred with media.copy_instance so all current metadata survives unchanged.
      if ('cropData' in raw || 'trimData' in raw || 'item' in raw) {
        return { response: failure(request, 'INVALID_REQUEST', 'media.attach does not accept cropData/trimData; use media.copy_instance for edited media instances') };
      }
      const item = { url };
      if (raw.name) item.name = String(raw.name);
      if (raw.mimeType) item.type = String(raw.mimeType);
      else if (requestedType) item.mediaType = requestedType;
      incoming.push(item);
    }
    const nextItems = mode === 'replace' ? incoming : [...cell.items, ...incoming];
    const nextValue = mediaValueFromItems(cell.field, nextItems);
    const writeResult = writeCell(table, rowId, fieldId, nextValue, 'replace');
    if (writeResult.error) return { response: failure(request, writeResult.error[0], writeResult.error[1], { rowId, fieldId }) };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = writeResult.table;
    const updatedRow = rowById(writeResult.table, rowId);
    const savedItems = normalizeMediaItems(updatedRow?.[fieldId], cell.field.type);
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, {
        rowId,
        fieldId,
        mode,
        items: savedItems.map((item, index) => makeMediaInstance(table.id, rowId, cell.field, item, index))
      }, mediaEffects(writeResult.changedCells.length))
    };
  }

  if (action === 'media.copy_instance') {
    const source = isObject(request.params.source) ? request.params.source : {};
    const target = isObject(request.params.target) ? request.params.target : {};
    const sourceRowId = String(source.rowId || '');
    const sourceFieldId = String(source.fieldId || '');
    const sourceCell = getMediaCell(table, sourceRowId, sourceFieldId);
    if (sourceCell.error) return { response: failure(request, sourceCell.error[0], sourceCell.error[1], sourceCell.error[2] || { rowId: sourceRowId, fieldId: sourceFieldId }) };
    let sourceIndex = Number.isInteger(source.index) ? Number(source.index) : null;
    if (sourceIndex === null && source.mediaInstanceId) {
      const parts = String(source.mediaInstanceId).split(':');
      const parsed = Number(parts[parts.length - 1]);
      if (Number.isInteger(parsed)) sourceIndex = parsed;
    }
    if (sourceIndex === null || sourceIndex < 0 || sourceIndex >= sourceCell.items.length) {
      return { response: failure(request, 'MEDIA_NOT_FOUND', 'Source media instance not found', { source }) };
    }
    const targetRowId = String(target.rowId || '');
    const targetFieldId = String(target.fieldId || '');
    const targetCell = getMediaCell(table, targetRowId, targetFieldId);
    if (targetCell.error) return { response: failure(request, targetCell.error[0], targetCell.error[1], targetCell.error[2] || { rowId: targetRowId, fieldId: targetFieldId }) };
    if (targetCell.field.type === 'url') {
      return { response: failure(request, 'INVALID_FIELD_TYPE', 'media.copy_instance cannot preserve edited media metadata in a URL field') };
    }
    const mode = request.params.mode || 'append';
    if (!['append', 'replace'].includes(mode)) return { response: failure(request, 'INVALID_REQUEST', `Invalid media copy mode: ${mode}`) };
    const copiedItem = stripPreviewOnlyMediaProps(sourceCell.items[sourceIndex]);
    const nextItems = mode === 'replace' ? [clone(copiedItem)] : [...targetCell.items, clone(copiedItem)];
    const nextValue = mediaValueFromItems(targetCell.field, nextItems);
    const writeResult = writeCell(table, targetRowId, targetFieldId, nextValue, 'replace');
    if (writeResult.error) return { response: failure(request, writeResult.error[0], writeResult.error[1], { rowId: targetRowId, fieldId: targetFieldId }) };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = writeResult.table;
    const updatedRow = rowById(writeResult.table, targetRowId);
    const savedItems = normalizeMediaItems(updatedRow?.[targetFieldId], targetCell.field.type);
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, {
        source: makeMediaInstance(table.id, sourceRowId, sourceCell.field, copiedItem, sourceIndex),
        target: {
          rowId: targetRowId,
          fieldId: targetFieldId,
          items: savedItems.map((item, index) => makeMediaInstance(table.id, targetRowId, targetCell.field, item, index))
        }
      }, mediaEffects(writeResult.changedCells.length))
    };
  }

  if (action === 'field.create') {
    const name = String(request.params.name || '').trim();
    const type = String(request.params.type || '');
    if (!name) return { response: failure(request, 'INVALID_REQUEST', 'name is required') };
    if (!FIELD_TYPES.includes(type)) return { response: failure(request, 'INVALID_FIELD_TYPE', `Unsupported field type: ${type}`) };
    if (table.data.fields.some(f => String(f.name).trim().toLowerCase() === name.toLowerCase())) {
      return { response: failure(request, 'WRITE_CONFLICT', `Field name already exists: ${name}`) };
    }
    const config = isObject(request.params.config) ? clone(request.params.config) : {};
    delete config.id; delete config.name; delete config.type;
    const fieldId = String(request.params.fieldId || '').trim() || makeId('fld');
    if (table.data.fields.some(f => f.id === fieldId)) return { response: failure(request, 'WRITE_CONFLICT', `Field ID already exists: ${fieldId}`) };
    const field = { ...config, id: fieldId, name, type };
    if (field.width === undefined) field.width = 150;
    if ((type === 'singleSelect' || type === 'multiSelect') && !Array.isArray(field.options)) field.options = [];
    const nextTable = { ...table, data: { ...table.data, fields: [...table.data.fields, field] } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return { nextWorkspace: { ...workspace, tables: nextTables }, response: success(request, { field: clone(field) }, effects({ fieldsCreated: 1, fieldsAffected: 1 })) };
  }

  if (action === 'field.update') {
    const fieldId = String(request.params.fieldId || '');
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    if (!isObject(request.params.patch) || Object.keys(request.params.patch).length === 0) {
      return { response: failure(request, 'INVALID_REQUEST', 'patch must be a non-empty object') };
    }
    if ('id' in request.params.patch) return { response: failure(request, 'INVALID_FIELD_CONFIG', 'field id cannot be changed') };
    if ('type' in request.params.patch && request.params.patch.type !== field.type) {
      return { response: failure(request, 'INVALID_FIELD_CONFIG', 'Changing field type is not available in the Agent API exploration branch; create a new field or use the UI conversion flow.') };
    }
    const patch = clone(request.params.patch);
    const commonAllowed = new Set(['name', 'width', 'hidden', 'color', 'prompt', 'refFields', 'type']);
    const unknown = Object.keys(patch).filter(key => !commonAllowed.has(key));
    if (unknown.length) {
      const aiKeys = unknown.filter(key => ['aiTextConfig', 'aiImageConfig', 'aiVideoConfig'].includes(key));
      return { response: failure(request, 'INVALID_FIELD_CONFIG', aiKeys.length
        ? 'Direct AI config patching is disabled in Phase 3.5. Use field.configure_ai.'
        : `Unsupported field.update keys: ${unknown.join(', ')}`, { keys: unknown }) };
    }
    delete patch.type;
    if (['aiText', 'aiImage', 'aiVideo'].includes(field.type) && ('prompt' in patch || 'refFields' in patch)) {
      return { response: failure(request, 'INVALID_FIELD_CONFIG', 'AI prompt/reference configuration must use field.configure_ai in Phase 3.5.') };
    }
    if ('width' in patch) {
      const width = Number(patch.width);
      if (!Number.isFinite(width) || width < 60 || width > 2000) return { response: failure(request, 'INVALID_FIELD_CONFIG', 'width must be between 60 and 2000') };
      patch.width = width;
    }
    if ('hidden' in patch) patch.hidden = patch.hidden === true;
    if ('refFields' in patch) {
      if (!Array.isArray(patch.refFields)) return { response: failure(request, 'INVALID_FIELD_CONFIG', 'refFields must be an array') };
      patch.refFields = patch.refFields.map(String);
      const missingRefs = validateRefFields(table, patch.refFields);
      if (missingRefs) return { response: failure(request, 'FIELD_NOT_FOUND', 'One or more refFields do not exist', { fieldIds: missingRefs }) };
    }
    let fields = table.data.fields;
    if (typeof patch.name === 'string') {
      const newName = patch.name.trim();
      if (!newName) return { response: failure(request, 'INVALID_FIELD_CONFIG', 'Field name cannot be empty') };
      if (fields.some(f => f.id !== fieldId && String(f.name).trim().toLowerCase() === newName.toLowerCase())) {
        return { response: failure(request, 'WRITE_CONFLICT', `Field name already exists: ${newName}`) };
      }
      fields = renameReferences(fields, fieldId, field.name, newName);
      delete patch.name;
    } else {
      fields = fields.map(f => ({ ...f }));
    }
    fields = fields.map(f => f.id === fieldId ? { ...f, ...patch } : f);
    const nextTable = { ...table, data: { ...table.data, fields } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return { nextWorkspace: { ...workspace, tables: nextTables }, response: success(request, { field: clone(fieldById(nextTable, fieldId)) }, effects()) };
  }



  if (action === 'field.duplicate') {
    const fieldId = String(request.params.fieldId || '');
    const source = fieldById(table, fieldId);
    if (!source) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    const sourceIndex = table.data.fields.findIndex(field => field.id === fieldId);
    const requestedName = String(request.params.name || '').trim();
    const name = requestedName || uniqueFieldName(table, `${source.name} 副本`);
    if (table.data.fields.some(field => String(field.name).trim().toLowerCase() === name.toLowerCase())) {
      return { response: failure(request, 'WRITE_CONFLICT', `Field name already exists: ${name}`) };
    }
    const newFieldId = String(request.params.newFieldId || '').trim() || makeId('fld');
    if (table.data.fields.some(field => field.id === newFieldId)) return { response: failure(request, 'WRITE_CONFLICT', `Field ID already exists: ${newFieldId}`) };
    const newField = { ...clone(source), id: newFieldId, name };
    const nextFields = [...table.data.fields];
    let insertIndex = sourceIndex + 1;
    if (request.params.beforeFieldId) {
      const idx = nextFields.findIndex(field => field.id === String(request.params.beforeFieldId));
      if (idx < 0) return { response: failure(request, 'FIELD_NOT_FOUND', `beforeFieldId not found: ${request.params.beforeFieldId}`) };
      insertIndex = idx;
    } else if (request.params.afterFieldId) {
      const idx = nextFields.findIndex(field => field.id === String(request.params.afterFieldId));
      if (idx < 0) return { response: failure(request, 'FIELD_NOT_FOUND', `afterFieldId not found: ${request.params.afterFieldId}`) };
      insertIndex = idx + 1;
    }
    nextFields.splice(insertIndex, 0, newField);
    const copyValues = request.params.copyValues !== false;
    const copyCellLinks = copyValues && request.params.copyCellLinks !== false;
    const nextRecords = table.data.records.map(row => {
      if (!copyValues) return { ...row };
      return { ...row, [newFieldId]: clone(row[fieldId]) };
    });
    let nextCellLinks = { ...(table.data.cellLinks || {}) };
    if (copyCellLinks) {
      for (const row of table.data.records) {
        const groupId = table.data.cellLinks?.[`${row.id}-${fieldId}`];
        if (groupId) nextCellLinks[`${row.id}-${newFieldId}`] = groupId;
      }
    }
    const nextTable = { ...table, data: { ...table.data, fields: nextFields, records: nextRecords, cellLinks: nextCellLinks } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, {
        sourceFieldId: fieldId,
        field: clone(newField),
        copyValues,
        copyCellLinks,
        insertedIndex: insertIndex
      }, effects({ fieldsCreated: 1, rowsAffected: copyValues ? nextRecords.length : 0, cellsAffected: copyValues ? nextRecords.length : 0 }))
    };
  }

  if (action.startsWith('field.options.')) {
    const fieldId = String(request.params.fieldId || '');
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    if (!normalizeSelectField(field)) return { response: failure(request, 'INVALID_FIELD_TYPE', `Select options are only available for singleSelect / multiSelect: ${field.name}`) };
    const options = clone(field.options || []);
    if (action === 'field.options.get') {
      return { response: success(request, { field: { id: field.id, name: field.name, type: field.type }, options }) };
    }
    let nextOptions = options;
    let nextRecords = table.data.records.map(row => ({ ...row }));
    let affectedRows = 0;

    if (action === 'field.options.upsert') {
      const items = Array.isArray(request.params.options) ? request.params.options : [];
      if (items.length < 1 || items.length > 100) return { response: failure(request, 'INVALID_REQUEST', 'options must contain 1-100 items') };
      for (const raw of items) {
        if (!isObject(raw) || !String(raw.name || '').trim()) return { response: failure(request, 'INVALID_REQUEST', 'Each option requires name') };
        const name = String(raw.name).trim();
        const byId = raw.id ? nextOptions.find(option => option.id === String(raw.id)) : null;
        const byName = nextOptions.find(option => String(option.name).trim().toLowerCase() === name.toLowerCase());
        const existing = byId || byName;
        if (existing) {
          existing.name = name;
          if (raw.color !== undefined) existing.color = String(raw.color || '');
        } else {
          nextOptions.push({
            id: raw.id ? String(raw.id) : makeId('opt'),
            name,
            color: raw.color ? String(raw.color) : DEFAULT_OPTION_COLORS[nextOptions.length % DEFAULT_OPTION_COLORS.length]
          });
        }
      }
    } else if (action === 'field.options.update') {
      const optionId = String(request.params.optionId || '');
      const option = nextOptions.find(item => item.id === optionId);
      if (!option) return { response: failure(request, 'OPTION_NOT_FOUND', `Option not found: ${optionId}`) };
      if (request.params.name !== undefined) {
        const name = String(request.params.name || '').trim();
        if (!name) return { response: failure(request, 'INVALID_REQUEST', 'Option name cannot be empty') };
        if (nextOptions.some(item => item.id !== optionId && String(item.name).trim().toLowerCase() === name.toLowerCase())) {
          return { response: failure(request, 'WRITE_CONFLICT', `Option name already exists: ${name}`) };
        }
        option.name = name;
      }
      if (request.params.color !== undefined) option.color = String(request.params.color || '');
    } else if (action === 'field.options.remove') {
      const optionId = String(request.params.optionId || '');
      const option = nextOptions.find(item => item.id === optionId);
      if (!option) return { response: failure(request, 'OPTION_NOT_FOUND', `Option not found: ${optionId}`) };
      const usedRows = optionUsage(table, field, optionId);
      if (usedRows.length && request.params.clearValues !== true) {
        return { response: failure(request, 'WRITE_CONFLICT', 'Option is still used by existing rows. Retry with clearValues=true after reviewing the impact.', { optionId, affectedRows: usedRows.length, rowIds: usedRows.slice(0, 100) }) };
      }
      if (usedRows.length) {
        const used = new Set(usedRows);
        nextRecords = nextRecords.map(row => {
          if (!used.has(row.id)) return row;
          affectedRows += 1;
          if (field.type === 'multiSelect') return { ...row, [fieldId]: (Array.isArray(row[fieldId]) ? row[fieldId] : []).filter(id => id !== optionId) };
          return { ...row, [fieldId]: null };
        });
      }
      nextOptions = nextOptions.filter(item => item.id !== optionId);
    } else if (action === 'field.options.reorder') {
      const optionId = String(request.params.optionId || '');
      const from = nextOptions.findIndex(item => item.id === optionId);
      if (from < 0) return { response: failure(request, 'OPTION_NOT_FOUND', `Option not found: ${optionId}`) };
      const toIndex = Number(request.params.toIndex);
      if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= nextOptions.length) return { response: failure(request, 'INVALID_REQUEST', `toIndex must be between 0 and ${Math.max(0, nextOptions.length - 1)}`) };
      const [item] = nextOptions.splice(from, 1);
      nextOptions.splice(toIndex, 0, item);
    }

    const nextFields = table.data.fields.map(item => item.id === fieldId ? { ...item, options: nextOptions } : item);
    const nextTable = { ...table, data: { ...table.data, fields: nextFields, records: nextRecords } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { fieldId, options: clone(nextOptions), affectedRows }, effects({ rowsAffected: affectedRows, cellsAffected: affectedRows }))
    };
  }

  if (action === 'field.configure_ai') {
    const fieldId = String(request.params.fieldId || '');
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
    const normalized = normalizeAiConfig(field, request.params.config);
    if (normalized.error) return { response: failure(request, 'INVALID_FIELD_CONFIG', normalized.error, { unknown: normalized.unknown || [] }) };
    if (normalized.patch.refFields) {
      const missing = validateRefFields(table, normalized.patch.refFields);
      if (missing) return { response: failure(request, 'FIELD_NOT_FOUND', 'One or more refFields do not exist', { fieldIds: missing }) };
    }
    const nextFields = table.data.fields.map(item => item.id === fieldId ? { ...item, ...normalized.patch } : item);
    const nextTable = { ...table, data: { ...table.data, fields: nextFields } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { field: clone(fieldById(nextTable, fieldId)), normalizedConfig: clone(request.params.config) })
    };
  }

  if (action === 'field.reorder') {
    const fieldId = String(request.params.fieldId || '');
    const field = fieldById(table, fieldId);
    if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };

    const hasBefore = request.params.beforeFieldId !== undefined && request.params.beforeFieldId !== null && String(request.params.beforeFieldId) !== '';
    const hasAfter = request.params.afterFieldId !== undefined && request.params.afterFieldId !== null && String(request.params.afterFieldId) !== '';
    const hasIndex = request.params.toIndex !== undefined && request.params.toIndex !== null;
    const selectorCount = Number(hasBefore) + Number(hasAfter) + Number(hasIndex);
    if (selectorCount !== 1) {
      return { response: failure(request, 'INVALID_REQUEST', 'field.reorder requires exactly one of beforeFieldId, afterFieldId, or toIndex') };
    }

    const originalFields = table.data.fields;
    const fromIndex = originalFields.findIndex(f => f.id === fieldId);
    let nextFields = originalFields.filter(f => f.id !== fieldId);
    let toIndex = fromIndex;
    let anchorFieldId = null;
    let position = 'index';

    if (hasBefore || hasAfter) {
      anchorFieldId = String(hasBefore ? request.params.beforeFieldId : request.params.afterFieldId);
      if (anchorFieldId === fieldId) {
        return { response: failure(request, 'INVALID_REQUEST', 'A field cannot be reordered relative to itself', { fieldId }) };
      }
      const anchorIndex = nextFields.findIndex(f => f.id === anchorFieldId);
      if (anchorIndex === -1) {
        return { response: failure(request, 'FIELD_NOT_FOUND', `Target field not found: ${anchorFieldId}`, { fieldId: anchorFieldId }) };
      }
      position = hasBefore ? 'before' : 'after';
      toIndex = hasBefore ? anchorIndex : anchorIndex + 1;
    } else {
      const rawIndex = Number(request.params.toIndex);
      if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= originalFields.length) {
        return { response: failure(request, 'INVALID_REQUEST', `toIndex must be an integer between 0 and ${Math.max(0, originalFields.length - 1)}`) };
      }
      toIndex = Math.min(rawIndex, nextFields.length);
    }

    nextFields.splice(toIndex, 0, field);
    const finalIndex = nextFields.findIndex(f => f.id === fieldId);
    const changed = nextFields.some((f, index) => f.id !== originalFields[index]?.id);

    if (!changed) {
      return { response: success(request, {
        field: clone(field),
        fromIndex,
        toIndex: finalIndex,
        position,
        anchorFieldId,
        order: nextFields.map((f, index) => ({ index, id: f.id, name: f.name }))
      }, effects()) };
    }

    const nextTable = { ...table, data: { ...table.data, fields: nextFields } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, {
        field: clone(field),
        fromIndex,
        toIndex: finalIndex,
        position,
        anchorFieldId,
        order: nextFields.map((f, index) => ({ index, id: f.id, name: f.name }))
      }, effects({ fieldsReordered: 1 }))
    };
  }

  if (action === 'row.get') {
    const rowId = String(request.params.rowId || '');
    const row = rowById(table, rowId);
    if (!row) return { response: failure(request, 'ROW_NOT_FOUND', `Row not found: ${rowId}`) };
    return { response: success(request, { row: formatRow(table, row) }) };
  }

  if (action === 'row.query') {
    const requestedFields = request.params.fields;
    if (requestedFields !== undefined && !Array.isArray(requestedFields)) {
      return { response: failure(request, 'INVALID_REQUEST', 'fields must be an array') };
    }
    const fieldIds = Array.isArray(requestedFields) && requestedFields.length > 0 ? requestedFields.map(String) : null;
    if (fieldIds) {
      const missing = fieldIds.filter(id => !fieldById(table, id));
      if (missing.length) return { response: failure(request, 'FIELD_NOT_FOUND', 'One or more fields do not exist', { fieldIds: missing }) };
    }
    const requestedRowIds = request.params.rowIds;
    if (requestedRowIds !== undefined && !Array.isArray(requestedRowIds)) {
      return { response: failure(request, 'INVALID_REQUEST', 'rowIds must be an array') };
    }
    const rowIds = Array.isArray(requestedRowIds) ? requestedRowIds.map(String) : null;
    const scope = request.params.scope || 'all';
    if (!['all', 'current_view'].includes(scope)) return { response: failure(request, 'INVALID_REQUEST', `Unsupported row.query scope: ${scope}`) };
    const includeComputed = request.params.includeComputed === true;
    const limit = Math.max(1, Math.min(500, Number(request.params.limit) || 100));
    const offset = Math.max(0, Number.parseInt(String(request.params.cursor ?? '0'), 10) || 0);
    try {
      filterRows(table, [], request.params.filter);
      sortRows(table, [], request.params.sort);
    } catch (error) {
      return { response: failure(request, error?.code || 'INVALID_REQUEST', error?.message || String(error)) };
    }

    if (scope === 'current_view' || includeComputed) {
      if (table.id !== workspace.activeTableId) {
        return { response: failure(request, 'TABLE_NOT_ACTIVE', 'current_view/includeComputed requires the target table to be active.', { tableId: table.id, activeTableId: workspace.activeTableId }, true) };
      }
      return {
        response: success(request, {
          runtimeRequired: true,
          runtimeAction: 'row.query',
          params: {
            ...clone(request.params), tableId: table.id, fields: fieldIds, rowIds, scope, includeComputed, limit, cursor: String(offset)
          }
        })
      };
    }

    let matches = [...table.data.records];
    if (rowIds) {
      const wanted = new Set(rowIds);
      matches = matches.filter(row => wanted.has(row.id));
    }
    try {
      matches = filterRows(table, matches, request.params.filter);
      matches = sortRows(table, matches, request.params.sort);
    } catch (error) {
      return { response: failure(request, error?.code || 'INVALID_REQUEST', error?.message || String(error)) };
    }
    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      response: success(request, {
        rows: page.map(row => formatRow(table, row, fieldIds)),
        totalMatched: matches.length,
        scope,
        nextCursor: nextOffset < matches.length ? String(nextOffset) : null
      })
    };
  }

  if (action === 'row.create') {
    const rows = request.params.rows;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) {
      return { response: failure(request, 'INVALID_REQUEST', 'rows must contain 1-500 items') };
    }
    const created = [];
    let cellCount = 0;
    const reservedRowIds = new Set(table.data.records.map(row => row.id));
    for (const rowInput of rows) {
      if (!isObject(rowInput) || !isObject(rowInput.values || {})) return { response: failure(request, 'INVALID_REQUEST', 'Each row must contain values{}') };
      const rowId = String(rowInput.id || '').trim() || makeId('rec');
      if (reservedRowIds.has(rowId)) return { response: failure(request, 'WRITE_CONFLICT', `Row ID already exists: ${rowId}`) };
      reservedRowIds.add(rowId);
      const row = { id: rowId };
      for (const [fieldId, rawValue] of Object.entries(rowInput.values || {})) {
        const field = fieldById(table, fieldId);
        if (!field) return { response: failure(request, 'FIELD_NOT_FOUND', `Field not found: ${fieldId}`) };
        const validated = validateFieldValue(field, rawValue);
        if (!validated.ok) return { response: failure(request, 'INVALID_VALUE', validated.message, { fieldId }) };
        row[fieldId] = clone(validated.value);
        cellCount++;
      }
      created.push(row);
    }
    const nextTable = { ...table, data: { ...table.data, records: [...table.data.records, ...created] } };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = nextTable;
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { rows: created.map(row => formatRow(nextTable, row)) }, effects({ rowsCreated: created.length, rowsAffected: created.length, cellsAffected: cellCount }))
    };
  }

  if (action === 'cell.set') {
    const rowId = String(request.params.rowId || '');
    const fieldId = String(request.params.fieldId || '');
    if (!['replace', 'append', 'if_empty', undefined].includes(request.params.writeMode)) {
      return { response: failure(request, 'INVALID_REQUEST', `Invalid writeMode: ${request.params.writeMode}`) };
    }
    const result = writeCell(table, rowId, fieldId, request.params.value, request.params.writeMode || 'replace');
    if (result.error) return { response: failure(request, result.error[0], result.error[1], { rowId, fieldId }) };
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = result.table;
    const rowIds = Array.from(new Set(result.changedCells.map(c => c.rowId)));
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { changedCells: result.changedCells, skipped: !!result.skipped }, effects({ rowsAffected: rowIds.length, cellsAffected: result.changedCells.length }), { warnings: result.skipped ? ['No value changed.'] : [] })
    };
  }

  if (action === 'cell.batch_set') {
    const updates = request.params.updates;
    if (!Array.isArray(updates) || updates.length < 1 || updates.length > 2000) {
      return { response: failure(request, 'INVALID_REQUEST', 'updates must contain 1-2000 items') };
    }
    const writeMode = request.params.writeMode || 'replace';
    if (!['replace', 'append', 'if_empty'].includes(writeMode)) {
      return { response: failure(request, 'INVALID_REQUEST', `Invalid writeMode: ${writeMode}`) };
    }
    let currentTable = table;
    const changed = new Map();
    let skipped = 0;
    for (const update of updates) {
      const rowId = String(update?.rowId || '');
      const fieldId = String(update?.fieldId || '');
      const result = writeCell(currentTable, rowId, fieldId, update?.value, writeMode);
      if (result.error) return { response: failure(request, result.error[0], result.error[1], { rowId, fieldId }) };
      currentTable = result.table;
      if (result.skipped) skipped++;
      for (const cell of result.changedCells) changed.set(`${cell.rowId}::${cell.fieldId}`, cell);
    }
    const nextTables = [...workspace.tables]; nextTables[tableIndex] = currentTable;
    const changedCells = [...changed.values()];
    const rowIds = Array.from(new Set(changedCells.map(c => c.rowId)));
    return {
      nextWorkspace: { ...workspace, tables: nextTables },
      response: success(request, { changedCells, skippedUpdates: skipped }, effects({ rowsAffected: rowIds.length, cellsAffected: changedCells.length }))
    };
  }

  return { response: failure(request, 'INVALID_REQUEST', `Unhandled action: ${action}`) };
}

function actionNeedsConfirmation(request, workspace, result) {
  const meta = ACTION_META[request.action];
  if (!meta?.write) return false;
  if (meta.alwaysConfirm) return true;
  if (request.action === 'row.create') return (request.params.rows?.length || 0) > 20;
  if (request.action === 'cell.batch_set') {
    if ((request.params.updates?.length || 0) > 20) return true;
    const table = findTable(workspace, request.params.tableId);
    return (request.params.updates || []).some(update => {
      const row = table ? rowById(table, update.rowId) : null;
      return row && !isEmptyValue(row[update.fieldId]) && request.params.writeMode !== 'if_empty';
    });
  }
  if (request.action === 'cell.set') {
    const table = findTable(workspace, request.params.tableId);
    const row = table ? rowById(table, request.params.rowId) : null;
    return !!row && !isEmptyValue(row[request.params.fieldId]) && request.params.writeMode !== 'if_empty';
  }
  if (request.action === 'media.attach') {
    const table = findTable(workspace, request.params.tableId);
    const row = table ? rowById(table, request.params.rowId) : null;
    return request.params.mode === 'replace' && !!row && !isEmptyValue(row[request.params.fieldId]);
  }
  if (request.action === 'media.copy_instance') {
    const table = findTable(workspace, request.params.tableId);
    const target = request.params.target || {};
    const row = table ? rowById(table, target.rowId) : null;
    return request.params.mode === 'replace' && !!row && !isEmptyValue(row[target.fieldId]);
  }
  return false;
}

/**
 * Pure execution entry. It never mutates the supplied snapshot.
 * Renderer/Main/CLI may commit result.nextWorkspace after a successful response.
 */
export function executeTableActionRequest(rawRequest, rawSnapshot) {
  const normalized = normalizeRequest(rawRequest);
  if (normalized.error) {
    const request = isObject(rawRequest) ? rawRequest : { action: null };
    return { response: failure(request, normalized.error[0], normalized.error[1]) };
  }
  const request = normalized.request;

  let workspace;
  try { workspace = normalizeSnapshot(rawSnapshot); }
  catch (error) { return { response: failure(request, 'INTERNAL_ERROR', error.message || String(error), {}, false) }; }

  if (request.expectedRevision !== null) {
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) {
      const response = failure(request, 'INVALID_REQUEST', 'expectedRevision must be a non-negative integer');
      response.workspaceRevision = workspace.workspaceRevision;
      return { response };
    }
    if (request.expectedRevision !== workspace.workspaceRevision) {
      const response = failure(request, 'STALE_WORKSPACE', 'The workspace changed after this Agent read it. Refresh state and retry with the current revision.', {
        expectedRevision: request.expectedRevision,
        actualRevision: workspace.workspaceRevision
      }, true);
      response.workspaceRevision = workspace.workspaceRevision;
      return { response };
    }
  }

  let result;
  try { result = applyAction(request, workspace); }
  catch (error) {
    return { response: failure(request, 'INTERNAL_ERROR', error?.message || String(error), {}, false) };
  }
  if (!result.response?.ok) {
    result.response.workspaceRevision = workspace.workspaceRevision;
    return result;
  }

  const tablesChanged = !!result.nextWorkspace && JSON.stringify(result.nextWorkspace.tables) !== JSON.stringify(workspace.tables);
  const contextChanged = !!result.nextWorkspace && result.nextWorkspace.activeTableId !== workspace.activeTableId;
  const changed = tablesChanged || contextChanged;
  const runtimeWrite = !!ACTION_META[request.action]?.runtime && !!ACTION_META[request.action]?.write;
  const requiresConfirmation = (changed || runtimeWrite) && actionNeedsConfirmation(request, workspace, result);
  result.response.requiresConfirmation = requiresConfirmation;
  result.response.effects = effects(result.response.effects || {});
  result.response.effects.tablesAffected = Math.max(result.response.effects.tablesAffected, result.response.effects.tablesCreated);
  result.response.effects.fieldsAffected = Math.max(result.response.effects.fieldsAffected, result.response.effects.fieldsCreated + result.response.effects.fieldsReordered);

  if (request.dryRun) {
    result.response.data = { ...result.response.data, dryRun: true };
    result.response.undoToken = null;
    result.response.workspaceRevision = workspace.workspaceRevision;
    delete result.nextWorkspace;
    return result;
  }

  if (requiresConfirmation && !request.confirmed) {
    const response = failure(request, 'CONFIRMATION_REQUIRED', 'This action requires explicit confirmation before writing.', {
        permission: ACTION_META[request.action]?.permission,
        effects: result.response.effects
      });
    response.workspaceRevision = workspace.workspaceRevision;
    return { response };
  }

  if (changed) {
    result.nextWorkspace.workspaceRevision = workspace.workspaceRevision + 1;
    result.response.workspaceRevision = result.nextWorkspace.workspaceRevision;
  } else {
    result.response.workspaceRevision = workspace.workspaceRevision;
  }
  if (tablesChanged) result.response.undoToken = makeId('undo');
  else result.response.undoToken = null;
  if (!changed) delete result.nextWorkspace;
  return result;
}

export function createInMemoryWorkspace(snapshot) {
  let current = normalizeSnapshot(snapshot);
  const idempotency = new Map();
  return {
    getSnapshot: () => clone(current),
    execute: (request) => {
      const key = String(request?.idempotencyKey || request?.params?.idempotencyKey || '').trim();
      const fingerprint = JSON.stringify({ action: request?.action || null, params: request?.params || {} });
      if (key && idempotency.has(key)) {
        const stored = idempotency.get(key);
        if (stored.fingerprint !== fingerprint) {
          const response = failure(request, 'IDEMPOTENCY_CONFLICT', 'idempotencyKey was already used for a different action payload', { idempotencyKey: key });
          response.workspaceRevision = current.workspaceRevision;
          return response;
        }
        const replay = clone(stored.response);
        replay.data = { ...(replay.data || {}), idempotentReplay: true, originalWorkspaceRevision: replay.workspaceRevision };
        replay.workspaceRevision = current.workspaceRevision;
        return replay;
      }
      const result = executeTableActionRequest(request, current);
      if (result.response.ok && result.nextWorkspace) current = clone(result.nextWorkspace);
      if (key && result.response.ok && !request?.dryRun && ACTION_META[request?.action]?.write) {
        idempotency.set(key, { fingerprint, response: clone(result.response) });
      }
      return clone(result.response);
    }
  };
}
