const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled', 'submission_unknown']);
const STALE_CANDIDATE_PHASES = new Set(['preparing', 'uploading', 'creating', 'queued', 'running', 'polling']);

function asTime(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

function protectedResult(job, code, reason, details = {}) {
  return {
    jobId: job?.localJobId || null,
    eligible: false,
    classification: 'protected',
    code,
    reason,
    provider: job?.provider || null,
    phase: job?.phase || null,
    taskId: job?.taskId || null,
    ...details
  };
}

export function classifyLocalStaleCandidate(job, options = {}) {
  if (!job) return { eligible: false, classification: 'not_found', code: 'JOB_NOT_FOUND', reason: 'Job does not exist.' };
  const phase = String(job.phase || '');
  if (TERMINAL_PHASES.has(phase)) {
    return protectedResult(job, 'TERMINAL_JOB', `Terminal Job phase ${phase} is never stale-cleaned.`);
  }
  if (!STALE_CANDIDATE_PHASES.has(phase)) {
    return protectedResult(job, 'PHASE_NOT_ELIGIBLE', `Job phase ${phase || '(empty)'} is not eligible for stale cleanup.`);
  }
  if (job.localPath || job.finalPath || job.resultUrl) {
    return protectedResult(job, 'RESULT_AVAILABLE', 'Job has a result URL or local file and must be preserved.');
  }
  if (job.provider !== 'comfyui') {
    return protectedResult(job, 'PROVIDER_NOT_VERIFIABLE', 'Automatic stale cleanup currently requires an exact ComfyUI queue/history check.');
  }
  if (!job.taskId) {
    return protectedResult(job, 'TASK_ID_MISSING', 'Job has no durable taskId; cleanup cannot prove that a remote task is absent.');
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const staleAfterMs = Math.max(5 * 60 * 1000, Number(options.staleAfterMs) || 30 * 60 * 1000);
  const updatedAtMs = asTime(job.updatedAt) ?? asTime(job.createdAt);
  if (updatedAtMs === null) {
    return protectedResult(job, 'AGE_UNKNOWN', 'Job timestamp is missing or invalid.');
  }
  const ageMs = Math.max(0, now - updatedAtMs);
  if (ageMs < staleAfterMs) {
    return protectedResult(job, 'TOO_RECENT', 'Job has not exceeded the stale threshold.', { ageMs, staleAfterMs });
  }
  return {
    jobId: job.localJobId,
    eligible: null,
    classification: 'remote_check_required',
    code: 'REMOTE_CHECK_REQUIRED',
    reason: 'Local state is old enough; ComfyUI queue/history must be checked.',
    provider: job.provider,
    phase,
    taskId: job.taskId,
    ageMs,
    staleAfterMs
  };
}

export async function inspectJobForStaleCleanup(job, options = {}) {
  const local = classifyLocalStaleCandidate(job, options);
  if (local.classification !== 'remote_check_required') return local;
  if (typeof options.remoteProbe !== 'function') {
    return protectedResult(job, 'REMOTE_CHECK_UNAVAILABLE', 'Remote liveness probe is unavailable.', {
      ageMs: local.ageMs,
      staleAfterMs: local.staleAfterMs,
      classification: 'unknown'
    });
  }
  let remote;
  try {
    remote = await options.remoteProbe(job);
  } catch (error) {
    return protectedResult(job, 'REMOTE_UNREACHABLE', 'ComfyUI could not be reached; the Job is preserved.', {
      ageMs: local.ageMs,
      staleAfterMs: local.staleAfterMs,
      classification: 'unknown',
      remoteError: error?.message || String(error)
    });
  }
  const state = String(remote?.state || remote?.status || '').toLowerCase();
  const isFinal = remote?.is_final === true;
  if (state === 'pending' && !isFinal) {
    return {
      ...local,
      eligible: true,
      classification: 'stale_missing',
      code: 'REMOTE_TASK_MISSING',
      reason: 'Job exceeded the stale threshold and its taskId is absent from ComfyUI queue and history.',
      remoteState: state
    };
  }
  return protectedResult(job, isFinal ? 'REMOTE_TERMINAL' : 'REMOTE_ACTIVE', isFinal
    ? `ComfyUI reports terminal state ${state || '(unknown)'}; reconcile or retry instead of stale cleanup.`
    : `ComfyUI still reports ${state || 'an active/unknown state'}; the Job is preserved.`, {
    ageMs: local.ageMs,
    staleAfterMs: local.staleAfterMs,
    remoteState: state || null,
    remoteFinal: isFinal
  });
}

export function removeNetworkJobPlaceholders(tables, jobIds, options = {}) {
  const targets = new Set((jobIds || []).map(String));
  const tableId = options.tableId ? String(options.tableId) : null;
  const changes = [];
  let removedPlaceholders = 0;
  const nextTables = (tables || []).map(table => {
    if (tableId && table.id !== tableId) return table;
    let tableChanged = false;
    const records = (table.data?.records || []).map(record => {
      let nextRecord = record;
      for (const field of table.data?.fields || []) {
        const raw = record[field.id];
        const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (values.length === 0) continue;
        const filtered = values.filter(item => {
          const matched = item && typeof item === 'object' && item.type === 'networkJob' && targets.has(String(item.jobId || ''));
          if (matched) removedPlaceholders += 1;
          return !matched;
        });
        if (filtered.length === values.length) continue;
        if (nextRecord === record) nextRecord = { ...record };
        nextRecord[field.id] = filtered;
        changes.push({ tableId: table.id, rowId: record.id, fieldId: field.id, removed: values.length - filtered.length, remainingItems: filtered.length });
      }
      if (nextRecord !== record) tableChanged = true;
      return nextRecord;
    });
    return tableChanged ? { ...table, data: { ...table.data, records } } : table;
  });
  return {
    tables: nextTables,
    changes,
    removedPlaceholders,
    affectedTables: new Set(changes.map(item => item.tableId)).size,
    affectedRows: new Set(changes.map(item => `${item.tableId}:${item.rowId}`)).size,
    affectedCells: changes.length
  };
}

export const STALE_JOB_TERMINAL_PHASES = [...TERMINAL_PHASES];
export const STALE_JOB_CANDIDATE_PHASES = [...STALE_CANDIDATE_PHASES];
