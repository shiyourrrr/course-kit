#!/usr/bin/env node
/**
 * 应急改课件：一句话改内容/排版，立刻重渲染。
 *
 *   node tools/quick.mjs examples/gougu.deck.json "第 3 页标题改成 三条边的关系"
 *   node tools/quick.mjs examples/gougu.deck.json "删掉第 8 页"
 *   node tools/quick.mjs examples/gougu.deck.json "第 4 页的例题改成 已知 a=6, b=8 求 c"
 *
 * 两条通道：
 *   1) 离线规则：最常见的几种改法（改字段/删页/挪页/换主题色），不需要联网，教室没网也能用
 *   2) 在线模型：设了 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 就走模型，能改得更自由（返回结构化 ops）
 *
 * 想把它变成"课上一句话就改"的按钮：把这条命令包成 .bat 或桌面快捷方式即可。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const deckPath = args[0];
const instruction = args.slice(1).join(' ').trim();

if (!deckPath || !instruction) {
  console.error(`
用法：node tools/quick.mjs <deck.json> "你的要求"

离线支持：
  第 N 页标题改成 X          第 N 页的<字段>改成 X   （title/subtitle/lead/stem/answer/explain/note/hint…）
  删掉第 N 页                把第 N 页和第 M 页换位置
  主题色改成 #RRGGBB

联网（可选）：设 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 后可以用更自由的说法
`);
  process.exit(1);
}

const abs = path.resolve(deckPath);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const deck = readJson(abs);
const pageCount = deck.pages.length;

/* ---------------- 1. 离线规则 ---------------- */

const FIELD_ALIASES = {
  标题: 'title',
  副标题: 'subtitle',
  导语: 'lead',
  题干: 'stem',
  题目: 'stem',
  答案: 'answer',
  解析: 'explain',
  说明: 'explain',
  备注: 'note',
  提示: 'hint',
  结论: 'verdict',
  收束: 'closing',
  页脚: 'footnote',
};

function parseOffline(text) {
  const t = text.trim().replace(/^把|^请|^帮我/g, '').trim();

  let m = t.match(/^第\s*(\d+)\s*页\s*(?:的)?\s*(.{0,6}?)\s*(?:改成|改为|换成)\s*([\s\S]+)$/);
  if (m) {
    const page = Number(m[1]);
    const label = (m[2] || '').trim();
    const value = m[3].trim();
    const field = label ? FIELD_ALIASES[label] || (/^[a-z][a-z0-9_]*$/i.test(label) ? label : null) : 'title';
    if (field) return [{ op: 'set', page, path: field, value }];
  }

  m = t.match(/^(?:删掉|删除|去掉)\s*第\s*(\d+)\s*页$/);
  if (m) return [{ op: 'delete', page: Number(m[1]) }];

  m = t.match(/^(?:把)?第\s*(\d+)\s*页(?:和|与)第\s*(\d+)\s*页(?:换位置|交换|调换)$/);
  if (m) return [{ op: 'swap', a: Number(m[1]), b: Number(m[2]) }];

  m = t.match(/^主题色(?:改成|改为|换成)\s*(#[0-9a-fA-F]{6})$/);
  if (m) return [{ op: 'theme', accent: m[1] }];

  return null;
}

/* ---------------- 2. 在线模型 ---------------- */

function provider() {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      name: 'deepseek',
      url: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1/chat/completions',
      key: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
      key: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  return null;
}

const SYSTEM = `你是课件修改助手。用户提出修改要求，你只输出 JSON：
{"ops":[ ... ]}
允许的 op：
{"op":"set","page":3,"path":"title","value":"新标题"}        改一页的某个字段
{"op":"set","page":3,"path":"items[1].text","value":"..."}    改数组元素
{"op":"delete","page":3}                                      删页
{"op":"swap","a":3,"b":5}                                     交换两页
{"op":"html","page":3,"html":"<div class=\\"body\\">…</div>"}   整页重写（现成字段表达不了时）
{"op":"theme","accent":"#0f766e"}                             换主色

硬性要求：
- 只改用户要求的部分，不要顺手重写别的页
- 整页重写时只能用这些类名：body/kicker/title/lead/rule/footnote/grid/grid-auto/card/card-term/card-text/aims/aim/formula-box/cond/explain/example-head/tag/stem/steps/answer/figure/figure-img/cmp/cmp-col/verdict/points/tasks/tips/stack/row/cols/c3..c12/panel/panel-soft/callout/stat/muted/accent/small/center
- 动效只能加属性：data-anim="fade-up|fade-down|slide-left|slide-right|fade|scale|blur"、data-delay="120"、data-build="1"、data-stagger
- 不许 <script>、不许外链、不许行内事件
- 中文，简洁`;

async function askModel(text) {
  const p = provider();
  if (!p) return null;
  const body = {
    model: p.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `课件共 ${pageCount} 页。当前 deck：\n${JSON.stringify(deck)}\n\n修改要求：${text}` },
    ],
  };
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`模型调用失败：${res.status} ${await res.text()}`);
    return null;
  }
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('模型没有返回 JSON，原文：\n' + raw.slice(0, 400));
    return null;
  }
  return JSON.parse(match[0]).ops || null;
}

