#!/usr/bin/env node
/**
 * 渲染器：deck.json + pack(模板包) → 单个 HTML 文件
 *
 *   node src/render.mjs examples/gougu.deck.json
 *   node src/render.mjs examples/gougu.deck.json --out dist/勾股定理.html
 *   node src/render.mjs examples/gougu.deck.json --packs ./packs
 *
 * 渲染器不认识「数学」，也不认识「物理」——它只认识 pack 协议。新增学科 = 新增 pack。
 */
import { buildRows, buildGroups } from '../app/edit.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplate, renderMathHtml, slotsOf } from './template.mjs';
import { katexCss } from './assets.mjs';
import { stripDangerous, stripExternalCss } from './sanitize.mjs';
import { applyBuildBlocks, applyBlockTweaks } from './blocks.mjs';
import { checkWidget } from './widgets.mjs';
import { resolveDeckThemeTokens, injectWidgetThemeAndEsc } from './widget-theme.mjs';
import { deduplicateAssets } from './asset-dedup.mjs';

import { themes, fonts } from '../themes/catalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const deckPath = args.find((a) => !a.startsWith('--') && !a.startsWith('-'));
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

if (!deckPath) {
  console.error(`
用法：node src/render.mjs <deck.json> [--out <file.html>] [--packs <dir>]

  deck.json 结构见 SPEC.md；模板包见 packs/<学科>/
`);
  process.exit(1);
}

const annotateFields = args.includes('--annotate');
const packsDir = path.resolve(flag('packs', path.join(ROOT, 'packs')));
const deckAbs = path.resolve(deckPath);

/* ---------------- 读取 deck 与 pack ---------------- */

const readJson = (file) => {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); // 记事本存盘会带 BOM
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`JSON 解析失败：${file}\n  ${error.message}`);
    console.error('  常见原因：多了逗号、少了引号、用了中文引号。');
    process.exit(1);
  }
};

const deck = readJson(deckAbs);
// Keep teacher-only fields out of every student template context.
for (const page of deck.pages) { delete page.notes; delete page.minutes; }
const packId = deck.pack || 'math-junior';
const packDir = path.join(packsDir, packId);
if (!fs.existsSync(path.join(packDir, 'pack.json'))) {
  console.error(`找不到模板包：${packDir}/pack.json`);
  process.exit(1);
}
const pack = readJson(path.join(packDir, 'pack.json'));
const elasticDir = path.join(packsDir, 'general-elastic');
const elasticPack = pack.kind === 'user-template' && fs.existsSync(path.join(elasticDir, 'pack.json'))
  ? readJson(path.join(elasticDir, 'pack.json'))
  : null;
if (elasticPack) {
  const existingIds = new Set(pack.layouts.map((l) => l.id));
  for (const l of elasticPack.layouts) if (!existingIds.has(l.id)) pack.layouts.push(l);
  pack.limits = { ...elasticPack.limits, ...(pack.limits || {}) };
}

const layoutIds = new Set(pack.layouts.map((l) => l.id));
const fragmentCache = new Map();
function layoutFragment(id) {
  if (!layoutIds.has(id)) {
    console.error(`第 ${deck.pages.indexOf(deck.pages.find((p) => p.layout === id)) + 1} 页用了未注册的页型「${id}」`);
    console.error(`可用的页型：${[...layoutIds].join(', ')}`);
    process.exit(1);
  }
  if (!fragmentCache.has(id)) {
    const baseDir = elasticPack && id.startsWith('elastic-') ? elasticDir : packDir;
    const file = path.join(baseDir, 'layouts', `${id}.html`);
    if (!fs.existsSync(file)) {
      console.error(`pack 里登记了「${id}」但没有 layouts/${id}.html`);
      process.exit(1);
    }
    fragmentCache.set(id, fs.readFileSync(file, 'utf8'));
  }
  return fragmentCache.get(id);
}

/* ---------------- 自定义页：AI 自己写的那几页 ---------------- */

const deckDir = path.dirname(deckAbs);
const fromDeck = (p) => path.resolve(deckDir, p);

/* ---------------- 图片：本地相对路径 → 内联 base64（保证单文件可发） ---------------- */

const IMG_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};
const MAX_IMG = 3 * 1024 * 1024;
let embeddedImages = 0;

