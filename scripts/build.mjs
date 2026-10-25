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
  'slides/deck.js',
  'slides/estatica.html',
  'pitch/pitch.css',
  'pitch/cover.png',
  'pitch/video.mp4',
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
// /slides is the single source of the six animated slides and their styling.
const slides = assets.find(asset => asset.file === 'slides/index.html').content.toString('utf8');
const intro = await readFile(resolve(root, 'pitch/intro.html'), 'utf8');
const stage = '<div id="stage"><div id="deck">';
if (!slides.includes(stage) || (slides.match(/<section class="slide\b/g) || []).length !== 6) {
  throw new Error('Expected the six-slide deck and its stage when building /pitch');
}
const pitch = slides
  .replace('</head>', '<link rel="stylesheet" href="/pitch/pitch.css">\n</head>')
  .replace('<body>', '<body data-presentation="pitch">')
  .replace(stage, `<div id="stage">${intro}<div id="deck">`);
assets.push({file: 'pitch/index.html', content: pitch});
await rm(output, {recursive: true, force: true});
for (const {file, content} of assets) {
  const target = resolve(output, file);
  await mkdir(dirname(target), {recursive: true});
  await writeFile(target, content);
}
console.log(`Built ${assets.length} runtime assets in dist`);
