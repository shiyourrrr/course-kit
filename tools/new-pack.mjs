#!/usr/bin/env node
/**
 * 一键新建学科模板包（以现有 pack 为蓝本，改个名字就能用）
 *
 *   node tools/new-pack.mjs physics-junior "初中物理"
 *   node tools/new-pack.mjs math-senior "高中数学" --subject 数学 --grade 高中 --from math-junior
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'packs');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--') && !args.slice(args.indexOf(a) - 1, args.indexOf(a)).join().startsWith('--'));
const id = args[0];
const name = args[1];
const flag = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (!id || !name || id.startsWith('--')) {
  console.error(`
用法：node tools/new-pack.mjs <包id> "<中文名>" [--subject 学科] [--grade 学段] [--from math-junior]

例：node tools/new-pack.mjs physics-junior "初中物理" --subject 物理 --grade 初中
`);
  process.exit(1);
}

const from = flag('from', 'math-junior');
const src = path.join(PACKS, from);
const dest = path.join(PACKS, id);

if (!fs.existsSync(src)) {
  console.error(`蓝本包不存在：${src}`);
  process.exit(1);
}
if (fs.existsSync(dest)) {
  console.error(`目标已存在：${dest}（先删掉或换个 id）`);
  process.exit(1);
}

fs.cpSync(src, dest, { recursive: true });
fs.rmSync(path.join(dest, 'README.md'), { force: true });

const packPath = path.join(dest, 'pack.json');
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
pack.id = id;
pack.name = name;
pack.subject = flag('subject', pack.subject);
pack.grade = flag('grade', pack.grade);
pack.version = '0.0.1';
fs.writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n', 'utf8');

console.log(`
✓ 已创建 packs/${id}/（蓝本：${from}）

接下来三步：
  1. packs/${id}/theme.css          换主色、字体（只改变量）
  2. packs/${id}/layouts/*.html     改文案，按学科需要加页型
  3. packs/${id}/pack.json          登记页型，写清楚 when 和 slots

试渲染：
  node src/render.mjs examples/gougu.deck.json --out .tmp/${id}.html
  然后把 .tmp/${id}.html 里 deck.json 的 "pack" 改成 "${id}" 再跑一次
`);
