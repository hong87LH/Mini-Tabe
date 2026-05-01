import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Field, BaseRecord, GridData, SelectOption, FieldType, Attachment } from '../types';
import { FieldIcon } from './FieldIcon';
import { cn } from '../lib/utils';
import { Plus, GripVertical, ChevronDown, Check, Image as ImageIcon, X, Sparkles, ArrowDownUp, Trash2, Filter, Copy, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { Parser } from 'expr-eval';

export const copyImageToClipboardMagic = (path: string) => {
   navigator.clipboard.writeText(`IMG_COPY_MAGIC:${path}`);
};

const ZoomableImage = ({ src, onPrev, onNext, onClose }: { src: string, onPrev: (e: React.MouseEvent) => void, onNext: (e: React.MouseEvent) => void, onClose: () => void }) => {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 cursor-move outline-none"
      onWheel={(e) => {
        e.preventDefault();
        setScale(s => Math.min(Math.max(0.5, s - e.deltaY * 0.01), 10));
      }}
      onMouseDown={e => { setIsDragging(true); setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y }); e.stopPropagation(); }}
      onMouseMove={e => { if (isDragging) { setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); } }}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-4 z-50">
         <button onClick={(e) => { e.stopPropagation(); setScale(1); setPos({x: 0, y: 0}); }} title="Reset Zoom" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
         </button>
         <button onClick={(e) => { e.stopPropagation(); copyImageToClipboardMagic(src); }} title="Copy Image" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors">
            <Copy className="w-5 h-5" />
         </button>
         <button onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors">
            <X className="w-6 h-6" />
         </button>
      </div>

      <button onClick={onPrev} className="absolute left-8 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 p-4">
         <ChevronLeft className="w-12 h-12" />
      </button>
      <img src={src} style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: isDragging ? 'none' : 'transform 0.1s' }} className="max-w-[90%] max-h-[90%] object-contain" draggable={false} onClick={e => e.stopPropagation()} />
      <button onClick={onNext} className="absolute right-8 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 p-4">
         <ChevronRight className="w-12 h-12" />
      </button>
    </div>
  );
};


export const fullImageBlobCache = new Map<string, string>();
export const thumbnailCache = new Map<string, string>();

// Concurrency queue for generating canvas thumbnails to prevent memory spikes
const thumbnailQueue: Array<() => Promise<void>> = [];
let activeThumbnails = 0;
const MAX_CONCURRENT_THUMBNAILS = 5;

async function processThumbnailQueue() {
  if (activeThumbnails >= MAX_CONCURRENT_THUMBNAILS || thumbnailQueue.length === 0) return;
  activeThumbnails++;
  const task = thumbnailQueue.shift()!;
  try {
    await task();
  } finally {
    activeThumbnails--;
    processThumbnailQueue();
  }
}

async function getOrGenerateThumbnail(pathStr: string, file?: File): Promise<string> {
  if (thumbnailCache.has(pathStr)) return thumbnailCache.get(pathStr)!;

  const w = window as any;
  const isElectronPath = pathStr.startsWith('/') || pathStr.match(/^[a-zA-Z]:\\/);

  if (isElectronPath && w.electronAPI && w.electronAPI.getThumbnail) {
    try {
      const dataUrl = await w.electronAPI.getThumbnail(pathStr, { width: 150, height: 150 });
      if (dataUrl) {
        thumbnailCache.set(pathStr, dataUrl);
        return dataUrl;
      }
    } catch (e) {}
  }

  return new Promise((resolve) => {
    thumbnailQueue.push(async () => {
      if (thumbnailCache.has(pathStr)) {
         resolve(thumbnailCache.get(pathStr)!);
         return;
      }
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let urlToLoad = '';
      let objectUrl = '';

      if (file) {
        objectUrl = URL.createObjectURL(file);
        urlToLoad = objectUrl;
      } else if (fullImageBlobCache.has(pathStr)) {
        urlToLoad = fullImageBlobCache.get(pathStr)!;
      } else if (isElectronPath) {
        urlToLoad = `file://${pathStr.replace(/\\/g, '/')}`;
      } else {
        urlToLoad = pathStr;
      }

      await new Promise<void>((imgResolve) => {
        img.onload = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);

          const MAX_DIM = 256;
          if (img.width <= MAX_DIM && img.height <= MAX_DIM && !file) {
            thumbnailCache.set(pathStr, urlToLoad);
            resolve(urlToLoad);
            imgResolve();
            return;
          }

          const canvas = document.createElement('canvas');
          let w = img.width;
          let h = img.height;
          if (w > h) {
            h *= MAX_DIM / w;
            w = MAX_DIM;
          } else {
            w *= MAX_DIM / h;
            h = MAX_DIM;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            try {
              const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
              thumbnailCache.set(pathStr, dataUrl);
              resolve(dataUrl);
            } catch (e) {
              resolve(urlToLoad);
            }
          } else {
            resolve(urlToLoad);
          }
          imgResolve();
        };

        img.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          resolve(urlToLoad);
          imgResolve();
        };

        img.src = urlToLoad;
      });
    });
    processThumbnailQueue();
  });
}

const ThumbnailImage = ({ path, alt, className, title, onClick }: { path: string, alt: string, className: string, title?: string, onClick?: (e: React.MouseEvent) => void }) => {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    if (thumbnailCache.has(path)) {
      setSrc(thumbnailCache.get(path)!);
    } else {
      getOrGenerateThumbnail(path).then(fetched => {
        if (isMounted) setSrc(fetched);
      });
    }
    return () => { isMounted = false; };
  }, [path]);

  return <img src={src || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='} alt={alt} className={className} title={title} onClick={onClick} />;
};

interface GridProps {
  data: GridData;
  onUpdateRecord: (recordId: string, fieldId: string, value: any) => void;
  onDeleteRecords?: (recordIds: string[]) => void;
  onAddRecord: () => void;
  onAddField: () => void;
  onDeleteField?: (fieldId: string) => void;
  onRenameField: (fieldId: string, name: string) => void;
  onChangeFieldType: (fieldId: string, type: FieldType) => void;
  onReorderFields: (sourceId: string, targetId: string) => void;
  onReorderRecords: (sourceId: string, targetId: string) => void;
  onResizeCol: (fieldId: string, width: number) => void;
  onUpdateField: (fieldId: string, updates: Partial<Field>) => void;
  onSortField?: (fieldId: string, direction: 'asc'|'desc'|null) => void;
  onFilterField?: (fieldId: string, keyword: string) => void;
  sortConfig?: { fieldId: string, direction: 'asc'|'desc' } | null;
  filterConfig?: Record<string, string>;
  rowHeight: 'short'|'medium'|'tall'|'extra';
  modelSettings: any;
  lang?: 'en' | 'zh';
}

const resolveFieldValueForAI = (val: any, refField: Field) => {
  if (!val) return val;
  if (refField.type === 'singleSelect') {
    return refField.options?.find(o => o.id === val)?.name || val;
  }
  if (refField.type === 'multiSelect' && Array.isArray(val)) {
    return val.map((id: string) => refField.options?.find(o => o.id === id)?.name || id).join(', ');
  }
  return val;
};

const getBase64ImageParts = async (templateStr: string, fields: Field[], record: any) => {
  const parts: any[] = [];
  const dataUrlsOut: string[] = [];
  if (!templateStr) return { cleanString: '', parts, dataUrls: dataUrlsOut };
  let str = templateStr;
  
  for (let f of fields) {
    const marker = `{${f.name}}`;
    if (str.includes(marker)) {
      let val = record[f.id];
      if (f.type === 'attachment' || f.type === 'aiImage') {
        const urls: string[] = [];
        if (Array.isArray(val)) {
          val.forEach((v: any) => urls.push(String(v?.url || v)));
        } else if (typeof val === 'string') {
          val.split(',').forEach(v => urls.push(v.trim()));
        } else if (val) {
          urls.push(String(val?.url || val));
        }
        
        const dataUrls: string[] = [];
        for (let u of urls) {
          if (!u.trim()) continue;
          
          let fetchUrl = u;
          if (thumbnailCache.has(u)) {
             fetchUrl = thumbnailCache.get(u)!;
          } else if (fullImageBlobCache.has(u)) {
             fetchUrl = fullImageBlobCache.get(u)!;
          } else if (!u.startsWith('data:') && !u.startsWith('http') && !u.startsWith('blob:')) {
             fetchUrl = `file://${u.replace(/\\\\/g, '/')}`;
          }

          if (fetchUrl.startsWith('data:')) {
            const mime = fetchUrl.match(/data:(.*?);/)?.[1] || 'image/jpeg';
            let b64 = fetchUrl.split(',')[1];
            parts.push({ inlineData: { mimeType: mime, data: b64 } });
            dataUrls.push(fetchUrl);
            dataUrlsOut.push(fetchUrl);
          } else {
            try {
              const res = await fetch(fetchUrl);
              const blob = await res.blob();
              const b64: string = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              parts.push({ inlineData: { mimeType: blob.type, data: b64.split(',')[1] } });
              dataUrls.push(b64);
              dataUrlsOut.push(b64);
            } catch(e) {
              console.error("Could not load image reference:", u, "via fetchUrl:", fetchUrl);
              dataUrls.push(u); 
            }
          }
        }
        str = str.replace(new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\}`, 'g'), dataUrls.join(' '));
      } else {
         if (Array.isArray(val)) val = val.map(v => v?.url || v).join(', ');
         else val = String(val || '');
         str = str.replace(new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\}`, 'g'), val);
      }
    }
  }

  return { cleanString: str, parts, dataUrls: dataUrlsOut };
};

const triggerDownload = async (url: string, filename: string, folderPath?: string): Promise<string | undefined> => {
  const w = window as any;

  // 1. 优先尝试咱们最新挂载的安全 API (此时 main.js 会全权处理重名逻辑并返回最新目标路径)
  if (w.electronAPI && w.electronAPI.downloadFile) {
    try {
      const finalSavedPath = await w.electronAPI.downloadFile({ url, filename, folderPath });
      return finalSavedPath || (folderPath ? `${folderPath}/${filename}` : undefined);
    } catch (e) {
      console.error("ElectronAPI download failed:", e);
    }
  } else if (w.electron && w.electron.downloadFile) {
    try {
      const finalSavedPath = await w.electron.downloadFile({ url, filename, folderPath });
      return finalSavedPath || (folderPath ? `${folderPath}/${filename}` : undefined);
    } catch (e) {
      console.error("Electron download failed:", e);
    }
  }

  // 2. 只有上面都没有时，才降级使用 nodeIntegration（但如果是新架构 nodeIntegration 为 false 时，本段不会被执行）
  if (w.require && folderPath) {
    try {
      const fs = w.require('fs');
      const pathNode = w.require('path');
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      
      let fullPath = pathNode.join(folderPath, filename);
      // 👇 防覆盖逻辑：如果本地直接通过 fs 落盘（降级方案），也要确保不覆盖
      if (fs.existsSync(fullPath)) {
        let parsedExt = pathNode.extname(filename);
        let parsedBase = pathNode.basename(filename, parsedExt);
        let finalName = filename;
        let counter = 1;

        const match = parsedBase.match(/-(\d+)$/);
        if (match) {
           counter = parseInt(match[1], 10);
           parsedBase = parsedBase.substring(0, parsedBase.length - match[0].length);
        }

        while (fs.existsSync(fullPath)) {
           finalName = `${parsedBase}-${counter}${parsedExt}`;
           fullPath = pathNode.join(folderPath, finalName);
           counter++;
        }
      }

      let buffer: any;
      if (url.startsWith('data:')) {
         buffer = w.require('buffer').Buffer.from(url.split(',')[1], 'base64');
      } else {
         const arrayBuf = await (await fetch(url)).arrayBuffer();
         buffer = w.require('buffer').Buffer.from(arrayBuf);
      }
      // 注意：这里不再做复杂的文件去重，交给 main.js 更合适
      fs.writeFileSync(fullPath, buffer);
      return fullPath;
    } catch (e) {
      console.error("Node fs integration writing failed:", e);
    }
  }

  // 3. 尝试其他通用的 IPC Renderer 方式
  const ipc = w.ipcRenderer || (w.electron?.ipcRenderer) || (w.electronAPI?.ipcRenderer);
  if (ipc && folderPath) {
    try {
      if (ipc.invoke) {
         try {
           const finalSavedPath = await ipc.invoke('download-file', { url, filename, folderPath });
           if (finalSavedPath) return finalSavedPath;
         } catch(e) {}
      }
      // Fire and forget fallback 
      ipc.send('save-file-silent', { url, filename, folderPath });
      return folderPath + (folderPath.includes('\\') ? '\\' : '/') + filename;
    } catch (e) {
      console.error("IPC save failed:", e);
    }
  }

  // Plan B: Do NOT fallback to browser dialogue if the user explicitly wants silent saving to a folderPath!
  if (folderPath) {
     console.warn(`[Plan B] 无法找到 Electron 或 Node 环境来执行静默物理写入 (目录: ${folderPath})。当前已取消下载，保留线上图片地址，以避免恼人的浏览器弹窗。请在 Electron 设置中开启 nodeIntegration 或添加 preload IPC 服务。`);
     // Return an empty string or undefined so the caller uses the original network/base64 URL
     return undefined; 
  }

  // Fallback to standard browser download ONLY IF it's a manual click without a folderPath configured.
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'image.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return undefined;
};

