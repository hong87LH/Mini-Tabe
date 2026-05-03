import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { initialGridData } from './initialData';
import { Grid } from './components/Grid';
import { FieldType, Attachment, GridData } from './types';
import { Search, UserCircle, Share2, Grid as GridIcon, Filter, ArrowDownUp, Eye, EyeOff, LayoutTemplate, Settings, Bell, MoreHorizontal, ChevronDown, Plus, Download, Upload, FileJson, X, AlignJustify, Trash2, Edit2, Undo2, Redo2, PanelLeftClose, PanelLeftOpen, Cpu, Sparkles, FolderOpen, Save, FileEdit, Copy, Image as ImageIcon } from 'lucide-react';
import Papa from 'papaparse';
import { Parser } from 'expr-eval';
import { getStringColor } from './lib/utils';
import { getHandle, setHandle } from './lib/idb';

export const computeFormulaValue = (field: any, record: any, fields: any[]) => {
  if (!field.prompt) return '';
  let formulaStr = field.prompt;
  
  const variableNames: string[] = [];
  const variableValues: any[] = [];
  const contextData: any = {};
  
  // Replace {Field Name} with safe variables
  if (field.refFields) {
    field.refFields.forEach((refId: string) => {
      const refField = fields.find((f: any) => f.id === refId);
      if (refField) {
        // for expr-eval fallback
        const rawVal = record[refId];
        let valToUse = rawVal;
        if (refField.type === 'singleSelect' || refField.type === 'multiSelect') {
          if (rawVal) {
            const valArray = Array.isArray(rawVal) ? rawVal : (typeof rawVal === 'string' ? rawVal.split(',').map(s=>s.trim()) : [rawVal]);
            const mapped = valArray.map(v => refField.options?.find((o:any) => o.id === v)?.name || v);
            valToUse = mapped.length === 1 && !Array.isArray(rawVal) && refField.type === 'singleSelect' ? mapped[0] : mapped.join(', ');
          }
        }
        
        const numVal = parseFloat(valToUse as string);
        contextData[refField.name] = !isNaN(numVal) ? numVal : valToUse || '';
        
        // for JS evaluation
        const varName = 'VAR_' + refId.replace(/[^a-zA-Z0-9]/g, '_');
        // Escape special regex chars in field name just in case
        const safeFieldName = refField.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        formulaStr = formulaStr.replace(new RegExp(`{${safeFieldName}}`, 'g'), varName);
        variableNames.push(varName);
        variableValues.push(valToUse === undefined || valToUse === null ? '' : valToUse);
      }
    });
  }

  // Handle Excel-like syntax starting with =
  let jsFormula = formulaStr;
  if (jsFormula.startsWith('=')) {
    jsFormula = jsFormula.substring(1).replace(/&/g, '+');
  }

  try {
    const fn = new Function(...variableNames, `return (${jsFormula});`);
    return fn(...variableValues);
  } catch (e) {
    // Fallback to expr-eval for legacy Math formulas
    try {
      let legacyStr = field.prompt;
      if (field.refFields) {
        field.refFields.forEach((refId: string) => {
          const refField = fields.find((f: any) => f.id === refId);
          if (refField) {
            const safeFieldName = refField.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            legacyStr = legacyStr.replace(new RegExp(`{${safeFieldName}}`, 'g'), refField.name);
          }
        });
      }
      return Parser.evaluate(legacyStr, contextData);
    } catch (err) {
      return '#ERROR';
    }
  }
};

const TABLE_ICONS = [
  '💼','📅','📊','📁','📝','📌',
  '⭐','❤️','🔥','✨','💎','🎁',
  '💻','📱','🔋','🔌','⌨️','🌐',
  '📷','🖼️','🎨','🌅','📸','🌆',
  '🎬','🎥','📺','🎞️','▶️','📹',
  '📄','📚','📖','📋','🧾','📕',
  '📗','📘','📙','🖋️','📓'
];

