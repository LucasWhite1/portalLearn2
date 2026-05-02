/**
 * Targeted check: verify that all named function references used as callbacks in bindEvents()
 * are actually defined somewhere in the file (or imported).
 */
const fs = require('fs');
const path = require('path');

const mainFile = path.join(__dirname, 'interactive-creator.js');
const content = fs.readFileSync(mainFile, 'utf8');
const lines = content.split('\n');

// ---- 1. Collect all defined names ----
const defined = new Set();

// const/let/var name = 
const varDef = /^(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/gm;
let m;
while ((m = varDef.exec(content)) !== null) defined.add(m[1]);

// function name(
const fnDef = /^(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/gm;
while ((m = fnDef.exec(content)) !== null) defined.add(m[1]);

// class name
const classDef = /^class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm;
while ((m = classDef.exec(content)) !== null) defined.add(m[1]);

// imports: import { a, b as c } from ...
const importBlock = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;
while ((m = importBlock.exec(content)) !== null) {
  m[1].split(',').forEach(part => {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (/^[a-zA-Z_$]/.test(name)) defined.add(name);
  });
}

// ---- 2. Find bindEvents() body ----
const bindStart = content.indexOf('bindEvents() {');
if (bindStart === -1) { console.error('bindEvents() not found'); process.exit(1); }

// Find end of bindEvents by counting braces
let depth = 0;
let bindEnd = -1;
for (let i = bindStart; i < content.length; i++) {
  if (content[i] === '{') depth++;
  else if (content[i] === '}') {
    depth--;
    if (depth === 0) { bindEnd = i; break; }
  }
}

const bindBody = content.slice(bindStart, bindEnd + 1);

// ---- 3. Extract all standalone function names used as callback arguments ----
// Pattern: addEventListener('event', functionName) where functionName is not an arrow/anon
const cbDirectRegex = /addEventListener\s*\([^,]+,\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[,)]/g;
const referenced = new Set();
while ((m = cbDirectRegex.exec(bindBody)) !== null) {
  referenced.add(m[1]);
}

// Also find names called directly inside arrow bodies: => doThis() or => { doThis(); }
const arrowBodyRegex = /=>\s*(?:\{([^}]*)\}|([^,;\n)]+))/g;
while ((m = arrowBodyRegex.exec(bindBody)) !== null) {
  const block = m[1] || m[2] || '';
  const calls = block.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]+)\s*\(/g) || [];
  calls.forEach(c => referenced.add(c.replace(/\s*\($/, '')));
}

// ---- 4. Report ----
console.log('=== bindEvents() function reference check ===\n');
const skipNames = new Set([
  'this', 'event', 'e', 'target', 'button', 'type', 'id', 'card', 'control',
  'window', 'document', 'String', 'Number', 'Boolean', 'Math', 'Array', 'Object',
  'Promise', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'JSON', 'Date',
  'Map', 'Set', 'Error', 'TypeError', 'FormData', 'File', 'Blob', 'URL',
  'console', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
  'catch', 'then', 'finally', 'click', 'value', 'closest', 'open', 'reject', 'resolve',
]);

let errors = 0;
for (const name of [...referenced].sort()) {
  if (skipNames.has(name)) continue;
  if (/^[A-Z]/.test(name)) continue; // class constructors
  if (!defined.has(name)) {
    console.error(`MISSING: ${name}()`);
    errors++;
  }
}

if (errors === 0) {
  console.log('All callback references in bindEvents() are defined!');
} else {
  console.log(`\n${errors} missing function(s) found.`);
}
