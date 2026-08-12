import { isRetryableNetworkError, isRetryableHttpStatus } from './network_utils.js';
import { createMediaProviderClient } from './provider_registry.js';
import { ensureComfyUIAvailable } from './comfyui_launcher.js';

const activePolls = new Set();

function stripSensitiveInfo(job) {
  if (!job) return job;
  const { encryptedCredentials, credentials, ...safeJob } = job;
  if (credentials?.ossConfig?.bucket) {
    safeJob.ossBucket = credentials.ossConfig.bucket;
  }
  return safeJob;
}

export async function notifyRenderer(jobStore, localJobId) {
    try {
        const { BrowserWindow } = await import('electron');
        const job = await jobStore.getJob(localJobId);
        if (job) {
            const safeJob = stripSensitiveInfo(job);
            BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('network-job-updated', safeJob);
                }
            });
        }
    } catch (e) {
        // electron not available or error
    }
}

export function startPolling(localJobId, taskId, jobStore) {
  if (activePolls.has(localJobId)) return;
  activePolls.add(localJobId);

  const poll = async () => {
    try {
      const job = await jobStore.getJob(localJobId);
      if (!job || job.phase !== 'polling') {
        activePolls.delete(localJobId);
        return;
      }
      
      const creds = job.credentials || {};
      const client = createMediaProviderClient(job.provider, creds);

      const statData = await client.getTaskStatus(taskId);
      const status = statData.data || statData;
      const state = status.state || status.status;

      // ComfyUI runs a local serial queue. Queue waiting is not a request timeout and
      // can legitimately exceed 30 minutes when long H3 jobs are ahead of this task.
      // Keep polling queued/running ComfyUI tasks; retain the legacy 30-minute guard
      // only for remote providers that do not expose a durable local queue.
      if (job.provider !== 'comfyui') {
        const startTime = job.pollingStartedAt ? new Date(job.pollingStartedAt).getTime() : (job.createdAt ? new Date(job.createdAt).getTime() : Date.now());
        const timeout = 600 * 1000 * 3;
        if (Date.now() - startTime > timeout) {
          await jobStore.patch(localJobId, { phase: 'failed', lastError: { stage: 'polling', message: 'Timeout' } });
          await notifyRenderer(jobStore, localJobId);
          activePolls.delete(localJobId);
          return;
        }
      }
      
      if (state === 'failed' || state === 'error' || state === 'cancelled') {
         const errMsg = status.error || status.message || status.msg || "Generation failed";
         await jobStore.patch(localJobId, { phase: 'failed', lastError: { stage: 'polling', message: errMsg } });
         await notifyRenderer(jobStore, localJobId);
         activePolls.delete(localJobId);
         return;
      }

      if (status.is_final || state === 'success' || state === 'completed') {
        const resultOutput = status.result_url || status.url || status.output || (status.result && status.result.video) || (status.result && status.result.videos && status.result.videos[0]) || (status.result_urls && status.result_urls[0]);
        if (resultOutput) {
          await jobStore.patch(localJobId, { phase: 'generated', resultUrl: resultOutput });
          await notifyRenderer(jobStore, localJobId);
          startDownload(localJobId, jobStore);
          activePolls.delete(localJobId);
          return;
        } else if (status.is_final) {
          const errMsg = status.error || status.message || status.msg || "Generation failed without error message";
          await jobStore.patch(localJobId, { phase: 'failed', lastError: { stage: 'polling', message: errMsg } });
          await notifyRenderer(jobStore, localJobId);
          activePolls.delete(localJobId);
          return;
        }
      }
      
      // still polling
      await notifyRenderer(jobStore, localJobId);
      setTimeout(poll, 3000);
    } catch (e) {
      console.error('Polling error', e);
      const failedJob = await jobStore.getJob(localJobId).catch(() => null);
      if (failedJob?.provider === 'comfyui' && failedJob.credentials?.comfyuiBatPath) {
        try {
          await ensureComfyUIAvailable({ endpoint: failedJob.credentials.endpoint, batPath: failedJob.credentials.comfyuiBatPath });
          setTimeout(poll, 1000);
          return;
        } catch (restartError) {
          console.error('ComfyUI automatic restart failed', restartError);
        }
      }
      let isTemp = false;
      if (e && e.httpStatus) {
         isTemp = isRetryableHttpStatus(e.httpStatus);
      } else {
         isTemp = isRetryableNetworkError(e);
      }
      
      if (isTemp) {
         setTimeout(poll, 5000);
      } else {
         try {
             await jobStore.patch(localJobId, { phase: 'failed', lastError: { stage: 'polling', message: e.message } });
             await notifyRenderer(jobStore, localJobId);
         } catch(e2) {}
         activePolls.delete(localJobId);
      }
    }
  };

  poll();
}

export async function startDownload(localJobId, jobStore) {
    try {
        const { ResumableDownloader } = await import('./resumable_downloader.js');
        const downloader = new ResumableDownloader(jobStore);
        await downloader.download(localJobId);
        await notifyRenderer(jobStore, localJobId);
    } catch (err) {
        console.error("Download start failed:", err);
    }
}

export async function resumePendingJobs(jobStore) {
  const jobs = await jobStore.listAll();
  for (const job of jobs) {
    if (job.phase === 'polling' && job.taskId) {
      startPolling(job.localJobId, job.taskId, jobStore);
    } else if (job.phase === 'creating' && !job.taskId) {
      await jobStore.patch(job.localJobId, {
        phase: 'submission_unknown',
        lastError: { stage: 'creating', message: 'App closed during creation, task ID unknown' }
      });
    } else if ((job.phase === 'generated' || job.phase === 'downloading') && job.resultUrl) {
      startDownload(job.localJobId, jobStore);
    }
  }
}
