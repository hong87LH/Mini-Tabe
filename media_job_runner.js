import { NetworkJobStore } from './network_job_store.js';
import { startPolling } from './network_polling.js';
import { OssStorageManager } from './oss_storage_manager.js';
import { createMediaProviderClient, normalizeProviderName } from './provider_registry.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NetworkStageError } from './network_utils.js';
import { ensureComfyUIAvailable } from './comfyui_launcher.js';

async function safeImportElectron() {
    return await import('electron');
}

export class MediaJobRunner {
    constructor(options = {}) {
        this.jobStore = options.jobStore || new NetworkJobStore();
    }

    async uploadMediaList(mediaList, uploader, modelProfile) {
        if (!mediaList || !Array.isArray(mediaList) || mediaList.length === 0) return [];
        
        let out = [];
        let failedReferences = [];
        for (let index = 0; index < mediaList.length; index++) {
            const itemUrl = mediaList[index];
            let actualUrl = itemUrl;
            if (actualUrl.startsWith('file://')) {
                const { fileURLToPath } = await import('url');
                try {
                    actualUrl = fileURLToPath(actualUrl);
                } catch(e) {
                    actualUrl = actualUrl.replace('file://', '');
                }
            }
            else if (actualUrl.startsWith('local-img://')) actualUrl = decodeURIComponent(actualUrl.replace('local-img://', ''));
            else if (actualUrl.startsWith('local-video://')) actualUrl = decodeURIComponent(actualUrl.replace('local-video://', ''));

            let tempPathToClean = null;
            let mimeType = null;
            if (actualUrl.startsWith('data:')) {
                const matches = actualUrl.match(/^data:(\w+\/\w+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    mimeType = matches[1];
                    const ext = mimeType.split('/')[1] || 'bin';
                    const buffer = Buffer.from(matches[2], 'base64');
                    const { app } = await safeImportElectron();
                    const tempPath = path.join(app.getPath('temp'), `temp_upload_${Date.now()}_${index}.${ext}`);
                    fs.writeFileSync(tempPath, buffer);
                    actualUrl = tempPath;
                    tempPathToClean = tempPath;
                }
            }

            if (actualUrl.startsWith('http://') || actualUrl.startsWith('https://')) {
                out.push(actualUrl);
            } else if (fs.existsSync(actualUrl)) {
                if (!uploader) {
                    failedReferences.push({ index, source: itemUrl, message: 'Local reference media provided but no OSS config configured', code: 'NO_OSS_CONFIG' });
                    continue;
                }
                try {
                    const isPreparedJpeg = mimeType === 'image/jpeg' && modelProfile?.referenceProfileId === 'gemini-jpeg-q95-v1';
                    const uploadOpts = modelProfile ? { profileId: modelProfile.referenceProfileId, alreadyPrepared: isPreparedJpeg } : undefined;
                    const record = await uploader.upload(actualUrl, uploadOpts);
                    out.push(record.cloud_url);
                } catch (e) {
                    failedReferences.push({ index, source: itemUrl, message: e.message, code: e.code });
                }
            } else {
                failedReferences.push({ index, source: itemUrl, message: 'Reference media file not found on disk', code: 'FILE_NOT_FOUND' });
            }

            if (tempPathToClean) {
                try { fs.unlinkSync(tempPathToClean); } catch(e) {}
            }
        }

        if (failedReferences.length > 0) {
            throw new NetworkStageError('Reference media upload failed', {
                stage: 'upload',
                code: 'REFERENCE_UPLOAD_FAILED',
                retryable: true,
                details: {
                    failedReferences,
                    expectedCount: mediaList.length,
                    uploadedCount: out.length
                }
            });
        }
        return out;
    }

    async createJob({ type, options }) {
        const { prompt, model, params, count, apiKey, endpoint, ossConfig, comfyuiBatPath, tableId, recordId, fieldId, generationIndex, viewMode, downloadConfig } = options;
        const provider = normalizeProviderName(options.provider);
        const localJobId = crypto.randomUUID();

        // 1. Create Job with preparing phase
        await this.jobStore.upsert({
            localJobId,
            provider,
            mediaType: type,
            model,
            phase: 'preparing',
            credentials: { apiKey, endpoint, ossConfig, comfyuiBatPath },
            downloadConfig,
            tableId,
            recordId,
            fieldId,
            generationIndex,
            viewMode,
            createdAt: new Date().toISOString()
        });

        try {
            if (provider === 'comfyui') {
                await ensureComfyUIAvailable({ endpoint, batPath: comfyuiBatPath });
            }
            await this.jobStore.patch(localJobId, { phase: 'uploading' });

            let uploader = null;
            if (ossConfig && ossConfig.accessKeyId) {
                const { OssImageUploader } = await import('./oss_uploader.js');
                uploader = new OssImageUploader(ossConfig);
            }

            let modelProfile = null;
            if (type === 'image') {
                const { getLingwuImageModelProfile } = await import('./lingwu_image_model_profiles.js');
                modelProfile = getLingwuImageModelProfile(model);
            }

            // 2. Upload references
            let uploadedImages = [], uploadedVideos = [], uploadedAudio = [];
            
            if (type === 'image' && params && params.images) {
                uploadedImages = provider === 'comfyui'
                    ? [...params.images]
                    : await this.uploadMediaList(params.images, uploader, modelProfile);
                params.images = uploadedImages;
            } else if (type === 'video') {
                const { images, videos, audio } = options;
                if (provider === 'comfyui') {
                    uploadedImages = Array.isArray(images) ? [...images] : [];
                    uploadedVideos = Array.isArray(videos) ? [...videos] : [];
                    uploadedAudio = Array.isArray(audio) ? [...audio] : [];
                } else {
                    uploadedImages = await this.uploadMediaList(images, uploader);
                    uploadedVideos = await this.uploadMediaList(videos, uploader);
                    uploadedAudio = await this.uploadMediaList(audio, uploader);
                }
                
                if (uploadedImages.length > 0) { params.images = uploadedImages; }
                if (uploadedVideos.length > 0) { params.videos = uploadedVideos; }
                if (uploadedAudio.length > 0) { params.audio = uploadedAudio; }
            }

            // 3. Save uploaded urls and creating phase
            const uploadedUrls = [...uploadedImages, ...uploadedVideos, ...uploadedAudio];
            
            // Asynchronously trigger OSS cleanup
            if (provider !== 'comfyui' && uploadedUrls.length > 0 && ossConfig) {
                const storageManager = new OssStorageManager(ossConfig);
                storageManager.runAutomaticCleanup(0).catch(e => console.error('OSS cleanup check failed:', e));
            }
            
            await this.jobStore.patch(localJobId, {
                phase: 'creating',
                uploadedReferenceUrls: uploadedUrls
            });

            // Prepare payload
            let finalParams = params || {};
            if (type === 'video' && provider !== 'comfyui') {
                if (Object.keys(finalParams).length > 0) {
                    const { mapVideoParams } = await import('./video_param_mapper.js');
                    finalParams = mapVideoParams(model, finalParams);
                }
            } else if (type === 'image' && provider !== 'comfyui') {
                const { buildLingwuImageParams } = await import('./lingwu_image_model_profiles.js');
                finalParams = buildLingwuImageParams({ model, params: finalParams });
            }

            const client = createMediaProviderClient(provider, { apiKey, endpoint });
            
            // 4. POST createTask
            let startData;
            try {
                startData = await client.createTask(model, prompt, finalParams, count || 1);
            } catch (e) {
                if (e && e.submissionUnknown) {
                    await this.jobStore.patch(localJobId, { phase: 'submission_unknown', lastError: { stage: 'creating', message: e.message, submissionUnknown: true } });
                } else {
                    await this.jobStore.patch(localJobId, { phase: 'failed', lastError: { stage: 'creating', message: e.message } });
                }
                throw e;
            }

            let dataObj = startData.data || startData;
            const taskId = (dataObj['任务ids'] && dataObj['任务ids'][0]) || dataObj['任务id'] || dataObj['task_id'];

            if (!taskId) {
                const err = new Error("Failed to get task ID: " + JSON.stringify(startData));
                await this.jobStore.patch(localJobId, { phase: 'failed', lastError: { stage: 'creating', message: err.message } });
                throw err;
            }

            // 5. taskId persisted, enter polling
            await this.jobStore.patch(localJobId, { 
                phase: 'polling', 
                taskId,
                pollingStartedAt: new Date().toISOString()
            });

            // 6. Start Unified Poller
            startPolling(localJobId, taskId, this.jobStore);

            // 7. Return immediately
            return {
                ok: true,
                localJobId,
                taskId,
                phase: 'polling'
            };

        } catch (err) {
            console.error(`MediaJobRunner createJob (${type}) error:`, err);
            let phase = 'failed';
            if (err && err.submissionUnknown) phase = 'submission_unknown';
            try {
                await this.jobStore.patch(localJobId, { 
                    phase, 
                    lastError: { stage: err.stage || 'creating', message: err.message, submissionUnknown: err.submissionUnknown } 
                });
            } catch(e) {}
            throw err;
        }
    }

    async createImageJob(options) {
        return this.createJob({ type: 'image', options });
    }

    async createVideoJob(options) {
        return this.createJob({ type: 'video', options });
    }
}
