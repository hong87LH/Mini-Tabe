import React, { useState, useEffect } from 'react';
import { X, Play, RefreshCw, Trash2, CheckCircle2, AlertCircle, Copy, Link as LinkIcon, Info } from 'lucide-react';

const translations = {
  en: {
    title: 'Network Job Center',
    noJobs: 'No jobs yet.',
    model: 'Model',
    taskId: 'Task ID:',
    openResult: 'Open Remote Result',
    copyLink: 'Copy Link',
    saved: 'Saved:',
    openFolder: 'Open Folder',
    retryDownload: 'Retry Download',
    copied: 'Copied!',
    continuePolling: 'Continue Polling',
    deleteJob: 'Delete History',
    copyDiagnostic: 'Copy Diagnostic Info',
    bindToCell: 'Bind to Original Cell',
    bound: 'Bound!'
  },
  zh: {
    title: '后台任务中心',
    noJobs: '暂无任务。',
    model: '模型',
    taskId: '任务 ID:',
    openResult: '查看轮询链接',
    copyLink: '复制链接',
    saved: '已保存:',
    openFolder: '打开文件夹',
    retryDownload: '重试下载',
    copied: '已复制!',
    continuePolling: '继续轮询',
    deleteJob: '删除历史记录',
    copyDiagnostic: '复制诊断信息',
    bindToCell: '写回原单元格',
    bound: '已写回!'
  }
};

export const NetworkJobCenter = ({ onClose, lang = 'en', onBindToCell }: { onClose: () => void, lang?: string, onBindToCell?: (tableId: string, recordId: string, fieldId: string, path: string) => void }) => {
  const [jobs, setJobs] = useState<any[]>([]);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [boundJob, setBoundJob] = useState<string | null>(null);
  
  const t = translations[lang as 'en' | 'zh'] || translations.en;

  const fetchJobs = async () => {
    // We need an IPC call to list all jobs.
    const w = window as any;
    if (w.electronAPI && w.electronAPI.listNetworkJobs) {
      const allJobs = await w.electronAPI.listNetworkJobs();
      setJobs(allJobs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(type);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const handleDelete = async (localJobId: string) => {
    const w = window as any;
    if (w.electronAPI && w.electronAPI.deleteNetworkJob) {
      await w.electronAPI.deleteNetworkJob(localJobId);
      fetchJobs();
    }
  };

  const handleContinuePolling = async (localJobId: string) => {
    const w = window as any;
    if (w.electronAPI && w.electronAPI.continueNetworkJobPolling) {
      await w.electronAPI.continueNetworkJobPolling(localJobId);
      fetchJobs();
    }
  };

  const handleBind = (job: any) => {
    if (onBindToCell && job.localPath && job.recordId && job.fieldId && job.tableId) {
       onBindToCell(job.tableId, job.recordId, job.fieldId, `file://${job.localPath}`);
       setBoundJob(job.localJobId);
       setTimeout(() => setBoundJob(null), 2000);
    }
  };

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl border-l border-gray-200 z-[100] flex flex-col">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
        <h2 className="text-sm font-semibold text-gray-800">{t.title}</h2>
        <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded text-gray-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {jobs.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-10">{t.noJobs}</div>
        )}
        {jobs.map(job => (
          <div key={job.localJobId} className="border border-gray-200 rounded p-3 bg-white flex flex-col gap-2 relative group hover:border-blue-200 transition-colors">
            <div className="flex items-start justify-between">
              <div className="text-xs font-mono text-gray-500 truncate w-48" title={job.localJobId}>{job.localJobId}</div>
              <div className="flex items-center gap-2">
                <span className={[
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium border",
                  job.phase === 'generated' || job.phase === 'completed' || job.phase === 'downloaded' ? "bg-green-50 text-green-700 border-green-200" :
                  job.phase === 'failed' ? "bg-red-50 text-red-700 border-red-200" :
                  job.phase === 'submission_unknown' ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
                  "bg-blue-50 text-blue-700 border-blue-200"
                ].join(" ")}>
                  {job.phase}
                </span>
                <button 
                  onClick={() => handleDelete(job.localJobId)}
                  className="text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  title={t.deleteJob}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            
            <div className="text-sm text-gray-800 font-medium truncate flex items-center gap-2">
              <span className="truncate">{job.model || 'Unknown Model'}</span>
              <button onClick={() => handleCopy(JSON.stringify(job, null, 2), job.localJobId + '_diag')} className="text-gray-400 hover:text-gray-600 transition-colors" title={t.copyDiagnostic}>
                 <Info className="w-3.5 h-3.5" />
              </button>
            </div>
            
            {job.taskId && (
              <div className="text-xs text-gray-500 font-mono">{t.taskId} {job.taskId}</div>
            )}
            {job.lastError && (
              <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100 mt-1">
                {job.lastError.message}
              </div>
            )}
            
            {job.resultUrl && (
              <div className="flex items-center gap-2">
                 <a href={job.resultUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline truncate inline-block flex-1">
                   {t.openResult}
                 </a>
                 <button onClick={() => handleCopy(job.resultUrl, job.localJobId + '_link')} className="text-[10px] flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors shrink-0">
                    <Copy className="w-3 h-3" />
                    {copiedLink === job.localJobId + '_link' ? <span className="text-green-600">{t.copied}</span> : t.copyLink}
                 </button>
              </div>
            )}
            {job.localPath && (
              <div className="flex justify-between items-center bg-green-50 p-1.5 rounded">
                 <div className="text-xs text-green-700 truncate mr-2 flex-1" title={job.localPath}>
                   {t.saved} {job.localPath.split(/[/\\]/).pop()}
                 </div>
                 <div className="flex items-center gap-2 shrink-0">
                   {job.recordId && job.fieldId && onBindToCell && (
                      <button 
                         onClick={() => handleBind(job)}
                         className="text-[10px] text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                         <LinkIcon className="w-3 h-3" />
                         {boundJob === job.localJobId ? t.bound : t.bindToCell}
                      </button>
                   )}
                   <button 
                     onClick={() => (window as any).electronAPI.openLocalFile(job.localPath).catch(console.error)}
                     className="text-[10px] text-green-700 underline"
                   >
                     {t.openFolder}
                   </button>
                 </div>
              </div>
            )}
            
            <div className="flex gap-2 mt-2">
               {(job.phase === 'generated' || job.phase === 'failed') && job.resultUrl && (
                  <button 
                    onClick={() => (window as any).electronAPI.retryDownloadJob(job.localJobId)}
                    className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t.retryDownload}
                  </button>
               )}
               {job.phase === 'failed' && job.taskId && !job.resultUrl && (
                  <button 
                    onClick={() => handleContinuePolling(job.localJobId)}
                    className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    {t.continuePolling}
                  </button>
               )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
