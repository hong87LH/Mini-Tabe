import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { getOssReferenceProfile } from './oss_reference_profiles.js';

function normalizeEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return normalized.replace(/\/+$/, '');
}

function getEndpointHost(endpoint) {
  try {
    return new URL(normalizeEndpoint(endpoint)).host.toLowerCase();
  } catch {
    return '';
  }
}

function buildOssDomain(endpoint, bucket) {
  const cleanBucket = String(bucket || '').trim();
  if (!cleanBucket) {
    return '';
  }
  const endpointUrl = new URL(normalizeEndpoint(endpoint));
  return `${endpointUrl.protocol}//${cleanBucket}.${endpointUrl.host}`;
}

function inferBucketFromCloudUrl(cloudUrl, endpointHost) {
  try {
    const host = new URL(cloudUrl).host.toLowerCase();
    const suffix = `.${String(endpointHost || '').toLowerCase()}`;
    if (suffix !== '.' && host.endsWith(suffix)) {
      return host.slice(0, -suffix.length);
    }
    return '';
  } catch {
    return '';
  }
}

function safeFileURLToPath(urlStr) {
  try {
     return fileURLToPath(urlStr);
  } catch(e) {
     if (typeof urlStr === 'string' && urlStr.startsWith('file://')) {
        let p = decodeURIComponent(urlStr.substring(7));
        if (process.platform === 'win32') {
            if (p.startsWith('/')) {
                // handle /C:/... -> C:/
                if (p.length > 2 && p[2] === ':') {
                   p = p.substring(1);
                } else if (!p.startsWith('//')) {
                   // if it's a UNC path that was prefixed with /, make it //
                   p = '/' + p;
                }
            } else if (!p.match(/^[a-zA-Z]:/) && !p.startsWith('\\\\')) {
                // if it doesn't start with / or \\ and isn't a drive letter, it's likely a UNC path missing //
                p = '//' + p;
            }
            // Ensure backslashes for Windows
            p = p.replace(/\//g, '\\');
        }
        return p;
     }
     return urlStr;
  }
}

// ============================================================
//  路径与常量
// ============================================================

const __filename = safeFileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);

// 加载 .env（优先脚本目录，回退 CWD）
dotenv.config({ path: path.join(SCRIPT_DIR, '.env') });
dotenv.config();



const CSV_FIELDS = [
  'local_path',       // 本地文件绝对路径
  'file_hash',        // SHA256（精确去重）
  'dhash',            // 差值哈希（感知去重，替代 pHash）
  'file_size',        // 字节数
  'local_filename',   // 本地文件名
  'cloud_filename',   // 云端文件名
  'cloud_path',       // OSS 对象路径
  'cloud_url',        // 完整访问 URL
  'upload_date',      // YYYY-MM-DD
  'upload_time',      // ISO 时间戳
  'bucket',
  'endpoint_host',
  'reference_profile_id'
];

const DHASH_THRESHOLD = 20;             // dHash Hamming 距离阈值

// ============================================================
//  核心类
// ============================================================

class OssImageUploader {

  // ---------- 构造 ----------

  constructor(ossConfig = null) {
    this._akId = ossConfig?.accessKeyId || process.env.OSS_ACCESS_KEY_ID;
    this._akSecret = ossConfig?.accessKeySecret || process.env.OSS_ACCESS_KEY_SECRET;
    
    this._endpoint = normalizeEndpoint(
      ossConfig?.endpoint || process.env.OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com'
    );
    this._endpointHost = getEndpointHost(this._endpoint);
    this._bucket = String(ossConfig?.bucket || process.env.OSS_BUCKET || '').trim();
    
    // Domain 永远由当前 Endpoint + Bucket 自动生成。不读取旧配置中残留的 domain。
    this._domainRaw = buildOssDomain(this._endpoint, this._bucket);

    // OSS 客户端懒初始化（list/stats/find 等 CSV 操作不需要 OSS）
    this._client = null;
    this._domain = null;
  }

