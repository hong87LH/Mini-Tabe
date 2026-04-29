import React, { useState, useRef, useEffect } from 'react';
import { Field, BaseRecord, GridData, SelectOption, FieldType, Attachment } from '../types';
import { FieldIcon } from './FieldIcon';
import { cn } from '../lib/utils';
import { Plus, GripVertical, ChevronDown, Check, Image as ImageIcon, X, Sparkles, ArrowDownUp, Trash2, Filter } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';

export const imagePreviewCache = new Map<string, string>();

interface GridProps {
  data: GridData;
  onUpdateRecord: (recordId: string, fieldId: string, value: any) => void;
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

export function Grid({ data, onUpdateRecord, onAddRecord, onAddField, onDeleteField, onRenameField, onChangeFieldType, onReorderFields, onReorderRecords, onResizeCol, onUpdateField, onSortField, onFilterField, sortConfig, filterConfig, rowHeight, modelSettings, lang = 'zh' }: GridProps) {
  const [activeCell, setActiveCell] = useState<{ recordId: string; fieldId: string } | null>(null);
  
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  const [previewImage, setPreviewImage] = useState<string | null>(null);

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
      if (!selectionBox) return;
      
      const rows = [];
      for (let r = selectionBox.minR; r <= selectionBox.maxR; r++) {
        const colVals = [];
        for (let c = selectionBox.minC; c <= selectionBox.maxC; c++) {
           const record = data.records[r];
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
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!selectionStart) return;
      
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      
      const rows = text.split(/\r?\n/).map(row => row.split('\t'));
      if (rows.length === 0) return;

      // Start pasting from selectionStart
      const startR = Math.min(selectionStart.r, selectionEnd?.r ?? selectionStart.r);
      const startC = Math.min(selectionStart.c, selectionEnd?.c ?? selectionStart.c);

      const updates: { recordId: string, fieldId: string, value: any }[] = [];

      for (let i = 0; i < rows.length; i++) {
         const rIdx = startR + i;
         if (rIdx >= data.records.length) break;
         
         const cols = rows[i];
         for (let j = 0; j < cols.length; j++) {
            const cIdx = startC + j;
            if (cIdx >= data.fields.length) break;
            
            const record = data.records[rIdx];
            const field = data.fields[cIdx];
            let val: any = cols[j];
            
            if (field.type === 'attachment') {
               // Keep path string as is
               val = val || '';
            } else if (field.type === 'number') {
               val = val ? Number(val) : null;
            } else if (field.type === 'checkbox') {
               val = val === 'true' || val === '1';
            } else if (field.type === 'multiSelect') {
               if (val) {
                  // Wait, earlier my export to CSV was joining with comma, maybe tab or comma depending on the text?
                  // For simplicity we just set the string and let the user fix it or if it matches existing opt.id it will just work perfectly.
                  val = val.split(',');
               } else {
                 val = [];
               }
            }
            onUpdateRecord(record.id, field.id, val);
         }
      }
    };

    const handleDeleteKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
         if (!selectionBox) return;
         if (selectionBox.minR === 0 && selectionBox.maxR === data.records.length - 1 && selectionBox.minC === selectionBox.maxC) {
             const fieldId = data.fields[selectionBox.minC].id;
             if (onDeleteField) {
                 onDeleteField(fieldId);
             }
         }
      }
    };

    window.addEventListener('copy', handleCopy);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleDeleteKey);
    return () => {
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handleDeleteKey);
    };
  }, [selectionBox, selectionStart, selectionEnd, data, activeCell, onDeleteField]);

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

  const handleGenerateColumn = async (field: Field) => {
    if (!field.prompt) {
      alert("Please configure a prompt for this Smart Text column first.");
      return;
    }
    
    try {
      for (const record of data.records) {
        setGeneratingCell({ recordId: record.id, fieldId: field.id });
        let resultText = '';
        const contextData: any = {};
        
        if (field.refFields && field.refFields.length > 0) {
          field.refFields.forEach(refId => {
            const refField = data.fields.find(f => f.id === refId);
            if (refField) {
              contextData[refField.name] = record[refId];
            }
          });
        }
        
        const promptString = `You are an AI assistant helping to evaluate a table row. Here is the data context for this row:\n\n${JSON.stringify(contextData, null, 2)}\n\nBased ONLY on the context provided, perform the following instruction and respond with the concise result. Do not include markdown formatting or conversational filler.\n\nInstruction: ${field.prompt}`;
        
        if (modelSettings.activeModel === 'gemini') {
          if (!modelSettings.geminiKey) throw new Error("Gemini API Key is required");
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${modelSettings.geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               contents: [{ parts: [{ text: promptString }] }]
            })
          });
          const resData = await res.json();
          if (resData.error) throw new Error(resData.error.message);
          resultText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          if (!modelSettings.openaiKey) throw new Error("OpenAI API Key is required");
          const res = await fetch(`${modelSettings.openaiEndpoint}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${modelSettings.openaiKey}`
            },
            body: JSON.stringify({
              model: modelSettings.openaiModel || 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: promptString }]
            })
          });
          const json = await res.json();
          if (json.error) throw new Error(json.error.message);
          resultText = json.choices[0].message.content;
        }
        
        onUpdateRecord(record.id, field.id, resultText);
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
              <div className="w-full justify-center flex items-center h-8 text-gray-400 border-b border-t border-transparent">
                {/* Row number corner */}
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
                className="sticky left-0 bg-white group-hover:bg-gray-50 border-r border-b border-gray-200 text-center text-gray-400 w-16 z-10 transition-colors p-0 select-none cursor-grab active:cursor-grabbing"
                draggable
                onDragStart={(e) => handleDragStartRow(e, record.id)}
                onDragEnd={() => { setDraggedRowId(null); setDragOverRowId(null); }}
              >
                <div className={cn("flex items-center justify-center border-t border-transparent", heightClass)}>
                  <span className="group-hover:hidden">{index + 1}</span>
                  <div className="hidden group-hover:flex items-center space-x-1">
                    <GripVertical className="w-3.5 h-3.5 text-gray-300" />
                  </div>
                </div>
              </td>
              {data.fields.map((field, colIdx) => {
                const isSelectedBox = selectionBox 
                    ? index >= selectionBox.minR && index <= selectionBox.maxR && colIdx >= selectionBox.minC && colIdx <= selectionBox.maxC 
                    : false;

                return (
                  <Cell
                    key={field.id}
                    record={record}
                    field={field}
                    isActive={activeCell?.recordId === record.id && activeCell?.fieldId === field.id}
                    isGeneratingCol={generatingCell?.recordId === record.id && generatingCell?.fieldId === field.id}
                    onActivate={() => setActiveCell({ recordId: record.id, fieldId: field.id })}
                    onChange={(val) => onUpdateRecord(record.id, field.id, val)}
                    onBlur={() => setActiveCell(null)}
                    onPreviewImage={setPreviewImage}
                    allFields={data.fields}
                    modelSettings={modelSettings}
                    heightClass={heightClass}
                    lang={lang}
                    onUpdateField={(updates) => onUpdateField(field.id, updates)}
                    isSelectedBox={isSelectedBox}
                    onMouseDown={() => {
                       setIsSelecting(true);
                       setSelectionStart({ r: index, c: colIdx });
                       setSelectionEnd({ r: index, c: colIdx });
                    }}
                    onMouseEnter={() => {
                       if (isSelecting) {
                          setSelectionEnd({ r: index, c: colIdx });
                       }
                    }}
                    onActivateNextRow={() => {
                       if (index < data.records.length - 1) {
                          setActiveCell({ recordId: data.records[index + 1].id, fieldId: field.id });
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

      {previewImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80" onClick={() => setPreviewImage(null)}>
           <img src={previewImage} className="max-w-[90%] max-h-[90%] object-contain" onClick={e => e.stopPropagation()} />
           <button className="absolute top-4 right-4 text-white hover:text-gray-300 pointer-events-auto" onClick={() => setPreviewImage(null)}>
             <X className="w-8 h-8" />
           </button>
        </div>
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
  { type: 'aiText', label: 'Smart Text', labelZh: '智能文本' },
];

function HeaderCell({ 
  field, onRename, onChangeType, onResize, onUpdateField, onGenerateColumn, onDeleteField, onSortField, onFilterField, sortDirection, filterValue, onSelectCol, allFields,
  isDragged, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, lang = 'zh'
}: HeaderCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  
  const [draftPrompt, setDraftPrompt] = useState(field.prompt || '');
  const [draftRefs, setDraftRefs] = useState<string[]>(field.refFields || []);

  useEffect(() => {
    if (showMenu) {
      setDraftPrompt(field.prompt || '');
      setDraftRefs(field.refFields || []);
    }
  }, [showMenu, field.prompt, field.refFields]);

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

           {field.type === 'aiText' && (
             <div className="border-t border-gray-100 pt-3">
               <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{lang === 'en' ? 'Smart Text Setup' : '智能文本设置'}</div>
               <div className="space-y-3">
                 <div>
                   <label className="block text-xs text-gray-600 mb-1">{lang === 'en' ? 'Prompt' : '提示词'}</label>
                   <textarea
                     id={`prompt-textarea-${field.id}`}
                     className="w-full text-sm border border-gray-300 rounded p-1.5 h-16 outline-none focus:border-blue-500"
                     placeholder={lang === 'en' ? "e.g. Translate to Spanish" : "例如：翻译为西班牙语"}
                     value={draftPrompt}
                     onChange={(e) => setDraftPrompt(e.target.value)}
                     onMouseDown={e => e.stopPropagation()}
                   />
                   <div className="mt-1 flex flex-wrap gap-1">
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
                           setTimeout(() => {
                              if (el) { el.focus(); el.setSelectionRange(cursorPosition + f.name.length + 2, cursorPosition + f.name.length + 2); }
                           }, 0);
                         }}
                         className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 hover:bg-blue-100"
                       >
                         +{f.name}
                       </button>
                     ))}
                   </div>
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
                         onUpdateField({ prompt: draftPrompt, refFields: draftRefs });
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
  isGeneratingCol?: boolean;
  onActivate: () => void;
  onChange: (value: any) => void;
  onBlur: () => void;
  onPreviewImage: (url: string) => void;
  allFields: Field[];
  modelSettings: any;
  heightClass: string;
  onUpdateField: (updates: Partial<Field>) => void;
  isSelectedBox: boolean;
  onMouseDown: () => void;
  onMouseEnter: () => void;
  onActivateNextRow: () => void;
  lang?: 'en' | 'zh';
}

function Cell({ record, field, isActive, isGeneratingCol, onActivate, onChange, onBlur, onPreviewImage, allFields, modelSettings, heightClass, onUpdateField, isSelectedBox, onMouseDown, onMouseEnter, onActivateNextRow, lang = 'zh' }: CellProps) {
  const value = record[field.id];
  
  const [isEditingMode, setIsEditingMode] = useState(false);

  const [localText, setLocalText] = useState('');
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

  const [isGenerating, setIsGenerating] = useState(false);

  const handleAIGenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!field.prompt) {
      alert("Please configure a prompt for this Smart Text column first.");
      return;
    }
    
    setIsGenerating(true);
    
    try {
      const contextData: any = {};
      if (field.refFields && field.refFields.length > 0) {
        field.refFields.forEach(refId => {
          const refField = allFields.find(f => f.id === refId);
          if (refField) {
            contextData[refField.name] = record[refId];
          }
        });
      }
      
      const promptString = `You are an AI assistant helping to evaluate a table row. Here is the data context for this row:\n\n${JSON.stringify(contextData, null, 2)}\n\nBased ONLY on the context provided, perform the following instruction and respond with the concise result. Do not include markdown formatting or conversational filler.\n\nInstruction: ${field.prompt}`;

      let resultText = '';

      if (modelSettings.activeModel === 'gemini') {
        if (!modelSettings.geminiKey) throw new Error("Gemini API Key is required");
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${modelSettings.geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
             contents: [{ parts: [{ text: promptString }] }]
          })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        if (!modelSettings.openaiKey) throw new Error("OpenAI API Key is required");
        const res = await fetch(`${modelSettings.openaiEndpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${modelSettings.openaiKey}`
          },
          body: JSON.stringify({
            model: modelSettings.openaiModel || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: promptString }]
          })
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
        resultText = json.choices[0].message.content;
      }
      
      onChange(resultText);
    } catch (err: any) {
      alert("AI Generation failed: " + err.message);
    } finally {
      setIsGenerating(false);
    }
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
              autoFocus
              className="flex-1 w-full h-full px-2 py-1.5 outline-none bg-blue-50/50 resize-none overflow-y-auto"
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
              style={{ minHeight: '60px', position: 'absolute', zIndex: 30, left: -1, right: -1, top: -1, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
            />
            <div className="absolute right-0 top-0 h-[32px] flex items-center pr-1 z-40">
               <button 
                 onMouseDown={handleAIGenerate} 
                 className={cn("p-1 rounded shadow-sm text-white", isGenerating ? "bg-gray-400" : "bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600")}
                 title="Generate with AI"
                 disabled={isGenerating}
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
            autoFocus
            className="w-full h-full px-2 py-1.5 outline-none bg-blue-50/50 resize-none overflow-y-auto absolute z-30 shadow-md border border-blue-200 rounded-sm"
            value={localText}
            onChange={(e) => setLocalText(e.target.value)}
            onBlur={() => {
              onChange(localText);
              setIsEditingMode(false);
            }}
            style={{ minHeight: '60px', left: -1, right: -1, top: -1 }}
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
            className="w-full h-full px-2 outline-none bg-blue-50/50 text-right absolute z-30 shadow-md border border-blue-200"
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
            className="w-full h-full px-2 outline-none bg-blue-50/50 absolute z-30 shadow-md border border-blue-200"
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
          <div className="flex h-full items-center justify-center bg-blue-50/50 cursor-pointer" onClick={() => { onChange(!value); setIsEditingMode(false); onBlur(); }}>
            <input type="checkbox" checked={!!value} readOnly className="w-4 h-4 cursor-pointer" />
          </div>
        );
      }
      if (field.type === 'attachment') {
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
                    let displayUrl = imagePreviewCache.get(path);
                    if (!displayUrl) {
                      displayUrl = path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path;
                    }
                    return (
                      <img 
                        key={i} 
                        src={displayUrl} 
                        alt={path.split('/').pop()?.split('\\').pop() || 'image'} 
                        className={`${imgSizeClass} object-cover rounded border border-gray-200 shrink-0 bg-gray-100`} 
                        title={path}
                        onClick={(e) => { e.stopPropagation(); onPreviewImage(displayUrl!); }}
                      />
                    );
                  })}
               </div>
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
            {!value && !isGenerating && isActive && (
               <button 
                 onClick={handleAIGenerate} 
                 className="absolute right-1 top-1.5 p-1 rounded bg-gray-100 hover:bg-gradient-to-r hover:from-purple-500 hover:to-indigo-500 hover:text-white text-gray-400 opacity-0 group-hover/ai:opacity-100 transition-all z-10"
                 title="Quick Generate"
               >
                 <Sparkles className="w-3.5 h-3.5" />
               </button>
            )}
            {isGenerating && <span className="absolute right-2 top-2 text-[10px] text-gray-400">Gen...</span>}
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
                 const pathStr = (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
                 const objectUrl = URL.createObjectURL(file);
                 imagePreviewCache.set(pathStr, objectUrl);
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
             onMouseDown();
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
        isActive && "ring-[1.5px] ring-blue-500 ring-inset z-20 outline-none"
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

function AttachmentCellEditor({ value, onChange, onClose, onPreview }: { value: any, onChange: (v: any) => void, onClose: () => void, onPreview: (url: string) => void }) {
  let filePaths: string[] = [];
  if (Array.isArray(value)) {
    filePaths = value.map((v: any) => typeof v === 'string' ? v : v.url || v.name || '');
  } else if (typeof value === 'string' && value.trim() !== '') {
    filePaths = value.split(',').map(s => s.trim());
  }

  const ref = useClickOutside(onClose);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draggedImgId, setDraggedImgId] = useState<string | null>(null);
  const [dragOverImgId, setDragOverImgId] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files as FileList);
      const pathMatches = files.map((file: any) => {
        const pathStr = (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
        const objectUrl = URL.createObjectURL(file);
        imagePreviewCache.set(pathStr, objectUrl);
        return pathStr;
      });
      onChange([...filePaths, ...pathMatches].join(','));
    }
  };

  const handleRemove = (path: string) => {
    onChange(filePaths.filter(p => p !== path).join(','));
  };

  const handleDrop = (e: React.DragEvent, targetPath?: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Prioritize internal drag and drop of attachment images 
    if (draggedImgId) {
      if (!targetPath || draggedImgId === targetPath) {
        setDraggedImgId(null);
        setDragOverImgId(null);
        return;
      }
      const sourceIndex = filePaths.findIndex(p => p === draggedImgId);
      const targetIndex = filePaths.findIndex(p => p === targetPath);
      if (sourceIndex === -1 || targetIndex === -1) {
        setDraggedImgId(null);
        setDragOverImgId(null);
        return;
      }

      const newArr = [...filePaths];
      const [moved] = newArr.splice(sourceIndex, 1);
      newArr.splice(targetIndex, 0, moved);
      onChange(newArr.join(','));
      
      setDraggedImgId(null);
      setDragOverImgId(null);
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter((f: any) => f.type.startsWith('image/'));
      if (files.length > 0) {
        const pathMatches = files.map((file: any) => {
          // Add support for window.electron.getPathForFile if exposed in preload
          const pathStr = (window as any).electron?.getPathForFile?.(file) || file.path || file.name;
          const objectUrl = URL.createObjectURL(file);
          imagePreviewCache.set(pathStr, objectUrl);
          return pathStr;
        });
        onChange([...filePaths, ...pathMatches].join(','));
        setDragOverImgId(null);
        return;
      }
    }
  };

  return (
    <div 
      ref={ref} 
      className="absolute top-0 left-0 min-w-[200px] bg-white rounded shadow-lg border border-gray-200 z-50 p-2 flex flex-col gap-2"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => handleDrop(e)}
    >
      <div className="flex flex-wrap gap-2">
        {filePaths.map((path, index) => {
           let displayUrl = imagePreviewCache.get(path);
           if (!displayUrl) {
             displayUrl = path.startsWith('/') || path.match(/^[a-zA-Z]:\\/) ? `file://${path}` : path;
           }
           
           return (
             <div 
               key={`${path}_${index}`} 
               className={cn(
                 "relative group cursor-grab active:cursor-grabbing w-16 h-16 border rounded bg-gray-50 flex items-center justify-center overflow-hidden",
                 draggedImgId === path ? "opacity-30" : "",
                 dragOverImgId === path ? "ring-2 ring-blue-500" : "border-gray-200"
               )}
               draggable
               onDragStart={(e) => {
                 setDraggedImgId(path);
                 e.dataTransfer.effectAllowed = 'move';
               }}
               onDragOver={(e) => {
                 e.preventDefault();
                 if (dragOverImgId !== path) setDragOverImgId(path);
               }}
               onDragLeave={() => {
                 if (dragOverImgId === path) setDragOverImgId(null);
               }}
               onDrop={(e) => handleDrop(e, path)}
               onDragEnd={() => { setDraggedImgId(null); setDragOverImgId(null); }}
               onClick={() => onPreview(displayUrl!)}
             >
               <img src={displayUrl} alt="attachment" className="w-full h-full object-cover cursor-pointer" />
               <div 
                 className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 cursor-pointer hover:bg-black"
                 onClick={(e) => { e.stopPropagation(); handleRemove(path); }}
               >
                 <X className="w-3 h-3" />
               </div>
             </div>
           );
        })}
        
        <div 
          className="w-16 h-16 border border-dashed border-gray-300 rounded flex items-center justify-center cursor-pointer hover:bg-gray-50 text-gray-400 hover:text-blue-500 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus className="w-6 h-6" />
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