export function Grid({ data, onUpdateRecord, onDeleteRecords, onAddRecord, onAddField, onDeleteField, onRenameField, onChangeFieldType, onReorderFields, onReorderRecords, onResizeCol, onUpdateField, onSortField, onFilterField, sortConfig, filterConfig, rowHeight, modelSettings, lang = 'zh' }: GridProps) {
  const [activeCell, setActiveCell] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [forceEdit, setForceEdit] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [contextMenuState, setContextMenuState] = useState<{ x: number, y: number, recordId?: string } | null>(null);
  const [cutBox, setCutBox] = useState<{ minR: number, maxR: number, minC: number, maxC: number } | null>(null);
  
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  const [previewImageState, setPreviewImageState] = useState<{ images: string[], currentIndex: number } | null>(null);

  const setPreviewImage = (path: string | null, allPaths: string[] = []) => {
      if (!path) { setPreviewImageState(null); return; }
      if (allPaths.length === 0) allPaths = [path];
      const currentIndex = allPaths.indexOf(path);
      setPreviewImageState({ images: allPaths, currentIndex: currentIndex === -1 ? 0 : currentIndex });
  };

  const handlePreviewPrev = () => {
      if (!previewImageState) return;
      setPreviewImageState(prev => prev ? { ...prev, currentIndex: (prev.currentIndex - 1 + prev.images.length) % prev.images.length } : null);
  };

  const handlePreviewNext = () => {
      if (!previewImageState) return;
      setPreviewImageState(prev => prev ? { ...prev, currentIndex: (prev.currentIndex + 1) % prev.images.length } : null);
  };

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (!previewImageState) return;
          if (e.key === 'ArrowLeft') { e.preventDefault(); handlePreviewPrev(); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); handlePreviewNext(); }
          else if (e.key === 'Escape') { e.preventDefault(); setPreviewImage(null); }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImageState]);

  const [extraSelectedCells, setExtraSelectedCells] = useState<{ r: number, c: number }[]>([]);


  const [selectionStart, setSelectionStart] = useState<{ r: number, c: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ r: number, c: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const getSelectionBox = () => {
    if (!selectionStart || !selectionEnd) return null;
    return {
      minR: Math.min(selectionStart.r, selectionEnd.r),
      maxR: Math.max(selectionStart.r, selectionEnd.r),
      minC: Math.min(selectionStart.c, selectionEnd.c),
      maxC: Math.max(selectionStart.c, selectionEnd.c)
    };
  };

  const selectionBox = getSelectionBox();

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      // Allow natural copy inside inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!selectionBox && extraSelectedCells.length === 0) return;
      
      const allSelectedCells = new Set<string>();
      if (selectionBox) {
         for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
            for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
               allSelectedCells.add(`${r},${c}`);
            }
         }
      }
      extraSelectedCells.forEach(cell => allSelectedCells.add(`${cell.r},${cell.c}`));
      const selectedArr = Array.from(allSelectedCells).map(s => { const [r, c] = s.split(','); return { r: parseInt(r), c: parseInt(c) }; });
      if (selectedArr.length === 0) return;

      const minR = Math.min(...selectedArr.map(x => x.r));
      const maxR = Math.max(...selectedArr.map(x => x.r));
      const minC = Math.min(...selectedArr.map(x => x.c));
      const maxC = Math.max(...selectedArr.map(x => x.c));

      const rows: string[] = [];
      for (let r = minR; r <= maxR; r++) {
          const colVals: string[] = [];
          for (let c = minC; c <= maxC; c++) {
              if (allSelectedCells.has(`${r},${c}`)) {
                  const record = data.records[r];
                  const field = data.fields[c];
                  let val = record[field.id];
                  if (field.type === 'attachment') {
                     if (Array.isArray(val)) {
                       val = val.map((a: any) => a.url || a).join(',');
                     } else if (typeof val === 'string') val = val;
                     else val = '';
                  } else if (typeof val === 'object' && val !== null) {
                     val = JSON.stringify(val);
                  }
                  colVals.push(val || '');
              } else {
                  colVals.push('');
              }
          }
          rows.push(colVals.join('\t'));
      }

      e.clipboardData?.setData('text/plain', rows.join('\n'));
      e.preventDefault();
      if (cutBox) setCutBox(null);
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!selectionStart) return;
      
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      
      const rows = text.split(/\r?\n/).map(row => row.split('\t'));
      if (rows.length === 0) return;

      const allSelectedCells = new Set<string>();
      if (selectionBox) {
         for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
            for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
               allSelectedCells.add(`${r},${c}`);
            }
         }
      }
      extraSelectedCells.forEach(cell => allSelectedCells.add(`${cell.r},${cell.c}`));
      const selectedArr = Array.from(allSelectedCells).map(s => { const [r, c] = s.split(','); return { r: parseInt(r), c: parseInt(c) }; });
      if (selectedArr.length === 0) return;

      const minR = Math.min(...selectedArr.map(x => x.r));
      const minC = Math.min(...selectedArr.map(x => x.c));

      const pasteCells: { rIdx: number, cIdx: number, val: any }[] = [];

      if (selectedArr.length > 1) {
          // Map to multiple selected cells with tiling relative to minR, minC
          for (const { r, c } of selectedArr) {
             const val = rows[(r - minR) % rows.length][(c - minC) % rows[0].length];
             pasteCells.push({ rIdx: r, cIdx: c, val });
          }
      } else {
          // Map to a block expanding right and down
          for (let i = 0; i < rows.length; i++) {
             const rIdx = minR + i;
             if (rIdx >= data.records.length) break;
             for (let j = 0; j < rows[0].length; j++) {
                const cIdx = minC + j;
                if (cIdx >= data.fields.length) break;
                pasteCells.push({ rIdx, cIdx, val: rows[i][j] });
             }
          }
      }

      for (const { rIdx, cIdx, val: rawVal } of pasteCells) {
          const record = data.records[rIdx];
          const field = data.fields[cIdx];
          let val = rawVal;
          
          if (field.type === 'attachment' || field.type === 'aiImage') {
               let pathToAdd = val || '';
               if (pathToAdd.startsWith('IMG_COPY_MAGIC:')) {
                  pathToAdd = pathToAdd.substring('IMG_COPY_MAGIC:'.length);
                  const existing = record[field.id] || [];
                  const existingArr = Array.isArray(existing) ? existing : (typeof existing === 'string' && existing ? existing.split(',') : []);
                  if (pathToAdd) {
                      val = [...existingArr, pathToAdd.trim()].filter(Boolean).join(',');
                  } else {
                      val = existingArr.join(',');
                  }
               } else {
                  val = pathToAdd;
               }
          } else if (field.type === 'number') {
             val = val ? Number(val) : null;
          } else if (field.type === 'checkbox') {
             val = val === 'true' || val === '1';
          } else if (field.type === 'multiSelect') {
             val = val ? val.split(',') : [];
          }
          onUpdateRecord(record.id, field.id, val);
      }

      if (cutBox) {
         for (let r = cutBox.minR; r <= cutBox.maxR; r++) {
           for (let c = cutBox.minC; c <= cutBox.maxC; c++) {
              // skip updating if the cut cell was just overwritten by the paste (optimisation)
              // but for safety, clear it.
              const field = data.fields[c];
              onUpdateRecord(data.records[r].id, field.id, field.type === 'multiSelect' ? [] : '');
           }
         }
         setCutBox(null);
      }
    };

    const handleDeleteKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
         if (!selectionBox && extraSelectedCells.length === 0) return;
         if (selectionBox && selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1 && selectionBox.minC === selectionBox.maxC && extraSelectedCells.length === 0) {
             const fieldId = data.fields[selectionBox.minC].id;
             if (onDeleteField) {
                 onDeleteField(fieldId);
                 return;
             }
         }
         // Clear cells
         if (selectionBox) {
           for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
             for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                const field = data.fields[c];
                onUpdateRecord(data.records[r].id, field.id, field.type === 'multiSelect' ? [] : '');
             }
           }
         }
         extraSelectedCells.forEach(cell => {
             const field = data.fields[cell.c];
             if (field) {
               onUpdateRecord(data.records[cell.r].id, field.id, field.type === 'multiSelect' ? [] : '');
             }
         });
      }
    };

    const handleCut = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!selectionBox) return;

      const rows: string[] = [];
      for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
         const colVals: string[] = [];
         const record = data.records[r];
         for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
            const field = data.fields[c];
            let val = record[field.id];
            if (field.type === 'attachment') {
               if (Array.isArray(val)) {
                 val = val.map((a: any) => a.url || a).join(',');
               } else if (typeof val === 'string') {
                 val = val;
               } else {
                 val = '';
               }
            } else if (typeof val === 'object' && val !== null) {
               val = JSON.stringify(val);
            }
            colVals.push(val || '');
         }
         rows.push(colVals.join('\t'));
      }
      e.clipboardData?.setData('text/plain', rows.join('\n'));
      e.preventDefault();
      
      setCutBox(selectionBox);
    };

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cutBox) {
         setCutBox(null);
      }
    };

    window.addEventListener('copy', handleCopy);
    window.addEventListener('cut', handleCut);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleDeleteKey);
    window.addEventListener('keydown', handleEscapeKey);
    return () => {
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('cut', handleCut);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handleDeleteKey);
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [selectionBox, selectionStart, selectionEnd, data, activeCell, onDeleteField, cutBox, extraSelectedCells]);

  const heightClass = {
    short: 'h-[40px]',
    medium: 'h-[56px]',
    tall: 'h-[80px]',
    extra: 'h-[120px]'
  }[rowHeight];

  const handleDragStartCol = (e: React.DragEvent, id: string) => {
    setDraggedColId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `col:${id}`); // Dummy data
  };

  const handleDragStartRow = (e: React.DragEvent, id: string) => {
    setDraggedRowId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `row:${id}`);
  };

  const [generatingCell, setGeneratingCell] = useState<{ recordId: string, fieldId: string } | null>(null);



  const handleGenerateColumn = async (field: Field, targetRecordIds?: string[]) => {
    if (!field.prompt) {
      alert("Please configure a prompt for this Smart Text column first.");
      return;
    }
    
    try {
      const recordsToProcess = targetRecordIds ? data.records.filter(r => targetRecordIds.includes(r.id)) : data.records.filter(r => {
          let val = r[field.id];
          if (field.type === 'aiImage') return !val || (Array.isArray(val) && val.length === 0);
          return val === undefined || val === null || val === '';
      });
      for (const record of recordsToProcess) {
        setGeneratingCell({ recordId: record.id, fieldId: field.id });
        let resultText = '';
        const contextData: any = {};
        
        if (field.refFields && field.refFields.length > 0) {
          field.refFields.forEach(refId => {
            const refField = data.fields.find(f => f.id === refId);
            if (refField) {
              contextData[refField.name] = resolveFieldValueForAI(record[refId], refField);
            }
          });
        }
        
        let promptString = field.prompt || "";
        let promptImageParts: any[] = [];
        let promptDataUrls: string[] = [];
        
        if (field.type === 'aiImage') {
           const { cleanString, parts, dataUrls } = await getBase64ImageParts(promptString, data.fields, record);
           promptString = cleanString;
           promptImageParts = parts;
           promptDataUrls = dataUrls;
        } else {
           // For text, just interpolate textually
           data.fields.forEach(f => {
              let val = record[f.id];
              if (Array.isArray(val)) val = val.map(v => v?.url || v).join(', ');
              else val = String(val || '');
              promptString = promptString.replace(new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\}`, 'g'), val);
           });
           promptString = `You are an AI assistant helping to evaluate a table row. Here is the data context for this row:\n\n${JSON.stringify(contextData, null, 2)}\n\nBased ONLY on the context provided, perform the following instruction and respond with the concise result. Do not include markdown formatting or conversational filler.\n\nInstruction: ${promptString}`;
        }
        
        let resultParams: any = '';

        if (field.type === 'aiImage') {
          const cfg = field.aiImageConfig || {};
          const count = cfg.count || 1;
          const ratio = cfg.ratio || "1:1";
          const res4kMap: Record<string, string> = {
            '1:1': '4096x4096',
            '16:9': '4096x2304',
            '9:16': '2304x4096',
            '4:3': '4096x3072',
            '3:4': '3072x4096'
          };
          const res2kMap: Record<string, string> = {
            '1:1': '2048x2048',
            '16:9': '2048x1152',
            '9:16': '1152x2048',
            '4:3': '2048x1536',
            '3:4': '1536x2048'
          };
          const hdMap: Record<string, string> = {
             '1:1': '1024x1024',
             '16:9': '1792x1024',
             '9:16': '1024x1792',
             '4:3': '1024x1024',
             '3:4': '1024x1024'
          };
          const sizeStr = (cfg.resolution === '4k') ? (res4kMap[ratio] || '4096x4096') : (cfg.resolution === '2k') ? (res2kMap[ratio] || '2048x2048') : (hdMap[ratio] || "1024x1024");
          
          const imgSet = modelSettings.image || {};
          
          let resolvedModel = (imgSet.modelName || 'dall-e-3').split(',')[0].trim();
          if (cfg.modelTemplate) {
             let template = cfg.modelTemplate;
             data.fields.forEach(f => {
               template = template.replace(new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), String(record[f.id] || ''));
             });
             if (template.trim()) {
               resolvedModel = template.trim();
             }
          }

          let finalPrompt = promptString;
          let imageParts: any[] = [...promptImageParts];
          let finalDataUrls: string[] = [...promptDataUrls];
          if (cfg.sourceImageTemplate) {
             const { parts, dataUrls } = await getBase64ImageParts(cfg.sourceImageTemplate, data.fields, record);
             imageParts = [...imageParts, ...parts];
             finalDataUrls = [...finalDataUrls, ...dataUrls];
          }

          if (imgSet.provider === 'gemini') {
            throw new Error("Local Gemini Image generation not natively supported in this preview without vertex AI. Please use OpenAI-compatible proxy for images.");
          } else if (imgSet.provider === 'gemini-custom') {
            if (!imgSet.key) throw new Error("Gemini API Key is required for Image Generation");
            let imgEndpoint = imgSet.endpoint || 'https://generativelanguage.googleapis.com/v1beta';
            if (imgEndpoint.endsWith('/')) imgEndpoint = imgEndpoint.slice(0, -1);
            if (!imgEndpoint.includes(':predict') && !imgEndpoint.includes(':generateContent') && !imgEndpoint.includes(':generateImages')) {
               imgEndpoint = `${imgEndpoint}/models/${resolvedModel}:generateContent`;
            }
            
            const fetchPromises = Array.from({ length: count }).map(async () => {
              let payload;
              if (imgEndpoint.includes(':predict')) {
                payload = {
                  instances: [
                    { prompt: finalPrompt }
                  ],
                  parameters: {
                    sampleCount: 1,
                    aspectRatio: ratio
                  }
                };
              } else {
                const geminiImageSize = cfg.resolution ? cfg.resolution.toUpperCase() : undefined;
                const imageConfig: any = { aspectRatio: ratio, numberOfImages: 1 };
                if (geminiImageSize && geminiImageSize !== '1K') {
                   imageConfig.imageSize = geminiImageSize;
                }
                payload = {
                  contents: [{ parts: [...imageParts, { text: finalPrompt }], role: 'user' }],
                  generationConfig: {
                    responseModalities: ["IMAGE"],
                    imageConfig
                  }
                };
              }
              const res = await fetch(`${imgEndpoint}?key=${imgSet.key}`, {
                method: 'POST',
                headers: {
                   'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
              });
              const json = await res.json();
              if (json.error) throw new Error(json.error.message);
              
              let newUrls: string[] = [];
              if (json.predictions && json.predictions.length > 0) {
                 newUrls = json.predictions.map((p: any) => `data:image/png;base64,${p.bytesBase64Encoded}`);
              } else if (json.candidates && json.candidates.length > 0 && json.candidates[0].content?.parts) {
                 for (const part of json.candidates[0].content.parts) {
                   if (part.inlineData) {
                     newUrls.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
                   } else if (part.text) {
                     const match = part.text.match(/!\[.*?\]\((.*?)\)/);
                     if (match) newUrls.push(match[1]);
                     else newUrls.push(part.text);
                   }
                 }
              } else {
                 throw new Error("Invalid response from Gemini Custom Image Endpoint");
              }
              return newUrls;
            });
            
            const resultsNested = await Promise.all(fetchPromises);
            resultParams = resultsNested.flat();
          } else {
            if (!imgSet.key) throw new Error("OpenAI API Key is required for Image Generation");
            const imgEndpoint = (imgSet.endpoint || 'https://api.openai.com/v1').replace('/chat/completions', '') + '/images/generations';
            
            const payload: any = {
              model: resolvedModel,
              prompt: finalPrompt,
              n: count,
              size: sizeStr,
              response_format: 'b64_json'
            };
            if (finalDataUrls && finalDataUrls.length > 0) {
              payload.base64Array = finalDataUrls;
            }
            
            const res = await fetch(imgEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${imgSet.key}`
              },
              body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.error) throw new Error(json.error.message);
            const urls = json.data.map((d: any) => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : null)).filter(Boolean);
            resultParams = urls;
          }
        } else {
          const txtSet = modelSettings.text || {};
          if (txtSet.provider === 'gemini') {
            if (!txtSet.key) throw new Error("Gemini API Key is required");
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${txtSet.key}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                 contents: [{ parts: [{ text: promptString }] }]
              })
            });
            const resData = await res.json();
            if (resData.error) throw new Error(resData.error.message);
            resultParams = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          } else {
            if (!txtSet.key) throw new Error("OpenAI API Key is required");
            const res = await fetch(`${txtSet.endpoint || 'https://api.openai.com/v1'}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${txtSet.key}`
              },
              body: JSON.stringify({
                model: txtSet.modelName || 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: promptString }]
              })
            });
            const json = await res.json();
            if (json.error) throw new Error(json.error.message);
            resultParams = json.choices[0].message.content;
          }
        }
        
        let finalResultParams = resultParams;
        if (field.type === 'aiImage') {
           const existing = Array.isArray(record[field.id]) ? record[field.id] : (record[field.id] ? [record[field.id]] : []);
           let downloadedUrls: string[] = [...(resultParams || [])];
           
           if (resultParams && Array.isArray(resultParams)) {
              const cfg = field.aiImageConfig || {};
              if (cfg.filenameTemplate || cfg.folderPath) {
                 let template = cfg.filenameTemplate || 'image';
                 let folderTemplate = cfg.folderPath || '';
                 data.fields.forEach(f => {
                   let val = record[f.id];
                   if (Array.isArray(val)) val = val.map(v => v?.name || String(v?.url || v)).join(', ');
                   else val = String(val || '');
                   const regex = new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\}`, 'g');
                   template = template.replace(regex, val);
                   folderTemplate = folderTemplate.replace(regex, val);
                 });
                 const filename = template.trim();
                 const folderPath = folderTemplate.trim();
                 
                 const savedUrls: string[] = [];
                 for (let i = 0; i < resultParams.length; i++) {
                     const url = resultParams[i];
                     const savedPath = await triggerDownload(url, filename + (resultParams.length > 1 ? `_${i+1}` : '') + '.png', folderPath);
                     savedUrls.push(savedPath || url);
                 }
                 downloadedUrls = savedUrls;
              }
           }
           finalResultParams = [...existing, ...downloadedUrls];
        }
        
        onUpdateRecord(record.id, field.id, finalResultParams);
      }
    } catch (err: any) {
      alert("AI Generation failed: " + err.message);
    } finally {
      setGeneratingCell(null);
    }
  };
  
  const totalTableWidth = data.fields.reduce((acc, f) => acc + (f.width || 150), 0) + 64; // 64 for row corner

  return (
    <div className="flex-1 overflow-auto bg-white h-full" style={{ isolation: 'isolate' }}>
      <table className="min-w-full text-left border-collapse" style={{ tableLayout: 'fixed', width: totalTableWidth }}>
        <thead className="sticky top-0 z-20 bg-gray-50 text-sm border-b border-gray-200">
          <tr>
            <th className="sticky left-0 w-16 bg-gray-50 border-r border-gray-200 z-30 p-0">
              <div 
                 className="w-full justify-center flex items-center h-8 text-gray-400 border-b border-t border-transparent cursor-pointer"
                 onClick={() => {
                   if (selectedRecordIds.size === data.records.length && data.records.length > 0) {
                     setSelectedRecordIds(new Set());
                   } else {
                     setSelectedRecordIds(new Set(data.records.map(r => r.id)));
                   }
                 }}
              >
                  {selectedRecordIds.size > 0 ? (
                    <input 
                      type="checkbox" 
                      className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 pointer-events-none" 
                      checked={selectedRecordIds.size === data.records.length}
                      ref={input => {
                        if (input) {
                          input.indeterminate = selectedRecordIds.size > 0 && selectedRecordIds.size < data.records.length;
                        }
                      }}
                      onChange={() => {}} 
                    />
                  ) : null}
              </div>
            </th>
            {data.fields.map((field, colIdx) => (
              <HeaderCell 
                key={field.id} 
                lang={lang}
                field={field} 
                onRename={(name) => onRenameField(field.id, name)} 
                onChangeType={(type) => onChangeFieldType(field.id, type)}
                onResize={(width) => onResizeCol(field.id, width)}
                onUpdateField={(updates) => onUpdateField(field.id, updates)}
                onGenerateColumn={() => handleGenerateColumn(field)}
                onDeleteField={() => onDeleteField?.(field.id)}
                onSortField={(dir) => onSortField?.(field.id, dir)}
                onFilterField={(keyword) => onFilterField?.(field.id, keyword)}
                sortDirection={sortConfig?.fieldId === field.id ? sortConfig.direction : undefined}
                filterValue={filterConfig?.[field.id]}
                onSelectCol={() => {
                   setSelectionStart({ r: 0, c: colIdx });
                   setSelectionEnd({ r: data.records.length - 1, c: colIdx });
                   setIsSelecting(false);
                }}
                allFields={data.fields}
                isDragged={draggedColId === field.id}
                isDragOver={dragOverColId === field.id}
                onDragStart={(e) => handleDragStartCol(e, field.id)}
                onDragOver={(e) => {
                  if (draggedColId) {
                    e.preventDefault();
                    if (dragOverColId !== field.id) setDragOverColId(field.id);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverColId === field.id) setDragOverColId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedColId && draggedColId !== field.id) {
                    onReorderFields(draggedColId, field.id);
                  }
                  setDraggedColId(null);
                  setDragOverColId(null);
                }}
                onDragEnd={() => { setDraggedColId(null); setDragOverColId(null); }}
                modelSettings={modelSettings}
              />
            ))}
            <th className="bg-gray-50 border-r border-transparent font-normal group cursor-pointer hover:bg-gray-100" style={{ width: 100 }} onClick={onAddField}>
              <div className="flex items-center px-3 h-8 text-gray-500">
                <Plus className="w-4 h-4 mr-1" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="text-[13px]">
          {data.records.map((record, index) => (
            <tr 
              key={record.id} 
              className={cn(
                "group hover:bg-blue-50/30 transition-colors",
                draggedRowId === record.id ? "opacity-50 bg-gray-100" : "",
                dragOverRowId === record.id ? "border-t-2 border-t-blue-500" : ""
              )}
              onDragOver={(e) => {
                if (draggedRowId) {
                  e.preventDefault();
                  if (dragOverRowId !== record.id) setDragOverRowId(record.id);
                }
              }}
              onDragLeave={() => {
                if (dragOverRowId === record.id) setDragOverRowId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedRowId && draggedRowId !== record.id) {
                  onReorderRecords(draggedRowId, record.id);
                }
                setDraggedRowId(null);
                setDragOverRowId(null);
              }}
            >
              <td 
                className="sticky left-0 bg-white group-hover:bg-gray-50 border-r border-b border-gray-200 text-center text-gray-400 w-16 z-10 transition-colors p-0 select-none cursor-grab active:cursor-grabbing relative"
                draggable
                onDragStart={(e) => handleDragStartRow(e, record.id)}
                onDragEnd={() => { setDraggedRowId(null); setDragOverRowId(null); }}
              >
                <div className={cn("flex items-center justify-center border-t border-transparent", heightClass)}>
                  <div 
                    className={cn("flex flex-1 items-center justify-center h-full cursor-pointer relative", selectedRecordIds.has(record.id) ? 'bg-blue-50/50' : '')} 
                    onClick={(e) => {
                      e.stopPropagation();
                      const newSet = new Set(selectedRecordIds);
                      if (newSet.has(record.id)) newSet.delete(record.id);
                      else newSet.add(record.id);
                      setSelectedRecordIds(newSet);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      let sel = new Set(selectedRecordIds);
                      if (!sel.has(record.id)) {
                         sel = new Set([record.id]);
                         setSelectedRecordIds(sel);
                      }
                      setContextMenuState({ x: e.clientX, y: e.clientY });
                    }}
                  >
                    <span className={cn("group-hover:hidden", selectedRecordIds.has(record.id) ? 'hidden' : '')}>{index + 1}</span>
                    <div className={cn("items-center justify-center space-x-1 hidden group-hover:flex", selectedRecordIds.has(record.id) ? '!flex' : '')}>
                      <input 
                        type="checkbox" 
                        checked={selectedRecordIds.has(record.id)}
                        onChange={() => {}}
                        className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 pointer-events-none" 
                      />
                      <GripVertical className="w-3.5 h-3.5 text-gray-300" />
                    </div>
                  </div>
                </div>
              </td>
              {data.fields.map((field, colIdx) => {
                const isSelectedBox = (selectionBox 
                    ? index >= selectionBox.minR && index <= selectionBox.maxR && colIdx >= selectionBox.minC && colIdx <= selectionBox.maxC 
                    : false) || extraSelectedCells.some(c => c.r === index && c.c === colIdx);

                const isCutBox = cutBox
                    ? index >= cutBox.minR && index <= cutBox.maxR && colIdx >= cutBox.minC && colIdx <= cutBox.maxC 
                    : false;

                return (
                  <Cell
                    key={field.id}
                    record={record}
                    field={field}
                    isActive={activeCell?.recordId === record.id && activeCell?.fieldId === field.id}
                    forceEdit={forceEdit && activeCell?.recordId === record.id && activeCell?.fieldId === field.id}
                    isGeneratingCol={generatingCell?.recordId === record.id && generatingCell?.fieldId === field.id}
                    onActivate={() => { setActiveCell({ recordId: record.id, fieldId: field.id }); setForceEdit(false); }}
                    onChange={(val) => onUpdateRecord(record.id, field.id, val)}
                    onBlur={() => { setActiveCell(null); setForceEdit(false); }}
                    onPreviewImage={setPreviewImage}
                    allFields={data.fields}
                    modelSettings={modelSettings}
                    heightClass={heightClass}
                    lang={lang}
                    onUpdateField={(updates) => onUpdateField(field.id, updates)}
                    isSelectedBox={isSelectedBox}
                    isCutBox={isCutBox}
                    onBatchAIGenerate={() => {
                        let targetRecordIds = [record.id];
                        if (selectionBox || extraSelectedCells.length > 0) {
                            const selectedRecordIds = new Set<string>();
                            if (selectionBox) {
                                for(let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
                                     if (colIdx >= selectionBox.minC && colIdx <= selectionBox.maxC) {
                                         selectedRecordIds.add(data.records[r].id);
                                     }
                                }
                            }
                            extraSelectedCells.forEach(cell => {
                                if (cell.c === colIdx) selectedRecordIds.add(data.records[cell.r].id);
                            });
                            
                            // If the current cell is selected, we batch generate for all selected cells in this column.
                            // Otherwise, we only generate for the current cell as expected by typical isolated clicks.
                            if (selectedRecordIds.has(record.id)) {
                                targetRecordIds = Array.from(selectedRecordIds);
                            }
                        }
                        // Now we trigger generate!
                        handleGenerateColumn(field, targetRecordIds);
                    }}
                    onMouseDown={(e: React.MouseEvent) => {
                       if (e.shiftKey && selectionStart) {
                           setSelectionEnd({ r: index, c: colIdx });
                       } else if (e.ctrlKey || e.metaKey) {
                           setExtraSelectedCells(prev => {
                               const exists = prev.find(p => p.r === index && p.c === colIdx);
                               if (exists) return prev.filter(p => !(p.r === index && p.c === colIdx));
                               return [...prev, {r: index, c: colIdx}];
                           });
                       } else {
                           setIsSelecting(true);
                           setSelectionStart({ r: index, c: colIdx });
                           setSelectionEnd({ r: index, c: colIdx });
                           setExtraSelectedCells([]);
                       }
                    }}
                    onMouseEnter={() => {
                       if (isSelecting) {
                          setSelectionEnd({ r: index, c: colIdx });
                       }
                    }}
                    onActivateNextRow={() => {
                       if (index < data.records.length - 1) {
                          setActiveCell({ recordId: data.records[index + 1].id, fieldId: field.id });
                          setForceEdit(true);
                       }
                    }}
                  />
                );
              })}
              <td className="border-b border-gray-200"></td>
            </tr>
          ))}
          {/* Add New Row Button */}
          <tr>
            <td className="sticky left-0 bg-white border-r border-b border-gray-100 text-center text-gray-400 w-16 z-10 p-0 select-none">
              <div className={cn("flex items-center justify-center font-bold text-lg", heightClass)}>+</div>
            </td>
            <td colSpan={data.fields.length + 1} className="border-b border-transparent bg-white hover:bg-gray-50 cursor-pointer transition-colors p-0" onClick={onAddRecord}>
              <div className={cn("flex items-center px-4 text-gray-500 hover:text-gray-700", heightClass)}>
                 {lang === 'en' ? "Tap to add a new record" : "点击添加新记录"}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {previewImageState && previewImageState.images.length > 0 && (
          <ZoomableImage 
             src={previewImageState.images[previewImageState.currentIndex]}
             onPrev={(e) => { e.stopPropagation(); handlePreviewPrev(); }}
             onNext={(e) => { e.stopPropagation(); handlePreviewNext(); }}
             onClose={() => setPreviewImageState(null)}
          />
      )}

      {contextMenuState && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenuState(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenuState(null); }}></div>
          <div 
             className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[150px] text-sm"
             style={{ left: contextMenuState.x, top: contextMenuState.y }}
          >
             <button 
                className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 transition-colors flex items-center"
                onClick={() => {
                   onDeleteRecords?.(Array.from(selectedRecordIds));
                   setSelectedRecordIds(new Set());
                   setContextMenuState(null);
                }}
             >
                <Trash2 className="w-4 h-4 mr-2" /> 
                {lang === 'en' ? `Delete ${selectedRecordIds.size} row(s)` : `删除 ${selectedRecordIds.size} 行`}
             </button>
          </div>
        </>
      )}
    </div>
  );
}

interface HeaderCellProps {
  key?: React.Key;
  field: Field;
  onRename: (name: string) => void;
  onChangeType: (type: FieldType) => void;
  onResize: (width: number) => void;
  onUpdateField: (updates: Partial<Field>) => void;
  onGenerateColumn: () => void;
  onDeleteField: () => void;
  onSortField: (dir: 'asc'|'desc'|null) => void;
  onFilterField: (keyword: string) => void;
  sortDirection?: 'asc' | 'desc';
  filterValue?: string;
  onSelectCol: () => void;
  allFields: Field[];
  isDragged: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  modelSettings: any;
  lang?: 'en' | 'zh';
}

const FIELD_TYPES: { type: FieldType, label: string, labelZh: string }[] = [
  { type: 'text', label: 'Text', labelZh: '文本' },
  { type: 'number', label: 'Number', labelZh: '数字' },
  { type: 'singleSelect', label: 'Single Select', labelZh: '单选标签' },
  { type: 'multiSelect', label: 'Multi Select', labelZh: '多选标签' },
  { type: 'date', label: 'Date', labelZh: '日期' },
  { type: 'checkbox', label: 'Checkbox', labelZh: '复选框' },
  { type: 'person', label: 'Person', labelZh: '人员' },
  { type: 'url', label: 'URL', labelZh: '链接' },
  { type: 'attachment', label: 'Attachment', labelZh: '附件' },
  { type: 'formula', label: 'Formula', labelZh: '公式' },
  { type: 'aiText', label: 'Smart Text', labelZh: '智能文本' },
  { type: 'aiImage', label: 'AI Image', labelZh: '智能图片' },
];

function HeaderCell({ 
  field, onRename, onChangeType, onResize, onUpdateField, onGenerateColumn, onDeleteField, onSortField, onFilterField, sortDirection, filterValue, onSelectCol, allFields,
  isDragged, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, modelSettings, lang = 'zh'
}: HeaderCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  
  const [draftPrompt, setDraftPrompt] = useState(field.prompt || '');
  const [draftRefs, setDraftRefs] = useState<string[]>(field.refFields || []);
  const [draftAiImageConfig, setDraftAiImageConfig] = useState(field.aiImageConfig || { count: 1, size: '1024x1024' });
  const [showPromptRefs, setShowPromptRefs] = useState(false);

  useEffect(() => {
    if (showMenu) {
      setDraftPrompt(field.prompt || '');
      setDraftRefs(field.refFields || []);
      setDraftAiImageConfig(field.aiImageConfig || { count: 1, size: '1024x1024' });
    }
  }, [showMenu, field.prompt, field.refFields, field.aiImageConfig]);

  const ref = useClickOutside(() => setIsEditing(false));
  const menuRef = useClickOutside(() => setShowMenu(false));
  const actionMenuRef = useClickOutside(() => setShowActionMenu(false));

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.pageX;
    const startWidth = field.width || 150;

    const onMouseMove = (moveEvent: MouseEvent) => {
      requestAnimationFrame(() => {
        const diff = moveEvent.pageX - startX;
        onResize(Math.max(60, startWidth + diff));
      });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <th 
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "font-normal text-gray-700 bg-gray-50 border-r border-gray-200 relative group select-none hover:bg-gray-100 transition-colors",
        isDragged ? "opacity-50 bg-gray-200" : "",
        isDragOver ? "border-l-2 border-l-blue-500" : ""
      )}
      style={{ width: field.width || 150 }}
    >
      <div 
        className="flex items-center px-2 h-8 cursor-pointer"
        onClick={onSelectCol}
        onDoubleClick={() => setIsEditing(true)}
      >
        <div className="flex items-center justify-center cursor-pointer hover:bg-gray-200 p-0.5 rounded mr-1" onClick={(e) => { e.stopPropagation(); setShowMenu(true); }}>
           <FieldIcon type={field.type} className="w-[14px] h-[14px] text-gray-500" />
        </div>
        
        {isEditing ? (
          <div ref={ref} className="flex-1 flex" onClick={e => e.stopPropagation()}>
            <input 
              autoFocus
              className="flex-1 w-full bg-white px-1 outline-none ring-1 ring-blue-500 rounded-sm"
              defaultValue={field.name}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val) onRename(val);
                setIsEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </div>
        ) : (
          <>
            <span className="truncate flex-1">{field.name}</span>
            <div className="cursor-pointer p-0.5 rounded hover:bg-gray-200 flex items-center justify-center shrink-0" onClick={(e) => { e.stopPropagation(); setShowActionMenu(true); }}>
              {filterValue ? (
                <div className="text-blue-500 flex items-center"><Filter className="w-3.5 h-3.5" /></div>
              ) : sortDirection ? (
                <div className="text-blue-500 flex items-center"><ArrowDownUp className="w-3.5 h-3.5" /></div>
              ) : (
                <ChevronDown className="w-4 h-4 opacity-0 group-hover:opacity-100 text-gray-400" />
              )}
            </div>
          </>
        )}
      </div>

      {showActionMenu && (
        <div ref={actionMenuRef} className="absolute top-full right-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
           <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">{lang === 'en' ? 'Filter' : '筛选'}</div>
           <div className="px-3 pb-2">
             <input type="text" className="w-full border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500" placeholder={lang === 'en' ? "Filter by keyword..." : "输入关键词筛选..."} value={filterValue || ''} onChange={(e) => onFilterField(e.target.value)} />
           </div>
           
           <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100 mt-1">{lang === 'en' ? 'Sort' : '排序'}</div>
           <button className={cn("w-full flex items-center px-3 py-1.5 text-sm transition-colors", sortDirection === 'asc' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100')} onClick={() => { onSortField('asc'); setShowActionMenu(false); }}>
              <ArrowDownUp className="w-4 h-4 mr-2 opacity-70" /> {lang === 'en' ? 'Sort A-Z' : '正序 (A-Z)'}
           </button>
           <button className={cn("w-full flex items-center px-3 py-1.5 text-sm transition-colors", sortDirection === 'desc' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100')} onClick={() => { onSortField('desc'); setShowActionMenu(false); }}>
              <ArrowDownUp className="w-4 h-4 mr-2 opacity-70" /> {lang === 'en' ? 'Sort Z-A' : '倒序 (Z-A)'}
           </button>
           {sortDirection && (
              <button className="w-full flex items-center px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors" onClick={() => { onSortField(null); setShowActionMenu(false); }}>
                <X className="w-4 h-4 mr-2 opacity-70" /> {lang === 'en' ? 'Clear Sort' : '恢复默认排序'}
              </button>
           )}
        </div>
      )}

      {showMenu && (
        <div ref={menuRef} className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-2" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
           <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{lang === 'en' ? 'Change Type' : '修改类型'}</div>
           <div className="grid grid-cols-2 gap-1 mb-3">
             {FIELD_TYPES.map(ft => (
               <div 
                 key={ft.type} 
                 className={cn("flex items-center px-2 py-1.5 rounded cursor-pointer text-sm transition-colors", field.type === ft.type ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100')}
                 onClick={() => { onChangeType(ft.type); }}
               >
                 <FieldIcon type={ft.type} className={cn("w-4 h-4 mr-2", field.type === ft.type ? "text-blue-700" : "")} />
                 <span className="flex-1 truncate">{lang === 'en' ? ft.label : ft.labelZh}</span>
               </div>
             ))}
           </div>

           {field.type === 'formula' && (
             <div className="border-t border-gray-100 pt-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{lang === 'en' ? 'Formula Setup' : '公式设置'}</div>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1 relative">
                      <label className="block text-xs text-gray-600">{lang === 'en' ? 'Expression' : '表达式 (如 {价格} * {数量})'}</label>
                      <button
                        onClick={() => setShowPromptRefs(!showPromptRefs)}
                        className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 hover:bg-blue-100 flex items-center"
                      >
                        <Plus className="w-3 h-3 mr-0.5" />
                        {lang === 'en' ? 'Insert Field' : '引用字段'}
                      </button>
                      {showPromptRefs && (
                        <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 max-h-48 overflow-y-auto">
                          <div className="text-[10px] text-gray-500 mb-1 px-1">{lang === 'en' ? 'Select field to insert' : '选择要插入的字段'}</div>
                          <div className="flex flex-col space-y-1">
                            {allFields.filter(f => f.id !== field.id && f.type !== 'formula').map(f => (
                              <button
                                key={f.id}
                                onClick={() => {
                                  const el = document.getElementById(`prompt-textarea-${field.id}`) as HTMLTextAreaElement;
                                  const cursorPosition = el ? el.selectionStart : draftPrompt.length;
                                  const textBefore = draftPrompt.substring(0, cursorPosition);
                                  const textAfter = draftPrompt.substring(cursorPosition);
                                  const newPrompt = textBefore + `{${f.name}}` + textAfter;
                                  const newRefs = Array.from(new Set([...draftRefs, f.id]));
                                  setDraftPrompt(newPrompt);
                                  setDraftRefs(newRefs);
                                  setShowPromptRefs(false);
                                  setTimeout(() => {
                                     if (el) { el.focus(); el.setSelectionRange(cursorPosition + f.name.length + 2, cursorPosition + f.name.length + 2); }
                                  }, 0);
                                }}
                                className="text-xs text-left px-2 py-1.5 hover:bg-gray-100 rounded text-gray-700"
                              >
                                {f.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <textarea
                      id={`prompt-textarea-${field.id}`}
                      className="w-full text-sm border border-gray-300 rounded p-1.5 h-16 outline-none focus:border-blue-500 font-mono"
                      placeholder="e.g. {Price} * {Qty} + 10"
                      value={draftPrompt}
                      onChange={(e) => setDraftPrompt(e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                    />
                    <div className="mt-3 flex justify-end items-center">
                      <button 
                        className="text-xs bg-blue-600 text-white px-3 flex items-center h-7 rounded hover:bg-blue-700 transition-colors shadow-sm"
                        onClick={() => {
                          onUpdateField({ prompt: draftPrompt, refFields: draftRefs });
                          setShowMenu(false);
                        }}
                      >
                        {lang === 'en' ? 'Save' : '保存公式'}
                      </button>
                    </div>
                  </div>
                </div>
             </div>
           )}

           {(field.type === 'aiText' || field.type === 'aiImage') && (
             <div className="border-t border-gray-100 pt-3">
               <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{lang === 'en' ? (field.type === 'aiText' ? 'Smart Text Setup' : 'AI Image Setup') : (field.type === 'aiText' ? '智能文本设置' : '智能图片设置')}</div>
               <div className="space-y-3">
                 <div>
                                       <div className="flex items-center justify-between mb-1 relative">
                      <label className="block text-xs text-gray-600">{lang === 'en' ? 'Prompt' : '提示词'}</label>
                      <button
                        onClick={() => setShowPromptRefs(!showPromptRefs)}
                        className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 hover:bg-blue-100 flex items-center"
                      >
                        <Plus className="w-3 h-3 mr-0.5" />
                        {lang === 'en' ? 'Insert Field' : '引用字段'}
                      </button>
                      {showPromptRefs && (
                        <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 max-h-48 overflow-y-auto">
                          <div className="text-[10px] text-gray-500 mb-1 px-1">{lang === 'en' ? 'Select field to insert' : '选择要插入的字段'}</div>
                          <div className="flex flex-col space-y-1">
                            {allFields.filter(f => f.id !== field.id && f.type !== 'formula').map(f => (
                              <button
                                key={f.id}
                                onClick={() => {
                                  const el = document.getElementById(`prompt-textarea-${field.id}`) as HTMLTextAreaElement;
                                  const cursorPosition = el ? el.selectionStart : draftPrompt.length;
                                  const textBefore = draftPrompt.substring(0, cursorPosition);
                                  const textAfter = draftPrompt.substring(cursorPosition);
                                  const newPrompt = textBefore + `{${f.name}}` + textAfter;
                                  const newRefs = Array.from(new Set([...draftRefs, f.id]));
                                  setDraftPrompt(newPrompt);
                                  setDraftRefs(newRefs);
                                  setShowPromptRefs(false);
                                  setTimeout(() => {
                                     if (el) { el.focus(); el.setSelectionRange(cursorPosition + f.name.length + 2, cursorPosition + f.name.length + 2); }
                                  }, 0);
                                }}
                                className="text-xs text-left px-2 py-1.5 hover:bg-gray-100 rounded text-gray-700"
                              >
                                {f.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <textarea
                      id={`prompt-textarea-${field.id}`}
                      className="w-full text-sm border border-gray-300 rounded p-1.5 h-16 outline-none focus:border-blue-500"
                      placeholder={lang === 'en' ? "e.g. Translate to Spanish" : "例如：翻译为西班牙语"}
                      value={draftPrompt}
                      onChange={(e) => setDraftPrompt(e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                    />
                    {field.type === 'aiImage' && (
                     <div className="mt-2 space-y-2">
                       <div>
                         <label className="block text-[10px] text-gray-500 mb-1">原始图片 (引用字段)</label>
                         <div className="relative">
                           <textarea
                             className="w-full text-xs border border-gray-300 rounded p-1 outline-none"
                             value={draftAiImageConfig.sourceImageTemplate || ''}
                             placeholder="{Image 1} {Image 2}"
                             onChange={e => setDraftAiImageConfig(prev => ({ ...prev, sourceImageTemplate: e.target.value }))}
                             onMouseDown={e => e.stopPropagation()}
                           />
                           <select 
                             className="absolute bottom-1 right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px]"
                             value=""
                             onChange={e => {
                               if (!e.target.value) return;
                               const curTpl = draftAiImageConfig.sourceImageTemplate || '';
                               setDraftAiImageConfig(prev => ({ ...prev, sourceImageTemplate: curTpl + `{${e.target.value}}` }));
                             }}
                           >
                             <option value="">+ 引用</option>
                             {allFields.filter(f => f.id !== field.id && (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'url')).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                           </select>
                         </div>
                       </div>
                       <div className="grid grid-cols-3 gap-2">
                         <div>
                           <label className="block text-[10px] text-gray-500 mb-1">分辨率</label>
                           <select 
                             className="w-full text-xs border border-gray-300 rounded p-1 outline-none"
                             value={draftAiImageConfig.resolution || '1k'}
                             onChange={e => setDraftAiImageConfig(prev => ({ ...prev, resolution: e.target.value }))}
                           >
                             <option value="1k">1K</option>
                             <option value="2k">2K</option>
                             <option value="4k">4K</option>
                           </select>
                         </div>
                         <div>
                           <label className="block text-[10px] text-gray-500 mb-1">比例</label>
                           <select 
                             className="w-full text-xs border border-gray-300 rounded p-1 outline-none"
                             value={draftAiImageConfig.ratio || '1:1'}
                             onChange={e => setDraftAiImageConfig(prev => ({ ...prev, ratio: e.target.value }))}
                           >
                             <option value="1:1">1:1</option>
                             <option value="16:9">16:9</option>
                             <option value="9:16">9:16</option>
                             <option value="4:3">4:3</option>
                             <option value="3:4">3:4</option>
                           </select>
                         </div>
                         <div>
                           <label className="block text-[10px] text-gray-500 mb-1">生成数量</label>
                           <input 
                             type="number"
                             min="1"
                             max="10"
                             className="w-full text-xs border border-gray-300 rounded p-1 outline-none"
                             value={draftAiImageConfig.count || 1}
                             onChange={e => setDraftAiImageConfig(prev => ({ ...prev, count: parseInt(e.target.value) || 1 }))}
                             onMouseDown={e => e.stopPropagation()}
                           />
                         </div>
                       </div>
                       <div className="relative">
                          <label className="block text-[10px] text-gray-500 mb-1">保存的图片文件名 (可引用字段)</label>
                          <input 
                            type="text" 
                            className="w-full text-xs border border-gray-300 rounded p-1 outline-none placeholder:text-gray-300"
                            placeholder="例如: {Task Name}_{Date}"
                            value={draftAiImageConfig.filenameTemplate || ''}
                            onChange={e => setDraftAiImageConfig(prev => ({ ...prev, filenameTemplate: e.target.value }))}
                            onMouseDown={e => e.stopPropagation()}
                          />
                          <select 
                             className="absolute bottom-1 right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px]"
                             value=""
                             onChange={e => {
                               if (!e.target.value) return;
                               const curTpl = draftAiImageConfig.filenameTemplate || '';
                               setDraftAiImageConfig(prev => ({ ...prev, filenameTemplate: curTpl + `{${e.target.value}}` }));
                             }}
                           >
                             <option value="">+ 引用</option>
                             {allFields.filter(f => f.id !== field.id).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                          </select>
                       </div>
                       <div className="relative">
                          <label className="block text-[10px] text-gray-500 mb-1">图片生成模型 (可引用字段，覆盖默认)</label>
                          <input 
                            type="text" 
                            list={`model-suggestions-${field.id}`}
                            className="w-full text-xs border border-gray-300 rounded p-1 outline-none placeholder:text-gray-300"
                            placeholder="例如: {Model} 或 dall-e-3"
                            value={draftAiImageConfig.modelTemplate || ''}
                            onChange={e => setDraftAiImageConfig(prev => ({ ...prev, modelTemplate: e.target.value }))}
                            onMouseDown={e => e.stopPropagation()}
                          />
                          <datalist id={`model-suggestions-${field.id}`}>
                            {modelSettings?.image?.modelName?.split(',').map((m: string) => m.trim()).filter(Boolean).map((m: string) => (
                               <option key={m} value={m} />
                            ))}
                            <option value="gemini-3.1-flash-image-preview" />
                            <option value="gemini-3-pro-image-preview" />
                          </datalist>
                          <select 
                             className="absolute bottom-1 right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px]"
                             value=""
                             onChange={e => {
                               if (!e.target.value) return;
                               const curTpl = draftAiImageConfig.modelTemplate || '';
                               setDraftAiImageConfig(prev => ({ ...prev, modelTemplate: curTpl + `{${e.target.value}}` }));
                             }}
                           >
                             <option value="">+ 引用</option>
                             {allFields.filter(f => f.id !== field.id).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                          </select>
                       </div>
                       <div>
                          <label className="block text-[10px] text-gray-500 mb-1">默认保存目录 (Electron可用)</label>
                          <input 
                            type="text" 
                            className="w-full text-xs border border-gray-300 rounded p-1 outline-none placeholder:text-gray-300"
                            placeholder="C:\images"
                            value={draftAiImageConfig.folderPath || ''}
                            onChange={e => setDraftAiImageConfig(prev => ({ ...prev, folderPath: e.target.value }))}
                            onMouseDown={e => e.stopPropagation()}
                          />
                       </div>
                     </div>
                   )}

                   <div className="mt-3 flex justify-between items-center">
                     <button
                       className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 px-2 flex items-center h-7 rounded border border-purple-200 transition-colors"
                       onClick={() => {
                          onGenerateColumn();
                          setShowMenu(false);
                       }}
                     >
                       <Sparkles className="w-3 h-3 mr-1" /> {lang === 'en' ? 'Generate Col' : '生成列数据'}
                     </button>
                     <button 
                       className="text-xs bg-blue-600 text-white px-3 flex items-center h-7 rounded hover:bg-blue-700 transition-colors shadow-sm"
                       onClick={() => {
                         onUpdateField({ prompt: draftPrompt, refFields: draftRefs, aiImageConfig: draftAiImageConfig });
                         setShowMenu(false);
                       }}
                     >
                       {lang === 'en' ? 'Confirm' : '确认更改'}
                     </button>
                   </div>
                 </div>
               </div>
             </div>
           )}
           {field.type === 'singleSelect' || field.type === 'multiSelect' ? (
             <div className="border-t border-gray-100 pt-2 text-xs text-gray-500 text-center">
               {lang === 'en' ? '(Options auto-generated currently)' : '(选项会自动为您生成)'}
             </div>
           ) : null}
           <div className="border-t border-gray-100 my-2"></div>
           <button className="w-full flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors rounded" onClick={() => { onDeleteField(); setShowMenu(false); }}>
              <Trash2 className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Delete Field' : '删除字段'}
           </button>
        </div>
      )}
      
      <div 
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500 active:bg-blue-600 z-10"
        onClick={e => e.stopPropagation()}
        onMouseDown={handleResizeStart}
      />
    </th>
  );
}

interface CellProps {
  key?: React.Key;
  record: BaseRecord;
  field: Field;
  isActive: boolean;
  forceEdit?: boolean;
  isGeneratingCol?: boolean;
  onActivate: () => void;
  onChange: (value: any) => void;
  onBlur: () => void;
  onPreviewImage: (url: string, images?: string[]) => void;
  allFields: Field[];
  modelSettings: any;
  heightClass: string;
  onUpdateField: (updates: Partial<Field>) => void;
  isSelectedBox: boolean;
  isCutBox: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onActivateNextRow: () => void;
  onBatchAIGenerate?: () => void;
  lang?: 'en' | 'zh';
}

function Cell({ record, field, isActive, forceEdit, isGeneratingCol, onActivate, onChange, onBlur, onPreviewImage, allFields, modelSettings, heightClass, onUpdateField, isSelectedBox, isCutBox, onMouseDown, onMouseEnter, onActivateNextRow, onBatchAIGenerate, lang = 'zh' }: CellProps) {
  const value = record[field.id];
  
  const [isEditingMode, setIsEditingMode] = useState(false);

  const [localText, setLocalText] = useState('');

  useEffect(() => {
    if (!isActive) setIsEditingMode(false);
  }, [isActive]);

  useEffect(() => {
    if (forceEdit && isActive && !isEditingMode) {
      if (['text', 'aiText', 'url'].includes(field.type)) {
         const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
         setLocalText(String(v || ''));
      }
      setIsEditingMode(true);
    }
  }, [forceEdit, isActive, isEditingMode, field.type, value]);

  useEffect(() => {
    if (isEditingMode && (field.type === 'text' || field.type === 'url' || field.type === 'aiText')) {
      const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
      setLocalText(v || '');
    }
  }, [isEditingMode, value, field.type]);

  const ref = useClickOutside(() => {
    if (isActive) {
       if (isEditingMode && (field.type === 'text' || field.type === 'url' || field.type === 'aiText')) {
          onChange(localText);
       }
       onBlur();
       setIsEditingMode(false);
    }
  });
  
  useEffect(() => {
    if (!isActive) setIsEditingMode(false);
  }, [isActive]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    if (textareaRef.current && isEditingMode && ['text', 'aiText', 'url'].includes(field.type)) {
      const el = textareaRef.current;
      el.style.height = 'auto'; // Reset height
      const scrollHeight = el.scrollHeight;
      
      let minHeightPx = 40;
      if (heightClass === 'h-[56px]') minHeightPx = 56;
      else if (heightClass === 'h-[80px]') minHeightPx = 80;
      else if (heightClass === 'h-[120px]') minHeightPx = 120;

      let newHeight = Math.max(minHeightPx, scrollHeight);
      if (newHeight > 200) newHeight = 200;
      
      el.style.height = `${newHeight + 2}px`; // +2 for borders since it's absolutely positioned at -1
    }
  }, [localText, isEditingMode, field.type, heightClass]);

  const handleAIGenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onBatchAIGenerate) onBatchAIGenerate();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isActive) return;
    if (e.key === 'Enter' && !isEditingMode) {
      e.preventDefault();
      setIsEditingMode(true);
    } else if (e.key === 'Escape' && isEditingMode) {
      setIsEditingMode(false);
      // Let it stay active, but not editing
      e.stopPropagation();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && !isEditingMode) {
      e.preventDefault();
      onChange(''); // clear cell
    }
  };

  // Just render based on field type
  const renderContent = () => {
    if (isActive && isEditingMode) {
      if (field.type === 'person') {
        return (
          <PersonSelectPopup 
            value={value} 
            onChange={(val) => { onChange(val); setIsEditingMode(false); onBlur(); }} 
            onClose={() => setIsEditingMode(false)} 
            onUpdateField={onUpdateField}
          />
        );
      }
      if (field.type === 'aiText') {
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
          displayValue = JSON.stringify(value);
        }
        return (
          <div className="flex h-full w-full relative">
            <textarea
              ref={textareaRef}
              autoFocus
              onFocus={(e) => {
                const len = e.target.value.length;
                e.target.setSelectionRange(len, len);
              }}
              className="flex-1 w-full px-2 py-1.5 outline-none bg-white resize-none overflow-y-auto ring-[1.5px] ring-blue-500 ring-inset"
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={() => {
                onChange(localText);
                setIsEditingMode(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                   onChange(localText);
                   setIsEditingMode(false);
                   e.stopPropagation();
                }
                if (e.key === 'Enter') {
                   if (e.altKey) {
                     e.preventDefault();
                     const el = e.target as HTMLTextAreaElement;
                     const start = el.selectionStart;
                     const end = el.selectionEnd;
                     const nt = localText.substring(0, start) + '\n' + localText.substring(end);
                     setLocalText(nt);
                     setTimeout(() => {
                       el.selectionStart = el.selectionEnd = start + 1;
                     }, 0);
                   } else if (!e.shiftKey) {
                     e.preventDefault();
                     onChange(localText);
                     setIsEditingMode(false);
                     onActivateNextRow();
                     e.stopPropagation();
                   }
                }
              }}
              style={{ position: 'absolute', zIndex: 30, left: -1, right: -1, top: -1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
            />
            <div className="absolute right-0 top-0 h-[32px] flex items-center pr-1 z-40">
               <button 
                 onMouseDown={handleAIGenerate} 
                 className={cn("p-1 rounded shadow-sm text-white", isGeneratingCol ? "bg-gray-400" : "bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600")}
                 title="Generate with AI"
                 disabled={isGeneratingCol}
               >
                  <Sparkles className="w-3.5 h-3.5" />
               </button>
            </div>
          </div>
        );
      }
      if (field.type === 'text' || field.type === 'url') {
        return (
          <textarea
            ref={textareaRef}
            autoFocus
            onFocus={(e) => {
              const len = e.target.value.length;
              e.target.setSelectionRange(len, len);
            }}
            className="w-full px-2 py-1.5 outline-none bg-white resize-none overflow-y-auto absolute z-30 shadow-[0_4px_6px_-1px_rgb(0,0,0,0.1),0_2px_4px_-2px_rgb(0,0,0,0.1)] border-none ring-[1.5px] ring-blue-500 ring-inset"
            value={localText}
            onChange={(e) => setLocalText(e.target.value)}
            onBlur={() => {
              onChange(localText);
              setIsEditingMode(false);
            }}
            style={{ left: -1, right: -1, top: -1 }}
            onKeyDown={(e) => {
               if (e.key === 'Escape') {
                  onChange(localText);
                  setIsEditingMode(false);
                  e.stopPropagation();
               }
               if (e.key === 'Enter') {
                  if (e.altKey) {
                    e.preventDefault();
                    const el = e.target as HTMLTextAreaElement;
                    const start = el.selectionStart;
                    const end = el.selectionEnd;
                    const nt = localText.substring(0, start) + '\n' + localText.substring(end);
                    setLocalText(nt);
                    setTimeout(() => {
                      el.selectionStart = el.selectionEnd = start + 1;
                    }, 0);
                  } else if (!e.shiftKey) {
                    e.preventDefault();
                    onChange(localText);
                    setIsEditingMode(false);
                    onActivateNextRow();
                    e.stopPropagation();
                  }
               }
            }}
          />
        );
      }
      if (field.type === 'number') {
        return (
          <input
            autoFocus
            type="number"
            className="w-full h-full px-2 outline-none bg-white text-right absolute z-30 shadow-[0_4px_6px_-1px_rgb(0,0,0,0.1),0_2px_4px_-2px_rgb(0,0,0,0.1)] border-none ring-[1.5px] ring-blue-500 ring-inset"
            defaultValue={value}
            onBlur={(e) => {
              const val = e.target.value === '' ? null : Number(e.target.value);
              onChange(val);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setIsEditingMode(false);
              } else if (e.key === 'Escape') {
                setIsEditingMode(false);
                e.stopPropagation();
              }
            }}
            style={{ left: -1, right: -1, top: -1, height: 'calc(100% + 2px)' }}
          />
        );
      }
      if (field.type === 'date') {
        return (
          <input
            autoFocus
            type="date"
            className="w-full h-full px-2 outline-none bg-white absolute z-30 shadow-[0_4px_6px_-1px_rgb(0,0,0,0.1),0_2px_4px_-2px_rgb(0,0,0,0.1)] border-none ring-[1.5px] ring-blue-500 ring-inset"
            defaultValue={value || ''}
            onBlur={(e) => onChange(e.target.value)}
            style={{ left: -1, right: -1, top: -1, height: 'calc(100% + 2px)' }}
          />
        );
      }
      if (field.type === 'singleSelect' || field.type === 'multiSelect') {
        const isMulti = field.type === 'multiSelect';
        const ids = isMulti ? (Array.isArray(value) ? value : (value ? [value] : [])) : (value ? [value] : []);
        return (
          <SelectCellEditor 
            field={field} 
            ids={ids}
            lang={lang}
            isMulti={isMulti}
            onChange={onChange} 
            onClose={() => setIsEditingMode(false)} 
            onUpdateField={onUpdateField}
            onBlur={onBlur}
          />
        );
      }
      if (field.type === 'checkbox') {
         // Checkbox edits instantly
         return (
          <div className="flex h-full items-center justify-center bg-white cursor-pointer ring-[1.5px] ring-blue-500 ring-inset z-30 relative" onClick={() => { onChange(!value); setIsEditingMode(false); onBlur(); }}>
            <input type="checkbox" checked={!!value} readOnly className="w-4 h-4 cursor-pointer" />
          </div>
        );
      }
      if (field.type === 'attachment' || field.type === 'aiImage') {
        return (
          <AttachmentCellEditor 
            value={value} 
            onChange={onChange} 
            onClose={() => setIsEditingMode(false)}
            onPreview={onPreviewImage}
          />
        );
      }
    }

    // Read only view
    switch (field.type) {
      case 'attachment': {
        let filePaths: string[] = [];
        if (Array.isArray(value)) {
          filePaths = value.map((v: any) => typeof v === 'string' ? v : v.url || v.name || '');
        } else if (typeof value === 'string' && value.trim() !== '') {
          filePaths = value.split(',').map(s => s.trim());
        }
        
        let imgSizeClass = 'h-[24px] w-[24px]';
        let containerHeightClass = 'h-[26px]';
        if (heightClass === 'h-[40px]') { imgSizeClass = 'h-[28px] w-[28px]'; containerHeightClass = 'h-[30px]'; }
        else if (heightClass === 'h-[56px]') { imgSizeClass = 'h-[44px] w-[44px]'; containerHeightClass = 'h-[46px]'; }
        else if (heightClass === 'h-[80px]') { imgSizeClass = 'h-[68px] w-[68px]'; containerHeightClass = 'h-[70px]'; }
        else if (heightClass === 'h-[120px]') { imgSizeClass = 'h-[108px] w-[108px]'; containerHeightClass = 'h-[110px]'; }

        return (
          <div 
             className="px-1 h-full flex items-center cursor-pointer flex-wrap gap-1 py-1"
             onClick={(e) => { e.stopPropagation(); onActivate(); if (isActive) setIsEditingMode(true); }}
          >
             {filePaths.length === 0 ? (
               <div className="text-gray-300 w-full text-center">+</div>
             ) : (
               <div className={`flex items-center gap-1 overflow-hidden w-full ${containerHeightClass}`}>
                  {filePaths.map((path, i) => {
                    let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path);
                    return (
                      <div key={i} className="relative group/img-item shrink-0">
                        <ThumbnailImage 
                          path={path}
                          alt={path.split('/').pop()?.split('\\').pop() || 'image'} 
                          className={`${imgSizeClass} object-cover rounded border border-gray-200 bg-gray-100 cursor-pointer`} 
                          title={path}
                          onClick={(e) => { e.stopPropagation(); onPreviewImage(fullUrl, filePaths.map(p => fullImageBlobCache.get(p) || (p.startsWith('/') || p.match(/^[a-zA-Z]:\\/) ? `file://${p}` : p))); }}
                        />
                        <div className="absolute top-0.5 right-0.5 bg-white/80 text-gray-700 rounded p-0.5 opacity-0 group-hover/img-item:opacity-100 flex items-center gap-1 shadow-sm z-10 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); copyImageToClipboardMagic(path); }} title="Copy">
                             <Copy className="w-3.5 h-3.5 hover:text-blue-500" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onChange(filePaths.filter((_, idx) => idx !== i).join(','));
                            }}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5 hover:text-red-500 text-gray-500" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
               </div>
             )}
          </div>
        );
      }
      case 'aiImage': {
        let filePaths: string[] = [];
        if (Array.isArray(value)) {
          filePaths = value.map((v: any) => typeof v === 'string' ? v : v.url || v.name || '');
        } else if (typeof value === 'string' && value.trim() !== '') {
          filePaths = value.split(',').map(s => s.trim());
        }
        
        let imgSizeClass = 'h-[24px] w-[24px]';
        let containerHeightClass = 'h-[26px]';
        if (heightClass === 'h-[40px]') { imgSizeClass = 'h-[28px] w-[28px]'; containerHeightClass = 'h-[30px]'; }
        else if (heightClass === 'h-[56px]') { imgSizeClass = 'h-[44px] w-[44px]'; containerHeightClass = 'h-[46px]'; }
        else if (heightClass === 'h-[80px]') { imgSizeClass = 'h-[68px] w-[68px]'; containerHeightClass = 'h-[70px]'; }
        else if (heightClass === 'h-[120px]') { imgSizeClass = 'h-[108px] w-[108px]'; containerHeightClass = 'h-[110px]'; }

        return (
          <div className="px-1 py-1 h-full flex flex-col justify-center relative group/ai w-full overflow-hidden">
             {isGeneratingCol ? (
               <div className="flex items-center gap-1.5 text-blue-500 font-medium text-xs px-1">
                 <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                 <span>Generating...</span>
               </div>
             ) : filePaths.length > 0 ? (
               <div className={`flex items-center gap-1 overflow-hidden w-full ${containerHeightClass}`}>
                  {filePaths.map((path, i) => {
                    let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path);
                    return (
                      <div key={i} className="relative group/img-item shrink-0">
                        <ThumbnailImage 
                          path={path}
                          alt="ai-generated" 
                          className={`${imgSizeClass} object-cover rounded border border-gray-200 bg-gray-100 cursor-pointer`} 
                          title={path}
                          onClick={(e) => { e.stopPropagation(); onPreviewImage(fullUrl, filePaths.map(p => fullImageBlobCache.get(p) || (p.startsWith('/') || p.match(/^[a-zA-Z]:\\/) ? `file://${p}` : p))); }}
                        />
                        <div className="absolute top-0.5 right-0.5 bg-white/80 text-gray-700 rounded p-0.5 opacity-0 group-hover/img-item:opacity-100 flex items-center gap-1 shadow-sm z-10 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); copyImageToClipboardMagic(path); }} title="Copy">
                             <Copy className="w-3.5 h-3.5 hover:text-blue-500" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onChange(filePaths.filter((_, idx) => idx !== i).join(','));
                            }}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5 hover:text-red-500 text-gray-500" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
               </div>
             ) : (
                <div className="text-gray-300 w-full text-center text-xs italic opacity-0 group-hover/ai:opacity-100 transition-opacity">Empty</div>
             )}
             
             {!isGeneratingCol && isActive && (
                <button 
                  onMouseDown={handleAIGenerate} 
                  className="absolute right-1 top-1.5 p-1 rounded bg-white shadow-sm hover:bg-gradient-to-r hover:from-purple-500 hover:to-indigo-500 hover:text-white text-gray-400 opacity-0 group-hover/ai:opacity-100 transition-all z-10 border border-gray-200"
                  title="Generate AI Image"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
             )}
          </div>
        );
      }
      case 'checkbox':
        return (
          <div className="flex h-full items-center justify-center cursor-pointer" onClick={(e) => { e.stopPropagation(); onChange(!value); onActivate(); }}>
             <input type="checkbox" checked={!!value} readOnly className="w-4 h-4 pointer-events-none text-blue-500 rounded focus:ring-0 focus:outline-none" />
          </div>
        );
      case 'singleSelect': {
        const val = Array.isArray(value) ? value[0] : value;
        const option = field.options?.find(o => o.id === val);
        return (
          <div className="flex items-center h-full px-2 cursor-pointer" onClick={() => { onActivate(); if (isActive) setIsEditingMode(true); }}>
            {option ? (
               <span className={cn("inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium truncate max-w-full", option.color)}>
                 {option.name}
               </span>
            ) : null}
          </div>
        );
      }
      case 'multiSelect': {
        const ids = Array.isArray(value) ? value : (value ? [value] : []);
        return (
          <div className="flex items-center h-full px-2 gap-1 overflow-hidden cursor-pointer" onClick={() => { onActivate(); if (isActive) setIsEditingMode(true); }}>
            {ids.length > 0 ? ids.map((id: string) => {
              const option = field.options?.find(o => o.id === id);
              if (!option) return null;
              return (
                <span key={id} className={cn("inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0", option.color)}>
                  {option.name}
                </span>
              );
            }) : null}
          </div>
        );
      }
      case 'number':
        return <div className="px-2 h-full flex items-center justify-end truncate">{value}</div>;
      case 'url':
        return (
          <div className="px-2 py-1 h-full flex flex-col justify-center w-full overflow-hidden">
            {value ? <a href={value} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline whitespace-normal break-all overflow-hidden text-sm leading-tight w-full" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }} onClick={(e) => { e.stopPropagation(); window.open(value, '_blank'); }}>{value}</a> : null}
          </div>
        );
      case 'person': {
        const displayValue = typeof value === 'string' ? value : (value ? JSON.stringify(value) : '');
        return (
           <div className="px-2 h-full flex items-center truncate space-x-1.5 cursor-pointer" onClick={() => { onActivate(); if (isActive) setIsEditingMode(true); }}>
             {displayValue ? (
               <>
                 <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-[10px] font-bold shrink-0">
                   {typeof value === 'string' ? value.charAt(0).toUpperCase() : '?'}
                 </div>
                 <span className="truncate">{displayValue}</span>
               </>
             ) : null}
           </div>
        );
      }
      case 'aiText': {
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
          displayValue = JSON.stringify(value);
        }
        
        if (isGeneratingCol) {
          return (
            <div className="px-2 h-full flex items-center gap-1.5 text-blue-500 font-medium text-xs">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>Generating...</span>
            </div>
          );
        }

        return (
          <div className="px-2 py-1 h-full flex flex-col justify-center relative group/ai w-full overflow-hidden">
            <span className="whitespace-normal break-all overflow-hidden text-sm leading-tight w-full pr-4" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }}>{displayValue}</span>
            {!value && !isGeneratingCol && isActive && (
               <button onMouseDown={handleAIGenerate}
                 className="absolute right-1 top-1.5 p-1 rounded bg-gray-100 hover:bg-gradient-to-r hover:from-purple-500 hover:to-indigo-500 hover:text-white text-gray-400 opacity-0 group-hover/ai:opacity-100 transition-all z-10"
                 title="Quick Generate"
               >
                 <Sparkles className="w-3.5 h-3.5" />
               </button>
            )}
            {isGeneratingCol && <span className="absolute right-2 top-2 text-[10px] text-gray-400">Gen...</span>}
          </div>
        );
      }
      case 'formula': {
        let displayValue: any = '';
        try {
          // Fallback to the globally exposed computeFormulaValue 
          // wait, we don't have it imported here. I can just write it here or export it from App.tsx. 
          // Wait, App.tsx is importing Grid, so Grid cannot import App. But wait, `import { computeFormulaValue } from '../App'` might cause circular dependency?
          // Let's implement the same logic here.
          if (field.prompt) {
            let formulaStr = field.prompt;
            const variableNames: string[] = [];
            const variableValues: any[] = [];
            
            if (field.refFields) {
              field.refFields.forEach(refId => {
                const refField = allFields.find(f => f.id === refId);
                if (refField) {
                  const rawVal = record[refId];
                  let valToUse = rawVal;
                  if (refField.type === 'singleSelect') {
                    valToUse = refField.options?.find((o: any) => o.id === rawVal)?.name || rawVal;
                  } else if (refField.type === 'multiSelect' && Array.isArray(rawVal)) {
                    valToUse = rawVal.map((id: string) => refField.options?.find((o: any) => o.id === id)?.name || id).join(', ');
                  }

                  const varName = 'VAR_' + refId.replace(/[^a-zA-Z0-9]/g, '_');
                  const safeFieldName = refField.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  formulaStr = formulaStr.replace(new RegExp(`{${safeFieldName}}`, 'g'), varName);
                  variableNames.push(varName);
                  variableValues.push(valToUse === undefined || valToUse === null ? '' : valToUse);
                }
              });
            }

            let jsFormula = formulaStr;
            if (jsFormula.startsWith('=')) {
              jsFormula = jsFormula.substring(1).replace(/&/g, '+');
            }

            try {
              const fn = new Function(...variableNames, `return (${jsFormula});`);
              displayValue = fn(...variableValues);
            } catch (jsErr) {
              // fallback loop
              let legacyStr = field.prompt;
              const contextData: any = {};
              if (field.refFields) {
                field.refFields.forEach(refId => {
                  const refField = allFields.find(f => f.id === refId);
                  if (refField) {
                    const safeFieldName = refField.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    legacyStr = legacyStr.replace(new RegExp(`{${safeFieldName}}`, 'g'), refField.name);
                    const rawVal = record[refId];
                    let valToUse = rawVal;
                    if (refField.type === 'singleSelect') {
                      valToUse = refField.options?.find((o: any) => o.id === rawVal)?.name || rawVal;
                    } else if (refField.type === 'multiSelect' && Array.isArray(rawVal)) {
                      valToUse = rawVal.map((id: string) => refField.options?.find((o: any) => o.id === id)?.name || id).join(', ');
                    }
                    const numVal = parseFloat(valToUse as string);
                    contextData[refField.name] = !isNaN(numVal) ? numVal : valToUse || '';
                  }
                });
              }
              displayValue = Parser.evaluate(legacyStr, contextData);
            }
          }
        } catch (e) {
          displayValue = '#ERROR';
        }
        
        return (
          <div className="px-2 h-full flex flex-col justify-center w-full overflow-hidden select-text bg-gray-50/50">
            <span className="truncate text-sm leading-tight text-gray-700 italic font-medium">{String(displayValue)}</span>
          </div>
        );
      }
      default: {
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
          displayValue = JSON.stringify(value);
        }
        return (
          <div className="px-2 py-1 h-full flex flex-col justify-center w-full overflow-hidden select-none">
            <span className="whitespace-normal break-all overflow-hidden text-sm leading-tight w-full" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }}>{displayValue}</span>
          </div>
        );
      }
    }
  };

  return (
    <td
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragOver={(e) => {
         if (field.type === 'attachment' && (isActive || isSelectedBox)) {
           e.preventDefault();
           e.stopPropagation();
         }
      }}
      onDrop={(e) => {
         if (field.type === 'attachment' && (isActive || isSelectedBox)) {
           e.preventDefault();
           e.stopPropagation();
           if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
             const files = Array.from(e.dataTransfer.files).filter((f: any) => f.type.startsWith('image/'));
             if (files.length > 0) {
               let existingPaths: string[] = [];
               if (Array.isArray(value)) {
                 existingPaths = value.map((v: any) => typeof v === 'string' ? v : v.url || v.name || '');
               } else if (typeof value === 'string' && value.trim() !== '') {
                 existingPaths = value.split(',').map(s => s.trim());
               }

               const pathMatches = files.map((file: any) => {
                 const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
                 getOrGenerateThumbnail(pathStr, file);
                 if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:\\/)) {
                   fullImageBlobCache.set(pathStr, URL.createObjectURL(file));
                 }
                 return pathStr;
               });

               const newValue = [...existingPaths, ...pathMatches].join(',');
               onChange(newValue);
             }
           }
         }
      }}
      onMouseDown={(e) => {
         // Only select box if not in edit mode, otherwise allow text selection
         if (!isEditingMode) {
             e.preventDefault(); // Prevents text selection while dragging to select cells
             onMouseDown(e);
         }
      }}
      onMouseEnter={() => {
         if (!isEditingMode) onMouseEnter();
      }}
      onClick={(e) => {
        if (!isActive) {
           onActivate();
        } else {
           // If it's already active and not editing, we don't automatically edit unless requested (or double clicked)
        }
      }}
      onDoubleClick={() => {
         if (!isEditingMode) setIsEditingMode(true);
      }}
      className={cn(
        "border-b border-r border-gray-200 relative p-0 bg-white transition-colors cursor-cell group-hover:bg-blue-50/10",
        heightClass,
        isSelectedBox && !isEditingMode && "bg-blue-100/50 group-hover:bg-blue-100/70",
        isCutBox && !isEditingMode && "opacity-50 ring-1 ring-dashed ring-gray-400 ring-inset",
        isActive && !isEditingMode && "ring-[1.5px] ring-blue-500 ring-inset z-20 outline-none"
      )}
    >
      {renderContent()}
    </td>
  );
}