  /** 懒初始化 OSS 客户端 */
  _ensureOSS() {
    if (this._client) return;

    if (!this._akId || !this._akSecret || !this._bucket || !this._domainRaw) {
      console.error("[OssImageUploader] 缺少 OSS 配置项:");
      console.error("  akId:", this._akId ? "***" : "MISSING");
      console.error("  akSecret:", this._akSecret ? "***" : "MISSING");
      console.error("  bucket:", this._bucket ? this._bucket : "MISSING");
      console.error("  domain:", this._domainRaw ? this._domainRaw : "MISSING");
      
      throw new Error(
        '请在界面设置中或 .env 中配置完整的 OSS 信息:\n' +
        '  ACCESS_KEY_ID\n' +
        '  ACCESS_KEY_SECRET\n' +
        '  OSS_BUCKET\n' +
        '  OSS_DOMAIN\n' +
        `  (.env 可放在 ${SCRIPT_DIR} 或 CWD)`
      );
    }

    this._client = new OSS({
      accessKeyId: this._akId,
      accessKeySecret: this._akSecret,
      endpoint: this._endpoint,
      bucket: this._bucket,
    });
    this._domain = this._domainRaw.replace(/\/+$/, '');
  }

  _getLocalCsvScope(records, profile) {
    const meaningfulRecords = Array.isArray(records)
      ? records.filter(record => record && (record.cloud_path || record.cloud_url || record.file_hash))
      : [];

    if (meaningfulRecords.length === 0) {
      return {
        bucket: '',
        endpointHost: '',
        profileId: profile.id,
        isEmpty: true
      };
    }

    const explicitBuckets = new Set(
      meaningfulRecords
        .map(record => String(record.bucket || '').trim().toLowerCase())
        .filter(Boolean)
    );

    if (explicitBuckets.size === 1) {
      return {
        bucket: [...explicitBuckets][0],
        endpointHost: String(meaningfulRecords[0].endpoint_host || '').trim().toLowerCase(),
        profileId: String(meaningfulRecords[0].reference_profile_id || profile.id),
        isEmpty: false
      };
    }

    /* 兼容旧 CSV：从 cloud_url 推断 Bucket。*/
    const inferredBuckets = new Set(
      meaningfulRecords
        .map(record => inferBucketFromCloudUrl(record.cloud_url, this._endpointHost))
        .filter(Boolean)
    );

    if (inferredBuckets.size === 1) {
      return {
        bucket: [...inferredBuckets][0],
        endpointHost: this._endpointHost,
        profileId: profile.id,
        isEmpty: false,
        inferredFromLegacyUrl: true
      };
    }

    return {
      bucket: '',
      endpointHost: '',
      profileId: profile.id,
      isEmpty: false,
      ambiguous: true
    };
  }

  _validateLocalCsvScope(records, profile) {
    const scope = this._getLocalCsvScope(records, profile);
    
    if (scope.isEmpty) {
      return { valid: true, scope };
    }
    
    if (scope.ambiguous) {
      return {
        valid: false,
        code: 'OSS_CSV_SCOPE_AMBIGUOUS',
        message: '无法确认本地 CSV 所属 Bucket'
      };
    }

    if (scope.bucket && scope.bucket !== this._bucket.toLowerCase()) {
      return {
        valid: false,
        code: 'OSS_CSV_BUCKET_MISMATCH',
        message: `本地 CSV 属于 ${scope.bucket}，当前 Bucket 为 ${this._bucket}`
      };
    }
    
    if (scope.profileId && scope.profileId !== profile.id) {
      return {
        valid: false,
        code: 'OSS_CSV_PROFILE_MISMATCH',
        message: '本地 CSV 的模型索引类型不匹配'
      };
    }

    return { valid: true, scope };
  }

  // ==================== 哈希方法 ====================

