#!/usr/bin/env node
/**
 * 导入第三方 HTML 模板 → 生成一个 course-kit 模板包
 *
 *   node tools/import-template.mjs 某个开源模板.html --name "极简黑白"
 *   node tools/import-template.mjs deck.html --id my-style --name "杂志风"
 *
 * 能做的：
 *   - 去掉 <script>、行内事件、外链资源（离线+安全）
 *   - 抽出 <style> 放进 theme.css
 *   - 按 <section> / <hr> 切页，每页生成一个 layout
 *   - 自动把第一个标题换成 {{title}}，前三个段落换成 {{text}} / {{text2}} / {{text3}}
 *
 * 做不到的（会给出提示）：
 *   - reveal.js 的垂直分页（会拍平）
 *   - 依赖外部 CSS/JS 插件的模板（请先另存为单文件）
 *   - 复杂组件的字段化（导入后只能改文字，版式固定）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripDangerous, stripExternalCss } from '../src/sanitize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const flag = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

if (!input) {
  console.error(`
用法：node tools/import-template.mjs <模板.html> [--id slug] [--name 显示名] [--source URL]

例：node tools/import-template.mjs ~/Downloads/deck.html --name "极简黑白"
`);
  process.exit(1);
}

const file = path.resolve(input);
if (!fs.existsSync(file)) {
  console.error(`文件不存在：${file}`);
  process.exit(1);
}

/* ---------------- 清洗 ---------------- */

function sanitize(html) {
  const warnings = [];
  let out = html;
  const scripts = (out.match(/<script\b[\s\S]*?<\/script>/gi) || []).length;
  if (scripts) warnings.push(`去掉了 ${scripts} 段 <script>（导入后不执行任何脚本）`);
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const links = (out.match(/<link\b[^>]*>/gi) || []).length;
  if (links) warnings.push(`去掉了 ${links} 个 <link>（外部样式表请先合并进页面）`);
  out = out.replace(/<link\b[^>]*>/gi, '');
  out = out.replace(/<(iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '');
  const remote = (out.match(/(src|href)\s*=\s*"https?:\/\/[^"]*"/gi) || []).length;
  if (remote) warnings.push(`去掉了 ${remote} 个外链资源（图片需先下载到本地或转成 data:）`);
  out = out.replace(/\s(src|href)\s*=\s*"https?:\/\/[^"]*"/gi, '');
  // 再走一遍统一清理：javascript: 链接、<form>、<meta refresh> 等
  const deep = stripDangerous(out);
  if (deep.changed) {
    warnings.push('去掉了：' + deep.notes.join('、'));
    out = deep.html;
  }
  return { html: out, warnings };
}

function extractStyles(html) {
  const blocks = [];
  const stripped = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    blocks.push(css.trim());
    return '';
  });
  return { html: stripped, css: blocks.join('\n\n') };
}

/**
 * 模板里的选择器要跟着搬家：
 *   section → .tpl-page（导入后每页是一个 div，不再是 section）
 *   html / body → .slide（模板给整页设的背景、字体，要落到我们的舞台上）
 */
