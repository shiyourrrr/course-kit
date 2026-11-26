#!/usr/bin/env node
/**
 * 题单生成器：Markdown 题目 → 学生版 / 教师版 HTML（A4 打印友好）
 *
 *   node tools/questions.mjs examples/questions.md
 *   node tools/questions.mjs examples/questions.md --mode student
 *   node tools/questions.mjs examples/questions.md --mode teacher --out dist
 *
 * 为什么用 Markdown 而不是 JSON：老师能读能改，AI 也能写，diff 也看得懂。
 * 格式见 examples/questions.md 顶部说明（本文件末尾也有一份）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderValue } from '../src/template.mjs';
import { katexCss } from '../src/assets.mjs';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 和渲染器同一条路径：先摘出公式，再转义正文，最后把公式渲染回来。
// 顺序反了会把 < > 转义进 KaTeX，页面上就会出现 a &lt;0 这种字面量。
const rich = (s) => renderValue(s);

/** 解析：标题 / 题目块（题干 + 选项 + 答案 + 解析） */
export function parseQuestionMarkdown(md, fallbackTitle = '题单') {
  const lines = md.replace(/^\uFEFF/, '').split(/\r?\n/);
  let title = '';
  const questions = [];
  let current = null;
  let buffer = [];
  let inAnswer = false;

  const flush = () => {
    if (!current) return;
    current.stem = buffer.join('\n').trim().replace(/\n{2,}/g, '\n\n');
    questions.push(current);
    current = null;
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      title = h1[1].trim();
      continue;
    }

    const head = line.match(/^###\s*(?:\d+[.、]\s*)?\[(单选|多选|判断|填空|解答)\]\s*(.*)$/);
    if (head) {
      flush();
      current = { type: head[1], options: [], answer: '', explain: '', stem: '' };
      buffer = head[2] ? [head[2]] : [];
      inAnswer = false;
      continue;
    }

    if (!current) continue;

    const opt = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
    if (opt) {
      current.options.push({ correct: opt[1].toLowerCase() === 'x', text: opt[2] });
      inAnswer = false;
      continue;
    }

    const ans = line.match(/^>\s*(答案|解析)\s*[：:]\s*(.*)$/);
    if (ans) {
      const [, key, value] = ans[1] === '答案' ? [null, '答案', ans[2]] : [null, '解析', ans[2]];
      if (key === '答案') current.answer = value;
      else current.explain = value;
      inAnswer = true;
      continue;
    }

    if (inAnswer && line.startsWith('>')) {
      // 答案解析的续行
      const cont = line.replace(/^>\s*/, '').trim();
      if (cont) current.explain = current.explain ? `${current.explain}\n${cont}` : cont;
      continue;
    }

    if (!line.trim()) {
      if (buffer.length) buffer.push('');
      continue;
    }
    buffer.push(line);
  }
  flush();
  return { title: title || fallbackTitle, questions };
}

const LETTERS = 'ABCDEFGH';

/** 选项：学生版只留空框，教师版勾出正确项 */
function renderOptions(q, teacher) {
  if (!q.options.length) return '';
  return `<ol class="opts">${q.options
    .map((o, i) => {
      const mark = teacher ? (o.correct ? '☑' : '☐') : '☐';
      const cls = teacher && o.correct ? ' class="correct"' : '';
      return `<li${cls}><span class="mark">${mark}</span><span class="letter">${LETTERS[i]}</span>${rich(o.text)}</li>`;
    })
    .join('')}</ol>`;
}

function renderAnswerArea(q) {
  if (q.type === '填空') return '';
  if (q.type === '解答') return '<div class="worklines" aria-hidden="true"></div>';
  if (q.type === '判断') return '';
  return '';
}

function renderQuestion(q, index, teacher) {
  const tag = `<span class="tag tag-${q.type}">${q.type}</span>`;
  const answer = teacher
    ? `<div class="answer"><div class="ans-row"><b>答案</b>${rich(q.answer || '（未填）')}</div>${
        q.explain ? `<div class="ans-row"><b>解析</b>${rich(q.explain)}</div>` : ''
      }</div>`
    : '';

  return `<section class="q">
  <div class="q-head"><span class="q-no">${index}</span>${tag}</div>
  <div class="q-stem">${rich(q.stem)}</div>
  ${renderOptions(q, teacher)}
  ${renderAnswerArea(q)}
  ${answer}
</section>`;
}

