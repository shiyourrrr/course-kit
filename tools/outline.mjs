#!/usr/bin/env node
/**
 * 打印课件大纲：每页是什么页型、用了多少字、公式/图示/折叠答案有没有生效
 *
 *   node tools/outline.mjs examples/gougu.deck.html
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('用法：node tools/outline.mjs <课件.html>');
  process.exit(1);
}

const file = path.resolve(target);
if (!fs.existsSync(file)) {
  console.error(`文件不存在：${file}\n  先渲染：node src/render.mjs <deck.json>`);
  process.exit(1);
}
const html = fs.readFileSync(file, 'utf8');
const sections = html.match(/<section[^>]*class="slide[^"]*"[\s\S]*?<\/section>/g) || [];

const text = (s) =>
  s
    .replace(/<svg[\s\S]*?<\/svg>/g, ' [图] ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

console.log(`\n${path.basename(target)} · ${sections.length} 页\n`);
console.log('页码  页型          公式  图示  折叠  字数  内容预览');
console.log('─'.repeat(86));
sections.forEach((s, i) => {
  const layout = (s.match(/data-layout="([^"]+)"/) || [])[1] || '?';
  const katex = (s.match(/class="katex"/g) || []).length;
  const body = text(s);
  console.log(
    [
      String(i + 1).padStart(3),
      ' ',
      layout.padEnd(12),
      String(katex).padStart(4),
      String(/<svg|<img/i.test(s) ? 'Y' : '-').padStart(6),
      String(/<details/.test(s) ? 'Y' : '-').padStart(6),
      String(body.length).padStart(5),
      ' ',
      body.slice(0, 40),
    ].join(' ')
  );
});
console.log('─'.repeat(86));
const total = sections.reduce((sum, s) => sum + text(s).length, 0);
console.log(`正文合计 ${total} 字（${Math.round(total / sections.length)} 字/页）\n`);
