import fs from 'fs';
import path from 'path';
import { once } from 'events';
import { app } from 'electron';
import { NetworkStageError } from './network_utils.js';

const reservedDownloadPaths = new Set();
const activeDownloadJobIds = new Set();
const RETRYABLE_FILE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const RETRYABLE_NETWORK_CODES = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'DOWNLOAD_INCOMPLETE',
    'RANGE_MISMATCH'
]);

function reserveUniqueFilePath(originalPath) {
    const isOccupied = candidate => (
        fs.existsSync(candidate) ||
        fs.existsSync(`${candidate}.part`) ||
        reservedDownloadPaths.has(candidate)
    );

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

function isRetryableFileError(error) {
    return RETRYABLE_FILE_CODES.has(error?.code);
}

function isRetryableNetworkError(error) {
    return (
        RETRYABLE_NETWORK_CODES.has(error?.code) ||
        RETRYABLE_NETWORK_CODES.has(error?.cause?.code)
    );
}

async function retryFileOperation(operation, options = {}) {
    const attempts = Math.max(1, Number(options.attempts) || 6);
    const baseDelay = Math.max(50, Number(options.baseDelay) || 180);
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (!isRetryableFileError(error) || attempt >= attempts - 1) {
                throw error;
            }

            // NAS / SMB 文件锁通常会在数百毫秒到几秒内释放。
            await sleep(Math.min(3000, baseDelay * Math.pow(2, attempt)));
        }
    }

    throw lastError;
}

async function fileExists(filePath) {
    if (!filePath) return false;
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function getFileSize(filePath) {
    const stat = await fs.promises.stat(filePath);
    return Number(stat.size) || 0;
}

async function removeFileWithRetry(filePath) {
    if (!filePath || !(await fileExists(filePath))) return;
    await retryFileOperation(
        () => fs.promises.rm(filePath, { force: true }),
        { attempts: 7, baseDelay: 180 }
    );
}

async function renameFileWithRetry(sourcePath, targetPath) {
    await retryFileOperation(
        () => fs.promises.rename(sourcePath, targetPath),
        { attempts: 7, baseDelay: 180 }
    );
}

function parseContentRange(value) {
    const text = String(value || '').trim();
    const partialMatch = text.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
    if (partialMatch) {
        return {
            start: Number(partialMatch[1]),
            end: Number(partialMatch[2]),
            total: partialMatch[3] === '*' ? null : Number(partialMatch[3])
        };
    }

    const unsatisfiedMatch = text.match(/^bytes\s+\*\/(\d+)$/i);
    if (unsatisfiedMatch) {
        return {
            start: null,
            end: null,
            total: Number(unsatisfiedMatch[1])
        };
    }

    return null;
}

function getValidImageResize(job) {
    if (job?.mediaType !== 'image') return null;

    const config = job?.downloadConfig?.imageResize;
    const width = Math.round(Number(config?.width));
    const height = Math.round(Number(config?.height));

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }

    return { width, height };
}

async function loadSharp() {
    const sharpModule = await import('sharp');
    return sharpModule.default || sharpModule;
}

async function validateImageFile(filePath, expectedSize = null) {
    try {
        const sharp = await loadSharp();
        const metadata = await sharp(filePath, { failOn: 'error', sequentialRead: true }).metadata();

        if (!metadata?.width || !metadata?.height) {
            throw new Error('Image metadata is incomplete');
        }

        if (expectedSize) {
            if (metadata.width !== expectedSize.width || metadata.height !== expectedSize.height) {
                throw new Error(
                    `Unexpected image size ${metadata.width}x${metadata.height}; ` +
                    `expected ${expectedSize.width}x${expectedSize.height}`
                );
            }
        }

        return metadata;
    } catch (error) {
        throw new NetworkStageError(
            `Downloaded image validation failed: ${error?.message || String(error)}`,
            {
                stage: 'postprocess',
                code: 'IMAGE_VALIDATION_FAILED',
                retryable: isRetryableFileError(error),
                details: { filePath }
            }
        );
    }
}

/**
 * 兼容 v2.4.10 及更早版本留下的异常正式文件。
 *
 * 旧流程可能在下载或缩放尚未成功时，已经生成 finalPath。
 * 当前 Job 尚未 completed 时，该路径属于本 Job 的中间结果：
 * - 只有 finalPath：移回 .part，继续校验、续传或后处理；
 * - finalPath 和 .part 同时存在：保留体积较大的那个作为 .part。
 */