const SHEET_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: #e9e9e4; color: #242c29; font: 15px/1.65 "Microsoft YaHei", "PingFang SC", sans-serif; }
.sheet {
  width: min(210mm, 100%); min-height: 297mm;
  margin: 24px auto; padding: 16mm;
  background: white; box-shadow: 0 5px 24px #222b231a;
}
.doc-head { border-top: 4px double #294a41; margin-bottom: 4mm; }
.doc-title {
  display: flex; align-items: center; justify-content: space-between; gap: 1em;
  padding: 6mm 0 5mm; color: #243e35;
  font: bold 27px/1.4 "Songti SC", SimSun, Georgia, serif;
}
.stamp {
  flex: none; border: 1px solid currentColor; padding: 2px 8px;
  color: #486454; font: 600 12px/1.5 "Microsoft YaHei", sans-serif; letter-spacing: .1em;
}
.doc-meta {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 12px;
  padding: 2.5mm 0; border-block: 1px solid #9ba9a0; font-size: 13px;
}
.doc-meta span { white-space: nowrap; }
.doc-meta span:last-child { font-weight: bold; }
.q {
  position: relative; padding: 3.5mm 0 3.5mm 14mm;
  break-inside: avoid; page-break-inside: avoid;
}
.q + .q { border-top: 1px solid #e2e5df; }
.q-head { position: absolute; left: 0; width: 10mm; display: grid; justify-items: center; gap: 2px; }
.q-no { color: #294a41; font: bold 22px/1 Georgia, serif; }
.tag { color: #57645b; font-size: 11px; letter-spacing: .08em; }
.q-stem { min-height: 10mm; padding-top: 1px; }
.opts {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 5mm;
  margin: 0; padding: 0; list-style: none;
}
.opts li { position: relative; padding-left: 10mm; overflow-wrap: anywhere; }
.opts .mark, .opts .letter { position: absolute; top: 0; }
.opts .mark { left: 0; color: #68776f; }
.opts .letter { left: 5mm; font-weight: 700; }
.opts .correct .mark { font-weight: bold; color: #28493c; }
.worklines {
  height: 40mm;
  background: repeating-linear-gradient(to bottom, transparent 0 9.7mm, #c6cdc7 9.7mm 10mm);
  print-color-adjust: exact; -webkit-print-color-adjust: exact;
}
.answer {
  margin-top: 2.5mm; padding: 2mm 3mm;
  border-left: 2px solid #758e7d; background: #f1f4ef; font-size: 13px;
  print-color-adjust: exact; -webkit-print-color-adjust: exact;
}
.ans-row { padding-left: 3em; }
.ans-row b { display: inline-block; width: 3em; margin-left: -3em; color: #334f40; }
.ans-row + .ans-row { margin-top: 2px; }
.doc-foot {
  display: flex; justify-content: space-between; gap: 1em;
  border-top: 1px solid #88968b; margin-top: 4mm; padding-top: 2mm;
  color: #546158; font-size: 11px;
}
.katex { font-size: 1.04em; }
@page { size: A4; margin: 16mm; }
@media print {
  body { background: white; }
  .sheet { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
  .doc-head { break-after: avoid; }
}
`;

function build(meta, questions, teacher) {
  const body = questions.map((q, i) => renderQuestion(q, i + 1, teacher)).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.title)} · ${teacher ? '教师版' : '学生版'}</title>
<style>${katexCss()}\n${SHEET_CSS}</style>
</head>
<body>
<div class="sheet">
  <header class="doc-head">
    <div class="doc-title">${escapeHtml(meta.title)}${teacher ? '<span class="stamp">教师版</span>' : '<span class="stamp">学生版</span>'}</div>
    <div class="doc-meta">
      <span>姓名：____________</span>
      <span>班级：____________</span>
      <span>日期：____________</span>
      <span>共 ${questions.length} 题</span>
    </div>
  </header>
  ${body}
  <footer class="doc-foot"><span>${escapeHtml(meta.title)}</span><span>${teacher ? '教师版（含答案与解析）' : '学生版'}</span></footer>
</div>
</body>
</html>
`;
}

export function renderQuestions(markdown, { mode = 'student' } = {}) {
  if (mode !== 'student' && mode !== 'teacher') throw Error('请选择学生版或教师版');
  const parsed = parseQuestionMarkdown(markdown);
  if (!parsed.questions.length) throw Error('没有可生成的题目');
  return build(parsed, parsed.questions, mode === 'teacher');
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  const flag = (key, fallback) => {
    const i = args.indexOf(`--${key}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
  };

  if (!input) {
    console.error(`
用法：node tools/questions.mjs <题目.md> [--mode both|student|teacher] [--out <目录>]

题目格式：

  # 课题名

  ### 1. [单选] 题干（可用 $a^2+b^2=c^2$ 写公式）
  - [ ] 选项
  - [x] 正确选项
  > 答案：B
  > 解析：……

  支持的题型：[单选] [多选] [判断] [填空] [解答]
`);
    process.exit(1);
  }

  const src = path.resolve(input);
  const text = fs.readFileSync(src, 'utf8');
  const outDir = path.resolve(flag('out', path.dirname(src)));
  const mode = flag('mode', 'both');

  const base = path.basename(src, path.extname(src));
  const parsed = parseQuestionMarkdown(text, base);
  if (!parsed.questions.length) {
    console.error('没解析出题目。检查是否用了 `### 1. [单选] 题干` 的写法。');
    process.exit(1);
  }

  const targets = mode === 'both' ? ['student', 'teacher'] : [mode];
  fs.mkdirSync(outDir, { recursive: true });

  for (const kind of targets) {
    const html = build(parsed, parsed.questions, kind === 'teacher');
    // 双重转义会让页面上出现 "a &lt;0" 这种字面量（说明先转义后拆公式了）
    if (html.includes('&amp;lt;') || html.includes('&amp;gt;')) {
      console.warn(`⚠ ${kind} 版里发现双重转义（页面会显示成 &lt; / &gt; 字面量），检查转义与公式顺序`);
    }
    const file = path.join(outDir, `${base}-${kind}.html`);
    fs.writeFileSync(file, html, 'utf8');
    console.log(`✓ ${path.relative(process.cwd(), file)}  ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(0)} KB  ${parsed.questions.length} 题`);
  }

  const blanks = parsed.questions.filter((q) => !q.answer).length;
  if (blanks) console.warn(`\n注意：${blanks} 题没有「答案」，教师版会显示"（未填）"。`);
  console.log('\n打印：浏览器打开 → Ctrl+P → 目标另存为 PDF（A4，边距默认即可）。\n');
}
