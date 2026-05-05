const fs = require('fs');
const content = fs.readFileSync('src/components/Grid.tsx', 'utf-8');
const lines = content.split('\n');

const workflowLogic = `
  const [runningWorkflowRows, setRunningWorkflowRows] = useState<Set<string>>(new Set());

  const handleRunWorkflow = async (targetRecordIds: string[]) => {
      const recordsToProcess = data.records.filter(r => targetRecordIds.includes(r.id));
      if (recordsToProcess.length === 0) return;
      
      const aiFields = data.fields.filter(f => f.type === 'aiText' || f.type === 'aiImage');
      if (aiFields.length === 0) {
          alert(lang === 'en' ? "No Smart Text / AI Image columns found in the table." : "表格中没有智能文本/智能图片列。");
          return;
      }
      
      for (const record of recordsToProcess) {
          setRunningWorkflowRows(prev => new Set(prev).add(record.id));
          
          let rowFailed = false;
          for (const field of aiFields) {
              if (rowFailed) break; 
              
              if (!field.prompt) continue; 
              
              let val = record[field.id];
              let shouldGenerate = false;
              if (field.type === 'aiImage') {
                 shouldGenerate = (!val || (Array.isArray(val) && val.length === 0));
              } else {
                 shouldGenerate = (val === undefined || val === null || val === '');
              }
              
              if (!shouldGenerate) continue;

              let attempts = 0;
              let success = false;
              
              while (attempts < 2 && !success) {
                  attempts++;
                  try {
                      setGeneratingCells(prev => new Set(prev).add(\`\${record.id}-\${field.id}\`));
                      await executeAIGenerateCell(record, field);
                      success = true;
                  } catch (err: any) {
                      console.error(\`Workflow generation failed for record \${record.id}, field \${field.id}, attempt \${attempts}\`, err);
                      if (attempts === 2) {
                          rowFailed = true;
                      } else {
                          // Wait a bit before retry
                          await new Promise(r => setTimeout(r, 1000));
                      }
                  } finally {
                      setGeneratingCells(prev => {
                          const next = new Set(prev);
                          next.delete(\`\${record.id}-\${field.id}\`);
                          return next;
                      });
                  }
              }
          }
          
          setRunningWorkflowRows(prev => {
              const next = new Set(prev);
              next.delete(record.id);
              return next;
          });
      }
  };
`;

lines.splice(2060, 0, workflowLogic);
fs.writeFileSync('src/components/Grid.tsx', lines.join('\n'));
console.log("Added handleRunWorkflow");
