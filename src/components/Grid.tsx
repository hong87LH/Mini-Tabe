import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Field, BaseRecord, GridData, SelectOption, FieldType, Attachment } from '../types';
import { FieldIcon } from './FieldIcon';
import { cn, getStringColor } from '../lib/utils';
import { Lock, Plus, GripVertical, ChevronDown, Check, Image as ImageIcon, X, Sparkles, ArrowDownUp, Trash2, Filter, Copy, Download, ChevronLeft, ChevronRight, EyeOff, Send, MessageSquare, MessageSquareText, Star, Loader2, Play, Music2, Crop, Expand, Palette, Link, Unlink, ClipboardCopy, ClipboardPaste, Maximize2 } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { Parser } from 'expr-eval';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  stripPreviewOnlyProps,
  normalizeAttachmentKey,
  mergeReviewProps,
  pickGlobalReviewProps,
  normalizeAttachmentItems,
  hydrateReviewProps,
  AttachmentReviewProps
} from '../lib/attachmentUtils';

type NetworkJobCellItem = {
  type: 'networkJob';
  jobId: string;
};

function isNetworkJobCellItem(value: unknown): value is NetworkJobCellItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as any).type === 'networkJob' &&
    typeof (value as any).jobId === 'string'
  );
}

const normalizeProviderList = (value: any): any[] => {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return value ? [value] : [];
};

const parseProviderModels = (provider: any): string[] => {
  return [provider?.modelName, provider?.modelAliases]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
};

const parseProviderDisplayModels = (provider: any): string[] => {
  return String(provider?.modelName || '').split(',').map(model => model.trim()).filter(Boolean);
};

const isProviderEnabled = (provider: any): boolean => {
  return provider?.enabled !== false;
};

const getEnabledProviders = (value: any): any[] => {
  return normalizeProviderList(value).filter(isProviderEnabled);
};

const getAllConfiguredModels = (value: any): string[] => {
  return Array.from(
    new Set(
      normalizeProviderList(value).flatMap(parseProviderDisplayModels)
    )
  );
};

const findEnabledProviderForModel = (
  providerValue: any,
  modelName: string,
  categoryLabel: string,
  lang: 'en' | 'zh' = 'zh'
): any => {
  const matches = getEnabledProviders(providerValue).filter(provider =>
    parseProviderModels(provider).includes(modelName)
  );

  if (matches.length === 0) {
    throw new Error(
      lang === 'en'
        ? `The model "${modelName}" has no enabled ${categoryLabel} API configuration. Open API Settings and enable the protocol you want to use.`
        : `模型“${modelName}”当前没有启用的${categoryLabel} API 配置。请前往“API 和模型配置”打开对应协议的眼睛。`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      lang === 'en'
        ? `The model "${modelName}" has multiple enabled ${categoryLabel} API configurations. Open API Settings and click the protocol you want to use.`
        : `模型“${modelName}”同时启用了多个${categoryLabel} API 配置。请前往“API 和模型配置”，点击希望使用的协议。`
    );
  }

  return matches[0];
};


type RetouchImageResize = {
  width: number;
  height: number;
};

function normalizeLocalPathForStorage(value: unknown): string {
  let normalized = String(value || '').trim();
  if (!normalized) return '';

  if (/^file:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^file:\/\//i, '');

    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep the undecoded path if it contains invalid escape sequences.
    }

    // file:///C:/folder/file.png -> C:\folder\file.png
    if (/^\/[a-zA-Z]:[\\/]/.test(normalized)) {
      normalized = normalized.slice(1);
    }

    // file:////server/share/file.png -> \\server\share\file.png
    if (/^\/\/[^/]/.test(normalized)) {
      normalized = `\\\\${normalized.slice(2).replace(/\//g, '\\')}`;
    } else if (/^[a-zA-Z]:\//.test(normalized)) {
      normalized = normalized.replace(/\//g, '\\');
    }
  }

  return normalized;
}

function resolveRetouchImageResize(
  config: any,
  fields: Field[],
  record: BaseRecord
): RetouchImageResize | null {
  if (!config?.isRetouchMode || config.scaleToSource === false) {
    return null;
  }

  const template = String(config.sourceImageTemplate || '');
  const matches = fields
    .map(field => ({
      field,
      index: template.indexOf(`{${field.name}}`)
    }))
    .filter(match => match.index !== -1)
    .sort((a, b) => a.index - b.index);

  for (const match of matches) {
    const value = record[match.field.id];
    if (!value) continue;

    const items = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(',') : [value]);
    const first = items[0];

    if (!first || typeof first !== 'object' || !first.cropData) {
      continue;
    }

    const crop = first.cropData;
    const requiredMetrics = [
      crop.imgW,
      crop.imgH,
      crop.naturalW,
      crop.naturalH,
      crop.scale,
      crop.maskW,
      crop.maskH
    ];

    if (!requiredMetrics.every(metric => Number(metric) > 0)) {
      return null;
    }

    const width = Math.max(
      1,
      Math.round(
        (Number(crop.maskW) / Number(crop.scale)) *
        (Number(crop.naturalW) / Number(crop.imgW))
      )
    );
    const height = Math.max(
      1,
      Math.round(
        (Number(crop.maskH) / Number(crop.scale)) *
        (Number(crop.naturalH) / Number(crop.imgH))
      )
    );

    return { width, height };
  }

  return null;
}

function HighlightedText({ text, query }: { text: string; query?: string }) {
  if (!query || !text) return <>{text}</>;
  const lowerText = String(text).toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts = [];
  let startIndex = 0;
  while (true) {
    const index = lowerText.indexOf(lowerQuery, startIndex);
    if (index === -1) {
      parts.push(<span key={`end-${startIndex}`}>{String(text).substring(startIndex)}</span>);
      break;
    }
    parts.push(<span key={`text-${startIndex}`}>{String(text).substring(startIndex, index)}</span>);
    parts.push(<span key={`match-${index}`} className="bg-blue-200 text-blue-900 rounded-sm px-0.5">{String(text).substring(index, index + query.length)}</span>);
    startIndex = index + query.length;
  }
  return <>{parts}</>;
}

function encodeTSV(val: string): string {
    if (val.includes('\n') || val.includes('\t') || val.includes('"') || val.includes('\r')) {
        return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
}

function parseTSV(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    currentCell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                currentCell += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === '\t') {
                currentRow.push(currentCell);
                currentCell = "";
            } else if (char === '\n') {
                currentRow.push(currentCell);
                rows.push(currentRow);
                currentRow = [];
                currentCell = "";
            } else if (char === '\r') {
                // ignore
            } else {
                currentCell += char;
            }
        }
    }
    currentRow.push(currentCell);
    if (currentRow.length > 0 || rows.length === 0) {
        rows.push(currentRow);
    }
    
    if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
        rows.pop();
    }
    return rows;
}

const copyImageToClipboardMagic = (path: string) => {
   navigator.clipboard.writeText(normalizeLocalPathForStorage(path));
};

const zoomLevels = [0.125, 0.25, 0.5, 0.707, 1, 1.414, 2, 2.828, 4, 5.656, 8];

const ZoomableImage = ({ 
  item, 
  onPrev, 
  onNext, 
  onClose,
  onUpdateItem,
  username,
  lang = 'zh',
  sourceViewMode,
  itemInstanceKey
}: { 
  item: any, 
  onPrev: (e: React.MouseEvent) => void, 
  onNext: (e: React.MouseEvent) => void, 
  onClose: () => void,
  onUpdateItem?: (newItem: any) => void,
  username?: string,
  lang?: 'en' | 'zh',
  sourceViewMode?: 'table' | 'gallery',
  itemInstanceKey?: string | number
}) => {
  const src = item.mappedUrl;
  const mediaPath = String(src || '').toLowerCase();
  const isVideo = /\.(mp4|webm|mov|mkv)(\?|$)/.test(mediaPath) || mediaPath.startsWith('data:video');
  const isAudio = /\.(mp3|wav|flac|m4a|aac|ogg|opus)(\?|$)/.test(mediaPath) || mediaPath.startsWith('data:audio');
  const refCellsData: any[] = item.refCells || item.refUrls || [];
  // normalize so refCells is always string[][]
  const refCells: string[][] = refCellsData.map(r => Array.isArray(r) ? r : [r]);

  const [activeRefImgIndices, setActiveRefImgIndices] = useState<number[]>(refCells.map(() => 0));
  
  // Use state to track if reference panel should be shown.
  // Defaults to true if launched from gallery (Review Mode), false if from table (Normal Default View).
  const [isRefMode, setIsRefMode] = useState(sourceViewMode === 'gallery');

  const [scale, setScale] = useState(item.cropData?.scale || 1);
  const [pos, setPos] = useState({ x: item.cropData?.x || 0, y: item.cropData?.y || 0 });
  const [isCropMode, setIsCropMode] = useState(!!item.cropData);
  const [isOutpaintMode, setIsOutpaintMode] = useState(item.cropData?.isOutpaint || false);
  const [cropRatio, setCropRatio] = useState<number>(item.cropData?.ratio || 1);
  
  const [refScales, setRefScales] = useState<number[]>([1, 1]);
  const [refPos, setRefPos] = useState<{x: number, y: number}[]>([{x: 0, y: 0}, {x: 0, y: 0}]);
  const [activeRefIndex, setActiveRefIndex] = useState<number | null>(null);
  
  const [refIsDragging, setRefIsDragging] = useState(false);
  const [refDragStart, setRefDragStart] = useState({ x: 0, y: 0 });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragInitialMouse, setDragInitialMouse] = useState({ x: 0, y: 0 });
  const [dragIntent, setDragIntent] = useState<'none' | 'vertical' | 'horizontal' | 'free'>('none');
  const [draggedAnnId, setDraggedAnnId] = useState<string | null>(null);
  const [annotationViewState, setAnnotationViewState] = useState<0 | 1 | 2>(2); // 0: hidden, 1: visible, 2: visible with capsules
  
  const [annotations, setAnnotations] = useState<any[]>(item.annotations || []);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
  }, [src]);

  const retainedViewStateRef = useRef<{scale: number, relX: number, relY: number} | null>(null);
  const currentStateRef = useRef({ scale, pos });
  
  useEffect(() => {
     currentStateRef.current = { scale, pos };
  }, [scale, pos]);

  const wrapNavPrev = React.useCallback((e?: any) => {
     if (imgRef.current) {
        retainedViewStateRef.current = { 
           scale: currentStateRef.current.scale,
           relX: currentStateRef.current.pos.x / imgRef.current.clientWidth,
           relY: currentStateRef.current.pos.y / imgRef.current.clientHeight
        };
     }
     onPrev(e);
  }, [onPrev]);

  const wrapNavNext = React.useCallback((e?: any) => {
     if (imgRef.current) {
        retainedViewStateRef.current = { 
           scale: currentStateRef.current.scale,
           relX: currentStateRef.current.pos.x / imgRef.current.clientWidth,
           relY: currentStateRef.current.pos.y / imgRef.current.clientHeight
        };
     }
     onNext(e);
  }, [onNext]);

  useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
         if (e.key === 'ArrowLeft') { e.preventDefault(); wrapNavPrev(e); }
         else if (e.key === 'ArrowRight') { e.preventDefault(); wrapNavNext(e); }
         else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
  }, [wrapNavPrev, wrapNavNext, onClose]);

  useEffect(() => {
    if (imageLoaded && retainedViewStateRef.current && !item.cropData) {
       if (imgRef.current) {
          setScale(retainedViewStateRef.current.scale);
          setPos({
             x: retainedViewStateRef.current.relX * imgRef.current.clientWidth,
             y: retainedViewStateRef.current.relY * imgRef.current.clientHeight
          });
       }
    }
  }, [imageLoaded, item.url, item.mappedUrl, item.cropData]);

  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.zoom-scroll-area')) {
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', handleGlobalWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleGlobalWheel);
  }, []);

  useEffect(() => {
    setAnnotations(item.annotations || []);
  }, [item.annotations]);

  useEffect(() => {
    setActiveAnnotationId(null);
    if (item.cropData) {
        setScale(item.cropData.scale || 1);
        setPos({ x: item.cropData.x || 0, y: item.cropData.y || 0 });
        setCropRatio(item.cropData.ratio || 1);
        setIsCropMode(true);
        setIsOutpaintMode(item.cropData.isOutpaint || false);
    } else {
        setIsCropMode(false);
        setIsOutpaintMode(false);
    }
  }, [item.url, item.mappedUrl, itemInstanceKey]);

  const applyOutpaintTopStrategy = (ratio: number) => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    const unscaledW = (img.getBoundingClientRect().width || 1) / scale;
    const unscaledH = (img.getBoundingClientRect().height || 1) / scale;
    const maskW = ratio <= 1 ? 845 * ratio : 845;
    const maskH = ratio > 1 ? 845 / ratio : 845;

    const minScale = Math.min(maskW / unscaledW, maskH / unscaledH);
    const scaledW = unscaledW * minScale;
    const scaledH = unscaledH * minScale;
    
    setScale(minScale);
    
    // Check which way we are expanding
    if (Math.abs(scaledW - maskW) < 1) {
       // Expanding vertically (height is smaller than mask)
       // Snap to TOP
       setPos({ x: 0, y: (scaledH - maskH) / 2 });
    } else {
       // Expanding horizontally (width is smaller than mask)
       // Snap to LEFT
       setPos({ x: (scaledW - maskW) / 2, y: 0 });
    }
  };

  const handleCropRatioChange = (ratio: number) => {
      setCropRatio(ratio);
      if (isOutpaintMode) {
          applyOutpaintTopStrategy(ratio);
      }
  };

  const handleOutpaintToggle = (checked: boolean) => {
      setIsOutpaintMode(checked);
      if (checked) {
          applyOutpaintTopStrategy(cropRatio);
      }
  };

  useEffect(() => {
    if (isCropMode && !isOutpaintMode && imgRef.current && imageLoaded) {
        const img = imgRef.current;
        const unscaledW = (img.getBoundingClientRect().width || 1) / scale;
        const unscaledH = (img.getBoundingClientRect().height || 1) / scale;
        const maskW = cropRatio <= 1 ? 845 * cropRatio : 845;
        const maskH = cropRatio > 1 ? 845 / cropRatio : 845;
        const minScale = Math.max(maskW / unscaledW, maskH / unscaledH);
        
        let newScale = scale;
        if (newScale < minScale) {
            newScale = minScale;
            setScale(newScale);
        }
        
        const scaledW = unscaledW * newScale;
        const scaledH = unscaledH * newScale;
        const maxPosX = Math.max(0, (scaledW - maskW) / 2);
        const maxPosY = Math.max(0, (scaledH - maskH) / 2);
        
        setPos(prev => ({
            x: Math.max(-maxPosX, Math.min(maxPosX, prev.x)),
            y: Math.max(-maxPosY, Math.min(maxPosY, prev.y))
        }));
    }
  }, [cropRatio, isOutpaintMode, isCropMode]);

  const saveAnnotations = (newAnnotations: any[]) => {
    setAnnotations(newAnnotations);
    if (onUpdateItem) {
       onUpdateItem({ ...item, annotations: newAnnotations });
    }
  };

  const updateRating = (rating: number) => {
    if (onUpdateItem) {
       onUpdateItem({ ...item, rating });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'SELECT') return;
      if (['0','1','2','3','4','5'].includes(e.key)) {
         updateRating(parseInt(e.key, 10));
      } else if (e.key === 'ArrowRight') {
         onNext(e as any);
      } else if (e.key === 'ArrowLeft') {
         onPrev(e as any);
      } else if (e.key === 'Escape') {
         onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, onNext, onPrev, onClose, onUpdateItem]);

  const handleImageClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    if (!username || !username.trim()) {
      alert("Please set your Username in Settings first to add annotations.");
      return;
    }
    
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    const newId = Math.random().toString(36).substr(2, 9);
    const newAnnotation = {
       id: newId,
       x, 
       y,
       status: 'pending',
       threads: []
    };
    
    saveAnnotations([...annotations, newAnnotation]);
    setActiveAnnotationId(newId);
  };

  const addThread = (annId: string, content: string, newStatus?: string) => {
    if (!username || !username.trim()) return;
    if (!content.trim() && !newStatus) return;
    
    const updated = annotations.map(a => {
       if (a.id === annId) {
          const threads = [...a.threads];
          if (content.trim()) {
            threads.push({
               id: Math.random().toString(36).substr(2, 9),
               user: username.trim(),
               timestamp: Date.now(),
               content: content.trim()
            });
          }
          return { ...a, threads, status: newStatus || a.status };
       }
       return a;
    });
    saveAnnotations(updated);
  };

  return createPortal(
    <div 
      className="fixed inset-0 flex bg-black/95 outline-none"
      style={{ zIndex: 2147483647 }}
      onClick={(e) => {
         if ((e.target as HTMLElement).closest('.annotation-popup')) return;
         if ((e.target as HTMLElement).closest('.annotation-marker')) return;
         if (e.target === e.currentTarget) onClose();
      }}
    >
      {isRefMode && refCells.length > 0 && (
         <div className="flex-1 max-w-[35%] border-r border-gray-700 flex flex-col relative bg-black/50 overflow-hidden">
            {refCells.map((rCellUrls, i) => {
                const rUrl = rCellUrls[activeRefImgIndices[i] || 0];
                return (
                 <div 
                     key={i} 
                     className={`flex-1 w-full flex items-center justify-center relative overflow-hidden cursor-move zoom-scroll-area ${i > 0 ? 'border-t border-gray-700' : ''}`}
                     onWheel={(e) => {
                         const s = refScales[i] || 1;
                         let newScale = s;
                         if (e.deltaY > 0) {
                            newScale = [...zoomLevels].reverse().find(l => l < s - 0.01) || zoomLevels[0];
                         } else if (e.deltaY < 0) {
                            newScale = zoomLevels.find(l => l > s + 0.01) || zoomLevels[zoomLevels.length - 1];
                         }
                         if (newScale !== s) {
                           const rect = e.currentTarget.getBoundingClientRect();
                           const mouseX = e.clientX - rect.left - rect.width / 2;
                           const mouseY = e.clientY - rect.top - rect.height / 2;
                           setRefPos(prevPos => {
                             const newPos = [...prevPos];
                             newPos[i] = {
                               x: mouseX - (mouseX - (prevPos[i]?.x || 0)) * (newScale / s),
                               y: mouseY - (mouseY - (prevPos[i]?.y || 0)) * (newScale / s)
                             };
                             return newPos;
                           });
                           setRefScales(prevScales => {
                              const newScales = [...prevScales];
                              newScales[i] = newScale;
                              return newScales;
                           });
                         }
                     }}
                     onMouseDown={(e) => {
                         setRefIsDragging(true);
                         setActiveRefIndex(i);
                         setRefDragStart({ x: e.clientX - refPos[i].x, y: e.clientY - refPos[i].y });
                         e.stopPropagation();
                     }}
                     onMouseMove={(e) => {
                         if (refIsDragging && activeRefIndex === i) {
                             const newPos = [...refPos];
                             newPos[i] = { ...refPos[i], x: e.clientX - refDragStart.x, y: e.clientY - refDragStart.y };
                             setRefPos(newPos);
                         }
                     }}
                     onMouseUp={() => setRefIsDragging(false)}
                     onMouseLeave={() => setRefIsDragging(false)}
                 >
                     <img 
                         src={rUrl} 
                         className="object-contain max-w-[90%] max-h-[90%] pointer-events-none" 
                         draggable={false}
                         style={{ transform: `translate(${refPos[i].x}px, ${refPos[i].y}px) scale(${refScales[i]})`, transition: refIsDragging && activeRefIndex === i ? 'none' : 'transform 0.1s' }}
                     />
                     {rCellUrls.length > 1 && (
                         <div className="absolute left-3 bottom-3 flex items-center gap-2 z-10 px-2 py-1 bg-black/50 text-white rounded opacity-80 hover:opacity-100 backdrop-blur-sm shadow-sm overflow-hidden text-xs" onMouseDown={e => e.stopPropagation()}>
                             <button
                                 className="shrink-0 p-1 hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-white"
                                 disabled={(activeRefImgIndices[i] || 0) === 0}
                                 onClick={(e) => {
                                     e.stopPropagation();
                                     setActiveRefImgIndices(prev => {
                                         const next = [...prev];
                                         next[i] = Math.max(0, (next[i] || 0) - 1);
                                         return next;
                                     });
                                     setRefPos(prev => { const next = [...prev]; next[i] = {x: 0, y: 0}; return next; });
                                     setRefScales(prev => { const next = [...prev]; next[i] = 1; return next; });
                                 }}
                             >
                                 <ChevronLeft className="w-4 h-4" />
                             </button>
                             <span className="font-mono tabular-nums tracking-wider px-1">
                                 {`${(activeRefImgIndices[i] || 0) + 1}/${rCellUrls.length}`}
                             </span>
                             <button
                                 className="shrink-0 p-1 hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-white"
                                 disabled={(activeRefImgIndices[i] || 0) === rCellUrls.length - 1}
                                 onClick={(e) => {
                                     e.stopPropagation();
                                     setActiveRefImgIndices(prev => {
                                         const next = [...prev];
                                         next[i] = Math.min(rCellUrls.length - 1, (next[i] || 0) + 1);
                                         return next;
                                     });
                                     setRefPos(prev => { const next = [...prev]; next[i] = {x: 0, y: 0}; return next; });
                                     setRefScales(prev => { const next = [...prev]; next[i] = 1; return next; });
                                 }}
                             >
                                 <ChevronRight className="w-4 h-4" />
                             </button>
                         </div>
                     )}
                 </div>
             )})}
          </div>
       )}
      
      <div 
        className="flex-1 relative flex items-center justify-center overflow-hidden zoom-scroll-area"
        onWheel={(e) => {
          const s = scale;
          let newScale = s;
          
          if (isOutpaintMode || isCropMode) {
             const step = 0.05;
             if (e.deltaY > 0) newScale = Math.max(0.1, s - step);
             else if (e.deltaY < 0) newScale = Math.min(10, s + step);
          } else {
             if (e.deltaY > 0) {
                newScale = [...zoomLevels].reverse().find(l => l < s - 0.01) || zoomLevels[0];
             } else if (e.deltaY < 0) {
                newScale = zoomLevels.find(l => l > s + 0.01) || zoomLevels[zoomLevels.length - 1];
             }
          }
          
          if (newScale !== s) {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX - rect.left - rect.width / 2;
            const mouseY = e.clientY - rect.top - rect.height / 2;
            
            if (isCropMode && !isOutpaintMode && imgRef.current && imageLoaded) {
                const imgRect = imgRef.current.getBoundingClientRect();
                const unscaledW = imgRect.width / s;
                const unscaledH = imgRect.height / s;
                const maskW = cropRatio <= 1 ? 845 * cropRatio : 845;
                const maskH = cropRatio > 1 ? 845 / cropRatio : 845;
                const minScale = Math.max(maskW / unscaledW, maskH / unscaledH);
                if (newScale < minScale) {
                   newScale = minScale;
                }
            }

            setPos(prev => {
              let newX = mouseX - (mouseX - prev.x) * (newScale / s);
              let newY = mouseY - (mouseY - prev.y) * (newScale / s);
              
              if (isCropMode && imgRef.current && imageLoaded) {
                  const imgRect = imgRef.current.getBoundingClientRect();
                  const unscaledW = imgRect.width / s;
                  const unscaledH = imgRect.height / s;
                  const scaledW = unscaledW * newScale;
                  const scaledH = unscaledH * newScale;
                  const maskW = cropRatio <= 1 ? 845 * cropRatio : 845;
                  const maskH = cropRatio > 1 ? 845 / cropRatio : 845;
                  
                  if (!isOutpaintMode) {
                      const maxPosX = Math.max(0, (scaledW - maskW) / 2);
                      const maxPosY = Math.max(0, (scaledH - maskH) / 2);
                      newX = Math.max(-maxPosX, Math.min(maxPosX, newX));
                      newY = Math.max(-maxPosY, Math.min(maxPosY, newY));
                  } else {
                      const limitX = Math.abs(scaledW - maskW) / 2;
                      const limitY = Math.abs(scaledH - maskH) / 2;
                      newX = Math.max(-limitX, Math.min(limitX, newX));
                      newY = Math.max(-limitY, Math.min(limitY, newY));
                  }
              }
              return { x: newX, y: newY };
            });
            setScale(newScale);
          }
        }}
        onClick={(e) => {
           if ((e.target as HTMLElement).closest('.annotation-popup')) return;
           if ((e.target as HTMLElement).closest('.annotation-marker')) return;
           if (e.target === e.currentTarget && !isCropMode) onClose();
        }}
      >
        {isCropMode && (
         <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-40 overflow-hidden">
            <div 
               className="border border-white border-dashed relative pointer-events-none" 
               style={{ 
                  width: cropRatio <= 1 ? 845 * cropRatio : 845, 
                  height: cropRatio > 1 ? 845 / cropRatio : 845, 
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' 
               }}
            >
               <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex justify-center gap-2 pointer-events-auto w-max text-sm">
                  <button onClick={(e) => { e.stopPropagation(); handleCropRatioChange(1); }} className={`px-3 py-1 rounded bg-black/50 text-white/80 ${cropRatio === 1 ? 'border border-blue-500' : ''}`}>1:1</button>
                  <button onClick={(e) => { e.stopPropagation(); handleCropRatioChange(2/3); }} className={`px-3 py-1 rounded bg-black/50 text-white/80 ${Math.abs(cropRatio - 2/3) < 0.01 ? 'border border-blue-500' : ''}`}>2:3</button>
                  <button onClick={(e) => { e.stopPropagation(); handleCropRatioChange(3/2); }} className={`px-3 py-1 rounded bg-black/50 text-white/80 ${Math.abs(cropRatio - 3/2) < 0.01 ? 'border border-blue-500' : ''}`}>3:2</button>
                  <button onClick={(e) => { e.stopPropagation(); handleCropRatioChange(3/4); }} className={`px-3 py-1 rounded bg-black/50 text-white/80 ${cropRatio === 0.75 ? 'border border-blue-500' : ''}`}>3:4</button>
                  <button onClick={(e) => { e.stopPropagation(); handleCropRatioChange(4/3); }} className={`px-3 py-1 rounded bg-black/50 text-white/80 ${Math.abs(cropRatio - 4/3) < 0.01 ? 'border border-blue-500' : ''}`}>4:3</button>
                  <button onClick={(e) => { e.stopPropagation(); handleCropRatioChange(9/16); }} className={`px-3 py-1 rounded bg-black/50 text-white/80 ${cropRatio === 9/16 ? 'border border-blue-500' : ''}`}>9:16</button>
                  <button onClick={(e) => { e.stopPropagation(); handleCropRatioChange(16/9); }} className={`px-3 py-1 rounded bg-black/50 text-white/80 ${Math.abs(cropRatio - 16/9) < 0.01 ? 'border border-blue-500' : ''}`}>16:9</button>
                  <label className="flex items-center gap-1.5 ml-1 px-3 py-1 rounded bg-black/50 text-white/80 cursor-pointer">
                      <input type="checkbox" checked={isOutpaintMode} onChange={(e) => handleOutpaintToggle(e.target.checked)} />
                      {lang === 'en' ? 'Outpaint' : '扩图'}
                  </label>
                  {item.cropData && (
                     <button onClick={(e) => { 
                        e.stopPropagation(); 
                        onUpdateItem?.({ ...item, cropData: null });
                        setIsCropMode(false);
                        setScale(1);
                        setPos({x: 0, y: 0});
                     }} className="ml-1 px-3 py-1 rounded bg-red-600/80 text-white hover:bg-red-500">{lang === 'en' ? 'Delete Crop' : '删除裁切'}</button>
                  )}
                  <button onClick={(e) => { 
                     e.stopPropagation(); 
                     const rect = imgRef.current?.getBoundingClientRect();
                     const naturalW = imgRef.current?.naturalWidth || 1;
                     const naturalH = imgRef.current?.naturalHeight || 1;
                     const unscaledW = (rect?.width || 1) / scale;
                     const unscaledH = (rect?.height || 1) / scale;
                     const maskW = cropRatio <= 1 ? 845 * cropRatio : 845;
                     const maskH = cropRatio > 1 ? 845 / cropRatio : 845;
                     onUpdateItem?.({ ...item, cropData: { 
                        scale, x: pos.x, y: pos.y, ratio: cropRatio, 
                        imgW: unscaledW, imgH: unscaledH, 
                        naturalW, naturalH, maskW, maskH, isOutpaint: isOutpaintMode
                     } });
                     setIsCropMode(false);
                  }} className="ml-2 px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500">{lang === 'en' ? 'Save Crop' : '保存取景'}</button>
               </div>
            </div>
         </div>
        )}
        <div className="absolute top-4 right-4 flex items-center gap-4 z-50">
         {annotations.length > 0 && (
           <div className="relative group/clear-ann">
             <button title="Clear Reviews" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
             </button>
             <div className="absolute top-full right-0 pt-2 opacity-0 group-hover/clear-ann:opacity-100 pointer-events-none group-hover/clear-ann:pointer-events-auto transition-opacity min-w-[200px]">
               <div className="bg-white rounded shadow-lg overflow-hidden flex flex-col py-1">
                 <button 
                   className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left"
                   onClick={(e) => { e.stopPropagation(); saveAnnotations(annotations.filter(a => a.status !== 'approved')); }}
                 >
                    {lang === 'en' ? 'Clear Approved' : '清除已通过'}
                 </button>
                 <button 
                   className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 text-left border-t border-gray-100"
                   onClick={(e) => { e.stopPropagation(); saveAnnotations([]); }}
                 >
                    {lang === 'en' ? 'Clear All Reviews' : '清除所有批注'}
                 </button>
               </div>
             </div>
           </div>
         )}
         <button onClick={(e) => { e.stopPropagation(); setAnnotationViewState(prev => (prev + 1) % 3 as any); }} title={lang === 'en' ? "Toggle Annotations View" : "切换批注视图"} className={`p-2 rounded-full transition-colors flex items-center justify-center relative ${annotationViewState > 0 ? 'bg-blue-600 text-white' : 'bg-black/50 text-white/70 hover:text-white'}`}>
            {annotationViewState === 2 ? <MessageSquareText className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
            {annotationViewState === 0 && <span className="absolute rotate-45 w-6 h-[2px] bg-red-400"></span>}
         </button>
         {refCells.length > 0 && (
            <button 
               onClick={(e) => { e.stopPropagation(); setIsRefMode(prev => !prev); }} 
               title={lang === 'en' ? "Toggle Reference Preview" : "切换参考图大屏模式"} 
               className={`p-2 rounded-full transition-colors flex items-center justify-center ${isRefMode ? 'bg-blue-600 text-white' : 'bg-black/50 text-white/70 hover:text-white'}`}
            >
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
            </button>
         )}
         <button onClick={(e) => { 
            e.stopPropagation(); 
            if (!imgRef.current) return;
            const img = imgRef.current;
            const currentRatio = img.naturalWidth / img.width;
            if (Math.abs(scale - 1) < 0.1) {
               setScale(currentRatio);
               setRefScales([currentRatio, currentRatio]);
            } else {
               setScale(1); 
               setPos({x: 0, y: 0}); 
               setRefScales([1, 1]); 
               setRefPos([{x: 0, y: 0}, {x: 0, y: 0}]);
            }
         }} title="Toggle Zoom (Fit / Actual Size)" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors flex items-center justify-center">
            {imgRef.current && Math.abs(scale - 1) < 0.1 ? (
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            ) : (
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
            )}
         </button>
         <button onClick={(e) => { e.stopPropagation(); setIsCropMode(prev => !prev); }} title={lang === 'en' ? "Crop Mode" : "局部修图模式"} className={`p-2 rounded-full transition-colors flex items-center justify-center relative ${isCropMode ? 'bg-blue-600 text-white' : 'bg-black/50 text-white/70 hover:text-white'}`}>
             <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"></path><path d="M18 22V8a2 2 0 0 0-2-2H2"></path></svg>
         </button>
         <button onClick={(e) => { e.stopPropagation(); copyImageToClipboardMagic(item.url || src); }} title="Copy Image" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors">
            <Copy className="w-5 h-5" />
         </button>
         <button onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors">
            <X className="w-6 h-6" />
         </button>
      </div>

      <button onClick={wrapNavPrev} className="absolute left-8 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 p-4">
         <ChevronLeft className="w-12 h-12" />
      </button>

      <div 
        className="relative flex items-center justify-center cursor-move"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: isDragging || draggedAnnId ? 'none' : 'transform 0.1s' }}
        onMouseDown={e => { 
           if ((e.target as HTMLElement).closest('.annotation-popup') || (e.target as HTMLElement).closest('.annotation-marker')) return;
           setIsDragging(true);
            setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
            setDragInitialMouse({ x: e.clientX, y: e.clientY });
            setDragIntent('none'); 
           e.stopPropagation(); 
        }}
        onMouseMove={e => { 
           if (draggedAnnId && imgRef.current) {
              const rect = imgRef.current.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
              setAnnotations(annotations.map(a => a.id === draggedAnnId ? { ...a, x, y } : a));
           } else if (isDragging) { 
              let newX = e.clientX - dragStart.x;
              let newY = e.clientY - dragStart.y;
              if (isCropMode && imgRef.current && imageLoaded) {
                 const rect = imgRef.current.getBoundingClientRect();
                 const unscaledW = rect.width / scale;
                 const unscaledH = rect.height / scale;
                 const scaledW = unscaledW * scale;
                 const scaledH = unscaledH * scale;
                 const maskW = cropRatio <= 1 ? 845 * cropRatio : 845;
                 const maskH = cropRatio > 1 ? 845 / cropRatio : 845;
                 
                 if (!isOutpaintMode) {
                     const maxPosX = Math.max(0, (scaledW - maskW) / 2);
                     const maxPosY = Math.max(0, (scaledH - maskH) / 2);
                     newX = Math.max(-maxPosX, Math.min(maxPosX, newX));
                     newY = Math.max(-maxPosY, Math.min(maxPosY, newY));
                 } else {
                     const deltaMouseX = e.clientX - dragInitialMouse.x;
                     const deltaMouseY = e.clientY - dragInitialMouse.y;
                     let currentIntent = dragIntent;
                     
                     if (currentIntent === 'none') {
                         if (Math.abs(deltaMouseX) > 10 || Math.abs(deltaMouseY) > 10) {
                             if (Math.abs(deltaMouseX) > Math.abs(deltaMouseY) * 1.5) {
                                 currentIntent = 'horizontal';
                             } else if (Math.abs(deltaMouseY) > Math.abs(deltaMouseX) * 1.5) {
                                 currentIntent = 'vertical';
                             } else {
                                 currentIntent = 'free';
                             }
                             setDragIntent(currentIntent as any);
                         }
                     }
                     
                     if (currentIntent === 'vertical') {
                         newX = pos.x; // freeze horizontal position
                     } else if (currentIntent === 'horizontal') {
                         newY = pos.y; // freeze vertical position
                     } else if (currentIntent === 'none') {
                         newX = pos.x; // freeze both until intent determined
                         newY = pos.y;
                     }
                     
                     // Keep bounded within the mask even while outpainting!
                     const limitX = Math.abs(scaledW - maskW) / 2;
                     const limitY = Math.abs(scaledH - maskH) / 2;
                     newX = Math.max(-limitX, Math.min(limitX, newX));
                     newY = Math.max(-limitY, Math.min(limitY, newY));
                 }
              }
              setPos({ x: newX, y: newY }); 
           } 
        }}
        onMouseUp={() => {
           if (draggedAnnId) {
             saveAnnotations(annotations);
             setDraggedAnnId(null);
           }
           setIsDragging(false);
        }}
        onMouseLeave={() => {
           if (draggedAnnId) {
             saveAnnotations(annotations);
             setDraggedAnnId(null);
           }
           setIsDragging(false);
        }}
      >
        {isAudio ? (
           <div className="w-[min(680px,90vw)] rounded-xl bg-gray-950 border border-white/10 shadow-2xl p-8 flex flex-col items-center gap-5 pointer-events-auto">
             <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg">
               <Music2 className="w-12 h-12 text-white" />
             </div>
             <div className="text-white text-sm max-w-full truncate px-4" title={item.name || item.url || src}>
               {item.name || String(item.url || src).split('/').pop()?.split('\\').pop() || '音频附件'}
             </div>
             <audio
               src={src}
               className="w-full"
               controls
               autoPlay
               preload="metadata"
               onLoadedData={() => setImageLoaded(true)}
             />
           </div>
        ) : isVideo ? (
           <video 
             ref={imgRef as any}
             src={src} 
             className="max-w-[90vw] max-h-[90vh] object-contain pointer-events-auto bg-black rounded" 
             controls
             autoPlay
             onLoadedData={() => setImageLoaded(true)}
             onDoubleClick={(e) => {
                e.stopPropagation();
                handleImageClick(e);
             }} 
           />
        ) : (
           <img 
             ref={imgRef}
             src={src} 
             className="max-w-[90vw] max-h-[90vh] object-contain pointer-events-auto" 
             draggable={false} 
             onLoad={() => setImageLoaded(true)}
             onDoubleClick={(e) => {
                e.stopPropagation();
                handleImageClick(e);
             }} 
           />
        )}
        
        {/* Render annotations */}
        {annotationViewState > 0 && annotations.map(ann => {
           let indicatorColor = 'bg-red-500';
           if (ann.status === 'resolved') indicatorColor = 'bg-yellow-500';
           else if (ann.status === 'approved') indicatorColor = 'bg-green-500';
           
           const firstUser = ann.threads[0]?.user || '?';
           const lastThread = ann.threads[ann.threads.length - 1];
           const snippet = lastThread ? (lastThread.content.length > 10 ? lastThread.content.substring(0, 10) + '...' : lastThread.content) : '';
           const lastUser = lastThread?.user || '?';
           const lastUserInitial = lastUser.charAt(0).toUpperCase();

           return (
             <div 
               key={ann.id} 
               className="absolute annotation-marker"
               style={{ left: `${ann.x}%`, top: `${ann.y}%`, transform: `translate(-50%, -50%) scale(${1/scale})`, zIndex: activeAnnotationId === ann.id ? 51 : 50 }}
               onClick={(e) => { e.stopPropagation(); setActiveAnnotationId(ann.id); }}
               onMouseDown={(e) => { e.stopPropagation(); setDraggedAnnId(ann.id); }}
               onContextMenu={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  saveAnnotations(annotations.filter(a => a.id !== ann.id));
               }}
             >
                <div className={`relative cursor-pointer group flex items-center gap-1.5 transition-all outline-none ${annotationViewState === 2 && snippet ? 'bg-black/60 shadow-lg border border-white/20 rounded-full pr-3 pl-1 py-1 backdrop-blur-md' : ''}`}>
                   <div 
                     className="w-8 h-8 rounded-full flex shrink-0 items-center justify-center text-white text-xs font-bold shadow-lg border-2 border-white transition-transform group-hover:scale-110"
                     style={{ backgroundColor: firstUser === '?' ? '#9CA3AF' : getStringColor(firstUser) }}
                   >
                     {firstUser.charAt(0).toUpperCase()}
                   </div>
                   {annotationViewState === 2 && snippet && (
                     <span className="text-xs text-white whitespace-nowrap font-medium pointer-events-none">{snippet}</span>
                   )}
                   <div className={`absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] rounded-full border border-white ${indicatorColor} flex items-center justify-center`}>
                     <span className="text-[9px] text-white font-bold leading-none select-none px-[2px]">{lastUserInitial}</span>
                   </div>
                </div>
                
                {activeAnnotationId === ann.id && (
                   <div 
                     className="annotation-popup absolute top-full left-1/2 -translate-x-1/2 mt-3 w-72 bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-50 flex flex-col gap-3 cursor-auto"
                     onClick={e => e.stopPropagation()}
                     onMouseDown={e => e.stopPropagation()}
                   >
                      <div className="flex justify-between items-center border-b pb-2">
                         <div className="flex gap-2">
                            <select 
                              className={`text-xs border border-gray-200 rounded px-1 py-0.5 outline-none font-medium ${ann.status === 'pending' ? 'text-red-500' : (ann.status === 'resolved' ? 'text-yellow-600' : 'text-green-600')}`}
                              value={ann.status}
                              onChange={e => addThread(ann.id, "", e.target.value)}
                            >
                               <option value="pending">🔴 {lang === 'en' ? 'Pending' : '待处理'}</option>
                               <option value="resolved">🟡 {lang === 'en' ? 'Resolved' : '已处理'}</option>
                               <option value="approved">🟢 {lang === 'en' ? 'Approved' : '审核通过'}</option>
                            </select>
                         </div>
                         <button onClick={() => setActiveAnnotationId(null)} className="text-gray-400 hover:text-gray-600">
                           <X className="w-4 h-4" />
                         </button>
                      </div>
                      
                      <div className="flex flex-col gap-3 max-h-48 overflow-y-auto pr-1">
                         {ann.threads.length === 0 && <div className="text-gray-400 text-xs italic text-center py-2">{lang === 'en' ? 'No comments yet' : '暂无评论'}</div>}
                         {ann.threads.map((t: any) => (
                            <div key={t.id} className="flex gap-2">
                               <div 
                                 className="w-6 h-6 rounded-full flex shrink-0 items-center justify-center text-white text-[10px] font-bold"
                                 style={{ backgroundColor: t.user === '?' ? '#9CA3AF' : getStringColor(t.user) }}
                               >
                                 {t.user.charAt(0).toUpperCase()}
                               </div>
                               <div className="flex flex-col">
                                  <div className="flex items-baseline gap-2">
                                     <span className="text-xs font-semibold text-gray-700">{t.user}</span>
                                     <span className="text-[10px] text-gray-400">{new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                  <p className="text-sm text-gray-800 break-words whitespace-pre-wrap leading-tight mt-0.5">{t.content}</p>
                               </div>
                            </div>
                         ))}
                      </div>
                      
                      <div className="flex gap-2 mt-1">
                         <input 
                           type="text" 
                           placeholder={lang === 'en' ? "Reply..." : "回复..."}
                           className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                           value={newComment}
                           onChange={e => setNewComment(e.target.value)}
                           onKeyDown={e => {
                              if (e.key === 'Enter' && newComment.trim()) {
                                 addThread(ann.id, newComment);
                                 setNewComment("");
                              }
                           }}
                         />
                         <button 
                           className="bg-blue-600 text-white rounded px-2.5 hover:bg-blue-700 flex items-center justify-center"
                           onClick={() => {
                              if (newComment.trim()) {
                                 addThread(ann.id, newComment);
                                 setNewComment("");
                              }
                           }}
                         >
                           <Send className="w-3.5 h-3.5" />
                         </button>
                      </div>
                   </div>
                )}
             </div>
           );
        })}
      </div>

      <button onClick={wrapNavNext} className="absolute right-8 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 p-4">
         <ChevronRight className="w-12 h-12" />
      </button>

      {/* Stars UI */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-50 bg-black/40 px-4 py-2 rounded-full backdrop-blur-md border border-white/10">
        {[1, 2, 3, 4, 5].map(v => (
          <button 
            key={v}
            onClick={(e) => { e.stopPropagation(); updateRating(v === item.rating ? 0 : v); }}
            className={`transition-colors p-1 group/star ${item.rating >= v ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Star className={`w-5 h-5 ${item.rating >= v ? 'fill-yellow-400' : 'group-hover/star:fill-gray-300'}`} />
          </button>
        ))}
        {item.rating > 0 && <span className="ml-2 text-white/70 font-mono text-lg font-medium">{item.rating}</span>}
      </div>
      
      </div>
    </div>,
    document.body
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

  const sourcePath = normalizeLocalPathForStorage(pathStr);
  const w = window as any;
  const isElectronPath = sourcePath.startsWith('/') || sourcePath.match(/^[a-zA-Z]:[\\/]/) || sourcePath.startsWith('\\\\');

  if (isElectronPath && w.electronAPI && w.electronAPI.getThumbnail) {
    try {
      const dataUrl = await w.electronAPI.getThumbnail(sourcePath, { width: 150, height: 150 });
      if (dataUrl) {
        thumbnailCache.set(pathStr, dataUrl);
        return dataUrl;
      }
    } catch (e) {}
  }

  const isVideo = sourcePath.toLowerCase().match(/\.(mp4|webm|mov|mkv)(\?|$)/) || file?.type.startsWith('video/');
  const isAudio = sourcePath.toLowerCase().match(/\.(mp3|wav|flac|m4a|aac|ogg|opus)(\?|$)/) || file?.type.startsWith('audio/');
  if (isAudio) return '';

  if (!isVideo) {
      let resultUrl = sourcePath;
      if (file) {
          resultUrl = URL.createObjectURL(file);
      } else if (fullImageBlobCache.has(pathStr)) {
          resultUrl = fullImageBlobCache.get(pathStr)!;
      } else if (isElectronPath) {
          resultUrl = `file://${sourcePath.replace(/\\/g, '/')}`;
      }
      thumbnailCache.set(pathStr, resultUrl);
      return resultUrl;
  }

  return new Promise((resolve) => {
    thumbnailQueue.push(async () => {
      if (thumbnailCache.has(pathStr)) {
         resolve(thumbnailCache.get(pathStr)!);
         return;
      }
      
      const media = document.createElement('video');
      media.crossOrigin = 'anonymous';
      media.preload = 'metadata';
      media.muted = true;
      
      let urlToLoad = '';
      let objectUrl = '';

      if (file) {
        objectUrl = URL.createObjectURL(file);
        urlToLoad = objectUrl;
      } else if (fullImageBlobCache.has(pathStr)) {
        urlToLoad = fullImageBlobCache.get(pathStr)!;
      } else if (isElectronPath) {
        urlToLoad = `file://${sourcePath.replace(/\\/g, '/')}`;
      } else {
        urlToLoad = sourcePath;
      }

      await new Promise<void>((mediaResolve) => {
        const handleLoad = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          media.currentTime = 1; // Seek to 1s
        };

        const processAndExtract = () => {
          const MAX_DIM = 256;
          let w = media.videoWidth;
          let h = media.videoHeight;
          
          if (!w || !h) {
            resolve(urlToLoad);
            mediaResolve();
            return;
          }

          const canvas = document.createElement('canvas');
          let vw = w, vh = h;
          if (vw > vh) {
            vh *= MAX_DIM / vw;
            vw = MAX_DIM;
          } else {
            vw *= MAX_DIM / vh;
            vh = MAX_DIM;
          }
          canvas.width = vw;
          canvas.height = vh;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(media, 0, 0, vw, vh);
            
            // draw play button overlay
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath();
            ctx.arc(vw/2, vh/2, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(vw/2 - 6, vh/2 - 8);
            ctx.lineTo(vw/2 + 10, vh/2);
            ctx.lineTo(vw/2 - 6, vh/2 + 8);
            ctx.fill();
            
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
          mediaResolve();
        };

        media.onloadeddata = handleLoad;
        media.onseeked = processAndExtract;

        media.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          resolve(urlToLoad);
          mediaResolve();
        };

        media.src = urlToLoad;
      });
    });
    processThumbnailQueue();
  });
}

const thumbnailObservers = new Map<Element, () => void>();
let globalThumbnailObserver: IntersectionObserver | null = null;
function getGlobalThumbnailObserver() {
  if (!globalThumbnailObserver) {
    globalThumbnailObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
           const callback = thumbnailObservers.get(entry.target);
           if (callback) callback();
        }
      });
    }, { rootMargin: '200px', threshold: 0.01 });
  }
  return globalThumbnailObserver;
}