const MOCK_USERS = [
  { id: 'Alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'Bob', name: 'Bob', email: 'bob@example.com' },
  { id: 'Charlie', name: 'Charlie', email: 'charlie@example.com' },
  { id: 'David', name: 'David', email: 'david@example.com' },
  { id: 'Eve', name: 'Eve', email: 'eve@example.com' },
];

function PersonSelectPopup({ value, onChange, onClose, onUpdateField }: { value: any, onChange: (v: any) => void, onClose: () => void, onUpdateField?: (u: Partial<Field>) => void }) {
  const [query, setQuery] = useState('');
  
  const filtered = MOCK_USERS.filter(o => o.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-200 z-50 p-1 flex flex-col">
       <input 
          autoFocus
          className="w-full text-sm px-2 py-1.5 mb-1 outline-none border-b border-gray-100 bg-transparent placeholder-gray-400" 
          placeholder="Search members"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
               if (filtered.length > 0) {
                 onChange(filtered[0].id);
               } else if (query.trim()) {
                 onChange(query.trim());
               }
            }
          }}
       />
       <div className="max-h-48 overflow-y-auto">
         {filtered.length > 0 ? (
           filtered.map(opt => (
              <div 
                key={opt.id} 
                className="px-2 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded flex items-center space-x-2"
                onClick={(e) => { e.stopPropagation(); onChange(opt.id); }}
              >
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold shrink-0">
                   {opt.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col">
                   <span className="truncate leading-none">{opt.name}</span>
                   <span className="truncate text-gray-400 text-xs mt-0.5">{opt.email}</span>
                </div>
              </div>
           ))
         ) : query.trim() ? (
           <div 
              className="px-2 py-2 text-sm cursor-pointer hover:bg-blue-50 rounded flex items-center space-x-2 text-blue-600 font-medium"
              onClick={(e) => { e.stopPropagation(); onChange(query.trim()); }}
           >
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold shrink-0">
                 {query.trim().charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                 <span className="truncate leading-none">Assign to "{query}"</span>
                 <span className="truncate text-gray-400 text-xs mt-0.5">External user</span>
              </div>
           </div>
         ) : (
           <div className="px-2 py-2 text-xs text-gray-400 text-center">No matching members</div>
         )}
       </div>
    </div>
  );
}

