import { normalizeAttachmentKey } from './attachmentUtils';

// Keep cell coordinates intact and fold every finished job into the same cell value.
export function reconcileNetworkJobCells(records: any[], fields: any[], jobs: any[], normalizePath: (path: string) => string) {
  const terminalJobs = new Map(jobs.filter(job => ['completed', 'failed', 'cancelled'].includes(job.phase)).map(job => [job.localJobId, job]));
  const updates: { recordId: string; fieldId: string; value: any[] }[] = [];
  for (const record of records) {
    for (const field of fields) {
      if (!['attachment', 'aiImage', 'aiVideo'].includes(field.type)) continue;
      const raw = record[field.id];
      const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const result: any[] = [];
      const keys = new Set(values.filter(v => v?.type !== 'networkJob').map(v => normalizeAttachmentKey(typeof v === 'string' ? v : v?.url)).filter(Boolean));
      let changed = false;
      for (const value of values) {
        const job = value?.type === 'networkJob' ? terminalJobs.get(value.jobId) : undefined;
        if (!job || (job.phase === 'completed' && !job.localPath)) {
          result.push(value);
          continue;
        }
        if (job.phase === 'completed') {
          const path = normalizePath(job.localPath);
          if (!path) { result.push(value); continue; }
          const key = normalizeAttachmentKey(path);
          if (!keys.has(key)) { result.push(path); keys.add(key); }
        }
        changed = true;
      }
      if (changed) updates.push({ recordId: record.id, fieldId: field.id, value: result });
    }
  }
  return updates;
}