function inlineImage(src, dirs) {
  let blocked = false;
  for (const dir of dirs) {
    const file = path.resolve(dir, src);
    // 只允许引用目录内部的图片：导入的第三方模板不能借 ../ 把本机文件塞进课件
    if (file !== dir && !file.startsWith(dir + path.sep)) {
      blocked = true;
      continue;
    }
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const mime = IMG_MIME[path.extname(file).toLowerCase()];
    if (!mime) {
      warnings.push(`图片格式不支持内联：${src}`);
      return null;
    }
    const size = fs.statSync(file).size;
    if (size > MAX_IMG) {
      warnings.push(`图片 ${src} 有 ${(size / 1024 / 1024).toFixed(1)}MB，超过 3MB 未内联`);
      return null;
    }
    embeddedImages += 1;
    return `data:${mime};base64,` + fs.readFileSync(file).toString('base64');
  }
  warnings.push(blocked ? `图片路径越界，已忽略：${src}` : `找不到图片：${src}（相对 deck 文件或 pack 目录）`);
  return null;
}

function embedImages(html, dirs) {
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (match, pre, src, post) => {
    if (/^(data:|https?:|\/\/|#)/i.test(src)) return match;
    const data = inlineImage(src, dirs);
    return data ? pre + data + post : match;
  });
}

const UNSAFE = [
  [/<script\b/i, '<script> 脚本'],
  [/\son[a-z]+\s*=/i, '行内事件属性（onclick 等）'],
  [/javascript:/i, 'javascript: 链接'],
  [/<(iframe|object|embed|link|base|form)\b/i, '<iframe> / <link> / <form> 等标签'],
  [/(src|href)\s*=\s*["']?\s*(https?:|\/\/)/i, '外链资源（会破坏离线可用）'],
  [/<style\b/i, '<style>（样式请写到 deck.json 的 css 字段）'],
];

function assertCustomSafe(html, pageNo) {
  const scan = html.replace(/<!--[\s\S]*?-->/g, ''); // 注释里写到 <script> 这种字眼不算违规
  for (const [re, what] of UNSAFE) {
    if (re.test(scan)) {
      console.error(`第 ${pageNo} 页（自定义页）里出现了不允许的 ${what}。`);
      console.error('  自定义页的产物必须是「自包含、可离线、无脚本」的 HTML 片段。');
      process.exit(1);
    }
  }
}

/** 页内 css 只作用于本页：给每条选择器加上 #pN 前缀 */
function scopeCss(css, scope) {
  return String(css).replace(/([^{}]+)\{/g, (match, selector) => {
    const sel = selector.trim();
    if (!sel || sel.startsWith('@')) return match;
    const scoped = sel
      .split(',')
      .map((part) => {
        const one = part.trim();
        // :scope 代表页面根，必须替换成本身（拼成 "#p1 :scope" 是匹配不到的）
        if (one.startsWith(':scope')) return scope + one.slice(6).trim();
        return scope + ' ' + one;
      })
      .join(', ');
    return `${scoped} {`;
  });
}

/* ---------------- 逐页渲染 ---------------- */

const meta = deck.meta || {};
const warnings = [];
const tweakWarnings = [];
const sections = [];
const pageStyles = [];
let hasTweaks = false;
let hasFreeBlocks = false;
let widgetThemeTokens = null;
function getWidgetThemeTokens() {
  if (!widgetThemeTokens) {
    const tFile = path.join(packDir, pack.theme || 'theme.css');
    const pCss = fs.existsSync(tFile) ? stripExternalCss(fs.readFileSync(tFile, 'utf8')).css : '';
    const tObj = themes.find(item => item.id === deck.theme);
    const tCss = tObj ? fs.readFileSync(path.join(ROOT, 'themes', tObj.id + '.css'), 'utf8') : '';
    const dCss = typeof deck.css === 'string' && deck.css ? stripExternalCss(deck.css).css : '';
    widgetThemeTokens = resolveDeckThemeTokens({ packCss: pCss, themeCss: tCss, deckCss: dCss });
  }
  return widgetThemeTokens;
}
function renderFreeBlock(b, dirs) {
  if (b?.hidden || !b?.id || !['text','image','widget'].includes(b.type) || ![b.x,b.y,b.w,b.h].every(Number.isFinite) || b.w<=0 || b.h<=0) return '';
  const esc = value => String(value ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  const align = ['center','right'].includes(b.align) ? b.align : 'left';
  const colorExtra = typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? `;color:${b.color}` : '';
  const zExtra = Number.isSafeInteger(b.z) && b.z !== 0 ? `;z-index:${b.z}` : '';
  const style = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;font-size:${Number.isFinite(b.size)?b.size:32}px;text-align:${align};font-weight:${b.weight===700?700:400}${colorExtra}${zExtra}`;
  let content = esc(b.text);
  if (b.type === 'widget') {
    const cScale = Number.isFinite(b.contentScale) ? Math.min(100, Math.max(40, b.contentScale)) : 100;
    const iframeStyle = cScale < 100
      ? ` style="width:${(10000 / cScale).toFixed(2)}%;height:${(10000 / cScale).toFixed(2)}%;transform:scale(${(cScale / 100).toFixed(3)});transform-origin:0 0"`
      : '';
    if (typeof b.embedUrl === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(b.embedUrl)) {
      hasFreeBlocks = true;
      let finalUrl = b.embedUrl;
      // GeoGebra iframe 默认锁死 800px 宽：按当前演示块实际宽高动态注入 /width/W/height/H，彻底避免右侧控件被 GeoGebra 自身裁切
      if (/^https:\/\/(?:www\.)?geogebra\.org\/material\/iframe\/id\/[a-zA-Z0-9]+/i.test(finalUrl)) {
        const ggbW = Math.max(400, Math.round((Number(b.w) || 1080) * 100 / cScale));
        const ggbH = Math.max(260, Math.round((Number(b.h) || 580) * 100 / cScale));
        finalUrl = finalUrl
          .replace(/\/width\/\d+\/height\/\d+/i, '')
          .replace(/(material\/iframe\/id\/[a-zA-Z0-9]+)/i, `$1/width/${ggbW}/height/${ggbH}`);
      }
      return '<div class="free-block" data-free-id="'+esc(b.id)+'" style="'+style+'"><iframe class="ck-widget"'+iframeStyle+' allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="'+esc(finalUrl)+'"></iframe></div>';
    }
    if (typeof b.widgetRef === 'string' && /^[\w-]{2,90}$/.test(b.widgetRef)) {
      const refPath = path.join(ROOT, 'app-data', 'widgets', b.widgetRef + '.html');
      if (!fs.existsSync(refPath)) return '';
      const rawHtml = fs.readFileSync(refPath, 'utf8');
      if (!/<(html|body|svg|canvas)[\s>]/i.test(rawHtml)) return '';
      hasFreeBlocks = true;
      const guardedHtml = injectWidgetThemeAndEsc(rawHtml, getWidgetThemeTokens());
      const srcdoc = guardedHtml.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      return '<div class="free-block" data-free-id="'+esc(b.id)+'" style="'+style+'"><iframe class="ck-widget"'+iframeStyle+' sandbox="allow-scripts allow-same-origin" scrolling="no" srcdoc="'+srcdoc+'"></iframe></div>';
    }
    // 断网自包含的交互组件：校验不过就不渲染（避免把外链带进离线课件）
    const check = checkWidget(b.html);
    if (!check.ok) return '';
    hasFreeBlocks = true;
    // 注入当前课件 --ck-* 主题变量与 Esc 退出全屏转发脚本
    const guardedHtml = injectWidgetThemeAndEsc(b.html, getWidgetThemeTokens());
    const srcdoc = guardedHtml.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    return '<div class="free-block" data-free-id="'+esc(b.id)+'" style="'+style+'"><iframe class="ck-widget" sandbox="allow-scripts" scrolling="no" srcdoc="'+srcdoc+'"></iframe></div>';
  }
  if (b.type === 'image') {
    const asset = /^([\p{L}\p{N}_-]+)\/(img-\d+\.(?:png|jpe?g|gif|webp|bmp))$/iu.exec(b.src);
    const src = asset ? asset[2] : b.src;
    if (!asset && !/^images\/[\w-]+\.(?:png|jpe?g|gif|webp)$/i.test(src)) throw Error('自由图片路径无效');
    // 图片效果：全部用 CSS，零依赖、断网可用；默认值不改变既有渲染
    const clamp = (v, lo, hi, d) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    const bright = clamp(b.bright, 50, 200, 100), contrast = clamp(b.contrast, 50, 200, 100);
    const saturate = clamp(b.saturate, 0, 200, 100), blur = clamp(b.blur, 0, 12, 0);
    const radius = clamp(b.radius, 0, 200, 0), opacity = clamp(b.opacity, 10, 100, 100);
    const rotate = clamp(b.rotate, -45, 45, 0);
    const filters = [];
    if (bright !== 100) filters.push('brightness(' + bright + '%)');
    if (contrast !== 100) filters.push('contrast(' + contrast + '%)');
    if (saturate !== 100) filters.push('saturate(' + saturate + '%)');
    if (blur) filters.push('blur(' + blur + 'px)');
    const transforms = [];
    if (rotate) transforms.push('rotate(' + rotate + 'deg)');
    if (b.flipH) transforms.push('scaleX(-1)');
    if (b.flipV) transforms.push('scaleY(-1)');
    const imgStyle = [
      filters.length ? 'filter:' + filters.join(' ') : '',
      transforms.length ? 'transform:' + transforms.join(' ') : '',
      radius ? 'border-radius:' + radius + 'px' : '',
      opacity !== 100 ? 'opacity:' + opacity / 100 : '',
      b.shadow ? 'box-shadow:0 12px 32px rgba(0,0,0,.35)' : '',
      b.border ? 'outline:2px solid rgba(255,255,255,.85)' : '',
      b.fit === 'cover' ? 'object-fit:cover' : '',
    ].filter(Boolean).join(';');
    content = embedImages('<img alt=""' + (imgStyle ? ' style="' + imgStyle + '"' : '') + ' src="'+src+'">',asset ? [path.join(ROOT,'assets',asset[1])] : dirs);
    if (!content.includes('src="data:')) throw Error('自由图片无法内联：'+src);
  }
  hasFreeBlocks = true;
  return '<div class="free-block" data-free-id="'+esc(b.id)+'" style="'+style+'">'+content+'</div>';
}
const customPageNos = [];
const VALID_TRANSITIONS = ['fade', 'slide', 'push-up', 'zoom', 'blur', 'cover', 'flip', 'none'];
const EXTRA_TRANSITION_CSS = `
@keyframes motion-push-up-in { from { opacity: 0; transform: translateY(36px); } }
@keyframes motion-push-up-out { to { opacity: 0; transform: translateY(-36px); } }
@keyframes motion-push-down-in { from { opacity: 0; transform: translateY(-36px); } }
@keyframes motion-push-down-out { to { opacity: 0; transform: translateY(36px); } }
@keyframes motion-zoom-in { from { opacity: 0; transform: scale(.94); } }
@keyframes motion-zoom-out { to { opacity: 0; transform: scale(1.04); } }
@keyframes motion-blur-in { from { opacity: 0; filter: blur(10px); transform: scale(.985); } }
@keyframes motion-blur-out { to { opacity: 0; filter: blur(8px); } }
@keyframes motion-cover-in { from { opacity: .65; transform: translateX(8%); } }
@keyframes motion-cover-out { to { opacity: .35; transform: scale(.96); } }
@keyframes motion-cover-back-in { from { opacity: .65; transform: translateX(-8%); } }
@keyframes motion-flip-in { from { opacity: 0; transform: perspective(1200px) rotateY(14deg) scale(.97); } }
@keyframes motion-flip-out { to { opacity: 0; transform: perspective(1200px) rotateY(-14deg) scale(.97); } }
@keyframes motion-flip-back-in { from { opacity: 0; transform: perspective(1200px) rotateY(-14deg) scale(.97); } }
@keyframes motion-flip-back-out { to { opacity: 0; transform: perspective(1200px) rotateY(14deg) scale(.97); } }
html[data-transition="push-up"] .slide.slide-entering { animation: motion-push-up-in 260ms cubic-bezier(.22,1,.36,1) both; }
html[data-transition="push-up"] .slide.slide-leaving { animation: motion-push-up-out 240ms cubic-bezier(.2,0,0,1) both; }
html[data-transition="push-up"].motion-back .slide.slide-entering { animation-name: motion-push-down-in; }
html[data-transition="push-up"].motion-back .slide.slide-leaving { animation-name: motion-push-down-out; }
html[data-transition="zoom"] .slide.slide-entering { animation: motion-zoom-in 260ms cubic-bezier(.22,1,.36,1) both; }
html[data-transition="zoom"] .slide.slide-leaving { animation: motion-zoom-out 220ms ease both; }
html[data-transition="blur"] .slide.slide-entering { animation: motion-blur-in 280ms cubic-bezier(.22,1,.36,1) both; }
html[data-transition="blur"] .slide.slide-leaving { animation: motion-blur-out 220ms ease both; }
html[data-transition="cover"] .slide.slide-entering { animation: motion-cover-in 280ms cubic-bezier(.22,1,.36,1) both; }
html[data-transition="cover"] .slide.slide-leaving { animation: motion-cover-out 260ms ease both; }
html[data-transition="cover"].motion-back .slide.slide-entering { animation-name: motion-cover-back-in; }
html[data-transition="flip"] .slide.slide-entering { animation: motion-flip-in 280ms cubic-bezier(.22,1,.36,1) both; }
html[data-transition="flip"] .slide.slide-leaving { animation: motion-flip-out 240ms ease both; }
html[data-transition="flip"].motion-back .slide.slide-entering { animation-name: motion-flip-back-in; }
html[data-transition="flip"].motion-back .slide.slide-leaving { animation-name: motion-flip-back-out; }
@media (prefers-reduced-motion: reduce) {
  .slide.slide-entering, .slide.slide-leaving { animation: none !important; }
}`;
const transition = VALID_TRANSITIONS.includes(deck.transition) ? deck.transition : 'fade';
const motionEnabled = deck.transition !== undefined || deck.pages.some(page =>
  ['anim', 'stagger', 'speed'].some(key => page[key] !== undefined));
const motionDocument = motionEnabled ? new (await import('jsdom')).JSDOM('').window.document : null;
const entranceTargets = '.card, .note-item, .cols > *, .points > li, .tasks > li, .steps > li, .aim';

function applyEntrance(html, anim) {
  if (!anim && !/data-(anim|stagger)\b/i.test(html)) return html;
  const template = motionDocument.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  // 教师设置覆盖页型自带的入场，包括超出上限的模板元素。
  // 例外：老师给某个元素单独选过动效（data-anim-key），那个保留自己的。
  content.querySelectorAll('[data-anim]').forEach(el => { if (!el.hasAttribute('data-anim-key')) el.removeAttribute('data-anim'); });
  content.querySelectorAll('[data-stagger]').forEach(el => el.removeAttribute('data-stagger'));
  if (anim) {
    const targets = Array.from(content.querySelectorAll(entranceTargets))
      .filter(el => !el.hasAttribute('data-anim-key')).slice(0, 12);
    targets.forEach(el => el.setAttribute('data-anim', anim));
  }
  return template.innerHTML;
}

/**
 * 老师勾了「点一下才出现」：把本页的卡片/条目按顺序变成逐步揭示。
 * 已经有 data-build 的元素不动（例题步骤本来就逐步出）。
 */
function applyBuild(html) {
  let n = 0;
  for (const match of html.matchAll(/\bdata-build=["'](\d+)["']/g)) n = Math.max(n, Number(match[1]));
  return html.replace(/<(div|li)\b([^>]*)>/g, (match, tag, attrs) => {
    if (/\bdata-build\s*=/.test(attrs)) return match;
    const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
    const hit = tag === 'li' || /\b(card|note-item|cmp-col|aim|task)\b/.test(cls);
    if (!hit) return match;
    n += 1;
    return `<${tag}${attrs} data-build="${n}">`;
  });
}

let groupedRuntime = false;
deck.pages.forEach((page, i) => {
  const rows = buildRows(page, pack.layouts.find(layout => layout.id === page.layout));
  const groups = buildGroups(rows, page.build);
  const configuredBuild = Boolean(page.build || groups.size || (page.buildBlocks || []).length);
  groupedRuntime ||= configuredBuild;
  for (const row of rows) row.itemGroup = groups.get(row);
  const pageNo = i + 1;
  const domId = `p${pageNo}`;
  let layoutId = page.layout;
  let html;

  const isCustom = typeof page.html === 'string' || typeof page.htmlFile === 'string';

  if (isCustom) {
    layoutId = 'custom';
    customPageNos.push(pageNo);
    const source = page.htmlFile ? fs.readFileSync(fromDeck(page.htmlFile), 'utf8') : page.html;
    const stripped = source.replace(/<!--[\s\S]*?-->/g, ''); // 作者注释不发给学生
    assertCustomSafe(stripped, pageNo);
    html = renderMathHtml(stripped).trim();
    if (page.cssFile || page.css) {
      const css = page.cssFile ? fs.readFileSync(fromDeck(page.cssFile), 'utf8') : page.css;
      // 页级样式也可能是别人给的课件：外链一律清掉，保证离线
      const cssClean = stripExternalCss(css);
      if (cssClean.changed) warnings.push(`第 ${pageNo} 页的自定义样式已清理：${cssClean.notes.join('、')}`);
      pageStyles.push(scopeCss(cssClean.css, `#${domId}`));
    }
  } else {
    if (!layoutId) {
      console.error(`第 ${pageNo} 页既没有 layout，也没有 html / htmlFile`);
      process.exit(1);
    }
    const fragment = layoutFragment(layoutId);
    const ctx = { ...meta, ...page, configuredBuild, page, meta, deck: { ...meta, pages: deck.pages.length } };

    // 槽位检查：模板要的字段没填 → 只警告，不阻塞（作者可能就是要留空）
    for (const slot of slotsOf(fragment)) {
      if (ctx[slot] === undefined) warnings.push(`第 ${pageNo} 页(${layoutId}) 缺字段「${slot}」`);
    }

    // 长度检查
    const layoutSpec = pack.layouts.find((l) => l.id === layoutId);
    const limits = pack.limits || {};
    const overLimit = (name, value) => {
      const limit = layoutSpec?.slotSpecs?.[name]?.max ?? pack.slots?.[layoutId]?.[name]?.max ?? limits[name];
      if (!limit || typeof value !== 'string') return;
      if (value.replace(/\$[^$]*\$/g, '').length > limit) {
        warnings.push(`第 ${pageNo} 页字段「${name}」${value.length} 字，超过上限 ${limit}，注意溢出`);
      }
    };
    for (const [key, value] of Object.entries(page)) {
      overLimit(key, value);
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === 'object') {
            for (const [k, v] of Object.entries(item)) overLimit(k, v);
          } else if (typeof item === 'string') overLimit(key, item);
        });
      }
    }

    // 模板里的字面量 $…$ 也要渲染（promote 出来的页型没有占位符，公式直接写在 HTML 里）
    html = renderMathHtml(renderTemplate(fragment, ctx, { annotate: annotateFields })).trim();

    // 模板包可能来自别人分享：渲染前统一清理可执行/可外联内容
    const cleaned = stripDangerous(html);
    if (cleaned.changed) {
      html = cleaned.html;
      warnings.push(`第 ${pageNo} 页（${layoutId}）已清理：${cleaned.notes.join('、')}`);
    }

    // 页型页也要支持页级样式：字号缩放（--page-scale）、局部微调都写在这里
    if (page.cssFile || page.css) {
      const rawCss = page.cssFile ? fs.readFileSync(fromDeck(page.cssFile), 'utf8') : page.css;
      const cleanCss = stripExternalCss(rawCss);
      if (cleanCss.changed) warnings.push(`第 ${pageNo} 页的自定义样式已清理：${cleanCss.notes.join('、')}`);
      pageStyles.push(scopeCss(cleanCss.css, `#${domId}`));
    }

    // 老师逐元素选的「第几次点击出现」（任意元素，不限条目）
    if (Array.isArray(page.buildBlocks) && page.buildBlocks.length) {
      const applied = applyBuildBlocks(html, page.buildBlocks);
      if (applied.applied) html = applied.html;
      if (applied.applied !== page.buildBlocks.length) {
        warnings.push(`第 ${pageNo} 页有 ${page.buildBlocks.length - applied.applied} 个元素已不存在（布局改过？），已跳过`);
      }
    }
  }

  const assetDirs = [path.join(ROOT, 'assets'), path.join(ROOT, 'references')];
  const imgDirs = page.htmlFile
    ? [deckDir, path.dirname(fromDeck(page.htmlFile)), packDir, ...assetDirs]
    : [deckDir, packDir, ...assetDirs];
  if (page.blockTweaks?.length) {
    // 编辑器的文字槽允许插入本地图片。先还原为元素，路径才能与预览中的 DOM 对上。
    html = html.replace(/&lt;img class=&quot;figure-img&quot; src=&quot;images\/([\w-]+\.(?:png|jpeg|jpg|webp|gif))&quot;&gt;/gi,
      '<img class="figure-img" src="images/$1">');
  }
  html = embedImages(html, imgDirs);
  let skipped = 0;
  const adjusted = applyBlockTweaks(html, page.blockTweaks, () => { skipped++; });
  if (adjusted !== html) hasTweaks = true;
  html = adjusted;
  if (skipped) tweakWarnings.push(`第 ${pageNo} 页有 ${skipped} 个微调目标已变化，请重新选择并微调`);

  // 老师勾了「点一下才出现」：把本页条目按顺序变成逐步揭示
  if (page.build && !rows.length) html = applyBuild(html);

  let motionAttrs = '';
  if (motionEnabled) {
    const anim = ['fade', 'blur', 'fade-up', 'fade-down', 'slide-left', 'slide-right', 'scale', 'zoom', 'rotate', 'flip', 'bounce'].includes(page.anim) ? page.anim : null;
    html = applyEntrance(html, anim);
    if (anim) {
      const stagger = [60, 120].includes(page.stagger) ? page.stagger : 0;
      const speed = [180, 360].includes(page.speed) ? page.speed : 260;
      motionAttrs = ` data-stagger="${stagger}"`;
      pageStyles.push(`#${domId} { --motion-dur: ${speed}ms; }`);
    }
  }

  if (Array.isArray(page.freeBlocks)) html += page.freeBlocks.map(b=>renderFreeBlock(b,imgDirs)).join('');
  let bgStyle = '';
  if (typeof page.background === 'string' && page.background) {
    const reference = /^references\/(ref-[\p{L}\p{N}_-]+)\/(background\.(?:png|jpe?g|webp|gif))$/iu.exec(page.background);
    const data = reference
      ? inlineImage(reference[2], [path.join(ROOT, 'references', reference[1])])
      : inlineImage(page.background, imgDirs);
    const fallback = page.background.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const veil = Number.isFinite(page.veil) ? Math.max(0, Math.min(1, page.veil)) : 0.35;
    const clamp = (v, lo, hi, d) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    const bgBlur = clamp(page.bgBlur, 0, 24, 0);
    const bgScale = clamp(page.bgScale, 100, 200, 100) / 100;
    const bgX = clamp(page.bgX, -50, 50, 0);
    const bgY = clamp(page.bgY, -50, 50, 0);
    // 背景四项只在非默认时输出，保证没动过的课件字节不变
    const bgExtra = (bgBlur || bgScale !== 1 || bgX || bgY || page.bgFade)
      ? `;--bg-blur:${bgBlur}px;--bg-scale:${bgScale};--bg-x:${bgX}%;--bg-y:${bgY}%`
      : '';
    bgStyle = ` style="--slide-veil: ${veil}${bgExtra}"` + (page.bgFade ? ' data-bg-fade=""' : '');
    html = `<div class="slide-bg" aria-hidden="true"><img src="${data || fallback}" alt=""></div>${html}`;
  }

  const pageThemeAttr = (() => {
    if (page.theme == null || page.theme === '') return '';
    const pt = themes.find(item => item.id === page.theme);
    if (!pt) throw new Error('未知的课件主题或字体');
    return ` data-page-theme="${pt.id}"`;
  })();
  sections.push(
    `<section id="${domId}" class="slide${i === 0 ? ' active' : ''}" data-layout="${layoutId}" data-index="${pageNo}"${i === 0 ? '' : ' hidden'}${configuredBuild ? ' data-build-groups' : ''}${motionAttrs}${pageThemeAttr}${bgStyle}>${html}</section>`
  );
});