function SelectCellEditor({ field, ids, isMulti, onChange, onClose, onUpdateField, onBlur, lang }: { field: Field, ids: string[], isMulti: boolean, onChange: (v: any) => void, onClose: () => void, onUpdateField?: (u: Partial<Field>) => void, onBlur: () => void, lang?: 'en' | 'zh' }) {
  const [query, setQuery] = useState('');
  const options = field.options || [];
  const filtered = options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()));

  const toggleOption = (id: string) => {
    if (isMulti) {
      if (ids.includes(id)) {
        onChange(ids.filter(x => x !== id));
      } else {
        onChange([...ids, id]);
        setQuery('');
      }
    } else {
      onChange(id);
      onClose();
      onBlur();
    }
  };

  const handleCreateOption = () => {
    if (!query.trim()) return;
    const newId = 'opt_' + Math.random().toString(36).substring(2, 9);
    const newColor = ['text-blue-700 bg-blue-100', 'text-green-700 bg-green-100', 'text-amber-700 bg-amber-100', 'text-purple-700 bg-purple-100', 'text-pink-700 bg-pink-100'][options.length % 5];
    const newOption = { id: newId, name: query.trim(), color: newColor };
    if (onUpdateField) onUpdateField({ options: [...options, newOption] });
    
    if (isMulti) {
      onChange([...ids, newId]);
      setQuery('');
    } else {
      onChange(newId);
      onClose();
      onBlur();
    }
  };

  return (
    <>
      <div 
        className="flex items-center h-full w-full px-2 gap-1 flex-wrap overflow-y-auto bg-white z-30 ring-1 ring-blue-500 absolute top-0 left-0"
        style={{ minHeight: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {ids.map(id => {
          const option = options.find(o => o.id === id);
          if (!option) return null;
          return (
            <span key={id} className={cn("inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0", option.color)}>
              {option.name}
              <button 
                className="ml-1 text-black/50 hover:text-black focus:outline-none flex-shrink-0"
                onClick={(e) => {
                   e.stopPropagation();
                   if (isMulti) {
                     onChange(ids.filter(x => x !== id));
                   } else {
                     onChange(null);
                   }
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
        <input 
          autoFocus 
          className="flex-1 min-w-[50px] bg-transparent outline-none text-sm placeholder-gray-400 py-1" 
          placeholder={ids.length ? "" : (lang === 'en' ? "Find an option" : "搜索选项")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
               e.preventDefault();
               if (filtered.length > 0) {
                 toggleOption(filtered[0].id);
               } else if (query.trim()) {
                 handleCreateOption();
               }
            } else if (e.key === 'Escape') {
               onClose();
               onBlur();
            } else if (e.key === 'Backspace' && query === '' && ids.length > 0) {
               // delete last tag
               const newIds = ids.slice(0, -1);
               if (isMulti) {
                 onChange(newIds);
               } else {
                 onChange(null);
               }
            }
          }}
        />
      </div>
      
      <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-200 z-50 p-1 flex flex-col">
        <div className="max-h-48 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map(opt => {
               const isSelected = ids.includes(opt.id);
               return (
                 <div 
                   key={opt.id} 
                   className="px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-100 rounded flex items-center justify-between"
                   onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleOption(opt.id); }}
                 >
                   <div className="flex items-center">
                     <div className={cn("w-2 h-2 rounded-full mr-2", opt.color.split(' ')[1].replace('text-', 'bg-'))} />
                     <span className="truncate">{opt.name}</span>
                   </div>
                   {isSelected && <Check className="w-3.5 h-3.5 text-blue-500" />}
                 </div>
               );
            })
          ) : query.trim() ? (
            <div 
               className="px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50 rounded flex items-center text-blue-600 font-medium"
               onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCreateOption(); }}
            >
               <Plus className="w-4 h-4 mr-2" />
               {lang === 'en' ? `Add "${query}"` : `添加 "${query}"`}
            </div>
          ) : (
            <div className="px-2 py-1.5 text-sm text-gray-400">{lang === 'en' ? "No options" : "无匹配选项"}</div>
          )}
        </div>
      </div>
    </>
  );
}

