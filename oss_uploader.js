import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';
import sharp from 'sharp';
import dotenv from 'dotenv';

// ============================================================
//  路径与常量
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);

// 加载 .env（优先脚本目录，回退 CWD）
dotenv.config({ path: path.join(SCRIPT_DIR, '.env') });
dotenv.config();

const CSV_FILE = path.join(SCRIPT_DIR, 'oss_references_node.csv');

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

const OSS_PREFIX = 'references-node';   // 独立前缀，不与 Python 版混用
const DHASH_THRESHOLD = 10;             // dHash Hamming 距离阈值
const CSV_BACKUP_PATH = `${OSS_PREFIX}/oss_references_node.csv`;  // OSS 备份路径

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
        .resize(9, 8, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let hash = 0n;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const left  = data[row * 9 + col];
          const right = data[row * 9 + col + 1];
          if (left > right) {
            const bitIndex = row * 8 + col;
            hash |= (1n << BigInt(bitIndex));
          }
        }
      }

      return hash.toString(16).padStart(16, '0');
    } catch {
      return '';
    }
  }

  static hammingDistance(hash1, hash2) {
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

  _loadRecords() {
    if (!fs.existsSync(CSV_FILE)) return [];
    const text = fs.readFileSync(CSV_FILE, 'utf-8').trim();
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

  async _appendRecord(record) {
    const exists = fs.existsSync(CSV_FILE);
    const headers = CSV_FIELDS.join(',');
    const values = CSV_FIELDS.map(f => record[f] || '').join(',');

    if (!exists) {
      fs.writeFileSync(CSV_FILE, headers + '\n' + values + '\n', 'utf-8');
    } else {
      fs.appendFileSync(CSV_FILE, values + '\n', 'utf-8');
    }
    console.log(`  [csv] 已记录 → ${CSV_FILE}`);
    await this._syncCsvToOSS();
  }

  async _rewriteRecords(records) {
    const headers = CSV_FIELDS.join(',');
    const lines = records.map(r => CSV_FIELDS.map(f => r[f] || '').join(','));
    fs.writeFileSync(CSV_FILE, headers + '\n' + lines.join('\n') + '\n', 'utf-8');
    await this._syncCsvToOSS();
  }

  async syncCsvBiDirectional() {
    try {
      this._ensureOSS();
    } catch {
      return; // 缺少配置直接跳过
    }

    let cloudStat = null;
    try {
      const result = await this._client.head(CSV_BACKUP_PATH);
      if (result && result.res && result.res.headers) {
         cloudStat = { lastModified: new Date(result.res.headers['last-modified']).getTime() };
      }
    } catch (e) {
      // 云端无文件或网络错误
    }

    const localExists = fs.existsSync(CSV_FILE);
    let localStat = null;
    if (localExists) {
      localStat = { mtime: fs.statSync(CSV_FILE).mtime.getTime() };
    }

    if (!cloudStat && !localExists) return;

    if (!cloudStat && localExists) {
      await this._syncCsvToOSS();
      return;
    }

    if (cloudStat && !localExists) {
      await this.restoreCsvFromOSS();
      return;
    }

    // 都存在，对比时间，给予 5 秒缓冲 (5000 ms) 避免时钟微小偏差导致疯狂往返
    const cloudTime = cloudStat.lastModified;
    const localTime = localStat.mtime;

    if (cloudTime > localTime + 5000) {
      console.log(`[OSS] 云端 CSV 较新 (云:${new Date(cloudTime).toISOString()} > 本地:${new Date(localTime).toISOString()})，正在下载到本地...`);
      await this.restoreCsvFromOSS();
    } else if (localTime > cloudTime + 5000) {
      console.log(`[OSS] 本地 CSV 较新 (本地:${new Date(localTime).toISOString()} > 云:${new Date(cloudTime).toISOString()})，正在同步到云端...`);
      await this._syncCsvToOSS();
    }
  }

  async _syncCsvToOSS() {
    this._ensureOSS();
    if (!fs.existsSync(CSV_FILE)) return;
    try {
      await this._client.put(CSV_BACKUP_PATH, CSV_FILE);
    } catch (err) {
      console.warn(`  [csv-backup] ⚠ 同步失败: ${err.message}`);
    }
  }

  async restoreCsvFromOSS() {
    this._ensureOSS();
    try {
      const result = await this._client.get(CSV_BACKUP_PATH);
      if (fs.existsSync(CSV_FILE)) {
        const bakPath = CSV_FILE + '.bak';
        fs.copyFileSync(CSV_FILE, bakPath);
      }
      fs.writeFileSync(CSV_FILE, result.content);
    } catch (err) {
      throw new Error(`OSS 无备份或下载失败: ${err.message}`);
    }
  }

  async _removeRecordsBy(field, value) {
    const records = this._loadRecords();
    const before = records.length;
    const filtered = records.filter(r => r[field] !== value);
    if (filtered.length < before) {
      await this._rewriteRecords(filtered);
    }
    return before - filtered.length;
  }

  findByHash(fileHash) {
    return this._loadRecords().find(r => r.file_hash === fileHash) || null;
  }

  findByLocalPath(localPath) {
    const abs = path.resolve(localPath);
    return this._loadRecords().find(r => r.local_path === abs) || null;
  }

  findByDHash(dhash, threshold = DHASH_THRESHOLD) {
    if (!dhash) return [];
    const records = this._loadRecords();
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

  async findBestDHashMatch(filePath, threshold = DHASH_THRESHOLD) {
    const dhash = await this.computeDHash(filePath);
    if (!dhash) return null;
    const matches = this.findByDHash(dhash, threshold);
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
      return await this._client.get(cloudPath).then(() => true).catch(() => false);
    } catch {
      return false;
    }
  }

  async upload(filePath, options = {}) {
    const { force = false, threshold = DHASH_THRESHOLD } = options;
    let absPath = filePath;
    if (filePath.startsWith('file://')) {
      absPath = fileURLToPath(filePath);
    } else if (filePath.startsWith('local-img://')) {
      absPath = decodeURIComponent(filePath.replace('local-img://', ''));
    } else {
      absPath = path.resolve(filePath);
    }

    if (!fs.existsSync(absPath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    // ==== 转换为 WEBP 压缩处理 ====
    const ext = path.extname(absPath).toLowerCase();
    const isCompressibleImage = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff'].includes(ext);

    if (isCompressibleImage) {
      try {
        const webpPath = path.join(path.dirname(absPath), path.basename(absPath, ext) + '.webp');
        const tempPath = webpPath + '.tmp';
        
        await sharp(absPath)
          .resize({ width: 3072, withoutEnlargement: true }) // 限制最大宽度为 3K
          .webp({ quality: 85, effort: 4 })                  // 高质量 webp
          .toFile(tempPath);
          
        fs.renameSync(tempPath, webpPath);
        absPath = webpPath; // 将实际上传和记录的路径替换为 webp 版本
      } catch (err) {
        console.warn(`[OssImageUploader] WEBP 转换异常，退回原图上传: ${err.message}`);
      }
    }
    // ==============================

    const fileHash = this.getFileHash(absPath);

    // 首先同步一遍 CSV，确保拿到最新的云端数据
    await this.syncCsvBiDirectional();

    if (!force) {
      const existing = this.findByHash(fileHash);
      if (existing) {
        const exists = await this._ossExists(existing.cloud_path);
        if (exists) return existing;
        else await this._removeRecordsBy('cloud_path', existing.cloud_path);
      }

      const dhashMatch = await this.findBestDHashMatch(absPath, threshold);
      if (dhashMatch) return dhashMatch;
    }

    this._ensureOSS();

    const dateStr = new Date().toISOString().slice(0, 10);
    const shortHash = fileHash.slice(0, 12);
    const localFilename = path.basename(absPath);
    const cloudFilename = `${shortHash}_${localFilename}`;
    const cloudPath = `${OSS_PREFIX}/${dateStr}/${cloudFilename}`;
    const cloudUrl = `${this._domain}/${cloudPath}`;
    const fileSize = this._getFileSize(absPath);
    const dhash = await this.computeDHash(absPath);
    const now = new Date();

    try {
      const result = await this._client.put(cloudPath, absPath);
      if (!result || !result.url) throw new Error('上传返回结果异常');
    } catch (err) {
      throw new Error(`上传失败: ${err.message}`);
    }

    const record = {
      local_path: absPath,
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

    await this._appendRecord(record);
    return record;
  }

  _getFileSize(filePath) {
    return fs.statSync(filePath).size;
  }
}

export { OssImageUploader, CSV_FILE, CSV_FIELDS, DHASH_THRESHOLD, OSS_PREFIX };
