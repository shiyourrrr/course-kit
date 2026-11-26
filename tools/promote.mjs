#!/usr/bin/env node
/**
 * 把「AI 现场写的一页」沉淀成模板包里正式的页型。
 *
 *   node tools/promote.mjs examples/gougu.deck.json 6 proof-area --name "面积法证明"
 *
 * 做的事：
 *   1. 把该页的 html（+ css）写成 packs/<pack>/layouts/<新id>.html
 *   2. 在 pack.json 里登记这个页型
 *   3. 把 deck 里这一页从「自定义页」改成「用新页型」
 *
 * 为什么要这一步：AI 每次现场发挥的页面，下一次课就没了。用过两次的版面应该变成模板。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const [deckArg, pageArg, newId] = positional;

if (!deckArg || !pageArg || !newId) {
  console.error(`
用法：node tools/promote.mjs <deck.json> <页码> <新页型id> [--name "中文名"] [--packs <目录>]

例：node tools/promote.mjs examples/gougu.deck.json 6 proof-area --name "面积法证明"
`);
  process.exit(1);
}

const deckPath = path.resolve(deckArg);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const deck = readJson(deckPath);
const no = Number(pageArg);
const page = deck.pages[no - 1];

if (!page) {
  console.error(`没有第 ${no} 页（这份课件共 ${deck.pages.length} 页）`);
  process.exit(1);
}
if (!page.html && !page.htmlFile) {
  console.error(`第 ${no} 页不是自定义页（用的是页型「${page.layout}」），没有可沉淀的 HTML。`);
  console.error('  只有 layout:"custom" / 带 html 或 htmlFile 的页才能 promote。');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(newId)) {
  console.error(`页型 id 只能用小写字母、数字、连字符：${newId}`);
  process.exit(1);
}

const deckDir = path.dirname(deckPath);
const packId = deck.pack || 'math-junior';
const packsDir = path.resolve(flag('packs', path.join(ROOT, 'packs')));
const packDir = path.join(packsDir, packId);
const packPath = path.join(packDir, 'pack.json');
const pack = readJson(packPath);

if (pack.layouts.some((l) => l.id === newId)) {
  console.error(`页型「${newId}」已存在，换个 id（或直接改那个 layout 文件）`);
  process.exit(1);
}

const html = page.htmlFile ? fs.readFileSync(path.resolve(deckDir, page.htmlFile), 'utf8') : page.html;
const css = page.cssFile
  ? fs.readFileSync(path.resolve(deckDir, page.cssFile), 'utf8')
  : page.css || '';

const fragment = (css ? `<style>\n${css.trim()}\n</style>\n` : '') + html.trim() + '\n';
const layoutFile = path.join(packDir, 'layouts', `${newId}.html`);
fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
fs.writeFileSync(layoutFile, fragment, 'utf8');

pack.layouts.push({
  id: newId,
  name: flag('name', page.title || newId),
  when: '由 promote 从一次具体课件沉淀；按需把写死的文案换成 {{字段}}',
  slots: [],
});
fs.writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n', 'utf8');

delete page.html;
delete page.htmlFile;
delete page.css;
delete page.cssFile;
page.layout = newId;
fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2) + '\n', 'utf8');

console.log(`
✓ 已沉淀为页型「${newId}」

  packs/${packId}/layouts/${newId}.html    ← 版式（含页内样式）
  packs/${packId}/pack.json                ← 已登记
  ${path.relative(process.cwd(), deckPath)} 第 ${no} 页 → layout:"${newId}"

下一步：
  1. node src/render.mjs ${path.relative(process.cwd(), deckPath)}
  2. 打开 layouts/${newId}.html，把还想变的文案换成 {{字段}}，再在 deck 里给值
  3. 这个页型从此对所有课件可用
`);
