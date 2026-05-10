import * as fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/setHistory\(/g, 'setPastStates(');
code = code.replace(/setFuture\(/g, 'setFutureStates(');

fs.writeFileSync('src/App.tsx', code);
console.log('done');
