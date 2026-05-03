import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Field, BaseRecord, GridData, SelectOption, FieldType, Attachment } from '../types';
import { FieldIcon } from './FieldIcon';
import { cn, getStringColor } from '../lib/utils';
import { Plus, GripVertical, ChevronDown, Check, Image as ImageIcon, X, Sparkles, ArrowDownUp, Trash2, Filter, Copy, Download, ChevronLeft, ChevronRight, EyeOff, Send, MessageSquare, MessageSquareText, Star } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { Parser } from 'expr-eval';

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

export const copyImageToClipboardMagic = (path: string) => {
   navigator.clipboard.writeText(`IMG_COPY_MAGIC:${path}`);
};

const ZoomableImage = ({ 
  item, 
  onPrev, 
  onNext, 
  onClose,
  onUpdateItem,
  username,
  lang = 'zh'
}: { 
  item: any, 
  onPrev: (e: React.MouseEvent) => void, 
  onNext: (e: React.MouseEvent) => void, 
  onClose: () => void,
  onUpdateItem?: (newItem: any) => void,
  username?: string,
  lang?: 'en' | 'zh'
}) => {
  const src = item.mappedUrl;
  const refUrls: string[] = item.refUrls || [];
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  
  const [refScales, setRefScales] = useState<number[]>([1, 1]);
  const [refPos, setRefPos] = useState<{x: number, y: number}[]>([{x: 0, y: 0}, {x: 0, y: 0}]);
  const [activeRefIndex, setActiveRefIndex] = useState<number | null>(null);
  
  const [refIsDragging, setRefIsDragging] = useState(false);
  const [refDragStart, setRefDragStart] = useState({ x: 0, y: 0 });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggedAnnId, setDraggedAnnId] = useState<string | null>(null);
  const [annotationViewState, setAnnotationViewState] = useState<0 | 1 | 2>(2); // 0: hidden, 1: visible, 2: visible with capsules
  
  const [annotations, setAnnotations] = useState<any[]>(item.annotations || []);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setAnnotations(item.annotations || []);
  }, [item.annotations]);

  useEffect(() => {
    setActiveAnnotationId(null);
  }, [item.url, item.mappedUrl]);

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

  return (
    <div 
      className="fixed inset-0 z-[100] flex bg-black/90 outline-none"
      onClick={(e) => {
         if ((e.target as HTMLElement).closest('.annotation-popup')) return;
         if ((e.target as HTMLElement).closest('.annotation-marker')) return;
         if (e.target === e.currentTarget) onClose();
      }}
    >
      {refUrls.length > 0 && (
         <div className="flex-1 max-w-[35%] border-r border-gray-700 flex flex-col relative bg-black/50 overflow-hidden">
            {refUrls.map((rUrl, i) => (
                <div 
                    key={i} 
                    className={`flex-1 w-full flex items-center justify-center relative overflow-hidden cursor-move ${i > 0 ? 'border-t border-gray-700' : ''}`}
                    onWheel={(e) => {
                        e.preventDefault();
                        const newScales = [...refScales];
                        newScales[i] = Math.min(Math.max(0.5, refScales[i] - e.deltaY * 0.01), 10);
                        setRefScales(newScales);
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
                </div>
            ))}
         </div>
      )}
      
      <div 
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        onWheel={(e) => {
          e.preventDefault();
          setScale(s => Math.min(Math.max(0.5, s - e.deltaY * 0.01), 10));
        }}
        onClick={(e) => {
           if ((e.target as HTMLElement).closest('.annotation-popup')) return;
           if ((e.target as HTMLElement).closest('.annotation-marker')) return;
           if (e.target === e.currentTarget) onClose();
        }}
      >
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
         <button onClick={(e) => { e.stopPropagation(); setScale(1); setPos({x: 0, y: 0}); setRefScales([1, 1]); setRefPos([{x: 0, y: 0}, {x: 0, y: 0}]); }} title="Reset Zoom" className="text-white/70 hover:text-white p-2 bg-black/50 rounded-full transition-colors">
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

      <div 
        className="relative flex items-center justify-center cursor-move"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: isDragging || draggedAnnId ? 'none' : 'transform 0.1s' }}
        onMouseDown={e => { 
           if ((e.target as HTMLElement).closest('.annotation-popup') || (e.target as HTMLElement).closest('.annotation-marker')) return;
           setIsDragging(true); 
           setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y }); 
           e.stopPropagation(); 
        }}
        onMouseMove={e => { 
           if (draggedAnnId && imgRef.current) {
              const rect = imgRef.current.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
              setAnnotations(annotations.map(a => a.id === draggedAnnId ? { ...a, x, y } : a));
           } else if (isDragging) { 
              setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); 
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
        <img 
          ref={imgRef}
          src={src} 
          className="max-w-[90vw] max-h-[90vh] object-contain pointer-events-auto" 
          draggable={false} 
          onDoubleClick={(e) => {
             e.stopPropagation();
             handleImageClick(e);
          }} 
        />
        
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

      <button onClick={onNext} className="absolute right-8 top-1/2 -translate-y-1/2 text-white/50 hover:text-white z-10 p-4">
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
  tableId?: string;
  viewMode?: 'grid' | 'gallery';
  data: GridData;
  searchQuery?: string;
  searchMatches?: { recordId: string, fieldId: string }[];
  activeSearchMatch?: { recordId: string, fieldId: string, recordIndex: number, fieldIndex: number } | null;
  onUpdateGlobalAttachment?: (url: string, updatedProps: any) => void;
  onUpdateRecord: (recordId: string, fieldId: string, value: any) => void;
  onDeleteRecords?: (recordIds: string[]) => void;
  onAddRecord: () => void;
  onInsertRecords?: (index: number, count: number) => void;
  onAddField: () => void;
  onInsertField?: (index: number, count?: number) => void;
  onFreezeColumn?: (fieldId: string | null) => void;
  onDeleteField?: (fieldId: string) => void;
  onRenameField: (fieldId: string, name: string) => void;
  onChangeFieldType: (fieldId: string, type: FieldType) => void;
  onReorderFields: (sourceId: string | string[], targetId: string) => void;
  onReorderRecords: (sourceId: string, targetId: string) => void;
  onResizeCol: (fieldId: string, width: number) => void;
  onUpdateField: (fieldId: string, updates: Partial<Field>) => void;
  onSortField?: (fieldId: string, direction: 'asc'|'desc'|null) => void;
  onFilterField?: (fieldId: string, keyword: string) => void;
  sortConfig?: { fieldId: string, direction: 'asc'|'desc' } | null;
  filterConfig?: Record<string, string>;
  groupConfig?: { fieldId: string, direction: 'asc'|'desc' }[];
  rowHeight: 'short'|'medium'|'tall'|'extra';
  modelSettings: any;
  lang?: 'en' | 'zh';
  username?: string;
  gallerySettings?: any;
  onGallerySettingsChange?: (settings: any) => void;
  foldedGroups?: string[];
  onFoldedGroupsChange?: (groups: string[]) => void;
}

const resolveFieldValueForAI = (val: any, refField: Field) => {
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
      val = resolveFieldValueForAI(val, f);
      if (Array.isArray(val)) val = val.map(v => v?.name || String(v?.url || v)).join(', ');
      else val = typeof val === 'object' ? JSON.stringify(val) : String(val || '');
      str = str.replace(new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\}`, 'g'), val);
  });
  return str;
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
         val = resolveFieldValueForAI(val, f);
         if (Array.isArray(val)) val = val.map(v => v?.name || String(v?.url || v)).join(', ');
         else val = typeof val === 'object' ? JSON.stringify(val) : String(val || '');
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

const gallerySettingsCache = new Map<string, any>();

function ImageReviewView({ tableId = 'default', data, lang, onPreviewImage, gallerySettings, onGallerySettingsChange }: { tableId?: string, data: any, lang: string, onPreviewImage: (url: string, items: any[]) => void, gallerySettings?: any, onGallerySettingsChange?: (s: any) => void }) {
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

    const imageFields = data.fields.filter((f: any) => f.type === 'attachment' || f.type === 'aiImage');

    const imagesMap = new Map();
    data.records.forEach((rec: any) => {
        data.fields.forEach((f: any) => {
            if (f.type === 'attachment' || f.type === 'aiImage') {
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
                 <div className="flex flex-wrap gap-4">
                     {displayImages.map((img, idx) => {
                         const path = img.url;
                         let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path);
                         const infoTexts = displayFieldIds.map(id => {
                             const f = data.fields.find((f: any) => f.id === id);
                             const val = img.record[id];
                             return { id, name: f?.name, text: val != null ? String(val) : '' };
                         }).filter(t => t.text);
                         const hasInfo = showRating || infoTexts.length > 0;
                         return (
                             <div key={idx} className="relative group w-[200px] h-auto flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex-shrink-0 cursor-pointer hover:shadow-md transition-shadow" onClick={() => {
                                 const fileItemsForPreview = displayImages.map(d => {
                                     const refUrls: string[] = [];
                                     refFieldIds.forEach(id => {
                                         const val = d.record[id];
                                         if (val) {
                                             let items: any[] = [];
                                             if (Array.isArray(val)) items = val;
                                             else if (typeof val === 'string' && val.trim() !== '') items = val.split(',').map((s: string) => ({ url: s.trim() }));
                                             else if (typeof val === 'object' && !Array.isArray(val)) items = [val];

                                             if (items.length > 0) {
                                                 const u = typeof items[0] === 'string' ? items[0] : items[0].url;
                                                 if (u) {
                                                     const mappedU = fullImageBlobCache.get(u) || (u.startsWith('/') || u.match(/^[a-zA-Z]:\\/) ? `file://${u}` : u);
                                                     refUrls.push(mappedU);
                                                 }
                                             }
                                         }
                                     });
                                     return { ...d.item, refUrls };
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
                     })}
                 </div>
             </div>
        </div>
    );
}

