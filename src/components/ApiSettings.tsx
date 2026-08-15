import React, { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Database, Server, Image as ImageIcon, Video, Download, Upload, ServerCrash, Cpu, Eye, EyeOff, BookOpen, RefreshCw, Github } from 'lucide-react';

function buildStandardOssDomain(endpoint: string, bucket: string): string {
  const cleanBucket = String(bucket || '').trim();
  if (!cleanBucket) return '';
  const rawEndpoint = String(endpoint || '').trim();
  const normalizedEndpoint = /^https?:\/\//i.test(rawEndpoint) ? rawEndpoint : `https://${rawEndpoint}`;
  try {
    const endpointUrl = new URL(normalizedEndpoint);
    return `${endpointUrl.protocol}//${cleanBucket}.${endpointUrl.host}`;
  } catch {
    return '';
  }
}

const BYTES_PER_GB = 1024 ** 3;

function bytesToGb(bytes: unknown): number {
  const value = Number(bytes);
  return Number.isFinite(value) && value > 0 ? value / BYTES_PER_GB : 0;
}

function formatGb(value: number): string {
  return `${value.toFixed(2)} GB`;
}

function formatUsageTimestamp(value: unknown, lang: 'en' | 'zh'): string {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--';

  return new Date(timestamp).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}


type ProviderCategory = 'text' | 'image' | 'video';