  /**
   * SHA256 文件哈希（精确去重）
   * 与 Python hashlib.sha256() 100% 一致
   */
  getFileHash(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  /**
   * dHash 差值感知哈希（视觉去重）
   */
  async computeDHash(filePath) {
    try {
      const { data, info } = await sharp(filePath)
        .resize(17, 16, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let hash = 0n;
      for (let row = 0; row < 16; row++) {
        for (let col = 0; col < 16; col++) {
          const left  = data[row * 17 + col];
          const right = data[row * 17 + col + 1];
          if (left > right) {
            const bitIndex = row * 16 + col;
            hash |= (1n << BigInt(bitIndex));
          }
        }
      }

      return hash.toString(16).padStart(64, '0');
    } catch {
      return '';
    }
  }

  static hammingDistance(hash1, hash2) {
    if (hash1.length !== hash2.length) return 999;
    const x = BigInt('0x' + hash1) ^ BigInt('0x' + hash2);
    let count = 0;
    let n = x;
    while (n > 0n) {
      count += Number(n & 1n);
      n >>= 1n;
    }
    return count;
  }

  // ==================== CSV 管理 ====================

  _getCsvFile(profile) {
    // using SCRIPT_DIR or os temp? Wait, the previous code used SCRIPT_DIR
    return path.join(SCRIPT_DIR, profile.csvFilename);
  }

  _getCloudCsvPath(profile) {
    return profile.cloudCsvPath;
  }


  _loadRecords(profile) {
    const csvFile = this._getCsvFile(profile);
    if (!fs.existsSync(csvFile)) return [];
    const text = fs.readFileSync(csvFile, 'utf-8').trim();
    if (!text) return [];

    const lines = text.split('\n');
    const headers = lines[0].split(',');
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',');
      const record = {};
      headers.forEach((h, idx) => { record[h] = vals[idx] || ''; });
      records.push(record);
    }
    return records;
  }

  _upgradeCsvIfNeeded(records, profile, scopeCheck, localStat) {
    const csvFile = this._getCsvFile(profile);
    if (!fs.existsSync(csvFile)) {
      return;
    }
    const text = fs.readFileSync(csvFile, 'utf-8').trim();
    if (!text) {
      return;
    }
    const firstLine = text.split(/\r?\n/)[0];
    const currentHeaders = firstLine.split(',').map(item => item.trim());
    
    /*
     * 不仅检查列数，
     * 也检查字段名称和顺序。
     */
    const needsUpgrade = currentHeaders.length !== CSV_FIELDS.length || 
      CSV_FIELDS.some((field, index) => currentHeaders[index] !== field);

    if (!needsUpgrade) {
      return;
    }
    
    console.log(`[OSS] 发现旧版 CSV 表头，正在升级到 ${CSV_FIELDS.length} 列...`);
    
    const scope = scopeCheck?.scope;
    
    if (scopeCheck?.valid && scope && !scope.isEmpty) {
      records.forEach(record => {
        record.bucket = record.bucket || scope.bucket || this._bucket;
        record.endpoint_host = record.endpoint_host || scope.endpointHost || this._endpointHost;
        record.reference_profile_id = record.reference_profile_id || scope.profileId || profile.id;
      });
    }
    
    const headers = CSV_FIELDS.join(',');
    const lines = records.map(record => CSV_FIELDS.map(field => record[field] || '').join(','));
    
    const tempPath = `${csvFile}.tmp`;
    fs.writeFileSync(tempPath, headers + '\n' + lines.join('\n') + '\n', 'utf-8');
    fs.renameSync(tempPath, csvFile);
    
    if (localStat && localStat.mtime) {
      const time = new Date(localStat.mtime);
      try {
        fs.utimesSync(csvFile, time, time);
      } catch {
        // 修改时间恢复失败不阻断升级
      }
    }
    
    console.log('[OSS] 本地 CSV 表头升级完成');
  }

  async _appendRecord(record, profile) {
    const csvFile = this._getCsvFile(profile);
    
    if (fs.existsSync(csvFile)) {
      const records = this._loadRecords(profile);
      const scopeCheck = this._validateLocalCsvScope(records, profile);
      
      if (!scopeCheck.valid) {
        const error = new Error(scopeCheck.message || '本地 CSV 所属 Bucket 不匹配');
        error.code = scopeCheck.code || 'OSS_CSV_SCOPE_INVALID';
        throw error;
      }
      
      /*
       * 防止刚从云端下载回来的
       * CSV 仍是旧表头。
       */
      this._upgradeCsvIfNeeded(records, profile, scopeCheck, null);
    }
    
    const exists = fs.existsSync(csvFile);
    const headers = CSV_FIELDS.join(',');
    const values = CSV_FIELDS.map(field => record[field] || '').join(',');

    if (!exists) {
      fs.writeFileSync(csvFile, headers + '\n' + values + '\n', 'utf-8');
    } else {
      fs.appendFileSync(csvFile, values + '\n', 'utf-8');
    }
    console.log(`  [csv] 已记录 → ${csvFile}`);
    await this._syncCsvToOSS(profile);
  }