function TableNavItem({ 
  tbl, isActive, onClick, onRename, onDelete, onDuplicate, onIconChange,
  isDragged, isDragOverTop, isDragOverBottom, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd
}: { 
  key?: React.Key; tbl: any; isActive: boolean; onClick: () => void; onRename: (n: string) => void; onDelete: () => void; onDuplicate: () => void; onIconChange: (icon: string | null) => void;
  isDragged?: boolean; isDragOverTop?: boolean; isDragOverBottom?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragOver?: (e: React.DragEvent) => void; onDragLeave?: () => void; onDrop?: (e: React.DragEvent) => void; onDragEnd?: () => void;
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [name, setName] = React.useState(tbl.name);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [showIconMenu, setShowIconMenu] = React.useState(false);
  const iconMenuRef = React.useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = React.useState<{top: number, left: number} | null>(null);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus(); inputRef.current.select();
    }
  }, [isEditing]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Portal drops it on document body, but handleClickOutside shouldn't close it if clicking the portal? 
      // The portal might be outside iconMenuRef. So we wait, if portal, e.target is outside iconMenuRef.
      // Easiest is to add a data attribute or class to identify the portal and skip.
      if (iconMenuRef.current && !iconMenuRef.current.contains(e.target as Node) && !(e.target as Element).closest('.icon-menu-portal')) {
        setShowIconMenu(false);
      }
    };
    if (showIconMenu) {
       document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showIconMenu]);

  const handleSave = () => {
    if (name.trim()) onRename(name.trim());
    else setName(tbl.name);
    setIsEditing(false);
  };

  const handleIconClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!showIconMenu && iconMenuRef.current) {
       const rect = iconMenuRef.current.getBoundingClientRect();
       setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowIconMenu(!showIconMenu);
  };

  return (
    <div 
      className={`group relative flex flex-1 items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-[background-color,opacity] ${isActive ? 'bg-blue-100/80 text-blue-800 font-medium' : 'text-gray-600 hover:bg-gray-200/50 hover:text-gray-900'} ${isDragged ? 'opacity-40' : ''}`}
      style={isDragOverTop ? { boxShadow: 'inset 0 2px 0 0 #3b82f6' } : isDragOverBottom ? { boxShadow: 'inset 0 -2px 0 0 #3b82f6' } : {}}
      onClick={!isEditing ? onClick : undefined}
      onDoubleClick={() => setIsEditing(true)}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center truncate min-w-0 flex-1">
        <div 
           className="relative mr-2 flex items-center justify-center shrink-0" 
           ref={iconMenuRef}
           onClick={handleIconClick}
           onMouseDown={(e) => e.stopPropagation()}
           onDoubleClick={(e) => e.stopPropagation()}
           onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
           <div 
             className="w-5 h-5 flex items-center justify-center cursor-pointer hover:bg-white/50 rounded transition-colors"
             title="Change Icon"
           >
             {tbl.icon ? <span className="text-sm leading-none flex items-center justify-center -mt-px">{tbl.icon}</span> : <GridIcon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`} />}
           </div>
           
           {showIconMenu && menuPos && (
             typeof document !== 'undefined' ? 
             createPortal(
               <div 
                 className="icon-menu-portal fixed bg-white border border-gray-200 rounded-lg shadow-xl p-2 z-[99999] grid grid-cols-6 gap-1 w-[200px]" 
                 style={{ top: menuPos.top, left: menuPos.left }}
                 onMouseDown={e => e.stopPropagation()}
                 onClick={e => e.stopPropagation()}
                 onDoubleClick={e => e.stopPropagation()}
               >
                  <button 
                    className={`w-7 h-7 flex items-center justify-center rounded hover:bg-blue-50 ${!tbl.icon ? 'bg-blue-100 text-blue-600' : 'text-gray-500'}`} 
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onIconChange(null); setShowIconMenu(false); }}
                    title="Default"
                  >
                    <GridIcon className="w-4 h-4" />
                  </button>
                  {TABLE_ICONS.map(icon => (
                    <button 
                      key={icon}
                      className={`w-7 h-7 flex items-center justify-center rounded hover:bg-blue-50 text-sm ${tbl.icon === icon ? 'bg-blue-100' : ''}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onIconChange(icon); setShowIconMenu(false); }}
                    >
                      {icon}
                    </button>
                  ))}
               </div>,
               document.body
             ) : null
           )}
        </div>
        {isEditing ? (
          <input
            ref={inputRef} type="text"
            className="flex-1 bg-white border border-blue-400 rounded px-1 text-sm outline-none text-gray-900 min-w-0"
            value={name} onChange={(e) => setName(e.target.value)} onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setName(tbl.name); setIsEditing(false); } }}
          />
        ) : (
          <span className="truncate text-sm select-none">{tbl.name}</span>
        )}
      </div>
      {!isEditing && (
        <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 shrink-0 ml-1">
          <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className="p-0.5 text-gray-400 hover:text-blue-600 rounded" title="Rename"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-0.5 text-gray-400 hover:text-green-600 rounded" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-0.5 text-gray-400 hover:text-red-600 rounded" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tables, setTablesInternal] = useState<any[]>(() => {
     try {
         const cached = localStorage.getItem('bitable_project_cache');
         if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
         }
     } catch (e) {}
     return [{ id: 'table_1', name: 'Master Table', data: initialGridData, viewStates: {} }];
  });

  useEffect(() => {
     localStorage.setItem('bitable_project_cache', JSON.stringify(tables));
  }, [tables]);

  const [projectName, setProjectName] = useState(() => {
     return localStorage.getItem('bitable_project_name') || 'Untitled Project';
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  useEffect(() => {
     localStorage.setItem('bitable_project_name', projectName);
  }, [projectName]);

  const saveProjectToDisk = async (saveAs = false) => {
      try {
         const json = JSON.stringify(tables, null, 2);
         if ((window as any).showSaveFilePicker) {
             let fileHandle = (window as any).activeProjectFileHandle;
             if (!fileHandle || saveAs) {
                 fileHandle = await (window as any).showSaveFilePicker({
                     suggestedName: projectName + '.aistudio.json',
                     types: [{
                         description: 'AI Studio Project',
                         accept: {'application/json': ['.aistudio.json', '.json']}
                     }]
                 });
                 (window as any).activeProjectFileHandle = fileHandle;
                 setProjectName(fileHandle.name.replace(/\.aistudio\.json$/i, "").replace(/\.json$/i, ""));
             }
             const writable = await fileHandle.createWritable();
             await writable.write(json);
             await writable.close();
         } else if ((window as any).electronAPI?.downloadFile) {
             const base64Str = btoa(unescape(encodeURIComponent(json)));
             await (window as any).electronAPI.downloadFile({ url: `data:application/json;base64,${base64Str}`, filename: projectName + '.aistudio.json' });
         } else {
             const blob = new Blob([json], { type: 'application/json' });
             const url = URL.createObjectURL(blob);
             const a = document.createElement('a');
             a.href = url;
             a.download = projectName + '.aistudio.json';
             a.click();
             URL.revokeObjectURL(url);
         }
         showToast(lang === 'en' ? 'Project saved successfully' : '保存成功');
      } catch (err: any) {
         if (err.name !== 'AbortError') alert("Failed to save project: " + err.message);
      }
  };

  const [showNewProjectConfirm, setShowNewProjectConfirm] = useState(false);

  const handleNewProject = () => {
     setShowNewProjectConfirm(true);
  };

  const confirmNewProject = () => {
     setTablesInternal([{ id: 'table_1', name: 'Master Table', data: initialGridData }]);
     setActiveTableIdState('table_1');
     activeTableIdRef.current = 'table_1';
     setProjectName('Untitled Project');
     setHistory([]);
     setFuture([]);
     setShowNewProjectConfirm(false);
  };

  const executeFileInputFallback = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.aistudio.json,.json';
      input.onchange = (e) => {
         const file = (e.target as HTMLInputElement).files?.[0];
         if (!file) return;
         const reader = new FileReader();
         reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target?.result as string);
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && parsed[0].data) {
                    setTablesInternal(parsed);
                    setActiveTableId(parsed[0].id);
                    setProjectName(file.name.replace(/\.aistudio\.json$/i, "").replace(/\.json$/i, ""));
                    setHistory([]);
                    setFuture([]);
                } else {
                    alert("Invalid project file.");
                }
            } catch (e) { alert("Invalid JSON file"); }
         };
         reader.readAsText(file);
      };
      input.click();
  };

  const handleOpenProject = async () => {
     let fileHandle;
     try {
        if ((window as any).showOpenFilePicker) {
            const handles = await (window as any).showOpenFilePicker({
                types: [{
                    description: 'AI Studio Project',
                    accept: {'application/json': ['.aistudio.json', '.json']}
                }],
                multiple: false
            });
            fileHandle = handles[0];
        }
     } catch (err: any) {
         if (err.name === 'AbortError') return;
     }

     if (fileHandle) {
         try {
             const file = await fileHandle.getFile();
             const text = await file.text();
             const parsed = JSON.parse(text);
             if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && parsed[0].data) {
                 setTablesInternal(parsed);
                 setActiveTableId(parsed[0].id);
                 setProjectName(file.name.replace(/\.aistudio\.json$/i, "").replace(/\.json$/i, ""));
                 setHistory([]);
                 setFuture([]);
                 (window as any).activeProjectFileHandle = fileHandle;
             } else {
                 alert("Invalid project file.");
             }
         } catch (e: any) {
             alert("Error reading file: " + e.message);
         }
     } else {
         executeFileInputFallback();
     }
  };

  useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
         // Ctrl+S / Cmd+S
         if ((e.ctrlKey || e.metaKey) && e.key === 's') {
             e.preventDefault();
             saveProjectToDisk();
         }
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tables]);
  const [history, setHistory] = useState<{ id: string, name: string, data: GridData }[][]>([]);
  const [future, setFuture] = useState<{ id: string, name: string, data: GridData }[][]>([]);

  const setTables = (update: any) => {
     setTablesInternal(prev => {
        const result = typeof update === 'function' ? update(prev) : update;
        if (result !== prev) {
           setHistory(h => [...h.slice(-19), prev]);
           setFuture([]);
        }
        return result;
     });
  };

  const activeTableIdRef = React.useRef('table_1');
  const [activeTableIdState, setActiveTableIdState] = useState('table_1');
  const activeTableId = activeTableIdState;
  
  const setActiveTableId = (id: string) => {
     activeTableIdRef.current = id;
     setActiveTableIdState(id);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setFuture(f => [tables, ...f]);
    setHistory(h => h.slice(0, h.length - 1));
    setTablesInternal(prev);
    if (!prev.find(t => t.id === activeTableId)) {
      setActiveTableId(prev[0].id);
    }
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setHistory(h => [...h, tables]);
    setFuture(f => f.slice(1));
    setTablesInternal(next);
    if (!next.find(t => t.id === activeTableId)) {
      setActiveTableId(next[0].id);
    }
  };

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [draggedTableId, setDraggedTableId] = useState<string | null>(null);
  const [dragOverTableId, setDragOverTableId] = useState<string | null>(null);
  const [dragOverTablePosition, setDragOverTablePosition] = useState<'top' | 'bottom' | null>(null);

  const handleDuplicateTable = (id: string) => {
    setTables((prev: any[]) => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      const target = prev[idx];
      const newId = `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const newData = JSON.parse(JSON.stringify(target.data));
      const newTable = { ...target, id: newId, name: `${target.name} Copy`, data: newData };
      const res = [...prev];
      res.splice(idx + 1, 0, newTable);
      return res;
    });
  };

  const handleIconChange = (id: string, icon: string | null) => {
    setTables((prev: any[]) => prev.map(t => t.id === id ? { ...t, icon } : t));
  };

  const activeTableIndex = tables.findIndex(t => t.id === activeTableId);
  const data = tables[activeTableIndex]?.data || initialGridData;
  const activeTableName = tables[activeTableIndex]?.name || 'Master Table';

  const activeTable = tables[activeTableIndex] || {};
  const activeViewMode = activeTable.activeViewMode || 'grid';
  const setActiveViewMode = (mode: 'grid'|'gallery') => {
      setTables((prev: any[]) => prev.map(t => t.id === activeTableId ? { ...t, activeViewMode: mode } : t));
  };

  const viewStates = activeTable.viewStates || {};
  const currentViewState = viewStates[activeViewMode] || {};

  const sortConfig = currentViewState.sortConfig || null;
  const filterConfig = currentViewState.filterConfig || {};
  const groupConfig = currentViewState.groupConfig || [];
  const foldedGroups = currentViewState.foldedGroups || [];
  const rowHeight = currentViewState.rowHeight || 'medium';
  const gallerySettings = currentViewState.gallerySettings || null;

  const updateViewState = (updates: any) => {
     setTables((prev: any[]) => prev.map(t => {
        if (t.id === activeTableId) {
            const vStates = { ...(t.viewStates || {}) };
            vStates[activeViewMode] = { ...(vStates[activeViewMode] || {}), ...updates };
            return { ...t, viewStates: vStates };
        }
        return t;
     }));
  }

  const setSortConfig = (conf: any) => updateViewState({ sortConfig: conf });
  const setFilterConfig = (conf: any) => {
     if (typeof conf === 'function') {
         updateViewState({ filterConfig: conf(filterConfig) });
     } else {
         updateViewState({ filterConfig: conf });
     }
  };
  const setGroupConfig = (conf: any) => updateViewState({ groupConfig: conf });
  const setFoldedGroups = (conf: any) => updateViewState({ foldedGroups: conf });
  const setRowHeight = (h: any) => updateViewState({ rowHeight: h });
  const setGallerySettings = (s: any) => updateViewState({ gallerySettings: s });

  const [showGlobalFilterMenu, setShowGlobalFilterMenu] = useState(false);
  const [showHideFieldsMenu, setShowHideFieldsMenu] = useState(false);
  const [showGlobalSortMenu, setShowGlobalSortMenu] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<{ recordIndex: number, fieldIndex: number, recordId: string, fieldId: string }[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  useEffect(() => {
    if (!searchQuery || !showSearch) {
      setSearchMatches([]);
      setCurrentSearchIndex(-1);
      return;
    }
    const query = searchQuery.toLowerCase();
    const visibleFields = data.fields.filter((f: any) => !f.hidden);
    const matches: any[] = [];
    data.records.forEach((record: any, rIdx: number) => {
      visibleFields.forEach((field: any, cIdx: number) => {
         let val = record[field.id];
         if (val != null) {
            let strVal = '';
            if (field.type === 'attachment' && Array.isArray(val)) {
                strVal = val.map(v => v.name || v.url || '').join(' ');
            } else if (field.type === 'multiSelect' && Array.isArray(val)) {
                strVal = val.map(v => field.options?.find((o:any) => o.id === v)?.name || '').join(' ');
            } else if (field.type === 'singleSelect') {
                strVal = field.options?.find((o:any) => o.id === val)?.name || '';
            } else {
                strVal = String(val);
            }
            if (strVal.toLowerCase().includes(query)) {
                matches.push({ recordIndex: rIdx, fieldIndex: cIdx, recordId: record.id, fieldId: field.id });
            }
         }
      });
    });
    setSearchMatches(matches);
    setCurrentSearchIndex(matches.length > 0 ? 0 : -1);
  }, [searchQuery, data, showSearch]);

  const handleNextSearch = () => {
    if (searchMatches.length === 0) return;
    setCurrentSearchIndex((prev) => (prev + 1) % searchMatches.length);
  };

  const handlePrevSearch = () => {
    if (searchMatches.length === 0) return;
    setCurrentSearchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);
  };

  const setData = (update: any) => {
    setTables(prev => {
      const idx = prev.findIndex(t => t.id === activeTableId);
      if (idx === -1) return prev;
      const newTables = [...prev];
      const curData = newTables[idx].data;
      const newData = typeof update === 'function' ? update(curData) : update;
      newTables[idx] = { ...newTables[idx], data: newData };
      return newTables;
    });
  };

  const handleAddTable = () => {
    const newId = `table_${Date.now()}`;
    setTables(prev => [...prev, {
      id: newId,
      name: `New Table ${prev.length + 1}`,
      data: {
        fields: [
          { id: 'fld_title', name: 'Text', type: 'text', width: 200 },
          { id: 'fld_status', name: 'Status', type: 'singleSelect', width: 140, options: [{id: 'opt1', name: 'TODO', color: 'bg-gray-100 text-gray-700'}] },
          { id: 'fld_date', name: 'Date', type: 'date', width: 140 },
          { id: 'fld_link', name: 'URL', type: 'url', width: 200 }
        ],
        records: [
          { id: `rec_${Date.now()}_1`, fld_title: '', fld_status: null, fld_date: null, fld_link: '' },
          { id: `rec_${Date.now()}_2`, fld_title: '', fld_status: null, fld_date: null, fld_link: '' }
        ]
      }
    }]);
    setActiveTableId(newId);
  };

  const handleRenameTable = (id: string, newName: string) => {
    setTables(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t));
  };

  const handleDeleteTable = (id: string) => {
    if (tables.length === 1) {
      alert("Cannot delete the last table.");
      return;
    }
    const idx = tables.findIndex(t => t.id === id);
    const newTables = tables.filter(t => t.id !== id);
    setTables(newTables);
    if (activeTableId === id) {
      setActiveTableId(newTables[Math.max(0, idx - 1)].id);
    }
  };

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRowHeightMenu, setShowRowHeightMenu] = useState(false);
  
  const [userSettings, setUserSettings] = useState(() => {
    try {
       const saved = localStorage.getItem('bitable_user_settings');
       if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { username: '' };
  });
  
  useEffect(() => {
    localStorage.setItem('bitable_user_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  // Model settings
  const [modelSettings, setModelSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('bitable_model_settings_v2');
      if (saved) return JSON.parse(saved);
      // fallback to migration
      const savedV1 = localStorage.getItem('bitable_model_settings');
      if (savedV1) {
        const v1 = JSON.parse(savedV1);
        return {
          text: {
            provider: v1.activeModel || 'openai',
            key: v1.activeModel === 'gemini' ? (v1.geminiKey || '') : (v1.openaiKey || ''),
            endpoint: v1.openaiEndpoint || 'https://api-inference.modelscope.cn/v1',
            modelName: v1.openaiModel || 'deepseek-ai/DeepSeek-V3.2',
          },
          image: {
            provider: 'openai',
            key: '',
            endpoint: 'https://api.openai.com/v1',
            modelName: 'dall-e-3'
          }
        };
      }
    } catch (e) {}
    return {
      text: {
        provider: 'openai',
        key: '',
        endpoint: 'https://api-inference.modelscope.cn/v1',
        modelName: 'deepseek-ai/DeepSeek-V3.2'
      },
      image: {
        provider: 'openai',
        key: '',
        endpoint: 'https://api.openai.com/v1',
        modelName: 'dall-e-3'
      }
    };
  });

  useEffect(() => {
    localStorage.setItem('bitable_model_settings_v2', JSON.stringify(modelSettings));
  }, [modelSettings]);

  const [autoSaveSettings, setAutoSaveSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('bitable_autosave_settings');
      if (saved) return { enabled: false, interval: 5, folderName: '', ...JSON.parse(saved) };
    } catch (e) {}
    return { enabled: false, interval: 5, folderName: '' };
  });

  const dirHandleRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem('bitable_autosave_settings', JSON.stringify(autoSaveSettings));
  }, [autoSaveSettings]);

  useEffect(() => {
    if (autoSaveSettings.enabled) {
       getHandle('autosave_dir').then(async handle => {
           if (handle) {
               try {
                   // Verify we still have permission. If not, prompt.
                   // Wait, standard behavior is, we might need to call verifyPermission
                   // But without user gesture, we cannot prompt!
                   // We'll just request readwrite permission if needed when we try to save!
                   dirHandleRef.current = handle;
               } catch(e) {}
           }
       });
    }
  }, []);

  const verifyPermission = async (fileHandle: any, readWrite: boolean) => {
    const options: any = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
    return false;
  };

  const tablesRef = useRef(tables);
  useEffect(() => {
     tablesRef.current = tables;
  }, [tables]);

  useEffect(() => {
    if (!autoSaveSettings.enabled) return;
    
    const intervalId = setInterval(async () => {
      try {
        if (!dirHandleRef.current) return;
        
        // Prepare clean data for ENTIRE project
        const projectData = tablesRef.current.map(tbl => {
           const validFieldIds = new Set(['id', ...tbl.data.fields.map((f: any) => f.id)]);
           const cleanRecords = tbl.data.records.map((r: any) => {
              const cleanR: any = {};
              for (const key in r) {
                if (validFieldIds.has(key)) {
                  cleanR[key] = r[key];
                }
              }
              tbl.data.fields.forEach((f: any) => {
                if (f.type === 'formula') {
                  cleanR[f.id] = computeFormulaValue(f, r, tbl.data.fields);
                }
              });
              return cleanR;
           });
           return { ...tbl, data: { ...tbl.data, records: cleanRecords } };
        });
        
        const jsonStr = JSON.stringify(projectData, null, 2);

        const currentHandle = (window as any).activeProjectFileHandle;
        let backupFileName = 'bitable_backup.backup';
        if (currentHandle && currentHandle.name) {
           const baseName = currentHandle.name.replace(/\.[^/.]+$/, '');
           backupFileName = `${baseName}.backup`;
        } else {
           const activeTableName = tablesRef.current[0]?.name || 'Untitled';
           backupFileName = `${activeTableName}.backup`;
        }

        // Write to file (we can try verifyPermission first but normally it prompts correctly if needed upon createWritable, but browsers might block without user gesture. If it fails, that's fine, we log it)
        const fileHandle = await dirHandleRef.current.getFileHandle(backupFileName, { create: true });
        
        // We only write if permission is already granted, avoid blocking prompts in interval
        if ((await fileHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
           return;
        }

        const writable = await fileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        console.log(`Auto-saved project backup to ${backupFileName} at`, new Date().toLocaleTimeString());
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    }, (autoSaveSettings.interval || 5) * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [autoSaveSettings.enabled, autoSaveSettings.interval]);

  const handleUpdateRecord = (recordId: string, fieldId: string, value: any) => {
    setData(prev => ({
      ...prev,
      records: prev.records.map(rec => 
        rec.id === recordId ? { ...rec, [fieldId]: value } : rec
      )
    }));
  };

  const handleAddRecord = () => {
    setData(prev => ({
      ...prev,
      records: [
        ...prev.records,
        { id: `rec_${Date.now()}` }
      ]
    }));
  };

  const handleInsertRecords = (index: number, count: number) => {
    setData(prev => {
      const newRecords = Array.from({ length: count }, (_, i) => ({ id: `rec_${Date.now()}_${i}` }));
      const records = [...prev.records];
      records.splice(index, 0, ...newRecords);
      return { ...prev, records };
    });
  };

  const handleDeleteRecords = (recordIds: string[]) => {
    setData(prev => ({
      ...prev,
      records: prev.records.filter(rec => !recordIds.includes(rec.id))
    }));
  };

  const handleAddField = () => {
    setData((prev: any) => ({
      ...prev,
      fields: [
        ...prev.fields,
        { id: `fld_${Date.now()}`, name: 'New Field', type: 'text', width: 150 }
      ]
    }));
  };

  const handleInsertField = (index: number, count: number = 1) => {
    setData((prev: any) => {
      const newFields = Array.from({ length: count }).map((_, i) => ({ 
        id: `fld_${Date.now()}_${i}`, 
        name: count > 1 ? `New Field ${i + 1}` : 'New Field', 
        type: 'text', 
        width: 150 
      }));
      const fields = [...prev.fields];
      fields.splice(index, 0, ...newFields);
      return { ...prev, fields };
    });
  };

  const handleFreezeColumn = (fieldId: string | null) => {
    setData((prev: any) => ({
      ...prev,
      frozenColId: fieldId
    }));
  };

  const handleDeleteField = (fieldId: string) => {
    setData((prev: any) => ({
      ...prev,
      fields: prev.fields.filter((f: any) => f.id !== fieldId),
      records: prev.records.map((r: any) => {
        const newRecord = { ...r };
        delete newRecord[fieldId];
        return newRecord;
      })
    }));
  };

  const handleRenameField = (fieldId: string, name: string) => {
    setData(prev => {
      const field = prev.fields.find(f => f.id === fieldId);
      if (!field) return prev;
      const oldName = field.name;
      
      const updateTemplate = (tpl: string | undefined) => {
         if (!tpl) return tpl;
         // replace {oldName} with {name} globally
         return tpl.replace(new RegExp(`\\{${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), `{${name}}`);
      };

      const newFields = prev.fields.map(f => {
         if (f.id === fieldId) {
            return { ...f, name };
         }
         // update prompts and templates using the old name
         let updated = { ...f };
         if (updated.prompt) {
            updated.prompt = updateTemplate(updated.prompt) as string;
         }
         if (updated.aiImageConfig) {
            updated.aiImageConfig = {
               ...updated.aiImageConfig,
               filenameTemplate: updateTemplate(updated.aiImageConfig.filenameTemplate),
               sourceImageTemplate: updateTemplate(updated.aiImageConfig.sourceImageTemplate),
               modelTemplate: updateTemplate(updated.aiImageConfig.modelTemplate),
            };
         }
         return updated;
      });

      return {
        ...prev,
        fields: newFields
      };
    });
  };

  const handleChangeFieldType = (fieldId: string, type: FieldType) => {
    setData(prev => {
      const field = prev.fields.find(f => f.id === fieldId);
      if (!field) return prev;
      
      let newFields = [...prev.fields];
      let newRecords = [...prev.records];
      let options = field.options || [];

      // Converting TO text from select
      if ((type === 'text' || type === 'aiText') && (field.type === 'singleSelect' || field.type === 'multiSelect')) {
         const optMap = new Map(options.map(o => [o.id, o.name]));
         newRecords = newRecords.map(r => {
            const v = r[fieldId];
            if (!v) return r;
            if (Array.isArray(v)) {
              return { ...r, [fieldId]: v.map(id => optMap.get(id) || id).join(', ') };
            }
            return { ...r, [fieldId]: optMap.get(v) || v };
         });
      } 
      // Converting TO select FROM text
      else if ((type === 'singleSelect' || type === 'multiSelect') && (field.type === 'text' || field.type === 'aiText' || field.type === 'url')) {
         const newOptions = [...options];
         
         const getOrCreateOption = (val: string) => {
           const trimmed = val.trim();
           if (!trimmed) return null;
           let opt = newOptions.find(o => o.name === trimmed);
           if (!opt) {
             const colors = ['bg-blue-100 text-blue-800', 'bg-green-100 text-green-800', 'bg-orange-100 text-orange-800', 'bg-red-100 text-red-800', 'bg-purple-100 text-purple-800', 'bg-yellow-100 text-yellow-800'];
             opt = { id: `opt_${Date.now()}_${Math.floor(Math.random()*1000)}`, name: trimmed, color: colors[newOptions.length % colors.length] };
             newOptions.push(opt);
           }
           return opt.id;
         };

         newRecords = newRecords.map(r => {
            const v = r[fieldId];
            if (typeof v === 'string') {
               if (type === 'multiSelect') {
                 const parts = v.split(',').map(s => s.trim()).filter(Boolean);
                 const mapped = parts.map(getOrCreateOption).filter(Boolean);
                 return { ...r, [fieldId]: mapped };
               } else {
                 return { ...r, [fieldId]: getOrCreateOption(v) };
               }
            }
            return r;
         });
         options = newOptions;

         newFields = newFields.map(f => f.id === fieldId ? { ...f, type, options } : f);
         return { ...prev, fields: newFields, records: newRecords };
      }

      newFields = newFields.map(f => f.id === fieldId ? { ...f, type } : f);
      return { ...prev, fields: newFields, records: newRecords };
    });
  };
  
  const handleReorderFields = (sourceId: string | string[], targetId: string) => {
    setData(prev => {
      const sourceIds = Array.isArray(sourceId) ? sourceId : [sourceId];
      if (sourceIds.includes(targetId)) return prev;

      const fieldsMap = new Map(prev.fields.map(f => [f.id, f]));
      const sourceFields = sourceIds.map(id => fieldsMap.get(id)!).filter(Boolean);
      
      let newFields = prev.fields.filter(f => !sourceIds.includes(f.id));
      const targetIndex = newFields.findIndex(f => f.id === targetId);
      
      if (targetIndex === -1) return prev;
      
      newFields.splice(targetIndex, 0, ...sourceFields);
      return { ...prev, fields: newFields };
    });
  };

  const handleReorderRecords = (sourceId: string, targetId: string) => {
    setData(prev => {
      const sourceIndex = prev.records.findIndex(r => r.id === sourceId);
      const targetIndex = prev.records.findIndex(r => r.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return prev;
      
      const newRecords = [...prev.records];
      const [movedItem] = newRecords.splice(sourceIndex, 1);
      newRecords.splice(targetIndex, 0, movedItem);
      
      return { ...prev, records: newRecords };
    });
  };

  const handleExportJSON = () => {
    const validFieldIds = new Set(['id', ...data.fields.map((f: any) => f.id)]);
    const cleanRecords = data.records.map((r: any) => {
       const cleanR: any = {};
       for (const key in r) {
         if (validFieldIds.has(key)) {
           cleanR[key] = r[key];
         }
       }
       // Process formulas
       data.fields.forEach((f: any) => {
         if (f.type === 'formula') {
           cleanR[f.id] = computeFormulaValue(f, r, data.fields);
         }
       });
       return cleanR;
    });
    const cleanData = { ...data, records: cleanRecords };
    
    const jsonStr = JSON.stringify(cleanData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitable_data.json';
    a.click();
    setShowExportMenu(false);
  };

  const handleImportJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        processJSONFile(file);
      }
    };
    input.click();
    setShowExportMenu(false);
  };

  const processJSONFile = (file: File, isDrop: boolean = false) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && parsed[0].data) {
           // It's a full project
           if (isDrop) {
               if (window.confirm(lang === 'en' ? "This is a project file. Replace current workspace (OK) or append as new tables (Cancel)?" : "这是一个工程文件。选“确定”替换当前工作区，选“取消”将表格追加到当前工作区。")) {
                   setTablesInternal(parsed);
                   setActiveTableId(parsed[0].id);
                   setProjectName(file.name.replace(/\.aistudio\.json$/i, "").replace(/\.json$/i, ""));
                   setHistory([]);
                   setFuture([]);
               } else {
                   const newTables = parsed.map((t: any) => ({...t, id: `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}` }));
                   setTables((prev: any[]) => [...prev, ...newTables]);
                   setActiveTableId(newTables[0].id);
               }
           } else {
               setTablesInternal(parsed);
               setActiveTableId(parsed[0].id);
               setProjectName(file.name.replace(/\.aistudio\.json$/i, "").replace(/\.json$/i, ""));
               setHistory([]);
               setFuture([]);
           }
        } else if (parsed.fields && parsed.records) {
           // It's a single table
          if (isDrop) {
            const newId = `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const cleanName = file.name.replace(/\.[^/.]+$/, "");
            setTables((prev: any[]) => [...prev, {
              id: newId,
              name: cleanName,
              data: parsed
            }]);
            setActiveTableId(newId);
          } else {
            setData(parsed);
          }
        } else {
          alert('Invalid format. Must contain fields and records or be a valid project array.');
        }
      } catch (err) {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const processCSVFile = (file: File, isDrop: boolean = false) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const headers = results.meta.fields || Object.keys(results.data[0]);
          const newFields: any[] = headers.map(h => ({
            id: 'fld_' + Math.random().toString(36).substring(2, 9),
            name: h,
            type: 'text',
            width: 150
          }));
          const newRecords = results.data.map((row: any) => {
            const rec: any = { id: 'rec_' + Math.random().toString(36).substring(2, 9) };
            newFields.forEach(f => {
              rec[f.id] = row[f.name];
            });
            return rec;
          });
          const parsedData = { fields: newFields, records: newRecords };
          if (isDrop) {
            const newId = `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const cleanName = file.name.replace(/\.[^/.]+$/, "");
            setTables((prev: any[]) => [...prev, {
              id: newId,
              name: cleanName,
              data: parsedData
            }]);
            setActiveTableId(newId);
          } else {
            setData(parsedData);
          }
        }
      }
    });
  };

  const handleExportCSV = () => {
    const csvData = data.records.map(record => {
      const row: any = {};
      data.fields.forEach(f => {
        let val = record[f.id];
        if (f.type === 'formula') {
          val = computeFormulaValue(f, record, data.fields);
        } else if (f.type === 'attachment' || f.type === 'aiImage') {
          if (Array.isArray(val)) {
            val = val.map((a: any) => typeof a === 'string' ? a : a.url || a.name || '').join(',');
          } else if (typeof val === 'string') {
            val = val;
          } else {
            val = '';
          }
        } else if (f.type === 'multiSelect') {
          const ids = (val as string[]) || [];
          val = ids.map(id => f.options?.find(o => o.id === id)?.name || id).join(',');
        } else if (f.type === 'singleSelect') {
          val = f.options?.find(o => o.id === val)?.name || val || '';
        } else if (typeof val === 'object' && val !== null) {
          val = JSON.stringify(val);
        }
        row[f.name] = val || '';
      });
      return row;
    });
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bitable_data.csv';
    a.click();
    setShowExportMenu(false);
  };

  const [lang, setLang] = useState<'en'|'zh'>('zh');
  const [isDraggingGlobalFile, setIsDraggingGlobalFile] = useState(false);

  const handleGlobalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Prevent internal element drags from triggering global drops
    if (!e.dataTransfer.types.includes('Files')) {
      return;
    }

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const type = e.dataTransfer.items[0].type;
      if (type.startsWith('image/')) {
        return; // do not show global overlay for images
      }
    }
    setIsDraggingGlobalFile(true);
  };

  const handleGlobalDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingGlobalFile(false);
  };

  const handleGlobalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingGlobalFile(false);
    
    // Prevent internal element drags from triggering global drops
    if (!e.dataTransfer.types.includes('Files')) {
      return;
    }
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.json') || file.name.endsWith('.aistudio.json')) {
        processJSONFile(file, true);
      } else if (file.name.endsWith('.csv')) {
        processCSVFile(file, true);
      }
    }
  };

  const handleImportCSV = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'text/csv';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        processCSVFile(file);
      }
    };
    input.click();
  };

  const handleResizeCol = (fieldId: string, width: number) => {
    setData(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, width } : f)
    }));
  };
  
  const handleUpdateField = (fieldId: string, updates: Partial<import('./types').Field>) => {
    setData((prev: any) => ({
      ...prev,
      fields: prev.fields.map((f: any) => f.id === fieldId ? { ...f, ...updates } : f)
    }));
  };

  let displayRecords = [...data.records];
  
  if (Object.keys(filterConfig).length > 0) {
    displayRecords = displayRecords.filter(record => {
      return (Object.entries(filterConfig) as [string, string][]).every(([fieldId, keyword]) => {
        if (!keyword) return true;
        const val = record[fieldId];
        if (val == null) return false;
        if (typeof val === 'string') return val.toLowerCase().includes(keyword.toLowerCase());
        if (typeof val === 'object') return JSON.stringify(val).toLowerCase().includes(keyword.toLowerCase());
        return String(val).toLowerCase().includes(keyword.toLowerCase());
      });
    });
  }

  if (sortConfig) {
    const field = data.fields.find((f: any) => f.id === sortConfig.fieldId);
    if (field) {
      displayRecords.sort((a, b) => {
        let valA = a[sortConfig.fieldId];
        let valB = b[sortConfig.fieldId];
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        }
        if (!valA && valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA && !valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
  }

  if (groupConfig.length > 0) {
      displayRecords.sort((a, b) => {
          for (const grp of groupConfig) {
              let vA = a[grp.fieldId];
              let vB = b[grp.fieldId];
              
              if (vA == null) vA = '';
              if (vB == null) vB = '';
              
              let strA = typeof vA === 'object' ? JSON.stringify(vA) : String(vA);
              let strB = typeof vB === 'object' ? JSON.stringify(vB) : String(vB);

              if (strA < strB) return grp.direction === 'asc' ? -1 : 1;
              if (strA > strB) return grp.direction === 'asc' ? 1 : -1;
          }
          return 0; 
      });
  }

  const displayData = { ...data, records: displayRecords };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <div className={`transition-all duration-300 ease-in-out flex flex-col shrink-0 flex-none overflow-hidden h-full z-10 bg-white border-r border-gray-200 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.05)] ${sidebarCollapsed ? 'w-14 items-center' : 'w-60'}`}>
        <div className="h-14 w-full flex items-center px-4 border-b border-gray-200 shrink-0 select-none">
          {userSettings.username ? (
            <div 
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm"
              style={{ backgroundColor: getStringColor(userSettings.username) }}
              title={userSettings.username}
            >
              {userSettings.username.charAt(0).toUpperCase()}
            </div>
          ) : (
            <div className="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold shrink-0">
               <Sparkles className="w-5 h-5" />
            </div>
          )}
          {!sidebarCollapsed && (
             <div className="ml-2 flex items-center group/proj overflow-hidden min-w-0 flex-1">
                 <input 
                   type="text" 
                   value={projectName} 
                   onChange={(e) => setProjectName(e.target.value)} 
                   className="font-bold text-gray-800 tracking-tight whitespace-nowrap bg-transparent outline-none truncate hover:bg-gray-100 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1 -ml-1 transition-all w-full"
                 />
                 <Edit2 className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover/proj:opacity-100 transition-opacity ml-1 shrink-0 pointer-events-none" />
             </div>
          )}
        </div>
        <div className={`p-3 flex-1 overflow-y-auto hide-scrollbar select-none w-full ${sidebarCollapsed ? 'px-2' : ''}`}>
          {!sidebarCollapsed ? (
             <>
                <div className="flex items-center justify-between px-2 mb-2 group/header">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tables</span>
                  <button onClick={handleAddTable} className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50" title="New table">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-0.5">
                  {tables.map(tbl => (
                    <TableNavItem 
                      key={tbl.id}
                      tbl={tbl}
                      isActive={tbl.id === activeTableId}
                      onClick={() => { setActiveTableId(tbl.id); }}
                      onRename={(name) => handleRenameTable(tbl.id, name)}
                      onDelete={() => handleDeleteTable(tbl.id)}
                      onDuplicate={() => handleDuplicateTable(tbl.id)}
                      onIconChange={(icon) => handleIconChange(tbl.id, icon)}
                      isDragged={draggedTableId === tbl.id}
                      isDragOverTop={dragOverTableId === tbl.id && dragOverTablePosition === 'top'}
                      isDragOverBottom={dragOverTableId === tbl.id && dragOverTablePosition === 'bottom'}
                      onDragStart={(e) => {
                         setDraggedTableId(tbl.id);
                         e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (draggedTableId && draggedTableId !== tbl.id) {
                          setDragOverTableId(tbl.id);
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const mid = rect.top + rect.height / 2;
                          setDragOverTablePosition(e.clientY < mid ? 'top' : 'bottom');
                        }
                      }}
                      onDragLeave={() => {
                         if (dragOverTableId === tbl.id) {
                            setDragOverTableId(null);
                            setDragOverTablePosition(null);
                         }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedTableId && draggedTableId !== tbl.id) {
                           setTables((prev: any[]) => {
                              const dragIdx = prev.findIndex(t => t.id === draggedTableId);
                              const dropIdx = prev.findIndex(t => t.id === tbl.id);
                              if (dragIdx === -1 || dropIdx === -1) return prev;
                              const newTables = [...prev];
                              const [moved] = newTables.splice(dragIdx, 1);
                              
                              // Calculate new drop index after splice
                              const finalDropIdx = newTables.findIndex(t => t.id === tbl.id);
                              newTables.splice(dragOverTablePosition === 'bottom' ? finalDropIdx + 1 : finalDropIdx, 0, moved);
                              return newTables;
                           });
                        }
                        setDraggedTableId(null);
                        setDragOverTableId(null);
                        setDragOverTablePosition(null);
                      }}
                      onDragEnd={() => {
                        setDraggedTableId(null);
                        setDragOverTableId(null);
                        setDragOverTablePosition(null);
                      }}
                    />
                  ))}
                </div>
             </>
          ) : (
            <div className="flex flex-col items-center space-y-2">
               <button onClick={handleAddTable} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-blue-600 transition-colors rounded hover:bg-blue-50" title="New table">
                  <Plus className="w-5 h-5" />
               </button>
               {tables.map(tbl => (
                  <button 
                    key={tbl.id} 
                    title={tbl.name}
                    onClick={() => setActiveTableId(tbl.id)}
                    className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${tbl.id === activeTableId ? 'bg-blue-100/80 text-blue-800' : 'text-gray-400 hover:bg-gray-200/50 hover:text-gray-900'}`}
                  >
                    {tbl.icon ? <span className="text-xl flex items-center justify-center -mt-px">{tbl.icon}</span> : <GridIcon className="w-5 h-5" />}
                  </button>
               ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-gray-200 flex flex-col space-y-2 shrink-0">
           <button 
             onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}
             className="flex items-center text-gray-500 hover:text-gray-900 transition-colors p-2 rounded hover:bg-gray-100"
             title={lang === 'en' ? "切换为中文" : "Switch to English"}
           >
             <div className="w-5 h-5 flex items-center justify-center font-bold text-xs">{lang === 'en' ? 'EN' : '中'}</div>
             {!sidebarCollapsed && <span className="ml-3 text-sm font-medium">{lang === 'en' ? 'English' : '简体中文'}</span>}
           </button>
           <button 
             onClick={() => setShowSettings(true)}
             className="flex items-center text-gray-500 hover:text-gray-900 transition-colors p-2 rounded hover:bg-gray-100"
             title="Settings"
           >
             <Settings className="w-5 h-5" />
             {!sidebarCollapsed && <span className="ml-3 text-sm font-medium">{lang === 'en' ? 'Settings' : '设置'}</span>}
           </button>
        </div>
      </div>

      {/* Main Content */}
      <div 
        className="flex-1 flex flex-col min-w-0 relative"
        onDrop={handleGlobalDrop}
        onDragOver={handleGlobalDragOver}
        onDragLeave={handleGlobalDragLeave}
      >
        {isDraggingGlobalFile && (
          <div className="absolute inset-0 z-50 bg-blue-50/90 border-4 border-dashed border-blue-400 flex flex-col items-center justify-center rounded-xl m-4 pointer-events-none">
            <Upload className="w-16 h-16 text-blue-500 mb-4" />
            <h2 className="text-2xl font-bold text-blue-700 mb-2">{lang === 'en' ? 'Drop JSON or CSV file to load' : '释放鼠标导入 JSON 或 CSV'}</h2>
            <p className="text-blue-600/80">{lang === 'en' ? 'Your current data will be replaced' : '当前数据将被替换'}</p>
          </div>
        )}
        
        {/* Top Header */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-gray-200 shrink-0 bg-white">
          <div className="flex items-center space-x-3">
            <button 
               className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
               onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
               title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
               {sidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
            </button>
            <div className="w-px h-5 bg-gray-200"></div>

            <div className="relative">
              <div 
                className="flex items-center text-lg font-bold text-gray-800 tracking-tight cursor-pointer hover:bg-gray-100 px-2 py-1 rounded transition-colors group"
                onClick={() => setShowTableMenu(!showTableMenu)}
              >
                 {tables[activeTableIndex]?.icon && <span className="mr-2 text-[22px] leading-none flex items-center">{tables[activeTableIndex].icon}</span>}
                 {activeTableName}
                 <ChevronDown className="w-4 h-4 ml-1 text-gray-400 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              {showTableMenu && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.1)] py-1 z-50">
                  {tables.map(tbl => (
                    <button 
                      key={tbl.id}
                      onClick={() => { setActiveTableId(tbl.id); setShowTableMenu(false); }}
                      className={`w-full flex items-center px-4 py-2 text-sm transition-colors ${tbl.id === activeTableId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
                    >
                      {tbl.icon ? <span className="mr-2.5 text-base leading-none -mt-px w-4 text-center">{tbl.icon}</span> : <GridIcon className="w-4 h-4 mr-2.5 opacity-60" />}
                      {tbl.name}
                    </button>
                  ))}
                  <div className="border-t border-gray-100 my-1"></div>
                  <button 
                    onClick={() => { handleAddTable(); setShowTableMenu(false); }}
                    className="w-full flex items-center px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    New empty table
                  </button>
                </div>
              )}
            </div>
            
            <div className="w-px h-5 bg-gray-200 mx-1"></div>
            <div className="flex items-center space-x-1">
              <button 
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                onClick={undo} disabled={history.length === 0} title="Undo"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button 
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                onClick={redo} disabled={future.length === 0} title="Redo"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-600">
             <div 
               className="flex items-center justify-center space-x-1.5 px-3 h-8 rounded-md transition-colors font-medium border border-gray-200 hover:bg-gray-50 cursor-pointer"
               onClick={handleNewProject}
             >
               <Plus className="w-4 h-4 text-gray-500" />
               <span>{lang === 'en' ? 'New Project' : '新建工程'}</span>
             </div>

             <div 
               className="flex items-center justify-center space-x-1.5 px-3 h-8 rounded-md transition-colors font-medium border border-gray-200 hover:bg-gray-50 cursor-pointer"
               onClick={handleOpenProject}
             >
               <FolderOpen className="w-4 h-4 text-gray-500" />
               <span>{lang === 'en' ? 'Open Project' : '打开工程'}</span>
             </div>

             <div className="relative">
                <div 
                  className="flex items-center justify-center space-x-1.5 px-3 h-8 rounded-md transition-colors font-medium border border-gray-200 hover:bg-gray-50 cursor-pointer"
                  onClick={() => { setShowLoadMenu(!showLoadMenu); setShowShareMenu(false); setShowSaveMenu(false); }}
                >
                  <Upload className="w-4 h-4 text-gray-500" />
                  <span>{lang === 'en' ? 'Import' : '导入'}</span>
                  <ChevronDown className="w-4 h-4 ml-1 opacity-50" />
                </div>
                {showLoadMenu && (
                  <div className="absolute top-full right-0 pt-1 w-48 z-50">
                    <div className="fixed inset-0 z-40" onClick={() => setShowLoadMenu(false)}></div>
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 relative z-50">
                      <button onClick={() => { handleImportJSON(); setShowLoadMenu(false); }} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                         <FileJson className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Import JSON' : '导入 JSON'}
                      </button>
                      <button onClick={() => { handleImportCSV(); setShowLoadMenu(false); }} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                         <Upload className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Import CSV' : '导入 CSV'}
                      </button>
                    </div>
                  </div>
                )}
             </div>

             <div className="flex items-stretch relative h-8">
                 <div 
                   className="flex items-center justify-center space-x-1.5 px-3 h-full rounded-l-md transition-colors font-medium border border-gray-200 hover:bg-gray-50 cursor-pointer text-blue-600 bg-blue-50/50"
                   onClick={() => saveProjectToDisk(false)}
                 >
                   <Save className="w-4 h-4 text-blue-600" />
                   <span>{lang === 'en' ? 'Save' : '保存'}</span>
                 </div>
                 <div 
                   className="flex items-center justify-center px-2 h-full rounded-r-md transition-colors font-medium border-t border-b border-r border-gray-200 hover:bg-gray-50 cursor-pointer text-blue-600 bg-blue-50/50 -ml-px"
                   onClick={() => { setShowSaveMenu(!showSaveMenu); setShowLoadMenu(false); setShowShareMenu(false); }}
                 >
                   <ChevronDown className="w-4 h-4" />
                 </div>
                 {showSaveMenu && (
                   <div className="absolute top-full right-0 pt-1 w-48 z-50 text-gray-800">
                     <div className="fixed inset-0 z-40" onClick={() => setShowSaveMenu(false)}></div>
                     <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 relative z-50">
                       <button onClick={() => { saveProjectToDisk(true); setShowSaveMenu(false); }} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                         <Save className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Save As...' : '另存为...'}
                       </button>
                     </div>
                   </div>
                 )}
             </div>

             <div className="relative">
                <div 
                  className="flex items-center justify-center space-x-1.5 px-3 h-8 rounded-md transition-colors font-medium border border-gray-200 hover:bg-gray-50 cursor-pointer"
                  onClick={() => { setShowShareMenu(!showShareMenu); setShowLoadMenu(false); setShowSaveMenu(false); }}
                >
                  <Share2 className="w-4 h-4 text-gray-500" />
                  <span>{lang === 'en' ? 'Share' : '分享'}</span>
                  <ChevronDown className="w-4 h-4 ml-1 opacity-50" />
                </div>
                {showShareMenu && (
                  <div className="absolute top-full right-0 pt-1 w-48 z-50 text-gray-800">
                    <div className="fixed inset-0 z-40" onClick={() => setShowShareMenu(false)}></div>
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 relative z-50">
                      <button onClick={() => { handleExportJSON(); setShowShareMenu(false); }} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                       <FileJson className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Export JSON' : '导出 JSON'}
                    </button>
                    <button onClick={() => { handleExportCSV(); setShowShareMenu(false); }} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                       <Download className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Export CSV' : '导出 CSV'}
                    </button>
                  </div>
                </div>
                )}
             </div>
          </div>
        </header>

        {/* Toolbar */}
        <div className="h-[46px] flex items-center justify-between px-4 border-b border-gray-200 shrink-0 bg-white">
          <div className="flex items-center space-x-1 text-sm text-gray-600">
             <div className="relative group/viewmode">
                <ToolbarButton 
                   icon={activeViewMode === 'grid' ? <GridIcon className="w-4 h-4 text-blue-600"/> : <ImageIcon className="w-4 h-4 text-blue-600"/> } 
                   label={activeViewMode === 'grid' ? (lang === 'en' ? "Main Grid" : "默认视图") : (lang === 'en' ? "Image Review" : "图片审阅")} 
                   active 
                />
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 opacity-0 pointer-events-none group-hover/viewmode:opacity-100 group-hover/viewmode:pointer-events-auto transition-opacity min-w-[140px]">
                   <button className="w-full flex items-center px-4 py-2 text-sm hover:bg-gray-100" onClick={() => setActiveViewMode('grid')}>
                      <GridIcon className="w-4 h-4 mr-2 text-gray-500" />
                      {lang === 'en' ? 'Main Grid' : '默认视图'}
                   </button>
                   <button className="w-full flex items-center px-4 py-2 text-sm hover:bg-gray-100" onClick={() => setActiveViewMode('gallery')}>
                      <ImageIcon className="w-4 h-4 mr-2 text-gray-500" />
                      {lang === 'en' ? 'Image Review' : '图片审阅'}
                   </button>
                </div>
             </div>
             <div className="w-px h-3.5 bg-gray-300 mx-1.5" />
             <div className="relative">
               <ToolbarButton 
                 icon={<EyeOff className="w-4 h-4"/>} 
                 label={lang === 'en' ? "Hide fields" : "隐藏字段"} 
                 onClick={() => setShowHideFieldsMenu(!showHideFieldsMenu)} 
               />
               {showHideFieldsMenu && (
                 <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 max-h-96 overflow-y-auto">
                    <div className="fixed inset-0 z-40" onClick={() => setShowHideFieldsMenu(false)}></div>
                    <div className="relative z-50 py-1">
                      {data.fields.map((field: any) => (
                         <div 
                           key={field.id} 
                           className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 cursor-pointer"
                           onClick={() => {
                             handleUpdateField(field.id, { hidden: !field.hidden });
                           }}
                         >
                           <span className="text-sm text-gray-700">{field.name}</span>
                           <div className="text-gray-400 hover:text-gray-600 transition-colors">
                              {field.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                           </div>
                         </div>
                      ))}
                    </div>
                 </div>
               )}
             </div>
             <div className="relative">
               <button 
                 className={`flex items-center space-x-1 hover:bg-gray-100 px-2 py-1.5 rounded transition-colors ${Object.keys(filterConfig).length > 0 ? 'bg-blue-50 text-blue-700' : ''}`}
                 onClick={() => setShowGlobalFilterMenu(!showGlobalFilterMenu)}
               >
                 <Filter className={`w-4 h-4 ${Object.keys(filterConfig).length > 0 ? 'text-blue-600' : 'text-gray-500'}`} />
                 <span>{lang === 'en' ? "Filter" : "筛选"}</span>
               </button>
               {showGlobalFilterMenu && (
                 <div className="absolute top-full left-0 mt-1 w-[320px] bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                    <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowGlobalFilterMenu(false); }}></div>
                    <div className="relative z-50">
                    <div className="px-3 py-2 text-sm font-medium border-b border-gray-100">{lang === 'en' ? 'Filter conditions' : '筛选条件'}</div>
                    <div className="p-2 space-y-2">
                       {Object.entries(filterConfig).map(([fieldId, keyword], i) => (
                          <div key={i} className="flex items-center gap-2">
                            <select 
                              className="w-1/2 text-sm border border-gray-300 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              value={fieldId}
                              onChange={(e) => {
                                const newConf = { ...filterConfig };
                                delete newConf[fieldId];
                                newConf[e.target.value] = keyword;
                                setFilterConfig(newConf);
                              }}
                            >
                              {data.fields.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            <input
                              className="w-1/2 text-sm border border-gray-300 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder={lang === 'en' ? "Contains keyword..." : "包含关键字..."}
                              value={keyword}
                              onChange={(e) => {
                                setFilterConfig({ ...filterConfig, [fieldId]: e.target.value });
                              }}
                            />
                            <button className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500 shrink-0" onClick={() => {
                              const newConf = { ...filterConfig };
                              delete newConf[fieldId];
                              setFilterConfig(newConf);
                            }}>
                              <Trash2 className="w-4 h-4"/>
                            </button>
                          </div>
                       ))}
                       <button 
                         className="text-sm px-2 py-1 text-blue-600 hover:bg-blue-50 flex items-center rounded w-full"
                         onClick={() => {
                             const unassigned = data.fields.find((f: any) => filterConfig[f.id] === undefined);
                             if (unassigned) {
                                 setFilterConfig({ ...filterConfig, [unassigned.id]: '' });
                             }
                         }}
                       >
                         <Plus className="w-4 h-4 mr-1" /> {lang === 'en' ? 'Add filter' : '添加筛选'}
                       </button>
                    </div>
                    </div>
                 </div>
               )}
             </div>
             <div className="relative">
               <button 
                 className={`flex items-center space-x-1 hover:bg-gray-100 px-2 py-1.5 rounded transition-colors ${groupConfig.length > 0 ? 'bg-blue-50 text-blue-700' : ''}`}
                 onClick={() => setShowGroupMenu(!showGroupMenu)}
               >
                 <LayoutTemplate className={`w-4 h-4 ${groupConfig.length > 0 ? 'text-blue-600' : 'text-gray-500'}`} />
                 <span>{lang === 'en' ? "Group" : "分组"}</span>
               </button>
               {showGroupMenu && (
                 <div className="absolute top-full left-0 mt-1 w-[320px] bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                    <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowGroupMenu(false); }}></div>
                    <div className="relative z-50">
                    <div className="px-3 py-2 text-sm font-medium border-b border-gray-100">{lang === 'en' ? 'Group by fields' : '分组条件'}</div>
                    <div className="p-2 space-y-2">
                       {groupConfig.map((grp, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <select 
                              className="flex-1 text-sm border border-gray-300 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              value={grp.fieldId}
                              onChange={(e) => {
                                const newConf = [...groupConfig];
                                newConf[i].fieldId = e.target.value;
                                setGroupConfig(newConf);
                              }}
                            >
                              {data.fields.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            <select 
                              className="text-sm border border-gray-300 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              value={grp.direction}
                              onChange={(e) => {
                                const newConf = [...groupConfig];
                                newConf[i].direction = e.target.value as 'asc'|'desc';
                                setGroupConfig(newConf);
                              }}
                            >
                              <option value="asc">{lang === 'en' ? 'Ascending' : '升序'}</option>
                              <option value="desc">{lang === 'en' ? 'Descending' : '降序'}</option>
                            </select>
                            <button className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500" onClick={() => {
                              setGroupConfig(groupConfig.filter((_, idx) => idx !== i));
                            }}>
                              <Trash2 className="w-4 h-4"/>
                            </button>
                          </div>
                       ))}
                       {groupConfig.length < data.fields.length && (
                         <button 
                           className="text-sm px-2 py-1 text-blue-600 hover:bg-blue-50 flex items-center rounded w-full"
                           onClick={() => setGroupConfig([...groupConfig, { fieldId: data.fields[0].id, direction: 'asc' }])}
                         >
                           <Plus className="w-4 h-4 mr-1" /> {lang === 'en' ? 'Add group' : '添加分组'}
                         </button>
                       )}
                    </div>
                    </div>
                 </div>
               )}
             </div>
             <div className="relative">
               <button 
                 className={`flex items-center space-x-1 hover:bg-gray-100 px-2 py-1.5 rounded transition-colors ${sortConfig ? 'bg-blue-50 text-blue-700' : ''}`}
                 onClick={() => setShowGlobalSortMenu(!showGlobalSortMenu)}
               >
                 <ArrowDownUp className={`w-4 h-4 ${sortConfig ? 'text-blue-600' : 'text-gray-500'}`} />
                 <span>{lang === 'en' ? "Sort" : "排序"}</span>
               </button>
               {showGlobalSortMenu && (
                 <div className="absolute top-full left-0 mt-1 w-[320px] bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                    <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowGlobalSortMenu(false); }}></div>
                    <div className="relative z-50">
                    <div className="px-3 py-2 text-sm font-medium border-b border-gray-100">{lang === 'en' ? 'Sort' : '排序'}</div>
                    <div className="p-2 space-y-2">
                       {sortConfig ? (
                          <div className="flex items-center gap-2">
                            <select 
                              className="flex-1 text-sm border border-gray-300 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              value={sortConfig.fieldId}
                              onChange={(e) => {
                                setSortConfig({ ...sortConfig, fieldId: e.target.value });
                              }}
                            >
                              {data.fields.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                            <select 
                              className="text-sm border border-gray-300 rounded p-1 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              value={sortConfig.direction}
                              onChange={(e) => {
                                setSortConfig({ ...sortConfig, direction: e.target.value as 'asc'|'desc' });
                              }}
                            >
                              <option value="asc">{lang === 'en' ? 'Ascending' : '升序'}</option>
                              <option value="desc">{lang === 'en' ? 'Descending' : '降序'}</option>
                            </select>
                            <button className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500" onClick={() => {
                              setSortConfig(null);
                            }}>
                              <Trash2 className="w-4 h-4"/>
                            </button>
                          </div>
                       ) : (
                         <button 
                           className="text-sm px-2 py-1 text-blue-600 hover:bg-blue-50 flex items-center rounded w-full"
                           onClick={() => {
                               setSortConfig({ fieldId: data.fields[0].id, direction: 'asc' });
                           }}
                         >
                           <Plus className="w-4 h-4 mr-1" /> {lang === 'en' ? 'Add sort' : '添加排序'}
                         </button>
                       )}
                    </div>
                    </div>
                 </div>
               )}
             </div>
             <div className="relative">
               <button 
                 className="flex items-center space-x-1 hover:bg-gray-100 px-2 py-1.5 rounded transition-colors"
                 onClick={() => setShowRowHeightMenu(!showRowHeightMenu)}
               >
                 <AlignJustify className="w-4 h-4 text-gray-500" />
                 <span>{lang === 'en' ? "Height" : "行高"}</span>
               </button>
               {showRowHeightMenu && (
                 <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                   <button onClick={() => { setRowHeight('short'); setShowRowHeightMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100">{lang === 'en' ? "Short" : "紧凑"}</button>
                   <button onClick={() => { setRowHeight('medium'); setShowRowHeightMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100">{lang === 'en' ? "Medium" : "中等"}</button>
                   <button onClick={() => { setRowHeight('tall'); setShowRowHeightMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100">{lang === 'en' ? "Tall" : "宽松"}</button>
                   <button onClick={() => { setRowHeight('extra'); setShowRowHeightMenu(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100">{lang === 'en' ? "Extra Tall" : "极宽"}</button>
                 </div>
               )}
             </div>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              className={`text-gray-400 hover:text-gray-600 p-1.5 rounded hover:bg-gray-100 ${showSearch ? 'bg-gray-100 text-gray-800' : ''}`}
              onClick={() => {
                setShowSearch(!showSearch);
                if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
            >
              <Search className="w-4 h-4" />
            </button>
            <div className="flex items-center space-x-2">
               <button 
                 onClick={handleAddRecord}
                 className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors group relative"
                 title={lang === 'en' ? "Add Row" : "添加行"}
               >
                 <Plus className="w-5 h-5" />
                 <div className="absolute top-full mt-1 right-0 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
                    {lang === 'en' ? "Add Row" : "添加行"}
                 </div>
               </button>
            </div>
          </div>
        </div>

        {/* Grid Area */}
        <div className="flex-1 flex flex-col min-h-0 relative bg-white overflow-hidden">
          {showSearch && (
            <div className="absolute top-4 right-4 z-50 bg-white shadow-lg rounded-lg border border-gray-200 flex items-center px-2 py-1.5 space-x-2">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'en' ? "Search..." : "查找..."}
                className="w-40 text-sm border-none focus:outline-none focus:ring-0 bg-transparent text-gray-800 placeholder-gray-400"
              />
              <div className="flex items-center space-x-1 border-l border-gray-200 pl-2">
                <span className="text-xs text-gray-500 min-w-12 text-center select-none">
                  {searchQuery ? `${searchMatches.length > 0 ? currentSearchIndex + 1 : 0} / ${searchMatches.length}` : ''}
                </span>
                <button 
                  onClick={handlePrevSearch}
                  disabled={searchMatches.length === 0}
                  className="p-1 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-50"
                  title={lang === 'en' ? "Previous" : "上一个"}
                >
                  <ChevronDown className="w-4 h-4 transform rotate-180" />
                </button>
                <button 
                  onClick={handleNextSearch}
                  disabled={searchMatches.length === 0}
                  className="p-1 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-50"
                  title={lang === 'en' ? "Next" : "下一个"}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setShowSearch(false)}
                  className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 ml-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          <Grid 
            tableId={activeTableId}
            viewMode={activeViewMode}
            lang={lang}
            username={userSettings.username}
            data={displayData}
            searchQuery={showSearch ? searchQuery : ''}
            searchMatches={showSearch ? searchMatches : undefined}
            activeSearchMatch={showSearch && searchMatches.length > 0 ? searchMatches[currentSearchIndex] : null}
            rowHeight={rowHeight}
            groupConfig={groupConfig}
            sortConfig={sortConfig}
            filterConfig={filterConfig}
            foldedGroups={foldedGroups}
            onFoldedGroupsChange={setFoldedGroups}
            gallerySettings={gallerySettings}
            onGallerySettingsChange={setGallerySettings}
            onUpdateGlobalAttachment={(url: string, updatedProps: any) => {
               setData((prev: any) => ({
                 ...prev,
                 records: prev.records.map((rec: any) => {
                     let changed = false;
                     const newRec = { ...rec };
                     prev.fields.forEach((f: any) => {
                         if (f.type === 'attachment' || f.type === 'aiImage') {
                             const val = rec[f.id];
                             if (Array.isArray(val)) {
                                 const newVal = val.map(v => {
                                     const vUrl = typeof v === 'string' ? v : v.url;
                                     if (vUrl === url) return typeof v === 'string' ? { url: vUrl, ...updatedProps } : { ...v, ...updatedProps };
                                     return v;
                                 });
                                 if (JSON.stringify(newVal) !== JSON.stringify(val)) {
                                     newRec[f.id] = newVal;
                                     changed = true;
                                 }
                             } else if (typeof val === 'string' && val.trim() !== '') {
                                 const parts = val.split(',').map(s => s.trim());
                                 if (parts.includes(url)) {
                                     const newVal = parts.map(p => p === url ? { url: p, ...updatedProps } : { url: p });
                                     newRec[f.id] = newVal;
                                     changed = true;
                                 }
                             } else if (val && typeof val === 'object' && !Array.isArray(val)) {
                                 if (val.url === url) {
                                     newRec[f.id] = { ...val, ...updatedProps };
                                     changed = true;
                                 }
                             }
                         }
                     });
                     return changed ? newRec : rec;
                 })
               }));
            }}
            onUpdateRecord={handleUpdateRecord}
            onAddRecord={handleAddRecord}
            onInsertRecords={handleInsertRecords}
            onDeleteRecords={handleDeleteRecords}
            onAddField={handleAddField}
            onInsertField={handleInsertField}
            onFreezeColumn={handleFreezeColumn}
            onDeleteField={handleDeleteField}
            onRenameField={handleRenameField}
            onChangeFieldType={handleChangeFieldType}
            onResizeCol={handleResizeCol}
            onUpdateField={handleUpdateField}
            onReorderFields={handleReorderFields}
            onReorderRecords={handleReorderRecords}
            onSortField={(fieldId: string, direction: 'asc'|'desc'|null) => {
              if (direction) {
                setSortConfig({ fieldId, direction });
              } else {
                setSortConfig(null);
              }
            }}
            onFilterField={(fieldId: string, keyword: string) => {
              setFilterConfig(prev => {
                const newConf = { ...prev };
                if (keyword) {
                  newConf[fieldId] = keyword;
                } else {
                  delete newConf[fieldId];
                }
                return newConf;
              });
            }}
            modelSettings={modelSettings}
          />
        </div>

      {showNewProjectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold mb-4">{lang === 'en' ? 'New Project' : '新建工程'}</h2>
            <p className="text-gray-600 mb-6">{lang === 'en' ? 'Create a new project? Unsaved changes will be lost if not saved.' : '确定要新建工程吗？如果未保存为文件，当前的更改可能会丢失。'}</p>
            <div className="flex justify-end space-x-3">
              <button 
                onClick={() => setShowNewProjectConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button 
                onClick={confirmNewProject}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                {lang === 'en' ? 'Confirm' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">{lang === 'en' ? 'Settings' : '设置'}</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-800"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="mb-6 pb-6 border-b border-gray-100">
               <h3 className="font-semibold text-gray-700 pb-2">{lang === 'en' ? 'Team Identity (Username)' : '团队身份 (用户名)'}</h3>
               <p className="text-[10px] text-gray-500 mb-2">{lang === 'en' ? 'Used for annotations and reviewing. Simply enter your name.' : '用于本机的审阅和批注标记的身份标识，无需密码只需填写你的名字。'}</p>
               <input 
                  type="text" 
                  className="w-full md:w-1/2 border border-gray-300 rounded-md px-3 py-2 text-sm" 
                  placeholder={lang === 'en' ? 'e.g. Alice' : '例如: 阿强'}
                  value={userSettings.username || ''}
                  onChange={e => setUserSettings({ ...userSettings, username: e.target.value })}
               />
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Text Model Settings */}
              <div className="space-y-4">
                 <h3 className="font-semibold text-gray-700 pb-2 border-b">Text AI Model (LLM)</h3>
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                    <select 
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      value={modelSettings.text?.provider || 'openai'}
                      onChange={e => setModelSettings(prev => ({ ...prev, text: { ...prev.text, provider: e.target.value } }))}
                    >
                       <option value="gemini">Gemini (Google AI Studio)</option>
                       <option value="gemini-custom">Gemini (Compatible Endpoint)</option>
                       <option value="openai">OpenAI Compatible</option>
                    </select>
                 </div>
                 
                 {(modelSettings.text?.provider === 'gemini' || modelSettings.text?.provider === 'gemini-custom') && (
                    <>
                      {modelSettings.text?.provider === 'gemini-custom' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">API Endpoint</label>
                            <input 
                              type="url" 
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                              placeholder="https://api.example.com/v1beta/models/..."
                              value={modelSettings.text?.endpoint || ''}
                              onChange={e => setModelSettings(prev => ({ ...prev, text: { ...prev.text, endpoint: e.target.value } }))}
                            />
                          </div>
                        </>
                      )}
                      {(modelSettings.text?.provider === 'gemini' || modelSettings.text?.provider === 'gemini-custom') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Model Name (Use ',' for multiple models)</label>
                          <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                            placeholder="gemini-1.5-pro, gemini-1.5-flash"
                            value={modelSettings.text?.modelName || ''}
                            onChange={e => setModelSettings(prev => ({ ...prev, text: { ...prev.text, modelName: e.target.value } }))}
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key</label>
                        <input 
                          type="password" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="AIzaSy..."
                          value={modelSettings.text?.key || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, text: { ...prev.text, key: e.target.value } }))}
                        />
                      </div>
                    </>
                 )}

                 {modelSettings.text?.provider === 'openai' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API Endpoint</label>
                        <input 
                          type="url" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="https://api.openai.com/v1"
                          value={modelSettings.text?.endpoint || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, text: { ...prev.text, endpoint: e.target.value } }))}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Model Name (Use ',' for multiple models)</label>
                        <input 
                          type="text" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="gpt-3.5-turbo, gpt-4o"
                          value={modelSettings.text?.modelName || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, text: { ...prev.text, modelName: e.target.value } }))}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                        <input 
                          type="password" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="sk-..."
                          value={modelSettings.text?.key || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, text: { ...prev.text, key: e.target.value } }))}
                        />
                      </div>
                    </>
                  )}
              </div>

              {/* Image Model Settings */}
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-700 pb-2 border-b">Image AI Model</h3>
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                    <select 
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      value={modelSettings.image?.provider || 'openai'}
                      onChange={e => setModelSettings(prev => ({ ...prev, image: { ...prev.image, provider: e.target.value } }))}
                    >
                       <option value="gemini">Gemini (Google AI Studio)</option>
                       <option value="gemini-custom">Gemini (Compatible Endpoint)</option>
                       <option value="openai">OpenAI Compatible</option>
                    </select>
                 </div>
                 
                 {(modelSettings.image?.provider === 'gemini' || modelSettings.image?.provider === 'gemini-custom') && (
                    <>
                      {modelSettings.image?.provider === 'gemini-custom' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">API Endpoint</label>
                            <input 
                              type="url" 
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                              placeholder="https://api.example.com/v1beta/models/..."
                              value={modelSettings.image?.endpoint || ''}
                              onChange={e => setModelSettings(prev => ({ ...prev, image: { ...prev.image, endpoint: e.target.value } }))}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Model Name (Use ',' for multiple models)</label>
                            <input 
                              type="text" 
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                              placeholder="gemini-3.1-flash-image-preview, gemini-3-pro-image-preview"
                              value={modelSettings.image?.modelName || ''}
                              onChange={e => setModelSettings(prev => ({ ...prev, image: { ...prev.image, modelName: e.target.value } }))}
                            />
                          </div>
                        </>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key</label>
                        <input 
                          type="password" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="AIzaSy..."
                          value={modelSettings.image?.key || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, image: { ...prev.image, key: e.target.value } }))}
                        />
                      </div>
                    </>
                 )}

                 {modelSettings.image?.provider === 'openai' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API Endpoint</label>
                        <input 
                          type="url" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="https://api.openai.com/v1"
                          value={modelSettings.image?.endpoint || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, image: { ...prev.image, endpoint: e.target.value } }))}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
                        <input 
                          type="text" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="dall-e-3"
                          value={modelSettings.image?.modelName || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, image: { ...prev.image, modelName: e.target.value } }))}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                        <input 
                          type="password" 
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                          placeholder="sk-..."
                          value={modelSettings.image?.key || ''}
                          onChange={e => setModelSettings(prev => ({ ...prev, image: { ...prev.image, key: e.target.value } }))}
                        />
                      </div>
                    </>
                 )}
              </div>
            </div>

            <hr className="my-6 border-gray-200" />
            
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">{lang === 'en' ? 'Project Auto Backup' : '项目自动备份'}</h2>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <input 
                  type="checkbox"
                  id="autosave-toggle"
                  checked={autoSaveSettings.enabled}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      if (!(window as any).activeProjectFileHandle) {
                          alert(lang === 'en' ? 'Please save the project first before enabling auto-backup.' : '请先保存工程后再开启自动备份。');
                          return;
                      }
                      try {
                        const handle = await (window as any).showDirectoryPicker({ 
                            mode: 'readwrite',
                            startIn: (window as any).activeProjectFileHandle
                        });
                        dirHandleRef.current = handle;
                        await setHandle('autosave_dir', handle);
                        setAutoSaveSettings(prev => ({ ...prev, enabled: true, folderName: handle.name }));
                      } catch (err) {
                        console.error('Failed to get directory', err);
                        setAutoSaveSettings(prev => ({ ...prev, enabled: false }));
                      }
                    } else {
                      dirHandleRef.current = null;
                      setAutoSaveSettings(prev => ({ ...prev, enabled: false }));
                    }
                  }}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300"
                />
                <label htmlFor="autosave-toggle" className="text-sm font-medium text-gray-700">{lang === 'en' ? 'Enable project auto backup (saves as .backup in the project folder)' : '启用项目自动备份 (在当前工程所在文件夹中保存同名的 .backup 文件)'}</label>
              </div>
              
              {autoSaveSettings.enabled && (
                <div className="pl-6 space-y-4">
                  <div className="flex flex-col space-y-1">
                    <span className="text-sm font-medium text-gray-700">{lang === 'en' ? 'Backup Folder:' : '备份文件夹:'}</span>
                    <div className="flex items-center space-x-2">
                      <input 
                        type="text" 
                        readOnly 
                        value={autoSaveSettings.folderName || ''} 
                        className="px-2 py-1.5 text-sm border rounded bg-gray-50 flex-1 outline-none font-mono text-gray-600" 
                        placeholder={lang === 'en' ? 'No folder selected' : '未选择文件夹'}
                      />
                      <button 
                        onClick={async () => {
                          try {
                            const handle = await (window as any).showDirectoryPicker({ 
                                mode: 'readwrite',
                                startIn: (window as any).activeProjectFileHandle || undefined
                            });
                            dirHandleRef.current = handle;
                            await setHandle('autosave_dir', handle);
                            setAutoSaveSettings(prev => ({ ...prev, folderName: handle.name }));
                          } catch (err) {
                            console.error('Failed to get directory', err);
                          }
                        }}
                        className="px-3 py-1.5 text-sm bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                      >
                        {lang === 'en' ? 'Change Folder' : '更改文件夹'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{lang === 'en' ? 'Save Interval (Minutes)' : '保存间隔时长 (分钟)'}</label>
                    <input 
                      type="number"
                      min="1"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      value={autoSaveSettings.interval}
                      onChange={e => setAutoSaveSettings(prev => ({ ...prev, interval: parseInt(e.target.value) || 5 }))}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
               <button onClick={() => setShowSettings(false)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700">Done</button>
            </div>
          </div>
        </div>
      )}
      {toastMessage && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[100] px-4 py-2 bg-gray-800 text-white rounded shadow-lg text-sm transition-opacity duration-300 pointer-events-none">
          {toastMessage}
        </div>
      )}
      </div>
    </div>
  );
}

function ToolbarButton({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button className={`flex items-center space-x-1.5 px-2 py-1 rounded hover:bg-gray-100 transition-colors ${active ? 'bg-gray-100' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {active && <ChevronDown className="w-3.5 h-3.5 opacity-60 ml-0.5" />}
    </button>
  );
}