function AttachmentCellEditor({ value, onChange, onClose, onPreview }: { value: any, onChange: (v: any) => void, onClose: () => void, onPreview: (url: string, allUrls?: string[]) => void }) {
  let filePaths: string[] = [];
  if (Array.isArray(value)) {
    filePaths = value.map((v: any) => typeof v === 'string' ? v : v.url || v.name || '');
  } else if (typeof value === 'string' && value.trim() !== '') {
    filePaths = value.split(',').map(s => s.trim());
  }

  const ref = useClickOutside(onClose);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draggedImgIndex, setDraggedImgIndex] = useState<number | null>(null);
  const [dragOverImgIndex, setDragOverImgIndex] = useState<number | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files as FileList);
      const pathMatches = files.map((file: any) => {
        const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
        getOrGenerateThumbnail(pathStr, file);
        if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:\\/)) {
          fullImageBlobCache.set(pathStr, URL.createObjectURL(file));
        }
        return pathStr;
      });
      onChange([...filePaths, ...pathMatches].join(','));
    }
  };

  const handleRemove = (index: number) => {
    onChange(filePaths.filter((_, idx) => idx !== index).join(','));
  };

  const handleDrop = (e: React.DragEvent, targetIndex?: number) => {
    e.preventDefault();
    e.stopPropagation();

    // Prioritize internal drag and drop of attachment images 
    if (draggedImgIndex !== null) {
      if (targetIndex === undefined || draggedImgIndex === targetIndex) {
        setDraggedImgIndex(null);
        setDragOverImgIndex(null);
        return;
      }

      const newArr = [...filePaths];
      const [moved] = newArr.splice(draggedImgIndex, 1);
      newArr.splice(targetIndex, 0, moved);
      onChange(newArr.join(','));
      
      setDraggedImgIndex(null);
      setDragOverImgIndex(null);
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter((f: any) => f.type.startsWith('image/'));
      if (files.length > 0) {
        const pathMatches = files.map((file: any) => {
          // Add support for window.electronAPI.getPathForFile if exposed in preload
          const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
          getOrGenerateThumbnail(pathStr, file);
          if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:\\/)) {
            fullImageBlobCache.set(pathStr, URL.createObjectURL(file));
          }
          return pathStr;
        });
        onChange([...filePaths, ...pathMatches].join(','));
        setDragOverImgIndex(null);
        return;
      }
    }
  };

  return (
    <div 
      ref={ref} 
      className="absolute top-0 left-0 min-w-[350px] bg-white rounded shadow-lg border border-gray-200 z-50 p-3 flex flex-col gap-2"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => handleDrop(e)}
    >
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-gray-500">Attachments</label>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded text-gray-400">
           <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2 w-[340px]">
        {filePaths.map((path, index) => {
           let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path);
           
           return (
             <div 
               key={`${path}_${index}`} 
               className={cn(
                 "relative group/attachment cursor-grab active:cursor-grabbing w-[108px] h-[108px] border rounded bg-gray-50 flex items-center justify-center overflow-hidden",
                 draggedImgIndex === index ? "opacity-30" : "",
                 dragOverImgIndex === index ? "ring-2 ring-blue-500" : "border-gray-200"
               )}
               draggable
               onDragStart={(e) => {
                 setDraggedImgIndex(index);
                 e.dataTransfer.effectAllowed = 'move';
               }}
               onDragOver={(e) => {
                 e.preventDefault();
                 if (dragOverImgIndex !== index) setDragOverImgIndex(index);
               }}
               onDragLeave={() => {
                 if (dragOverImgIndex === index) setDragOverImgIndex(null);
               }}
               onDrop={(e) => handleDrop(e, index)}
               onDragEnd={() => { setDraggedImgIndex(null); setDragOverImgIndex(null); }}
               onClick={() => onPreview(fullUrl, filePaths.map(p => fullImageBlobCache.get(p) || (p.startsWith('/') || p.match(/^[a-zA-Z]:\\/) ? `file://${p}` : p)))}
             >
               <ThumbnailImage path={path} className="w-full h-full object-cover cursor-pointer" alt="attachment" />
               <div 
                 className="absolute top-1 right-1 bg-black/60 text-white rounded p-1 opacity-0 group-hover/attachment:opacity-100 cursor-pointer flex items-center gap-1.5 transition-opacity"
               >
                 <button onClick={(e) => { e.stopPropagation(); copyImageToClipboardMagic(path); }} title="Copy">
                    <Copy className="w-3.5 h-3.5 hover:text-blue-300" />
                 </button>
                 <button onClick={(e) => { e.stopPropagation(); triggerDownload(path, path.split('/').pop()?.split('\\').pop() || 'download.png'); }} title="Download">
                    <Download className="w-3.5 h-3.5 hover:text-blue-300" />
                 </button>
                 <button onClick={(e) => { e.stopPropagation(); handleRemove(index); }} title="Delete">
                    <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-300" />
                 </button>
               </div>
             </div>
           );
        })}
        
        <div 
          className="w-[108px] h-[108px] border border-dashed border-gray-300 rounded flex items-center justify-center cursor-pointer hover:bg-gray-50 text-gray-400 hover:text-blue-500 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus className="w-8 h-8" />
        </div>
      </div>
      
      <input 
        type="file" 
        multiple 
        accept="image/*" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
      />
    </div>
  );
}
