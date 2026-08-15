import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SKILLS_DIR = path.join(__dirname, 'skills');
const REGISTRY_FILE = 'registry.json';
const CATALOG_FILE = 'catalog.json';
const SOURCE_FILE = '.skill-source.json';
const MAX_INSTALL_FILES = 200;
const MAX_INSTALL_BYTES = 20 * 1024 * 1024;
const MAX_GITHUB_RETRIES = 3;
const TEXT_REFERENCE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function stripQuotes(value = '') {
  const text = String(value).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseSkillFrontmatter(content = '') {
  const match = String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) result[m[1]] = stripQuotes(m[2]);
  }
  return result;
}

function parseOpenAiUiMetadata(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  const get = (key) => {
    const match = text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
    return match ? stripQuotes(match[1]) : '';
  };
  return {
    displayName: get('display_name'),
    shortDescription: get('short_description'),
    defaultPrompt: get('default_prompt')
  };
}

function normalizeRelativePath(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

function listFilesRecursive(dirPath, baseDir = dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const output = [];
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) output.push({ fullPath, relativePath: normalizeRelativePath(baseDir, fullPath) });
    }
  }
  return output.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function findSkillDirectories(rootDir) {
  ensureDir(rootDir);
  const found = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    const hasSkill = entries.some(entry => entry.isFile() && entry.name.toLowerCase() === 'skill.md');
    if (hasSkill) {
      found.push(current);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      stack.push(path.join(current, entry.name));
    }
  }
  return found.sort();
}

function escapeXmlAttribute(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isRetryableGithubError(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.statusCode || 0);
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED', 'EPIPE'].includes(code) ||
    [408, 425, 429].includes(status) ||
    status >= 500;
}

function httpsGetBuffer(url, headers = {}, attempt = 0) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const retryOrReject = (error) => {
      if (finished) return;
      finished = true;
      if (attempt < MAX_GITHUB_RETRIES && isRetryableGithubError(error)) {
        const delay = 500 * (2 ** attempt);
        setTimeout(() => {
          httpsGetBuffer(url, headers, attempt + 1).then(resolve, reject);
        }, delay);
        return;
      }
      if (attempt > 0 && error instanceof Error) {
        error.message += `（已自动重试 ${attempt} 次）`;
      }
      reject(error);
    };

    const request = https.get(url, {
      headers: {
        'User-Agent': 'Hongs-AI-Table-Studio-Skill-Installer',
        'Accept': 'application/vnd.github+json',
        ...headers
      }
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        finished = true;
        response.resume();
        httpsGetBuffer(response.headers.location, headers, attempt).then(resolve, reject);
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('aborted', () => {
        const error = new Error('GitHub response was interrupted');
        error.code = 'ECONNRESET';
        retryOrReject(error);
      });
      response.on('error', retryOrReject);
      response.on('end', () => {
        if (finished) return;
        const buffer = Buffer.concat(chunks);
        if (status < 200 || status >= 300) {
          const error = new Error(`GitHub request failed (${status}): ${buffer.toString('utf8').slice(0, 300)}`);
          error.statusCode = status;
          retryOrReject(error);
          return;
        }
        finished = true;
        resolve(buffer);
      });
    });
    request.on('error', retryOrReject);
    request.setTimeout(30000, () => {
      const error = new Error('GitHub request timed out');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
  });
}

async function httpsGetJson(url) {
  const buffer = await httpsGetBuffer(url);
  return JSON.parse(buffer.toString('utf8'));
}

function parseGithubSkillUrl(inputUrl) {
  let url;
  try {
    url = new URL(String(inputUrl || '').trim());
  } catch {
    throw new Error('请输入有效的 GitHub Skill 地址。');
  }
  if (url.hostname !== 'github.com') throw new Error('Skill v1.0 目前仅支持 github.com 公开仓库。');
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 5 || segments[2] !== 'tree') {
    throw new Error('请使用 GitHub 目录地址，例如 https://github.com/owner/repo/tree/main/skills/example-skill');
  }
  const [owner, repo, , ref, ...skillPathParts] = segments;
  const skillPath = skillPathParts.join('/');
  if (!owner || !repo || !ref || !skillPath) throw new Error('无法解析 GitHub Skill 地址。');
  return {
    owner,
    repo: repo.replace(/\.git$/i, ''),
    ref,
    skillPath,
    folderName: skillPathParts[skillPathParts.length - 1],
    sourceUrl: `https://github.com/${owner}/${repo.replace(/\.git$/i, '')}/tree/${ref}/${skillPath}`
  };
}

