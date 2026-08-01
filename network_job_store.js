import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

function encryptJobCredentials(job) {
  if (job && job.credentials) {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        const jsonStr = JSON.stringify(job.credentials);
        job.encryptedCredentials = safeStorage.encryptString(jsonStr).toString('base64');
        delete job.credentials;
      } catch (e) {
        console.error('Failed to encrypt credentials:', e);
      }
    }
  }
  return job;
}

function decryptJobCredentials(job) {
  if (job && job.encryptedCredentials) {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(job.encryptedCredentials, 'base64');
        const jsonStr = safeStorage.decryptString(buffer);
        job.credentials = JSON.parse(jsonStr);
      } catch (e) {
        console.error('Failed to decrypt credentials:', e);
      }
    }
  }
  return job;
}

export class NetworkJobStore {
  constructor() {
    this.storePath = path.join(app.getPath('userData'), 'network-jobs.json');
    this._writeQueue = Promise.resolve();
  }

  async _readAll() {
    try {
      if (fs.existsSync(this.storePath)) {
        const content = await fs.promises.readFile(this.storePath, 'utf8');
        const data = JSON.parse(content);
        let jobs = Array.isArray(data) ? data : Object.values(data);
        return jobs.map(j => decryptJobCredentials(j));
      }
    } catch (e) {
      console.error('Failed to read jobs', e);
    }
    return [];
  }

  async _writeAll(jobs) {
    const jobsToSave = jobs.map(j => encryptJobCredentials({ ...j }));
    await fs.promises.mkdir(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(jobsToSave, null, 2), 'utf-8');
    await fs.promises.rename(tempPath, this.storePath);
  }

  _queueWrite(task) {
    const current = this._writeQueue.then(task);
    this._writeQueue = current.catch((err) => {
      console.error('NetworkJobStore write error:', err);
    });
    return current;
  }

  async listAll() {
    return this._queueWrite(async () => {
      return await this._readAll();
    });
  }

  async listPending() {
    return this._queueWrite(async () => {
      const jobs = await this._readAll();
      return jobs.filter(
        job => !['completed', 'failed'].includes(job.phase)
      );
    });
  }

  async getJob(localJobId) {
    return this._queueWrite(async () => {
      const jobs = await this._readAll();
      return jobs.find(j => j.localJobId === localJobId);
    });
  }

  async upsert(job) {
    return this._queueWrite(async () => {
      const jobs = await this._readAll();
      const index = jobs.findIndex(j => j.localJobId === job.localJobId);
      if (index !== -1) {
        jobs[index] = { ...jobs[index], ...job, updatedAt: new Date().toISOString() };
      } else {
        jobs.push({ ...job, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      await this._writeAll(jobs);
    });
  }

  async patch(localJobId, changes) {
    return this._queueWrite(async () => {
      const jobs = await this._readAll();
      const index = jobs.findIndex(j => j.localJobId === localJobId);
      if (index !== -1) {
        jobs[index] = { ...jobs[index], ...changes, updatedAt: new Date().toISOString() };
        await this._writeAll(jobs);
      }
    });
  }

  async remove(localJobId) {
    return this._queueWrite(async () => {
      let jobs = await this._readAll();
      jobs = jobs.filter(j => j.localJobId !== localJobId);
      await this._writeAll(jobs);
    });
  }

  async cleanupOldJobs() {
    return this._queueWrite(async () => {
      let jobs = await this._readAll();
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let modified = false;
      
      // Sort newest first
      jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      const keepJobs = [];
      let count = 0;
      
      for (const job of jobs) {
        // Clean up completed jobs older than 30 days
        if (job.phase === 'completed' && new Date(job.createdAt).getTime() < thirtyDaysAgo) {
          modified = true;
          continue;
        }
        
        // Keep max 500 jobs, but never auto-delete submission_unknown
        if (count >= 500 && job.phase !== 'submission_unknown') {
          modified = true;
          continue;
        }
        
        keepJobs.push(job);
        if (job.phase !== 'submission_unknown') {
            count++;
        }
      }
      
      if (modified) {
        await this._writeAll(keepJobs);
      }
    });
  }
}
