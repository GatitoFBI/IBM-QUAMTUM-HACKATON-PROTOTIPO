import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const files = [
  'index.html',
  'datos.js',
  'css/base.css',
  'css/styles.css',
  'css/tokens.css',
  'js/app.js',
  'js/grover.js',
  'img/logo.svg',
  'slides/index.html',
  'slides/estatica.html',
  'LICENSE.hallmark.txt',
];

// Strip comments without treating quoted CSS strings as comments.
function stripCssComments(source) {
  let result = '', quote = null;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (quote) {
      result += character;
      if (character === '\\') result += source[++i] ?? '';
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      result += character;
    } else if (character === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated CSS comment');
      result += ' ';
      i = end + 1;
    } else result += character;
  }
  return result;
}

// Read every input before replacing the generated output directory.
const assets = await Promise.all(files.map(async file => {
  const bytes = await readFile(resolve(root, file));
  const content = file.endsWith('.css') ? stripCssComments(bytes.toString('utf8'))
    : file === 'index.html' ? bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g, '')
    : bytes;
  return {file, content};
}));
await rm(output, {recursive: true, force: true});
for (const {file, content} of assets) {
  const target = resolve(output, file);
  await mkdir(dirname(target), {recursive: true});
  await writeFile(target, content);
}
console.log(`Built ${assets.length} runtime assets in dist`);
