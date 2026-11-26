#!/usr/bin/env node
/**
 * 静态自检（不需要浏览器）：上线前先跑这个，能查掉 80% 的低级错
 *
 *   node tools/lint.mjs examples/gougu.deck.html
 *
 * 查：模板占位符是否残留、公式是否渲染、CSS 括号是否配平、每页是否有内容、结构是否完整
 * 查不了：真实溢出、字体缺失、视觉美观 —— 那些要 tools/check.mjs（需要浏览器）
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('用法：node tools/lint.mjs <课件.html>');
  process.exit(1);
}
const file = path.resolve(target);
if (!fs.existsSync(file)) {
  console.error(`文件不存在：${file}\n  先渲染：node src/render.mjs <deck.json>`);
  process.exit(1);
}
const html = fs.readFileSync(file, 'utf8');

const problems = [];
const notes = [];
const ok = (msg) => notes.push('  ✓ ' + msg);
const bad = (msg) => problems.push('  ✗ ' + msg);

/* 1. 占位符残留 */
const leftover = html.match(/\{\{[^}]*\}\}/g) || [];
leftover.length ? bad(`还有 ${leftover.length} 个模板占位符没被替换：${leftover.slice(0, 5).join(' ')}`) : ok('模板变量已全部替换');

/* 1.5 属性被 <br> 污染：KaTeX 的 svg path d 是多行字符串，换行替换写错顺序就会打进去 */
const dirtyAttr = html.match(/<\w+[^>]*\b(d|src|style|viewBox)="[^"]*<br\s*\/?>/i);
dirtyAttr ? bad('属性值里出现了 <br>（换行替换污染了标签，多半是 KaTeX 路径被打断）') : ok('标签属性未被换行替换污染');

/* 2. 结构 */
const sections = html.match(/<section[^>]*class="slide[^"]*"[\s\S]*?<\/section>/g) || [];
sections.length ? ok(`共 ${sections.length} 页`) : bad('一个 <section class="slide"> 都没有');

const layouts = sections.map((s) => (s.match(/data-layout="([^"]+)"/) || [])[1]);
layouts.forEach((l, i) => { if (!l) bad(`第 ${i + 1} 页缺 data-layout`); });

/* 2.5 自定义页：机器查不了版面，必须人看 */
const customPages = layouts.map((l, i) => (l === 'custom' ? i + 1 : null)).filter(Boolean);
if (customPages.length) {
  notes.push(`  ! 第 ${customPages.join('、')} 页是自定义页（AI 直接写的 HTML）——自检只能保证不越界、不引外链，版面请人眼确认`);
  notes.push('  · 同一种自定义版面第二次出现时，用 tools/promote.mjs 沉淀成页型，别让 AI 每次重新发挥');
}

/* 2.6 动效属性：写错值不会报错，只会静默失效，所以必须机器查 */
const ANIMS = new Set(['fade-up', 'fade-down', 'slide-left', 'slide-right', 'fade', 'scale', 'blur', 'zoom', 'rotate', 'flip', 'bounce']);
let animCount = 0;
let buildCount = 0;
const staticPages = [];

sections.forEach((section, i) => {
  const page = i + 1;
  const background = section.match(/<div class="slide-bg" aria-hidden="true"><img src="([^"]+)"/)?.[1];
  if (background && !background.startsWith('data:image/')) {
    const src = background.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    if (!fs.statSync(path.resolve(path.dirname(file), src), { throwIfNoEntry: false })?.isFile()) {
      bad(`第 ${page} 页找不到背景图片：${src}`);
    }
  }

  for (const m of section.matchAll(/data-anim="([^"]*)"/g)) {
    animCount += 1;
    if (!ANIMS.has(m[1])) bad(`第 ${page} 页的 data-anim="${m[1]}" 不合法（只允许：${[...ANIMS].join(' / ')}）`);
  }
  for (const m of section.matchAll(/data-build="([^"]*)"/g)) {
    buildCount += 1;
    if (!/^\d+$/.test(m[1]) || Number(m[1]) < 1) bad(`第 ${page} 页的 data-build="${m[1]}" 必须是从 1 开始的整数`);
  }
  for (const m of section.matchAll(/data-delay="([^"]*)"/g)) {
    if (!/^\d+$/.test(m[1])) bad(`第 ${page} 页的 data-delay="${m[1]}" 必须是 ≥0 的整数（毫秒）`);
  }
  // data-stagger 是布尔标记（故意不写值），只查需要值的三个
  for (const m of section.matchAll(/data-(anim|build|delay)(?![=\w-])/g)) {
    bad(`第 ${page} 页的 ${m[0]} 没有写值，动效会失效`);
  }
  // data-anim="" 也算失效
  for (const m of section.matchAll(/data-anim=""/g)) {
    bad(`第 ${page} 页有空的 data-anim=""`);
  }
  if (!/data-anim|data-build/.test(section)) staticPages.push(page);
});