const scrollCache = new Map<string, number>();

export function Grid({ tableId, viewMode = 'grid', data, searchQuery, searchMatches, activeSearchMatch, onUpdateRecord, onDeleteRecords, onAddRecord, onInsertRecords, onAddField, onInsertField, onFreezeColumn, onDeleteField, onRenameField, onChangeFieldType, onReorderFields, onReorderRecords, onResizeCol, onUpdateField, onSortField, onFilterField, sortConfig, filterConfig, groupConfig, rowHeight, modelSettings, lang = 'zh', username, onUpdateGlobalAttachment, gallerySettings, onGallerySettingsChange, foldedGroups, onFoldedGroupsChange }: GridProps) {
  const searchMatchSet = useMemo(() => new Set(searchMatches?.map(m => `${m.recordId}-${m.fieldId}`) || []), [searchMatches]);
  const visibleFields = useMemo(() => data.fields.filter(f => !f.hidden), [data.fields]);
  const [activeCell, setActiveCell] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [forceEdit, setForceEdit] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [selectedColIds, setSelectedColIds] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const currentScrollKey = `${tableId}_${viewMode}`;
  const isRestoringScroll = useRef(false);
  const ignoreScrollUntil = useRef(0);

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
  const [insertColCount, setInsertColCount] = useState(1);
  const [showClearAnnotationsConfirm, setShowClearAnnotationsConfirm] = useState(false);
  const [cutBox, setCutBox] = useState<{ minR: number, maxR: number, minC: number, maxC: number } | null>(null);
  
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  const [previewImageState, setPreviewImageState] = useState<{ items: any[], currentIndex: number, onUpdate?: (newItems: any[]) => void } | null>(null);

  const setPreviewImage = (path: string | null, allItems: any[] = [], onUpdate?: (newItems: any[]) => void) => {
      if (!path) { setPreviewImageState(null); return; }
      if (allItems.length === 0) allItems = [{ url: path }];
      const parsedItems = allItems.map(it => typeof it === 'string' ? { url: it, mappedUrl: fullImageBlobCache.get(it) || (it.startsWith('/') || it.match(/^[a-zA-Z]:\\/) ? `file://${it}` : it) } : { ...it, mappedUrl: it.mappedUrl || fullImageBlobCache.get(it.url) || (it.url.startsWith('/') || it.url.match(/^[a-zA-Z]:\\/) ? `file://${it.url}` : it.url) });
      const currentIndex = parsedItems.findIndex((it: any) => it.mappedUrl === path || it.url === path);
      setPreviewImageState({ items: parsedItems, currentIndex: currentIndex === -1 ? 0 : currentIndex, onUpdate });
  };

  const handlePreviewPrev = () => {
      if (!previewImageState) return;
      setPreviewImageState(prev => prev ? { ...prev, currentIndex: (prev.currentIndex - 1 + prev.items.length) % prev.items.length } : null);
  };

  const handlePreviewNext = () => {
      if (!previewImageState) return;
      setPreviewImageState(prev => prev ? { ...prev, currentIndex: (prev.currentIndex + 1) % prev.items.length } : null);
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

  useEffect(() => {
    if (activeSearchMatch) {
       const el = document.getElementById(`cell-${activeSearchMatch.recordId}-${activeSearchMatch.fieldId}`);
       if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
       }
    }
  }, [activeSearchMatch]);

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
                  const field = visibleFields[c];
                  let val = record[field.id];
                  if (field.type === 'attachment' || field.type === 'aiImage') {
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
                if (cIdx >= visibleFields.length) break;
                pasteCells.push({ rIdx, cIdx, val: rows[i][j] });
             }
          }
      }

      for (const { rIdx, cIdx, val: rawVal } of pasteCells) {
          const record = data.records[rIdx];
          const field = visibleFields[cIdx];
          let val = rawVal;
          
          if (field.type === 'attachment' || field.type === 'aiImage') {
               let pathToAdd = val || '';
               if (pathToAdd.startsWith('IMG_COPY_MAGIC:')) {
                  pathToAdd = pathToAdd.substring('IMG_COPY_MAGIC:'.length);
                  const existing = record[field.id] || [];
                  const existingArr = Array.isArray(existing) ? existing : (typeof existing === 'string' && existing ? existing.split(',').map(s=>({url: s.trim()})) : []);
                  if (pathToAdd) {
                      val = [...existingArr, {url: pathToAdd.trim()}];
                  } else {
                      val = existingArr;
                  }
               } else {
                  val = pathToAdd;
               }
          } else if (field.type === 'number') {
             val = val ? Number(val) : null;
          } else if (field.type === 'checkbox') {
             val = val === 'true' || val === '1';
          } else if (field.type === 'singleSelect') {
             if (val) {
                 const match = field.options?.find(o => o.name === val.trim() || o.id === val.trim());
                 val = match ? match.id : val;
             }
          } else if (field.type === 'multiSelect') {
             if (val) {
                 const parts = val.split(',').map((s: string) => s.trim());
                 val = parts.map((part: string) => {
                     const match = field.options?.find(o => o.name === part || o.id === part);
                     return match ? match.id : part;
                 });
             } else {
                 val = [];
             }
          }
          onUpdateRecord(record.id, field.id, val);
      }

      if (cutBox) {
         for (let r = cutBox.minR; r <= cutBox.maxR; r++) {
           for (let c = cutBox.minC; c <= cutBox.maxC; c++) {
              // skip updating if the cut cell was just overwritten by the paste (optimisation)
              // but for safety, clear it.
              const field = visibleFields[c];
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
         if (selectionBox) {
           for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
             for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
                const field = visibleFields[c];
                onUpdateRecord(data.records[r].id, field.id, field.type === 'multiSelect' ? [] : '');
             }
           }
         }
         extraSelectedCells.forEach(cell => {
             const field = visibleFields[cell.c];
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
            const field = visibleFields[c];
            let val = record[field.id];
            if (field.type === 'attachment' || field.type === 'aiImage') {
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
           promptString = resolveTemplateString(promptString, data.fields, record);
           promptString = `You are an AI assistant helping to evaluate a table row. Here is the data context for this row:\n\n${JSON.stringify(contextData, null, 2)}\n\nBased ONLY on the context provided, perform the following instruction and respond with the concise result. Do not include markdown formatting or conversational filler.\n\nInstruction: ${promptString}`;
        }
        
        let resultParams: any = '';

        if (field.type === 'aiImage') {
          const cfg = field.aiImageConfig || {};
          const count = cfg.count || 1;
          
          let ratioRaw = resolveTemplateString(cfg.ratio || "1:1", data.fields, record);
          let ratio = ratioRaw.replace(/：/g, ':').trim();
          
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
          
          const imgSet = modelSettings.image || {};
          
          let resolvedModel = (imgSet.modelName || 'dall-e-3').split(',')[0].trim();
          if (cfg.modelTemplate) {
             let template = resolveTemplateString(cfg.modelTemplate, data.fields, record);
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
          const cfg = field.aiTextConfig || {};
          const txtSet = modelSettings.text || {};
          
          let resolvedModel = (txtSet.modelName || 'gpt-3.5-turbo').split(',')[0].trim();
          if (cfg.modelTemplate) {
             let template = cfg.modelTemplate;
             data.fields.forEach(f => {
               template = template.replace(new RegExp(`\\{${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), String(record[f.id] || ''));
             });
             if (template.trim()) {
               resolvedModel = template.trim();
             }
          }
          if (txtSet.provider === 'gemini' && (!cfg.modelTemplate)) {
            resolvedModel = 'gemini-1.5-flash';
          }
          
          let textParts: any[] = [{ text: promptString }];
          if (cfg.sourceImageTemplate) {
             const { parts } = await getBase64ImageParts(cfg.sourceImageTemplate, data.fields, record);
             textParts = [...parts, ...textParts];
          }

          if (txtSet.provider === 'gemini' || txtSet.provider === 'gemini-custom') {
            if (!txtSet.key) throw new Error("Gemini API Key is required");
            let endpoint = txtSet.provider === 'gemini' 
              ? `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`
              : txtSet.endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`;
            
            if (txtSet.provider === 'gemini-custom' && endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
            if (txtSet.provider === 'gemini-custom' && !endpoint.includes(':generateContent')) {
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

            const res = await fetch(`${txtSet.endpoint || 'https://api.openai.com/v1'}/chat/completions`, {
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
        if (field.type === 'aiImage') {
           const existing = Array.isArray(record[field.id]) ? record[field.id] : (record[field.id] ? [record[field.id]] : []);
           let downloadedUrls: string[] = [...(resultParams || [])];
           
           if (resultParams && Array.isArray(resultParams)) {
              const cfg = field.aiImageConfig || {};
              if (cfg.filenameTemplate || cfg.folderPath) {
                 let template = resolveTemplateString(cfg.filenameTemplate || 'image', data.fields, record);
                 let folderTemplate = resolveTemplateString(cfg.folderPath || '', data.fields, record);
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
  
  const totalTableWidth = visibleFields.reduce((acc, f) => acc + (f.width || 150), 0) + 64; // 64 for row corner

  let frozenColIndex = -1;
  if (data.frozenColId) {
    frozenColIndex = visibleFields.findIndex(f => f.id === data.frozenColId);
  }

  const frozenLeftOffsets: number[] = [];
  let currentLeft = 64; // Starting after the 64px row corner
  for (let i = 0; i <= frozenColIndex; i++) {
    frozenLeftOffsets.push(currentLeft);
    currentLeft += visibleFields[i].width || 150;
  }

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-auto bg-white h-full" style={{ isolation: 'isolate' }}>
      {viewMode === 'gallery' ? (
        <ImageReviewView tableId={tableId} data={data} lang={lang} onPreviewImage={setPreviewImage} gallerySettings={gallerySettings} onGallerySettingsChange={onGallerySettingsChange} />
      ) : (
      <table className="min-w-full text-left" style={{ tableLayout: 'fixed', width: totalTableWidth, borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-40 bg-gray-50 text-sm">
          <tr>
            <th className="sticky top-0 left-0 w-16 bg-gray-50 border-r border-b border-gray-200 z-[45] p-0">
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
                onFilterField={(keyword) => onFilterField?.(field.id, keyword)}
                frozenLeftOffset={colIdx <= frozenColIndex ? frozenLeftOffsets[colIdx] : undefined}
                isFrozenLast={colIdx === frozenColIndex}
                isSelected={selectionBox ? colIdx >= selectionBox.minC && colIdx <= selectionBox.maxC && selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1 : false}
                sortDirection={sortConfig?.fieldId === field.id ? sortConfig.direction : undefined}
                filterValue={filterConfig?.[field.id]}
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
            <th className="bg-gray-50 border-r border-b border-gray-200 font-normal group cursor-pointer hover:bg-gray-100" style={{ width: 100 }} onClick={onAddField}>
              <div className="flex items-center px-3 h-8 text-gray-500">
                <Plus className="w-4 h-4 mr-1" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="text-[13px]">
          {data.records.map((record, index) => {
             const groupHeadersToRender: any[] = [];
             let isRowHidden = false;
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
              <React.Fragment key={record.id}>
                 {groupHeadersToRender.map((gh) => {
                    const isFolded = foldedGroups?.includes(gh.groupKey);
                    return (
                    <tr key={`gh-${record.id}-${gh.level}`} className="bg-gray-50 border-b border-t border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => {
                        const next = new Set(foldedGroups || []);
                        if (isFolded) next.delete(gh.groupKey);
                        else next.add(gh.groupKey);
                        onFoldedGroupsChange?.(Array.from(next));
                    }}>
                      <td colSpan={visibleFields.length + 2} className="p-0 select-none">
                        <div className="sticky left-0 flex items-center py-2 text-[13px] font-medium text-gray-800 w-fit" style={{ paddingLeft: `${gh.level * 24 + 16}px` }}>
                          <ChevronDown className={`w-4 h-4 mr-1.5 text-gray-500 transition-transform ${isFolded ? '-rotate-90' : ''}`} />
                          <span className="text-gray-500 mr-1.5">{gh.field?.name}:</span>
                          <span>{gh.value == null || gh.value === '' ? (lang === 'en' ? '(Empty)' : '(空)') : String(gh.value)}</span>
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
                className="sticky left-0 bg-white group-hover:bg-gray-50 border-r border-b border-gray-200 text-center text-gray-400 w-16 z-30 transition-colors p-0 select-none cursor-grab active:cursor-grabbing relative"
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
                      setContextMenuState({ x: e.clientX, y: e.clientY, recordId: record.id });
                      setInsertRowCount(Math.max(sel.size, 1));
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
                    frozenLeftOffset={colIdx <= frozenColIndex ? frozenLeftOffsets[colIdx] : undefined}
                    isFrozenLast={colIdx === frozenColIndex}
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
                       if (e.button === 2) return; // Ignore right-clicks, handled by onContextMenu

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
                  />
                );
              })}
              <td className="border-b border-gray-200"></td>
            </tr>
            )}
            </React.Fragment>
            );
          })}
          {/* Add New Row Button */}
          <tr>
            <td className="sticky left-0 bg-white group-hover:bg-gray-50 border-r border-b border-gray-200 text-center text-gray-400 w-16 z-30 p-0 select-none transition-colors">
              <div className={cn("flex items-center justify-center font-bold text-lg", heightClass)}>+</div>
            </td>
            <td colSpan={visibleFields.length + 1} className="border-b border-gray-200 bg-white hover:bg-gray-50 cursor-pointer transition-colors p-0" onClick={onAddRecord}>
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
             onUpdateItem={(newItem) => {
                const newItems = [...previewImageState.items];
                newItems[previewImageState.currentIndex] = newItem;
                setPreviewImageState({ ...previewImageState, items: newItems });
                if (previewImageState.onUpdate) {
                   const cleanedItems = newItems.map(item => {
                       const { mappedUrl, refUrls, ...cleanProps } = item;
                       return cleanProps;
                   });
                   previewImageState.onUpdate(cleanedItems);
                }
                if (onUpdateGlobalAttachment) {
                   const { url, mappedUrl, refUrls, ...updatedProps } = newItem;
                   if (url) {
                       onUpdateGlobalAttachment(url, updatedProps);
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
             style={{ left: contextMenuState.x, top: contextMenuState.y }}
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
             className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[150px] text-sm text-gray-700"
             style={{ left: colContextMenuState.x, top: colContextMenuState.y }}
          >
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
             <div className="border-t border-gray-100 my-1"></div>
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

      {cellContextMenuState && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCellContextMenuState(null)} onContextMenu={(e) => { e.preventDefault(); setCellContextMenuState(null); }}></div>
          <div 
             className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[200px] text-sm text-gray-700"
             style={{ left: cellContextMenuState.x, top: cellContextMenuState.y }}
          >
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
                      
                      if ((field.type === 'aiImage' || field.type === 'attachment') && val) {
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
  onFilterField: (keyword: string) => void;
  sortDirection?: 'asc' | 'desc';
  filterValue?: string;
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
  isSelected?: boolean;
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
  field, colIdx, totalCols, onRename, onChangeType, onResize, onUpdateField, onGenerateColumn, onDeleteField, onSortField, onFilterField, sortDirection, filterValue, onSelectCol, allFields,
  isDragged, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onContextMenu, frozenLeftOffset, isFrozenLast, isSelected, modelSettings, lang = 'zh'
}: HeaderCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  
  const [draftPrompt, setDraftPrompt] = useState(field.prompt || '');
  const [draftRefs, setDraftRefs] = useState<string[]>(field.refFields || []);
  const [draftAiImageConfig, setDraftAiImageConfig] = useState(field.aiImageConfig || { count: 1, size: '1024x1024' });
  const [draftAiTextConfig, setDraftAiTextConfig] = useState(field.aiTextConfig || {});
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
      onContextMenu={onContextMenu}
      className={cn(
        "font-normal border-r border-b border-gray-200 relative group select-none hover:bg-gray-100 transition-colors z-40",
        isSelected ? "bg-blue-100 text-blue-900" : "bg-gray-50 text-gray-700",
        isDragged ? "opacity-50 bg-gray-200" : "",
        isDragOver ? "border-l-2 border-l-blue-500" : "",
        frozenLeftOffset !== undefined ? "sticky z-[41]" : "",
        isFrozenLast && frozenLeftOffset !== undefined ? "shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" : ""
      )}
      style={{ width: field.width || 150, left: frozenLeftOffset }}
    >
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
        <div ref={actionMenuRef} className={cn("absolute top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1", colIdx < totalCols / 2 ? "left-0" : "right-0")} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
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
                             {allFields.filter(f => f.id !== field.id && (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'url')).map(f => (
                               <option key={f.id} value={f.name}>{f.name}</option>
                             ))}
                           </select>
                         </div>
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
                   {field.type === 'aiText' && (
                     <div className="mt-2 space-y-2">
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
                             {allFields.filter(f => f.id !== field.id && (f.type === 'attachment' || f.type === 'aiImage' || f.type === 'url')).map(f => (
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
                            {modelSettings?.text?.modelName?.split(',').map((m: string) => m.trim()).filter(Boolean).map((m: string) => (
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
                         onUpdateField({ prompt: draftPrompt, refFields: draftRefs, aiImageConfig: draftAiImageConfig, aiTextConfig: draftAiTextConfig });
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
  searchQuery?: string;
  isSearchMatch?: boolean;
  isSearchMatchActive?: boolean;
  onActivate: () => void;
  onChange: (value: any) => void;
  onBlur: () => void;
  onPreviewImage: (url: string, items?: any[], onUpdate?: (newItems: any[]) => void) => void;
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
}

function Cell({ record, field, isActive, forceEdit, isGeneratingCol, searchQuery, isSearchMatch, isSearchMatchActive, onActivate, onChange, onBlur, onPreviewImage, allFields, modelSettings, heightClass, onUpdateField, isSelectedBox, isCutBox, onMouseDown, onMouseEnter, onActivateNextRow, onContextMenu, onBatchAIGenerate, frozenLeftOffset, isFrozenLast, lang = 'zh' }: CellProps) {
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
        let fileItems: any[] = [];
        if (Array.isArray(value)) {
          fileItems = value.map((v: any) => {
             if (typeof v === 'string') return { url: v };
             const { refUrls, ...cleanV } = v;
             return cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
          });
        } else if (typeof value === 'string' && value.trim() !== '') {
          fileItems = value.split(',').map(s => ({ url: s.trim() }));
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
                    const path = item.url;
                    let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path);
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
                            onPreviewImage(fullUrl, fileItems, (newItems) => onChange(newItems)); 
                          }}
                        />
                        {(pendingCount > 0 || resolvedCount > 0 || approvedCount > 0) && (
                          <div className="absolute -top-1 -right-1 flex gap-0.5 z-10 pointer-events-none drop-shadow-md">
                             {pendingCount > 0 && <span className="bg-red-500 rounded-full w-2.5 h-2.5 shadow-sm border border-white"></span>}
                             {resolvedCount > 0 && <span className="bg-yellow-500 rounded-full w-2.5 h-2.5 shadow-sm border border-white"></span>}
                             {approvedCount > 0 && <span className="bg-green-500 rounded-full w-2.5 h-2.5 shadow-sm border border-white"></span>}
                          </div>
                        )}
                        <div className="absolute top-0.5 right-0.5 bg-white/80 text-gray-700 rounded p-0.5 opacity-0 group-hover/img-item:opacity-100 flex items-center gap-1 shadow-sm z-10 transition-opacity">
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
      case 'aiImage': {
        let fileItems: any[] = [];
        if (Array.isArray(value)) {
          fileItems = value.map((v: any) => {
             if (typeof v === 'string') return { url: v };
             const { refUrls, ...cleanV } = v;
             return cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
          });
        } else if (typeof value === 'string' && value.trim() !== '') {
          fileItems = value.split(',').map(s => ({ url: s.trim() }));
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
             ) : fileItems.length > 0 ? (
               <div className={`flex items-center gap-1 overflow-hidden w-full ${containerHeightClass}`}>
                  {fileItems.map((item, i) => {
                    const path = item.url;
                    let fullUrl = fullImageBlobCache.get(path) || (path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path);
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
                            onPreviewImage(fullUrl, fileItems, (newItems) => onChange(newItems)); 
                          }}
                        />
                        {(pendingCount > 0 || resolvedCount > 0 || approvedCount > 0) && (
                          <div className="absolute -top-1 -right-1 flex gap-0.5 z-10 pointer-events-none drop-shadow-md">
                             {pendingCount > 0 && <span className="bg-red-500 rounded-full w-2.5 h-2.5 shadow-sm border border-white"></span>}
                             {resolvedCount > 0 && <span className="bg-yellow-500 rounded-full w-2.5 h-2.5 shadow-sm border border-white"></span>}
                             {approvedCount > 0 && <span className="bg-green-500 rounded-full w-2.5 h-2.5 shadow-sm border border-white"></span>}
                          </div>
                        )}
                        <div className="absolute top-0.5 right-0.5 bg-white/80 text-gray-700 rounded p-0.5 opacity-0 group-hover/img-item:opacity-100 flex items-center gap-1 shadow-sm z-10 transition-opacity">
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
            <span className="whitespace-normal break-all overflow-hidden text-sm leading-tight w-full pr-4" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: heightClass === 'h-[120px]' ? 5 : heightClass === 'h-[80px]' ? 3 : heightClass === 'h-[56px]' ? 2 : 1 }}><HighlightedText text={String(displayValue)} query={searchQuery} /></span>
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
          <div className="px-2 py-1 h-full flex flex-col justify-center w-full overflow-hidden select-none">
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
               let existingItems: any[] = [];
               if (Array.isArray(value)) {
                 existingItems = [...value];
               } else if (typeof value === 'string' && value.trim() !== '') {
                 existingItems = value.split(',').map(s => ({ url: s.trim() }));
               }

               const fileObjects = files.map((file: any) => {
                 const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
                 getOrGenerateThumbnail(pathStr, file);
                 if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:\\/)) {
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
        "border-b border-r border-gray-200 relative p-0 transition-colors cursor-cell group-hover:bg-gray-50",
        heightClass,
        isSelectedBox && !isEditingMode ? "bg-[#ebf4ff] group-hover:bg-[#e1effe]" : (isSearchMatch && !isEditingMode ? "bg-blue-100" : "bg-white"),
        isSearchMatchActive && !isEditingMode && "ring-[2px] ring-blue-400 z-10",
        isCutBox && !isEditingMode && "opacity-50 ring-1 ring-dashed ring-gray-400 ring-inset",
        isActive && !isEditingMode && "ring-[1.5px] ring-blue-500 ring-inset z-20 outline-none",
        frozenLeftOffset !== undefined ? (isActive ? "sticky z-20" : "sticky z-10") : "",
        isFrozenLast && frozenLeftOffset !== undefined ? "shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" : ""
      )}
      style={{ left: frozenLeftOffset }}
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

function AttachmentCellEditor({ value, onChange, onClose, onPreview }: { value: any, onChange: (v: any) => void, onClose: () => void, onPreview: (url: string, allUrls?: {url: string, annotations?: any[]}[], onUpdate?: (items: any[]) => void) => void }) {
  let fileItems: any[] = [];
  if (Array.isArray(value)) {
    fileItems = value.map((v: any) => {
       if (typeof v === 'string') return { url: v };
       const { refUrls, ...cleanV } = v;
       return cleanV.url ? cleanV : { url: cleanV.name || '', ...cleanV };
    });
  } else if (typeof value === 'string' && value.trim() !== '') {
    fileItems = value.split(',').map(s => ({ url: s.trim() }));
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
        if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:\\/)) {
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
      const files = Array.from(e.dataTransfer.files).filter((f: any) => f.type.startsWith('image/'));
      if (files.length > 0) {
        const newItems = files.map((file: any) => {
          // Add support for window.electronAPI.getPathForFile if exposed in preload
          const pathStr = (window as any).electronAPI?.getPathForFile?.(file) || (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
          getOrGenerateThumbnail(pathStr, file);
          if (!pathStr.startsWith('/') && !pathStr.match(/^[a-zA-Z]:\\/)) {
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
               onClick={() => onPreview(fullUrl, fileItems.map(p => {
                 const mappedUrl = fullImageBlobCache.get(p.url) || (p.url.startsWith('/') || p.url.match(/^[a-zA-Z]:\\/) ? `file://${p.url}` : p.url);
                 return { ...p, mappedUrl };
               }), (newItems) => onChange(newItems))}
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