  async _rewriteRecords(records, profile) {
    const headers = CSV_FIELDS.join(',');
    const csvFile = this._getCsvFile(profile);
    const lines = records.map(r => CSV_FIELDS.map(f => r[f] || '').join(','));
    fs.writeFileSync(csvFile, headers + '\n' + lines.join('\n') + '\n', 'utf-8');
    await this._syncCsvToOSS(profile);
  }

  async _getCloudCsvStat(profile) {
    this._ensureOSS();
    try {
      const result = await this._client.head(profile.cloudCsvPath);
      return {
        exists: true,
        etag: result?.res?.headers?.etag || '',
        lastModified: new Date(result?.res?.headers['last-modified']).getTime()
      };
    } catch (error) {
      const status = Number(error?.status || error?.statusCode);
      if (status === 404 || error?.code === 'NoSuchKey') {
        return { exists: false };
      }
      throw error;
    }
  }

  _writeEmptyCsv(profile) {
    const csvFile = this._getCsvFile(profile);
    const headers = CSV_FIELDS.join(',');

    if (fs.existsSync(csvFile)) {
      const bakPath = `${csvFile}.bak`;
      fs.copyFileSync(csvFile, bakPath);
    }

    const tempPath = `${csvFile}.tmp`;
    fs.writeFileSync(tempPath, headers + '\n', 'utf-8');
    fs.renameSync(tempPath, csvFile);

    console.log(`[OSS] 已在本地写入空缓存 → ${csvFile}`);
  }

  async _mergeCurrentBucketCsv(profile, cloud, localRecords, originalLocalStat) {
    const csvFile = this._getCsvFile(profile);
    const localStat = originalLocalStat || (fs.existsSync(csvFile) ? { mtime: fs.statSync(csvFile).mtime.getTime() } : null);
    
    const cloudTime = cloud.lastModified;
    const localTime = localStat ? localStat.mtime : 0;
    
    if (cloudTime > localTime + 5000) {
      console.log(`[OSS] 云端 CSV 较新 (云:${new Date(cloudTime).toISOString()} > 本地:${new Date(localTime).toISOString()})，正在下载到本地...`);
      await this.restoreCsvFromOSS(profile);
    } else if (localTime > cloudTime + 5000) {
      console.log(`[OSS] 本地 CSV 较新 (本地:${new Date(localTime).toISOString()} > 云:${new Date(cloudTime).toISOString()})，正在同步到云端...`);
      await this._syncCsvToOSS(profile);
    }
  }

  async syncCsvBiDirectional(profile) {
    try {
      this._ensureOSS();
    } catch {
      return; // 缺少配置直接跳过
    }

    let cloud;
    try {
      cloud = await this._getCloudCsvStat(profile);
    } catch (e) {
      console.warn(`[OSS] 获取云端 CSV 状态发生错误:`, e);
      throw new Error(`获取云端 CSV 状态发生网络或权限错误，同步终止: ${e.message}`);
    }

    const localExists = fs.existsSync(this._getCsvFile(profile));
    const localStat = localExists ? { mtime: fs.statSync(this._getCsvFile(profile)).mtime.getTime() } : null;
    const localRecords = localExists ? this._loadRecords(profile) : [];
    
    const scopeCheck = this._validateLocalCsvScope(localRecords, profile);

    if (localExists && scopeCheck.valid) {
      this._upgradeCsvIfNeeded(localRecords, profile, scopeCheck, localStat);
    }

    if (cloud.exists) {
      if (!scopeCheck.valid) {
        console.log(`[OSS] ${scopeCheck.message}。正在下载当前 Bucket 的云端 CSV...`);
        await this.restoreCsvFromOSS(profile);
        return;
      }
      
      await this._mergeCurrentBucketCsv(profile, cloud, localRecords, localStat);
      return;
    }

    // 云端明确 404
    if (!localExists) {
      this._writeEmptyCsv(profile);
      return;
    }

    if (!scopeCheck.valid) {
      console.log(`[OSS] ${scopeCheck.message}。禁止上传。本地切换为空缓存。`);
      this._writeEmptyCsv(profile);
      return;
    }

    if (localRecords.length > 0) {
      console.log(`[OSS] 云端无 CSV 且本地作用域正确，正在上传到云端...`);
      await this._syncCsvToOSS(profile);
    }
  }

