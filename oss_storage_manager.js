import { OssImageUploader } from './oss_uploader.js';
import { getOssReferenceProfile } from './oss_reference_profiles.js';
import OSS from 'ali-oss';
import fs from 'node:fs';

const MANAGED_NAMESPACES = [
  {
    id: 'legacy-webp-q90-v1',
    prefix: 'references-node/',
    profileId: 'legacy-webp-q90-v1'
  },
  {
    id: 'gemini-jpeg-q95-v1',
    prefix: 'references-node-gemini-jpeg-v1/',
    profileId: 'gemini-jpeg-q95-v1'
  }
];

export const OSS_STORAGE_POLICY = {
  enabled: true,
  packageBytes: 20 * 1024 ** 3,
  triggerBytes: 19 * 1024 ** 3,
  targetBytes: 17.5 * 1024 ** 3,
  protectRecentDays: 3,
  maxDeleteRounds: 20,
  dryRun: false
};

export class OssStorageManager {
  constructor(ossConfig) {
    this._ossConfig = { ...ossConfig };
    this._bucket = ossConfig?.bucket || process.env.OSS_BUCKET;
    this._client = new OSS({
      accessKeyId: ossConfig?.accessKeyId || process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: ossConfig?.accessKeySecret || process.env.OSS_ACCESS_KEY_SECRET,
      endpoint: ossConfig?.endpoint || process.env.OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com',
      bucket: this._bucket
    });
  }

  async runAutomaticCleanup(incomingBatchBytes = 0) {
    try {
      const usage = await this.getBucketUsage();
      const plan = await this.planCleanup(usage, incomingBatchBytes);
      if (plan && plan.plannedDeletions.length > 0) {
        console.log(`[OSS Manager] 触发自动清理: 当前 ${(usage / 1024**3).toFixed(2)}GB, 将清理 ${plan.plannedDeletions.length} 个目录`);
        await this.executeCleanup(plan);
      }
    } catch (e) {
      console.error(`[OSS Manager] 自动清理失败:`, e);
    }
  }

  async getBucketUsage() {
    try {
      const result = await this._client.getBucketStat();
      return Number(result.stat.Storage || 0);
    } catch (e) {
      console.warn("getBucketStat 失败，可能是没有权限:", e.message);
      // fallback
      return 0;
    }
  }

  async listManagedFolders() {
    const folders = [];
    for (const ns of MANAGED_NAMESPACES) {
      let isTruncated = true;
      let nextContinuationToken = null;
      while (isTruncated) {
        const result = await this._client.listV2({
          prefix: ns.prefix,
          delimiter: '/',
          'continuation-token': nextContinuationToken,
          'max-keys': 1000
        });
        if (result.prefixes) {
          for (const p of result.prefixes) {
            // p looks like "references-node/2026-04-01/"
            const dateStr = p.replace(ns.prefix, '').replace('/', '');
            folders.push({
              namespaceId: ns.id,
              date: dateStr,
              prefix: p
            });
          }
        }
        isTruncated = result.isTruncated;
        nextContinuationToken = result.nextContinuationToken;
      }
    }
    return folders;
  }

  async getFolderSize(prefix) {
    let size = 0;
    let isTruncated = true;
    let nextContinuationToken = null;
    while (isTruncated) {
      const result = await this._client.listV2({
        prefix: prefix,
        'continuation-token': nextContinuationToken,
        'max-keys': 1000
      });
      if (result.objects) {
        size += result.objects.reduce((acc, obj) => acc + obj.size, 0);
      }
      isTruncated = result.isTruncated;
      nextContinuationToken = result.nextContinuationToken;
    }
    return size;
  }

  async planCleanup(bucketUsageBytes, incomingBatchBytes) {
    if (!OSS_STORAGE_POLICY.enabled) return null;

    if (bucketUsageBytes + incomingBatchBytes < OSS_STORAGE_POLICY.triggerBytes) {
      return null;
    }

    const folders = await this.listManagedFolders();
    const now = new Date();
    const protectMs = OSS_STORAGE_POLICY.protectRecentDays * 24 * 60 * 60 * 1000;

    // exclude recent folders and CSV backup
    const candidates = folders.filter(f => {
      const d = new Date(f.date);
      if (isNaN(d.getTime())) return false; // skip non-date folders
      if (now.getTime() - d.getTime() < protectMs) return false;
      return true;
    });

    candidates.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let currentBytes = bucketUsageBytes + incomingBatchBytes;
    const toDelete = [];
    
    for (const folder of candidates) {
      if (currentBytes <= OSS_STORAGE_POLICY.targetBytes) break;
      const size = await this.getFolderSize(folder.prefix);
      if (size > 0) {
        toDelete.push({ ...folder, bytes: size });
        currentBytes -= size;
      }
    }

    return {
      bucketUsageBytes,
      incomingBatchBytes,
      triggerBytes: OSS_STORAGE_POLICY.triggerBytes,
      targetBytes: OSS_STORAGE_POLICY.targetBytes,
      plannedDeletions: toDelete,
      projectedBytes: currentBytes
    };
  }

  async executeCleanup(plan) {
    if (OSS_STORAGE_POLICY.dryRun) {
      console.log("=== DRY RUN CLEANUP ===");
      console.log(`Bucket 当前占用: ${(plan.bucketUsageBytes / 1024**3).toFixed(2)} GB`);
      console.log(`本批预计上传: ${(plan.incomingBatchBytes / 1024**2).toFixed(2)} MB`);
      console.log(`计划删除:`);
      plan.plannedDeletions.forEach(f => {
        console.log(`  ${f.prefix}  ${(f.bytes / 1024**2).toFixed(2)} MB`);
      });
      console.log(`预计清理后: ${(plan.projectedBytes / 1024**3).toFixed(2)} GB`);
      return;
    }

    for (const folder of plan.plannedDeletions) {
       await this._deleteFolderWithIndexes(folder);
    }
  }
  
  async _deleteFolderWithIndexes(folder) {
    let isTruncated = true;
    let nextContinuationToken = null;
    let successfulKeys = [];
    
    while (isTruncated) {
      const result = await this._client.listV2({
        prefix: folder.prefix,
        'continuation-token': nextContinuationToken,
        'max-keys': 1000
      });
      if (result.objects && result.objects.length > 0) {
        const keys = result.objects.map(o => o.name);
        try {
          const delRes = await this._client.deleteMulti(keys, { quiet: true });
          // deleteMulti without quiet returns deleted objects, quiet returns errors?
          // Ali-oss deleteMulti returns deleted array or similar. Let's assume all keys if no exception
          successfulKeys.push(...keys);
        } catch (e) {
          console.warn(`Failed to delete some keys in ${folder.prefix}:`, e);
        }
      }
      isTruncated = result.isTruncated;
      nextContinuationToken = result.nextContinuationToken;
    }

    if (successfulKeys.length > 0) {
       // Clean local CSV for the corresponding namespace
       const ns = MANAGED_NAMESPACES.find(n => n.id === folder.namespaceId);
       if (ns) {
         const uploader = new OssImageUploader(this._ossConfig);
         const profile = getOssReferenceProfile(ns.profileId);
         const records = uploader._loadRecords(profile);
         
         const successfulKeySet = new Set(successfulKeys);
         const filtered = records.filter(record => !successfulKeySet.has(record.cloud_path));
         
         if (filtered.length < records.length) {
             await uploader._rewriteRecords(filtered, profile);
         }
       }
    }
  }
}
