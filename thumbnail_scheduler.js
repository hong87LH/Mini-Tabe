// Shared by Renderer and Main; pending work is deduplicated, not persistently cached.
export function createThumbnailScheduler(limit = 3) {
  const pending = new Map();
  const queue = [];
  let active = 0;
  const metrics = { requested: 0, started: 0, deduplicated: 0, skipped: 0, failed: 0, peak: 0, totalMs: 0 };
  const samples = [];
  function pump() {
    while (active < limit && queue.length) {
      const job = queue.shift();
      if (!job.wanted.some(check => check())) {
        pending.delete(job.key); metrics.skipped++;
        job.resolve(null); continue;
      }
      active++; metrics.started++; metrics.peak = Math.max(metrics.peak, active);
      const start = performance.now();
      const finish = () => {
        const duration = performance.now() - start;
        metrics.totalMs += duration;
        samples.push(duration); if (samples.length > 1000) samples.shift();
        active--; pending.delete(job.key); pump();
      };
      Promise.resolve().then(job.run).then(value => { finish(); job.resolve(value); }, error => { metrics.failed++; finish(); job.reject(error); });
    }
  }
  return {
    request(key, run, wanted = () => true) {
      metrics.requested++;
      if (pending.has(key)) {
        const job = pending.get(key); job.wanted.push(wanted); metrics.deduplicated++;
        return job.promise;
      }
      const job = { key, run, wanted: [wanted] };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      pending.set(key, job); queue.push(job); queueMicrotask(pump);
      return job.promise;
    },
    stats() {
      const sorted = [...samples].sort((a, b) => a - b);
      const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : 0;
      return { ...metrics, active, queued: queue.length, p50Ms: percentile(.5), p95Ms: percentile(.95), sampleCount: sorted.length };
    }
  };
}

export function thumbnailKey(path, size) {
  return JSON.stringify([String(path).replace(/\\/g, '/'), size.width, size.height]);
}
