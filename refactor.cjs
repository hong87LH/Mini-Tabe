const fs = require('fs');
const content = fs.readFileSync('src/components/Grid.tsx', 'utf-8');
const lines = content.split('\n');

const executeContent = lines.slice(1741, 2020).join('\n');
const replacement = '            await executeAIGenerateCell(record, field);';

const executeFunctionStr = `
  const executeAIGenerateCell = async (record: any, field: Field) => {
${executeContent}
  };
`;

const newContent = [
  ...lines.slice(0, 1722),
  executeFunctionStr,
  ...lines.slice(1722, 1741),
  replacement,
  ...lines.slice(2020)
].join('\n');

fs.writeFileSync('src/components/Grid.tsx', newContent);
console.log("Refactored Grid.tsx");