const ThumbnailImage = ({ path, alt, className, title, onClick }: { path: string, alt: string, className: string, title?: string, onClick?: (e: React.MouseEvent) => void }) => {
  const [src, setSrc] = useState<string>(thumbnailCache.get(path) || '');
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let isMounted = true;
    
    // Check cache for this specific path first
    const cached = thumbnailCache.get(path);
    if (cached) {
        setSrc(cached);
        return;
    } else {
        setSrc(''); // Reset when path changes and it's not cached yet, instead of keeping old image
    }

    const lowerPath = path.toLowerCase();
    const isAudio = /\.(mp3|wav|flac|m4a|aac|ogg|opus)(\?|$)/.test(lowerPath) || lowerPath.startsWith('data:audio');
    const isVideo = /\.(mp4|webm|mov|mkv)(\?|$)/.test(lowerPath);
    if (isAudio) {
       getOrGenerateThumbnail(path).then(fetched => {
         if (isMounted) setSrc(fetched);
       });
       return;
    }
    
    if (!isVideo) {
       // Images resolve very quickly without blocking now, we rely on native loading="lazy" and decoding="async"
       getOrGenerateThumbnail(path).then(fetched => {
         if (isMounted) setSrc(fetched);
       });
       return;
    }

    const observer = getGlobalThumbnailObserver();
    
    if (imgRef.current) {
        thumbnailObservers.set(imgRef.current, () => {
           getOrGenerateThumbnail(path).then(fetched => {
             if (isMounted) setSrc(fetched);
           });
           if (imgRef.current) {
              thumbnailObservers.delete(imgRef.current);
              observer.unobserve(imgRef.current);
           }
        });
        observer.observe(imgRef.current);
    }
    
    return () => { 
      isMounted = false; 
      if (imgRef.current) {
         thumbnailObservers.delete(imgRef.current);
         observer.unobserve(imgRef.current);
      }
    };
  }, [path]);

  const isAudio = /\.(mp3|wav|flac|m4a|aac|ogg|opus)(\?|$)/.test(path.toLowerCase()) || path.toLowerCase().startsWith('data:audio');
  if (isAudio) {
    return (
      <span
        className={cn('relative block shrink-0 overflow-hidden', className)}
        title={title || alt}
        onClick={onClick}
      >
        {src ? (
          <img src={src} alt={alt} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <span className="absolute inset-0 bg-gradient-to-br from-slate-800 to-indigo-900" />
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 rounded">
          <Music2 className="w-1/2 h-1/2 text-white/75 drop-shadow-md" />
        </span>
      </span>
    );
  }

  return <img ref={imgRef} src={src || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='} alt={alt} className={className} title={title} onClick={onClick} loading="lazy" decoding="async" />;
};

type LocateCellRequest = {
  requestId: number;
  tableId: string;
  recordId: string;
  fieldId: string;
};

type LocateCellResult = {
  status: 'success' | 'hidden' | 'not-found';
};

interface GridProps {
  tableId: string;
  locateCellRequest?: LocateCellRequest | null;
  onLocateCellResult?: (result: LocateCellResult) => void;
  viewMode?: 'grid' | 'gallery';
  data: GridData;
  allRecords?: any[];
  searchQuery?: string;
  searchMatches?: { recordId: string, fieldId: string }[];
  activeSearchMatch?: { recordId: string, fieldId: string, recordIndex: number, fieldIndex: number } | null;
  onUpdateGlobalAttachment?: (url: string, updatedProps: any) => void;
  onUpdateRecord: (recordId: string, fieldId: string, value: any) => void;
  onUpdateRecordsBatch?: (updates: { recordId: string, fieldId: string, value: any }[]) => void;
  onPasteRecordsBatch?: (updates: { recordId: string, fieldId: string, value: any }[], newRecords: any[]) => void;
  onDeleteRecords?: (recordIds: string[]) => void;
  onAddRecord: () => void;
  onInsertRecords?: (index: number, count: number) => void;
  onAddField: () => void;
  onInsertField?: (index: number, count?: number) => void;
  onDuplicateField?: (fieldId: string) => void;
  onFreezeColumn?: (fieldId: string | null) => void;
  onIndividualFreezeColumn?: (fieldId: string) => void;
  onDeleteField?: (fieldId: string) => void;
  onRenameField: (fieldId: string, name: string) => void;
  onChangeFieldType: (fieldId: string, type: FieldType) => void;
  onReorderFields: (sourceId: string | string[], targetId: string) => void;
  onReorderRecords: (sourceId: string, targetId: string) => void;
  onResizeCol: (fieldId: string, width: number) => void;
  onUpdateField: (fieldId: string, updates: Partial<Field>) => void;
  onSortField?: (fieldId: string, direction: 'asc'|'desc'|null) => void;
  onFilterField?: (fieldId: string, operator: string, value: any) => void;
  sortConfig?: { fieldId: string, direction: 'asc'|'desc' } | null;
  filterConfig?: any[]; // Array of FilterRules
  groupConfig?: { fieldId: string, direction: 'asc'|'desc' }[];
  rowHeight: 'short'|'medium'|'tall'|'extra';
  modelSettings: any;
  lang?: 'en' | 'zh';
  globalAttachmentPropsMap?: Map<string, AttachmentReviewProps>;
  username?: string;
  gallerySettings?: any;
  onGallerySettingsChange?: (settings: any) => void;
  foldedGroups?: string[];
  onFoldedGroupsChange?: (groups: string[]) => void;
  onUpdateCellLinks?: (links: Record<string, string>) => void;
}

export const resolveFieldValueForAI = (val: any, refField: Field, record: any, allFields: Field[]) => {
  if (refField.type === 'formula') {
    let displayValue: any = '';
    if (refField.prompt) {
      let formulaStr = refField.prompt;
      const variableNames: string[] = [];
      const variableValues: any[] = [];
      
      if (refField.refFields) {
        refField.refFields.forEach(refId => {
          const varRefField = allFields.find(f => f.id === refId);
          if (varRefField) {
            let valToUse = resolveFieldValueForAI(record[refId], varRefField, record, allFields);
            if (varRefField.type === 'singleSelect' || varRefField.type === 'multiSelect') {
              if (valToUse) {
                const valArray = Array.isArray(valToUse) ? valToUse : (typeof valToUse === 'string' ? valToUse.split(',').map(s=>s.trim()) : [valToUse]);
                const mapped = valArray.map(v => varRefField.options?.find((o:any) => o.id === v)?.name || v);
                valToUse = mapped.length === 1 && !Array.isArray(record[refId]) && varRefField.type === 'singleSelect' ? mapped[0] : mapped.join(', ');
              }
            }
            const varName = 'VAR_' + refId.replace(/[^a-zA-Z0-9]/g, '_');
            const safeFieldName = varRefField.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        // fallback legacy evaluate
      }
    }
    return displayValue;
  }

  if (!val) return val;
  if (refField.type === 'singleSelect' || refField.type === 'multiSelect') {
    const valArray = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s=>s.trim()) : [val]);
    const mapped = valArray.map(v => refField.options?.find(o => o.id === v)?.name || v);
    return mapped.length === 1 && !Array.isArray(val) && refField.type === 'singleSelect' ? mapped[0] : mapped.join(', ');
  }
  return val;
};

export const resolveTemplateString = (templateStr: string, fields: Field[], record: any) => {
  if (!templateStr) return '';
  let str = templateStr;
  fields.forEach(f => {
      let val = record[f.id];
      val = resolveFieldValueForAI(val, f, record, fields);
      if (Array.isArray(val)) val = val.map(v => v?.name || String(v?.url || v)).join(', ');
      else val = typeof val === 'object' ? JSON.stringify(val) : String(val || '');
      
      const marker = `{${f.name}}`;
      if (str.includes(marker)) {
          str = str.split(marker).join(val);
      }
  });
  return str;
};

const resolveFilenameAndFolder = (filenameTemplate: string, folderPathTpl: string, fields: Field[], record: any) => {
   let filename = resolveTemplateString(filenameTemplate || 'image', fields, record).trim();
   let folderPath = resolveTemplateString(folderPathTpl || '', fields, record).trim();
   let zipPath = '';

   const normalizedTemplate = filename.replace(/\\/g, '/');
   if (normalizedTemplate.includes('/')) {
     const parts = normalizedTemplate.split('/');
     filename = parts.pop() || 'image';
     const subDir = parts.join('/');
     folderPath = folderPath ? `${folderPath}/${subDir}` : subDir;
     zipPath = subDir;
   }
   return { filename, folderPath, zipPath };
};

type ExportMediaType = 'all' | 'image' | 'video' | 'audio';
type DetectedMediaType = Exclude<ExportMediaType, 'all'>;

const MEDIA_EXTENSIONS: Record<DetectedMediaType, Set<string>> = {
  image: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif', 'tif', 'tiff']),
  video: new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg']),
  audio: new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'])
};

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus'
};

const getPathExtension = (value: unknown): string => {
  const clean = String(value || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() || '';
};

const detectExportMediaType = (item: any, url: string): DetectedMediaType => {
  const mime = String(item?.type || item?.mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';

  const lowerUrl = String(url || '').toLowerCase();
  if (lowerUrl.startsWith('data:video') || lowerUrl.startsWith('local-video:')) return 'video';
  if (lowerUrl.startsWith('data:audio') || lowerUrl.startsWith('local-audio:')) return 'audio';
  if (lowerUrl.startsWith('data:image') || lowerUrl.startsWith('local-img:')) return 'image';

  const extension = getPathExtension(item?.name) || getPathExtension(url);
  if (MEDIA_EXTENSIONS.video.has(extension)) return 'video';
  if (MEDIA_EXTENSIONS.audio.has(extension)) return 'audio';
  if (MEDIA_EXTENSIONS.image.has(extension)) return 'image';

  // Preserve compatibility with legacy image attachments whose signed URL has
  // neither a file extension nor MIME metadata.
  return 'image';
};

const getExportExtension = (item: any, url: string, mediaType: DetectedMediaType): string => {
  const existingExtension = getPathExtension(item?.name) || getPathExtension(url);
  if (existingExtension) return existingExtension;

  const dataUrlMime = String(url || '').match(/^data:([^;,]+)/i)?.[1] || '';
  const mime = String(item?.type || item?.mimeType || dataUrlMime).toLowerCase().split(';', 1)[0];
  return MIME_EXTENSIONS[mime] || (mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'png');
};

const ensureExportFilename = (baseFilename: string, extension: string): string => {
  return getPathExtension(baseFilename) ? baseFilename : `${baseFilename}.${extension}`;
};

const BatchDownloadPopup = ({ 
  selectedCells, 
  data, 
  visibleFields, 
  lang, 
  onClose,
  triggerDownload,
  globalAttachmentPropsMap
}: { 
  selectedCells: Set<string>; 
  data: GridData; 
  visibleFields: Field[]; 
  lang: string; 
  onClose: () => void;
  triggerDownload: (url: string, filename: string, folderPath?: string) => Promise<string | undefined>;
  globalAttachmentPropsMap: Map<string, AttachmentReviewProps>;
}) => {
  // ratings index 0 is unrated, 1-5 is stars
  const [selectedRatings, setSelectedRatings] = useState<Record<number, boolean>>({ 0: false, 1: false, 2: false, 3: false, 4: false, 5: false });
  const [selectedMediaType, setSelectedMediaType] = useState<ExportMediaType>('all');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const getFilteredFiles = () => {
     const selectedArr = Array.from(selectedCells).map(s => { const [r, c] = s.split(','); return { r: parseInt(r), c: parseInt(c) }; });
     const targetFiles: { url: string, filename: string, folderPath: string, zipPath?: string, mediaType: DetectedMediaType }[] = [];
     const hasAnyFilter = Object.values(selectedRatings).some(v => v);

     selectedArr.forEach(({r, c}) => {
        const record = data.records[r];
        const field = visibleFields[c];
        if (!record || !field || (field.type !== 'attachment' && field.type !== 'aiImage' && field.type !== 'aiVideo')) return;

        const val = record[field.id];
        if (!val) return;

        let items: any[] = [];
        if (Array.isArray(val)) items = val;
        else if (typeof val === 'string' && val.trim()) items = val.split(',').map(u => ({ url: u.trim() }));
        else if (typeof val === 'object' && !Array.isArray(val)) items = [val];

        const cfg = field.type === 'aiVideo' ? (field.aiVideoConfig || {}) : (field.aiImageConfig || {});
        const hasConfig = Object.keys(cfg).length > 0 || cfg.filenameTemplate || cfg.folderPath;
        const { filename: baseFilename, folderPath, zipPath } = resolveFilenameAndFolder(cfg.filenameTemplate || 'media', cfg.folderPath || '', data.fields, record);

        let activeIndex = 0;
        items.forEach((item) => {
           const url = typeof item === 'string' ? item : item?.url;
           if (!url) return;
           const mediaType = detectExportMediaType(item, url);
           if (selectedMediaType !== 'all' && mediaType !== selectedMediaType) return;

           const globalReview = globalAttachmentPropsMap.get(
             normalizeAttachmentKey(url)
           );

           const rtg = Number(
             (typeof item === 'object' ? item?.rating : undefined) ??
             globalReview?.rating ??
             0
           );

           let itemName = '';
           if (item && typeof item === 'object') {
             itemName = item.name || '';
           }

           if (!hasAnyFilter || selectedRatings[rtg]) {
               const url = typeof item === 'string' ? item : item.url;
               if (url) {
                  const extension = getExportExtension(item, url, mediaType);
                  const generatedFilename = ensureExportFilename(baseFilename + (items.length > 1 ? `_${activeIndex + 1}` : ''), extension);
                  const currentFilename = (!hasConfig && itemName) ? itemName : generatedFilename;
                  targetFiles.push({ url, filename: currentFilename, folderPath, zipPath, mediaType });
               }
           }
           activeIndex++;
        });
     });
     return targetFiles;
  };

  const files = useMemo(() => getFilteredFiles(), [selectedCells, data, visibleFields, selectedRatings, selectedMediaType, globalAttachmentPropsMap]);

  const toggleRating = (r: number) => setSelectedRatings(prev => ({ ...prev, [r]: !prev[r] }));

  const handleZipDownload = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setProgress({ current: 0, total: files.length });
    
    const zip = new JSZip();
    const w = window as any;
    const isElectron = !!(w.electronAPI || w.electron);
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            let blob: Blob;
            if (file.url.startsWith('data:')) {
                const res = await fetch(file.url);
                blob = await res.blob();
            } else if (isElectron && w.electronAPI?.readLocalFile) {
                // Try reading local file via IPC for Electron
                const base64Data = await w.electronAPI.readLocalFile(file.url);
                if (base64Data) {
                    const res = await fetch(`data:application/octet-stream;base64,${base64Data}`);
                    blob = await res.blob();
                } else {
                    const res = await fetch(file.url);
                    blob = await res.blob();
                }
            } else {
                const res = await fetch(file.url);
                blob = await res.blob();
            }
            const path = file.zipPath ? `${file.zipPath}/${file.filename}` : file.filename;
            zip.file(path, blob);
        } catch (e) {
            console.error("Failed to fetch attachment for zip", file.url, e);
        }
        setProgress({ current: i + 1, total: files.length });
    }

    try {
        const content = await zip.generateAsync({ type: 'blob' });
        const exportLabel = selectedMediaType === 'all' ? 'attachments' : `${selectedMediaType}s`;
        saveAs(content, `${exportLabel}_${new Date().getTime()}.zip`);
    } catch (e) {
        console.error("Failed to generate zip", e);
    }
    
    setIsProcessing(false);
    onClose();
  };

  const handleLocalSave = async () => {
    if (files.length === 0) return;
    
    const w = window as any;
    let baseDir = '';
    if (w.electronAPI?.selectDirectory) {
        baseDir = await w.electronAPI.selectDirectory();
        if (!baseDir) return; // User canceled
    }

    setIsProcessing(true);
    setProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const finalFolder = baseDir ? (file.zipPath ? `${baseDir}/${file.zipPath}` : baseDir) : (file.zipPath || '');
        await triggerDownload(file.url, file.filename, finalFolder);
        setProgress({ current: i + 1, total: files.length });
    }
    
    setIsProcessing(false);
    onClose();
  };

  const isElectron = !!((window as any).electronAPI || (window as any).electron);

  return createPortal(
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 relative">
        <h2 className="text-xl font-semibold mb-4">{lang === 'en' ? 'Batch Export Attachments' : '批量导出附件'}</h2>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>

        <div className="mb-5">
          <label className="text-sm font-medium text-gray-700 block mb-2">{lang === 'en' ? 'Attachment Type' : '附件类型'}</label>
          <div className="grid grid-cols-4 gap-2">
            {([
              ['all', lang === 'en' ? 'All' : '全部'],
              ['image', lang === 'en' ? 'Images' : '图片'],
              ['video', lang === 'en' ? 'Videos' : '视频'],
              ['audio', lang === 'en' ? 'Audio' : '音频']
            ] as [ExportMediaType, string][]).map(([type, label]) => (
              <button
                key={type}
                onClick={() => setSelectedMediaType(type)}
                className={`rounded-md border px-2 py-2 text-sm transition-colors ${selectedMediaType === type ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="mb-6">
          <label className="text-sm font-medium text-gray-700 block mb-2">{lang === 'en' ? 'Filter by Star Rating' : '按标星筛选附件'}</label>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map(r => (
              <button
                key={r}
                onClick={() => toggleRating(r)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium flex items-center transition-colors ${selectedRatings[r] ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
              >
                {r === 0 ? (lang === 'en' ? 'Unrated' : '无标星') : (
                  <>
                    <Star className={`w-3.5 h-3.5 mr-1 ${selectedRatings[r] ? 'fill-blue-700 text-blue-700' : 'fill-transparent'}`} /> {r}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="text-sm text-gray-600 mb-6">
           {lang === 'en' ? 'Attachments to export:' : '待导出附件数量：'} <strong className="text-gray-900">{files.length}</strong>
        </div>

        {isProcessing && (
           <div className="mb-4">
              <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                 <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
              </div>
              <div className="text-xs text-gray-500 text-right">{progress.current} / {progress.total}</div>
           </div>
        )}

        <div className="flex justify-end gap-3">
          <button 
             disabled={files.length === 0 || isProcessing}
            onClick={handleZipDownload}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
             {lang === 'en' ? 'Download ZIP' : '打包下载 (ZIP)'}
          </button>
          {isElectron && (
             <button 
               disabled={files.length === 0 || isProcessing}
               onClick={handleLocalSave}
               className="px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
             >
                {lang === 'en' ? 'Batch Save Locally' : '批量另存至本地'}
             </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

const getBase64ImageParts = async (templateStr: string, fields: Field[], record: any, aiOptions: any = null) => {
  const parts: any[] = [];
  const dataUrlsOut: string[] = [];
  const originalUrlsOut: string[] = [];
  const sourceUrlsOut: string[] = [];
  if (!templateStr) return { cleanString: '', parts, dataUrls: dataUrlsOut, originalUrls: originalUrlsOut, sourceUrls: sourceUrlsOut };
  let str = templateStr;
  
  // Sort fields by their first occurrence in the template string to ensure parts are ordered correctly
  const orderedFields = [...fields].filter(f => str.includes(`{${f.name}}`)).sort((a, b) => {
    return str.indexOf(`{${a.name}}`) - str.indexOf(`{${b.name}}`);
  });

  for (let f of orderedFields) {
    const marker = `{${f.name}}`;
    if (str.includes(marker)) {
      let val = record[f.id];
      if (f.type === 'attachment' || f.type === 'aiImage') {
        const urls: string[] = [];
        const items: any[] = [];
        if (Array.isArray(val)) {
          val.forEach((v: any) => { urls.push(String(v?.url || v)); items.push(v); });
        } else if (typeof val === 'string') {
          val.split(',').forEach(v => { urls.push(v.trim()); items.push(null); });
        } else if (val) {
          urls.push(String(val?.url || val)); items.push(val);
        }
        
        const dataUrls: string[] = [];
        for (let i = 0; i < urls.length; i++) {
          const u = urls[i];
          const item = items[i];
          if (!u.trim()) continue;
          
          let fetchUrl = u;
          if (fullImageBlobCache.has(u)) {
             fetchUrl = fullImageBlobCache.get(u)!;
          } else if (!u.startsWith('data:') && !u.startsWith('http') && !u.startsWith('blob:') && !u.startsWith('file:')) {
             fetchUrl = `file://${u.replace(/\\/g, '/')}`;
          }

          if (fetchUrl.startsWith('data:')) {
            let mime = fetchUrl.match(/data:(.*?);/)?.[1] || 'image/jpeg';
            let b64 = fetchUrl.split(',')[1];
            
            if (mime.startsWith('image/') && !mime.includes('svg') && mime !== 'image/jpeg') {
                try {
                    b64 = await new Promise<string>((resolve) => {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            if (ctx) {
                                ctx.drawImage(img, 0, 0);
                                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                mime = 'image/jpeg';
                                resolve(dataUrl.split(',')[1] || b64);
                            } else {
                                resolve(b64);
                            }
                        };
                        img.onerror = () => resolve(b64);
                        img.src = fetchUrl;
                    });
                } catch(e) {
                    console.error("Failed to convert data: URL to jpeg:", e);
                }
            }

            parts.push({ inlineData: { mimeType: mime, data: b64 } });
            const finalDataUrl = `data:${mime};base64,${b64}`;
            dataUrls.push(finalDataUrl);
            dataUrlsOut.push(finalDataUrl);
            originalUrlsOut.push(fetchUrl);
            sourceUrlsOut.push(fetchUrl);
          } else {
            let b64: string | null = null;
            let mime = 'image/jpeg';
            
            if (fetchUrl.startsWith('file://')) {
               const w = window as any;
               mime = u.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
               
               if (!b64 && w.electronAPI && w.electronAPI.readLocalFile) {
                  try {
                     const res = await w.electronAPI.readLocalFile(u, { optimizeImage: true, returnMime: true });
                     if (res) {
                         if (typeof res === 'string') {
                             b64 = res;
                         } else {
                             b64 = res.data;
                             if (res.mime) mime = res.mime;
                         }
                     }
                  } catch (e) {
                     console.error("Local file read via electronAPI failed:", e);
                  }
               }

               if (!b64 && w.require && typeof w.require === 'function') {
                  try {
                     const fs = w.require('fs');
                     const buffer = fs.readFileSync(u);
                     b64 = buffer.toString('base64');
                  } catch (e) {
                     console.error("Local fs read failed:", e);
                  }
               }
            }

            if (!b64) {
               try {
                 const res = await fetch(fetchUrl);
                 const blob = await res.blob();
                 mime = blob.type || mime;
                 if (mime.startsWith('image/') && !mime.includes('svg')) {
                     b64 = await new Promise<string>((resolve) => {
                         const img = new Image();
                         img.onload = () => {
                             const canvas = document.createElement('canvas');
                             canvas.width = img.width;
                             canvas.height = img.height;
                             const ctx = canvas.getContext('2d');
                             if (ctx) {
                                 ctx.drawImage(img, 0, 0);
                                 const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                 mime = 'image/jpeg';
                                 resolve(dataUrl.split(',')[1] || '');
                             } else {
                                 const reader = new FileReader();
                                 reader.onloadend = () => resolve((reader.result as string).split(',')[1] || '');
                                 reader.readAsDataURL(blob);
                             }
                         };
                         img.onerror = () => {
                             const reader = new FileReader();
                             reader.onloadend = () => resolve((reader.result as string).split(',')[1] || '');
                             reader.readAsDataURL(blob);
                         };
                         img.src = URL.createObjectURL(blob);
                     });
                 } else {
                     b64 = await new Promise<string>((resolve) => {
                       const reader = new FileReader();
                       reader.onloadend = () => {
                         const result = reader.result as string;
                         resolve(result.split(',')[1] || '');
                       };
                       reader.readAsDataURL(blob);
                     });
                 }
               } catch(e) {
                 console.error("Could not load image reference:", u, "via fetchUrl:", fetchUrl, e);
               }
            }
            
            let wasCropped = false;
            if (b64 && item?.cropData) {
               try {
                  const crop = item.cropData;
                  const cropped = await new Promise<{b64:string, mime:string}>((resolve) => {
                     const img = new Image();
                     img.onload = () => {
                        if (!crop.imgW || !crop.imgH || !crop.naturalW || !crop.naturalH || !crop.scale || !crop.maskW || !crop.maskH) {
                           resolve({b64: b64 as string, mime});
                           return;
                        }
                        
                        const cropX = crop.imgW * crop.scale / 2 - crop.x - crop.maskW / 2;
                        const cropY = crop.imgH * crop.scale / 2 - crop.y - crop.maskH / 2;
                        
                        const naturalCropX = (cropX / crop.scale) * (crop.naturalW / crop.imgW);
                        const naturalCropY = (cropY / crop.scale) * (crop.naturalH / crop.imgH);
                        const naturalCropW = (crop.maskW / crop.scale) * (crop.naturalW / crop.imgW);
                        const naturalCropH = (crop.maskH / crop.scale) * (crop.naturalH / crop.imgH);

                        const targetW = naturalCropW;
                        const targetH = naturalCropH;
                        
                        const cvs = document.createElement('canvas');
                        cvs.width = targetW;
                        cvs.height = targetH;
                        const ctx = cvs.getContext('2d');
                        if (ctx) {
                           ctx.fillStyle = '#000';
                           ctx.fillRect(0, 0, targetW, targetH);
                           ctx.drawImage(img, naturalCropX, naturalCropY, naturalCropW, naturalCropH, 0, 0, targetW, targetH);
                           const dUrl = cvs.toDataURL('image/jpeg', 0.95);
                           resolve({ b64: dUrl.split(',')[1], mime: 'image/jpeg' });
                        } else {
                           resolve({ b64: b64 as string, mime });
                        }
                     };
                     img.onerror = () => resolve({b64: b64 as string, mime});
                     img.src = `data:${mime};base64,${b64}`;
                  });
                  if (cropped.b64 !== b64) {
                      wasCropped = true;
                  }
                  b64 = cropped.b64;
                  mime = cropped.mime;
               } catch (e) {
                  console.error("Image crop failed:", e);
               }
            }

            if (b64) {
               parts.push({ inlineData: { mimeType: mime, data: b64 } });
               const finalDataUrl = `data:${mime};base64,${b64}`;
               dataUrls.push(finalDataUrl);
               dataUrlsOut.push(finalDataUrl);
               originalUrlsOut.push(fetchUrl.startsWith('blob:') || wasCropped ? finalDataUrl : fetchUrl);
               sourceUrlsOut.push(fetchUrl);
            } else {
               dataUrls.push(u); 
               dataUrlsOut.push(u);
               originalUrlsOut.push(fetchUrl.startsWith('blob:') ? u : fetchUrl);
               sourceUrlsOut.push(fetchUrl);
            }
          }
        }
        str = str.split(marker).join(dataUrls.join(' '));
      } else {
         val = resolveFieldValueForAI(val, f, record, fields);
         if (Array.isArray(val)) val = val.map(v => v?.name || String(v?.url || v)).join(', ');
         else val = typeof val === 'object' ? JSON.stringify(val) : String(val || '');
         str = str.split(marker).join(val);
      }
    }
  }

  return { cleanString: str, parts, dataUrls: dataUrlsOut, originalUrls: originalUrlsOut, sourceUrls: sourceUrlsOut };
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