notes.push(
  `  · 动效：${animCount} 处入场、${buildCount} 处点按揭示` +
    (staticPages.length
      ? `；无显式动效页：第 ${staticPages.join('、')} 页（运行时会给这几页一个默认入场）`
      : '；每页都有显式动效')
);


/* 3. 公式 */
const mathInline = html.split('$').length - 1;
const katexCount = (html.match(/class="katex"/g) || []).length;
katexCount > 0 ? ok(`公式渲染正常（${katexCount} 处 KaTeX）`) : notes.push('  · 没有公式（纯文字课件可以忽略）');
if (/\$[^$<\s][^$]{0,60}\$/.test(html)) bad('疑似有未渲染的 $...$ 公式（检查 deck.json 里的定界符是否成对）');

/* 4. CSS 配平 */
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const open = (style.match(/\{/g) || []).length;
const close = (style.match(/\}/g) || []).length;
open === close ? ok(`CSS 括号配平（${open} 组）`) : bad(`CSS 括号不配平：{ ${open} 个，} ${close} 个`);

/* 5. 每页内容量 */
const textOf = (s) => s
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<svg[\s\S]*?<\/svg>/g, '[图]')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

sections.forEach((s, i) => {
  const text = textOf(s);
  const hasSvg = /<svg[\s\S]*?<\/svg>/.test(s);
  if (text.length < 12 && !hasSvg) bad(`第 ${i + 1} 页（${layouts[i]}）几乎没内容`);
  if (text.length > 420) notes.push(`  · 第 ${i + 1} 页（${layouts[i]}）正文 ${text.length} 字，偏多，留意溢出`);
});

/* 6. 单文件自足性 */
const external = html.match(/<(?:link|script)[^>]+(?:href|src)="(?!data:)[^"]+"/g) || [];
external.length ? bad(`有 ${external.length} 处外部资源引用，破坏离线可用：${external[0].slice(0, 80)}`) : ok('无外部依赖，完全离线可用');

/* 7. figure 页必须有图（内联 svg 或 <img>） */
layouts.forEach((l, i) => {
  if (l === 'figure' && !/<svg|<img/i.test(sections[i])) bad(`第 ${i + 1} 页是 figure 但没给 svg 或 img`);
});

/* 8. 体积 */
const kb = Buffer.byteLength(html, 'utf8') / 1024;
kb > 900 ? notes.push(`  · 文件 ${kb.toFixed(0)} KB，偏大（字体内联的代价），发微信前可以再压`) : ok(`体积 ${kb.toFixed(0)} KB`);

/* ---------------- 输出 ---------------- */

console.log(`\n静态自检：${path.basename(file)}\n`);
for (const n of notes) console.log(n);
if (problems.length) {
  console.log('\n问题：');
  for (const p of problems) console.log(p);
  console.log(`\n${problems.length} 个问题待修。\n`);
  process.exit(1);
}
console.log('\n静态自检通过。版式仍需人眼确认：在浏览器打开 → 按 F 全屏 → 左右方向键翻一遍。\n');
