const fs = require('fs');
const file = 'c:/Users/jlnn3/SISTEMA CURSO - backup 3.0/frontend/interactive-creator.js';
let content = fs.readFileSync(file);
let str = content.toString('utf8');
let buffer = Buffer.from(str, 'latin1');
let fixedStr = buffer.toString('utf8');
fixedStr = fixedStr.replace(/'espao'/g, "'espaço'");
fs.writeFileSync(file, fixedStr);