const gallerySettingsCache = new Map<string, any>();

function ImageReviewView({ tableId = 'default', data, lang, onPreviewImage, gallerySettings, onGallerySettingsChange, groupConfig, foldedGroups, onFoldedGroupsChange }: { tableId?: string, data: any, lang: string, onPreviewImage: (url: string, items: any[]) => void, gallerySettings?: any, onGallerySettingsChange?: (s: any) => void, groupConfig?: any[], foldedGroups?: string[], onFoldedGroupsChange?: (g: string[]) => void }) {
    const defaultSettings = gallerySettings || gallerySettingsCache.get(tableId) || {
        statusFilter: 'all',
        ratingFilter: 'all',
        columnFilter: 'all',
        showRating: true,
        displayFieldIds: data.fields.length > 0 ? [data.fields[0].id] : [],
        refFieldIds: []
    };

    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved' | 'approved' | 'unannotated'>(defaultSettings.statusFilter);
    const [ratingFilter, setRatingFilter] = useState<'all' | '5' | '4' | '3' | '2' | '1' | '0'>(defaultSettings.ratingFilter);
    const [columnFilter, setColumnFilter] = useState<string>(defaultSettings.columnFilter);
    
    const [showRating, setShowRating] = useState(defaultSettings.showRating);
    const [displayFieldIds, setDisplayFieldIds] = useState<string[]>(defaultSettings.displayFieldIds);
    const [showDisplayFieldsMenu, setShowDisplayFieldsMenu] = useState(false);

    const [refFieldIds, setRefFieldIds] = useState<string[]>(defaultSettings.refFieldIds || []);
    const [showRefFieldsMenu, setShowRefFieldsMenu] = useState(false);

    useEffect(() => {
        const settings = { statusFilter, ratingFilter, columnFilter, showRating, displayFieldIds, refFieldIds };
        gallerySettingsCache.set(tableId, settings);
        if (onGallerySettingsChange) {
            onGallerySettingsChange(settings);
        }
    }, [tableId, statusFilter, ratingFilter, columnFilter, showRating, displayFieldIds, refFieldIds]);

    const imageFields = data.fields.filter((f: any) => f.type === 'attachment' || f.type === 'aiImage' || f.type === 'aiVideo');

    const imagesMap = new Map();
    data.records.forEach((rec: any) => {
        data.fields.forEach((f: any) => {
            if (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'aiVideo') {
                const val = rec[f.id];
                if (val) {
                    let items: any[] = [];
                    if (Array.isArray(val)) items = val;
                    else if (typeof val === 'string' && val.trim() !== '') items = val.split(',').map((s: string) => ({ url: s.trim() }));
                    else if (typeof val === 'object' && !Array.isArray(val)) items = [val];

                    items.forEach(item => {
                        const url = typeof item === 'string' ? item : item.url;
                        if (!url) return;
                        if (!imagesMap.has(url)) {
                            imagesMap.set(url, { url, item: typeof item === 'string' ? { url } : item, fieldId: f.id, record: rec });
                        } else {
                            const existing = imagesMap.get(url);
                            if (typeof item !== 'string' && item.annotations && (!existing.item.annotations || existing.item.annotations.length < item.annotations.length)) {
                                existing.item = item;
                            }
                        }
                    });
                }
            }
        });
    });

    const allImages = Array.from(imagesMap.values());

    const enrichedImages = allImages.map(img => {
        const anns = img.item.annotations || [];
        let status = 'unannotated';
        if (anns.length > 0) {
            if (anns.some((a: any) => a.status === 'pending')) status = 'pending';
            else if (anns.some((a: any) => a.status === 'resolved')) status = 'resolved';
            else status = 'approved';
        }
        const rating = img.item.rating || 0;
        return { ...img, status, rating };
    });

    const displayImages = enrichedImages.filter(img => {
        if (statusFilter !== 'all' && img.status !== statusFilter) return false;
        if (ratingFilter !== 'all' && String(img.rating) !== ratingFilter) return false;
        if (columnFilter !== 'all' && img.fieldId !== columnFilter) return false;
        return true;
    });

    const renderImageCard = (img: any, idx: number | string) => {
        const path = img.url;
        let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:[\\/]/) || path.startsWith('\\\\') ? `file://${path}` : path);
        const infoTexts = displayFieldIds.map(id => {
            const f = data.fields.find((f: any) => f.id === id);
            const val = img.record[id];
            let text = val != null ? String(val) : '';
            if (f && (f.type === 'singleSelect' || f.type === 'multiSelect') && val) {
                const valArray = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s=>s.trim()) : [val]);
                const mapped = valArray.map(v => f.options?.find((o: any) => o.id === v)?.name || v);
                text = mapped.length === 1 && !Array.isArray(val) && f.type === 'singleSelect' ? mapped[0] : mapped.join(', ');
            }
            return { id, name: f?.name, text };
        }).filter(t => t.text);
        const hasInfo = showRating || infoTexts.length > 0;
        return (
            <div key={idx} className="relative group w-[200px] h-auto flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex-shrink-0 cursor-pointer hover:shadow-md transition-shadow" onClick={() => {
                const fileItemsForPreview = displayImages.map(d => {
                    const refCells: string[][] = [];
                    refFieldIds.forEach(id => {
                        const val = d.record[id];
                        if (val) {
                            let items: any[] = [];
                            if (Array.isArray(val)) items = val;
                            else if (typeof val === 'string' && val.trim() !== '') items = val.split(',').map((s: string) => ({ url: s.trim() }));
                            else if (typeof val === 'object' && !Array.isArray(val)) items = [val];

                            if (items.length > 0) {
                                const urlsObj = items.map(it => {
                                    const u = typeof it === 'string' ? it : it.url;
                                    if (u) return fullImageBlobCache.get(u) || (u.startsWith('/') || u.match(/^[a-zA-Z]:[\\/]/) || u.startsWith('\\\\') ? `file://${u}` : u);
                                    return '';
                                }).filter(Boolean);
                                if (urlsObj.length > 0) {
                                     refCells.push(urlsObj as string[]);
                                }
                            }
                        }
                    });
                    return { ...d.item, refCells };
                });
                onPreviewImage(path, fileItemsForPreview);
            }}>
                <div className="w-full h-[180px] shrink-0 relative border-b border-gray-100">
                    <ThumbnailImage path={path} alt={path} className="w-full h-full object-cover" />
                    {img.status !== 'unannotated' && (
                        <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] text-white font-bold shadow-sm ${img.status === 'pending' ? 'bg-red-500' : img.status === 'resolved' ? 'bg-yellow-500' : 'bg-green-500'}`}>
                            {img.status === 'pending' ? '待处理' : img.status === 'resolved' ? '已处理' : '通过'}
                        </div>
                    )}
                </div>
                {hasInfo && (
                    <div className="p-2 h-auto flex flex-col justify-center bg-white shrink-0">
                        {showRating && img.rating > 0 && (
                            <div className="flex items-center gap-0.5 mb-1">
                                {Array.from({length: 5}).map((_, i) => (
                                   <Star key={i} className={`w-3.5 h-3.5 ${i < img.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                                ))}
                            </div>
                        )}
                        {infoTexts.map(info => (
                            <div key={info.id} className="text-xs text-gray-600 truncate" title={`${info.name}: ${info.text}`}>
                               {info.text}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    let renderedContent;
    
    if (groupConfig && groupConfig.length > 0) {
        const groups: { groupKey: string, groupLabels: { fieldName: string, value: any }[], images: any[] }[] = [];
        let currentGroupKey = '';
        let currentGroup: any = null;

        displayImages.forEach(img => {
            let key = '';
            const labels: any[] = [];
            groupConfig.forEach(g => {
                const f = data.fields.find((f:any) => f.id === g.fieldId);
                const val = img.record[g.fieldId];
                key += g.fieldId + ':' + JSON.stringify(val) + '|';
                let displayVal = val;
                if (f && (f.type === 'singleSelect' || f.type === 'multiSelect') && val != null && val !== '') {
                    const valArray = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s=>s.trim()) : [val]);
                    const mapped = valArray.map(v => f.options?.find((o: any) => o.id === v)?.name || v);
                    displayVal = mapped.length === 1 && !Array.isArray(val) && f.type === 'singleSelect' ? mapped[0] : mapped.join(', ');
                }
                labels.push({ fieldName: f?.name || g.fieldId, value: displayVal });
            });
            
            if (key !== currentGroupKey || !currentGroup) {
                currentGroupKey = key;
                currentGroup = { groupKey: key, groupLabels: labels, images: [] };
                groups.push(currentGroup);
            }
            currentGroup.images.push(img);
        });

        renderedContent = (
             <div className="flex flex-col gap-6 w-full">
                 {groups.map((g, idx) => {
                     const isFolded = foldedGroups?.includes(g.groupKey);
                     return (
                     <div key={idx} className="flex flex-col gap-3 w-full">
                         <div 
                            className="flex items-center gap-2 text-sm font-medium text-gray-700 bg-gray-100/70 py-2 px-3 rounded-md border border-gray-200/60 shadow-sm self-start cursor-pointer hover:bg-gray-200/70 transition-colors"
                            onClick={() => {
                                const next = new Set(foldedGroups || []);
                                if (isFolded) next.delete(g.groupKey);
                                else next.add(g.groupKey);
                                onFoldedGroupsChange?.(Array.from(next));
                            }}
                         >
                             <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isFolded ? '-rotate-90' : ''}`} />
                             {g.groupLabels.map((lbl, i) => (
                                 <span key={i} className="flex flex-row items-center">
                                     {i > 0 && <span className="mx-2 text-gray-400">/</span>}
                                     <span className="text-gray-500 mr-1">{lbl.fieldName}:</span>
                                     <span className="font-semibold text-gray-800">{lbl.value !== undefined && lbl.value !== null && lbl.value !== '' ? String(lbl.value) : (lang === 'en' ? '(Empty)' : '(空)')}</span>
                                 </span>
                             ))}
                             <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 text-xs">{g.images.length}</span>
                         </div>
                         {!isFolded && (
                             <div className="flex flex-wrap gap-4">
                                 {g.images.map((img, i) => renderImageCard(img, `${idx}-${i}`))}
                             </div>
                         )}
                     </div>
                 )})}
             </div>
        );
    } else {
        renderedContent = (
             <div className="flex flex-wrap gap-4">
                 {displayImages.map((img, idx) => renderImageCard(img, idx))}
             </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full bg-gray-50 overflow-hidden outline-none">
             <div className="flex flex-col p-4 border-b border-gray-200 bg-white gap-3 shrink-0 shadow-sm z-10 w-full">
                 <div className="flex items-center gap-4 flex-wrap">
                     <span className="text-sm font-medium text-gray-700">{lang === 'en' ? 'Filter:' : '筛选:'}</span>
                     <select className="border border-gray-300 rounded px-2 py-1 text-sm outline-none" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
                         <option value="all">{lang === 'en' ? 'All Status' : '所有状态'}</option>
                         <option value="pending">{lang === 'en' ? 'Pending' : '待处理'}</option>
                         <option value="resolved">{lang === 'en' ? 'Resolved' : '已处理'}</option>
                         <option value="approved">{lang === 'en' ? 'Approved' : '审核通过'}</option>
                         <option value="unannotated">{lang === 'en' ? 'Unannotated' : '未批注'}</option>
                     </select>
                     <select className="border border-gray-300 rounded px-2 py-1 text-sm outline-none" value={ratingFilter} onChange={e => setRatingFilter(e.target.value as any)}>
                         <option value="all">{lang === 'en' ? 'All Ratings' : '所有评分'}</option>
                         <option value="5">5 {lang === 'en' ? 'Stars' : '星'}</option>
                         <option value="4">4 {lang === 'en' ? 'Stars' : '星'}</option>
                         <option value="3">3 {lang === 'en' ? 'Stars' : '星'}</option>
                         <option value="2">2 {lang === 'en' ? 'Stars' : '星'}</option>
                         <option value="1">1 {lang === 'en' ? 'Star' : '星'}</option>
                         <option value="0">{lang === 'en' ? 'Unrated' : '未评分'}</option>
                     </select>
                     <select className="border border-gray-300 rounded px-2 py-1 text-sm outline-none max-w-[150px] truncate" value={columnFilter} onChange={e => setColumnFilter(e.target.value)}>
                         <option value="all">{lang === 'en' ? 'All Columns' : '所有列'}</option>
                         {imageFields.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                     </select>
                     
                     <div className="w-px h-5 bg-gray-300 mx-2"></div>
                     
                     <span className="text-sm font-medium text-gray-700">{lang === 'en' ? 'Display:' : '显示:'}</span>
                     <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={showRating} onChange={(e) => setShowRating(e.target.checked)} className="rounded border-gray-300 cursor-pointer" />
                        {lang === 'en' ? 'Rating' : '评分'}
                     </label>
                     <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowDisplayFieldsMenu(!showDisplayFieldsMenu); }} 
                            className="border border-gray-300 rounded px-2 py-1 text-sm outline-none bg-white min-w-[140px] text-left flex justify-between items-center"
                        >
                            {displayFieldIds.length === 0 ? (lang === 'en' ? 'No text' : '不显示文本') : `${displayFieldIds.length} ${lang === 'en' ? 'columns selected' : '列已选择'}`}
                            <ChevronDown className="w-3 h-3 ml-2 opacity-50" />
                        </button>
                        {showDisplayFieldsMenu && (
                            <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowDisplayFieldsMenu(false)}></div>
                            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-lg rounded py-1 z-50 w-56 max-h-64 overflow-y-auto">
                                {data.fields.map((f: any) => (
                                    <label key={f.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                                        <input type="checkbox" className="rounded border-gray-300" checked={displayFieldIds.includes(f.id)} onChange={(e) => {
                                            if (e.target.checked) setDisplayFieldIds([...displayFieldIds, f.id]);
                                            else setDisplayFieldIds(displayFieldIds.filter(id => id !== f.id));
                                        }} />
                                        <span className="truncate">{f.name}</span>
                                    </label>
                                ))}
                            </div>
                            </>
                        )}
                     </div>

                     <div className="w-px h-5 bg-gray-300 mx-2"></div>

                     <span className="text-sm font-medium text-gray-700">{lang === 'en' ? 'Reference:' : '参考图:'}</span>
                     <div className="relative">
                         <button 
                             onClick={(e) => { e.stopPropagation(); setShowRefFieldsMenu(!showRefFieldsMenu); }} 
                             className="border border-gray-300 rounded px-2 py-1 text-sm outline-none bg-white min-w-[140px] text-left flex justify-between items-center"
                         >
                             {refFieldIds.length === 0 ? (lang === 'en' ? 'None' : '无') : `${refFieldIds.length} ${lang === 'en' ? 'columns selected' : '列已选择'}`}
                             <ChevronDown className="w-3 h-3 ml-2 opacity-50" />
                         </button>
                         {showRefFieldsMenu && (
                             <>
                             <div className="fixed inset-0 z-40" onClick={() => setShowRefFieldsMenu(false)}></div>
                             <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-lg rounded py-1 z-50 w-56 max-h-64 overflow-y-auto">
                                 {imageFields.map((f: any) => (
                                     <label key={f.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                                         <input type="checkbox" className="rounded border-gray-300" checked={refFieldIds.includes(f.id)} onChange={(e) => {
                                             if (e.target.checked) {
                                                 if (refFieldIds.length < 2) setRefFieldIds([...refFieldIds, f.id]);
                                                 else alert(lang === 'en' ? 'Max 2 reference columns' : '最多选择2列参考图');
                                             } else setRefFieldIds(refFieldIds.filter(id => id !== f.id));
                                         }} />
                                         <span className="truncate">{f.name}</span>
                                     </label>
                                 ))}
                             </div>
                             </>
                         )}
                     </div>
                     
                     <span className="text-sm text-gray-500 ml-auto">{displayImages.length} {lang === 'en' ? 'images' : '张图片'}</span>
                 </div>
             </div>
             <div className="flex-1 overflow-y-auto p-4 content-start">
                 {renderedContent}
             </div>
        </div>
    );
}

const scrollCache = new Map<string, number>();

export function Grid({ tableId, locateCellRequest, onLocateCellResult, viewMode = 'grid', data, allRecords, searchQuery, searchMatches, activeSearchMatch, onUpdateRecord, onUpdateRecordsBatch, onPasteRecordsBatch, onDeleteRecords, onAddRecord, onInsertRecords, onAddField, onInsertField, onDuplicateField, onFreezeColumn, onIndividualFreezeColumn, onDeleteField, onRenameField, onChangeFieldType, onReorderFields, onReorderRecords, onResizeCol, onUpdateField, onSortField, onFilterField, sortConfig, filterConfig, groupConfig, rowHeight, modelSettings, lang = 'zh', username, onUpdateGlobalAttachment, gallerySettings, onGallerySettingsChange, foldedGroups, onFoldedGroupsChange, onUpdateCellLinks }: GridProps) {
  const searchMatchSet = useMemo(() => new Set(searchMatches?.map(m => `${m.recordId}-${m.fieldId}`) || []), [searchMatches]);
  const visibleFields = useMemo(() => data.fields.filter(f => !f.hidden), [data.fields]);
  const globalAttachmentPropsMap = useMemo(() => {
     const map = new Map<string, AttachmentReviewProps>();
     const sourceRecords = allRecords?.length ? allRecords : data.records;
     
     sourceRecords.forEach((rec) => {
         data.fields.forEach((f) => {
             if (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'aiVideo') {
                 const val = rec[f.id];
                 if (val) {
                     const items = normalizeAttachmentItems(val);
                     items.forEach(item => {
                         const key = normalizeAttachmentKey(item.url);
                         if (key) {
                             const existing = map.get(key);
                             map.set(key, mergeReviewProps(existing, item));
                         }
                     });
                 }
             }
         });
     });
     return map;
  }, [allRecords, data.records, data.fields]);
  const [activeCell, setActiveCell] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [largeTextOpenRequest, setLargeTextOpenRequest] = useState<{ recordId: string; fieldId: string; temporaryReferenceFieldId?: string | null } | null>(null);
  const [forceEdit, setForceEdit] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [lastSelectedRowIndex, setLastSelectedRowIndex] = useState<number | null>(null);
  const [selectedColIds, setSelectedColIds] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const visibleRowsInfo = React.useMemo(() => {
      const indices: number[] = [];
      const cacheMap = new Map<number, { isRowHidden: boolean, headersAdded: number, size: number }>();
      
      let sizeBase = 33;
      if (rowHeight === 'medium') sizeBase = 57;
      if (rowHeight === 'tall') sizeBase = 81;
      if (rowHeight === 'extra') sizeBase = 121;
      
      for (let index = 0; index < data.records.length; index++) {
          let isRowHidden = false;
          let hiddenByLevel = -1;
          let headersAdded = 0;

          if (groupConfig && groupConfig.length > 0) {
              const record = data.records[index];
              let changedLevel = -1;
              for (let level = 0; level < groupConfig.length; level++) {
                  const fieldId = groupConfig[level].fieldId;
                  const prevRecord = index > 0 ? data.records[index - 1] : null;
                  let val1 = prevRecord ? JSON.stringify(prevRecord[fieldId]) : null;
                  let val2 = JSON.stringify(record[fieldId]);
                  
                  if (changedLevel !== -1 || val1 !== val2) {
                      if (changedLevel === -1) changedLevel = level;
                  }

                  let key = '';
                  for (let i = 0; i <= level; i++) {
                      key += String(groupConfig[i].fieldId) + ':' + JSON.stringify(record[groupConfig[i].fieldId]) + '|';
                  }

                  if (changedLevel !== -1 && changedLevel <= level) {
                      if (hiddenByLevel === -1 || level <= hiddenByLevel) {
                          headersAdded += 1;
                      }
                  }

                  if (foldedGroups?.includes(key)) {
                      isRowHidden = true;
                      if (hiddenByLevel === -1) hiddenByLevel = level;
                  }
              }
          }
          
          if (!(isRowHidden && headersAdded === 0)) {
              indices.push(index);
              cacheMap.set(index, { isRowHidden, headersAdded, size: (isRowHidden ? 0 : sizeBase) + headersAdded * 36 });
          }
      }
      return { indices, cacheMap, sizeBase };
  }, [groupConfig, data.records, rowHeight, foldedGroups]);

  const estimateSize = React.useCallback((virtualIndex: number) => {
      const index = visibleRowsInfo.indices[virtualIndex];
      const info = visibleRowsInfo.cacheMap.get(index);
      return info ? info.size : visibleRowsInfo.sizeBase;
  }, [visibleRowsInfo]);

  const rowVirtualizer = useVirtualizer({
    count: visibleRowsInfo.indices.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    overscan: 5
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  const currentScrollKey = `${tableId}_${viewMode}`;
  const isRestoringScroll = useRef(false);
  const ignoreScrollUntil = useRef(0);
  const handledLocateRequestRef = useRef<number | null>(null);

  useEffect(() => {
    const request = locateCellRequest;
    if (!request) return;
    if (handledLocateRequestRef.current === request.requestId) return;
    handledLocateRequestRef.current = request.requestId;

    const recordIndex = data.records.findIndex(record => record.id === request.recordId);
    const fieldIndex = data.fields.findIndex(field => field.id === request.fieldId);

    if (recordIndex < 0 || fieldIndex < 0) {
      onLocateCellResult?.({ status: 'not-found' });
      return;
    }

    const virtualRowIndex = visibleRowsInfo.indices.findIndex(dataIndex => dataIndex === recordIndex);

    if (virtualRowIndex < 0) {
      onLocateCellResult?.({ status: 'hidden' });
      return;
    }

    rowVirtualizer.scrollToIndex(virtualRowIndex, { align: 'center' });

    let frameOne = 0;
    let frameTwo = 0;

    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        const cellId = `cell-${request.recordId}-${request.fieldId}`;
        const element = document.getElementById(cellId);
        
        if (!element) {
          onLocateCellResult?.({ status: 'not-found' });
          return;
        }

        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        setActiveCell({ recordId: request.recordId, fieldId: request.fieldId });

        if (typeof (element as HTMLElement).focus === 'function') {
          (element as HTMLElement).focus({ preventScroll: true });
        }

        onLocateCellResult?.({ status: 'success' });
      });
    });

    return () => {
      if (frameOne) window.cancelAnimationFrame(frameOne);
      if (frameTwo) window.cancelAnimationFrame(frameTwo);
    };
  }, [locateCellRequest?.requestId, data.records, data.fields, visibleRowsInfo.indices, rowVirtualizer, onLocateCellResult]);

  // Restore scroll position when table changes
  useLayoutEffect(() => {
     isRestoringScroll.current = true;
     if (scrollContainerRef.current) {
         // Using setTimeout to ensure the DOM is fully painted (like large gallery images)
         setTimeout(() => {
            if (scrollContainerRef.current) {
                isRestoringScroll.current = true;
                scrollContainerRef.current.scrollTop = scrollCache.get(currentScrollKey) || 0;
                // Ignore scroll events for next 50ms (debouncing browser auto-scroll clamp)
                ignoreScrollUntil.current = Date.now() + 50;
                setTimeout(() => { isRestoringScroll.current = false; }, 50);
            }
         }, 10);
     }
  }, [tableId, viewMode, currentScrollKey]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
     if (isRestoringScroll.current || Date.now() < ignoreScrollUntil.current) return;
     scrollCache.set(currentScrollKey, e.currentTarget.scrollTop);
  };
  const [contextMenuState, setContextMenuState] = useState<{ x: number, y: number, recordId?: string } | null>(null);
  const [colContextMenuState, setColContextMenuState] = useState<{ x: number, y: number, fieldId?: string } | null>(null);
  const [cellContextMenuState, setCellContextMenuState] = useState<{ x: number, y: number } | null>(null);
  const [insertRowCount, setInsertRowCount] = useState(1);
  const [showColColorMenu, setShowColColorMenu] = useState(false);
  const [copiedFieldAttrStr, setCopiedFieldAttrStr] = useState<string | null>(() => localStorage.getItem('copiedFieldAttr'));
  const [insertColCount, setInsertColCount] = useState(1);
  const [showClearAnnotationsConfirm, setShowClearAnnotationsConfirm] = useState(false);
  const [showBatchDownloadDialog, setShowBatchDownloadDialog] = useState<Set<string> | null>(null);
  const [cutBox, setCutBox] = useState<{ minR: number, maxR: number, minC: number, maxC: number } | null>(null);
  
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  const [previewImageState, setPreviewImageState] = useState<{ items: any[], currentIndex: number, sourceViewMode: 'table' | 'gallery', onUpdate?: (newItems: any[]) => void } | null>(null);

  const setPreviewImage = (path: string | null, allItems: any[] = [], onUpdate?: (newItems: any[]) => void, sourceRecordId?: string, preferredIndex?: number) => {
      if (!path) { setPreviewImageState(null); return; }
      if (allItems.length === 0) allItems = [{ url: path }];
      
      const defaultSettings = gallerySettings || gallerySettingsCache.get(tableId) || { refFieldIds: [] };
      const refFieldIds = defaultSettings.refFieldIds || [];

      let currentRecord: any = null;
      const sourceRecords = allRecords?.length ? allRecords : data.records;
      if (sourceRecordId) {
         currentRecord = sourceRecords.find((r: any) => r.id === sourceRecordId);
      }
      
      let parsedItems = allItems.map(raw => {
          const sourceItem = typeof raw === 'string' ? { url: raw } : raw;
          const baseItem = stripPreviewOnlyProps(sourceItem);
          const itemUrl = baseItem.url;
          const mappedUrl = fullImageBlobCache.get(itemUrl) || ((itemUrl.startsWith('/') || itemUrl.match(/^[a-zA-Z]:[\\\\/]/) || itemUrl.startsWith('\\\\')) ? `file://${itemUrl}` : itemUrl);
          
          let rec = currentRecord;
          if (!rec) {
              for (const r of sourceRecords) {
                  let found = false;
                  for (const f of data.fields) {
                      if (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'aiVideo') {
                          const val = r[f.id];
                          if (val) {
                              const items = normalizeAttachmentItems(val);
                              for (const item of items) {
                                  if (item.url && (item.url === itemUrl || item.url.replace(/\\/g, '/') === itemUrl.replace(/\\/g, '/'))) {
                                      found = true;
                                      break;
                                  }
                              }
                          }
                      }
                  }
                  if (found) { rec = r; break; }
              }
          }
          
          const refCells: string[][] = [];
          if (rec && refFieldIds.length > 0) {
              refFieldIds.forEach((id: string) => {
                   const val = rec[id];
                   if (val) {
                       const items = normalizeAttachmentItems(val);
                       if (items.length > 0) {
                           const urlsObj = items.map(it => {
                               const u = it.url;
                               if (u) return fullImageBlobCache.get(u) || (u.startsWith('/') || u.match(/^[a-zA-Z]:[\\\\/]/) || u.startsWith('\\\\') ? `file://${u}` : u);
                               return '';
                           }).filter(Boolean);
                           if (urlsObj.length > 0) {
                               refCells.push(urlsObj as any);
                           }
                       }
                   }
              });
          }
          
          return {
              ...baseItem,
              mappedUrl,
              refCells
          };
      });
      const clickedKey = normalizeAttachmentKey(path || '');
      const matchedIndex = parsedItems.findIndex((item: any) => {
        return (
          normalizeAttachmentKey(item.url) === clickedKey ||
          normalizeAttachmentKey(item.mappedUrl) === clickedKey
        );
      });
      const hasValidPreferredIndex = Number.isInteger(preferredIndex) && Number(preferredIndex) >= 0 && Number(preferredIndex) < parsedItems.length;
      const currentIndex = hasValidPreferredIndex ? Number(preferredIndex) : (matchedIndex >= 0 ? matchedIndex : 0);
      setPreviewImageState({ items: parsedItems, currentIndex, sourceViewMode: viewMode, onUpdate });
  };

  const handlePreviewPrev = () => {
      if (!previewImageState) return;
      setPreviewImageState(prev => prev ? { ...prev, currentIndex: (prev.currentIndex - 1 + prev.items.length) % prev.items.length } : null);
  };

  const handlePreviewNext = () => {
      if (!previewImageState) return;
      setPreviewImageState(prev => prev ? { ...prev, currentIndex: (prev.currentIndex + 1) % prev.items.length } : null);
  };

  const [extraSelectedCells, setExtraSelectedCells] = useState<{ r: number, c: number }[]>([]);


  const [selectionStart, setSelectionStart] = useState<{ r: number, c: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ r: number, c: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  
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

  const gridStateRef = useRef({ selectionStart, selectionEnd, isSelecting, selectionBox, extraSelectedCells });
  useEffect(() => {
     gridStateRef.current = { selectionStart, selectionEnd, isSelecting, selectionBox, extraSelectedCells };
  });

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    if (activeSearchMatch) {
       const el = document.getElementById(`cell-${activeSearchMatch.recordId}-${activeSearchMatch.fieldId}`);
       if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
       }
    }
  }, [activeSearchMatch]);

  useEffect(() => {
    const w = window as any;
    if (!w.electronAPI?.listNetworkJobs) return;
    
    // Find all networkJob placeholders in the current grid data
    const placeholderJobs = new Map<string, {recordId: string, fieldId: string, values: any[]}>();
    
    data.records.forEach(r => {
        data.fields.forEach(f => {
            if (f.type !== 'aiImage' && f.type !== 'aiVideo') return;
            const vals = Array.isArray(r[f.id]) ? r[f.id] : (r[f.id] ? [r[f.id]] : []);
            vals.forEach(v => {
                if (v && v.type === 'networkJob' && v.jobId) {
                    if (!placeholderJobs.has(v.jobId)) {
                        placeholderJobs.set(v.jobId, { recordId: r.id, fieldId: f.id, values: [...vals] });
                    }
                }
            });
        });
    });
    
    if (placeholderJobs.size === 0) return;
    
    w.electronAPI.listNetworkJobs().then((jobs: any[]) => {
        const updatesToApply = new Map<string, any[]>();
        let hasChanges = false;
        
        jobs.forEach(job => {
            if ((job.phase === 'completed' || job.phase === 'failed') && placeholderJobs.has(job.localJobId)) {
                const info = placeholderJobs.get(job.localJobId)!;
                const existingVals = info.values;
                const newVals = existingVals.filter(v => !(v && v.type === 'networkJob' && v.jobId === job.localJobId));
                
                if (job.phase === 'completed' && job.localPath) {
                    const storedPath = normalizeLocalPathForStorage(job.localPath);
                    const targetKey = normalizeAttachmentKey(storedPath);
                    
                    const alreadyExists = newVals.some(value => {
                        const itemUrl = typeof value === 'string' ? value : value?.url;
                        return normalizeAttachmentKey(itemUrl) === targetKey;
                    });
                    
                    if (storedPath && !alreadyExists) {
                        newVals.push(storedPath);
                    }
                }
                
                info.values = newVals;
                const key = `${info.recordId}-${info.fieldId}`;
                updatesToApply.set(key, info.values);
                hasChanges = true;
            }
        });
        
        if (hasChanges && onUpdateRecordsBatch) {
            const finalUpdates = Array.from(updatesToApply.entries()).map(([key, value]) => {
                const [recordId, fieldId] = key.split('-');
                return { recordId, fieldId, value };
            });
            onUpdateRecordsBatch(finalUpdates);
        }
    }).catch((err: any) => console.error("Reconciliation error:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  useEffect(() => {
    const w = window as any;
    if (!w.electronAPI?.onNetworkJobUpdated) {
        return;
    }

    const unsubscribe = w.electronAPI.onNetworkJobUpdated((job: any) => {
        if (job.tableId === tableId && (job.phase === 'completed' || job.phase === 'failed')) {
            const record = data.records.find(r => r.id === job.recordId);
            if (record) {
                const existingVals = Array.isArray(record[job.fieldId]) ? record[job.fieldId] : (record[job.fieldId] ? [record[job.fieldId]] : []);
                if (job.phase === 'completed' && job.localPath) {
                    const newVals = existingVals.filter(v => !(v && v.type === 'networkJob' && v.jobId === job.localJobId));
                    const storedPath = normalizeLocalPathForStorage(job.localPath);
                    const targetKey = normalizeAttachmentKey(storedPath);
                    
                    const alreadyExists = newVals.some(value => {
                        const itemUrl = typeof value === 'string' ? value : value?.url;
                        return normalizeAttachmentKey(itemUrl) === targetKey;
                    });
                    
                    if (storedPath && !alreadyExists) {
                        newVals.push(storedPath);
                        onUpdateRecord(job.recordId, job.fieldId, newVals);
                    } else if (newVals.length !== existingVals.length) { // still need to save if we removed the networkJob marker
                        onUpdateRecord(job.recordId, job.fieldId, newVals);
                    }
                } else if (job.phase === 'failed') {
                    const newVals = existingVals.filter(v => !(v && v.type === 'networkJob' && v.jobId === job.localJobId));
                    if (newVals.length !== existingVals.length) {
                        onUpdateRecord(job.recordId, job.fieldId, newVals);
                    }
                }
            }
        }
    });

    return () => {
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    };
  }, [data.records, tableId, onUpdateRecord]);

  useEffect(() => {
    const isNativeEditableTarget = (target: EventTarget | null) => {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return true;
        if (target.closest('[contenteditable="true"]')) return true;
      }
      return false;
    };

    const handleCopy = (e: ClipboardEvent) => {
      // Allow natural copy inside inputs
      if (isNativeEditableTarget(e.target)) return;
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
      const rawRows: any[][] = [];
      
      for (let r = minR; r <= maxR; r++) {
          const colVals: string[] = [];
          const rawColVals: any[] = [];
          for (let c = minC; c <= maxC; c++) {
              if (allSelectedCells.has(`${r},${c}`)) {
                  const record = data.records[r];
                  const field = visibleFields[c];
                  let val = record[field.id];
                  rawColVals.push(val);
                  
                  if (field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') {
                     if (Array.isArray(val)) {
                       val = val.map((a: any) => a.url || a).join(',');
                     } else if (typeof val === 'string') val = val;
                     else val = '';
                  } else if (field.type === 'singleSelect' || field.type === 'multiSelect') {
                     if (val) {
                       const valArray = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s=>s.trim()) : [val]);
                       val = valArray.map(v => field.options?.find((o:any) => o.id === v)?.name || v).join(', ');
                     }
                  } else if (typeof val === 'object' && val !== null) {
                     val = JSON.stringify(val);
                  }
                  colVals.push(encodeTSV(String(val || '')));
              } else {
                  colVals.push('');
                  rawColVals.push(null);
              }
          }
          rows.push(colVals.join('\t'));
          rawRows.push(rawColVals);
      }

      e.clipboardData?.setData('text/plain', rows.join('\n'));
      e.clipboardData?.setData('application/x-bitable-copy', JSON.stringify({ rawRows }));
      e.preventDefault();
      if (cutBox) setCutBox(null);
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (isNativeEditableTarget(e.target)) return;
      if (!selectionStart) return;
      
      e.preventDefault();
      
      let rows: any[][] = [];
      let isRaw = false;
      
      const customDataStr = e.clipboardData?.getData('application/x-bitable-copy');
      if (customDataStr) {
          try {
              const parsed = JSON.parse(customDataStr);
              if (parsed && parsed.rawRows) {
                  rows = parsed.rawRows;
                  isRaw = true;
              }
          } catch (err) {}
      }
      
      if (!isRaw) {
          const text = e.clipboardData?.getData('text/plain');
          if (!text) return;
          rows = parseTSV(text);
      }
      
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
      let newRecords: any[] = [];
      let neededRows = 0;

      if (selectedArr.length > 1) {
          // Map to multiple selected cells with tiling relative to minR, minC
          for (const { r, c } of selectedArr) {
             const val = rows[(r - minR) % rows.length]?.[(c - minC) % (rows[0]?.length || 1)];
             pasteCells.push({ rIdx: r, cIdx: c, val });
          }
      } else {
          neededRows = Math.max(0, minR + rows.length - data.records.length);
          if (neededRows > 0) {
              newRecords = Array.from({ length: neededRows }, (_, i) => ({ id: `rec_${Date.now()}_${i}` }));
          }
          
          // Map to a block expanding right and down
          for (let i = 0; i < rows.length; i++) {
             const rIdx = minR + i;
             for (let j = 0; j < rows[i].length; j++) {
                const cIdx = minC + j;
                if (cIdx >= visibleFields.length) break;
                pasteCells.push({ rIdx, cIdx, val: rows[i][j] });
             }
          }
      }

      const allRecords = [...data.records, ...newRecords];
      const batchUpdates = [];

      for (const { rIdx, cIdx, val: rawVal } of pasteCells) {
          if (rawVal === undefined) continue;
          
          const record = allRecords[rIdx];
          if (!record) continue; // safety check
          
          const field = visibleFields[cIdx];
          let val = rawVal;
          
          if (field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') {
                if (isRaw) {
                   val = normalizeAttachmentItems(rawVal).map(item => 
                     hydrateReviewProps(item, globalAttachmentPropsMap)
                   );
               } else {
                   let pathToAdd = val || '';
                   if (typeof pathToAdd === 'string' && pathToAdd) {
                      const existingArr = normalizeAttachmentItems(record[field.id]);
                      const pastedItems = normalizeAttachmentItems(pathToAdd).map(item => 
                        hydrateReviewProps(item, globalAttachmentPropsMap)
                      );
                      val = [...existingArr, ...pastedItems];
                   } else {
                      val = pathToAdd;
                   }
               }
          } else if (field.type === 'number') {
             val = val ? Number(val) : null;
          } else if (field.type === 'checkbox') {
             val = val === 'true' || val === '1';
          } else if (!isRaw && field.type === 'singleSelect') {
             if (val && typeof val === 'string') {
                 const match = field.options?.find(o => o.name === val.trim() || o.id === val.trim());
                 val = match ? match.id : val;
             }
          } else if (!isRaw && field.type === 'multiSelect') {
             if (val && typeof val === 'string') {
                 const parts = val.split(',').map((s: string) => s.trim());
                 val = parts.map((part: string) => {
                     const match = field.options?.find(o => o.name === part || o.id === part);
                     return match ? match.id : part;
                 });
             } else {
                 val = [];
             }
          }
          batchUpdates.push({ recordId: record.id, fieldId: field.id, value: val });
      }

      if (cutBox) {
         for (let r = cutBox.minR; r <= cutBox.maxR; r++) {
           for (let c = cutBox.minC; c <= cutBox.maxC; c++) {
              // skip updating if the cut cell was just overwritten by the paste (optimisation)
              // but for safety, clear it.
              const field = visibleFields[c];
              batchUpdates.push({ recordId: data.records[r].id, fieldId: field.id, value: field.type === 'multiSelect' ? [] : '' });
           }
         }
         setCutBox(null);
      }
      
      if (neededRows > 0 && onPasteRecordsBatch) {
          onPasteRecordsBatch(batchUpdates, newRecords);
      } else if (onUpdateRecordsBatch && batchUpdates.length > 0) {
          onUpdateRecordsBatch(batchUpdates);
      } else {
          batchUpdates.forEach(u => onUpdateRecord(u.recordId, u.fieldId, u.value));
      }
    };

    const handleDeleteKey = (e: KeyboardEvent) => {
      if (isNativeEditableTarget(e.target)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
         if (!selectionBox && extraSelectedCells.length === 0) return;
         if (selectionBox && selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1 && extraSelectedCells.length === 0) {
             const fieldIds = [];
             for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                 fieldIds.push(visibleFields[c].id);
             }
             if (onDeleteField) {
                 fieldIds.forEach(id => onDeleteField(id));
                 setSelectionStart(null);
                 setSelectionEnd(null);
                 return;
             }
         }
         // Clear cells
         const batchUpdates = [];
         if (selectionBox) {
           for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
             for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                const field = visibleFields[c];
                batchUpdates.push({ recordId: data.records[r].id, fieldId: field.id, value: field.type === 'multiSelect' ? [] : '' });
             }
           }
         }
         extraSelectedCells.forEach(cell => {
             const field = visibleFields[cell.c];
             if (field) {
               batchUpdates.push({ recordId: data.records[cell.r].id, fieldId: field.id, value: field.type === 'multiSelect' ? [] : '' });
             }
         });
         
         if (onUpdateRecordsBatch && batchUpdates.length > 0) {
             onUpdateRecordsBatch(batchUpdates);
         } else {
             batchUpdates.forEach(u => onUpdateRecord(u.recordId, u.fieldId, u.value));
         }
      }
    };

    const handleCut = (e: ClipboardEvent) => {
      if (isNativeEditableTarget(e.target)) return;
      if (!selectionBox) return;

      const rows: string[] = [];
      for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
         const colVals: string[] = [];
         const record = data.records[r];
         for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
            const field = visibleFields[c];
            let val = record[field.id];
            if (field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') {
               if (Array.isArray(val)) {
                 val = val.map((a: any) => a.url || a).join(',');
               } else if (typeof val === 'string') {
                 val = val;
               } else {
                 val = '';
               }
            } else if (field.type === 'singleSelect' || field.type === 'multiSelect') {
               if (val) {
                 const valArray = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(',').map(s=>s.trim()) : [val]);
                 val = valArray.map(v => field.options?.find((o:any) => o.id === v)?.name || v).join(', ');
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
    let idsToDrag = [id];
    if (selectionBox && selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1) {
      const selectedIds = [];
      let isIdInSelection = false;
      for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
        const fieldId = visibleFields[c].id;
        selectedIds.push(fieldId);
        if (fieldId === id) isIdInSelection = true;
      }
      if (isIdInSelection && selectedIds.length > 1) {
        idsToDrag = selectedIds;
      }
    }
    
    setDraggedColId(idsToDrag.join(','));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `col:${idsToDrag.join(',')}`); 
  };

  const handleDragStartRow = (e: React.DragEvent, id: string) => {
    setDraggedRowId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `row:${id}`);
  };

  const [generatingCells, setGeneratingCells] = useState<Set<string>>(new Set());




  const executeAIGenerateCell = async (record: any, field: Field) => {
            let resultText = '';
        const contextData: any = {};
        
        if (field.refFields && field.refFields.length > 0) {
          field.refFields.forEach(refId => {
            const refField = data.fields.find(f => f.id === refId);
            if (refField) {
              contextData[refField.name] = resolveFieldValueForAI(record[refId], refField, record, data.fields);
            }
          });
        }
        
        let promptString = field.prompt || "";
        let promptImageParts: any[] = [];
        let promptDataUrls: string[] = [];
        let promptOriginalUrls: string[] = [];
        let promptSourceUrls: string[] = [];
        
        if (field.type === 'aiImage' || field.type === 'aiVideo') {
           const cfg: any = field.type === 'aiVideo' ? (field.aiVideoConfig || {}) : (field.aiImageConfig || {});
           const { cleanString, parts, dataUrls, originalUrls, sourceUrls } = await getBase64ImageParts(promptString, data.fields, record, cfg);
           promptString = cleanString;
           promptImageParts = parts;
           promptDataUrls = dataUrls;
           promptOriginalUrls = originalUrls || [];
           promptSourceUrls = sourceUrls || [];
        } else {
           // Smart Text keeps the legacy path unless a Skill is explicitly selected/resolved.
           const textCfg = field.aiTextConfig || {};
           const resolvedInstruction = resolveTemplateString(promptString, data.fields, record);
           const resolvedSkillDisplayName = resolveTemplateString(textCfg.skillTemplate || '', data.fields, record).trim();

           if (resolvedSkillDisplayName) {
             const w = window as any;
             if (!w.electronAPI?.compileSkillContext) {
               throw new Error(lang === 'en'
                 ? 'Skill System requires the Electron desktop client.'
                 : 'Skill System 需要在 Electron 桌面端中运行。');
             }
             const compiledSkill = await w.electronAPI.compileSkillContext({
               displayName: resolvedSkillDisplayName,
               runtimeContext: contextData,
               userTask: resolvedInstruction
             });
             promptString = compiledSkill?.fullPrompt || resolvedInstruction;
           } else {
             // Legacy Smart Text prompt stays unchanged for full backward compatibility.
             promptString = `You are an AI assistant helping to evaluate a table row. Here is the data context for this row:\n\n${JSON.stringify(contextData, null, 2)}\n\nBased ONLY on the context provided, perform the following instruction and respond with the concise result. Do not include markdown formatting or conversational filler.\n\nInstruction: ${resolvedInstruction}`;
           }
        }
        
        let resultParams: any = '';
        let finalOriginalUrls: string[] = [];
        let finalSourceUrls: string[] = [];

        if (field.type === 'aiImage') {
          const cfg = field.aiImageConfig || {};
          const count = cfg.count || 1;
          
          let ratioRaw = resolveTemplateString(cfg.ratio || "1:1", data.fields, record);
          let ratio = ratioRaw.replace(/：/g, ':').trim();
          
          if (cfg.isRetouchMode) {
              const template = cfg.sourceImageTemplate || '';
              const matches = data.fields
                 .map(f => ({ f, index: template.indexOf(`{${f.name}}`) }))
                 .filter(m => m.index !== -1)
                 .sort((a, b) => a.index - b.index);

              for (let match of matches) {
                 const f = match.f;
                 let val = record[f.id];
                 if (val) {
                    const arr = Array.isArray(val) ? val : (typeof val==='string' ? val.split(',') : [val]);
                    const first = arr[0];
                    if (first && typeof first === 'object' && first.cropData && first.cropData.ratio) {
                        const r = first.cropData.ratio;
                        const standards = [
                          { r: 1, s: '1:1' },
                          { r: 16/9, s: '16:9' },
                          { r: 9/16, s: '9:16' },
                          { r: 4/3, s: '4:3' },
                          { r: 3/4, s: '3:4' },
                          { r: 3/2, s: '3:2' },
                          { r: 2/3, s: '2:3' },
                          { r: 21/9, s: '21:9' }
                        ];
                        const closest = standards.reduce((prev, curr) => Math.abs(curr.r - r) < Math.abs(prev.r - r) ? curr : prev);
                        ratio = closest.s;
                        break;
                    }
                 }
              }
          }
          
          let resolutionRaw = resolveTemplateString(cfg.resolution || "1024x1024", data.fields, record);
          let resolution = resolutionRaw.trim().toLowerCase();
          
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
          const sizeStr = (resolution === '4k') ? (res4kMap[ratio] || '4096x4096') : (resolution === '2k') ? (res2kMap[ratio] || '2048x2048') : (hdMap[ratio] || "1024x1024");
          
          const enabledImageProviders = getEnabledProviders(modelSettings.image);
          if (enabledImageProviders.length === 0) {
            throw new Error(
              lang === 'en'
                ? 'No image API configuration is currently enabled. Open API Settings and enable one.'
                : '当前没有启用任何图片 API 配置。请前往“API 和模型配置”打开一项。'
            );
          }

          const defaultImgSet = enabledImageProviders[0];
          let resolvedModel = parseProviderModels(defaultImgSet)[0] || 'dall-e-3';

          if (cfg.modelTemplate) {
             let template = resolveTemplateString(cfg.modelTemplate, data.fields, record);
             if (template.trim()) {
               resolvedModel = template.trim();
             }
          }

          const imgSet = findEnabledProviderForModel(
            modelSettings.image,
            resolvedModel,
            lang === 'en' ? 'image' : '图片',
            lang
          );

          let finalPrompt = promptString;
          let imageParts: any[] = [...promptImageParts];
          let finalDataUrls: string[] = [...promptDataUrls];
          finalOriginalUrls = [...promptOriginalUrls];
          finalSourceUrls = [...promptSourceUrls];
          if (cfg.sourceImageTemplate) {
             const { parts, dataUrls, originalUrls, sourceUrls } = await getBase64ImageParts(cfg.sourceImageTemplate, data.fields, record, cfg);
             imageParts = [...imageParts, ...parts];
             finalDataUrls = [...finalDataUrls, ...dataUrls];
             finalOriginalUrls = [...finalOriginalUrls, ...(originalUrls || [])];
             finalSourceUrls = [...finalSourceUrls, ...(sourceUrls || [])];
          }


          if (imgSet.provider === 'gemini') {
            throw new Error("Local Gemini Image generation not natively supported in this preview without vertex AI. Please use OpenAI-compatible proxy for images.");
          } else if (imgSet.provider === 'lingwu' || imgSet.provider === 'comfyui') {
            const w = window as any;
            if (!w.electronAPI || !w.electronAPI.generateLingwuImage) {
               throw new Error("Local image generation requires the application to run inside the Electron client.");
            }
            if (imgSet.provider === 'lingwu' && !imgSet.key) throw new Error("Lingwu API Key is required for Image Generation");
            
            // Map the prompt and params
            const params: any = {
                imageSize: String(resolution || '1K').toUpperCase(),
                aspectRatio: ratio,
                images: finalOriginalUrls.length > 0 ? finalOriginalUrls : undefined
            };
            
            let finalFilename = '';
            let finalFolderPath = '';
            if (cfg.filenameTemplate || cfg.folderPath || cfg.isRetouchMode) {
                const { filename: defaultFilename, folderPath: defaultFolderPath } = resolveFilenameAndFolder(cfg.filenameTemplate || 'image', cfg.folderPath || '', data.fields, record);
                finalFilename = defaultFilename;
                finalFolderPath = defaultFolderPath;
                
                if (cfg.isRetouchMode && finalSourceUrls.length > 0) {
                    const firstUrl = finalSourceUrls[0];
                    let match = firstUrl.match(/^file:\/\/(.*)[\/\\]([^\/\\]+)$/);
                    if (!match) match = firstUrl.match(/^(.*)[\/\\]([^\/\\]+)$/);
                    if (!firstUrl.startsWith('data:') && !firstUrl.startsWith('blob:') && match) {
                        if (cfg.saveToSourceFolder) {
                            let p = match[1];
                            if (p.startsWith('file://')) p = p.replace('file://', '');
                            if (p.startsWith('local-img://')) p = decodeURIComponent(p.replace('local-img://', ''));
                            if (p.startsWith('local-video://')) p = decodeURIComponent(p.replace('local-video://', ''));
                            if (p.startsWith('/') && p.length > 2 && p[2] === ':') p = p.substring(1);
                            finalFolderPath = p;
                        }
                        const originalNameBase = match[2].split('.').slice(0, -1).join('.') || match[2];
                        finalFilename = `${originalNameBase}-gan`;
                    }
                }
            }

            const imageResize = resolveRetouchImageResize(
                cfg,
                data.fields,
                record
            );

            const results = [];
            for (let i = 0; i < count; i++) {
                try {
                    const jobInfo = await w.electronAPI.generateLingwuImage({
                        tableId: tableId,
                        recordId: record.id,
                        fieldId: field.id,
                        viewMode: viewMode,
                         generationIndex: i,
                         provider: imgSet.provider,
                         prompt: finalPrompt,
                        model: resolvedModel,
                        params: params,
                        count: 1,
                        apiKey: imgSet.key,
                        endpoint: imgSet.endpoint || (imgSet.provider === 'comfyui' ? 'http://127.0.0.1:8188' : 'https://api.lingwu.example.com'),
                        comfyuiBatPath: imgSet.provider === 'comfyui' ? (localStorage.getItem('bitable_comfyui_bat_path') || '') : '',
                        ossConfig: modelSettings?.oss,
                        downloadConfig: {
                            filename: finalFilename,
                            folderPath: finalFolderPath,
                            ...(imageResize ? { imageResize } : {})
                        }
                    });
                    results.push({ type: 'networkJob', jobId: jobInfo.localJobId });
                } catch (err) {
                    if (results.length > 0) {
                        console.error(`Partial failure creating image job ${i + 1}/${count}`, err);
                        break;
                    } else {
                        throw err;
                    }
                }
            }
            resultParams = results;
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
                const geminiImageSize = resolution ? resolution.toUpperCase() : undefined;
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
        } else if (field.type === 'aiVideo') {
           const cfg = field.aiVideoConfig || {};
           
           let ratioRaw = resolveTemplateString(cfg.ratio || "16:9", data.fields, record);
           let ratio = ratioRaw.replace(/：/g, ':').trim();
           
           let resolution = resolveTemplateString(cfg.resolution || "1080P", data.fields, record).trim();
           let mode = resolveTemplateString(cfg.mode || "fast", data.fields, record).trim();
           let durationRaw = resolveTemplateString(cfg.duration || "10", data.fields, record).trim();
           let duration = parseInt(durationRaw) || 10;
           
           // Collect reference images or videos
           finalOriginalUrls = [...promptOriginalUrls];
           finalSourceUrls = [...promptSourceUrls];
           if (cfg.sourceImageTemplate) {
              const { originalUrls, sourceUrls } = await getBase64ImageParts(cfg.sourceImageTemplate, data.fields, record, cfg);
              finalOriginalUrls = [...finalOriginalUrls, ...(originalUrls || [])];
              finalSourceUrls = [...finalSourceUrls, ...(sourceUrls || [])];
           }
           
           const enabledVideoProviders = getEnabledProviders(modelSettings.video);
           if (enabledVideoProviders.length === 0) {
              throw new Error(
                lang === 'en'
                  ? 'No video API configuration is currently enabled. Open API Settings and enable one.'
                  : '当前没有启用任何视频 API 配置。请前往“API 和模型配置”打开一项。'
              );
           }

           const defaultVidSet = enabledVideoProviders[0];
           let resolvedModel = parseProviderModels(defaultVidSet)[0] || 'video-v1';
           if (cfg.modelTemplate) {
              let template = resolveTemplateString(cfg.modelTemplate, data.fields, record);
              if (template.trim()) resolvedModel = template.trim();
           }
           const vidSet = findEnabledProviderForModel(
             modelSettings.video,
             resolvedModel,
             lang === 'en' ? 'video' : '视频',
             lang
           );

           if (vidSet.provider !== 'lingwu' && vidSet.provider !== 'comfyui') {
              throw new Error("This video provider is not supported. Please select Lingwu or ComfyUI.");
           }
           const w = window as any;
           if (!w.electronAPI || !w.electronAPI.generateLingwuVideo) {
              throw new Error("Lingwu AI Video generation requires the application to run inside the electron client.");
           }
           if (vidSet.provider === 'lingwu' && !vidSet.key) throw new Error("Lingwu API Key is required for Video Generation");

           // Categorize media into images, videos, audio based on extension or prefix
           const images: string[] = [];
           const videos: string[] = [];
           const audio: string[] = [];
           finalOriginalUrls.forEach(url => {
              if (!url) return;
              const lowerUrl = url.toLowerCase();
              if (lowerUrl.includes('.mp4') || lowerUrl.includes('.webm') || lowerUrl.includes('.mov') || lowerUrl.includes('.mkv') || lowerUrl.startsWith('local-video:')) {
                 videos.push(url);
              } else if (lowerUrl.includes('.mp3') || lowerUrl.includes('.wav') || lowerUrl.includes('.flac') || lowerUrl.includes('.m4a') || lowerUrl.includes('.aac') || lowerUrl.includes('.ogg') || lowerUrl.includes('.opus') || lowerUrl.startsWith('data:audio') || lowerUrl.startsWith('local-audio:')) {
                 audio.push(url);
              } else {
                 images.push(url);
              }
           });

           const params: any = {
              resolution,
              aspectRatio: ratio,
              mode,
              duration,
              sound: cfg.sound === 'true',
              enhancePrompt: cfg.enhancePrompt === 'true'
           };

            let finalFilename = '';
            let finalFolderPath = '';
            if (cfg.filenameTemplate || cfg.folderPath) {
                const { filename: defaultFilename, folderPath: defaultFolderPath } = resolveFilenameAndFolder(cfg.filenameTemplate || 'video', cfg.folderPath || '', data.fields, record);
                finalFilename = defaultFilename;
                finalFolderPath = defaultFolderPath;
            }

           const jobInfo = await w.electronAPI.generateLingwuVideo({
                tableId: tableId,
                recordId: record.id,
                fieldId: field.id,
                viewMode: viewMode,
                generationIndex: 0,
                provider: vidSet.provider,
                prompt: promptString,
                model: resolvedModel,
                params: params,
                images: images,
                videos: videos,
                audio: audio,
                apiKey: vidSet.key,
                endpoint: vidSet.endpoint || (vidSet.provider === 'comfyui' ? 'http://127.0.0.1:8188' : 'https://api.ai6700.com/api'),
                comfyuiBatPath: vidSet.provider === 'comfyui' ? (localStorage.getItem('bitable_comfyui_bat_path') || '') : '',
                ossConfig: modelSettings?.oss,
                downloadConfig: { filename: finalFilename, folderPath: finalFolderPath }
           });
           
           resultParams = [{ type: 'networkJob', jobId: jobInfo.localJobId }];
        } else {
          const cfg = field.aiTextConfig || {};
          const enabledTextProviders = getEnabledProviders(modelSettings.text);
          if (enabledTextProviders.length === 0) {
            throw new Error(
              lang === 'en'
                ? 'No text API configuration is currently enabled. Open API Settings and enable one.'
                : '当前没有启用任何文本 API 配置。请前往“API 和模型配置”打开一项。'
            );
          }

          const defaultTxtSet = enabledTextProviders[0];
          let resolvedModel = parseProviderModels(defaultTxtSet)[0] || 'gpt-3.5-turbo';

          if (cfg.modelTemplate) {
             let template = cfg.modelTemplate;
             data.fields.forEach(f => {
               template = template.replace(new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), String(record[f.id] || ''));
             });
             if (template.trim()) {
               resolvedModel = template.trim();
             }
          } else if (defaultTxtSet.provider === 'gemini' && parseProviderModels(defaultTxtSet).length === 0) {
             resolvedModel = 'gemini-1.5-flash';
          }

          const txtSet = parseProviderModels(defaultTxtSet).length === 0 && !cfg.modelTemplate
            ? defaultTxtSet
            : findEnabledProviderForModel(
                modelSettings.text,
                resolvedModel,
                lang === 'en' ? 'text' : '文本',
                lang
              );

          let textParts: any[] = [{ text: promptString }];
          if (cfg.sourceImageTemplate) {
             const { parts } = await getBase64ImageParts(cfg.sourceImageTemplate, data.fields, record, cfg);
             textParts = [...parts, ...textParts];
          }

          if (txtSet.provider === 'gemini' || txtSet.provider === 'gemini-custom') {
            if (!txtSet.key) throw new Error("Gemini API Key is required");
            let endpoint = txtSet.endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`;
            
            if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
            if (!endpoint.includes(':generateContent')) {
               endpoint = `${endpoint}/models/${resolvedModel}:generateContent`;
            }
              
            const res = await fetch(`${endpoint}?key=${txtSet.key}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                 contents: [{ parts: textParts, role: 'user' }]
              })
            });
            const resData = await res.json();
            if (resData.error) throw new Error(resData.error.message);
            resultParams = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          } else {
            if (!txtSet.key) throw new Error("OpenAI API Key is required");
            
            let messageContent: any = promptString;
            if (textParts.length > 1) {
              messageContent = textParts.map(p => {
                if (p.inlineData) {
                  return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
                } else if (p.text) {
                  return { type: 'text', text: p.text };
                }
                return p;
              });
            }

            let apiEndpoint = txtSet.endpoint || 'https://api.openai.com/v1';
            apiEndpoint = apiEndpoint.replace(/\/$/, '');
            if (!apiEndpoint.endsWith('/chat/completions')) {
               apiEndpoint += '/chat/completions';
            }
            
            const res = await fetch(apiEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${txtSet.key}`
              },
              body: JSON.stringify({
                model: resolvedModel,
                messages: [{ role: 'user', content: messageContent }]
              })
            });
            const json = await res.json();
            if (json.error) throw new Error(json.error.message);
            if (!json.choices || !json.choices.length) throw new Error("Invalid response from text API");
            resultParams = json.choices[0].message.content;
          }
        }
        
        let finalResultParams = resultParams;
        if (field.type === 'aiImage' || field.type === 'aiVideo') {
           const existing = Array.isArray(record[field.id]) ? record[field.id] : (record[field.id] ? [record[field.id]] : []);
           const resultArray = Array.isArray(resultParams) ? resultParams : [resultParams];
           const networkJobItems = resultArray.filter(isNetworkJobCellItem);

           if (networkJobItems.length > 0) {
             finalResultParams = [...existing, ...networkJobItems];
             onUpdateRecord(record.id, field.id, finalResultParams);
             return finalResultParams;
           }

           const directUrlResults = resultArray.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
           let downloadedUrls: string[] = [...directUrlResults];
           
           if (directUrlResults && directUrlResults.length > 0) {
              const cfg: any = field.type === 'aiVideo' ? (field.aiVideoConfig || {}) : (field.aiImageConfig || {});
              if (cfg.filenameTemplate || cfg.folderPath || cfg.isRetouchMode) {
                 const { filename: defaultFilename, folderPath: defaultFolderPath } = resolveFilenameAndFolder(cfg.filenameTemplate || (field.type === 'aiVideo' ? 'video' : 'image'), cfg.folderPath || '', data.fields, record);
                 
                 let finalFilename = defaultFilename;
                 let finalFolderPath = defaultFolderPath;
                 
                 if (cfg.isRetouchMode && field.type === 'aiImage' && finalSourceUrls.length > 0) {
                     const firstUrl = finalSourceUrls[0];
                     let match = firstUrl.match(/^file:\/\/(.*)[\/\\]([^\/\\]+)$/);
                     if (!match) match = firstUrl.match(/^(.*)[\/\\]([^\/\\]+)$/);
                     if (!firstUrl.startsWith('data:') && !firstUrl.startsWith('blob:') && match) {
                         if (cfg.saveToSourceFolder) {
                             let p = match[1];
                             if (p.startsWith('file://')) p = p.replace('file://', '');
                             if (p.startsWith('local-img://')) p = decodeURIComponent(p.replace('local-img://', ''));
                             if (p.startsWith('local-video://')) p = decodeURIComponent(p.replace('local-video://', ''));
                             if (p.startsWith('/') && p.length > 2 && p[2] === ':') p = p.substring(1); // handle file:///C:/...
                             finalFolderPath = p;
                         }
                         const originalNameBase = match[2].split('.').slice(0, -1).join('.') || match[2];
                         finalFilename = `${originalNameBase}-gan`;
                     }
                 }
                 
                 let targetW = 0;
                 let targetH = 0;
                 if (cfg.isRetouchMode && field.type === 'aiImage' && cfg.scaleToSource !== false) {
                     const template = cfg.sourceImageTemplate || '';
                     const matches = data.fields
                        .map(f => ({ f, index: template.indexOf(`{${f.name}}`) }))
                        .filter(m => m.index !== -1)
                        .sort((a, b) => a.index - b.index);

                     for (let match of matches) {
                        const f = match.f;
                        let val = record[f.id];
                        if (val) {
                           const arr = Array.isArray(val) ? val : (typeof val==='string' ? val.split(',') : [val]);
                           const first = arr[0];
                           if (first && typeof first === 'object' && first.cropData) {
                               const cr = first.cropData;
                               if (cr.imgW && cr.imgH && cr.naturalW && cr.naturalH && cr.scale && cr.maskW && cr.maskH) {
                                  targetW = Math.round((cr.maskW / cr.scale) * (cr.naturalW / cr.imgW));
                                  targetH = Math.round((cr.maskH / cr.scale) * (cr.naturalH / cr.imgH));
                               }
                               break;
                           }
                        }
                     }
                 }
                 
                 const savedUrls: string[] = [];
                 for (let i = 0; i < directUrlResults.length; i++) {
                     let urlToDownload = directUrlResults[i];
                     if (typeof urlToDownload !== 'string') {
                         continue;
                     }
                     let ext = field.type === 'aiVideo' ? '.mp4' : '.png'; // default fallback
                     if (urlToDownload.includes('.mp4')) ext = '.mp4';
                     else if (urlToDownload.includes('.mov')) ext = '.mov';
                     else if (urlToDownload.includes('.webm')) ext = '.webm';
                     
                     if (targetW > 0 && targetH > 0) {
                         try {
                              const resizedUrl = await new Promise<string>((resolve) => {
                                   const img = new Image();
                                   img.crossOrigin = "anonymous";
                                   img.onload = () => {
                                        const cvs = document.createElement('canvas');
                                        cvs.width = targetW;
                                        cvs.height = targetH;
                                        const ctx = cvs.getContext('2d');
                                        if (ctx) {
                                            ctx.drawImage(img, 0, 0, targetW, targetH);
                                            resolve(cvs.toDataURL('image/png'));
                                        } else resolve(urlToDownload);
                                   };
                                   img.onerror = () => resolve(urlToDownload);
                                   // Try to handle mixed content or missing cors header by fetching as blob locally if possible
                                   // but generic images should load if crossOrigin is set properly on OSS
                                   img.src = urlToDownload;
                              });
                              urlToDownload = resizedUrl;
                              ext = '.png';
                         } catch(e) { console.error("Resize failed", e); }
                     }
                     
                     const savedPath = await triggerDownload(urlToDownload, finalFilename + (resultParams.length > 1 ? `_${i+1}` : '') + ext, finalFolderPath);
                     savedUrls.push(savedPath || urlToDownload);
                 }
                 downloadedUrls = savedUrls;
              }
           }
           finalResultParams = [...existing, ...downloadedUrls];
        }
        
        onUpdateRecord(record.id, field.id, finalResultParams);
        return finalResultParams;
  };

  const handleGenerateColumn = async (field: Field, targetRecordIds?: string[]) => {
    if (!field.prompt) {
      alert("Please configure a prompt for this Smart Text column first.");
      return;
    }
    
      const recordsToProcess = targetRecordIds ? data.records.filter(r => targetRecordIds.includes(r.id)) : data.records.filter(r => {
          let val = r[field.id];
          if (field.type === 'aiImage') return !val || (Array.isArray(val) && val.length === 0);
          return val === undefined || val === null || val === '';
      });
      
      let hasError = false;
      let lastErrorMessage = '';
      const MAX_CONCURRENT = 4;
      
      const processRecord = async (record: any) => {
          setGeneratingCells(prev => new Set(prev).add(`${record.id}-${field.id}`));
          try {
            await executeAIGenerateCell(record, field);
          } catch (err: any) {
            console.error("AI Generation failed for record:", record.id, err);
            hasError = true;
            lastErrorMessage = err.message;
          } finally {
            setGeneratingCells(prev => {
              const next = new Set(prev);
              next.delete(`${record.id}-${field.id}`);
              return next;
            });
          }
      };

      const queue = [...recordsToProcess];
      const activePromises = new Set<Promise<void>>();

      while(queue.length > 0 || activePromises.size > 0) {
          while (queue.length > 0 && activePromises.size < MAX_CONCURRENT) {
              const record = queue.shift()!;
              const promise = processRecord(record);
              activePromises.add(promise);
              promise.finally(() => activePromises.delete(promise));
              
              if (queue.length > 0) await new Promise(r => setTimeout(r, 150));
          }
          if (activePromises.size > 0) {
              await Promise.race(activePromises);
          }
      }
      
      if (hasError) {
        alert("Some AI Generation tasks failed. Last error: " + lastErrorMessage);
      }
  };
  

  const [runningWorkflowRows, setRunningWorkflowRows] = useState<Set<string>>(new Set());

  const handleRunWorkflow = async (targetRecordIds: string[]) => {
      const recordsToProcess = data.records.filter(r => targetRecordIds.includes(r.id));
      if (recordsToProcess.length === 0) return;
      
      const aiFields = data.fields.filter(f => f.type === 'aiText' || f.type === 'aiImage' || f.type === 'aiVideo');
      if (aiFields.length === 0) {
          alert(lang === 'en' ? "No Smart Text / AI Image columns found in the table." : "表格中没有智能文本/智能图片列。");
          return;
      }
      
      for (const originalRecord of recordsToProcess) {
          setRunningWorkflowRows(prev => new Set(prev).add(originalRecord.id));
          
          let currentRecord = { ...originalRecord };
          let rowFailed = false;
          for (const field of aiFields) {
              if (rowFailed) break; 
              
              if (!field.prompt) continue; 
              
              let val = currentRecord[field.id];
              let shouldGenerate = false;
              if (field.type === 'aiImage') {
                 shouldGenerate = (!val || (Array.isArray(val) && val.length === 0));
              } else {
                 shouldGenerate = (val === undefined || val === null || val === '');
              }
              
              if (!shouldGenerate) continue;

              let attempts = 0;
              let success = false;
              const isPaidMediaField = field.type === 'aiImage' || field.type === 'aiVideo';
              const maxAttempts = isPaidMediaField ? 1 : 2;
              
              while (attempts < maxAttempts && !success) {
                  attempts++;
                  try {
                      setGeneratingCells(prev => new Set(prev).add(`${currentRecord.id}-${field.id}`));
                      const generatedValue = await executeAIGenerateCell(currentRecord, field);
                      currentRecord[field.id] = generatedValue;
                      success = true;
                  } catch (err: any) {
                      console.error(`Workflow generation failed for record ${currentRecord.id}, field ${field.id}, attempt ${attempts}`, err);
                      if (attempts >= maxAttempts) {
                          rowFailed = true;
                      } else {
                          // Wait a bit before retry
                          await new Promise(r => setTimeout(r, 1000));
                      }
                  } finally {
                      setGeneratingCells(prev => {
                          const next = new Set(prev);
                          next.delete(`${currentRecord.id}-${field.id}`);
                          return next;
                      });
                  }
              }
          }
          
          setRunningWorkflowRows(prev => {
              const next = new Set(prev);
              next.delete(originalRecord.id);
              return next;
          });
      }
  };

  const totalTableWidth = visibleFields.reduce((acc, f) => acc + (f.width || 150), 0) + 64; // 64 for row corner

  let frozenColIndex = -1;
  if (data.frozenColId) {
    frozenColIndex = visibleFields.findIndex(f => f.id === data.frozenColId);
  }

  const isFrozen = visibleFields.map((f, i) => 
     i <= frozenColIndex || (data.individualFrozenColIds?.includes(f.id) || false)
  );

  const frozenLeftOffsets: (number | undefined)[] = [];
  const isFrozenLastArray: boolean[] = [];
  let currentLeft = 64; // Starting after the 64px row corner

  for (let i = 0; i < visibleFields.length; i++) {
    if (isFrozen[i]) {
      frozenLeftOffsets.push(currentLeft);
      currentLeft += visibleFields[i].width || 150;
      isFrozenLastArray.push(!isFrozen[i+1]);
    } else {
      frozenLeftOffsets.push(undefined);
      isFrozenLastArray.push(false);
    }
  }

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-auto bg-white h-full" style={{ isolation: 'isolate', overflowAnchor: 'none' }}>
      {viewMode === 'gallery' ? (
        <ImageReviewView tableId={tableId} data={data} lang={lang} onPreviewImage={setPreviewImage} gallerySettings={gallerySettings} onGallerySettingsChange={onGallerySettingsChange} groupConfig={groupConfig} foldedGroups={foldedGroups} onFoldedGroupsChange={onFoldedGroupsChange} />
      ) : (
      <table className="text-left" style={{ tableLayout: 'fixed', width: '100%', minWidth: totalTableWidth + 100, borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-40 bg-gray-50 text-sm">
          <tr>
            <th className="sticky top-0 left-0 bg-gray-50 border-r border-b border-gray-200 z-[45] p-0" style={{ width: 64, minWidth: 64, maxWidth: 64 }}>
              <div 
                 className="w-full justify-center flex items-center h-8 text-gray-400 border-t border-transparent cursor-pointer"
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
            {visibleFields.map((field, colIdx) => (
              <HeaderCell 
                key={field.id} 
                colIdx={colIdx}
                totalCols={visibleFields.length}
                lang={lang}
                field={field} 
                onRename={(name) => onRenameField(field.id, name)} 
                onChangeType={(type) => onChangeFieldType(field.id, type)}
                onResize={(width) => onResizeCol(field.id, width)}
                onUpdateField={(updates) => onUpdateField(field.id, updates)}
                onGenerateColumn={() => handleGenerateColumn(field)}
                onDeleteField={() => onDeleteField?.(field.id)}
                onSortField={(dir) => onSortField?.(field.id, dir)}
                onFilterField={(operator, value) => onFilterField?.(field.id, operator, value)}
                frozenLeftOffset={frozenLeftOffsets[colIdx]}
                isFrozenLast={isFrozenLastArray[colIdx]}
                isIndividuallyFrozen={data.individualFrozenColIds?.includes(field.id)}
                isSelected={selectionBox ? colIdx >= selectionBox.minC && colIdx <= selectionBox.maxC && selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1 : false}
                sortDirection={sortConfig?.fieldId === field.id ? sortConfig.direction : undefined}
                filterRules={filterConfig?.filter(r => r.fieldId === field.id) || []}
                records={allRecords || data.records}
                onSelectCol={(e) => {
                   if (e.shiftKey && selectionStart) {
                      setSelectionEnd({ r: data.records.length - 1, c: colIdx });
                      setSelectionStart({ r: 0, c: selectionStart.c }); 
                   } else {
                      setSelectionStart({ r: 0, c: colIdx });
                      setSelectionEnd({ r: data.records.length - 1, c: colIdx });
                   }
                   setIsSelecting(false);
                }}
                allFields={data.fields}
                isDragged={draggedColId ? draggedColId.split(',').includes(field.id) : false}
                isDragOver={dragOverColId === field.id}
                onDragStart={(e) => handleDragStartCol(e, field.id)}
                onDragOver={(e) => {
                  if (draggedColId && !draggedColId.split(',').includes(field.id)) {
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
                  if (draggedColId && !draggedColId.split(',').includes(field.id)) {
                    const sourceIds = draggedColId.split(',');
                    onReorderFields(sourceIds.length > 1 ? sourceIds : sourceIds[0], field.id);
                  }
                  setDraggedColId(null);
                  setDragOverColId(null);
                }}
                onDragEnd={() => { setDraggedColId(null); setDragOverColId(null); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setColContextMenuState({ x: e.clientX, y: e.clientY, fieldId: field.id });
                }}
                modelSettings={modelSettings}
              />
            ))}
            <th className="bg-gray-50 border-r border-b border-gray-200 font-normal group cursor-pointer hover:bg-gray-100" style={{ width: 100, minWidth: 100, maxWidth: 100 }} onClick={onAddField}>
              <div className="flex items-center px-3 h-8 text-gray-500">
                <Plus className="w-4 h-4 mr-1" />
              </div>
            </th>
            <th className="bg-gray-50 border-b border-gray-200" style={{ width: 'auto' }}></th>
          </tr>
        </thead>
        
        {paddingTop > 0 && <tbody><tr><td colSpan={visibleFields.length + 2} style={{ height: paddingTop, padding: 0, border: 0, lineHeight: 0, fontSize: 0 }} /></tr></tbody>}
        {virtualItems.map((virtualRow) => {
             const index = visibleRowsInfo.indices[virtualRow.index];
             const record = data.records[index];
             const groupHeadersToRender: any[] = [];
             let isRowHidden = visibleRowsInfo.cacheMap.get(index)?.isRowHidden || false;
             let hiddenByLevel = -1;

             if (groupConfig && groupConfig.length > 0) {
                 let changedLevel = -1;
                 for (let level = 0; level < groupConfig.length; level++) {
                     const fieldId = groupConfig[level].fieldId;
                     const prevRecord = index > 0 ? data.records[index - 1] : null;
                     let val1 = prevRecord ? JSON.stringify(prevRecord[fieldId]) : null;
                     let val2 = JSON.stringify(record[fieldId]);
                     
                     if (changedLevel !== -1 || val1 !== val2) {
                         if (changedLevel === -1) changedLevel = level;
                     }

                     let key = '';
                     for (let i = 0; i <= level; i++) {
                         key += String(groupConfig[i].fieldId) + ':' + JSON.stringify(record[groupConfig[i].fieldId]) + '|';
                     }

                     if (changedLevel !== -1 && changedLevel <= level) {
                         // Render this header if an ancestor hasn't folded it
                         if (hiddenByLevel === -1 || level <= hiddenByLevel) {
                             const field = data.fields.find(f => f.id === fieldId);
                             groupHeadersToRender.push({ level, field, value: record[fieldId], groupKey: key });
                         }
                     }

                     if (foldedGroups?.includes(key)) {
                         isRowHidden = true;
                         if (hiddenByLevel === -1) hiddenByLevel = level;
                     }
                 }
             }

             return (
              <tbody key={record.id} data-index={virtualRow.index} className="text-[13px]">
                 {groupHeadersToRender.map((gh) => {
                    const isFolded = foldedGroups?.includes(gh.groupKey);
                    
                    let displayValue = gh.value;
                    if ((gh.field?.type === 'singleSelect' || gh.field?.type === 'multiSelect') && gh.field?.options) {
                      if (Array.isArray(gh.value)) {
                         displayValue = gh.value.map((v: any) => gh.field.options?.find((o: any) => o.id === v || o.name === v)?.name || v).join(', ');
                      } else {
                         displayValue = gh.field.options.find((o: any) => o.id === gh.value || o.name === gh.value)?.name || gh.value;
                      }
                    }

                    return (
                    <tr key={`gh-${record.id}-${gh.level}`} className="bg-gray-50 border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => {
                        const next = new Set(foldedGroups || []);
                        if (isFolded) next.delete(gh.groupKey);
                        else next.add(gh.groupKey);
                        onFoldedGroupsChange?.(Array.from(next));
                    }}>
                      <td colSpan={visibleFields.length + 2} className="p-0 select-none border-b border-gray-200">
                        <div className="sticky left-0 flex items-center h-[35px] text-[13px] font-medium text-gray-800 w-fit" style={{ paddingLeft: `${gh.level * 24 + 16}px` }}>
                          <ChevronDown className={`w-4 h-4 mr-1.5 text-gray-500 transition-transform ${isFolded ? '-rotate-90' : ''}`} />
                          <span className="text-gray-500 mr-1.5">{gh.field?.name}:</span>
                          <span>{displayValue == null || displayValue === '' || (Array.isArray(displayValue) && displayValue.length === 0) ? (lang === 'en' ? '(Empty)' : '(空)') : String(displayValue)}</span>
                        </div>
                      </td>
                    </tr>
                    );
                 })}
                 {!isRowHidden && (
                 <tr 
                   className={cn(
                     "group transition-colors",
                draggedRowId === record.id ? "opacity-50 bg-gray-100" : "",
                dragOverRowId === record.id ? "[&>td]:shadow-[inset_0_2px_0_#3b82f6]" : ""
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
                className="sticky left-0 bg-white group-hover:bg-gray-50 border-r border-b border-gray-200 text-center text-gray-400 w-16 z-[35] transition-colors p-0 select-none cursor-grab active:cursor-grabbing relative"
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
                      if (e.shiftKey && lastSelectedRowIndex !== null && lastSelectedRowIndex !== index) {
                         const start = Math.min(lastSelectedRowIndex, index);
                         const end = Math.max(lastSelectedRowIndex, index);
                         for (let i = start; i <= end; i++) {
                             if (data.records[i]) {
                                 newSet.add(data.records[i].id);
                             }
                         }
                      } else {
                         if (newSet.has(record.id)) newSet.delete(record.id);
                         else newSet.add(record.id);
                         setLastSelectedRowIndex(index);
                      }
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
                      setContextMenuState({ x: e.clientX, y: e.clientY, recordId: record.id });
                      setInsertRowCount(Math.max(sel.size, 1));
                    }}
                  >
                    <span className={cn("group-hover:hidden", selectedRecordIds.has(record.id) || runningWorkflowRows.has(record.id) ? 'hidden' : '')}>{index + 1}</span>
                    {runningWorkflowRows.has(record.id) && !selectedRecordIds.has(record.id) && (
                       <Loader2 className="w-4 h-4 text-purple-500 animate-spin group-hover:hidden" />
                    )}
                    <div className={cn("items-center justify-center space-x-1 hidden group-hover:flex", (selectedRecordIds.has(record.id) || runningWorkflowRows.has(record.id)) ? '!flex' : '')}>
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
              {visibleFields.map((field, colIdx) => {
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
                    searchQuery={searchQuery}
                    isSearchMatch={searchMatchSet.has(`${record.id}-${field.id}`)}
                    isSearchMatchActive={activeSearchMatch?.recordId === record.id && activeSearchMatch?.fieldId === field.id}
                    isActive={activeCell?.recordId === record.id && activeCell?.fieldId === field.id}
                    forceEdit={forceEdit && activeCell?.recordId === record.id && activeCell?.fieldId === field.id}
                    isGeneratingCol={generatingCells.has(`${record.id}-${field.id}`)}
                    frozenLeftOffset={frozenLeftOffsets[colIdx]}
                    isFrozenLast={isFrozenLastArray[colIdx]}
                    onActivate={() => { setActiveCell({ recordId: record.id, fieldId: field.id }); setForceEdit(false); }}
                    onChange={(val) => onUpdateRecord(record.id, field.id, val)}
                    onBlur={() => { setActiveCell(null); setForceEdit(false); }}
                    onPreviewImage={setPreviewImage}
                    allFields={data.fields}
                    modelSettings={modelSettings}
                    heightClass={heightClass}
                    lang={lang}
                    globalAttachmentPropsMap={globalAttachmentPropsMap}
                    isLinked={!!data.cellLinks?.[`${record.id}-${field.id}`]}
                    isLinkedTop={!!data.cellLinks?.[`${record.id}-${field.id}`] && (index === 0 || data.cellLinks?.[`${data.records[index - 1].id}-${field.id}`] !== data.cellLinks?.[`${record.id}-${field.id}`])}
                    isLinkedBottom={!!data.cellLinks?.[`${record.id}-${field.id}`] && (index === data.records.length - 1 || data.cellLinks?.[`${data.records[index + 1].id}-${field.id}`] !== data.cellLinks?.[`${record.id}-${field.id}`])}
                    onUpdateField={(updates) => onUpdateField(field.id, updates)}
                    isSelectedBox={isSelectedBox}
                    isCutBox={isCutBox}
                    onBatchAIGenerate={() => {
                        let targetRecordIds = [record.id];
                        const { selectionBox: currentSelectionBox, extraSelectedCells: currentExtra } = gridStateRef.current;
                        if (currentSelectionBox || currentExtra.length > 0) {
                            const selectedRecordIds = new Set<string>();
                            if (currentSelectionBox) {
                                for(let r = currentSelectionBox.minR; r <= currentSelectionBox.maxR; r++) {
                                     if (colIdx >= currentSelectionBox.minC && colIdx <= currentSelectionBox.maxC) {
                                         selectedRecordIds.add(data.records[r].id);
                                     }
                                }
                            }
                            currentExtra.forEach(cell => {
                                if (cell.c === colIdx) selectedRecordIds.add(data.records[cell.r].id);
                            });
                            
                            if (selectedRecordIds.has(record.id)) {
                                targetRecordIds = Array.from(selectedRecordIds);
                            }
                        }
                        handleGenerateColumn(field, targetRecordIds);
                    }}
                    onMouseDown={(e: React.MouseEvent) => {
                       if (e.button === 2) return; // Ignore right-clicks, handled by onContextMenu

                       const { selectionStart: currentStart } = gridStateRef.current;
                       if (e.shiftKey && currentStart) {
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
                       if (gridStateRef.current.isSelecting) {
                          setSelectionEnd({ r: index, c: colIdx });
                       }
                    }}
                    onContextMenu={(e: React.MouseEvent) => {
                       e.preventDefault();
                       // If clicking outside current selection, set this cell as the only selected cell
                       if (!isSelectedBox) {
                          setIsSelecting(true);
                          setSelectionStart({ r: index, c: colIdx });
                          setSelectionEnd({ r: index, c: colIdx });
                          setExtraSelectedCells([]);
                       }
                       setCellContextMenuState({ x: e.clientX, y: e.clientY });
                    }}
                    onActivateNextRow={() => {
                       if (index < data.records.length - 1) {
                          setActiveCell({ recordId: data.records[index + 1].id, fieldId: field.id });
                          setForceEdit(true);
                       }
                    }}
                    recordPosition={Math.max(1, visibleRowsInfo.indices.indexOf(index) + 1)}
                    recordCount={visibleRowsInfo.indices.length}
                    largeTextOpenRequest={largeTextOpenRequest?.recordId === record.id && largeTextOpenRequest?.fieldId === field.id ? largeTextOpenRequest : undefined}
                    onConsumeLargeTextOpenRequest={() => setLargeTextOpenRequest(null)}
                    onNavigateLargeTextRow={(direction, currentValue, temporaryReferenceFieldId) => {
                       const currentVisiblePosition = visibleRowsInfo.indices.indexOf(index);
                       if (currentVisiblePosition < 0) return;
                       const nextVisiblePosition = currentVisiblePosition + direction;
                       if (nextVisiblePosition < 0 || nextVisiblePosition >= visibleRowsInfo.indices.length) return;
                       const nextDataIndex = visibleRowsInfo.indices[nextVisiblePosition];
                       const nextRecord = data.records[nextDataIndex];
                       if (!nextRecord) return;

                       onUpdateRecord(record.id, field.id, currentValue);
                       setActiveCell({ recordId: nextRecord.id, fieldId: field.id });
                       setForceEdit(false);
                       setLargeTextOpenRequest({ recordId: nextRecord.id, fieldId: field.id, temporaryReferenceFieldId });
                       rowVirtualizer.scrollToIndex(nextVisiblePosition, { align: 'auto' });
                    }}
                  />
                );
              })}
              <td className="border-b border-gray-200"></td>
              <td className="border-b border-gray-200"></td>
            </tr>
            )}
            </tbody>
            );
          })}
          {paddingBottom > 0 && <tbody><tr><td colSpan={visibleFields.length + 2} style={{ height: paddingBottom, padding: 0, border: 0, lineHeight: 0, fontSize: 0 }} /></tr></tbody>}
          {/* Add New Row Button */}
          <tbody>
          <tr>
            <td className="sticky left-0 bg-white group-hover:bg-gray-50 border-r border-b border-gray-200 text-center text-gray-400 z-[35] p-0 select-none transition-colors" style={{ width: 64, minWidth: 64, maxWidth: 64 }}>
              <div className={cn("flex items-center justify-center font-bold text-lg", heightClass)}>+</div>
            </td>
            <td colSpan={visibleFields.length + 2} className="border-b border-gray-200 bg-white hover:bg-gray-50 cursor-pointer transition-colors p-0" onClick={onAddRecord}>
              <div className={cn("flex items-center px-4 text-gray-500 hover:text-gray-700", heightClass)}>
                 {lang === 'en' ? "Tap to add a new record" : "点击添加新记录"}
              </div>
            </td>
          </tr>
          </tbody>
        
      </table>
      )}

      {previewImageState && previewImageState.items.length > 0 && (
          <ZoomableImage 
             item={previewImageState.items[previewImageState.currentIndex]}
             onPrev={(e) => { e.stopPropagation(); handlePreviewPrev(); }}
             onNext={(e) => { e.stopPropagation(); handlePreviewNext(); }}
             onClose={() => setPreviewImageState(null)}
             username={username}
             lang={lang}
             sourceViewMode={previewImageState.sourceViewMode}
             itemInstanceKey={previewImageState.currentIndex}
             onUpdateItem={(newItem) => {
                const newItems = [...previewImageState.items];
                newItems[previewImageState.currentIndex] = newItem;
                setPreviewImageState({ ...previewImageState, items: newItems });
                if (previewImageState.onUpdate) {
                   const cleanedItems = newItems.map(stripPreviewOnlyProps);
                   previewImageState.onUpdate(cleanedItems);
                }
                if (onUpdateGlobalAttachment) {
                   const updatedProps = pickGlobalReviewProps(newItem);
                   if (newItem.url && Object.keys(updatedProps).length > 0) {
                       onUpdateGlobalAttachment(newItem.url, updatedProps);
                   }
                }
             }}
          />
      )}

      {contextMenuState && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenuState(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenuState(null); }}></div>
          <div 
             className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[150px] text-sm text-gray-700"
             style={{
                ...(contextMenuState.y + 160 > window.innerHeight ? { bottom: window.innerHeight - contextMenuState.y, top: 'auto' } : { top: contextMenuState.y }),
                ...(typeof window !== 'undefined' && contextMenuState.x + 220 > window.innerWidth ? { right: Math.max(10, window.innerWidth - contextMenuState.x), left: 'auto' } : { left: Math.max(10, contextMenuState.x) })
             }}
          >
             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between"
                onClick={() => {
                   if (contextMenuState.recordId && onInsertRecords) {
                      const idx = data.records.findIndex(r => r.id === contextMenuState.recordId);
                      if (idx >= 0) onInsertRecords(idx, insertRowCount);
                   }
                   setContextMenuState(null);
                }}
             >
                <div className="flex items-center">
                   <span className="mr-2 text-lg leading-none">↑</span>
                   {lang === 'en' ? 'Insert above' : '向上插入'}
                </div>
                <div className="flex items-center ml-4" onClick={(e) => e.stopPropagation()}>
                   <input 
                      type="number" min="1" 
                      className="w-12 text-center border border-gray-300 rounded mx-2 py-0.5" 
                      value={insertRowCount}
                      onChange={(e) => setInsertRowCount(Math.max(1, parseInt(e.target.value) || 1))}
                   />
                   {lang === 'en' ? 'row(s)' : '行'}
                </div>
             </button>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between"
                onClick={() => {
                   if (contextMenuState.recordId && onInsertRecords) {
                      const idx = data.records.findIndex(r => r.id === contextMenuState.recordId);
                      if (idx >= 0) onInsertRecords(idx + 1, insertRowCount);
                   }
                   setContextMenuState(null);
                }}
             >
                <div className="flex items-center">
                   <span className="mr-2 text-lg leading-none">↓</span>
                   {lang === 'en' ? 'Insert below' : '向下插入'}
                </div>
                <div className="flex items-center ml-4" onClick={(e) => e.stopPropagation()}>
                   <input 
                      type="number" min="1" 
                      className="w-12 text-center border border-gray-300 rounded mx-2 py-0.5" 
                      value={insertRowCount}
                      onChange={(e) => setInsertRowCount(Math.max(1, parseInt(e.target.value) || 1))}
                   />
                   {lang === 'en' ? 'row(s)' : '行'}
                </div>
             </button>
             <div className="border-t border-gray-100 my-1"></div>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-purple-50 text-purple-600 transition-colors flex items-center"
                onClick={() => {
                   const idsObj = Array.from(selectedRecordIds).length > 0 ? Array.from(selectedRecordIds) : [contextMenuState.recordId!];
                   handleRunWorkflow(idsObj);
                   setContextMenuState(null);
                }}
             >
                <Sparkles className="w-4 h-4 mr-2" /> 
                {lang === 'en' ? `Run Workflow (${Math.max(selectedRecordIds.size, 1)})` : `运行智能生成 (${Math.max(selectedRecordIds.size, 1)})`}
             </button>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 transition-colors flex items-center"
                onClick={() => {
                   onDeleteRecords?.(Array.from(selectedRecordIds).length > 0 ? Array.from(selectedRecordIds) : [contextMenuState.recordId!]);
                   setSelectedRecordIds(new Set());
                   setContextMenuState(null);
                }}
             >
                <Trash2 className="w-4 h-4 mr-2" /> 
                {lang === 'en' ? `Delete ${Math.max(selectedRecordIds.size, 1)} row(s)` : `删除 ${Math.max(selectedRecordIds.size, 1)} 行`}
             </button>
          </div>
        </>
      )}

      {colContextMenuState && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setColContextMenuState(null)} onContextMenu={(e) => { e.preventDefault(); setColContextMenuState(null); }}></div>
          <div 
             className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[150px] whitespace-nowrap text-sm text-gray-700 w-max"
             style={{
                ...(colContextMenuState.y + 280 > window.innerHeight ? { bottom: window.innerHeight - colContextMenuState.y, top: 'auto' } : { top: colContextMenuState.y }),
                ...(typeof window !== 'undefined' && colContextMenuState.x + 260 > window.innerWidth ? { right: Math.max(10, window.innerWidth - colContextMenuState.x), left: 'auto' } : { left: Math.max(10, colContextMenuState.x) })
             }}
          >
             <div 
                className="relative w-full group/color"
                onMouseEnter={() => setShowColColorMenu(true)}
                onMouseLeave={() => setShowColColorMenu(false)}
             >
                <button className="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors flex items-center justify-between">
                   <div className="flex items-center">
                      <Palette className="w-4 h-4 mr-2" />
                      {lang === 'en' ? 'Set field title color' : '设置字段标题颜色'}
                   </div>
                   <ChevronRight className="w-4 h-4 text-gray-400 ml-4" />
                </button>
                {showColColorMenu && (
                   <div className={cn("absolute top-0 w-max bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-50 cursor-auto", (typeof window !== 'undefined' && colContextMenuState.x > window.innerWidth / 2) ? "right-full mr-1" : "left-full ml-1")} onClick={(e) => e.stopPropagation()}>
                      <button 
                         className="flex items-center w-full px-2 py-1.5 hover:bg-gray-100 rounded text-sm text-gray-700 transition-colors mb-3"
                         onClick={() => {
                            if (colContextMenuState.fieldId && onUpdateField) {
                               onUpdateField(colContextMenuState.fieldId, { color: undefined });
                            }
                            setColContextMenuState(null);
                            setShowColColorMenu(false);
                         }}
                      >
                         <div className="w-4 h-4 border border-red-500 rounded-sm mr-2 flex items-center justify-center bg-white overflow-hidden relative">
                           <div className="absolute w-[18px] border-b border-red-500 -rotate-45" />
                         </div>
                         {lang === 'en' ? 'No fill color' : '无填充颜色'}
                      </button>
                      <div className="flex flex-col gap-1.5">
                         {FIELD_COLORS.map((row, i) => (
                           <div key={i} className="flex justify-between gap-1">
                             {row.map(color => {
                               const currentField = data.fields.find(f => f.id === colContextMenuState.fieldId);
                               const isActive = currentField?.color === color;
                               return (
                                 <button 
                                   key={color}
                                   className={cn("w-5 h-5 rounded-sm hover:scale-110 transition-all", isActive ? "ring-2 ring-blue-500 ring-offset-1 scale-110 border-white border z-10" : "shadow-sm")}
                                   style={{ backgroundColor: color }}
                                   onClick={() => {
                                      if (colContextMenuState.fieldId && onUpdateField) {
                                         onUpdateField(colContextMenuState.fieldId, { color });
                                      }
                                      setColContextMenuState(null);
                                      setShowColColorMenu(false);
                                   }}
                                 />
                               );
                             })}
                           </div>
                         ))}
                      </div>
                   </div>
                )}
             </div>
             <div className="border-t border-gray-100 my-1"></div>
             
             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between"
                onClick={() => {
                   if (colContextMenuState.fieldId && onInsertField) {
                      const idx = data.fields.findIndex(f => f.id === colContextMenuState.fieldId);
                      if (idx >= 0) onInsertField(idx, insertColCount);
                   }
                   setColContextMenuState(null);
                }}
             >
                <div className="flex items-center">
                   <span className="mr-2 text-lg leading-none">←</span>
                   {lang === 'en' ? 'Insert left' : '向左插入'}
                </div>
                <div className="flex items-center ml-4" onClick={(e) => e.stopPropagation()}>
                   <input 
                      type="number" min="1" 
                      className="w-12 text-center border border-gray-300 rounded mx-2 py-0.5" 
                      value={insertColCount}
                      onChange={(e) => setInsertColCount(Math.max(1, parseInt(e.target.value) || 1))}
                   />
                   {lang === 'en' ? 'col(s)' : '列'}
                </div>
             </button>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between"
                onClick={() => {
                   if (colContextMenuState.fieldId && onInsertField) {
                      const idx = data.fields.findIndex(f => f.id === colContextMenuState.fieldId);
                      if (idx >= 0) onInsertField(idx + 1, insertColCount);
                   }
                   setColContextMenuState(null);
                }}
             >
                <div className="flex items-center">
                   <span className="mr-2 text-lg leading-none">→</span>
                   {lang === 'en' ? 'Insert right' : '向右插入'}
                </div>
                <div className="flex items-center ml-4" onClick={(e) => e.stopPropagation()}>
                   <input 
                      type="number" min="1" 
                      className="w-12 text-center border border-gray-300 rounded mx-2 py-0.5" 
                      value={insertColCount}
                      onChange={(e) => setInsertColCount(Math.max(1, parseInt(e.target.value) || 1))}
                   />
                   {lang === 'en' ? 'col(s)' : '列'}
                </div>
             </button>
             {onFreezeColumn && (
                <button 
                   className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center"
                   onClick={() => {
                      if (data.frozenColId === colContextMenuState.fieldId) {
                         onFreezeColumn(null); // Unfreeze
                      } else {
                         onFreezeColumn(colContextMenuState.fieldId || null);
                      }
                      setColContextMenuState(null);
                   }}
                >
                   {data.frozenColId === colContextMenuState.fieldId 
                     ? (lang === 'en' ? 'Unfreeze column' : '取消冻结') 
                     : (lang === 'en' ? 'Freeze up to this column' : '冻结至此列')
                   }
                </button>
             )}
             {onIndividualFreezeColumn && (
                <button 
                   className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center"
                   onClick={() => {
                      onIndividualFreezeColumn(colContextMenuState.fieldId || '');
                      setColContextMenuState(null);
                   }}
                >
                   {data.individualFrozenColIds?.includes(colContextMenuState.fieldId || '')
                     ? (lang === 'en' ? 'Unfreeze individually' : '取消单独冻结')
                     : (lang === 'en' ? 'Freeze individually' : '单独冻结此列')
                   }
                </button>
             )}
             <div className="border-t border-gray-100 my-1"></div>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center"
                onClick={() => {
                   if (colContextMenuState.fieldId && onDuplicateField) {
                      onDuplicateField(colContextMenuState.fieldId);
                   }
                   setColContextMenuState(null);
                }}
             >
                <Copy className="w-4 h-4 mr-2" />
                {lang === 'en' ? 'Duplicate field' : '复制字段'}
             </button>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center"
                onClick={() => {
                   if (colContextMenuState.fieldId) {
                      const field = data.fields.find(f => f.id === colContextMenuState.fieldId);
                      if (field) {
                         const attr = {
                            type: field.type,
                            options: field.options,
                            prompt: field.prompt,
                            refFields: field.refFields,
                            aiTextConfig: field.aiTextConfig,
                            aiImageConfig: field.aiImageConfig,
                            aiVideoConfig: field.aiVideoConfig,
                            color: field.color
                         };
                         const str = JSON.stringify(attr);
                         localStorage.setItem('copiedFieldAttr', str);
                         setCopiedFieldAttrStr(str);
                      }
                   }
                   setColContextMenuState(null);
                }}
             >
                <ClipboardCopy className="w-4 h-4 mr-2" />
                {lang === 'en' ? 'Copy field properties' : '复制字段属性'}
             </button>
             <button 
                className={cn("w-full text-left px-4 py-2 transition-colors flex items-center", copiedFieldAttrStr ? "hover:bg-blue-50" : "opacity-30 cursor-not-allowed")}
                onClick={() => {
                   if (!copiedFieldAttrStr) return;
                   if (colContextMenuState.fieldId && onUpdateField) {
                      try {
                         const attr = JSON.parse(copiedFieldAttrStr);
                         onUpdateField(colContextMenuState.fieldId, attr);
                      } catch (e) {}
                   }
                   setColContextMenuState(null);
                }}
                disabled={!copiedFieldAttrStr}
             >
                <ClipboardPaste className="w-4 h-4 mr-2" />
                {lang === 'en' ? 'Paste field properties' : '粘贴字段属性'}
             </button>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center"
                onClick={() => {
                   if (colContextMenuState.fieldId && onUpdateField) {
                      let idsToHide = [colContextMenuState.fieldId];
                      if (selectionBox && selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1) {
                         const selectedIds = [];
                         let isIdInSelection = false;
                         for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                            const fieldId = visibleFields[c].id;
                            selectedIds.push(fieldId);
                            if (fieldId === colContextMenuState.fieldId) isIdInSelection = true;
                         }
                         if (isIdInSelection && selectedIds.length > 1) {
                            idsToHide = selectedIds;
                         }
                      }
                      idsToHide.forEach(id => onUpdateField(id, { hidden: true }));
                   }
                   setColContextMenuState(null);
                }}
             >
                <EyeOff className="w-4 h-4 mr-2" />
                {lang === 'en' ? 'Hide field' : '隐藏字段'}
             </button>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 transition-colors flex items-center"
                onClick={() => {
                   if (colContextMenuState.fieldId && onDeleteField) {
                      let idsToDelete = [colContextMenuState.fieldId];
                      if (selectionBox && selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1) {
                         const selectedIds = [];
                         let isIdInSelection = false;
                         for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                            const fieldId = visibleFields[c].id;
                            selectedIds.push(fieldId);
                            if (fieldId === colContextMenuState.fieldId) isIdInSelection = true;
                         }
                         if (isIdInSelection && selectedIds.length > 1) {
                            idsToDelete = selectedIds;
                         }
                      }
                      idsToDelete.forEach(id => onDeleteField(id));
                      setSelectionStart(null);
                      setSelectionEnd(null);
                   }
                   setColContextMenuState(null);
                }}
             >
                <Trash2 className="w-4 h-4 mr-2" /> 
                {lang === 'en' ? 'Delete column' : '删除列'}
             </button>
          </div>
        </>
      )}

      {cellContextMenuState && (() => {
        const isVerticalSelection = selectionBox && selectionBox.maxR > selectionBox.minR && selectionBox.minC === selectionBox.maxC && extraSelectedCells.length === 0;
        
        let hasAnyLink = false;
        const allSelectedCellsList = [];
        if (selectionBox) {
            for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
                for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                    allSelectedCellsList.push({r, c});
                }
            }
        }
        extraSelectedCells.forEach(cell => allSelectedCellsList.push(cell));

        if (allSelectedCellsList.length === 0 && activeCell) {
            const r = data.records.findIndex(rec => rec.id === activeCell.recordId);
            const c = visibleFields.findIndex(f => f.id === activeCell.fieldId);
            if (r >= 0 && c >= 0) allSelectedCellsList.push({r, c});
        }

        for (const cell of allSelectedCellsList) {
            const recordId = data.records[cell.r]?.id;
            const fieldId = visibleFields[cell.c]?.id;
            if (recordId && fieldId && data.cellLinks?.[`${recordId}-${fieldId}`]) {
                hasAnyLink = true;
                break;
            }
        }
        
        return (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCellContextMenuState(null)} onContextMenu={(e) => { e.preventDefault(); setCellContextMenuState(null); }}></div>
          <div 
             className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[200px] text-sm text-gray-700"
             style={{
                ...(cellContextMenuState.y + 200 > window.innerHeight ? { bottom: window.innerHeight - cellContextMenuState.y, top: 'auto' } : { top: cellContextMenuState.y }),
                ...(typeof window !== 'undefined' && cellContextMenuState.x + 220 > window.innerWidth ? { right: Math.max(10, window.innerWidth - cellContextMenuState.x), left: 'auto' } : { left: Math.max(10, cellContextMenuState.x) })
             }}
          >
             {isVerticalSelection && onUpdateCellLinks && (
                <button 
                   className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between pointer-events-auto text-blue-600 hover:text-blue-700 border-b border-gray-100"
                   onClick={() => {
                      const newLinks = { ...(data.cellLinks || {}) };
                      const groupId = `group_${Date.now()}`;
                      const updates = [];
                      const fieldId = visibleFields[selectionBox!.minC]?.id;
                      const masterValue = data.records[selectionBox!.minR][fieldId];
                      
                      for (let r = selectionBox!.minR; r <= selectionBox!.maxR; r++) {
                          const recordId = data.records[r]?.id;
                          if (recordId && fieldId) {
                             newLinks[`${recordId}-${fieldId}`] = groupId;
                             if (r > selectionBox!.minR) {
                               updates.push({ recordId, fieldId, value: masterValue });
                             }
                          }
                      }
                      onUpdateCellLinks(newLinks);
                      if (updates.length > 0 && onUpdateRecordsBatch) {
                        onUpdateRecordsBatch(updates);
                      }
                      setCellContextMenuState(null);
                   }}
                >
                   <div className="flex items-center">
                      <Link className="w-4 h-4 mr-2" />
                      {lang === 'en' ? 'Link cells' : '联动所选单元格'}
                   </div>
                </button>
             )}
             
             {hasAnyLink && onUpdateCellLinks && (
                <button 
                   className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between pointer-events-auto text-blue-600 hover:text-blue-700 border-b border-gray-100"
                   onClick={() => {
                      const newLinks = { ...(data.cellLinks || {}) };
                      for (const cell of allSelectedCellsList) {
                          const recordId = data.records[cell.r]?.id;
                          const fieldId = visibleFields[cell.c]?.id;
                          if (recordId && fieldId) {
                             delete newLinks[`${recordId}-${fieldId}`];
                          }
                      }
                      onUpdateCellLinks(newLinks);
                      setCellContextMenuState(null);
                   }}
                >
                   <div className="flex items-center">
                      <Unlink className="w-4 h-4 mr-2" />
                      {lang === 'en' ? 'Unlink cells' : '取消联动'}
                   </div>
                </button>
             )}

             <button 
                className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between pointer-events-auto text-blue-600 hover:text-blue-700 border-b border-gray-100"
                onClick={() => {
                   const allSelectedCells = new Set<string>();
                   if (selectionBox) {
                      for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
                         for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                            allSelectedCells.add(`${r},${c}`);
                         }
                      }
                   }
                   extraSelectedCells.forEach(cell => allSelectedCells.add(`${cell.r},${cell.c}`));
                   
                   if (allSelectedCells.size === 0 && activeCell) {
                      const r = data.records.findIndex(rec => rec.id === activeCell.recordId);
                      const c = visibleFields.findIndex(f => f.id === activeCell.fieldId);
                      if (r >= 0 && c >= 0) {
                         allSelectedCells.add(`${r},${c}`);
                      }
                   }

                   if (allSelectedCells.size === 0) {
                      setCellContextMenuState(null);
                      return;
                   }

                   setShowBatchDownloadDialog(allSelectedCells);
                   setCellContextMenuState(null);
                }}
             >
                <div className="flex items-center">
                   <Download className="w-4 h-4 mr-2" />
                   {lang === 'en' ? 'Batch Export Attachments' : '批量打包/导出附件'}
                </div>
             </button>
             <button 
                className="w-full text-left px-4 py-2 hover:bg-red-50 transition-colors flex items-center justify-between pointer-events-auto text-red-600 hover:text-red-700"
                onClick={() => {
                   const allSelectedCells = new Set<string>();
                   if (selectionBox) {
                      for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
                         for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                            allSelectedCells.add(`${r},${c}`);
                         }
                      }
                   }
                   extraSelectedCells.forEach(cell => allSelectedCells.add(`${cell.r},${cell.c}`));
                   
                   if (allSelectedCells.size === 0 && activeCell) {
                      const r = data.records.findIndex(rec => rec.id === activeCell.recordId);
                      const c = visibleFields.findIndex(f => f.id === activeCell.fieldId);
                      if (r >= 0 && c >= 0) {
                         allSelectedCells.add(`${r},${c}`);
                      }
                   }

                   if (allSelectedCells.size === 0) {
                      setCellContextMenuState(null);
                      return;
                   }

                   setShowClearAnnotationsConfirm(true);
                   setCellContextMenuState(null);
                }}
             >
                <div className="flex items-center">
                   <Trash2 className="w-4 h-4 mr-2" />
                   {lang === 'en' ? 'Clear Revisions' : '清除全部标注'}
                </div>
             </button>
          </div>
        </>
      ) })()}

      {showBatchDownloadDialog && (
         <BatchDownloadPopup
            selectedCells={showBatchDownloadDialog}
            data={data}
            visibleFields={visibleFields}
            lang={lang}
            onClose={() => setShowBatchDownloadDialog(null)}
            triggerDownload={triggerDownload}
            globalAttachmentPropsMap={globalAttachmentPropsMap}
         />
      )}

      {showClearAnnotationsConfirm && createPortal(
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">{lang === 'en' ? 'Clear Revisions' : '清除全部标注'}</h2>
            <p className="text-gray-600 mb-6">{lang === 'en' ? 'Are you sure you want to clear all markings for the selected cells?' : '确定要清除所选单元格的全部标注吗？'}</p>
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setShowClearAnnotationsConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button 
                onClick={() => {
                   const allSelectedCells = new Set<string>();
                   if (selectionBox) {
                      for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
                         for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                            allSelectedCells.add(`${r},${c}`);
                         }
                      }
                   }
                   extraSelectedCells.forEach(cell => allSelectedCells.add(`${cell.r},${cell.c}`));
                   
                   if (allSelectedCells.size === 0 && activeCell) {
                      const r = data.records.findIndex(rec => rec.id === activeCell.recordId);
                      const c = visibleFields.findIndex(f => f.id === activeCell.fieldId);
                      if (r >= 0 && c >= 0) {
                         allSelectedCells.add(`${r},${c}`);
                      }
                   }

                   const selectedArr = Array.from(allSelectedCells).map(s => { const [r, c] = s.split(','); return { r: parseInt(r), c: parseInt(c) }; });
                   
                   const uniqueImageUrls = new Set<string>();

                   selectedArr.forEach(({r, c}) => {
                      const record = data.records[r];
                      const field = visibleFields[c];
                      if (!record || !field) return;
                      const val = record[field.id];
                      
                      if ((field.type === 'aiImage' || field.type === 'aiVideo' || field.type === 'attachment') && val) {
                         let items: any[] = [];
                         if (Array.isArray(val)) items = val;
                         else if (typeof val === 'string' && val.trim() !== '') items = val.split(',').map(s => ({ url: s.trim() }));
                         else if (typeof val === 'object' && val !== null) items = [val];
                         
                         items.forEach(i => {
                             const u = typeof i === 'string' ? i : i.url;
                             if (u) uniqueImageUrls.add(u);
                         });
                      }
                   });
                   
                   if (onUpdateGlobalAttachment) {
                        Array.from(uniqueImageUrls).forEach(url => {
                            onUpdateGlobalAttachment(url, { annotations: undefined, status: 'unannotated', rating: 0 });
                        });
                   }

                   setShowClearAnnotationsConfirm(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                {lang === 'en' ? 'Confirm' : '确定'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

interface HeaderCellProps {
  key?: React.Key;
  field: Field;
  colIdx: number;
  totalCols: number;
  onRename: (name: string) => void;
  onChangeType: (type: FieldType) => void;
  onResize: (width: number) => void;
  onUpdateField: (updates: Partial<Field>) => void;
  onGenerateColumn: () => void;
  onDeleteField: () => void;
  onSortField: (dir: 'asc'|'desc'|null) => void;
  onFilterField: (operator: string, value: any) => void;
  sortDirection?: 'asc' | 'desc';
  filterRules?: any[];
  records: BaseRecord[];
  onSelectCol: (e: React.MouseEvent) => void;
  allFields: Field[];
  isDragged: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  frozenLeftOffset?: number;
  isFrozenLast?: boolean;
  isIndividuallyFrozen?: boolean;
  isSelected?: boolean;
  modelSettings: any;
  lang?: 'en' | 'zh';
  globalAttachmentPropsMap?: Map<string, AttachmentReviewProps>;
}

const FIELD_COLORS = [
  ['#f1f5f9', '#dbeafe', '#e0f2fe', '#ccfbf1', '#dcfce3', '#fef3c7', '#ffedd5', '#fee2e2', '#fce7f3', '#f3e8ff'],
  ['#e2e8f0', '#bfdbfe', '#bae6fd', '#99f6e4', '#bbf7d0', '#fde68a', '#fed7aa', '#fecaca', '#fbcfe8', '#e9d5ff'],
  ['#94a3b8', '#60a5fa', '#38bdf8', '#2dd4bf', '#4ade80', '#facc15', '#fb923c', '#f87171', '#f472b6', '#c084fc'],
  ['#475569', '#3b82f6', '#0ea5e9', '#0d9488', '#16a34a', '#eab308', '#f59e0b', '#dc2626', '#db2777', '#a855f7'],
  ['#1e293b', '#2563eb', '#0284c7', '#0f766e', '#15803d', '#ca8a04', '#d97706', '#b91c1c', '#be185d', '#7e22ce']
];

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
  { type: 'rating', label: 'Rating', labelZh: '评分' },
  { type: 'aiText', label: 'Smart Text', labelZh: '智能文本' },
  { type: 'aiImage', label: 'AI Image', labelZh: '智能图片' },
  { type: 'aiVideo', label: 'AI Video', labelZh: '智能视频' },
];

function HeaderCell({ 
  field, colIdx, totalCols, onRename, onChangeType, onResize, onUpdateField, onGenerateColumn, onDeleteField, onSortField, onFilterField, sortDirection, filterRules, records, onSelectCol, allFields,
  isDragged, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onContextMenu, frozenLeftOffset, isFrozenLast, isIndividuallyFrozen, isSelected, modelSettings, lang = 'zh'
}: HeaderCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [colFilterSearch, setColFilterSearch] = useState('');
  const [isTypeExpanded, setIsTypeExpanded] = useState(true);
  
  const { distinctValues, valueCounts, emptyCount } = useMemo(() => {
     if (!showActionMenu) return { distinctValues: [], valueCounts: new Map<string, number>(), emptyCount: 0 };
     const vals = new Set<string>();
     const counts = new Map<string, number>();
     let emptyCt = 0;
     records.forEach(r => {
        let aiVal = resolveFieldValueForAI(r[field.id], field, r, allFields);
        let extracted: string[] = [];
        if (Array.isArray(aiVal)) {
            extracted = aiVal.map(v => String(v?.name || v?.url || v || '')).filter(Boolean);
        } else if (typeof aiVal === 'object') {
            extracted = [JSON.stringify(aiVal)];
        } else {
            const s = String(aiVal || '').trim();
            if (s) extracted = [s];
        }

        if (extracted.length === 0) {
            emptyCt++;
        } else {
            extracted.forEach(s => {
                vals.add(s);
                counts.set(s, (counts.get(s) || 0) + 1);
            });
        }
     });
     return { distinctValues: Array.from(vals).sort(), valueCounts: counts, emptyCount: emptyCt };
  }, [showActionMenu, records, field, allFields]);

  const hasAnyRule = filterRules?.find(r => r.operator === 'has_any');
  const containsRule = filterRules?.find(r => r.operator === 'contains');
  
  const initialSelected = useMemo(() => {
     if (hasAnyRule) return new Set<string>(hasAnyRule.value);
     const all = new Set<string>(distinctValues);
     if (emptyCount > 0) all.add('__EMPTY__');
     return all;
  }, [hasAnyRule, distinctValues, emptyCount]);

  const [draftSelectedValues, setDraftSelectedValues] = useState<Set<string>>(new Set());

  const handleUpdateFilter = (newSelected: Set<string>) => {
      setDraftSelectedValues(newSelected);
      if (newSelected.size === distinctValues.length + (emptyCount > 0 ? 1 : 0) || newSelected.size === 0) {
          onFilterField('clear_all', '');
      } else {
          onFilterField('has_any', Array.from(newSelected));
      }
  };

  useEffect(() => {
      if (showActionMenu) {
          setDraftSelectedValues(initialSelected);
          setColFilterSearch('');
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showActionMenu]);

  const [draftPrompt, setDraftPrompt] = useState(field.prompt || '');
  const [draftRefs, setDraftRefs] = useState<string[]>(field.refFields || []);
  const [draftAiImageConfig, setDraftAiImageConfig] = useState(field.aiImageConfig || { count: 1, size: '1024x1024' });
  const [draftAiVideoConfig, setDraftAiVideoConfig] = useState(field.aiVideoConfig || { duration: '10', resolution: '1080P', ratio: '16:9', sound: 'false', mode: 'fast' });
  const [draftAiTextConfig, setDraftAiTextConfig] = useState(field.aiTextConfig || {});
  const [availableSkills, setAvailableSkills] = useState<any[]>([]);
  const [showPromptRefs, setShowPromptRefs] = useState(false);

  useEffect(() => {
    if (showMenu) {
      setDraftPrompt(field.prompt || '');
      setDraftRefs(field.refFields || []);
      setDraftAiImageConfig(field.aiImageConfig || { count: 1, size: '1024x1024' });
      setDraftAiTextConfig(field.aiTextConfig || {});
      setIsTypeExpanded(true);
    }
  }, [showMenu, field.prompt, field.refFields, field.aiImageConfig, field.aiTextConfig]);

  useEffect(() => {
    if (!showMenu || field.type !== 'aiText') return;
    let cancelled = false;
    const api = (window as any).electronAPI;
    if (!api?.listSkills) {
      setAvailableSkills([]);
      return;
    }
    api.listSkills()
      .then((state: any) => {
        if (!cancelled) setAvailableSkills(Array.isArray(state?.skills) ? state.skills : []);
      })
      .catch(() => {
        if (!cancelled) setAvailableSkills([]);
      });
    return () => { cancelled = true; };
  }, [showMenu, field.type]);

  const [localWidth, setLocalWidth] = useState<number | null>(null);

  const ref = useClickOutside(() => setIsEditing(false));
  const menuRef = useClickOutside(() => setShowMenu(false));
  const actionMenuRef = useClickOutside(() => setShowActionMenu(false));

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.pageX;
    const startWidth = field.width || 150;
    
    let latestWidth = startWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      requestAnimationFrame(() => {
        const diff = moveEvent.pageX - startX;
        latestWidth = Math.max(60, startWidth + diff);
        setLocalWidth(latestWidth);
      });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setLocalWidth(null);
      if (latestWidth !== startWidth) {
         onResize(latestWidth);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const currentWidth = localWidth !== null ? localWidth : (field.width || 150);

  return (
    <th 
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onContextMenu={onContextMenu}
      className={cn(
        "font-normal border-r border-b border-gray-200 relative group select-none hover:bg-gray-100 transition-colors z-40",
        isSelected ? "bg-blue-100 text-blue-900" : "bg-gray-50 text-gray-700",
        isDragged ? "opacity-50 bg-gray-200" : "",
        isDragOver ? "border-l-2 border-l-blue-500" : "",
        frozenLeftOffset !== undefined ? "sticky z-[41]" : "",
        isFrozenLast && frozenLeftOffset !== undefined ? "shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" : ""
      )}
      style={{ width: currentWidth, minWidth: currentWidth, maxWidth: currentWidth, left: frozenLeftOffset }}
    >
      {field.color && (
         <div className="absolute top-0 left-0 right-0 h-[3px] z-[5]" style={{ backgroundColor: field.color }} />
      )}
      <div 
        className="flex items-center px-2 h-8 cursor-pointer"
        onClick={(e) => onSelectCol(e)}
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
            <span className="truncate flex-1 flex items-center" title={field.name}>
                {field.name}
                {isIndividuallyFrozen && <Lock className="w-3 h-3 ml-1 text-gray-400 shrink-0" />}
            </span>
            <div className="cursor-pointer p-0.5 rounded hover:bg-gray-200 flex items-center justify-center shrink-0" onClick={(e) => { e.stopPropagation(); setShowActionMenu(true); }}>
              {filterRules && filterRules.length > 0 ? (
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
        <div ref={actionMenuRef} className={cn("absolute top-full mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1 flex flex-col max-h-[400px]", colIdx < totalCols / 2 ? "left-0" : "right-0")} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
           <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider shrink-0 flex items-center justify-between">
              <span>{lang === 'en' ? 'Filter' : '筛选'}</span>
              {(filterRules && filterRules.length > 0) && (
                  <button 
                      className="text-xs text-blue-600 hover:text-blue-800 font-normal normal-case" 
                      onClick={() => {
                          onFilterField('clear_all', '');
                          setShowActionMenu(false);
                      }}
                  >
                      {lang === 'en' ? 'Clear' : '清除筛选'}
                  </button>
              )}
           </div>
           <div className="px-3 pb-2 shrink-0 relative">
             <input type="text" className="w-full border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500 pr-7" placeholder={lang === 'en' ? "Search in column..." : "在列中搜索..."} value={colFilterSearch} onChange={(e) => {
                 const val = e.target.value;
                 setColFilterSearch(val);
                 if (val) {
                     const lowerVal = val.toLowerCase();
                     const newSelected = new Set<string>(distinctValues.filter(v => v.toLowerCase().includes(lowerVal)));
                     handleUpdateFilter(newSelected);
                 } else {
                     const newSelected = new Set<string>(distinctValues);
                     if (emptyCount > 0) newSelected.add('__EMPTY__');
                     handleUpdateFilter(newSelected);
                 }
             }} onKeyDown={(e) => {
                 if (e.key === 'Enter') {
                     setShowActionMenu(false);
                 }
             }} />
             {colFilterSearch && (
                 <button className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => {
                     setColFilterSearch('');
                     const newSelected = new Set<string>(distinctValues);
                     if (emptyCount > 0) newSelected.add('__EMPTY__');
                     setDraftSelectedValues(newSelected);
                     handleUpdateFilter(newSelected);
                 }}>
                     <X className="w-3.5 h-3.5" />
                 </button>
             )}
           </div>
           
           <div className="px-3 py-1 flex-1 overflow-y-auto">
              <label className="flex items-center space-x-2 py-1 hover:bg-gray-50 px-1 rounded cursor-pointer min-h-[28px]">
                 <input 
                     type="checkbox" 
                     className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                     checked={draftSelectedValues.size === distinctValues.length + (emptyCount > 0 ? 1 : 0) && draftSelectedValues.size > 0} 
                     ref={el => {
                         if (el) {
                             const isAll = draftSelectedValues.size === distinctValues.length + (emptyCount > 0 ? 1 : 0);
                             const isNone = draftSelectedValues.size === 0;
                             el.indeterminate = !isAll && !isNone;
                         }
                     }}
                     onChange={(e) => {
                         if (e.target.checked) {
                             const newSelected = new Set<string>(distinctValues);
                             if (emptyCount > 0) newSelected.add('__EMPTY__');
                             handleUpdateFilter(newSelected);
                         } else {
                             handleUpdateFilter(new Set<string>());
                         }
                         setColFilterSearch('');
                     }}
                 />
                 <span className="text-sm text-gray-700 truncate flex-1">{lang === 'en' ? 'Select All' : '全选'}</span>
                 <span className="text-sm text-gray-400 shrink-0">({distinctValues.length + (emptyCount > 0 ? 1 : 0)})</span>
              </label>
              
              <label className="flex items-center space-x-2 py-1 hover:bg-gray-50 px-1 rounded cursor-pointer min-h-[28px]">
                 <input 
                     type="checkbox" 
                     className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                     checked={draftSelectedValues.has('__EMPTY__')} 
                     onChange={(e) => {
                         const newSelected = new Set<string>(draftSelectedValues);
                         if (e.target.checked) newSelected.add('__EMPTY__'); else newSelected.delete('__EMPTY__');
                         handleUpdateFilter(newSelected);
                     }} 
                 />
                 <span className="text-sm text-gray-700 truncate flex-1">{lang === 'en' ? 'Blank' : '空白'}</span>
                 <span className="text-sm text-gray-400 shrink-0">({emptyCount})</span>
              </label>

              {distinctValues.filter(v => v.toLowerCase().includes(colFilterSearch.toLowerCase())).map(v => (
                  <label key={v} className="flex items-center space-x-2 py-1 hover:bg-gray-50 px-1 rounded cursor-pointer min-h-[28px]">
                     <input 
                         type="checkbox" 
                         className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                         checked={draftSelectedValues.has(v)} 
                         onChange={(e) => {
                             const newSelected = new Set<string>(draftSelectedValues);
                             if (e.target.checked) newSelected.add(v); else newSelected.delete(v);
                             handleUpdateFilter(newSelected);
                         }} 
                     />
                     <span className="text-sm text-gray-700 truncate flex-1">{v}</span>
                     <span className="text-sm text-gray-400 shrink-0 ml-1">({valueCounts.get(v)})</span>
                  </label>
              ))}
              {distinctValues.length === 0 && emptyCount === 0 && <div className="text-sm text-gray-400 py-2 px-1">{lang === 'en' ? 'No values' : '无数据'}</div>}
           </div>

           <div className="px-3 py-2 shrink-0 border-t border-gray-50 flex justify-between items-center gap-2">
              <button 
                  className="text-xs text-blue-600 hover:text-blue-800"
                  onClick={() => {
                     const newSelected = new Set<string>();
                     if (!draftSelectedValues.has('__EMPTY__') && emptyCount > 0) newSelected.add('__EMPTY__');
                     distinctValues.forEach(v => {
                         if (!draftSelectedValues.has(v)) newSelected.add(v);
                     });
                     handleUpdateFilter(newSelected);
                  }}
              >
                 {lang === 'en' ? 'Invert' : '反选'}
              </button>
              <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700" onClick={() => {
                      setShowActionMenu(false);
                  }}>
                      {lang === 'en' ? 'Done' : '完成'}
                  </button>
              </div>
           </div>
           
           <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t border-gray-100 mt-1 shrink-0">{lang === 'en' ? 'Sort' : '排序'}</div>
           <div className="shrink-0">
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
        </div>
      )}

      {showMenu && (
        <div ref={menuRef} className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-2" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
           <div className="flex items-center justify-between mb-2">
             <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{lang === 'en' ? 'Change Type' : '修改类型'}</div>
             <button onClick={() => setIsTypeExpanded(!isTypeExpanded)} className="text-gray-400 hover:text-gray-600 transition-colors">
               <ChevronDown className={cn("w-4 h-4 transition-transform", isTypeExpanded ? "" : "-rotate-90")} />
             </button>
           </div>
           {isTypeExpanded ? (
             <div className="grid grid-cols-2 gap-1 mb-3">
               {FIELD_TYPES.map(ft => (
                 <div 
                   key={ft.type} 
                   className={cn("flex items-center px-2 py-1.5 rounded cursor-pointer text-sm transition-colors", field.type === ft.type ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100')}
                   onClick={() => { onChangeType(ft.type); setIsTypeExpanded(false); }}
                 >
                   <FieldIcon type={ft.type} className={cn("w-4 h-4 mr-2", field.type === ft.type ? "text-blue-700" : "")} />
                   <span className="flex-1 truncate">{lang === 'en' ? ft.label : ft.labelZh}</span>
                 </div>
               ))}
             </div>
           ) : (() => {
             const currentType = FIELD_TYPES.find(t => t.type === field.type);
             if (!currentType) return null;
             return (
               <div className="mb-3">
                 <div 
                   className="flex items-center px-2 py-1.5 rounded cursor-pointer text-sm transition-colors bg-blue-50 text-blue-700 border border-blue-100"
                   onClick={() => setIsTypeExpanded(true)}
                 >
                   <FieldIcon type={currentType.type} className="w-4 h-4 mr-2" />
                   <span className="flex-1 truncate">{lang === 'en' ? currentType.label : currentType.labelZh}</span>
                 </div>
               </div>
             );
           })()}

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
                            {allFields.filter(f => f.id !== field.id).map(f => (
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

           {(field.type === 'aiText' || field.type === 'aiImage' || field.type === 'aiVideo') && (
             <div className="border-t border-gray-100 pt-3">
               <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{lang === 'en' ? (field.type === 'aiVideo' ? 'AI Video Setup' : field.type === 'aiText' ? 'Smart Text Setup' : 'AI Image Setup') : (field.type === 'aiVideo' ? '智能视频设置' : field.type === 'aiText' ? '智能文本设置' : '智能图片设置')}</div>
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
                            {allFields.filter(f => f.id !== field.id).map(f => (
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
                         <label className="block text-[10px] text-gray-500 mb-1">原始图片</label>
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
                             {allFields.filter(f => f.id !== field.id && (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'aiVideo' || f.type === 'url')).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                           </select>
                         </div>
                       </div>
                       <div className="flex flex-col gap-1 mt-1">
                         <label className="flex items-center gap-1 cursor-pointer w-max">
                           <input type="checkbox" checked={!!draftAiImageConfig.isRetouchMode} onChange={e => setDraftAiImageConfig(prev => ({ ...prev, isRetouchMode: e.target.checked }))} onMouseDown={e=>e.stopPropagation()} />
                           <span className="text-[10px] text-gray-600">开启局部修图模式 (引用裁切数据)</span>
                         </label>
                         {draftAiImageConfig.isRetouchMode && (
                           <div className="pl-4 flex flex-col gap-1 mb-1">
                             <label className="flex items-center gap-1 cursor-pointer w-max">
                               <input type="checkbox" checked={!!draftAiImageConfig.saveToSourceFolder} onChange={e => setDraftAiImageConfig(prev => ({ ...prev, saveToSourceFolder: e.target.checked }))} onMouseDown={e=>e.stopPropagation()} />
                               <span className="text-[10px] text-gray-600">保存到原图同级目录并加 -gan 后缀</span>
                             </label>
                             <label className="flex items-center gap-1 cursor-pointer w-max">
                               <input type="checkbox" checked={draftAiImageConfig.scaleToSource !== false} onChange={e => setDraftAiImageConfig(prev => ({ ...prev, scaleToSource: e.target.checked }))} onMouseDown={e=>e.stopPropagation()} />
                               <span className="text-[10px] text-gray-600">保持实际被裁切区域像素尺寸保存</span>
                             </label>
                           </div>
                         )}
                       </div>
                       <div className="grid grid-cols-3 gap-2">
                         <div className="flex flex-col">
                           <label className="block text-[10px] text-gray-500 mb-1">分辨率</label>
                           <div className="flex items-stretch border border-gray-300 bg-white rounded">
                             <div className="relative flex-1 w-0">
                               <select 
                                  className="w-full h-full text-xs text-gray-700 p-1 pr-4 outline-none bg-transparent appearance-none"
                                  value={draftAiImageConfig.resolution || '1k'}
                                  onChange={e => setDraftAiImageConfig(prev => ({ ...prev, resolution: e.target.value }))}
                               >
                                  {!['1k', '2k', '4k'].includes((draftAiImageConfig.resolution || '1k').toLowerCase()) && (
                                     <option value={draftAiImageConfig.resolution}>{draftAiImageConfig.resolution}</option>
                                  )}
                                  <option value="1k">1K</option>
                                  <option value="2k">2K</option>
                                  <option value="4k">4K</option>
                               </select>
                               <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                                 <ChevronDown className="w-3 h-3 text-gray-500" />
                               </div>
                             </div>
                             <div className="relative w-6 flex items-center justify-center border-l border-gray-200 hover:bg-gray-50 shrink-0">
                               <Plus className="w-3 h-3 text-gray-500" />
                               <select 
                                  className="absolute inset-0 opacity-0 cursor-pointer text-[10px]"
                                  title="引用字段"
                                  value=""
                                  onChange={e => {
                                    if (!e.target.value) return;
                                    setDraftAiImageConfig(prev => ({ ...prev, resolution: `{${e.target.value}}` }));
                                  }}
                               >
                                  <option value="">+ 引用</option>
                                  {allFields.filter(f => f.id !== field.id).map(f => (
                                    <option key={f.id} value={f.name}>{f.name}</option>
                                  ))}
                               </select>
                             </div>
                           </div>
                         </div>
                         <div className="flex flex-col">
                           <label className="block text-[10px] text-gray-500 mb-1">比例</label>
                           <div className="flex items-stretch border border-gray-300 bg-white rounded">
                             <div className="relative flex-1 w-0">
                               <select 
                                  className="w-full h-full text-xs text-gray-700 p-1 pr-4 outline-none bg-transparent appearance-none"
                                  value={draftAiImageConfig.ratio || '1:1'}
                                  onChange={e => setDraftAiImageConfig(prev => ({ ...prev, ratio: e.target.value }))}
                               >
                                  {!['1:1', '16:9', '9:16', '4:3', '3:4'].includes(draftAiImageConfig.ratio || '1:1') && (
                                     <option value={draftAiImageConfig.ratio}>{draftAiImageConfig.ratio}</option>
                                  )}
                                  <option value="1:1">1:1</option>
                                  <option value="16:9">16:9</option>
                                  <option value="9:16">9:16</option>
                                  <option value="4:3">4:3</option>
                                  <option value="3:4">3:4</option>
                               </select>
                               <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                                 <ChevronDown className="w-3 h-3 text-gray-500" />
                               </div>
                             </div>
                             <div className="relative w-6 flex items-center justify-center border-l border-gray-200 hover:bg-gray-50 shrink-0">
                               <Plus className="w-3 h-3 text-gray-500" />
                               <select 
                                  className="absolute inset-0 opacity-0 cursor-pointer text-[10px]"
                                  title="引用字段"
                                  value=""
                                  onChange={e => {
                                    if (!e.target.value) return;
                                    setDraftAiImageConfig(prev => ({ ...prev, ratio: `{${e.target.value}}` }));
                                  }}
                               >
                                  <option value="">+ 引用</option>
                                  {allFields.filter(f => f.id !== field.id).map(f => (
                                    <option key={f.id} value={f.name}>{f.name}</option>
                                  ))}
                               </select>
                             </div>
                           </div>
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
                          <label className="block text-[10px] text-gray-500 mb-1">保存的图片文件名</label>
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
                            {getAllConfiguredModels(modelSettings?.image).map((m: string) => (
                               <option key={m} value={m} />
                            ))}
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
                   {field.type === 'aiVideo' && (
                     <div className="mt-2 space-y-2">
                       <div>
                         <label className="block text-[10px] text-gray-500 mb-1">参考图片/视频</label>
                         <div className="relative">
                           <textarea
                             className="w-full text-xs border border-gray-300 rounded p-1 outline-none"
                             value={draftAiVideoConfig.sourceImageTemplate || ''}
                             placeholder="{Image 1} {Video 1}"
                             onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, sourceImageTemplate: e.target.value }))}
                             onMouseDown={e => e.stopPropagation()}
                           />
                           <select 
                             className="absolute bottom-1 right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px]"
                             value=""
                             onChange={e => {
                               if (!e.target.value) return;
                               const curTpl = draftAiVideoConfig.sourceImageTemplate || '';
                               setDraftAiVideoConfig(prev => ({ ...prev, sourceImageTemplate: curTpl + `{${e.target.value}}` }));
                             }}
                           >
                             <option value="">+ 引用</option>
                             {allFields.filter(f => f.id !== field.id && (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'aiVideo' || f.type === 'url')).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                           </select>
                         </div>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-2">
                         <div className="flex flex-col">
                            <label className="block text-[10px] text-gray-500 mb-1">清晰度（可引用字段）</label>
                            <div className="flex items-stretch border border-gray-300 bg-white rounded">
                              <div className="relative flex-1 w-0">
                                <select 
                                   className="w-full h-full text-xs text-gray-700 p-1 pr-4 outline-none bg-transparent appearance-none"
                                   value={draftAiVideoConfig.resolution || '1080P'}
                                   onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, resolution: e.target.value }))}
                                >
                                   {!['360p', '480p', '720p', '1080p', '2k', '4k'].includes((draftAiVideoConfig.resolution || '1080P').toLowerCase()) && (
                                      <option value={draftAiVideoConfig.resolution}>{draftAiVideoConfig.resolution}</option>
                                   )}
                                   <option value="360P">360P</option>
                                   <option value="480P">480P</option>
                                   <option value="720P">720P</option>
                                   <option value="1080P">1080P</option>
                                   <option value="2K">2K</option>
                                   <option value="4K">4K</option>
                                </select>
                                <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                                  <ChevronDown className="w-3 h-3 text-gray-500" />
                                </div>
                              </div>
                              <div className="relative w-6 flex items-center justify-center border-l border-gray-200 hover:bg-gray-50 shrink-0">
                                 <Plus className="w-3 h-3 text-gray-500" />
                                 <select className="absolute inset-0 opacity-0 cursor-pointer text-[10px]" value="" onChange={e => { if(e.target.value) { setDraftAiVideoConfig(prev => ({...prev, resolution: `{${e.target.value}}`})); } }}>
                                    <option value="">+ 引用</option>
                                    {allFields.length > 0 && <optgroup label="所有列">
                                      {allFields.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                                    </optgroup>}
                                 </select>
                              </div>
                            </div>
                          </div>
                         <div className="flex flex-col">
                            <label className="block text-[10px] text-gray-500 mb-1">比例 (Aspect Ratio)</label>
                            <div className="flex items-stretch border border-gray-300 bg-white rounded">
                              <div className="relative flex-1 w-0">
                                <select 
                                   className="w-full h-full text-xs text-gray-700 p-1 pr-4 outline-none bg-transparent appearance-none"
                                   value={draftAiVideoConfig.ratio || '16:9'}
                                   onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, ratio: e.target.value }))}
                                >
                                   {!['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '2:3', '3:2'].includes(String(draftAiVideoConfig.ratio || '16:9')) && (
                                      <option value={draftAiVideoConfig.ratio}>{draftAiVideoConfig.ratio}</option>
                                   )}
                                   <option value="16:9">16:9</option>
                                   <option value="9:16">9:16</option>
                                   <option value="1:1">1:1</option>
                                   <option value="4:3">4:3</option>
                                   <option value="3:4">3:4</option>
                                   <option value="21:9">21:9</option>
                                   <option value="2:3">2:3</option>
                                   <option value="3:2">3:2</option>
                                </select>
                                <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                                  <ChevronDown className="w-3 h-3 text-gray-500" />
                                </div>
                              </div>
                              <div className="relative w-6 flex items-center justify-center border-l border-gray-200 hover:bg-gray-50 shrink-0">
                                 <Plus className="w-3 h-3 text-gray-500" />
                                 <select className="absolute inset-0 opacity-0 cursor-pointer text-[10px]" value="" onChange={e => { if(e.target.value) { setDraftAiVideoConfig(prev => ({...prev, ratio: `{${e.target.value}}`})); } }}>
                                    <option value="">+ 引用</option>
                                    {allFields.length > 0 && <optgroup label="所有列">
                                      {allFields.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                                    </optgroup>}
                                 </select>
                              </div>
                            </div>
                          </div>
                         <div className="flex flex-col">
                            <label className="block text-[10px] text-gray-500 mb-1">生成模式 (Mode)</label>
                            <div className="flex items-stretch border border-gray-300 bg-white rounded">
                              <div className="relative flex-1 w-0">
                                <select 
                                   className="w-full h-full text-xs text-gray-700 p-1 pr-4 outline-none bg-transparent appearance-none"
                                   value={draftAiVideoConfig.mode || 'fast'}
                                   onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, mode: e.target.value }))}
                                >
                                   {!['fast', 'quality'].includes((draftAiVideoConfig.mode || 'fast').toLowerCase()) && (
                                      <option value={draftAiVideoConfig.mode}>{draftAiVideoConfig.mode}</option>
                                   )}
                                   <option value="fast">fast</option>
                                   <option value="quality">quality</option>
                                </select>
                                <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                                  <ChevronDown className="w-3 h-3 text-gray-500" />
                                </div>
                              </div>
                              <div className="relative w-6 flex items-center justify-center border-l border-gray-200 hover:bg-gray-50 shrink-0">
                                 <Plus className="w-3 h-3 text-gray-500" />
                                 <select className="absolute inset-0 opacity-0 cursor-pointer text-[10px]" value="" onChange={e => { if(e.target.value) { setDraftAiVideoConfig(prev => ({...prev, mode: `{${e.target.value}}`})); } }}>
                                    <option value="">+ 引用</option>
                                    {allFields.length > 0 && <optgroup label="所有列">
                                      {allFields.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                                    </optgroup>}
                                 </select>
                              </div>
                            </div>
                          </div>
                         <div className="flex flex-col">
                            <label className="block text-[10px] text-gray-500 mb-1">时长 (秒)</label>
                            <div className="flex items-stretch border border-gray-300 bg-white rounded">
                              <div className="relative flex-1 w-0">
                                <select 
                                   className="w-full h-full text-xs text-gray-700 p-1 pr-4 outline-none bg-transparent appearance-none"
                                   value={draftAiVideoConfig.duration || '10'}
                                   onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, duration: e.target.value }))}
                                >
                                   {!['3', '5', '8', '10', '15', '20', '25', '30'].includes(String(draftAiVideoConfig.duration || '10')) && (
                                      <option value={draftAiVideoConfig.duration}>{draftAiVideoConfig.duration}</option>
                                   )}
                                    <option value="3">3</option>
                                    <option value="5">5</option>
                                    <option value="8">8</option>
                                   <option value="10">10</option>
                                   <option value="15">15</option>
                                   <option value="20">20</option>
                                   <option value="25">25</option>
                                   <option value="30">30</option>
                                </select>
                                <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                                  <ChevronDown className="w-3 h-3 text-gray-500" />
                                </div>
                              </div>
                              <div className="relative w-6 flex items-center justify-center border-l border-gray-200 hover:bg-gray-50 shrink-0">
                                 <Plus className="w-3 h-3 text-gray-500" />
                                 <select className="absolute inset-0 opacity-0 cursor-pointer text-[10px]" value="" onChange={e => { if(e.target.value) { setDraftAiVideoConfig(prev => ({...prev, duration: `{${e.target.value}}`})); } }}>
                                    <option value="">+ 引用</option>
                                    {allFields.length > 0 && <optgroup label="所有列">
                                      {allFields.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                                    </optgroup>}
                                 </select>
                              </div>
                            </div>
                          </div>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-2">
                         <div className="flex items-center justify-between border border-gray-300 rounded p-1 px-2">
                           <label className="text-[10px] text-gray-700">伴随声音</label>
                           <input type="checkbox" checked={draftAiVideoConfig.sound === 'true'} onChange={e => setDraftAiVideoConfig(prev => ({...prev, sound: e.target.checked ? 'true' : 'false'}))} />
                         </div>
                         <div className="flex items-center justify-between border border-gray-300 rounded p-1 px-2">
                           <label className="text-[10px] text-gray-700">优化提示词</label>
                           <input type="checkbox" checked={draftAiVideoConfig.enhancePrompt === 'true'} onChange={e => setDraftAiVideoConfig(prev => ({...prev, enhancePrompt: e.target.checked ? 'true' : 'false'}))} />
                         </div>
                       </div>
                       
                       <div className="relative mt-2">
                           <label className="block text-[10px] text-gray-500 mb-1">保存的文件名</label>
                           <input 
                             type="text" 
                             className="w-full text-xs border border-gray-300 rounded p-1 pr-[70px] outline-none placeholder:text-gray-300"
                             placeholder="例如: {Task}_{Date}"
                             value={draftAiVideoConfig.filenameTemplate || ''}
                             onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, filenameTemplate: e.target.value }))}
                             onMouseDown={e => e.stopPropagation()}
                           />
                           <select 
                              className="absolute bottom-1 right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px] h-6 cursor-pointer hover:bg-gray-100"
                              value=""
                              onChange={e => {
                                if (!e.target.value) return;
                                const curTpl = draftAiVideoConfig.filenameTemplate || '';
                                setDraftAiVideoConfig(prev => ({ ...prev, filenameTemplate: curTpl + `{${e.target.value}}` }));
                              }}
                            >
                              <option value="">+ 引用</option>
                              {allFields.filter(f => f.id !== field.id).map(f => (
                                <option key={f.id} value={f.name}>{f.name}</option>
                              ))}
                            </select>
                        </div>
                       
                       <div className="relative mt-2">
                           <label className="block text-[10px] text-gray-500 mb-1">模型 (Model)</label>
                           <div className="flex border border-gray-300 rounded overflow-hidden">
                             <input 
                               type="text" 
                               list={`model-suggestions-${field.id}`}
                               className="w-full text-xs p-1 outline-none placeholder:text-gray-300"
                               placeholder="例如: video-v1"
                               value={draftAiVideoConfig.modelTemplate || ''}
                               onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, modelTemplate: e.target.value }))}
                               onMouseDown={e => e.stopPropagation()}
                             />
                             <datalist id={`model-suggestions-${field.id}`}>
                               {getAllConfiguredModels(modelSettings?.video).map((m: string) => (
                                 <option key={m} value={m} />
                               ))}
                             </datalist>
                             <div className="relative border-l border-gray-200 shrink-0">
                                <select 
                                   className="appearance-none bg-gray-50 text-[10px] outline-none px-2 h-full cursor-pointer pr-5 hover:bg-gray-100 transition-colors"
                                   value=""
                                   onChange={e => {
                                     if (!e.target.value) return;
                                     const curTpl = draftAiVideoConfig.modelTemplate || '';
                                     setDraftAiVideoConfig(prev => ({ ...prev, modelTemplate: curTpl + `{${e.target.value}}` }));
                                   }}
                                 >
                                   <option value="">+ 引用</option>
                                   {allFields.filter(f => f.id !== field.id).map(f => (
                                     <option key={f.id} value={f.name}>{f.name}</option>
                                   ))}
                                 </select>
                                 <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                             </div>
                           </div>
                        </div>
                       
                       <div>
                          <label className="block text-[10px] text-gray-500 mb-1">保存目录 (文件夹)</label>
                          <input 
                            type="text" 
                            className="w-full text-xs border border-gray-300 rounded p-1 outline-none placeholder:text-gray-300"
                            placeholder="C:\videos"
                            value={draftAiVideoConfig.folderPath || ''}
                            onChange={e => setDraftAiVideoConfig(prev => ({ ...prev, folderPath: e.target.value }))}
                            onMouseDown={e => e.stopPropagation()}
                          />
                       </div>
                     </div>
                   )}
                   {field.type === 'aiText' && (
                     <div className="mt-2 space-y-2">
                       <div className="relative">
                         <label className="block text-[10px] text-gray-500 mb-1">Skill (显示名，可引用字段)</label>
                         <input
                           type="text"
                           list={`txt-skill-suggestions-${field.id}`}
                           className="w-full text-xs border border-gray-300 rounded p-1 pr-16 outline-none placeholder:text-gray-300"
                           placeholder="例如: MiniMax H3 Prompt Writing 或 {Skill}"
                           title={draftAiTextConfig.skillTemplate || ''}
                           value={draftAiTextConfig.skillTemplate || ''}
                           onChange={e => setDraftAiTextConfig(prev => ({ ...prev, skillTemplate: e.target.value }))}
                           onMouseDown={e => e.stopPropagation()}
                         />
                         <datalist id={`txt-skill-suggestions-${field.id}`}>
                           {availableSkills
                             .filter((skill: any) => skill.enabled && !skill.duplicateDisplayName)
                             .map((skill: any) => (
                               <option key={skill.relativePath || skill.displayName} value={skill.displayName}>
                                 {skill.description || skill.source?.label || ''}
                               </option>
                             ))}
                         </datalist>
                         <select
                           className="absolute bottom-[18px] right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px]"
                           value=""
                           onChange={e => {
                             if (!e.target.value) return;
                             const curTpl = draftAiTextConfig.skillTemplate || '';
                             setDraftAiTextConfig(prev => ({ ...prev, skillTemplate: curTpl + `{${e.target.value}}` }));
                           }}
                         >
                           <option value="">+ 引用</option>
                           {allFields.filter(f => f.id !== field.id).map(f => (
                             <option key={f.id} value={f.name}>{f.name}</option>
                           ))}
                         </select>
                         <div className="mt-1 text-[9px] text-gray-400 truncate" title={draftAiTextConfig.skillTemplate || ''}>
                           {draftAiTextConfig.skillTemplate
                             ? (lang === 'en' ? 'Match by Skill display name; an empty referenced field means no Skill.' : '按 Skill 显示名匹配；引用字段为空时保持原智能文本逻辑。')
                             : (lang === 'en' ? 'Optional. Leave empty to keep legacy Smart Text behavior.' : '可选。留空时完全沿用原智能文本逻辑。')}
                         </div>
                       </div>
                       <div>
                         <label className="block text-[10px] text-gray-500 mb-1">参考图片 (引用字段)</label>
                         <div className="relative">
                           <textarea
                             className="w-full text-xs border border-gray-300 rounded p-1 outline-none"
                             value={draftAiTextConfig.sourceImageTemplate || ''}
                             placeholder="{Image 1} {Image 2}"
                             onChange={e => setDraftAiTextConfig(prev => ({ ...prev, sourceImageTemplate: e.target.value }))}
                             onMouseDown={e => e.stopPropagation()}
                           />
                           <select 
                             className="absolute bottom-1 right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px]"
                             value=""
                             onChange={e => {
                               if (!e.target.value) return;
                               const curTpl = draftAiTextConfig.sourceImageTemplate || '';
                               setDraftAiTextConfig(prev => ({ ...prev, sourceImageTemplate: curTpl + `{${e.target.value}}` }));
                             }}
                           >
                             <option value="">+ 引用</option>
                             {allFields.filter(f => f.id !== field.id && (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'aiVideo' || f.type === 'url')).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                           </select>
                         </div>
                       </div>
                       <div className="relative">
                          <label className="block text-[10px] text-gray-500 mb-1">文本生成模型 (可引用字段，覆盖默认)</label>
                          <input 
                            type="text" 
                            list={`txt-model-suggestions-${field.id}`}
                            className="w-full text-xs border border-gray-300 rounded p-1 outline-none placeholder:text-gray-300"
                            placeholder="例如: {Model} 或 gpt-4o"
                            value={draftAiTextConfig.modelTemplate || ''}
                            onChange={e => setDraftAiTextConfig(prev => ({ ...prev, modelTemplate: e.target.value }))}
                            onMouseDown={e => e.stopPropagation()}
                          />
                          <datalist id={`txt-model-suggestions-${field.id}`}>
                            {getAllConfiguredModels(modelSettings?.text).map((m: string) => (
                               <option key={m} value={m} />
                            ))}
                          </datalist>
                          <select 
                             className="absolute bottom-1 right-1 text-[10px] border border-gray-200 bg-gray-50 rounded w-[60px]"
                             value=""
                             onChange={e => {
                               if (!e.target.value) return;
                               const curTpl = draftAiTextConfig.modelTemplate || '';
                               setDraftAiTextConfig(prev => ({ ...prev, modelTemplate: curTpl + `{${e.target.value}}` }));
                             }}
                           >
                             <option value="">+ 引用</option>
                             {allFields.filter(f => f.id !== field.id).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                          </select>
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
                         onUpdateField({ prompt: draftPrompt, refFields: draftRefs, aiImageConfig: draftAiImageConfig, aiTextConfig: draftAiTextConfig, aiVideoConfig: draftAiVideoConfig });
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


type LargeTextMediaItem = {
  item: any;
  url: string;
  sourceFieldName: string;
  mediaType: DetectedMediaType;
  token: string;
  label: string;
  sequence: number;
  index: number;
};

const getSmartFieldMediaTemplates = (field: Field): string[] => {
  if (field.type === 'aiText') {
    return [String(field.aiTextConfig?.sourceImageTemplate || '')].filter(Boolean);
  }
  if (field.type === 'aiImage') {
    return [String(field.aiImageConfig?.sourceImageTemplate || '')].filter(Boolean);
  }
  if (field.type === 'aiVideo') {
    // 当前视频生成主链路主要使用 sourceImageTemplate，并保留对未来
    // sourceVideoTemplate / sourceAudioTemplate 的兼容读取。
    return [
      String(field.aiVideoConfig?.sourceImageTemplate || ''),
      String(field.aiVideoConfig?.sourceVideoTemplate || ''),
      String(field.aiVideoConfig?.sourceAudioTemplate || ''),
    ].filter(Boolean);
  }
  return [];
};

const getSmartFieldMediaSourceFields = (sourceField: Field, allFields: Field[]): Field[] => {
  const templates = getSmartFieldMediaTemplates(sourceField);
  if (templates.length === 0) return [];

  const firstPosition = new Map<string, number>();
  let offset = 0;
  templates.forEach(template => {
    allFields.forEach(candidate => {
      // 只解析真实可承载媒体的字段，避免普通文本被误当成文件路径。
      if (!['attachment', 'aiImage', 'aiVideo', 'url'].includes(candidate.type)) return;
      const index = template.indexOf(`{${candidate.name}}`);
      if (index < 0) return;
      const position = offset + index;
      const previous = firstPosition.get(candidate.id);
      if (previous === undefined || position < previous) firstPosition.set(candidate.id, position);
    });
    offset += template.length + 1;
  });

  return allFields
    .filter(candidate => firstPosition.has(candidate.id))
    .sort((a, b) => (firstPosition.get(a.id) || 0) - (firstPosition.get(b.id) || 0));
};

const getLargeTextMediaItems = (
  field: Field,
  allFields: Field[],
  record: BaseRecord,
  temporaryReferenceFieldId?: string | null
): LargeTextMediaItem[] => {
  let sourceField: Field | undefined;

  if (field.type === 'aiText') {
    // 智能文本有自己明确配置的媒体引用时，始终优先使用自身媒体上下文。
    // 只有当它完全没有配置任何可用媒体字段时，才允许像普通文本一样
    // 在当前大屏编辑会话中临时继承另一个智能节点的媒体上下文。
    const ownMediaFields = getSmartFieldMediaSourceFields(field, allFields);
    if (ownMediaFields.length > 0) {
      sourceField = field;
    } else if (temporaryReferenceFieldId) {
      const candidate = allFields.find(f => f.id === temporaryReferenceFieldId);
      if (candidate && ['aiText', 'aiImage', 'aiVideo'].includes(candidate.type)) {
        sourceField = candidate;
      }
    }
  } else if (field.type === 'text' && temporaryReferenceFieldId) {
    // 普通文本仅在大屏编辑会话里临时“参考一个智能节点”。
    // 不写回 Field Config，不建立永久依赖。
    const candidate = allFields.find(f => f.id === temporaryReferenceFieldId);
    if (candidate && ['aiText', 'aiImage', 'aiVideo'].includes(candidate.type)) {
      sourceField = candidate;
    }
  }

  if (!sourceField) return [];
  const orderedFields = getSmartFieldMediaSourceFields(sourceField, allFields);
  if (orderedFields.length === 0) return [];

  const counters: Record<DetectedMediaType, number> = { image: 0, video: 0, audio: 0 };
  const result: LargeTextMediaItem[] = [];

  orderedFields.forEach(refField => {
    const rawValue = record[refField.id];
    let items: any[] = [];
    if (refField.type === 'url') {
      if (rawValue) items = [{ url: String(rawValue) }];
    } else {
      items = normalizeAttachmentItems(rawValue);
    }

    items.forEach(item => {
      const url = String(item?.url || '').trim();
      if (!url) return;
      const mediaType = detectExportMediaType(item, url);
      counters[mediaType] += 1;
      const seq = counters[mediaType];
      const token = mediaType === 'audio' ? `<Audio ${seq}>` : mediaType === 'video' ? `<Video ${seq}>` : `<Picture ${seq}>`;
      const label = mediaType === 'audio' ? `Audio ${seq}` : mediaType === 'video' ? `Video ${seq}` : `Picture ${seq}`;
      result.push({ item, url, sourceFieldName: refField.name, mediaType, token, label, sequence: seq, index: result.length });
    });
  });

  return result;
};

const escapeHtmlForLargeEditor = (input: string) => input
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');


const getLargeMediaTheme = (type: DetectedMediaType) => {
  // 与字段表头色板同一认知，但整体下压一档明度，减少大屏编辑时的视觉干扰。
  if (type === 'audio') {
    return {
      border: '#e9d5ff',
      background: '#faf5ff',
      text: '#7e22ce',
      soft: '#f3e8ff',
      badge: '#7e22ce',
      groupLabel: '音频',
      groupLabelEn: 'Audio',
    };
  }
  if (type === 'video') {
    return {
      border: '#fbcfe8',
      background: '#fdf2f8',
      text: '#be185d',
      soft: '#fce7f3',
      badge: '#be185d',
      groupLabel: '视频',
      groupLabelEn: 'Video',
    };
  }
  return {
    border: '#bfdbfe',
    background: '#eff6ff',
    text: '#1d4ed8',
    soft: '#dbeafe',
    badge: '#1d4ed8',
    groupLabel: '图片',
    groupLabelEn: 'Image',
  };
};

const getLargeMediaFallbackIconHtml = (type: DetectedMediaType) => {
  if (type === 'audio') {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }
  if (type === 'video') {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:block"><path d="M8 5v14l11-7z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
};

const highlightLargeVisualSyntax = (escapedText: string) => {
  return escapedText
    .replace(/(&lt;[^<>\n]+?&gt;)/g, '<strong style="font-weight:700;color:#344054;">$1</strong>')
    .replace(/(\[[^\]\n]+\])/g, '<strong style="font-weight:700;color:#344054;">$1</strong>')
    .replace(/(【[^】\n]+】)/g, '<strong style="font-weight:700;color:#344054;">$1</strong>');
};

const serializeLargeVisualEditor = (root: HTMLElement | null): string => {
  if (!root) return '';
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const token = el.dataset?.mediaToken;
    if (token) return token;
    if (el.tagName === 'BR') return '\n';
    let out = '';
    el.childNodes.forEach(child => { out += walk(child); });
    if (el.tagName === 'DIV' || el.tagName === 'P') out += '\n';
    return out;
  };
  return walk(root).replace(/\n{3,}/g, '\n\n').replace(/\n$/, '');
};

interface LargeTextEditorModalProps {
  open: boolean;
  field: Field;
  record: BaseRecord;
  allFields: Field[];
  value: string;
  lang: 'en' | 'zh';
  onSave: (value: string) => void;
  onClose: () => void;
  onGenerate?: () => void;
  onPreviewImage: CellProps['onPreviewImage'];
  recordPosition: number;
  recordCount: number;
  initialTemporaryReferenceFieldId?: string | null;
  onNavigateRow?: (direction: -1 | 1, currentValue: string, temporaryReferenceFieldId: string | null) => void;
}

const LargeTextEditorModal = ({
  open,
  field,
  record,
  allFields,
  value,
  lang,
  onSave,
  onClose,
  onGenerate,
  onPreviewImage,
  recordPosition,
  recordCount,
  initialTemporaryReferenceFieldId = null,
  onNavigateRow,
}: LargeTextEditorModalProps) => {
  const isAiText = field.type === 'aiText';
  const isPlainText = field.type === 'text';
  const temporaryReferenceFieldOptions = useMemo(
    () => allFields.filter(f => f.id !== field.id && ['aiText', 'aiImage', 'aiVideo'].includes(f.type)),
    [allFields, field.id]
  );
  const aiTextHasOwnMediaReferences = useMemo(
    () => isAiText && getSmartFieldMediaSourceFields(field, allFields).length > 0,
    [isAiText, field, allFields]
  );
  // 普通文本始终可选临时参考；智能文本仅在自身没有配置媒体引用字段时开放。
  const canSelectTemporaryReference = isPlainText || (isAiText && !aiTextHasOwnMediaReferences);
  const [temporaryReferenceFieldId, setTemporaryReferenceFieldId] = useState<string | null>(
    canSelectTemporaryReference ? initialTemporaryReferenceFieldId : null
  );
  const canUseVisualReferences = isAiText || (isPlainText && !!temporaryReferenceFieldId);
  const mediaItems = useMemo(
    () => getLargeTextMediaItems(field, allFields, record, temporaryReferenceFieldId),
    [field, allFields, record, temporaryReferenceFieldId]
  );
  const [draft, setDraft] = useState(String(value ?? ''));
  const [visualMode, setVisualMode] = useState(isAiText || !!initialTemporaryReferenceFieldId);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPosition, setMentionPosition] = useState<{ left: number; top: number } | null>(null);
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const visualRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const visualSourceRef = useRef(String(value ?? ''));

  useEffect(() => {
    if (!open) return;
    const nextValue = String(value ?? '');
    visualSourceRef.current = nextValue;
    setDraft(nextValue);
    const nextTemporaryReferenceFieldId = canSelectTemporaryReference ? initialTemporaryReferenceFieldId : null;
    setTemporaryReferenceFieldId(nextTemporaryReferenceFieldId);
    setVisualMode(isAiText || !!nextTemporaryReferenceFieldId);
    setMentionQuery(null);
    setMentionPosition(null);
  }, [open, value, isAiText, field.id, record.id, initialTemporaryReferenceFieldId, canSelectTemporaryReference]);

  useEffect(() => {
    if (!open || mediaItems.length === 0) return;
    let cancelled = false;
    Promise.all(mediaItems.map(async media => {
      try {
        const thumb = thumbnailCache.get(media.url) || await getOrGenerateThumbnail(media.url);
        return [media.url, thumb || ''] as const;
      } catch {
        return [media.url, ''] as const;
      }
    })).then(entries => {
      if (!cancelled) setThumbMap(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [open, mediaItems]);

  const findMediaByToken = (kind: string, n: number) => {
    const normalizedKind = kind.toLowerCase();
    const targetType: DetectedMediaType = normalizedKind === 'audio' ? 'audio' : normalizedKind === 'video' ? 'video' : 'image';
    const typed = mediaItems.filter(m => m.mediaType === targetType);
    return typed[n - 1];
  };

  const visualHtml = (text: string) => {
    const mediaHtml: string[] = [];
    let escaped = escapeHtmlForLargeEditor(text);

    escaped = escaped.replace(/&lt;(Picture|Image|Video|Audio)\s+(\d+)&gt;/gi, (_match, kind, num) => {
      const n = Number(num);
      const media = findMediaByToken(String(kind), n);
      const token = `<${kind} ${n}>`;
      const mediaType: DetectedMediaType = String(kind).toLowerCase() === 'audio'
        ? 'audio'
        : String(kind).toLowerCase() === 'video'
          ? 'video'
          : 'image';
      const theme = getLargeMediaTheme(mediaType);
      const thumb = media ? thumbMap[media.url] : '';
      const fallbackIcon = getLargeMediaFallbackIconHtml(mediaType);
      const url = media?.url || '';
      const label = media?.label || `${kind} ${n}`;
      const placeholder = `__LARGE_MEDIA_${mediaHtml.length}__`;

      mediaHtml.push(
        `<span contenteditable="false" data-media-token="${escapeHtmlForLargeEditor(token)}" data-media-url="${escapeHtmlForLargeEditor(url)}" data-media-type="${mediaType}" style="display:inline-flex;align-items:center;gap:5px;height:28px;margin:1px 2px;padding:2px 8px 2px 3px;border:1px solid ${theme.border};background:${theme.background};color:${theme.text};border-radius:7px;font-weight:600;vertical-align:middle;white-space:nowrap;">` +
        `<span data-media-thumb="1" style="width:24px;height:22px;display:grid;place-items:center;overflow:hidden;border-radius:4px;background:${theme.soft};flex:0 0 24px;">${thumb ? `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover;display:block;"/>` : `<span style="line-height:0;display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:${theme.text};">${fallbackIcon}</span>`}</span>` +
        `<span>${escapeHtmlForLargeEditor(label)}</span>` +
        `</span>`
      );
      return placeholder;
    });

    escaped = highlightLargeVisualSyntax(escaped);
    mediaHtml.forEach((html, index) => {
      escaped = escaped.replace(`__LARGE_MEDIA_${index}__`, html);
    });
    return escaped;
  };

  useEffect(() => {
    if (!open || !visualMode || !visualRef.current) return;
    // 首次进入引用渲染时直接带入已生成的缩略图；不再要求 Raw/Visual 来回切换刷新。
    visualRef.current.innerHTML = visualHtml(visualSourceRef.current);
  }, [open, visualMode, field.id, record.id, mediaItems, thumbMap]);

  useEffect(() => {
    if (!open || !visualMode || !visualRef.current) return;
    visualRef.current.querySelectorAll<HTMLElement>('[data-media-url]').forEach(chip => {
      const url = chip.dataset.mediaUrl || '';
      const mediaType = (chip.dataset.mediaType || 'image') as DetectedMediaType;
      const thumb = url ? thumbMap[url] : '';
      if (!thumb) return;
      const slot = chip.querySelector<HTMLElement>('[data-media-thumb]');
      if (!slot || slot.querySelector('img')) return;
      slot.innerHTML = `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover;display:block;"/>`;
      const theme = getLargeMediaTheme(mediaType);
      slot.style.background = theme.soft;
    });
  }, [thumbMap, open, visualMode]);

  const rememberRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && visualRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const detectMention = () => {
    if (!visualMode || !visualRef.current) return;
    rememberRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !visualRef.current.contains(sel.anchorNode)) {
      setMentionQuery(null);
      setMentionPosition(null);
      return;
    }
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(visualRef.current);
    range.setEnd(sel.anchorNode!, sel.anchorOffset);
    const before = range.toString();
    const match = before.match(/@([^@\s]*)$/);
    if (!match) {
      setMentionQuery(null);
      setMentionPosition(null);
      return;
    }

    // @ 菜单跟随当前光标，而不是固定在编辑器左上角。
    // Chromium 的折叠 Range 在行首/行尾偶尔会返回 0 尺寸，因此再用光标前一个字符兜底定位。
    const host = visualRef.current.parentElement;
    if (host) {
      const hostRect = host.getBoundingClientRect();
      const caretRange = sel.getRangeAt(0).cloneRange();
      caretRange.collapse(true);
      const caretRect = caretRange.getBoundingClientRect();
      let caretLeft = caretRect.left;
      let caretTop = caretRect.top;
      let caretBottom = caretRect.bottom;

      if ((!caretRect.width && !caretRect.height) && sel.anchorNode?.nodeType === Node.TEXT_NODE && sel.anchorOffset > 0) {
        const probeRange = document.createRange();
        probeRange.setStart(sel.anchorNode, sel.anchorOffset - 1);
        probeRange.setEnd(sel.anchorNode, sel.anchorOffset);
        const probeRect = probeRange.getBoundingClientRect();
        if (probeRect.width || probeRect.height) {
          caretLeft = probeRect.right;
          caretTop = probeRect.top;
          caretBottom = probeRect.bottom;
        }
      }

      const menuWidth = 320;
      const left = Math.max(8, Math.min(caretLeft - hostRect.left, Math.max(8, hostRect.width - menuWidth - 8)));
      const menuMaxHeight = 360;
      const gap = 6;
      const roomBelow = hostRect.bottom - caretBottom;
      const top = roomBelow >= menuMaxHeight + gap
        ? caretBottom - hostRect.top + gap
        : Math.max(8, caretTop - hostRect.top - menuMaxHeight - gap);
      setMentionPosition({ left, top });
    }
    setMentionQuery(match[1]);
  };

  const insertMediaAtCaret = (media: LargeTextMediaItem) => {
    const editor = visualRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return;
    let range = savedRangeRef.current?.cloneRange();
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);

    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const node = range.startContainer as Text;
      const before = node.data.slice(0, range.startOffset);
      const match = before.match(/@([^@\s]*)$/);
      if (match) {
        const start = range.startOffset - match[0].length;
        node.deleteData(start, match[0].length);
        range.setStart(node, start);
        range.collapse(true);
      }
    }

    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.dataset.mediaToken = media.token;
    chip.dataset.mediaUrl = media.url;
    chip.dataset.mediaType = media.mediaType;
    const theme = getLargeMediaTheme(media.mediaType);
    chip.style.cssText = `display:inline-flex;align-items:center;gap:5px;height:28px;margin:1px 2px;padding:2px 8px 2px 3px;border:1px solid ${theme.border};background:${theme.background};color:${theme.text};border-radius:7px;font-weight:600;vertical-align:middle;white-space:nowrap;`;
    const thumb = thumbMap[media.url];
    const fallbackIcon = getLargeMediaFallbackIconHtml(media.mediaType);
    chip.innerHTML = `<span data-media-thumb="1" style="width:24px;height:22px;display:grid;place-items:center;overflow:hidden;border-radius:4px;background:${theme.soft};flex:0 0 24px;">${thumb ? `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover;display:block;"/>` : `<span style="line-height:0;display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:${theme.text};">${fallbackIcon}</span>`}</span><span>${escapeHtmlForLargeEditor(media.label)}</span>`;
    range.insertNode(chip);
    const space = document.createTextNode(' ');
    chip.after(space);
    const nextRange = document.createRange();
    nextRange.setStartAfter(space);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    savedRangeRef.current = nextRange.cloneRange();
    const nextDraft = serializeLargeVisualEditor(editor);
    visualSourceRef.current = nextDraft;
    setDraft(nextDraft);
    setMentionQuery(null);
    setMentionPosition(null);
  };

  const closeAndSave = () => {
    const finalText = visualMode ? serializeLargeVisualEditor(visualRef.current) : draft;
    onSave(finalText);
    onClose();
  };

  const switchMode = (nextVisual: boolean) => {
    if (nextVisual === visualMode) return;
    const currentText = visualMode ? serializeLargeVisualEditor(visualRef.current) : draft;
    visualSourceRef.current = currentText;
    setDraft(currentText);
    setVisualMode(nextVisual);
    setMentionQuery(null);
    setMentionPosition(null);
  };

  const handleTemporaryReferenceChange = (fieldId: string) => {
    const nextId = fieldId || null;
    setTemporaryReferenceFieldId(nextId);
    setMentionQuery(null);
    setMentionPosition(null);
    if (!isAiText) setVisualMode(!!nextId);
  };

  const navigateRow = (direction: -1 | 1) => {
    if (!onNavigateRow) return;
    if (direction < 0 && recordPosition <= 1) return;
    if (direction > 0 && recordPosition >= recordCount) return;
    const finalText = visualMode ? serializeLargeVisualEditor(visualRef.current) : draft;
    onNavigateRow(direction, finalText, temporaryReferenceFieldId);
    onClose();
  };

  const previewItems = mediaItems.map(m => m.item);
  const filteredMentionItems = mentionQuery === null ? [] : mediaItems.filter(m => {
    const q = mentionQuery.toLowerCase();
    return !q || m.label.toLowerCase().includes(q) || m.sourceFieldName.toLowerCase().includes(q) || String(m.item?.name || m.url).toLowerCase().includes(q);
  });

  const mentionGroups = (['image', 'audio', 'video'] as DetectedMediaType[])
    .map(type => ({ type, items: filteredMentionItems.filter(item => item.mediaType === type) }))
    .filter(group => group.items.length > 0);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2147483000] bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-5" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAndSave(); }}>
      <div
        className="w-[92vw] max-w-[1500px] h-[88vh] min-h-[620px] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const target = e.target as HTMLElement;
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable || !!target.closest('[contenteditable="true"]')) {
            // 文本编辑器的 Enter / Delete / Backspace / Ctrl+A/C/X/V/Z/Y 等全部交还浏览器原生编辑行为。
            e.stopPropagation();
          }
        }}
      >
        <div className="h-12 shrink-0 border-b border-gray-200 px-4 flex items-center gap-3 bg-gray-50/80">
          <Maximize2 className="w-4 h-4 text-gray-500" />
          <div className="font-semibold text-gray-800 truncate">{field.name}</div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-500">{isAiText ? (lang === 'en' ? 'Smart Text' : '智能文本') : (lang === 'en' ? 'Text' : '文本')}</span>
          <div className="ml-auto flex items-center gap-2">
            {canSelectTemporaryReference && temporaryReferenceFieldOptions.length > 0 && (
              <div className="h-8 flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2">
                <Link className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="text-[10px] text-gray-400 shrink-0">{lang === 'en' ? 'Temp reference' : '临时参考'}</span>
                <select
                  value={temporaryReferenceFieldId || ''}
                  onChange={(e) => handleTemporaryReferenceChange(e.target.value)}
                  className="max-w-[220px] min-w-[130px] bg-transparent outline-none text-xs text-gray-700 cursor-pointer"
                  title={lang === 'en' ? 'Temporarily inherit the selected smart field media context' : '临时继承所选智能字段当前行的媒体上下文'}
                >
                  <option value="">{lang === 'en' ? 'None' : '不使用'}</option>
                  {temporaryReferenceFieldOptions.map(refField => (
                    <option key={refField.id} value={refField.id}>
                      {refField.name} · {refField.type === 'aiText' ? (lang === 'en' ? 'Smart Text' : '智能文本') : refField.type === 'aiImage' ? (lang === 'en' ? 'AI Image' : '智能图片') : (lang === 'en' ? 'AI Video' : '智能视频')}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {onNavigateRow && (
              <div className="h-8 flex items-center rounded-md border border-gray-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => navigateRow(-1)}
                  disabled={recordPosition <= 1}
                  className="h-full px-2 flex items-center gap-1 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default"
                  title={lang === 'en' ? 'Previous row' : '上一行'}
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> {lang === 'en' ? 'Prev' : '上一行'}
                </button>
                <span className="px-2 text-[10px] text-gray-400 border-x border-gray-100">{recordPosition} / {recordCount}</span>
                <button
                  type="button"
                  onClick={() => navigateRow(1)}
                  disabled={recordPosition >= recordCount}
                  className="h-full px-2 flex items-center gap-1 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default"
                  title={lang === 'en' ? 'Next row' : '下一行'}
                >
                  {lang === 'en' ? 'Next' : '下一行'} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {isAiText && onGenerate && (
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const finalText = visualMode ? serializeLargeVisualEditor(visualRef.current) : draft;
                  onSave(finalText);
                  onClose();
                  onGenerate();
                }}
                className="h-8 px-3 rounded-md border border-gray-200 bg-white text-gray-400 hover:bg-gradient-to-r hover:from-purple-500 hover:to-indigo-500 hover:text-white flex items-center gap-1.5 text-xs font-medium transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" /> {lang === 'en' ? 'Regenerate' : '重新生成'}
              </button>
            )}
            <button onClick={closeAndSave} className="w-8 h-8 rounded-md hover:bg-gray-200 text-gray-500 flex items-center justify-center" title={lang === 'en' ? 'Close and save' : '关闭并保存'}><X className="w-4 h-4" /></button>
          </div>
        </div>

        {canUseVisualReferences && mediaItems.length > 0 && (
          <div className="shrink-0 px-5 pt-4 pb-3 border-b border-gray-100 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-medium text-gray-500">{lang === 'en' ? 'Referenced media in this row' : '当前行引用媒体'}</div>
              <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
                <button onClick={() => switchMode(false)} className={cn('px-3 py-1 text-[10px] rounded', !visualMode ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>{lang === 'en' ? 'Raw' : '纯文本'}</button>
                <button onClick={() => switchMode(true)} className={cn('px-3 py-1 text-[10px] rounded', visualMode ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>{lang === 'en' ? 'Visual' : '引用渲染'}</button>
              </div>
            </div>
            <div className="flex items-start gap-2 overflow-x-auto pb-1">
              {mediaItems.map((media, index) => (
                <button
                  key={`${media.url}-${index}`}
                  type="button"
                  onClick={() => onPreviewImage(media.url, previewItems, undefined, record.id, index)}
                  className="group relative w-[72px] shrink-0 text-left"
                  title={`${media.sourceFieldName} · ${media.label}`}
                >
                  <div className={cn(
                    "relative w-[72px] h-[72px] rounded border bg-gray-100 overflow-hidden group-hover:ring-2",
                    media.mediaType === 'image' ? "border-blue-200 group-hover:ring-blue-700/30" :
                    media.mediaType === 'audio' ? "border-purple-200 group-hover:ring-purple-700/30" :
                    "border-pink-200 group-hover:ring-pink-700/30"
                  )}>
                    <div className="relative w-full h-full">
                      <ThumbnailImage path={media.url} alt={media.label} className="w-full h-full object-cover rounded" />
                      {media.mediaType === 'video' && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/20 rounded pointer-events-none">
                          <Play className="w-5 h-5 text-white/80 fill-white/70 drop-shadow" />
                        </span>
                      )}
                    </div>
                    <span className={cn(
                      "absolute left-1 bottom-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center shadow-sm",
                      media.mediaType === 'image' ? "bg-blue-700" : media.mediaType === 'audio' ? "bg-purple-700" : "bg-pink-700"
                    )}>{media.sequence}</span>
                    {media.item?.cropData && (
                      <span className="absolute top-0.5 right-0.5 bg-black/40 backdrop-blur-sm text-white/90 rounded-[2px] p-[2px]">
                        {media.item.cropData.isOutpaint ? <Expand className="w-2.5 h-2.5" /> : <Crop className="w-2.5 h-2.5" />}
                      </span>
                    )}
                  </div>
                  <div className={cn(
                    "mt-1 text-[10px] font-medium truncate",
                    media.mediaType === 'image' ? "text-blue-700" : media.mediaType === 'audio' ? "text-purple-700" : "text-pink-700"
                  )}>{media.label}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {canUseVisualReferences && mediaItems.length === 0 && (
          <div className="shrink-0 px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">{isAiText ? (lang === 'en' ? 'No referenced media in this row.' : '当前行未引入媒体附件。') : (lang === 'en' ? 'The selected smart field has no media context in this row.' : '当前行所选智能节点没有可用媒体。')}</span>
            <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
              <button onClick={() => switchMode(false)} className={cn('px-3 py-1 text-[10px] rounded', !visualMode ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>{lang === 'en' ? 'Raw' : '纯文本'}</button>
              <button onClick={() => switchMode(true)} className={cn('px-3 py-1 text-[10px] rounded', visualMode ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500')}>{lang === 'en' ? 'Visual' : '引用渲染'}</button>
            </div>
          </div>
        )}

        <div className="relative flex-1 min-h-0 p-5 bg-gray-50/40">
          {!visualMode || !canUseVisualReferences ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => { setDraft(e.target.value); visualSourceRef.current = e.target.value; }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                  e.preventDefault();
                  onSave(draft);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeAndSave();
                }
              }}
              className="w-full h-full resize-none rounded-lg border border-gray-200 bg-white px-5 py-4 outline-none focus:ring-0 focus:border-gray-200 text-[14px] leading-7 text-gray-800 font-mono shadow-sm"
              spellCheck={false}
            />
          ) : (
            <div className="relative h-full">
              <div
                ref={visualRef}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onInput={() => {
                  const nextValue = serializeLargeVisualEditor(visualRef.current);
                  visualSourceRef.current = nextValue;
                  setDraft(nextValue);
                  detectMention();
                }}
                onKeyUp={(e) => { rememberRange(); detectMention(); if (e.key === 'Escape') { setMentionQuery(null); setMentionPosition(null); } }}
                onMouseUp={rememberRange}
                onFocus={rememberRange}
                onScroll={() => { if (mentionQuery !== null) detectMention(); }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    onSave(serializeLargeVisualEditor(visualRef.current));
                  } else if (e.key === 'Escape' && mentionQuery === null) {
                    e.preventDefault();
                    closeAndSave();
                  }
                }}
                className="w-full h-full overflow-auto rounded-lg border border-gray-200 bg-white px-5 py-4 outline-none focus:ring-0 focus:border-gray-200 text-[14px] leading-7 text-gray-800 font-mono shadow-sm whitespace-pre-wrap break-words"
              />
              {mentionQuery !== null && filteredMentionItems.length > 0 && (
                <div
                  className="absolute w-[320px] max-h-[360px] overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl z-20 p-1.5"
                  style={{ left: mentionPosition?.left ?? 8, top: mentionPosition?.top ?? 8 }}
                >
                  <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-400">{lang === 'en' ? 'Insert referenced media' : '插入引用媒体'}</div>
                  {mentionGroups.map((group, groupIndex) => {
                    const theme = getLargeMediaTheme(group.type);
                    return (
                      <div key={group.type}>
                        {groupIndex > 0 && <div className="h-px bg-gray-100 my-1" />}
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: theme.text }}>
                          {lang === 'en' ? theme.groupLabelEn : theme.groupLabel}
                        </div>
                        {group.items.map((media, index) => (
                          <button
                            key={`${media.url}-mention-${group.type}-${index}`}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={() => insertMediaAtCaret(media)}
                            className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 text-left"
                          >
                            <div
                              className="w-10 h-8 rounded border overflow-hidden shrink-0 flex items-center justify-center"
                              style={{ borderColor: theme.border, background: theme.soft, color: theme.text }}
                            >
                              {media.mediaType === 'audio' ? (
                                // @ 菜单尺寸很小，且已有“音频”分类与文字标签：这里只保留干净的音频色块，不叠加遮罩/音符。
                                <span className="block w-full h-full bg-gradient-to-br from-slate-800 to-indigo-900" />
                              ) : (
                                // @ 菜单里的图片/视频只展示缩略图本身；视频不再额外叠加半透明遮罩和播放符号。
                                <ThumbnailImage path={media.url} alt={media.label} className="w-full h-full object-cover" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate" style={{ color: theme.text }}>{media.label}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-9 shrink-0 border-t border-gray-200 bg-white px-5 flex items-center text-[10px] text-gray-400">
          <span>{draft.length.toLocaleString()} {lang === 'en' ? 'characters' : '字符'}</span>
          {canUseVisualReferences && <span className="ml-4">{lang === 'en' ? 'Visual mode: type @ to insert media.' : '引用渲染：输入 @ 可插入当前参考媒体。'}</span>}
          <span className="ml-auto">Ctrl / Cmd + S</span>
        </div>
      </div>
    </div>,
    document.body
  );
};

interface CellProps {
  key?: React.Key;
  record: BaseRecord;
  field: Field;
  isActive: boolean;
  forceEdit?: boolean;
  isGeneratingCol?: boolean;
  searchQuery?: string;
  isSearchMatch?: boolean;
  isSearchMatchActive?: boolean;
  onActivate: () => void;
  onChange: (value: any) => void;
  onBlur: () => void;
  onPreviewImage: (url: string, items?: any[], onUpdate?: (newItems: any[]) => void, sourceRecordId?: string, preferredIndex?: number) => void;
  allFields: Field[];
  modelSettings: any;
  heightClass: string;
  onUpdateField: (updates: Partial<Field>) => void;
  isSelectedBox: boolean;
  isCutBox: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onActivateNextRow: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onBatchAIGenerate?: () => void;
  frozenLeftOffset?: number;
  isFrozenLast?: boolean;
  lang?: 'en' | 'zh';
  globalAttachmentPropsMap?: Map<string, AttachmentReviewProps>;
  isLinked?: boolean;
  isLinkedTop?: boolean;
  isLinkedBottom?: boolean;
  recordPosition: number;
  recordCount: number;
  largeTextOpenRequest?: { temporaryReferenceFieldId?: string | null };
  onConsumeLargeTextOpenRequest?: () => void;
  onNavigateLargeTextRow?: (direction: -1 | 1, currentValue: string, temporaryReferenceFieldId: string | null) => void;
}

const Cell = React.memo(
function Cell({ record, field, isActive, forceEdit, isGeneratingCol, searchQuery, isSearchMatch, isSearchMatchActive, onActivate, onChange, onBlur, onPreviewImage, allFields, modelSettings, heightClass, onUpdateField, isSelectedBox, isCutBox, onMouseDown, onMouseEnter, onActivateNextRow, onContextMenu, onBatchAIGenerate, frozenLeftOffset, isFrozenLast, lang = 'zh', globalAttachmentPropsMap, isLinked, isLinkedTop, isLinkedBottom, recordPosition, recordCount, largeTextOpenRequest, onConsumeLargeTextOpenRequest, onNavigateLargeTextRow }: CellProps) {
  const value = record[field.id];
  const isElectron = !!((window as any).electronAPI || (window as any).electron);
  
  const [isEditingMode, setIsEditingMode] = useState(false);

  const [localText, setLocalText] = useState('');
  const [isLargeTextEditorOpen, setIsLargeTextEditorOpen] = useState(false);
  const [largeTextInitialValue, setLargeTextInitialValue] = useState('');
  const [largeTextTemporaryReferenceFieldId, setLargeTextTemporaryReferenceFieldId] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) setIsEditingMode(false);
  }, [isActive]);

  useEffect(() => {
    if (forceEdit && isActive && !isEditingMode) {
      if (['text', 'aiText', 'url', 'number', 'date'].includes(field.type)) {
         const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
         setLocalText(String(v ?? ''));
      }
      setIsEditingMode(true);
    }
  }, [forceEdit, isActive, isEditingMode, field.type, value]);

  useEffect(() => {
    if (!isEditingMode && (field.type === 'text' || field.type === 'url' || field.type === 'aiText' || field.type === 'number' || field.type === 'date')) {
      const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
      setLocalText(String(v ?? ''));
    }
  }, [isEditingMode, value, field.type]);

  // 行间切换大屏编辑时必须在浏览器绘制前接管下一行的弹窗。
  // 若使用普通 useEffect，会先绘制一帧“旧弹窗已关闭、下一行弹窗尚未打开”的表格，
  // Electron/Chromium 下表现为整屏闪一下；layout effect 可让交接在同一帧内完成。
  React.useLayoutEffect(() => {
    if (!largeTextOpenRequest || !['text', 'aiText'].includes(field.type)) return;
    const current = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    setLargeTextInitialValue(current);
    setLargeTextTemporaryReferenceFieldId(largeTextOpenRequest.temporaryReferenceFieldId || null);
    setLocalText(current);
    setIsEditingMode(false);
    setIsLargeTextEditorOpen(true);
    onConsumeLargeTextOpenRequest?.();
  }, [largeTextOpenRequest]);
  
  const latestLocalTextRef = useRef(localText);
  latestLocalTextRef.current = localText;
  
  useEffect(() => {
     if (!isEditingMode) return;
     if (field.type !== 'text' && field.type !== 'url' && field.type !== 'aiText' && field.type !== 'number' && field.type !== 'date') return;
     const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
     if (String(v ?? '') === latestLocalTextRef.current) return;
     
     const handler = setTimeout(() => {
        let finalVal: any = latestLocalTextRef.current;
        if (field.type === 'number') {
           finalVal = finalVal === '' ? null : Number(finalVal);
        }
        onChange(finalVal);
     }, 300);
     return () => clearTimeout(handler);
  }, [localText, isEditingMode, onChange, field.type, value]);

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

  const openLargeTextEditor = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const current = isEditingMode
      ? localText
      : (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''));
    if (isEditingMode) onChange(current);
    setLargeTextInitialValue(current);
    setLargeTextTemporaryReferenceFieldId(null);
    setLocalText(current);
    setIsEditingMode(false);
    onActivate();
    setIsLargeTextEditorOpen(true);
  };

  const saveLargeTextEditor = (nextValue: string) => {
    setLargeTextInitialValue(nextValue);
    setLocalText(nextValue);
    onChange(nextValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isActive) return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable || !!target.closest('[contenteditable="true"]')) {
      // 原生文本编辑区域不交给单元格层处理，保证 Enter / Backspace / Delete / Ctrl+A/C/X/V/Z/Y 等正常。
      return;
    }
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
            value={localText}
            onChange={(e) => {
              setLocalText(e.target.value);
            }}
            onBlur={(e) => {
              const val = e.target.value === '' ? null : Number(e.target.value);
              onChange(val);
              setIsEditingMode(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const val = (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value);
                onChange(val);
                setIsEditingMode(false);
                onActivateNextRow();
                e.stopPropagation();
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
            value={localText}
            onChange={(e) => setLocalText(e.target.value)}
            onBlur={(e) => {
              onChange(e.target.value);
              setIsEditingMode(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onChange((e.target as HTMLInputElement).value);
                setIsEditingMode(false);
                onActivateNextRow();
                e.stopPropagation();
              } else if (e.key === 'Escape') {
                setIsEditingMode(false);
                e.stopPropagation();
              }
            }}
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
      if (field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') {
        return (
          <AttachmentCellEditor 
            value={value} 
            onChange={onChange} 
            onClose={() => setIsEditingMode(false)}
            onPreview={(url, items, update, preferredIndex) => onPreviewImage(url, items, update, record.id, preferredIndex)}
            globalAttachmentPropsMap={globalAttachmentPropsMap}
          />
        );
      }
    }

    // Read only view
    switch (field.type) {
      case 'attachment': {
        let fileItems: any[] = [];
        if (Array.isArray(value)) {
          fileItems = value.map((v: any) => {
             const base = typeof v === 'string' ? { url: v } : v;
             const { mappedUrl, ...cleanV } = base;
             const itemObj = cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
             const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(itemObj.url));
             return globalProps ? { ...itemObj, ...globalProps } : itemObj;
          });
        } else if (typeof value === 'string' && value.trim() !== '') {
          fileItems = value.split(',').map(s => {
             const url = s.trim();
             const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(url));
             return globalProps ? { url, ...globalProps } : { url };
          });
        } else if (typeof value === 'object' && value !== null) {
          const base = typeof value === 'string' ? { url: value } : value;
          const { mappedUrl, ...cleanV } = base as any;
          const itemObj = cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
          const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(itemObj.url));
          fileItems = [globalProps ? { ...itemObj, ...globalProps } : itemObj];
        }
        
        let imgSizeClass = 'h-[24px] w-[24px]';
        let containerHeightClass = 'h-[26px]';
        if (heightClass === 'h-[40px]') { imgSizeClass = 'h-[28px] w-[28px]'; containerHeightClass = 'h-[30px]'; }
        else if (heightClass === 'h-[56px]') { imgSizeClass = 'h-[44px] w-[44px]'; containerHeightClass = 'h-[46px]'; }
        else if (heightClass === 'h-[80px]') { imgSizeClass = 'h-[68px] w-[68px]'; containerHeightClass = 'h-[70px]'; }
        else if (heightClass === 'h-[120px]') { imgSizeClass = 'h-[108px] w-[108px]'; containerHeightClass = 'h-[110px]'; }

        return (
          <div 
             className="px-1 h-full flex items-center cursor-pointer flex-wrap gap-1 py-1 relative"
             onClick={(e) => { e.stopPropagation(); onActivate(); if (isActive) setIsEditingMode(true); }}
          >
             {fileItems.length === 0 ? (
               <div className="text-gray-300 w-full text-center">+</div>
             ) : (
               <div className={`flex items-center gap-1 overflow-hidden w-full ${containerHeightClass}`}>
                  {fileItems.map((item, i) => {
                    if (item.type === 'networkJob') {
                       return (
                         <div key={i} className={`flex items-center justify-center shrink-0 border border-gray-200 bg-blue-50/50 rounded ${imgSizeClass}`} title={`Job ID: ${item.jobId}`}>
                           <Sparkles className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                         </div>
                       );
                    }
                    const path = item.url;
                    let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:[\\/]/) || path.startsWith('\\\\') ? `file://${path}` : path);
                    const pendingCount = item.annotations?.filter((a: any) => a.status === 'pending').length || 0;
                    const resolvedCount = item.annotations?.filter((a: any) => a.status === 'resolved').length || 0;
                    const approvedCount = item.annotations?.filter((a: any) => a.status === 'approved').length || 0;
                    
                    return (
                      <div key={i} className="relative group/img-item shrink-0">
                        <ThumbnailImage 
                          path={path}
                          alt={path.split('/').pop()?.split('\\').pop() || 'image'} 
                          className={`${imgSizeClass} object-cover rounded border border-gray-200 bg-gray-100 cursor-pointer`} 
                          title={path}
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            onPreviewImage(fullUrl, fileItems, (newItems) => onChange(newItems), record.id, i); 
                          }}
                        />
                        {item.cropData && (
                          <div className="absolute top-0.5 right-0.5 bg-black/40 backdrop-blur-sm text-white/90 rounded-[2px] p-[2px] text-[10px] flex items-center justify-center pointer-events-none">
                            {item.cropData.isOutpaint ? <Expand className="w-2.5 h-2.5" /> : <Crop className="w-2.5 h-2.5" />}
                          </div>
                        )}
                        {(field.type === 'aiVideo' || item.url.match(/\.(mp4|webm|mov)$/i)) && (
                           <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20 rounded">
                              <Play className="w-4 h-4 text-white/90 drop-shadow-md fill-white/90" />
                           </div>
                        )}
                        {(pendingCount > 0 || resolvedCount > 0 || approvedCount > 0) && (
                          <div className="absolute -top-1 -right-1 flex gap-0.5 z-10 pointer-events-none drop-shadow-md">
                             {pendingCount > 0 && <span className="bg-red-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                             {resolvedCount > 0 && <span className="bg-yellow-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                             {approvedCount > 0 && <span className="bg-green-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                          </div>
                        )}
                        {item.rating > 0 && (
                          <div className="absolute bottom-0 left-0 flex items-center gap-0.5 z-10 pointer-events-none bg-black/40 backdrop-blur-sm rounded-tr px-1 py-0.5">
                             <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                             <span className="text-[10px] text-white font-bold leading-none">{item.rating}</span>
                          </div>
                        )}
                        <div className="absolute top-0.5 right-0.5 bg-white/80 text-gray-700 rounded p-0.5 opacity-0 group-hover/img-item:opacity-100 flex items-center gap-1 shadow-sm z-10 transition-opacity">
                          {isElectron && (
                             <button onClick={(e) => {
                               e.stopPropagation();
                               const psPath = localStorage.getItem('bitable_ps_path');
                               const localPath = path.startsWith('file://') ? decodeURIComponent(path.replace('file://', '')) :
                                                path.startsWith('local-img://') ? decodeURIComponent(path.replace('local-img://', '')) : path;
                               (window as any).electronAPI?.openInPhotoshop?.(localPath, psPath);
                             }} title="Edit in Photoshop">
                                <Palette className="w-3.5 h-3.5 hover:text-indigo-500 text-gray-500" />
                             </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); copyImageToClipboardMagic(path); }} title="Copy">
                             <Copy className="w-3.5 h-3.5 hover:text-blue-500" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const updated = fileItems.filter((_, idx) => idx !== i);
                              onChange(updated.length > 0 ? updated : '');
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
      case 'aiVideo':
      case 'aiImage': {
        let fileItems: any[] = [];
        if (Array.isArray(value)) {
          fileItems = value.map((v: any) => {
             const base = typeof v === 'string' ? { url: v } : v;
             const { mappedUrl, ...cleanV } = base;
             const itemObj = cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
             const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(itemObj.url));
             return globalProps ? { ...itemObj, ...globalProps } : itemObj;
          });
        } else if (typeof value === 'string' && value.trim() !== '') {
          fileItems = value.split(',').map(s => {
             const url = s.trim();
             const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(url));
             return globalProps ? { url, ...globalProps } : { url };
          });
        }
        
        let imgSizeClass = 'h-[24px] w-[24px]';
        let containerHeightClass = 'h-[26px]';
        if (heightClass === 'h-[40px]') { imgSizeClass = 'h-[28px] w-[28px]'; containerHeightClass = 'h-[30px]'; }
        else if (heightClass === 'h-[56px]') { imgSizeClass = 'h-[44px] w-[44px]'; containerHeightClass = 'h-[46px]'; }
        else if (heightClass === 'h-[80px]') { imgSizeClass = 'h-[68px] w-[68px]'; containerHeightClass = 'h-[70px]'; }
        else if (heightClass === 'h-[120px]') { imgSizeClass = 'h-[108px] w-[108px]'; containerHeightClass = 'h-[110px]'; }

        const networkJobItems = fileItems.filter(isNetworkJobCellItem);
        const completedMediaItems = fileItems.filter(item => !isNetworkJobCellItem(item));
        const showFullGenerating = isGeneratingCol || (networkJobItems.length > 0 && completedMediaItems.length === 0);

        return (
          <div className="px-1 py-1 h-full flex flex-col justify-center relative group/ai w-full overflow-hidden">
             {showFullGenerating ? (
               <div className="flex items-center gap-1.5 text-blue-500 font-medium text-xs px-1">
                 <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                 <span>Generating...</span>
               </div>
             ) : fileItems.length > 0 ? (
               <div className={`flex items-center gap-1 overflow-hidden w-full ${containerHeightClass}`}>
                  {fileItems.map((item, i) => {
                    if (item.type === 'networkJob') {
                       return (
                         <div key={i} className={`flex items-center justify-center shrink-0 border border-gray-200 bg-blue-50/50 rounded ${imgSizeClass}`} title={`Job ID: ${item.jobId}`}>
                           <Sparkles className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                         </div>
                       );
                    }
                    const path = item.url;
                    let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:[\\/]/) || path.startsWith('\\\\') ? `file://${path}` : path);
                    const pendingCount = item.annotations?.filter((a: any) => a.status === 'pending').length || 0;
                    const resolvedCount = item.annotations?.filter((a: any) => a.status === 'resolved').length || 0;
                    const approvedCount = item.annotations?.filter((a: any) => a.status === 'approved').length || 0;

                    return (
                      <div key={i} className="relative group/img-item shrink-0">
                        <ThumbnailImage 
                          path={path}
                          alt="ai-generated" 
                          className={`${imgSizeClass} object-cover rounded border border-gray-200 bg-gray-100 cursor-pointer`} 
                          title={path}
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            onPreviewImage(fullUrl, fileItems, (newItems) => onChange(newItems), record.id, i); 
                          }}
                        />
                        {item.cropData && (
                          <div className="absolute top-0.5 right-0.5 bg-black/40 backdrop-blur-sm text-white/90 rounded-[2px] p-[2px] text-[10px] flex items-center justify-center pointer-events-none">
                            {item.cropData.isOutpaint ? <Expand className="w-2.5 h-2.5" /> : <Crop className="w-2.5 h-2.5" />}
                          </div>
                        )}
                        {(field.type === 'aiVideo' || item.url.match(/\.(mp4|webm|mov)$/i)) && (
                           <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20 rounded">
                              <Play className="w-4 h-4 text-white/90 drop-shadow-md fill-white/90" />
                           </div>
                        )}
                        {(pendingCount > 0 || resolvedCount > 0 || approvedCount > 0) && (
                          <div className="absolute -top-1 -right-1 flex gap-0.5 z-10 pointer-events-none drop-shadow-md">
                             {pendingCount > 0 && <span className="bg-red-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                             {resolvedCount > 0 && <span className="bg-yellow-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                             {approvedCount > 0 && <span className="bg-green-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                          </div>
                        )}
                        {item.rating > 0 && (
                          <div className="absolute bottom-0 left-0 flex items-center gap-0.5 z-10 pointer-events-none bg-black/40 backdrop-blur-sm rounded-tr px-1 py-0.5">
                             <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                             <span className="text-[10px] text-white font-bold leading-none">{item.rating}</span>
                          </div>
                        )}
                        <div className="absolute top-0.5 right-0.5 bg-white/80 text-gray-700 rounded p-0.5 opacity-0 group-hover/img-item:opacity-100 flex items-center gap-1 shadow-sm z-10 transition-opacity">
                          {isElectron && (
                             <button onClick={(e) => {
                               e.stopPropagation();
                               const psPath = localStorage.getItem('bitable_ps_path');
                               const localPath = path.startsWith('file://') ? decodeURIComponent(path.replace('file://', '')) :
                                                path.startsWith('local-img://') ? decodeURIComponent(path.replace('local-img://', '')) : path;
                               (window as any).electronAPI?.openInPhotoshop?.(localPath, psPath);
                             }} title="Edit in Photoshop">
                                <Palette className="w-3.5 h-3.5 hover:text-indigo-500 text-gray-500" />
                             </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); copyImageToClipboardMagic(path); }} title="Copy">
                             <Copy className="w-3.5 h-3.5 hover:text-blue-500" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const updated = fileItems.filter((_, idx) => idx !== i);
                              onChange(updated.length > 0 ? updated : '');
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
      case 'rating': {
        const rating = parseInt(value) || 0;
        return (
          <div className="flex h-full items-center justify-start px-2 cursor-pointer gap-0.5" onClick={(e) => { e.stopPropagation(); onActivate(); }}>
            {[1, 2, 3, 4, 5].map(v => (
              <Star 
                key={v} 
                className={cn("w-4 h-4 transition-colors", rating >= v ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 hover:text-gray-400')} 
                onClick={(e) => { e.stopPropagation(); onChange(rating === v ? 0 : v); onActivate(); }}
              />
            ))}
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
                 <HighlightedText text={option.name} query={searchQuery} />
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
                  <HighlightedText text={option.name} query={searchQuery} />
                </span>
              );
            }) : null}
          </div>
        );
      }
      case 'number':
        return <div className="px-2 h-full flex items-center justify-end truncate"><HighlightedText text={String(value ?? '')} query={searchQuery} /></div>;
      case 'url':
        return (
          <div className="px-2 py-1 h-full flex flex-col justify-center w-full overflow-hidden">
            {value ? <a href={value} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline whitespace-normal break-all overflow-hidden text-sm leading-tight w-full" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }} onClick={(e) => { e.stopPropagation(); window.open(value, '_blank'); }}><HighlightedText text={String(value)} query={searchQuery} /></a> : null}
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
                 <span className="truncate"><HighlightedText text={displayValue} query={searchQuery} /></span>
               </>
             ) : null}
           </div>
        );
      }
      case 'aiText': {
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
          displayValue = JSON.stringify(value);
        } else if (value == null) {
          displayValue = '';
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
            <span className="whitespace-normal break-all overflow-hidden text-sm leading-tight w-full pr-6" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }}><HighlightedText text={String(displayValue)} query={searchQuery} /></span>
            {!isGeneratingCol && isActive && (
               <button onMouseDown={handleAIGenerate}
                 className="absolute right-1 top-1.5 p-1 rounded bg-white shadow-sm hover:bg-gradient-to-r hover:from-purple-500 hover:to-indigo-500 hover:text-white text-gray-400 transition-all z-10 border border-gray-200"
                 title={lang === 'en' ? 'Generate again' : '再次生成'}
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
                  if (refField.type === 'singleSelect' || refField.type === 'multiSelect') {
                    if (rawVal) {
                      const valArray = Array.isArray(rawVal) ? rawVal : (typeof rawVal === 'string' ? rawVal.split(',').map(s=>s.trim()) : [rawVal]);
                      const mapped = valArray.map(v => refField.options?.find((o:any) => o.id === v)?.name || v);
                      valToUse = mapped.length === 1 && !Array.isArray(rawVal) && refField.type === 'singleSelect' ? mapped[0] : mapped.join(', ');
                    }
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

        if (displayValue == null) displayValue = '';
        
        if (isActive && isEditingMode) {
          return (
            <div className="flex h-full w-full relative">
              <textarea
                readOnly
                autoFocus
                onFocus={(e) => {
                  const len = e.target.value.length;
                  e.target.setSelectionRange(len, len);
                }}
                className="flex-1 w-full px-2 py-1.5 outline-none bg-white resize-none overflow-y-auto ring-[1.5px] ring-blue-500 ring-inset cursor-text"
                value={String(displayValue)}
                onBlur={() => {
                  setIsEditingMode(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' || (!e.shiftKey && e.key === 'Enter')) {
                     setIsEditingMode(false);
                     e.stopPropagation();
                  }
                }}
                style={{ position: 'absolute', zIndex: 30, left: -1, right: -1, top: -1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
              />
            </div>
          );
        }

        return (
          <div className="px-2 py-1 h-full flex flex-col justify-center relative w-full overflow-hidden select-none cursor-pointer text-gray-700 italic" onClick={() => { onActivate(); if (isActive) setIsEditingMode(true); }} title="Double click to expand">
            <span className="whitespace-normal break-all overflow-hidden text-sm leading-tight w-full font-medium" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }}><HighlightedText text={String(displayValue)} query={searchQuery} /></span>
          </div>
        );
      }
      default: {
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
          displayValue = JSON.stringify(value);
        } else if (value == null) {
          displayValue = '';
        }
        return (
          <div className={cn("px-2 py-1 h-full flex flex-col justify-center w-full overflow-hidden select-none", field.type === 'text' && "pr-6")}>
            <span className="whitespace-normal break-all overflow-hidden text-sm leading-tight w-full" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }}><HighlightedText text={String(displayValue)} query={searchQuery} /></span>
          </div>
        );
      }
    }
  };

  return (
    <td
      id={`cell-${record.id}-${field.id}`}
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragOver={(e) => {
         if ((field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') && (isActive || isSelectedBox)) {
           e.preventDefault();
           e.stopPropagation();
         }
      }}
      onDrop={(e) => {
         if ((field.type === 'attachment' || field.type === 'aiImage' || field.type === 'aiVideo') && (isActive || isSelectedBox)) {
           e.preventDefault();
           e.stopPropagation();
           if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
             const files = Array.from(e.dataTransfer.files).filter((f: any) => f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/'));
             if (files.length > 0) {
               let existingItems: any[] = [];
               if (Array.isArray(value)) {
                 existingItems = [...value];
               } else if (typeof value === 'string' && value.trim() !== '') {
                 existingItems = value.split(',').map(s => ({ url: s.trim() }));
               } else if (typeof value === 'object' && value !== null) {
                 existingItems = [value];
               }

               const fileObjects = files.map((file: any) => {
                 const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
                 getOrGenerateThumbnail(pathStr, file);
                 if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:[\\/]/) && !pathStr.startsWith('\\\\')) {
                   fullImageBlobCache.set(pathStr, URL.createObjectURL(file));
                 }
                 return { url: pathStr };
               });

               const newValue = [...existingItems, ...fileObjects];
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
      onContextMenu={onContextMenu}
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
        "border-b border-r border-gray-200 relative p-0 transition-colors cursor-cell group/cell group-hover:bg-gray-50",
        heightClass,
        isSelectedBox && !isEditingMode ? "bg-[#ebf4ff] group-hover:bg-[#e1effe]" : (isSearchMatch && !isEditingMode ? "bg-blue-100" : "bg-white"),
        isSearchMatchActive && !isEditingMode && "ring-[2px] ring-blue-400 z-10",
        isCutBox && !isEditingMode && "opacity-50 ring-1 ring-dashed ring-gray-400 ring-inset",
        isActive && !isEditingMode && "ring-[1.5px] ring-blue-500 ring-inset z-20 outline-none",
        frozenLeftOffset !== undefined ? (isActive ? "sticky z-[32]" : "sticky z-[31]") : "",
        isFrozenLast && frozenLeftOffset !== undefined ? "shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" : ""
      )}
      data-cell-editing={isEditingMode ? 'true' : undefined}
      style={{ left: frozenLeftOffset }}
    >
      {isLinked && !isEditingMode && !isActive && !isSelectedBox && (
          <div className="absolute inset-0 pointer-events-none z-[11]" style={{
             boxShadow: [
               'inset 1px 0 0 0 #c084fc', 
               'inset -1px 0 0 0 #c084fc',
               isLinkedTop ? 'inset 0 1px 0 0 #c084fc' : '',
               isLinkedBottom ? 'inset 0 -1px 0 0 #c084fc' : ''
             ].filter(Boolean).join(', ')
          }}></div>
      )}
      {renderContent()}
      {(field.type === 'text' || field.type === 'aiText') && !isEditingMode && (
        <button
          type="button"
          onMouseDown={openLargeTextEditor}
          className={cn(
            "cell-large-editor-button absolute right-1 bottom-1 z-[45] w-5 h-5 rounded bg-gray-100/85 text-gray-500 hover:text-blue-600 hover:bg-gray-200 flex items-center justify-center transition-colors",
            isActive ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100"
          )}
          title={lang === 'en' ? 'Open large text editor' : '展开大屏编辑'}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      )}
      {isLargeTextEditorOpen && (
        <LargeTextEditorModal
          open={isLargeTextEditorOpen}
          field={field}
          record={record}
          allFields={allFields}
          value={largeTextInitialValue}
          lang={lang}
          onSave={saveLargeTextEditor}
          onClose={() => setIsLargeTextEditorOpen(false)}
          onGenerate={field.type === 'aiText' && onBatchAIGenerate ? () => onBatchAIGenerate() : undefined}
          onPreviewImage={onPreviewImage}
          recordPosition={recordPosition}
          recordCount={recordCount}
          initialTemporaryReferenceFieldId={largeTextTemporaryReferenceFieldId}
          onNavigateRow={onNavigateLargeTextRow}
        />
      )}
      {isLinkedTop && (
         <div className="absolute top-0 left-0 bg-purple-400 text-white rounded-br px-0.5 py-0.5 pointer-events-none z-[12] opacity-80" title={lang === 'en' ? 'Linked cell' : '联动单元格'}>
            <Link className="w-2.5 h-2.5" />
         </div>
      )}
    </td>
  );
}, (prev, next) => {
  const baseEqual = prev.field === next.field &&
    prev.record[prev.field.id] === next.record[next.field.id] &&
    prev.isActive === next.isActive &&
    prev.forceEdit === next.forceEdit &&
    prev.isGeneratingCol === next.isGeneratingCol &&
    prev.searchQuery === next.searchQuery &&
    prev.isSearchMatch === next.isSearchMatch &&
    prev.isSearchMatchActive === next.isSearchMatchActive &&
    prev.heightClass === next.heightClass &&
    prev.isSelectedBox === next.isSelectedBox &&
    prev.isCutBox === next.isCutBox &&
    prev.frozenLeftOffset === next.frozenLeftOffset &&
    prev.isFrozenLast === next.isFrozenLast &&
    prev.lang === next.lang &&
    prev.isLinked === next.isLinked &&
    prev.isLinkedTop === next.isLinkedTop &&
    prev.isLinkedBottom === next.isLinkedBottom &&
    prev.recordPosition === next.recordPosition &&
    prev.recordCount === next.recordCount &&
    prev.largeTextOpenRequest === next.largeTextOpenRequest &&
    prev.modelSettings === next.modelSettings;
    
  if (!baseEqual) return false;
  
  if (['attachment', 'aiImage', 'aiVideo'].includes(prev.field.type) && prev.globalAttachmentPropsMap !== next.globalAttachmentPropsMap) {
      const val = prev.record[prev.field.id];
      if (val) {
         let urls: string[] = [];
         if (Array.isArray(val)) urls = val.map((v: any) => typeof v === 'string' ? v : v.url);
         else if (typeof val === 'string') urls = val.split(',').map((s: string) => s.trim());
         else if (typeof val === 'object') urls = [val.url];
         
         for (const u of urls) {
            if (u) {
               const pVal = prev.globalAttachmentPropsMap?.get(normalizeAttachmentKey(u));
               const nVal = next.globalAttachmentPropsMap?.get(normalizeAttachmentKey(u));
               if (JSON.stringify(pVal) !== JSON.stringify(nVal)) return false;
            }
         }
      }
  }
  return true;
});


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

function AttachmentCellEditor({ value, onChange, onClose, onPreview, globalAttachmentPropsMap }: { value: any, onChange: (v: any) => void, onClose: () => void, onPreview: (url: string, allUrls?: {url: string, annotations?: any[]}[], onUpdate?: (items: any[]) => void, preferredIndex?: number) => void, globalAttachmentPropsMap?: Map<string, any> }) {
  let fileItems: any[] = [];
  if (Array.isArray(value)) {
    fileItems = value.map((v: any) => {
       const base = typeof v === 'string' ? { url: v } : v;
       const { mappedUrl, ...cleanV } = base;
       const itemObj = cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
       const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(itemObj.url));
       return globalProps ? { ...itemObj, ...globalProps } : itemObj;
    });
  } else if (typeof value === 'string' && value.trim() !== '') {
    fileItems = value.split(',').map(s => {
       const url = s.trim();
       const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(url));
       return globalProps ? { url, ...globalProps } : { url };
    });
  } else if (typeof value === 'object' && value !== null) {
    const base = typeof value === 'string' ? { url: value } : value;
    const { mappedUrl, ...cleanV } = base as any;
    const itemObj = cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
    const globalProps = globalAttachmentPropsMap?.get(normalizeAttachmentKey(itemObj.url));
    fileItems = [globalProps ? { ...itemObj, ...globalProps } : itemObj];
  }

  const ref = useClickOutside(onClose);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draggedImgIndex, setDraggedImgIndex] = useState<number | null>(null);
  const [dragOverImgIndex, setDragOverImgIndex] = useState<number | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files as FileList);
      const newItems = files.map((file: any) => {
        const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
        getOrGenerateThumbnail(pathStr, file);
        if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:[\\/]/) && !pathStr.startsWith('\\\\')) {
          fullImageBlobCache.set(pathStr, URL.createObjectURL(file));
        }
        return { url: pathStr };
      });
      onChange([...fileItems, ...newItems]);
    }
  };

  const handleRemove = (index: number) => {
    const updated = fileItems.filter((_, idx) => idx !== index);
    onChange(updated.length > 0 ? updated : '');
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

      const newArr = [...fileItems];
      const [moved] = newArr.splice(draggedImgIndex, 1);
      newArr.splice(targetIndex, 0, moved);
      onChange(newArr);
      
      setDraggedImgIndex(null);
      setDragOverImgIndex(null);
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter((f: any) => f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/'));
      if (files.length > 0) {
        const newItems = files.map((file: any) => {
          // Add support for window.electronAPI.getPathForFile if exposed in preload
          const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
          getOrGenerateThumbnail(pathStr, file);
          if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:[\\/]/) && !pathStr.startsWith('\\\\')) {
            fullImageBlobCache.set(pathStr, URL.createObjectURL(file));
          }
          return { url: pathStr };
        });
        onChange([...fileItems, ...newItems]);
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
        {fileItems.map((item, index) => {
           let path = item.url;
           let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:[\\/]/) || path.startsWith('\\\\') ? `file://${path}` : path);
           
           const pendingCount = item.annotations?.filter((a: any) => a.status === 'pending').length || 0;
           const resolvedCount = item.annotations?.filter((a: any) => a.status === 'resolved').length || 0;
           const approvedCount = item.annotations?.filter((a: any) => a.status === 'approved').length || 0;

           return (
             <div 
               key={`${path}_${index}`} 
               className={cn(
                 "relative group/attachment cursor-grab active:cursor-grabbing w-[108px] h-[108px] border rounded bg-gray-50 flex items-center justify-center",
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
               onClick={() => onPreview(fullUrl, fileItems.map(p => {
                 const mappedUrl = fullImageBlobCache.get(p.url) || (p.url.startsWith('/') || p.url.match(/^[a-zA-Z]:[\\/]/) || p.url.startsWith('\\\\') ? `file://${p.url}` : p.url);
                 return { ...p, mappedUrl };
               }), (newItems) => onChange(newItems))}
             >
               <ThumbnailImage path={path} className="w-full h-full object-cover cursor-pointer rounded" alt="attachment" />
                {(pendingCount > 0 || resolvedCount > 0 || approvedCount > 0) && (
                  <div className="absolute -top-1 -right-1 flex gap-0.5 z-20 pointer-events-none drop-shadow-md">
                     {pendingCount > 0 && <span className="bg-red-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                     {resolvedCount > 0 && <span className="bg-yellow-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                     {approvedCount > 0 && <span className="bg-green-500 rounded-full w-2 h-2 shadow-sm border border-white"></span>}
                  </div>
                )}
                {item.rating > 0 && (
                  <div className="absolute bottom-0 left-0 flex items-center gap-0.5 z-20 pointer-events-none bg-black/40 backdrop-blur-sm rounded-tr px-1 py-0.5">
                     <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                     <span className="text-[10px] text-white font-bold leading-none">{item.rating}</span>
                  </div>
                )}
               {item.cropData && (
                 <div className="absolute top-0.5 right-0.5 bg-black/40 backdrop-blur-sm text-white/90 rounded-[2px] p-[2px] text-[10px] flex items-center justify-center pointer-events-none">
                   {item.cropData.isOutpaint ? <Expand className="w-2.5 h-2.5" /> : <Crop className="w-2.5 h-2.5" />}
                 </div>
               )}
               {(item.url.match(/\.(mp4|webm|mov)$/i)) && (
                   <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                      <Play className="w-10 h-10 text-white/90 drop-shadow-md fill-white/90" />
                   </div>
               )}
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
        accept="image/*,video/*,audio/*" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
      />
    </div>
  );
}