async function recoverLegacyFinalAsPart(finalPath, partPath) {
    if (!finalPath || !partPath || !(await fileExists(finalPath))) {
        return;
    }

    const finalSize = await getFileSize(finalPath);
    const partExists = await fileExists(partPath);

    if (!partExists) {
        await renameFileWithRetry(finalPath, partPath);
        return;
    }

    const partSize = await getFileSize(partPath);
    if (finalSize > partSize) {
        await removeFileWithRetry(partPath);
        await renameFileWithRetry(finalPath, partPath);
    } else {
        await removeFileWithRetry(finalPath);
    }
}

async function resizePartToFinal(partPath, finalPath, resizeConfig) {
    const { width, height } = resizeConfig;
    const finalExt = path.extname(finalPath).toLowerCase() || '.png';
    const directory = path.dirname(finalPath);
    const basename = path.basename(finalPath, path.extname(finalPath));
    const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempPath = path.join(directory, `.${basename}.finalize-${uniqueSuffix}${finalExt}`);
    let finalCreated = false;

    try {
        await validateImageFile(partPath);

        const sharp = await loadSharp();
        let pipeline = sharp(partPath, { failOn: 'error', sequentialRead: true })
            .rotate()
            .resize(width, height, { fit: 'fill' });

        if (finalExt === '.jpg' || finalExt === '.jpeg') {
            pipeline = pipeline.jpeg({
                quality: 95,
                chromaSubsampling: '4:4:4'
            });
        } else if (finalExt === '.png') {
            pipeline = pipeline.png();
        } else if (finalExt === '.webp') {
            pipeline = pipeline.webp({ quality: 95 });
        } else if (finalExt === '.avif') {
            pipeline = pipeline.avif({ quality: 90 });
        }

        await pipeline.toFile(tempPath);
        await validateImageFile(tempPath, { width, height });

        if (await fileExists(finalPath)) {
            throw new NetworkStageError(
                `Target file already exists: ${finalPath}`,
                {
                    stage: 'postprocess',
                    code: 'TARGET_FILE_ALREADY_EXISTS',
                    retryable: true,
                    details: { finalPath }
                }
            );
        }

        // 正式文件只在下载完整、图片可解码、缩放完成后生成一次。
        await renameFileWithRetry(tempPath, finalPath);
        finalCreated = true;

        // finalPath 已经是完整结果；残留 .part 清理失败不应让 Job 重新计为失败。
        try {
            await removeFileWithRetry(partPath);
        } catch (cleanupError) {
            console.warn('Failed to remove completed image part file:', cleanupError);
        }

        return finalPath;
    } catch (error) {
        if (!finalCreated) {
            try {
                await removeFileWithRetry(tempPath);
            } catch {}
        }

        if (error instanceof NetworkStageError) {
            throw error;
        }

        throw new NetworkStageError(
            `Image resize failed: ${error?.message || String(error)}`,
            {
                stage: 'postprocess',
                code: 'IMAGE_RESIZE_FAILED',
                retryable: isRetryableFileError(error),
                details: { partPath, finalPath, width, height, originalCode: error?.code }
            }
        );
    }
}

async function finalizePartWithoutResize(job, partPath, finalPath) {
    if (job?.mediaType === 'image') {
        await validateImageFile(partPath);
    }

    if (await fileExists(finalPath)) {
        throw new NetworkStageError(
            `Target file already exists: ${finalPath}`,
            {
                stage: 'download',
                code: 'TARGET_FILE_ALREADY_EXISTS',
                retryable: true,
                details: { finalPath }
            }
        );
    }

    await renameFileWithRetry(partPath, finalPath);
    return finalPath;
}

