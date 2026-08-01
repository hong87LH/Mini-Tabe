import fs from 'fs';
import path from 'path';
import { net, app } from 'electron';
import { NetworkStageError } from './network_utils.js';

const reservedDownloadPaths = new Set();

function reserveUniqueFilePath(originalPath) {
    const isOccupied = candidate => fs.existsSync(candidate) || fs.existsSync(`${candidate}.part`) || reservedDownloadPaths.has(candidate);

    if (!isOccupied(originalPath)) {
        reservedDownloadPaths.add(originalPath);
        return originalPath;
    }

    const ext = path.extname(originalPath);
    let baseName = path.basename(originalPath, ext);
    const directory = path.dirname(originalPath);
    let counter = 1;

    const suffixMatch = baseName.match(/-(\d+)$/);
    if (suffixMatch) {
        counter = Number(suffixMatch[1]) + 1;
        baseName = baseName.slice(0, -suffixMatch[0].length);
    }

    let candidate = path.join(directory, `${baseName}-${counter}${ext}`);
    while (isOccupied(candidate)) {
        counter += 1;
        candidate = path.join(directory, `${baseName}-${counter}${ext}`);
    }

    reservedDownloadPaths.add(candidate);
    return candidate;
}

function releaseReservedPath(filePath) {
    if (filePath) {
        reservedDownloadPaths.delete(filePath);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function computeBackoff(attempt) {
    return Math.pow(2, attempt) * 1000 + Math.random() * 1000;
}

const activeDownloadJobIds = new Set();

export class ResumableDownloader {
    constructor(jobStore, getDownloadsDir = () => path.join(app.getPath('userData'), 'downloads')) {
        this.jobStore = jobStore;
        this.getDownloadsDir = getDownloadsDir;
    }

    async download(localJobId) {
        if (activeDownloadJobIds.has(localJobId)) return;
        activeDownloadJobIds.add(localJobId);

        try {
            await this._downloadLoop(localJobId);
        } finally {
            activeDownloadJobIds.delete(localJobId);
            const { notifyRenderer } = await import('./network_polling.js');
            await notifyRenderer(this.jobStore, localJobId);
        }
    }

    async _downloadLoop(localJobId) {
        const maxAttempts = 5;
        let attempt = 0;
        let lastError = null;

        while (attempt < maxAttempts) {
            try {
                const job = await this.jobStore.getJob(localJobId);
                if (!job || (job.phase !== 'generated' && job.phase !== 'downloading')) {
                    return; // Job cancelled or completed
                }

                if (!job.resultUrl) {
                    throw new Error("No resultUrl for download");
                }

                let finalPath = job.finalPath;
                let partPath = job.partPath;

                if (!finalPath || !partPath) {
                    let downloadDir = this.getDownloadsDir();
                    let basename = '';
                    
                    const urlPath = new URL(job.resultUrl).pathname;
                    const ext = path.extname(urlPath) || (job.mediaType === 'video' ? '.mp4' : '.jpg');

                    if (job.downloadConfig) {
                        if (job.downloadConfig.folderPath) {
                            downloadDir = job.downloadConfig.folderPath;
                        }
                        if (job.downloadConfig.filename) {
                            basename = `${job.downloadConfig.filename}${ext}`;
                        }
                    }
                    
                    if (!basename) {
                        basename = `lingwu_${Date.now()}_${localJobId.substring(0, 8)}${ext}`;
                    }

                    if (!fs.existsSync(downloadDir)) {
                        fs.mkdirSync(downloadDir, { recursive: true });
                    }
                    const desiredPath = path.join(downloadDir, basename);
                    finalPath = reserveUniqueFilePath(desiredPath);
                    partPath = `${finalPath}.part`;
                    await this.jobStore.patch(localJobId, {
                        phase: 'downloading',
                        partPath,
                        finalPath
                    });
                    await this._notify(localJobId);
                } else if (job.phase === 'generated') {
                    await this.jobStore.patch(localJobId, { phase: 'downloading' });
                    await this._notify(localJobId);
                }

                await this._performDownload(job.resultUrl, partPath, finalPath, localJobId);

                // Download completed
                await this.jobStore.patch(localJobId, {
                    phase: 'completed',
                    localPath: finalPath
                });
                releaseReservedPath(finalPath);
                await this._notify(localJobId);
                return; // Success
            } catch (err) {
                console.error(`Download attempt ${attempt + 1} failed for ${localJobId}:`, err);
                lastError = err;
                
                const isRetryable = err.name === 'AbortError' || ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(err.code) || (err.httpStatus && err.httpStatus >= 500) || err.httpStatus === 429 || err.httpStatus === 416;
                if (!isRetryable) {
                    break;
                }
                attempt++;
                if (attempt < maxAttempts) {
                    await sleep(computeBackoff(attempt));
                }
            }
        }

        // Exhausted retries or non-retryable error, keep it in generated state but save lastError
        const errorMessage = lastError ? lastError.message : 'Unknown download error';
        await this.jobStore.patch(localJobId, {
            phase: 'generated',
            lastError: { stage: 'download', message: errorMessage }
        });
        await this._notify(localJobId);
    }

    async _notify(localJobId) {
        try {
            const { notifyRenderer } = await import('./network_polling.js');
            await notifyRenderer(this.jobStore, localJobId);
        } catch (e) {}
    }

    async _performDownload(url, partPath, finalPath, localJobId) {
        return new Promise((resolve, reject) => {
            let startByte = 0;
            if (fs.existsSync(partPath)) {
                startByte = fs.statSync(partPath).size;
            }

            const requestOptions = { url, method: 'GET' };
            
            // Note: net.request is the electron way, but we can also use fetch with AbortController
            // We'll use net.fetch to get a stream, but net.fetch stream piping is tricky. Let's stick to fetch.
            // But to get progress, we need to read the body stream.
            
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout per chunk/request

            const headers = {};
            if (startByte > 0) {
                headers['Range'] = `bytes=${startByte}-`;
            }

            fetch(url, { headers, signal: controller.signal })
                .then(async response => {
                    clearTimeout(timeout);
                    if (response.status === 416) {
                        if (fs.existsSync(partPath)) {
                            fs.unlinkSync(partPath);
                        }
                        const err = new Error("HTTP 416 Range Not Satisfiable - Deleted part file to restart");
                        err.httpStatus = 416;
                        reject(err);
                        return;
                    }
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('text/html')) {
                         reject(new Error("Received HTML error page instead of media file"));
                         return;
                    }

                    if (!response.ok && response.status !== 206) {
                        const err = new Error(`HTTP Error ${response.status}`);
                        err.httpStatus = response.status;
                        reject(err);
                        return;
                    }
                    
                    const isPartial = response.status === 206;
                    const writer = fs.createWriteStream(partPath, { flags: (isPartial && startByte > 0) ? 'a' : 'w' });
                    
                    try {
                         const reader = response.body.getReader();
                         const totalLength = parseInt(response.headers.get('content-length'), 10) || 0;
                         let downloaded = isPartial ? startByte : 0;
                         
                         let idleTimer = null;
                         const resetIdleTimer = () => {
                             if (idleTimer) clearTimeout(idleTimer);
                             idleTimer = setTimeout(() => {
                                 reader.cancel().catch(()=>{});
                                 const err = new Error("Download body idle timeout");
                                 err.code = 'ETIMEDOUT';
                                 reject(err);
                             }, 30000);
                         };

                         resetIdleTimer();

                         while (true) {
                             const { done, value } = await reader.read();
                             resetIdleTimer();
                             if (done) break;
                             writer.write(Buffer.from(value));
                             downloaded += value.length;
                         }
                         if (idleTimer) clearTimeout(idleTimer);
                         
                         writer.end();
                         writer.on('finish', () => {
                             // Rename partPath to finalPath
                             try {
                                 if (fs.existsSync(finalPath)) {
                                     throw new Error(`Target file already exists: ` + finalPath);
                                 }
                                 fs.renameSync(partPath, finalPath);
                                 resolve();
                             } catch(renameErr) {
                                 reject(renameErr);
                             }
                         });
                         writer.on('error', reject);
                    } catch (e) {
                         writer.end();
                         reject(e);
                    }
                })
                .catch(err => {
                    clearTimeout(timeout);
                    reject(err);
                });
        });
    }
}