function rewriteCss(css) {
  return css
    .replace(/(^|[\s,>+~(])section\b(?=[\s,{:.#[\w-])/g, '$1.tpl-page')
    .replace(/(^|[\s,>+~(])(html|body)\b(?=[\s,{:.#[\w-])/g, '$1.slide');
}

function toPageElement(html) {
  const s = html.trim();
  const open = s.match(/^<section\b([^>]*)>/i);
  if (!open) return `<div class="tpl-page">\n${s}\n</div>`;
  return s.replace(/^<section\b[^>]*>/i, `<div class="tpl-page"${open[1]}>`).replace(/<\/section>\s*$/i, '</div>');
}

/* ---------------- 切页 ---------------- */

function splitPages(html, warnings) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const sections = [...body.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)].map((m) => m[0].trim());
  if (sections.length) return sections;

  if (/<hr\s*\/?>/i.test(body)) {
    const pages = body.split(/<hr\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
    if (pages.length > 1) return pages.map((s) => `<div class="tpl-page">${s}</div>`);
  }

  // 退化成整页
  warnings.push('没找到分页标记（<section> 或 <hr>），整份模板当成一页导入');
  return [`<div class="tpl-page">${body.trim()}</div>`];
}

/* ---------------- 槽位推断 ---------------- */

function inferSlots(page, index) {
  const notes = [];
  let html = page;
  let used = 0;

  const heading = html.match(/<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (heading) {
    html = html.replace(heading[0], `<${heading[1]}>${heading[1] === 'h1' ? '{{title}}' : '{{title}}'}</${heading[1]}>`);
    used += 1;
  } else {
    notes.push('第 ' + (index + 1) + ' 页没识别到标题，已插入一个 {{title}} 占位');
    html = `<h1>{{title}}</h1>\n${html}`;
  }

  const paras = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const names = ['text', 'text2', 'text3'];
  let n = 0;
  for (const m of paras) {
    if (n >= names.length) break;
    if (m[1].includes('{{')) continue;
    html = html.replace(m[0], `<p>{{${names[n]}}}</p>`);
    n += 1;
    used += 1;
  }
  if (!n) notes.push('第 ' + (index + 1) + ' 页没识别到正文段落，只有标题可改');

  return { html, slots: ['title', ...names.slice(0, n)], notes, used };
}

/* ---------------- 执行 ---------------- */

const raw = fs.readFileSync(file, 'utf8');
const { html: noStyles, css } = extractStyles(raw);
const { html: clean, warnings } = sanitize(noStyles);
if (!css.trim()) warnings.push('模板里没有 <style>，导入后样式会是空的（外部样式表请先合并进页面）');

const pages = splitPages(clean, warnings).map(toPageElement);
const name = flag('name', path.basename(file, path.extname(file)));
// 允许中文目录名：只挡掉文件系统不安全的字符
const rawSlug = flag('id', '') || 'imported-' + name;
const slug = rawSlug
  .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '') || 'imported-style';

const packDir = path.join(ROOT, 'packs', slug);
const layoutsDir = path.join(packDir, 'layouts');

const layouts = [];
const fragments = [];
const notes = [];
pages.forEach((page, i) => {
  const { html, slots, notes: pageNotes } = inferSlots(page, i);
  const id = `page-${i + 1}`;
  fragments.push(html.trim() + '\n');
  layouts.push({ id, name: `第 ${i + 1} 页`, when: '导入模板的原始页面', slots });
  notes.push(...pageNotes);
});

const RESET = `/* 隔离：导入模板常用 .tag/.card/.title 这类通用类名，
   会和 base.css 的组件撞车（例如 .tag 被渲染成灰条）。
   这里先把这些类名在 .tpl-page 内部恢复成浏览器默认，再由模板自己的样式覆盖。 */
.tpl-page :where(.tag,.kicker,.title,.lead,.rule,.footnote,.card,.card-num,.card-term,.card-text,
  .panel,.panel-soft,.callout,.callout-title,.stat,.table,.steps,.answer,.stem,.figure,.figure-img,
  .caption,.cmp,.cmp-col,.verdict,.points,.tasks,.tips,.aims,.aim,.aim-num,.aim-text,
  .grid,.cols,.stack,.row,.c3,.c4,.c5,.c6,.c7,.c8,.c9,.c12,.muted,.accent,.small,.center,
  .spacer,.mono,.nowrap,.body,.example-head,.formula-box,.cond,.explain,.hint) { all: revert; }
`;

// 第三方模板的 CSS 可能带外链：离线优先，统一清理
const cssClean = stripExternalCss(css);
if (cssClean.changed) warnings.push('样式里去掉了：' + cssClean.notes.join('、'));

const theme = `/* 导入自第三方模板：${name}
   原始文件：${path.basename(file)}
   ${flag('source', '') ? '来源：' + flag('source', '') : '请自行记录来源与许可证（开源模板通常要求署名）'}

   注意：导入模板通常自带整套版式与内边距，所以这里把 base.css 的默认内边距清零。
   如果你发现页面贴边，删掉下面这条规则即可。 */

.slide { padding: 0; }

${RESET}

${rewriteCss(cssClean.css)}
`;
// 放映栏占舞台底部 5%，固定高度的原模板按同一比例缩放。
// 复用单文件已有的文档标题和页码，页数随实际课件变化。
const chromeStart = '/* course-kit: imported presentation chrome */';
const chromeEnd = '/* end course-kit presentation chrome */';
function presentationChrome(settings) {
  if (settings.chrome === false) return '';
  return `\n${chromeStart}
@media screen {
  html {
    --screen-w: min(100vw, 177.77778vh);
    --screen-h: min(100vh, 56.25vw);
    --rail-y: calc((100vh - var(--screen-h)) / 2 + var(--screen-h) * .011);
    --rail-x: calc((100vw - var(--screen-w)) / 2 + var(--screen-w) * .028);
    --rail-type: min(1.1vw, 1.96vh);
  }
  body:not(.overview) .stage { background: #f7f6f2; }
  body:not(.overview) .deck { bottom: 5%; }
  body:not(.overview) .slide > .tpl-page { zoom: .95; }
  body:not(.overview) .hud { left: 0; right: 0; width: max-content; margin-inline: auto; }
  body:not(.overview) .hud.is-idle { opacity: 1; }
  body:not(.overview) .hud button { background: #30322f; color: white; }
  body:not(.overview) .hud.is-idle:not(:focus-within) button { opacity: 0; }
  body:not(.overview) .hud .pager, head > title {
    position: fixed; z-index: 31; bottom: var(--rail-y);
    font: 500 var(--rail-type)/1.4 var(--font-sans);
    letter-spacing: .04em; color: #272b26; opacity: .66; pointer-events: none;
  }
  body:not(.overview) .hud .pager { right: var(--rail-x); font-variant-numeric: tabular-nums; }
  html:has(.stage:hover) :is(head > title, .hud .pager) { opacity: .93; }${settings.footer === false ? '' : `
  html:has(body:not(.overview)) > head { display: contents; }
  html:has(body:not(.overview)) > head > title {
    display: block; left: var(--rail-x); max-width: calc(var(--screen-w) * .45);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }`}
}
${chromeEnd}
`;
}

const pack = {
  id: slug,
  name,
  subject: flag('subject', '通用'),
  grade: flag('grade', '通用'),
  version: '0.1.0',
  license: flag('license', '导入模板：请核对原模板许可证'),
  source: flag('source', ''),
  theme: 'theme.css',
  limits: { title: 40, text: 200, text2: 200, text3: 200 },
  layouts,
};
const packFile = path.join(packDir, 'pack.json');
const themeFile = path.join(packDir, 'theme.css');
if (fs.existsSync(packDir)) {
  // 同一模板重复导入只刷新页脚开关，保留已有字段、署名和手工样式。
  const current = fs.existsSync(packFile) && JSON.parse(fs.readFileSync(packFile, 'utf8'));
  const originalTheme = fs.existsSync(themeFile) && fs.readFileSync(themeFile, 'utf8').replace(/\r\n/g, '\n');
  const sameTemplate = current?.theme === 'theme.css' && originalTheme &&
    originalTheme.startsWith(`/* 导入自第三方模板：${name}\n   原始文件：${path.basename(file)}\n`) &&
    originalTheme.includes(rewriteCss(css).trim().replace(/\r\n/g, '\n')) &&
    layouts.length === current.layouts?.length && layouts.every(({ id }, i) => {
      const fragment = path.join(layoutsDir, `${id}.html`);
      return fs.existsSync(fragment) &&
        fs.readFileSync(fragment, 'utf8').trim().replace(/\r\n/g, '\n') === fragments[i].trim().replace(/\r\n/g, '\n');
    });
  if (!sameTemplate) {
    console.error(`这个模板已经导入过了（名为 ${slug}）。换一个文件名再导，或先删掉 packs/${slug} 再试`);
    process.exit(1);
  }
  const start = originalTheme.indexOf(chromeStart);
  const end = originalTheme.indexOf(chromeEnd, start);
  if (start >= 0 && end < 0) throw new Error('theme.css 的放映栏结束标记缺失，请检查后重试');
  const base = start < 0 ? originalTheme :
    originalTheme.slice(0, start) + originalTheme.slice(end + chromeEnd.length);
  fs.writeFileSync(themeFile, base.trimEnd() + '\n' + presentationChrome(current), 'utf8');
} else {
  fs.mkdirSync(layoutsDir, { recursive: true });
  layouts.forEach(({ id }, i) => fs.writeFileSync(path.join(layoutsDir, `${id}.html`), fragments[i], 'utf8'));
  fs.writeFileSync(themeFile, theme + presentationChrome(pack), 'utf8');
  fs.writeFileSync(packFile, JSON.stringify(pack, null, 2) + '\n', 'utf8');
}

/* ---------------- 汇报 ---------------- */

// --json：给网页编辑器用的机器可读结果
if (args.includes('--json')) {
  console.log(JSON.stringify({ packId: slug, name, pages: pages.length, warnings: [...warnings, ...notes] }));
  process.exit(0);
}

console.log(`\n✓ 已导入模板包：packs/${slug}（${layouts.length} 页）`);
if (warnings.length) {
  console.log('\n清洗：');
  warnings.forEach((w) => console.log('  · ' + w));
}
if (notes.length) {
  console.log('\n识别：');
  notes.slice(0, 8).forEach((w) => console.log('  · ' + w));
}
console.log(`
下一步：
  1. 看一眼 packs/${slug}/layouts/page-1.html，确认 {{title}} / {{text}} 落在对的位置
  2. 新建课件时把 "pack" 写成 "${slug}"，或在该文件里加 "background" 之类
  3. 需要改样式：直接改 packs/${slug}/theme.css
  4. 如果原模板要求署名，把作者和链接补进 pack.json 的 source 字段
  5. pack.json 中设 "chrome": false 可关闭放映栏，"footer": false 可单独关闭标题。修改后重复同一导入命令，再渲染课件
`);
