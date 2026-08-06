import { OssImageUploader } from './oss_uploader.js';
import { getOssReferenceProfile } from './oss_reference_profiles.js';
import OSS from 'ali-oss';
import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';

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


const CMS_NAMESPACE = 'acs_oss_dashboard';
const CMS_METRIC_INTERNET_TX = 'MeteringInternetTX';
const CMS_API_VERSION = '2019-01-01';
const CMS_PERIOD_SECONDS = '3600';
const CMS_PAGE_LENGTH = '1440';
const CMS_REQUEST_TIMEOUT_MS = 20_000;

function encodeRfc3986(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function deriveRegionFromOssEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return 'cn-hangzhou';

  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(normalized).hostname.toLowerCase();
    const match = host.match(/(?:^|\.)oss-([a-z0-9-]+?)(?:-internal)?\.aliyuncs\.com$/i);
    return match?.[1] || 'cn-hangzhou';
  } catch {
    return 'cn-hangzhou';
  }
}

function getMetricPointTimestamp(point) {
  const value = Number(point?.timestamp ?? point?.Timestamp ?? point?.time ?? point?.Time);
  return Number.isFinite(value) ? value : 0;
}

function getMetricPointValue(point) {
  const candidates = [
    point?.Value,
    point?.value,
    point?.Sum,
    point?.sum,
    point?.Average,
    point?.average,
    point?.Maximum,
    point?.maximum,
    point?.Minimum,
    point?.minimum
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }

  return 0;
}

function parseCmsDatapoints(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeCmsError(error) {
  return {
    code: error?.code || error?.name || 'OSS_TRAFFIC_QUERY_FAILED',
    message: error?.message || String(error || 'OSS traffic query failed'),
    statusCode: Number(error?.statusCode || error?.status || 0) || undefined
  };
}

export class OssStorageManager {
  constructor(ossConfig = {}) {
    this._ossConfig = { ...ossConfig };
    this._bucket = ossConfig?.bucket || process.env.OSS_BUCKET;
    this._accessKeyId = ossConfig?.accessKeyId || process.env.OSS_ACCESS_KEY_ID;
    this._accessKeySecret = ossConfig?.accessKeySecret || process.env.OSS_ACCESS_KEY_SECRET;
    this._ossEndpoint = ossConfig?.endpoint || process.env.OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com';
    this._region = deriveRegionFromOssEndpoint(this._ossEndpoint);
    this._cmsEndpoint = `metrics.${this._region}.aliyuncs.com`;

    this._client = new OSS({
      accessKeyId: this._accessKeyId,
      accessKeySecret: this._accessKeySecret,
      endpoint: this._ossEndpoint,
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

  async getMonthlyInternetTraffic(now = new Date()) {
    if (!this._accessKeyId || !this._accessKeySecret) {
      const error = new Error('Missing OSS AccessKey for CloudMonitor query');
      error.code = 'MISSING_OSS_ACCESS_KEY';
      throw error;
    }
    if (!this._bucket) {
      const error = new Error('Missing OSS Bucket name');
      error.code = 'MISSING_OSS_BUCKET';
      throw error;
    }

    const startTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    ).getTime();
    const endTime = now.getTime();

    const [bucketPoints, accountPoints] = await Promise.all([
      this._queryCmsMetric({
        startTime,
        endTime,
        dimensions: JSON.stringify({ BucketName: this._bucket })
      }),
      this._queryCmsMetric({ startTime, endTime })
    ]);

    // Bucket-level metering points are hourly usage values, so add the current month's points.
    const bucketMonthlyInternetTxBytes = bucketPoints.reduce(
      (total, point) => total + getMetricPointValue(point),
      0
    );

    // Account-level MeteringInternetTX is a monthly cumulative series. Use the latest point.
    const latestAccountPoint = [...accountPoints].sort(
      (a, b) => getMetricPointTimestamp(b) - getMetricPointTimestamp(a)
    )[0];
    const accountMonthlyInternetTxBytes = getMetricPointValue(latestAccountPoint);

    const latestTimestamp = Math.max(
      0,
      ...bucketPoints.map(getMetricPointTimestamp),
      ...accountPoints.map(getMetricPointTimestamp)
    );

    return {
      metricName: CMS_METRIC_INTERNET_TX,
      bucketName: this._bucket,
      bucketMonthlyInternetTxBytes,
      accountMonthlyInternetTxBytes,
      dataTimestamp: latestTimestamp || null,
      queryStartTime: startTime,
      queryEndTime: endTime,
      cmsEndpoint: this._cmsEndpoint
    };
  }

  async _queryCmsMetric({ startTime, endTime, dimensions }) {
    const points = [];
    let nextToken = '';

    do {
      const params = {
        Namespace: CMS_NAMESPACE,
        MetricName: CMS_METRIC_INTERNET_TX,
        Period: CMS_PERIOD_SECONDS,
        StartTime: String(startTime),
        EndTime: String(endTime),
        Length: CMS_PAGE_LENGTH
      };

      if (dimensions) params.Dimensions = dimensions;
      if (nextToken) params.NextToken = nextToken;

      const response = await this._requestCmsRpc('DescribeMetricList', params);
      points.push(...parseCmsDatapoints(response?.Datapoints));
      nextToken = String(response?.NextToken || '').trim();
    } while (nextToken);

    return points;
  }

  async _requestCmsRpc(action, apiParams) {
    const commonParams = {
      AccessKeyId: this._accessKeyId,
      Action: action,
      Format: 'JSON',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex'),
      SignatureVersion: '1.0',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: CMS_API_VERSION
    };

    const unsignedParams = { ...commonParams, ...apiParams };
    const canonicalQuery = Object.keys(unsignedParams)
      .sort()
      .map(key => `${encodeRfc3986(key)}=${encodeRfc3986(unsignedParams[key])}`)
      .join('&');

    const stringToSign = `GET&%2F&${encodeRfc3986(canonicalQuery)}`;
    const signature = crypto
      .createHmac('sha1', `${this._accessKeySecret}&`)
      .update(stringToSign)
      .digest('base64');

    const query = `${canonicalQuery}&Signature=${encodeRfc3986(signature)}`;
    const requestUrl = `https://${this._cmsEndpoint}/?${query}`;

    return await new Promise((resolve, reject) => {
      const request = https.get(requestUrl, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body;

          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            const error = new Error(`CloudMonitor returned invalid JSON: ${raw.slice(0, 300)}`);
            error.code = 'CMS_INVALID_JSON';
            error.statusCode = response.statusCode;
            reject(error);
            return;
          }

          const responseCode = String(body?.Code ?? response.statusCode ?? '');
          const success = response.statusCode >= 200 && response.statusCode < 300 && body?.Success !== false && (responseCode === '200' || !body?.Code);

          if (!success) {
            const error = new Error(body?.Message || body?.message || `CloudMonitor request failed (${response.statusCode})`);
            error.code = body?.Code || body?.code || 'CMS_REQUEST_FAILED';
            error.statusCode = response.statusCode;
            error.requestId = body?.RequestId;
            reject(error);
            return;
          }

          resolve(body);
        });
      });

      request.setTimeout(CMS_REQUEST_TIMEOUT_MS, () => {
        const error = new Error('CloudMonitor request timed out');
        error.code = 'CMS_REQUEST_TIMEOUT';
        request.destroy(error);
      });

      request.on('error', reject);
    });
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

export { serializeCmsError };