export class SkillManager {
  constructor({ rootDir = DEFAULT_SKILLS_DIR } = {}) {
    this.rootDir = rootDir;
    this.registryPath = path.join(rootDir, REGISTRY_FILE);
    this.catalogPath = path.join(rootDir, CATALOG_FILE);
    ensureDir(this.rootDir);
  }

  _readRegistry() {
    const registry = readJson(this.registryPath, { version: 1, skills: {} });
    if (!registry.skills || typeof registry.skills !== 'object') registry.skills = {};
    return registry;
  }

  _writeRegistry(registry) {
    writeJson(this.registryPath, registry);
  }

  _readCatalog() {
    const catalog = readJson(this.catalogPath, []);
    return Array.isArray(catalog) ? catalog : [];
  }

  _describeSkill(skillDir, registryEntry = null) {
    const skillFile = path.join(skillDir, 'SKILL.md');
    const content = fs.readFileSync(skillFile, 'utf8');
    const frontmatter = parseSkillFrontmatter(content);
    const ui = parseOpenAiUiMetadata(path.join(skillDir, 'agents', 'openai.yaml'));
    const sourceMeta = readJson(path.join(skillDir, SOURCE_FILE), null);
    const relativePath = normalizeRelativePath(this.rootDir, skillDir);
    const allFiles = listFilesRecursive(skillDir, skillDir);
    const referenceFiles = allFiles.filter(file => file.relativePath.startsWith('references/'));
    const scriptFiles = allFiles.filter(file => file.relativePath.startsWith('scripts/'));
    const assetFiles = allFiles.filter(file => file.relativePath.startsWith('assets/'));
    const displayName = String(ui.displayName || frontmatter.display_name || frontmatter.name || path.basename(skillDir)).trim();
    return {
      id: String(frontmatter.name || path.basename(skillDir)).trim(),
      displayName,
      description: String(ui.shortDescription || frontmatter.description || '').trim(),
      compatibility: String(frontmatter.compatibility || '').trim(),
      defaultPrompt: String(ui.defaultPrompt || '').trim(),
      relativePath,
      enabled: registryEntry?.enabled !== false,
      isNew: !registryEntry,
      source: sourceMeta || { type: 'custom', label: 'Custom' },
      fileCount: allFiles.length,
      referenceCount: referenceFiles.length,
      hasScripts: scriptFiles.length > 0,
      hasAssets: assetFiles.length > 0,
      duplicateDisplayName: false
    };
  }