const dedup = deduplicateAssets(sections, pageStyles);

/* ---------------- 样式：base + 主题 + KaTeX（字体内联） ---------------- */

const read = (p) => fs.readFileSync(p, 'utf8');

const themeFile = path.join(packDir, pack.theme || 'theme.css');
const [baseCss, backgroundCss] = read(path.join(HERE, 'base.css')).split('/* slide backgrounds */');
const theme = themes.find(item => item.id === deck.theme);
const font = fonts.find(item => item.id === deck.font);
if ((deck.theme != null && !theme) || (deck.font != null && !font)) {
  throw new Error('未知的课件主题或字体');
}
const packCssRaw = fs.existsSync(themeFile) ? read(themeFile) : '';
// 第三方模板包的样式可能带外链：离线优先，统一清理
const cssCleaned = stripExternalCss(packCssRaw);
if (cssCleaned.changed) warnings.push(`模板样式已清理：${cssCleaned.notes.join('、')}`);
const packCss = cssCleaned.css;
const usesElastic = Boolean(elasticPack && deck.pages.some((p) => typeof p.layout === 'string' && p.layout.startsWith('elastic-')));
const elasticThemeCss = usesElastic && fs.existsSync(path.join(elasticDir, 'theme.css'))
  ? stripExternalCss(read(path.join(elasticDir, 'theme.css'))).css
  : '';