  async _syncCsvToOSS(profile) {
    this._ensureOSS();
    const csvFile = this._getCsvFile(profile);
    if (!fs.existsSync(csvFile)) return;
    try {
      const cloudCsvPath = this._getCloudCsvPath(profile);
      await this._client.put(cloudCsvPath, csvFile);
    } catch (err) {
      console.warn(`  [csv-backup] ⚠ 同步失败: ${err.message}`);
    }
  }

  async restoreCsvFromOSS(profile) {
    this._ensureOSS();
    try {
      const cloudCsvPath = this._getCloudCsvPath(profile);
      const result = await this._client.get(cloudCsvPath);
      const csvFile = this._getCsvFile(profile);
      if (fs.existsSync(csvFile)) {
        const bakPath = csvFile + '.bak';
        fs.copyFileSync(csvFile, bakPath);
      }
      fs.writeFileSync(csvFile, result.content);
    } catch (err) {
      throw new Error(`OSS 无备份或下载失败: ${err.message}`);
    }
  }

  async _removeRecordsBy(field, value, profile) {
    const records = this._loadRecords(profile);
    const before = records.length;
    const filtered = records.filter(r => r[field] !== value);
    if (filtered.length < before) {
      await this._rewriteRecords(filtered, profile);
    }
    return before - filtered.length;
  }

  findByHash(fileHash, profile) {
    return this._loadRecords(profile).find(r => r.file_hash === fileHash) || null;
  }

  findByLocalPath(localPath, profile) {
    const abs = path.resolve(localPath);
    return this._loadRecords(profile).find(r => r.local_path === abs) || null;
  }

