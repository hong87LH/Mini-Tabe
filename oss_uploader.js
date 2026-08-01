import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { getOssReferenceProfile } from './oss_reference_profiles.js';


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
    this._endpoint = ossConfig?.endpoint || process.env.OSS_ENDPOINT || 'https://oss-cn-beijing.aliyuncs.com';
    this._bucket = ossConfig?.bucket || process.env.OSS_BUCKET;
    this._domainRaw = ossConfig?.domain || process.env.OSS_DOMAIN;

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

  async _appendRecord(record, profile) {
    const csvFile = this._getCsvFile(profile);
    const exists = fs.existsSync(csvFile);
    const headers = CSV_FIELDS.join(',');
    const values = CSV_FIELDS.map(f => record[f] || '').join(',');

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

  async syncCsvBiDirectional(profile) {
    try {
      this._ensureOSS();
    } catch {
      return; // 缺少配置直接跳过
    }

    let cloudStat = null;
    try {
      const cloudCsvPath = this._getCloudCsvPath(profile);
      const result = await this._client.head(cloudCsvPath);
      if (result && result.res && result.res.headers) {
         cloudStat = { lastModified: new Date(result.res.headers['last-modified']).getTime() };
      }
    } catch (e) {
      // 云端无文件或网络错误
    }

    const csvFile = this._getCsvFile(profile);
    const localExists = fs.existsSync(csvFile);
    let localStat = null;
    if (localExists) {
      localStat = { mtime: fs.statSync(csvFile).mtime.getTime() };
    }

    if (!cloudStat && !localExists) return;

    if (!cloudStat && localExists) {
      await this._syncCsvToOSS(profile);
      return;
    }

    if (cloudStat && !localExists) {
      await this.restoreCsvFromOSS(profile);
      return;
    }

    // 都存在，对比时间，给予 5 秒缓冲 (5000 ms) 避免时钟微小偏差导致疯狂往返
    const cloudTime = cloudStat.lastModified;
    const localTime = localStat.mtime;

    if (cloudTime > localTime + 5000) {
      console.log(`[OSS] 云端 CSV 较新 (云:${new Date(cloudTime).toISOString()} > 本地:${new Date(localTime).toISOString()})，正在下载到本地...`);
      await this.restoreCsvFromOSS(profile);
    } else if (localTime > cloudTime + 5000) {
      console.log(`[OSS] 本地 CSV 较新 (本地:${new Date(localTime).toISOString()} > 云:${new Date(cloudTime).toISOString()})，正在同步到云端...`);
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
      await this._removeRecordsBy('cloud_path', record.cloud_path);
      return null;
    }
    return record;
  }

  async _ossExists(cloudPath) {
    this._ensureOSS();
    try {
      return await this._client.head(cloudPath).then(() => true).catch(() => false);
    } catch {
      return false;
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
    while (attempt < 3) {
      try {
        const result = await this._client.put(cloudPath, uploadPath);
        if (!result || !result.url) throw new Error('上传返回结果异常');
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

    const record = {
      local_path: originalAbsPath,
      file_hash: fileHash,
      dhash: dhash,
      file_size: String(fileSize),
      local_filename: localFilename,
      cloud_filename: cloudFilename,
      cloud_path: cloudPath,
      cloud_url: cloudUrl,
      upload_date: dateStr,
      upload_time: now.toISOString(),
    };

    await this._appendRecord(record, profile);
    return record;
  }

  _getFileSize(filePath) {
    return fs.statSync(filePath).size;
  }
}

export { OssImageUploader, CSV_FIELDS, DHASH_THRESHOLD };