const css = [
  baseCss,
  // Older exports used the literal heading stack and ended before the body rule.
  !theme && !font && packCss.includes('/* optional deck typography */')
    ? packCss.split('/* optional deck typography */')[0].replace(/var\(--font-display, ([^()]+)\)/g, '$1')
    : packCss,
  ...(elasticThemeCss ? [elasticThemeCss] : []),
  ...(theme ? [read(path.join(ROOT, 'themes', theme.id + '.css'))] : []),
  ...[...new Set(deck.pages.map(p => p.theme).filter(Boolean))].map(tid => {
    const scope = `.slide[data-page-theme="${tid}"]`;
    const splitSelectors = (selText) => {
      const parts = [];
      let cur = '', depth = 0, quote = '';
      for (let i = 0; i < selText.length; i++) {
        const ch = selText[i];
        if (quote) { cur += ch; if (ch === quote && selText[i - 1] !== '\\') quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === '(' || ch === '[') { depth++; cur += ch; continue; }
        if (ch === ')' || ch === ']') { depth = Math.max(0, depth - 1); cur += ch; continue; }
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      return parts;
    };
    const scopeOne = (s) => {
      const trimmed = s.trim();
      if (!trimmed) return trimmed;
      if (/:root\b/.test(trimmed)) return trimmed.replace(/:root\b/g, scope);
      if (/\.slide(?![\w-]|\[data-page-theme)/.test(trimmed)) {
        return trimmed.replace(/\.slide(?![\w-]|\[data-page-theme)/g, scope);
      }
      if (/^body\b/.test(trimmed)) return trimmed.replace(/^body\b/, scope);
      return `${scope} ${trimmed}`;
    };
    const scopeBlock = (cssText) => {
      let out = '', i = 0, n = cssText.length;
      while (i < n) {
        if (cssText[i] === '/' && cssText[i + 1] === '*') {
          const end = cssText.indexOf('*/', i + 2);
          if (end < 0) { out += cssText.slice(i); break; }
          out += cssText.slice(i, end + 2); i = end + 2; continue;
        }
        const brace = cssText.indexOf('{', i);
        if (brace < 0) { out += cssText.slice(i); break; }
        const header = cssText.slice(i, brace);
        let depth = 1, j = brace + 1, quote = '';
        while (j < n && depth > 0) {
          const ch = cssText[j];
          if (quote) { if (ch === quote && cssText[j - 1] !== '\\') quote = ''; j++; continue; }
          if (ch === '"' || ch === "'") { quote = ch; j++; continue; }
          if (ch === '/' && cssText[j + 1] === '*') {
            const end = cssText.indexOf('*/', j + 2);
            j = end < 0 ? n : end + 2; continue;
          }
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          j++;
        }
        const body = cssText.slice(brace + 1, j - 1);
        const hTrim = header.trim();
        if (/^@(media|supports|container|layer)\b/i.test(hTrim)) {
          out += `${header}{${scopeBlock(body)}}`;
        } else if (hTrim.startsWith('@')) {
          out += `${header}{${body}}`;
        } else {
          const scoped = splitSelectors(header).map(scopeOne).join(', ');
          out += `\n${scoped} {${body}}`;
        }
        i = j;
      }
      return out;
    };
    const raw = scopeBlock(read(path.join(ROOT, 'themes', tid + '.css')));
    return `${raw}\n${scope} { background-color: var(--bg); color: var(--ink); }`;
  }),
  ...(typeof deck.css === 'string' && deck.css ? [stripExternalCss(deck.css).css] : []),
  ...(font ? [`:root { --font-display: ${font.stack}; --font-body: ${font.stack}; --font-sans: var(--font-body); --font-serif: var(--font-display); } body { font-family: var(--font-body); }`] : []),
  katexCss(),
  ...(deck.pages.some(page => page.background) ? [backgroundCss] : []),
  ...dedup.pageStyles,
  ...(dedup.cssRule ? [dedup.cssRule] : []),
  ...(hasFreeBlocks ? [read(path.join(HERE,'free-blocks.css'))] : []),
  ...(hasTweaks ? [read(path.join(HERE, 'block-tweaks.css'))] : []),
  ...(groupedRuntime ? ['@media screen and (prefers-reduced-motion: reduce) { html.anim-ready body:not(.no-anim):not(.overview) [data-build-groups] [data-build]:not(.in) { opacity: 0 !important; } }'] : []),
  ...(motionEnabled ? [read(path.join(HERE, 'motion.css'))] : []),
  ...(motionEnabled && !['fade', 'slide', 'none'].includes(transition) ? [EXTRA_TRANSITION_CSS] : []),
].join('\n');

let runtime = read(path.join(HERE, motionEnabled ? 'motion-runtime.js' : 'runtime.js'));
// Keep legacy exports byte-identical by omitting the optional playback branches.
if (!groupedRuntime) runtime = runtime.replace(/^ *\/\* grouped builds \*\/[\s\S]*?\/\* end grouped builds \*\/\r?\n/gm, '');
if (dedup.bootScript) runtime = dedup.bootScript + '\n' + runtime;

/* ---------------- 组装单文件 HTML ---------------- */

const title = meta.title || (deck.pages[0] && deck.pages[0].title) || '课件';
const total = deck.pages.length;

const html = `<!doctype html>
<html lang="zh-CN"${motionEnabled ? ` data-transition="${transition}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="course-kit">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
<div class="progress" style="width:0"></div>
<div class="stage">
<main class="deck">
${dedup.sections.join('\n')}
</main>
</div>
<div class="hud is-idle">
  <button class="prev" title="上一页">‹</button>
  <span class="pager">01 / ${String(total).padStart(2, '0')}</span>
  <button class="next" title="下一页">›</button>
  <button class="grid" title="总览 (Esc)">总览</button>
  <button class="full" title="全屏 (F)">全屏</button>
</div>
<script>
${runtime}
</script>
</body>
</html>
`;

if (args.includes('--stdout')) {
  process.stdout.write(html);
} else {
  const outPath = path.resolve(flag('out', path.join(path.dirname(deckAbs), path.basename(deckAbs, '.json') + '.html')));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  /* ---------------- 汇报 ---------------- */

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
  console.log(`✓ ${path.relative(process.cwd(), outPath)}  ${kb} KB  ${total} 页  pack=${packId}`);
  if (customPageNos.length) {
    console.log(`  其中 ${customPageNos.length} 页是自定义页（第 ${customPageNos.join('、')} 页）—— 已被同一套版式与自检覆盖，但仍建议人眼过一遍`);
  }
  if (embeddedImages) console.log(`  已内联 ${embeddedImages} 张图片（单个 HTML 仍然可以直接发）`);
  if (args.includes('--report-tweaks')) console.log('CK_TWEAK_WARNINGS=' + JSON.stringify(tweakWarnings));
  warnings.push(...tweakWarnings);
  if (warnings.length) {
    console.log(`\n注意 ${warnings.length} 条：`);
    for (const w of warnings.slice(0, 20)) console.log('  · ' + w);
    if (warnings.length > 20) console.log(`  · 还有 ${warnings.length - 20} 条…`);
  }
  console.log(`\n下一步：node tools/check.mjs "${path.relative(process.cwd(), outPath)}"  # 量溢出`);
}