async function readWithIdleTimeout(reader, controller, timeoutMs = 30000) {
    let timer = null;
    try {
        return await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    try {
                        controller.abort();
                    } catch {}
                    const error = new Error('Download body idle timeout');
                    error.code = 'ETIMEDOUT';
                    reject(error);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function writeChunk(writer, chunk) {
    if (writer.write(chunk)) return;
    await once(writer, 'drain');
}

async function closeWriteStream(writer) {
    const closePromise = once(writer, 'close');
    writer.end();
    await closePromise;
}

function isVerifiedPart(job, partPath) {
    if (!job?.downloadVerified || !partPath || !fs.existsSync(partPath)) {
        return false;
    }

    const actualSize = fs.statSync(partPath).size;
    const expectedSize = Number(job.downloadTotalBytes);

    if (Number.isFinite(expectedSize) && expectedSize > 0) {
        return actualSize === expectedSize;
    }

    return actualSize > 0;
}

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
        let lastKnownFinalPath = null;

        while (attempt < maxAttempts) {
            try {
                const job = await this.jobStore.getJob(localJobId);
                if (!job || (job.phase !== 'generated' && job.phase !== 'downloading')) {
                    return;
                }

                if (!job.resultUrl) {
                    throw new Error('No resultUrl for download');
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
                        finalPath,
                        downloadVerified: false,
                        downloadTotalBytes: null
                    });
                    await this._notify(localJobId);
                } else if (job.phase === 'generated') {
                    await this.jobStore.patch(localJobId, { phase: 'downloading' });
                    await this._notify(localJobId);
                }

                lastKnownFinalPath = finalPath;

                // 兼容旧版留下的半成品正式文件：移回 .part 后再续传或后处理。
                await recoverLegacyFinalAsPart(finalPath, partPath);

                let downloadResult = null;
                if (isVerifiedPart(job, partPath)) {
                    downloadResult = {
                        size: fs.statSync(partPath).size,
                        totalBytes: Number(job.downloadTotalBytes) || fs.statSync(partPath).size
                    };
                } else {
                    downloadResult = await this._performDownload(job.resultUrl, partPath);
                    await this.jobStore.patch(localJobId, {
                        downloadVerified: true,
                        downloadTotalBytes: downloadResult.totalBytes || downloadResult.size
                    });
                    await this._notify(localJobId);
                }

                const imageResize = getValidImageResize(job);
                if (imageResize) {
                    await resizePartToFinal(partPath, finalPath, imageResize);
                } else {
                    await finalizePartWithoutResize(job, partPath, finalPath);
                }

                await this.jobStore.patch(localJobId, {
                    phase: 'completed',
                    localPath: finalPath,
                    partPath: null,
                    downloadVerified: true,
                    downloadTotalBytes: downloadResult.totalBytes || downloadResult.size,
                    lastError: null
                });
                releaseReservedPath(finalPath);
                await this._notify(localJobId);
                return;
            } catch (error) {
                console.error(`Download attempt ${attempt + 1} failed for ${localJobId}:`, error);
                lastError = error;

                const isRetryable = (
                    error?.retryable === true ||
                    error?.name === 'AbortError' ||
                    isRetryableFileError(error) ||
                    isRetryableNetworkError(error) ||
                    (error?.httpStatus && error.httpStatus >= 500) ||
                    error?.httpStatus === 429 ||
                    error?.httpStatus === 416
                );

                if (!isRetryable) {
                    break;
                }

                attempt += 1;
                if (attempt < maxAttempts) {
                    await sleep(computeBackoff(attempt));
                }
            }
        }

        const errorMessage = lastError ? lastError.message : 'Unknown download error';
        const failedJob = await this.jobStore.getJob(localJobId);
        await this.jobStore.patch(localJobId, {
            phase: 'generated',
            lastError: {
                stage: lastError?.stage || 'download',
                code: lastError?.code,
                message: errorMessage,
                retryable: lastError?.retryable === true || isRetryableFileError(lastError)
            }
        });
        releaseReservedPath(failedJob?.finalPath || lastKnownFinalPath);
        await this._notify(localJobId);
    }

    async _notify(localJobId) {
        try {
            const { notifyRenderer } = await import('./network_polling.js');
            await notifyRenderer(this.jobStore, localJobId);
        } catch {}
    }

    /**
     * 只负责把远程文件完整写入 partPath。
     * 不在这里生成 finalPath，避免半下载文件或未完成缩放的图片提前以正式文件出现。
     */
    async _performDownload(url, partPath) {
        let startByte = 0;
        if (await fileExists(partPath)) {
            startByte = await getFileSize(partPath);
        }

        const controller = new AbortController();
        const headers = {};
        if (startByte > 0) {
            headers.Range = `bytes=${startByte}-`;
        }

        let response = null;
        const requestTimeout = setTimeout(() => controller.abort(), 120000);

        try {
            response = await fetch(url, { headers, signal: controller.signal });
        } finally {
            clearTimeout(requestTimeout);
        }

        const contentRange = parseContentRange(response.headers.get('content-range'));

        if (response.status === 416) {
            const localSize = await fileExists(partPath) ? await getFileSize(partPath) : 0;
            if (contentRange?.total && localSize === contentRange.total) {
                return { size: localSize, totalBytes: contentRange.total };
            }

            await removeFileWithRetry(partPath);
            const error = new NetworkStageError(
                'HTTP 416 Range Not Satisfiable - reset part file for retry',
                {
                    stage: 'download',
                    code: 'RANGE_NOT_SATISFIABLE',
                    retryable: true,
                    details: { localSize, remoteTotal: contentRange?.total || null }
                }
            );
            error.httpStatus = 416;
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            throw new NetworkStageError(
                'Received HTML error page instead of media file',
                {
                    stage: 'download',
                    code: 'UNEXPECTED_HTML_RESPONSE',
                    retryable: false
                }
            );
        }

        if (!response.ok && response.status !== 206) {
            const error = new NetworkStageError(
                `HTTP Error ${response.status}`,
                {
                    stage: 'download',
                    code: `HTTP_${response.status}`,
                    retryable: response.status === 429 || response.status >= 500
                }
            );
            error.httpStatus = response.status;
            throw error;
        }

        const isPartial = response.status === 206;
        if (isPartial && contentRange?.start !== null && contentRange?.start !== startByte) {
            await removeFileWithRetry(partPath);
            throw new NetworkStageError(
                `Range mismatch: requested ${startByte}, received ${contentRange.start}`,
                {
                    stage: 'download',
                    code: 'RANGE_MISMATCH',
                    retryable: true,
                    details: { requestedStart: startByte, receivedStart: contentRange.start }
                }
            );
        }

        // 服务端忽略 Range 并返回 200 时，从头覆盖 .part。
        const append = isPartial && startByte > 0;
        const writer = fs.createWriteStream(partPath, { flags: append ? 'a' : 'w' });
        const effectiveStart = append ? startByte : 0;
        let downloadedThisResponse = 0;

        try {
            if (!response.body) {
                throw new Error('Response body is empty');
            }

            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await readWithIdleTimeout(reader, controller, 30000);
                if (done) break;

                const chunk = Buffer.from(value);
                await writeChunk(writer, chunk);
                downloadedThisResponse += chunk.length;
            }

            // 等待 close，而不仅是 finish，确保 Windows / NAS 文件句柄已经释放。
            await closeWriteStream(writer);
        } catch (error) {
            try {
                writer.destroy();
            } catch {}
            throw error;
        }

        const actualSize = await getFileSize(partPath);
        const contentLength = Number(response.headers.get('content-length'));
        const contentEncoding = String(response.headers.get('content-encoding') || '').toLowerCase();
        let expectedTotal = null;

        if (contentRange?.total) {
            expectedTotal = contentRange.total;
        } else if (
            Number.isFinite(contentLength) &&
            contentLength > 0 &&
            (!contentEncoding || contentEncoding === 'identity')
        ) {
            expectedTotal = effectiveStart + contentLength;
        }

        if (actualSize <= 0) {
            throw new NetworkStageError(
                'Downloaded file is empty',
                {
                    stage: 'download',
                    code: 'DOWNLOAD_EMPTY',
                    retryable: true,
                    details: { partPath }
                }
            );
        }

        if (expectedTotal && actualSize !== expectedTotal) {
            throw new NetworkStageError(
                `Download incomplete: expected ${expectedTotal} bytes, received ${actualSize} bytes`,
                {
                    stage: 'download',
                    code: 'DOWNLOAD_INCOMPLETE',
                    retryable: true,
                    details: {
                        partPath,
                        expectedBytes: expectedTotal,
                        actualBytes: actualSize,
                        responseBytes: downloadedThisResponse
                    }
                }
            );
        }

        return {
            size: actualSize,
            totalBytes: expectedTotal || actualSize
        };
    }
}