  scanSkills() {
    ensureDir(this.rootDir);
    const registry = this._readRegistry();
    const registryBeforeScan = JSON.stringify(registry);
    const skillDirs = findSkillDirectories(this.rootDir);
    const skills = skillDirs.map(skillDir => {
      const relativePath = normalizeRelativePath(this.rootDir, skillDir);
      return this._describeSkill(skillDir, registry.skills[relativePath] || null);
    });

    const nameCounts = new Map();
    for (const skill of skills) {
      const key = skill.displayName.toLocaleLowerCase();
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    for (const skill of skills) {
      skill.duplicateDisplayName = (nameCounts.get(skill.displayName.toLocaleLowerCase()) || 0) > 1;
      const existing = registry.skills[skill.relativePath] || {};
      registry.skills[skill.relativePath] = {
        ...existing,
        enabled: existing.enabled !== false,
        displayName: skill.displayName,
        id: skill.id
      };
    }

    for (const key of Object.keys(registry.skills)) {
      if (!skills.some(skill => skill.relativePath === key)) {
        delete registry.skills[key];
      }
    }
    // Scanning is also used by read-only UI actions. Only persist when the
    // registry actually changed so Vite does not reload the Electron renderer.
    if (JSON.stringify(registry) !== registryBeforeScan) {
      this._writeRegistry(registry);
    }

    const catalog = this._readCatalog().map(item => {
      const installed = skills.some(skill =>
        (skill.source?.url && item.sourceUrl && skill.source.url === item.sourceUrl) ||
        (item.displayName && skill.displayName === item.displayName)
      );
      return { ...item, installed };
    });

    return {
      rootPath: this.rootDir,
      skills,
      catalog
    };
  }

  setSkillEnabled(relativePath, enabled) {
    const cleanRelativePath = String(relativePath || '').replace(/\\/g, '/');
    const registry = this._readRegistry();
    if (!registry.skills[cleanRelativePath]) {
      this.scanSkills();
    }
    const refreshed = this._readRegistry();
    if (!refreshed.skills[cleanRelativePath]) throw new Error('Skill 未注册，请先扫描 Skill 目录。');
    refreshed.skills[cleanRelativePath].enabled = Boolean(enabled);
    this._writeRegistry(refreshed);
    return this.scanSkills();
  }

  uninstallSkill(relativePath) {
    const cleanRelativePath = String(relativePath || '').trim().replace(/\\/g, '/');
    if (!cleanRelativePath || path.isAbsolute(cleanRelativePath) || cleanRelativePath.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Skill 路径无效，无法卸载。');
    }

    const state = this.scanSkills();
    const skill = state.skills.find(item => item.relativePath === cleanRelativePath);
    if (!skill) throw new Error('Skill 未注册或已经被移除。');

    const rootPath = path.resolve(this.rootDir);
    const skillPath = path.resolve(this.rootDir, ...cleanRelativePath.split('/'));
    const pathInsideRoot = path.relative(rootPath, skillPath);
    if (!pathInsideRoot || pathInsideRoot.startsWith('..') || path.isAbsolute(pathInsideRoot)) {
      throw new Error('Skill 路径超出项目 skills 目录，已拒绝卸载。');
    }
    if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
      throw new Error('目标目录中没有 SKILL.md，已拒绝卸载。');
    }

    fs.rmSync(skillPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200
    });
    return this.scanSkills();
  }

  compileSkillContext({ displayName, runtimeContext = {}, userTask = '' } = {}) {
    const requestedName = String(displayName || '').trim();
    if (!requestedName) return { fullPrompt: String(userTask || ''), skill: null };

    const { skills } = this.scanSkills();
    const matches = skills.filter(skill => skill.displayName.toLocaleLowerCase() === requestedName.toLocaleLowerCase());
    if (matches.length === 0) throw new Error(`未找到 Skill：${requestedName}。请前往“API 和模型配置 → Skills”扫描或安装。`);
    if (matches.length > 1 || matches[0].duplicateDisplayName) {
      throw new Error(`Skill 显示名冲突：${requestedName}。Skill v1.0 要求显示名唯一，请处理重复 Skill 后再运行。`);
    }
    const skill = matches[0];
    if (!skill.enabled) throw new Error(`Skill 已停用：${skill.displayName}。请前往 Skill 管理重新启用。`);

    const skillDir = path.join(this.rootDir, ...skill.relativePath.split('/'));
    const skillMd = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const referenceRoot = path.join(skillDir, 'references');
    const references = listFilesRecursive(referenceRoot, skillDir)
      .filter(file => file.relativePath.startsWith('references/'))
      .filter(file => TEXT_REFERENCE_EXTENSIONS.has(path.extname(file.fullPath).toLowerCase()))
      .map(file => ({ path: file.relativePath, content: fs.readFileSync(file.fullPath, 'utf8') }));

    const resourceText = references.length
      ? references.map(ref => [
          `<skill_file path="${escapeXmlAttribute(ref.path)}" role="supporting_reference">`,
          'This file is supporting documentation. Examples inside it demonstrate format and conventions; do not copy example-specific subjects, scenes, timing, or story content unless the current task asks for them.',
          ref.content,
          '</skill_file>'
        ].join('\n')).join('\n\n')
      : 'None';

    const contextJson = JSON.stringify(runtimeContext || {}, null, 2);
    const fullPrompt = [
      '<skill_runtime version="1.0" mode="preloaded_structured_context">',
      'You are executing one installed Skill. The Skill instructions define the working method. Supporting reference files are documentation, not the current user task. Use the current task at the end of this message as the actual objective. Do not invent missing facts from examples. Return only the result requested by the current task unless the Skill explicitly requires a different output format.',
      '</skill_runtime>',
      '',
      '<skill_context>',
      `<skill_metadata display_name="${escapeXmlAttribute(skill.displayName)}" id="${escapeXmlAttribute(skill.id)}" path="${escapeXmlAttribute(skill.relativePath)}" />`,
      '<skill_instructions source="SKILL.md">',
      skillMd,
      '</skill_instructions>',
      '<skill_resources>',
      resourceText,
      '</skill_resources>',
      '</skill_context>',
      '',
      '<runtime_context>',
      contextJson,
      '</runtime_context>',
      '',
      '<current_task>',
      String(userTask || ''),
      '</current_task>'
    ].join('\n');

    return {
      fullPrompt,
      skill: {
        id: skill.id,
        displayName: skill.displayName,
        relativePath: skill.relativePath,
        referenceCount: references.length
      }
    };
  }

  async installFromGithub(inputUrl) {
    const parsed = parseGithubSkillUrl(inputUrl);
    const finalDir = path.join(this.rootDir, parsed.folderName);
    if (fs.existsSync(finalDir)) throw new Error(`Skill 目录已存在：${parsed.folderName}。请先移除或改名后再安装。`);

    const tempDir = path.join(this.rootDir, `.installing-${parsed.folderName}-${Date.now()}`);
    ensureDir(tempDir);
    let fileCount = 0;
    let totalBytes = 0;

    const downloadDirectory = async (repoPath, localDir) => {
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${repoPath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(parsed.ref)}`;
      const entries = await httpsGetJson(apiUrl);
      if (!Array.isArray(entries)) throw new Error('GitHub 返回的 Skill 目录结构无效。');
      for (const entry of entries) {
        if (entry.type === 'dir') {
          const nextDir = path.join(localDir, entry.name);
          ensureDir(nextDir);
          await downloadDirectory(entry.path, nextDir);
        } else if (entry.type === 'file' && entry.download_url) {
          fileCount += 1;
          if (fileCount > MAX_INSTALL_FILES) throw new Error(`Skill 文件数量超过 ${MAX_INSTALL_FILES} 个，已停止安装。`);
          const buffer = await httpsGetBuffer(entry.download_url, { 'Accept': '*/*' });
          totalBytes += buffer.length;
          if (totalBytes > MAX_INSTALL_BYTES) throw new Error('Skill 总大小超过 20 MB，已停止安装。');
          fs.writeFileSync(path.join(localDir, entry.name), buffer);
        }
      }
    };

    try {
      await downloadDirectory(parsed.skillPath, tempDir);
      if (!fs.existsSync(path.join(tempDir, 'SKILL.md'))) throw new Error('下载目录中未发现 SKILL.md，无法注册为 Skill。');
      writeJson(path.join(tempDir, SOURCE_FILE), {
        type: 'github',
        label: 'GitHub',
        url: parsed.sourceUrl,
        repository: `${parsed.owner}/${parsed.repo}`,
        path: parsed.skillPath,
        ref: parsed.ref,
        installedAt: new Date().toISOString()
      });
      fs.renameSync(tempDir, finalDir);
      const state = this.scanSkills();
      const installedSkill = state.skills.find(skill => skill.relativePath === parsed.folderName) || null;
      return { ...state, installedSkill };
    } catch (error) {
      const installError = error instanceof Error ? error : new Error(String(error));
      try {
        // Windows may briefly keep downloaded files open (for example through
        // file watching or antivirus scanning). Retry cleanup instead of
        // replacing the actual installation error with ENOTEMPTY/EPERM.
        fs.rmSync(tempDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200
        });
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        installError.message += `\n临时目录清理失败，可稍后手动删除：${tempDir}\n${cleanupMessage}`;
      }
      throw installError;
    }
  }
}

export function createSkillManager(options) {
  return new SkillManager(options);
}
