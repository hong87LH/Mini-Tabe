import React, { useState, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Database, Server, Image as ImageIcon, Video, Download, Upload, ServerCrash, Cpu, Eye, EyeOff } from 'lucide-react';

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
  const [storageData, setStorageData] = useState<any>(null);
  const [storageLoading, setStorageLoading] = useState(false);

  const toggleExpand = (id: string) => {
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };
  
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
  const ossConfig = modelSettings.oss || { accessKeyId: '', accessKeySecret: '', endpoint: '', bucket: '', domain: '' };

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

  return (
    <div className="space-y-8">
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
              {lang === 'en' ? 'OSS Storage Management' : 'OSS 容量管理'}
            </h4>
            <div className="flex gap-2">
              <button
                onClick={checkOssStorage}
                disabled={storageLoading || !ossConfig.accessKeyId}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors disabled:opacity-50"
              >
                {storageLoading ? (lang === 'en' ? 'Checking...' : '检查中...') : (lang === 'en' ? 'Check Storage' : '刷新容量')}
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
            <div className="text-xs bg-gray-50 p-3 rounded-lg border border-gray-100">
              <div className="flex justify-between mb-1">
                <span className="text-gray-500">{lang === 'en' ? 'Current Usage' : '当前用量'}</span>
                <span className={`font-mono ${storageData.usageBytes > storageData.policy.triggerBytes ? 'text-orange-600 font-bold' : 'text-gray-700'}`}>
                  {(storageData.usageBytes / 1024 / 1024 / 1024).toFixed(2)} GB / {(storageData.policy.packageBytes / 1024 / 1024 / 1024).toFixed(2)} GB
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5 mb-3">
                <div 
                  className={`h-1.5 rounded-full ${storageData.usageBytes > storageData.policy.triggerBytes ? 'bg-orange-500' : 'bg-green-500'}`} 
                  style={{ width: `${Math.min(100, (storageData.usageBytes / storageData.policy.packageBytes) * 100)}%` }}
                ></div>
              </div>
              
              {storageData.plan?.plannedDeletions?.length > 0 ? (
                <div>
                  <div className="text-orange-600 mb-1">
                    {lang === 'en' ? 'Cleanup Recommended: Exceeds ' : '建议清理：已超过 '}
                    {(storageData.policy.triggerBytes / 1024 / 1024 / 1024).toFixed(2)} GB
                  </div>
                  <div className="text-gray-500 pl-2 border-l-2 border-orange-200">
                    {storageData.plan.plannedDeletions.map((f: any, i: number) => (
                      <div key={i} className="flex justify-between">
                        <span>{f.prefix}</span>
                        <span>{(f.bytes / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-medium mt-1 pt-1 border-t border-orange-100 text-orange-700">
                      <span>{lang === 'en' ? 'Projected Usage' : '预计清理后'}</span>
                      <span>{(storageData.plan.projectedBytes / 1024 / 1024 / 1024).toFixed(2)} GB</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-green-600">
                  {lang === 'en' ? 'Storage is within healthy limits.' : '当前容量健康，无需清理。'}
                </div>
              )}
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
        </div>
      </div>
    </div>
  );
}