/* ---------------- 3. 应用 ---------------- */

const log = [];
const invalid = (msg) => { console.error('✗ ' + msg); process.exit(1); };

function apply(ops) {
  for (const op of ops) {
    if (op.op === 'set') {
      if (op.page < 1 || op.page > pageCount) invalid(`没有第 ${op.page} 页`);
      const page = deck.pages[op.page - 1];
      const parts = String(op.path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
      let target = page;
      for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target === undefined) invalid(`找不到字段 ${op.path}`);
      }
      target[parts[parts.length - 1]] = op.value;
      log.push(`第 ${op.page} 页 ${op.path} ← ${String(op.value).slice(0, 24)}`);
    } else if (op.op === 'delete') {
      if (op.page < 1 || op.page > pageCount) invalid(`没有第 ${op.page} 页`);
      deck.pages.splice(op.page - 1, 1);
      log.push(`删除第 ${op.page} 页`);
    } else if (op.op === 'swap') {
      if ([op.a, op.b].some((n) => n < 1 || n > pageCount)) invalid('页码超出范围');
      const tmp = deck.pages[op.a - 1];
      deck.pages[op.a - 1] = deck.pages[op.b - 1];
      deck.pages[op.b - 1] = tmp;
      log.push(`第 ${op.a} 页 ↔ 第 ${op.b} 页`);
    } else if (op.op === 'html') {
      if (op.page < 1 || op.page > pageCount) invalid(`没有第 ${op.page} 页`);
      if (/<script/i.test(op.html || '')) invalid('重写里不许有 <script>');
      deck.pages[op.page - 1] = { layout: 'custom', html: op.html };
      log.push(`第 ${op.page} 页整页重写`);
    } else if (op.op === 'theme') {
      if (!/^#[0-9a-fA-F]{6}$/.test(op.accent)) invalid('主题色必须是 #RRGGBB');
      const packDir = path.join(ROOT, 'packs', deck.pack || 'math-junior');
      const themeFile = path.join(packDir, 'theme.css');
      let theme = fs.existsSync(themeFile) ? fs.readFileSync(themeFile, 'utf8') : ':root {\n}\n';
      theme = /--accent:/.test(theme)
        ? theme.replace(/--accent:\s*[^;]+;/, `--accent: ${op.accent};`)
        : theme.replace(':root {', `:root {\n  --accent: ${op.accent};`);
      fs.writeFileSync(themeFile, theme, 'utf8');
      log.push(`主题色 → ${op.accent}`);
    } else {
      invalid(`不认识的 op：${op.op}`);
    }
  }
}

/* ---------------- 4. 执行 + 重渲染 ---------------- */

const offline = parseOffline(instruction);
let ops = offline;

if (!ops) {
  ops = await askModel(instruction);
  if (!ops) {
    console.error(`
✗ 这句话离线规则没看懂，也没有可用的模型。

能离线认出的说法：
  第 3 页标题改成 …        第 4 页的题干改成 …
  删掉第 8 页              把第 2 页和第 6 页换位置
  主题色改成 #0f766e

要用更自由的说法：设 DEEPSEEK_API_KEY（或 OPENAI_API_KEY）后重试。
`);
    process.exit(1);
  }
}

apply(ops);
fs.writeFileSync(abs, JSON.stringify(deck, null, 2) + '\n', 'utf8');

console.log('\n已应用：');
for (const line of log) console.log('  · ' + line);

const render = spawnSync(process.execPath, [path.join(ROOT, 'src', 'render.mjs'), abs], { stdio: 'inherit' });
if (render.status !== 0) process.exit(1);

const out = path.join(path.dirname(abs), path.basename(abs, '.json') + '.html');
spawnSync(process.execPath, [path.join(ROOT, 'tools', 'lint.mjs'), out], { stdio: 'inherit' });
console.log(`\n刷新这一个文件即可：${path.relative(process.cwd(), out)}`);
console.log('（浏览器里按 F5 就能看到改动，不用重新开会话）\n');