  findByDHash(dhash, threshold = DHASH_THRESHOLD, profile) {
    if (!dhash) return [];
    const records = this._loadRecords(profile);
    const results = [];
    for (const r of records) {
      const rdHash = r.dhash;
      if (!rdHash) continue;
      const dist = OssImageUploader.hammingDistance(dhash, rdHash);
      if (dist <= threshold) {
        results.push({ distance: dist, record: r });
      }
    }
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  async findBestDHashMatch(filePath, threshold = DHASH_THRESHOLD, profile) {
    const dhash = await this.computeDHash(filePath);
    if (!dhash) return null;
    const matches = this.findByDHash(dhash, threshold, profile);
    if (matches.length === 0) return null;

    const best = matches[0];
    const record = best.record;
    
    const exists = await this._ossExists(record.cloud_path);
    if (!exists) {
      await this._removeRecordsBy('cloud_path', record.cloud_path, profile);
      return null;
    }
    return record;
  }

  async _ossExists(cloudPath) {
    this._ensureOSS();
    try {
      await this._client.head(cloudPath);
      return true;
    } catch (error) {
      const status = Number(error?.status || error?.statusCode);
      if (status === 404 || error?.code === 'NoSuchKey') {
        return false;
      }
      
      /*
       * 网络、权限、签名等问题
       * 不能被当成文件不存在。
       */
      throw error;
    }
  }

  async upload(filePath, options = {}) {
    const { force = false, threshold = DHASH_THRESHOLD, profileId, alreadyPrepared } = options;
    const profile = getOssReferenceProfile(profileId);
    let absPath = filePath;
    if (filePath.startsWith('file://')) {
      absPath = safeFileURLToPath(filePath);
    } else if (filePath.startsWith('local-img://')) {
      absPath = decodeURIComponent(filePath.replace('local-img://', ''));
    } else {
      absPath = path.resolve(filePath);
    }

    if (!fs.existsSync(absPath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const ext = path.extname(absPath).toLowerCase();
    const isCompressibleImage = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff'].includes(ext);

    const originalAbsPath = absPath;
    const fileHash = this.getFileHash(originalAbsPath);

    // 首先同步一遍 CSV，确保拿到最新的云端数据
    await this.syncCsvBiDirectional(profile);

    if (!force) {
      const existing = this.findByHash(fileHash, profile);
      if (existing) {
        const exists = await this._ossExists(existing.cloud_path);
        if (exists) return existing;
        else await this._removeRecordsBy('cloud_path', existing.cloud_path, profile);
      }

      const dhashMatch = await this.findBestDHashMatch(originalAbsPath, threshold, profile);
      if (dhashMatch) return dhashMatch;
    }

    // ==== 根据 Profile 压缩处理 ====
    let uploadPath = originalAbsPath;
    let isTempFile = false;

    if (isCompressibleImage) {
      if (alreadyPrepared && profile.format === 'jpeg') {
         // Grid 已经裁剪过并生成了 JPEG dataUrl，不要再重压了
      } else {
        try {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          if (profile.format === 'jpeg') {
            const jpegPath = path.join(os.tmpdir(), path.basename(originalAbsPath, ext) + '_' + uniqueSuffix + '.jpg');
            let pipeline = sharp(originalAbsPath).autoOrient();
            const metadata = await pipeline.metadata();
            if (metadata.hasAlpha) {
              pipeline = pipeline.flatten({ background: '#000000' });
            }
            await pipeline
              .jpeg({
                quality: profile.quality,
                chromaSubsampling: profile.chromaSubsampling || '4:4:4',
                mozjpeg: true
              })
              .toFile(jpegPath);
            uploadPath = jpegPath;
            isTempFile = true;
          } else {
            const webpPath = path.join(os.tmpdir(), path.basename(originalAbsPath, ext) + '_' + uniqueSuffix + '.webp');
            await sharp(originalAbsPath)
              .webp({ quality: profile.quality })
              .toFile(webpPath);
            uploadPath = webpPath;
            isTempFile = true;
          }
        } catch (err) {
          console.warn(`[OssImageUploader] 图片转换异常，退回原图上传: ${err.message}`);
        }
      }
    }
    // ==============================

    this._ensureOSS();

    const dateStr = new Date().toISOString().slice(0, 10);
    const shortHash = fileHash.slice(0, 12);
    const uploadFilename = path.basename(uploadPath);
    const localFilename = path.basename(originalAbsPath);
    const cloudFilename = `${shortHash}_${uploadFilename}`;
    const cloudPath = `${profile.prefix}/${dateStr}/${cloudFilename}`;
    const cloudUrl = `${this._domain}/${cloudPath}`;
    const fileSize = this._getFileSize(uploadPath);
    const dhash = await this.computeDHash(originalAbsPath);
    const now = new Date();

    let attempt = 0;
    let lastError;
    let uploadResult = null;
    while (attempt < 3) {
      try {
        uploadResult = await this._client.put(cloudPath, uploadPath);
        if (!uploadResult || (!uploadResult.url && !uploadResult.res)) throw new Error('上传返回结果异常');
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        attempt++;
        if (attempt < 3) {
           await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) + Math.random() * 500));
        }
      }
    }
    
    if (lastError) {
      if (isTempFile && fs.existsSync(uploadPath)) {
        try { fs.unlinkSync(uploadPath); } catch (e) {}
      }
      throw new Error(`上传失败: ${lastError.message}`);
    }

    // 上传成功后，删除临时生成的 webp 文件
    if (isTempFile && fs.existsSync(uploadPath)) {
      try { 
         fs.unlinkSync(uploadPath); 
      } catch (e) {
         console.warn(`[OssImageUploader] 删除临时文件失败: ${e.message}`);
      }
    }

    const finalCloudUrl = uploadResult?.url || `${this._domainRaw}/${cloudPath}`;

    const record = {
      local_path: originalAbsPath,
      file_hash: fileHash,
      dhash: dhash,
      file_size: String(fileSize),
      local_filename: localFilename,
      cloud_filename: cloudFilename,
      cloud_path: cloudPath,
      cloud_url: finalCloudUrl,
      upload_date: dateStr,
      upload_time: now.toISOString(),
      bucket: this._bucket,
      endpoint_host: this._endpointHost,
      reference_profile_id: profile.id
    };

    await this._appendRecord(record, profile);
    return record;
  }

  _getFileSize(filePath) {
    return fs.statSync(filePath).size;
  }
}

export { OssImageUploader, CSV_FIELDS, DHASH_THRESHOLD };
