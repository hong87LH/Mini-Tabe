import React, { useState, useEffect } from 'react';
import { initialGridData } from './initialData';
import { Grid } from './components/Grid';
import { FieldType, Attachment, GridData } from './types';
import { Search, UserCircle, Share2, Grid as GridIcon, Filter, ArrowDownUp, EyeOff, LayoutTemplate, Settings, Bell, MoreHorizontal, ChevronDown, Plus, Download, Upload, FileJson, X, AlignJustify, Trash2, Edit2, Undo2, Redo2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Papa from 'papaparse';

function TableNavItem({ 
  tbl, isActive, onClick, onRename, onDelete 
}: { 
  key?: React.Key; tbl: any; isActive: boolean; onClick: () => void; onRename: (n: string) => void; onDelete: () => void;
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [name, setName] = React.useState(tbl.name);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus(); inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (name.trim()) onRename(name.trim());
    else setName(tbl.name);
    setIsEditing(false);
  };

  return (
    <div 
      className={`group flex flex-1 items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-200/50 hover:text-gray-900'}`}
      onClick={!isEditing ? onClick : undefined}
      onDoubleClick={() => setIsEditing(true)}
    >
      <div className="flex items-center truncate min-w-0 flex-1">
        <GridIcon className={`w-4 h-4 mr-2 shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}`} />
        {isEditing ? (
          <input
            ref={inputRef} type="text"
            className="flex-1 bg-white border border-blue-400 rounded px-1 text-sm outline-none text-gray-900"
            value={name} onChange={(e) => setName(e.target.value)} onBlur={handleSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setName(tbl.name); setIsEditing(false); } }}
          />
        ) : (
          <span className="truncate text-sm select-none">{tbl.name}</span>
        )}
      </div>
      {!isEditing && (
        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 shrink-0 ml-2">
          <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className="p-0.5 text-gray-400 hover:text-blue-600 rounded" title="Rename"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-0.5 text-gray-400 hover:text-red-600 rounded" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tables, setTablesInternal] = useState<{ id: string, name: string, data: GridData }[]>([
    { id: 'table_1', name: 'Master Table', data: initialGridData }
  ]);
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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);

  const activeTableIndex = tables.findIndex(t => t.id === activeTableId);
  const data = tables[activeTableIndex]?.data || initialGridData;
  const activeTableName = tables[activeTableIndex]?.name || 'Master Table';

  const [sortConfig, setSortConfig] = useState<{ fieldId: string, direction: 'asc'|'desc' } | null>(null);
  const [filterConfig, setFilterConfig] = useState<Record<string, string>>({});

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
    setSortConfig(null);
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
  const [rowHeight, setRowHeight] = useState<'short'|'medium'|'tall'|'extra'>('medium');
  const [showRowHeightMenu, setShowRowHeightMenu] = useState(false);
  
  // Model settings
  const [modelSettings, setModelSettings] = useState({
    geminiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY || '',
    openaiKey: '',
    openaiEndpoint: 'https://api-inference.modelscope.cn/v1',
    openaiModel: 'deepseek-ai/DeepSeek-V3.2',
    activeModel: 'openai'
  });

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

  const handleAddField = () => {
    setData((prev: any) => ({
      ...prev,
      fields: [
        ...prev.fields,
        { id: `fld_${Date.now()}`, name: 'New Field', type: 'text', width: 150 }
      ]
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
    setData(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, name } : f)
    }));
  };

  const handleChangeFieldType = (fieldId: string, type: FieldType) => {
    setData(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, type } : f)
    }));
  };
  
  const handleReorderFields = (sourceId: string, targetId: string) => {
    setData(prev => {
      const sourceIndex = prev.fields.findIndex(f => f.id === sourceId);
      const targetIndex = prev.fields.findIndex(f => f.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return prev;
      
      const newFields = [...prev.fields];
      const [movedItem] = newFields.splice(sourceIndex, 1);
      newFields.splice(targetIndex, 0, movedItem);
      
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
        if (parsed.fields && parsed.records) {
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
          alert('Invalid format. Must contain fields and records.');
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
        if (f.type === 'attachment') {
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
      if (file.name.endsWith('.json')) {
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

  const displayData = { ...data, records: displayRecords };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <div className={`transition-all duration-300 ease-in-out flex flex-col shrink-0 flex-none overflow-hidden h-full z-10 bg-white border-r border-gray-200 shadow-[2px_0_10px_-3px_rgba(0,0,0,0.05)] ${sidebarCollapsed ? 'w-14 items-center' : 'w-60'}`}>
        <div className="h-14 w-full flex items-center px-4 border-b border-gray-200 shrink-0 select-none">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold shrink-0">B</div>
          {!sidebarCollapsed && <span className="ml-2 font-bold text-gray-800 tracking-tight whitespace-nowrap">AI Studio Table</span>}
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
                      onClick={() => { setActiveTableId(tbl.id); setSortConfig(null); setFilterConfig({}); }}
                      onRename={(name) => handleRenameTable(tbl.id, name)}
                      onDelete={() => handleDeleteTable(tbl.id)}
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
                    className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${tbl.id === activeTableId ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}
                  >
                    <GridIcon className="w-5 h-5" />
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
                 {activeTableName}
                 <ChevronDown className="w-4 h-4 ml-1 text-gray-400 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              {showTableMenu && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.1)] py-1 z-50">
                  {tables.map(tbl => (
                    <button 
                      key={tbl.id}
                      onClick={() => { setActiveTableId(tbl.id); setShowTableMenu(false); }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${tbl.id === activeTableId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
                    >
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
             <div className="relative group/load flex items-center space-x-1.5 px-3 py-1.5 rounded-md transition-colors font-medium border border-gray-200 cursor-pointer hover:bg-gray-50">
                <Upload className="w-4 h-4 text-gray-500" />
                <span>{lang === 'en' ? 'Load' : '导入'}</span>
                <ChevronDown className="w-4 h-4 ml-1 opacity-50" />
                <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 hidden group-hover/load:block">
                  <button onClick={handleImportJSON} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                     <FileJson className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Load JSON' : '导入 JSON'}
                  </button>
                  <button onClick={handleImportCSV} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                     <Upload className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Load CSV' : '导入 CSV'}
                  </button>
                </div>
             </div>

             <div className="relative group/share flex items-center space-x-1.5 px-3 py-1.5 rounded-md transition-colors font-medium border border-gray-200 cursor-pointer hover:bg-gray-50">
                <Share2 className="w-4 h-4 text-gray-500" />
                <span>{lang === 'en' ? 'Share' : '分享'}</span>
                <ChevronDown className="w-4 h-4 ml-1 opacity-50" />
                <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 hidden group-hover/share:block text-gray-800">
                  <button onClick={handleExportJSON} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                     <FileJson className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Export JSON' : '导出 JSON'}
                  </button>
                  <button onClick={handleExportCSV} className="w-full flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                     <Download className="w-4 h-4 mr-2" /> {lang === 'en' ? 'Export CSV' : '导出 CSV'}
                  </button>
                </div>
             </div>
          </div>
        </header>

        {/* Toolbar */}
        <div className="h-[46px] flex items-center justify-between px-4 border-b border-gray-200 shrink-0 bg-white">
          <div className="flex items-center space-x-1 text-sm text-gray-600">
             <ToolbarButton icon={<GridIcon className="w-4 h-4 text-blue-600"/>} label={lang === 'en' ? "Main Grid" : "默认视图"} active />
             <div className="w-px h-3.5 bg-gray-300 mx-1.5" />
             <ToolbarButton icon={<EyeOff className="w-4 h-4"/>} label={lang === 'en' ? "Hide fields" : "隐藏字段"} />
             <ToolbarButton icon={<Filter className="w-4 h-4"/>} label={lang === 'en' ? "Filter" : "筛选"} />
             <ToolbarButton icon={<LayoutTemplate className="w-4 h-4"/>} label={lang === 'en' ? "Group" : "分组"} />
             <ToolbarButton icon={<ArrowDownUp className="w-4 h-4"/>} label={lang === 'en' ? "Sort" : "排序"} />
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
            <button className="text-gray-400 hover:text-gray-600 p-1.5 rounded hover:bg-gray-100">
              <Search className="w-4 h-4" />
            </button>
            <button 
              onClick={handleAddRecord}
              className="flex items-center bg-blue-600 hover:bg-blue-700 text-white space-x-1 px-3 py-1.5 rounded-md transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === 'en' ? "Add Row" : "添加行"}</span>
            </button>
          </div>
        </div>

        {/* Grid Area */}
        <div className="flex-1 flex flex-col min-h-0 relative bg-white">
          <Grid 
            lang={lang}
            data={displayData}
            rowHeight={rowHeight}
            onUpdateRecord={handleUpdateRecord}
            onAddRecord={handleAddRecord}
            onAddField={handleAddField}
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
            sortConfig={sortConfig}
            filterConfig={filterConfig}
            modelSettings={modelSettings}
          />
        </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">AI Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-800"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="space-y-4">
               <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Active Model</label>
                  <select 
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    value={modelSettings.activeModel}
                    onChange={e => setModelSettings(prev => ({ ...prev, activeModel: e.target.value }))}
                  >
                     <option value="gemini">Gemini (Google AI Studio)</option>
                     <option value="openai">OpenAI Compatible</option>
                  </select>
               </div>
               
               {modelSettings.activeModel === 'gemini' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key</label>
                    <input 
                      type="password" 
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                      placeholder="AIzaSy..."
                      value={modelSettings.geminiKey}
                      onChange={e => setModelSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
                    />
                  </div>
               )}

               {modelSettings.activeModel === 'openai' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">API Endpoint</label>
                      <input 
                        type="url" 
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                        placeholder="https://api.openai.com/v1"
                        value={modelSettings.openaiEndpoint}
                        onChange={e => setModelSettings(prev => ({ ...prev, openaiEndpoint: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
                      <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                        placeholder="gpt-3.5-turbo"
                        value={modelSettings.openaiModel}
                        onChange={e => setModelSettings(prev => ({ ...prev, openaiModel: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                      <input 
                        type="password" 
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" 
                        placeholder="sk-..."
                        value={modelSettings.openaiKey}
                        onChange={e => setModelSettings(prev => ({ ...prev, openaiKey: e.target.value }))}
                      />
                    </div>
                  </>
               )}
            </div>

            <div className="mt-6 flex justify-end">
               <button onClick={() => setShowSettings(false)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700">Done</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function ToolbarButton({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button className={`flex items-center space-x-1.5 px-2 py-1 rounded hover:bg-gray-100 transition-colors ${active ? 'bg-gray-100' : ''}`}>
      {icon}
      <span>{label}</span>
      {active && <ChevronDown className="w-3.5 h-3.5 opacity-60 ml-0.5" />}
    </button>
  );
}