const parseProviderModels = (provider: any): string[] => {
  return String(provider?.modelName || '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
};

const isProviderEnabled = (provider: any): boolean => {
  return provider?.enabled !== false;
};

const hasModelOverlap = (firstProvider: any, secondProvider: any): boolean => {
  const firstModels = new Set(parseProviderModels(firstProvider));
  return parseProviderModels(secondProvider).some(model => firstModels.has(model));
};

export function ApiSettings({ modelSettings, setModelSettings, lang }: any) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [psPath, setPsPath] = useState(localStorage.getItem('bitable_ps_path') || '');
  const [comfyuiBatPath, setComfyuiBatPath] = useState(localStorage.getItem('bitable_comfyui_bat_path') || '');
  const [storageData, setStorageData] = useState<any>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'api' | 'skills'>('api');
  const [skillState, setSkillState] = useState<any>({ skills: [], catalog: [], rootPath: '' });
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillInstallUrl, setSkillInstallUrl] = useState('');
  const [skillInstallBusy, setSkillInstallBusy] = useState(false);
  const [skillRemovingPath, setSkillRemovingPath] = useState('');
  const [installedSkillsExpanded, setInstalledSkillsExpanded] = useState(true);
  const [skillLibraryExpanded, setSkillLibraryExpanded] = useState(true);
  const [skillError, setSkillError] = useState('');

  const toggleExpand = (id: string) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const loadSkills = async () => {
    const api = (window as any).electronAPI;
    if (!api?.listSkills) {
      setSkillState({ skills: [], catalog: [], rootPath: '' });
      setSkillError(lang === 'en' ? 'Skill System requires the Electron desktop client.' : 'Skill System 需要 Electron 桌面端。');
      return;
    }
    setSkillLoading(true);
    setSkillError('');
    try {
      const state = await api.listSkills();
      setSkillState(state || { skills: [], catalog: [], rootPath: '' });
    } catch (error: any) {
      setSkillError(error?.message || String(error));
    } finally {
      setSkillLoading(false);
    }
  };

  const installSkillFromGithub = async (sourceUrl: string) => {
    const url = String(sourceUrl || '').trim();
    if (!url) return;
    const api = (window as any).electronAPI;
    if (!api?.installSkillFromGithub) {
      setSkillError(lang === 'en' ? 'Skill installation requires Electron.' : 'Skill 安装需要 Electron 桌面端。');
      return;
    }
    setSkillInstallBusy(true);
    setSkillError('');
    try {
      const state = await api.installSkillFromGithub(url);
      setSkillState(state || { skills: [], catalog: [], rootPath: '' });
      setSkillInstallUrl('');
    } catch (error: any) {
      setSkillError(error?.message || String(error));
    } finally {
      setSkillInstallBusy(false);
    }
  };

  const toggleSkillEnabled = async (skill: any) => {
    const api = (window as any).electronAPI;
    if (!api?.setSkillEnabled) return;
    setSkillError('');
    try {
      const state = await api.setSkillEnabled(skill.relativePath, !skill.enabled);
      setSkillState(state || skillState);
    } catch (error: any) {
      setSkillError(error?.message || String(error));
    }
  };

  const uninstallSkill = async (skill: any) => {
    const api = (window as any).electronAPI;
    if (!api?.uninstallSkill) {
      setSkillError(lang === 'en' ? 'Skill uninstall requires the Electron desktop client.' : 'Skill 卸载需要 Electron 桌面端。');
      return;
    }
    const confirmed = window.confirm(
      lang === 'en'
        ? `Uninstall “${skill.displayName}”? The Skill folder and all files inside it will be permanently deleted.`
        : `确定卸载“${skill.displayName}”吗？该 Skill 文件夹及其中全部文件将被永久删除。`
    );
    if (!confirmed) return;

    setSkillRemovingPath(skill.relativePath);
    setSkillError('');
    try {
      const state = await api.uninstallSkill(skill.relativePath);
      setSkillState(state || { skills: [], catalog: [], rootPath: '' });
    } catch (error: any) {
      setSkillError(error?.message || String(error));
    } finally {
      setSkillRemovingPath('');
    }
  };

  useEffect(() => {
    if (settingsTab === 'skills') loadSkills();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsTab]);
  
  const checkOssStorage = async () => {
    if (!ossConfig.accessKeyId) {
      alert(lang === 'en' ? 'Please fill OSS config first' : '请先填写OSS配置');
      return;
    }
    setStorageLoading(true);
    try {
      const res = await (window as any).electronAPI.checkOssStorage(ossConfig);
      setStorageData(res);
    } catch (e: any) {
      alert(e.message || 'Check failed');
    } finally {
      setStorageLoading(false);
    }
  };

  const cleanupOssStorage = async () => {
    if (!ossConfig.accessKeyId) return;
    setStorageLoading(true);
    try {
      const res = await (window as any).electronAPI.executeOssCleanup(ossConfig);
      alert(lang === 'en' ? `Cleanup completed. Freed ${(res.freedBytes / 1024 / 1024).toFixed(2)} MB` : `清理完成，释放了 ${(res.freedBytes / 1024 / 1024).toFixed(2)} MB 空间`);
      await checkOssStorage();
    } catch (e: any) {
      alert(e.message || 'Cleanup failed');
    } finally {
      setStorageLoading(false);
    }
  };

  const ensureArray = (val: any) => Array.isArray(val) ? val : (val ? [{...val, id: Math.random().toString(36).substr(2, 9)}] : []);

  const textProviders = ensureArray(modelSettings.text);
  const imageProviders = ensureArray(modelSettings.image);
  const videoProviders = ensureArray(modelSettings.video);
  const ossConfig = modelSettings.oss || { accessKeyId: '', accessKeySecret: '', endpoint: '', bucket: '', domain: '', monthlyTrafficLimitGB: 100 };

  const monthlyTrafficLimitGB = Number(ossConfig.monthlyTrafficLimitGB) > 0
    ? Number(ossConfig.monthlyTrafficLimitGB)
    : 100;
  const monthlyTrafficLimitBytes = monthlyTrafficLimitGB * BYTES_PER_GB;

  const bucketStorageGb = bytesToGb(storageData?.usageBytes);
  const bucketStorageLimitGb = bytesToGb(storageData?.policy?.packageBytes);
  const bucketStorageRemainingGb = Math.max(0, bucketStorageLimitGb - bucketStorageGb);
  const bucketStoragePercent = bucketStorageLimitGb > 0
    ? (bucketStorageGb / bucketStorageLimitGb) * 100
    : 0;

  const trafficData = storageData?.traffic;
  const hasTrafficData = Number.isFinite(Number(trafficData?.accountMonthlyInternetTxBytes));
  const bucketTrafficBytes = hasTrafficData
    ? Math.max(0, Number(trafficData?.bucketMonthlyInternetTxBytes) || 0)
    : 0;
  const accountTrafficBytes = hasTrafficData
    ? Math.max(bucketTrafficBytes, Number(trafficData?.accountMonthlyInternetTxBytes) || 0)
    : 0;
  const otherTrafficBytes = Math.max(0, accountTrafficBytes - bucketTrafficBytes);
  const remainingTrafficBytes = Math.max(0, monthlyTrafficLimitBytes - accountTrafficBytes);
  const accountTrafficPercent = monthlyTrafficLimitBytes > 0
    ? (accountTrafficBytes / monthlyTrafficLimitBytes) * 100
    : 0;
  const bucketTrafficBarPercent = monthlyTrafficLimitBytes > 0
    ? Math.min(100, (bucketTrafficBytes / monthlyTrafficLimitBytes) * 100)
    : 0;
  const otherTrafficBarPercent = monthlyTrafficLimitBytes > 0
    ? Math.min(
        Math.max(0, 100 - bucketTrafficBarPercent),
        (otherTrafficBytes / monthlyTrafficLimitBytes) * 100
      )
    : 0;
  const bucketTrafficSharePercent = accountTrafficBytes > 0
    ? (bucketTrafficBytes / accountTrafficBytes) * 100
    : 0;

  const updateProvider = (type: 'text' | 'image' | 'video', idx: number, updates: any) => {
    const list = [...ensureArray(modelSettings[type])];
    list[idx] = { ...list[idx], ...updates };
    setModelSettings({ ...modelSettings, [type]: list });
  };


  const toggleProviderEnabled = (type: ProviderCategory, idx: number) => {
    const list = [...ensureArray(modelSettings[type])];
    const target = list[idx];
    if (!target) return;

    const targetIsEnabled = isProviderEnabled(target);
    const hasEnabledConflict = list.some((provider, providerIdx) => {
      if (providerIdx === idx) return false;
      return isProviderEnabled(provider) && hasModelOverlap(target, provider);
    });

    // 停用项点击后启用；旧配置若有多个同名项默认启用，
    // 点击目标项会保留目标并关闭冲突项；唯一启用项再次点击则停用。
    const shouldEnable = !targetIsEnabled || hasEnabledConflict;

    const nextList = list.map((provider, providerIdx) => {
      if (providerIdx === idx) {
        return { ...provider, enabled: shouldEnable };
      }

      if (shouldEnable && hasModelOverlap(target, provider)) {
        return { ...provider, enabled: false };
      }

      return provider;
    });

    setModelSettings({ ...modelSettings, [type]: nextList });
  };

  const addProvider = (type: 'text' | 'image' | 'video') => {
    const list = [...ensureArray(modelSettings[type])];
    const newId = Math.random().toString(36).substr(2, 9);
    list.push({ 
      id: newId, 
      name: `New ${type} Provider`, 
      provider: 'openai', 
      endpoint: '', 
      key: '', 
      modelName: '',
      enabled: true
    });
    setModelSettings({ ...modelSettings, [type]: list });
    setExpandedSections(prev => ({ ...prev, [`${type}_${list.length - 1}`]: true }));
  };

  const removeProvider = (type: 'text' | 'image' | 'video', idx: number) => {
    const list = [...ensureArray(modelSettings[type])];
    list.splice(idx, 1);
    setModelSettings({ ...modelSettings, [type]: list });
  };

  const updateOss = (updates: any) => {
    let nextOss = { ...ossConfig, ...updates };
    
    // Automatically rebuild domain when endpoint or bucket changes
    if ('endpoint' in updates || 'bucket' in updates) {
      nextOss.domain = buildStandardOssDomain(nextOss.endpoint, nextOss.bucket);
    }
    
    setModelSettings({ ...modelSettings, oss: nextOss });
  };

  const renderProviderCard = (type: 'text' | 'image' | 'video', provider: any, idx: number) => {
    const isExpanded = expandedSections[`${type}_${idx}`];
    const modelCount = parseProviderModels(provider).length;
    const enabled = isProviderEnabled(provider);
    
    return (
      <div
        key={provider.id || idx}
        className={`border border-gray-200 rounded-lg mb-3 overflow-hidden shadow-sm transition-all ${
          enabled ? 'bg-white' : 'bg-gray-50 opacity-60'
        }`}
      >
        <div 
          className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 ${isExpanded ? 'bg-gray-50 border-b border-gray-100' : ''}`}
          onClick={() => toggleExpand(`${type}_${idx}`)}
        >
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-blue-50 text-blue-600 flex items-center justify-center">
               <Server className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-medium text-gray-800 text-sm">{provider.name || 'Unnamed Provider'}</h4>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">{provider.provider}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-sm">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                enabled
                  ? 'bg-green-50 text-green-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {enabled
                ? (lang === 'en' ? 'Enabled' : '启用')
                : (lang === 'en' ? 'Disabled' : '停用')}
            </span>
            {!isExpanded && (
              <span className="text-gray-400 border border-gray-200 rounded px-2 py-0.5 text-xs bg-white">
                {modelCount} {lang === 'en' ? 'Models' : '模型'}
              </span>
            )}
            <button
              type="button"
              aria-pressed={enabled}
              aria-label={
                enabled
                  ? (lang === 'en' ? 'Disable this API configuration' : '停用此 API 配置')
                  : (lang === 'en' ? 'Enable this API configuration' : '启用此 API 配置')
              }
              title={
                enabled
                  ? (lang === 'en' ? 'Enabled — click to disable' : '已启用，点击停用')
                  : (lang === 'en' ? 'Disabled — click to enable' : '已停用，点击启用')
              }
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleProviderEnabled(type, idx);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                enabled
                  ? 'text-blue-600 hover:bg-blue-50'
                  : 'text-gray-400 hover:bg-gray-100'
              }`}
            >
              {enabled ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>
            {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </div>

        {isExpanded && (
          <div className="p-4 space-y-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 flex-1 mr-4">
                 <input 
                   type="text" 
                   onClick={e => e.stopPropagation()}
                   className="flex-1 border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                   placeholder={lang === 'en' ? 'Provider Name' : '提供商名称'}
                   value={provider.name || ''}
                   onChange={e => updateProvider(type, idx, { name: e.target.value })}
                 />
                 <select 
                   onClick={e => e.stopPropagation()}
                   className="w-40 border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-400 bg-gray-50"
                   value={provider.provider || 'openai'}
                   onChange={e => updateProvider(type, idx, { provider: e.target.value })}
                 >
                   <option value="openai">OpenAI Format</option>
                   <option value="gemini">Gemini Format</option>
                    <option value="gemini-custom">Gemini Custom</option>
                    <option value="lingwu">灵悟AI Format</option>
                    <option value="comfyui">ComfyUI Local</option>
                 </select>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); removeProvider(type, idx); }}
                className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded transition-colors"
                title={lang === 'en' ? 'Delete Provider' : '删除提供商'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div>
              <input 
                type="url" 
                className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 font-mono text-gray-600"
                placeholder={provider.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.example.com/v1beta/models/...'}
                value={provider.endpoint || ''}
                onChange={e => updateProvider(type, idx, { endpoint: e.target.value })}
              />
            </div>

            <div>
              <input 
                type="password" 
                className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 font-mono text-gray-600"
                placeholder="sk-..."
                value={provider.key || ''}
                onChange={e => updateProvider(type, idx, { key: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-semibold text-gray-500 mb-1">{lang === 'en' ? 'Models (Comma Separated)' : '模型 (逗号分隔)'}</label>
              <textarea 
                className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 font-mono text-gray-600 min-h-[60px] resize-y"
                placeholder="gpt-3.5-turbo, gpt-4o"
                value={provider.modelName || ''}
                onChange={e => updateProvider(type, idx, { modelName: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleExport = (includeKeys: boolean) => {
    const exportData = JSON.parse(JSON.stringify(modelSettings));
    if (!includeKeys) {
      ['text', 'image', 'video'].forEach(type => {
        if (Array.isArray(exportData[type])) {
          exportData[type].forEach((p: any) => p.key = '');
        } else if (exportData[type]) {
          exportData[type].key = '';
        }
      });
      if (exportData.oss) {
        exportData.oss.accessKeySecret = '';
      }
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model_config_${includeKeys ? 'with_keys' : 'no_keys'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (parsed.text || parsed.image || parsed.oss || parsed.video) {
          setModelSettings({ ...modelSettings, ...parsed });
          alert(lang === 'en' ? 'Import successful' : '导入成功');
        } else {
          alert('Invalid format');
        }
      } catch (err) {
        alert('Invalid JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const renderSettingsTabs = () => (
    <div className="flex items-center gap-1 border-b border-gray-200">
      <button
        type="button"
        onClick={() => setSettingsTab('api')}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${settingsTab === 'api' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
      >
        {lang === 'en' ? 'API & Models' : 'API 与模型'}
      </button>
      <button
        type="button"
        onClick={() => setSettingsTab('skills')}
        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${settingsTab === 'skills' ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
      >
        <BookOpen className="w-4 h-4" />
        Skills
      </button>
    </div>
  );

  if (settingsTab === 'skills') {
    const installedSkills = Array.isArray(skillState?.skills) ? skillState.skills : [];
    const catalogSkills = Array.isArray(skillState?.catalog) ? skillState.catalog : [];
    return (
      <div className="space-y-5">
        {renderSettingsTabs()}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Skill Manager</h2>
            <p className="mt-1 text-xs text-gray-500">
              {lang === 'en'
                ? 'Scan the project skills directory, register copied Skills, and manage enabled state.'
                : '扫描项目 skills 目录，自动注册复制进来的 Skill，并管理启用状态。'}
            </p>
            {skillState?.rootPath && (
              <p className="mt-1 max-w-[720px] truncate font-mono text-[10px] text-gray-400" title={skillState.rootPath}>{skillState.rootPath}</p>
            )}
          </div>
          <button
            type="button"
            disabled={skillLoading}
            onClick={loadSkills}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${skillLoading ? 'animate-spin' : ''}`} />
            {lang === 'en' ? 'Scan directory' : '扫描目录'}
          </button>
        </div>

        {skillError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{skillError}</div>
        )}

        <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <button
            type="button"
            onClick={() => setInstalledSkillsExpanded(value => !value)}
            className={`flex w-full items-center justify-between text-left ${installedSkillsExpanded ? 'mb-3' : ''}`}
            aria-expanded={installedSkillsExpanded}
          >
            <div>
              <h3 className="text-sm font-semibold text-gray-800">{lang === 'en' ? 'Installed Skills' : '已注册 Skills'}</h3>
              {installedSkillsExpanded && <p className="mt-0.5 text-[10px] text-gray-400">
                {lang === 'en' ? 'Display names are the user-facing identifiers used by Smart Text fields.' : '显示名是智能文本字段中用于选择和引用的用户侧标识。'}
              </p>}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-500">{installedSkills.length}</span>
              {installedSkillsExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </div>
          </button>

          {installedSkillsExpanded && <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
            {installedSkills.map((skill: any) => (
              <div key={skill.relativePath} className={`rounded-lg border p-3 ${skill.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-65'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium text-gray-800" title={skill.displayName}>{skill.displayName}</div>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${skill.source?.type === 'github' ? 'bg-slate-100 text-slate-600' : 'bg-purple-50 text-purple-600'}`}>
                        {skill.source?.type === 'github' ? 'GitHub' : 'Custom'}
                      </span>
                      {skill.isNew && <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] text-emerald-600">NEW</span>}
                      {skill.hasScripts && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-700">scripts · not executed</span>}
                    </div>
                    {skill.description && <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500">{skill.description}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-gray-400">
                      <span>{skill.relativePath}</span>
                      <span>{skill.referenceCount || 0} refs</span>
                      {skill.source?.repository && <span>{skill.source.repository}</span>}
                      {skill.source?.url && (
                        <a href={skill.source.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{lang === 'en' ? 'Source' : '查看来源'}</a>
                      )}
                    </div>
                    {skill.duplicateDisplayName && (
                      <div className="mt-2 rounded bg-red-50 px-2 py-1 text-[10px] text-red-600">
                        {lang === 'en' ? 'Duplicate display name. Smart Text will refuse to run until the conflict is resolved.' : '显示名重复。解决冲突前，智能文本会拒绝调用该 Skill。'}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={skillRemovingPath === skill.relativePath}
                      onClick={() => toggleSkillEnabled(skill)}
                      title={skill.enabled ? (lang === 'en' ? 'Disable Skill' : '停用 Skill') : (lang === 'en' ? 'Enable Skill' : '启用 Skill')}
                      className={`flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-40 ${skill.enabled ? 'text-purple-600 hover:bg-purple-50' : 'text-gray-400 hover:bg-gray-100'}`}
                    >
                      {skill.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(skillRemovingPath)}
                      onClick={() => uninstallSkill(skill)}
                      title={lang === 'en' ? 'Uninstall Skill' : '卸载 Skill'}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    >
                      <Trash2 className={`h-4 w-4 ${skillRemovingPath === skill.relativePath ? 'animate-pulse' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!skillLoading && installedSkills.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-xs text-gray-400">
                {lang === 'en' ? 'No registered Skills. Copy a Skill folder into /skills or install one below.' : '暂无已注册 Skill。可将 Skill 文件夹复制到 /skills，或从下方安装。'}
              </div>
            )}
          </div>}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <button
            type="button"
            onClick={() => setSkillLibraryExpanded(value => !value)}
            className={`flex w-full items-center justify-between text-left ${skillLibraryExpanded ? 'mb-3' : ''}`}
            aria-expanded={skillLibraryExpanded}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Github className="h-4 w-4 shrink-0 text-gray-700" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-800">Skill Library</h3>
                {skillLibraryExpanded && <p className="mt-0.5 text-[10px] text-gray-400">{lang === 'en' ? 'Public Skill sources are downloaded into the project /skills directory and then registered.' : '公开 Skill 会下载到项目 /skills 目录，再通过同一套扫描机制注册。'}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-500">{catalogSkills.length}</span>
              {skillLibraryExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </div>
          </button>

          {skillLibraryExpanded && <>
          <div className="mb-4 rounded-lg border border-purple-100 bg-purple-50/50 p-3">
            <label className="mb-1.5 block text-[10px] font-medium text-purple-700">{lang === 'en' ? 'Install from a public GitHub Skill directory' : '从公开 GitHub Skill 目录安装'}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={skillInstallUrl}
                onChange={event => setSkillInstallUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/tree/main/skills/example"
                className="min-w-0 flex-1 rounded-md border border-purple-200 bg-white px-2.5 py-2 font-mono text-xs text-gray-600 outline-none focus:border-purple-400"
              />
              <button
                type="button"
                disabled={!skillInstallUrl.trim() || skillInstallBusy}
                onClick={() => installSkillFromGithub(skillInstallUrl)}
                className="shrink-0 rounded-md bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-700 disabled:bg-gray-300"
              >
                {skillInstallBusy ? (lang === 'en' ? 'Installing…' : '安装中…') : (lang === 'en' ? 'Install' : '安装并注册')}
              </button>
            </div>
          </div>

          <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
            {catalogSkills.map((item: any) => (
              <div key={item.id || item.sourceUrl} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-800" title={item.displayName}>{item.displayName}</div>
                  <div className="mt-0.5 truncate text-[10px] text-gray-500">{item.description}</div>
                  <div className="mt-1 font-mono text-[9px] text-gray-400">{item.sourceLabel || item.sourceUrl}</div>
                </div>
                <button
                  type="button"
                  disabled={item.installed || skillInstallBusy}
                  onClick={() => installSkillFromGithub(item.sourceUrl)}
                  className="shrink-0 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  {item.installed ? (lang === 'en' ? 'Installed' : '已安装') : (skillInstallBusy ? (lang === 'en' ? 'Installing…' : '安装中…') : (lang === 'en' ? 'Install' : '安装'))}
                </button>
              </div>
            ))}
          </div>
          </>}

        </div>
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-500">
          {lang === 'en'
            ? 'Skill Runtime v1.0 reads SKILL.md and text resources under references/, builds one structured context, and sends one request through the existing Smart Text provider. scripts/ are never executed.'
            : 'Skill Runtime v1.0 读取 SKILL.md 与 references/ 下的文本资料，编译成一次结构化上下文，并继续走原智能文本 Provider；scripts/ 只识别、不执行。'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {renderSettingsTabs()}
      {/* Configuration Action Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-800">{lang === 'en' ? 'API Configuration' : 'API 和模型配置'}</h2>
          <p className="text-xs text-gray-500">{lang === 'en' ? 'Manage your model providers and keys.' : '管理您的模型提供商和密钥'}</p>
        </div>
        <div className="flex items-center space-x-3">
          <label className="cursor-pointer flex items-center space-x-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm transition-colors border border-gray-200">
             <Upload className="w-4 h-4" />
             <span>{lang === 'en' ? 'Import' : '导入配置'}</span>
             <input type="file" className="hidden" accept=".json" onChange={handleImport} />
          </label>
          <div className="relative group">
            <button className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md text-sm transition-colors border border-blue-100 font-medium">
               <Download className="w-4 h-4" />
               <span>{lang === 'en' ? 'Export' : '导出配置'}</span>
               <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 shadow-lg rounded-lg py-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-10">
              <button 
                 onClick={() => handleExport(false)}
                 className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-700"
              >
                 {lang === 'en' ? 'Export w/o Keys' : '导出 (不含密钥)'}
              </button>
              <button 
                 onClick={() => handleExport(true)}
                 className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-700 border-t border-gray-50"
              >
                 {lang === 'en' ? 'Export with Keys' : '导出 (含密钥)'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Text Providers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2 text-blue-600">
            <span className="font-serif text-lg leading-none font-bold">T</span>
            <h3 className="font-semibold text-gray-800">{lang === 'en' ? 'Text Model Providers' : '文本模型提供商'}</h3>
          </div>
          <button onClick={() => addProvider('text')} className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition-colors border border-blue-200/50">
            <Plus className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Add Provider' : '添加提供商'}</span>
          </button>
        </div>
        <div>
          {textProviders.map((p, i) => renderProviderCard('text', p, i))}
          {textProviders.length === 0 && (
            <div className="text-center py-6 border border-dashed border-gray-300 rounded-lg text-gray-400 text-sm">
               {lang === 'en' ? 'No text providers configured' : '暂无配置提供商'}
            </div>
          )}
        </div>
      </div>

      {/* Image Providers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2 text-green-600">
            <ImageIcon className="w-5 h-5" />
            <h3 className="font-semibold text-gray-800">{lang === 'en' ? 'Image Providers (Optional)' : '图片提供商 (可选)'}</h3>
          </div>
          <button onClick={() => addProvider('image')} className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:bg-gray-50 px-2 py-1 rounded transition-colors">
            <Plus className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Add' : '添加'}</span>
          </button>
        </div>
        <div>
          {imageProviders.map((p, i) => renderProviderCard('image', p, i))}
        </div>
      </div>

      {/* Video Providers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2 text-purple-600">
            <Video className="w-5 h-5" />
            <h3 className="font-semibold text-gray-800">{lang === 'en' ? 'Video Providers (Optional)' : '视频提供商 (可选)'}</h3>
          </div>
          <button onClick={() => addProvider('video')} className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:bg-gray-50 px-2 py-1 rounded transition-colors">
            <Plus className="w-3.5 h-3.5" />
            <span>{lang === 'en' ? 'Add' : '添加'}</span>
          </button>
        </div>
        <div>
          {videoProviders.map((p, i) => renderProviderCard('video', p, i))}
        </div>
      </div>

      <hr className="border-gray-200" />

      {/* OSS Configuration */}
      <div>
        <div className="flex items-center space-x-2 text-orange-500 mb-4">
          <Database className="w-5 h-5" />
          <h3 className="font-semibold text-gray-800">{lang === 'en' ? 'OSS Configuration' : 'OSS 图床配置'}</h3>
        </div>
        <p className="text-[11px] text-gray-500 mb-4">{lang === 'en' ? 'Used primarily for video generation intermediate storage.' : '用于视频生成等场景时的中间结果暂存（从阿里云 RAM 获取）。'}</p>
        
        <div className="grid grid-cols-2 gap-4">
          <input 
            type="text" 
            placeholder="Access Key ID" 
            className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 font-mono text-gray-600"
            value={ossConfig.accessKeyId}
            onChange={e => updateOss({ accessKeyId: e.target.value })}
          />
          <input 
            type="password" 
            placeholder="Access Key Secret" 
            className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 font-mono text-gray-600"
            value={ossConfig.accessKeySecret}
            onChange={e => updateOss({ accessKeySecret: e.target.value })}
          />
          <input 
            type="text" 
            placeholder="Endpoint (e.g. https://oss-cn-beijing.aliyuncs.com)" 
            className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 font-mono text-gray-600"
            value={ossConfig.endpoint}
            onChange={e => updateOss({ endpoint: e.target.value })}
          />
          <input 
            type="text" 
            placeholder="Bucket Name" 
            className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 font-mono text-gray-600"
            value={ossConfig.bucket}
            onChange={e => updateOss({ bucket: e.target.value })}
          />
          <input 
            type="text" 
            placeholder="Domain (Auto-generated)" 
            className="col-span-2 w-full border border-gray-200 rounded p-2 text-sm outline-none bg-gray-50 font-mono text-gray-500 cursor-not-allowed"
            value={ossConfig.domain || ''}
            readOnly
          />
        </div>
        
        {/* OSS Storage Management */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700 flex items-center">
              <Database className="w-4 h-4 mr-2 text-gray-500" />
              {lang === 'en' ? 'OSS Usage' : 'OSS 使用情况'}
            </h4>
            <div className="flex gap-2">
              <button
                onClick={checkOssStorage}
                disabled={storageLoading || !ossConfig.accessKeyId}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors disabled:opacity-50"
              >
                {storageLoading ? (lang === 'en' ? 'Checking...' : '查询中...') : (lang === 'en' ? 'Refresh Usage' : '刷新用量')}
              </button>
              {storageData?.plan?.plannedDeletions?.length > 0 && (
                <button
                  onClick={cleanupOssStorage}
                  disabled={storageLoading}
                  className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded transition-colors"
                >
                  {lang === 'en' ? 'Force Cleanup' : '强制清理'}
                </button>
              )}
            </div>
          </div>
          
          {storageData && (
            <div className="text-xs bg-gray-50 p-3 rounded-lg border border-gray-100 space-y-2">
              {/* 当前 Bucket 存储空间 */}
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium text-gray-700">
                      {lang === 'en' ? 'Current Bucket Storage' : '当前 Bucket 存储空间'}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      references/ {lang === 'en' ? 'actual directory usage' : '目录实际占用'}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className={`font-mono text-xs font-semibold ${storageData.usageBytes > storageData.policy.triggerBytes ? 'text-orange-600' : 'text-gray-900'}`}>
                      {bucketStorageGb.toFixed(2)} GB&nbsp; / &nbsp;{bucketStorageLimitGb.toFixed(0)} GB
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      {lang === 'en' ? 'Remaining' : '剩余'} {bucketStorageRemainingGb.toFixed(2)} GB · {bucketStoragePercent.toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full ${storageData.usageBytes > storageData.policy.triggerBytes ? 'bg-orange-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, bucketStoragePercent)}%` }}
                  ></div>
                </div>
              </div>

              {/* 账号本月公网流出：当前 Bucket / 其他 Bucket 共用一条额度轴 */}
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-xs font-medium text-gray-700">
                      {lang === 'en' ? 'Monthly Internet Outbound Traffic' : '本月公网流出'}
                    </div>
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
                      {lang === 'en' ? 'Monthly quota' : '月额度'}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="w-14 h-7 rounded-md border border-gray-200 bg-white px-2 text-center font-mono text-[10px] text-gray-700 outline-none focus:border-blue-400"
                        value={monthlyTrafficLimitGB}
                        onChange={e => {
                          const value = Number(e.target.value);
                          updateOss({ monthlyTrafficLimitGB: Number.isFinite(value) && value > 0 ? value : 100 });
                        }}
                      />
                      GB
                    </label>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono text-xs font-semibold text-gray-900">
                      {hasTrafficData ? `${bytesToGb(accountTrafficBytes).toFixed(2)} GB` : '--'}&nbsp; / &nbsp;{monthlyTrafficLimitGB.toFixed(0)} GB
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      {hasTrafficData ? (
                        <>
                          {lang === 'en' ? 'Remaining' : '剩余'} {formatGb(bytesToGb(remainingTrafficBytes))} · {accountTrafficPercent.toFixed(1)}%
                        </>
                      ) : (
                        lang === 'en' ? 'Traffic data unavailable' : '暂无流量数据'
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 bg-blue-800 transition-all"
                    style={{ width: `${bucketTrafficBarPercent}%` }}
                    title={lang === 'en' ? 'Current Bucket' : '当前 Bucket'}
                  ></div>
                  <div
                    className="h-1.5 bg-blue-300 transition-all"
                    style={{ width: `${otherTrafficBarPercent}%` }}
                    title={lang === 'en' ? 'Other Buckets' : '其他 Bucket'}
                  ></div>
                </div>

                {hasTrafficData ? (
                  <div className="mt-2 flex items-center flex-wrap gap-y-1 text-[10px] text-gray-500">
                    <div className="flex items-center gap-1.5 pr-3">
                      <span className="w-1.5 h-1.5 rounded-sm bg-blue-800"></span>
                      <span>{lang === 'en' ? 'Current Bucket' : '当前 Bucket'}</span>
                      <span className="font-mono font-semibold text-gray-700">{formatGb(bytesToGb(bucketTrafficBytes))}</span>
                      <span className="text-gray-400">· {lang === 'en' ? 'Share' : '已用占比'} {bucketTrafficSharePercent.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 border-l border-gray-200">
                      <span className="w-1.5 h-1.5 rounded-sm bg-blue-300"></span>
                      <span>{lang === 'en' ? 'Other Buckets' : '其他 Bucket'}</span>
                      <span className="font-mono font-semibold text-gray-700">{formatGb(bytesToGb(otherTrafficBytes))}</span>
                    </div>
                    <div className="flex items-center gap-1.5 pl-3 border-l border-gray-200">
                      <span className="w-1.5 h-1.5 rounded-sm bg-gray-200"></span>
                      <span>{lang === 'en' ? 'Remaining' : '剩余'}</span>
                      <span className="font-mono font-semibold text-gray-700">{formatGb(bytesToGb(remainingTrafficBytes))}</span>
                      <span className="text-gray-400">
                        · {accountTrafficPercent >= 100
                          ? (lang === 'en' ? 'Quota exceeded' : '已超过额度')
                          : accountTrafficPercent >= 90
                            ? (lang === 'en' ? 'Near quota' : '接近额度')
                            : (lang === 'en' ? 'Quota sufficient' : '额度充足')}
                      </span>
                    </div>
                  </div>
                ) : trafficData?.error ? (
                  <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-[10px] leading-5 text-amber-700">
                    {lang === 'en'
                      ? `Traffic query failed: ${trafficData.error.message || 'CloudMonitor permission or network error'}`
                      : `流量查询失败：${trafficData.error.message || '请检查云监控读取权限或网络连接'}`}
                  </div>
                ) : null}
              </div>

              {storageData.plan?.plannedDeletions?.length > 0 && (
                <div className="rounded-md bg-orange-50 px-3 py-2 text-[10px] text-orange-700">
                  <div className="font-medium mb-1">
                    {lang === 'en' ? 'Cleanup recommended' : '容量接近上限，建议清理'}
                  </div>
                  {storageData.plan.plannedDeletions.map((folder: any, index: number) => (
                    <div key={index} className="flex justify-between gap-4 text-orange-600">
                      <span className="truncate">{folder.prefix}</span>
                      <span className="font-mono shrink-0">{(folder.bytes / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-orange-100 font-medium">
                    <span>{lang === 'en' ? 'Projected usage' : '预计清理后'}</span>
                    <span className="font-mono">{bytesToGb(storageData.plan.projectedBytes).toFixed(2)} GB</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-4 px-0.5 text-[9px] text-gray-400">
                <span>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${trafficData?.error ? 'bg-amber-400' : 'bg-emerald-500'}`}></span>
                  {lang === 'en' ? 'Statistics through:' : '统计截止：'} {formatUsageTimestamp(trafficData?.dataTimestamp || trafficData?.queryEndTime, lang)}
                </span>
                <span>{lang === 'en' ? 'CloudMonitor data may be delayed and is for reference only.' : '云监控数据可能存在延迟，仅供用量参考'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center">
          <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded mr-2 uppercase text-[10px]">{lang === 'en' ? 'App' : '应用'}</span>
          {lang === 'en' ? 'Local App Settings' : '本地应用设置'}
        </h3>
        <div className="grid grid-cols-1 gap-3">
          <input 
            type="text" 
            placeholder={lang === 'en' ? 'Local Photoshop Path (e.g. C:\\Program Files\\...\\Photoshop.exe)' : '本地 Photoshop 路径 (例如 C:\\Program Files\\...\\Photoshop.exe)'} 
            className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 font-mono text-gray-600"
            value={psPath}
            onChange={(e) => {
              const val = e.target.value;
              setPsPath(val);
              if (val) {
                 localStorage.setItem('bitable_ps_path', val);
              } else {
                 localStorage.removeItem('bitable_ps_path');
              }
            }}
          />
          <div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={lang === 'en' ? 'Optional ComfyUI startup BAT path' : '可选：ComfyUI 启动 BAT 路径'}
                className="flex-1 border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 font-mono text-gray-600"
                value={comfyuiBatPath}
                onChange={(e) => {
                  const val = e.target.value;
                  setComfyuiBatPath(val);
                  if (val) localStorage.setItem('bitable_comfyui_bat_path', val);
                  else localStorage.removeItem('bitable_comfyui_bat_path');
                }}
              />
              <button
                type="button"
                className="px-3 py-2 rounded border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
                onClick={async () => {
                  const selected = await (window as any).electronAPI?.selectComfyUIBat?.();
                  if (selected) {
                    setComfyuiBatPath(selected);
                    localStorage.setItem('bitable_comfyui_bat_path', selected);
                  }
                }}
              >
                {lang === 'en' ? 'Browse' : '选择'}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-gray-400">
              {lang === 'en'
                ? 'Optional. If a localhost ComfyUI endpoint cannot be reached, the app starts this BAT in a visible command window and waits for recovery.'
                : '非必填。本地 ComfyUI 端口无法连接时，应用会用可见黑色窗口启动此 BAT，并等待服务恢复。'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
