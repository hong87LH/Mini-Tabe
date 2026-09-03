import type { BaseRecord, Field, FilterRule } from '../types';

type ResolveValue = (value: any, field: Field, record: BaseRecord, fields: Field[]) => any;

// Keep filtering and insertion defaults on the same predicate, including computed fields.
export function matchesViewFilters(record: BaseRecord, fields: Field[], rules: FilterRule[], resolve: ResolveValue): boolean {
  return rules.every(rule => {
    const value = record[rule.fieldId];
    const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
    if (rule.operator === 'is_empty') return empty;
    if (rule.operator === 'is_not_empty') return !empty;
    if (rule.value == null || rule.value === '') return true;
    const field = fields.find(f => f.id === rule.fieldId);
    const resolved = field ? resolve(value, field, record, fields) : value;
    if (rule.operator === 'has_any') {
      const extracted = Array.isArray(resolved)
        ? resolved.map(v => String(v?.name || v?.url || v || '')).filter(Boolean)
        : typeof resolved === 'object' ? [JSON.stringify(resolved)] : [String(resolved || '').trim()].filter(Boolean);
      const targets = Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value || '')];
      return extracted.length === 0 ? targets.includes('__EMPTY__') : targets.some(v => extracted.includes(v));
    }
    const text = (Array.isArray(resolved) ? resolved.map(String).join(',') : String(resolved || '')).toLowerCase();
    const target = String(rule.value).toLowerCase();
    switch (rule.operator) {
      case 'equals': return text === target;
      case 'not_equals': return text !== target;
      case 'not_contains': return !text.includes(target);
      default: return text.includes(target);
    }
  });
}

// Infer only an unambiguous value, never copy the anchor's prompts, media or review data.
export function getFilterInsertDefaults(fields: Field[], rules: FilterRule[], resolve: ResolveValue): Record<string, any> {
  const defaults: Record<string, any> = {};
  for (const field of fields) {
    const constraints = rules.filter(rule => rule.fieldId === field.id);
    const candidates: any[] = [];
    for (const rule of constraints) {
      const value = rule.operator === 'equals' ? rule.value
        : rule.operator === 'has_any' && Array.isArray(rule.value) && rule.value.length === 1 ? rule.value[0] : undefined;
      if (value == null || value === '' || value === '__EMPTY__') continue;
      if (field.type === 'singleSelect') {
        const options = field.options?.filter(option => option.name.toLowerCase() === String(value).toLowerCase()) || [];
        if (options.length === 1) candidates.push(options[0].id);
      } else if (field.type === 'text' || field.type === 'url' || field.type === 'date') {
        if (typeof value === 'string') candidates.push(value);
      } else if (field.type === 'number' && Number.isFinite(Number(value))) {
        candidates.push(Number(value));
      }
    }
    const unique = [...new Set(candidates)];
    if (unique.length === 1 && matchesViewFilters({ id: '', [field.id]: unique[0] }, fields, constraints, resolve)) {
      defaults[field.id] = unique[0];
    }
  }
  return defaults;
}

export function insertRecordsAtAnchor(records: BaseRecord[], anchorId: string, side: 'above' | 'below', newRecords: BaseRecord[]): BaseRecord[] {
  const index = records.findIndex(record => record.id === anchorId);
  if (index < 0 || newRecords.length === 0) return records;
  const result = [...records];
  result.splice(index + (side === 'below' ? 1 : 0), 0, ...newRecords);
  return result;
}

// Inserting inside a group inherits its raw field values, including every nested level.
// Computed/generated/media fields cannot safely be used as writable defaults.
export function getGroupInsertDefaults(fields: Field[], groups: { fieldId: string }[], anchor?: BaseRecord): Record<string, any> {
  const defaults: Record<string, any> = {};
  if (!anchor) return defaults;
  const writableTypes = new Set(['text', 'number', 'singleSelect', 'multiSelect', 'date', 'checkbox', 'person', 'url', 'rating']);
  for (const { fieldId } of groups) {
    const field = fields.find(candidate => candidate.id === fieldId);
    if (!field || !writableTypes.has(field.type)) continue;
    const value = anchor[fieldId];
    if (value == null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      defaults[fieldId] = value;
    } else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      defaults[fieldId] = [...value];
    }
  }
  return defaults;
}
