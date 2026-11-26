/**
 * 极简模板引擎（不是 Mustache 的完整实现，只保留模板作者需要的五样东西）
 *
 *   {{name}}                转义后插入文本；文本里的 $...$ / $$...$$ 会被 KaTeX 渲染
 *   {{{name}}}              原样插入（用于图片、内联 SVG 示意图等）
 *   {{#name}}...{{/name}}   数组循环（对象元素直接展开字段）；单个对象只渲染一次
 *   {{^name}}...{{/name}}   为空时渲染
 *   {{.}}                   循环里的当前元素
 *
 * 刻意不支持 partial / lambda —— 模板作者越容易读，越容易贡献。
 */
import katex from 'katex';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 文本 → HTML：先摘出公式，转义其余部分，再把公式渲染回 KaTeX HTML */
export function renderValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (typeof value === 'object') return escapeHtml(JSON.stringify(value));

  const math = [];
  let s = String(value);
  // $$...$$ 先处理，避免被单 $ 规则切碎
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => `\u0000${math.push({ tex, display: true }) - 1}\u0000`);
  s = s.replace(/\$([^$\n]+?)\$/g, (_, tex) => `\u0000${math.push({ tex, display: false }) - 1}\u0000`);
  s = escapeHtml(s);
  // 字段里的换行直接当换行用（必须在插入公式之前做：
  // KaTeX 的 <path d="..."> 是多行字符串，先插公式再替换会污染 SVG 路径）
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const { tex, display } = math[Number(i)];
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' });
  });
}

function lookup(ctx, path) {
  if (path === '.') return ctx['.'];
  let cur = ctx;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

const TOKEN = /\{\{\{([\w.@]+)\}\}\}|\{\{([#^/]?)\s*([\w.@]+|\.)\s*\}\}/g;
const nameRe = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findClose(frag, from, name) {
  const re = new RegExp(`\\{\\{[#/]\\s*${nameRe(name)}\\s*\\}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(frag))) {
    if (m[0].includes('#')) depth += 1;
    else if (--depth === 0) return { start: m.index, end: re.lastIndex };
  }
  return null;
}

function expand(frag, ctx, prefix = '', annotate = false) {
  const re = new RegExp(TOKEN.source, 'g');
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(frag))) {
    out += frag.slice(pos, m.index);
    const isRaw = m[1] !== undefined;
    const sigil = isRaw ? '' : m[2];
    const name = isRaw ? m[1] : m[3];

    if (sigil === '#' || sigil === '^') {
      const close = findClose(frag, re.lastIndex, name);
      if (!close) throw new Error(`模板里 {{${sigil}${name}}} 没有对应的 {{/${name}}}`);
      const inner = frag.slice(re.lastIndex, close.start);
      const value = lookup(ctx, name);
      const isRealArray = Array.isArray(value);
      const list = isRealArray
        ? value
        : value === undefined || value === null || value === false || value === ''
          ? []
          : [value];
      if (sigil === '^') {
        if (list.length === 0) out += expand(inner, ctx);
      } else {
        list.forEach((item, i) => {
          // 真数组才带 [i]；字符串被包成单元素只是为了做存在性判断，路径仍是外层字段名
          const itemPrefix = isRealArray ? joinFieldPath(prefix, name) + '[' + i + ']' : prefix;
          // @index：循环序号（0 基），用来给逐步揭示/自动编号生成 data-build
          const local = { '@index': i, '@no': i + 1 };
          out += expand(inner, isPlainObject(item) ? { ...ctx, ...local, ...item, '.': item } : { ...ctx, ...local, '.': item }, itemPrefix, annotate);
        });
      }
      re.lastIndex = close.end;
      pos = close.end;
      continue;
    }

    if (sigil === '/') throw new Error(`模板里多了一个 {{/${name}}}`);
    const value = lookup(ctx, name);
    const rendered = isRaw ? (value === undefined || value === null ? '' : String(value)) : renderValue(value);
    const plain = typeof value === 'string' || typeof value === 'number';
    if (annotate && !isRaw && plain && String(value) !== '' && name !== '.' && !name.startsWith('@')) {
      out += '<span data-ck-f="' + escapeAttr(joinFieldPath(prefix, name)) + '">' + rendered + '</span>';
    } else {
      out += rendered;
    }
    pos = re.lastIndex;
  }
  return out + frag.slice(pos);
}

/**
 * 找出模板里「由页面顶层提供」的字段名。
 * 循环体（{{#...}}...{{/...}}）里的字段来自数组元素，不算页面字段，所以先把循环体摘掉。
 */
export function slotsOf(frag) {
  const names = new Set();
  const scan = (text) => {
    const re = new RegExp(TOKEN.source, 'g');
    let m;
    while ((m = re.exec(text))) {
      const isRaw = m[1] !== undefined;
      const sigil = isRaw ? '' : m[2];
      const name = isRaw ? m[1] : m[3];
      if (sigil === '#' || sigil === '^') {
        // 循环体里的字段来自数组元素，不算页面字段；
        // 反向块（{{^x}}…{{/x}}）是「为空时显示」的兜底，也不该被当成必填字段。
        const close = findClose(text, re.lastIndex, name);
        if (!close) return;
        re.lastIndex = close.end;
        continue;
      }
      if (sigil === '/') continue;
      if (name === '.') continue;
      names.add(name.split('.')[0]);
    }
  };
  scan(frag);
  return [...names];
}

export function renderTemplate(frag, ctx, opts = {}) {
  return expand(frag, ctx, '', Boolean(opts.annotate));
}

/** 拼字段路径：items[0].term 这种形式，编辑器按路径写回 */
const joinFieldPath = (prefix, key) => (prefix ? `${prefix}.${key}` : key);
const escapeAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * 自定义页用：作者直接写 HTML，只需要把文本节点里的 $…$ 变成 KaTeX。
 * 不做转义（HTML 是作者有意写的），也不碰标签本身和属性。
 */
export function renderMathHtml(html) {
  return String(html)
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (!segment || segment.startsWith('<')) return segment;
      const math = [];
      let s = segment;
      s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => `\u0000${math.push({ tex, display: true }) - 1}\u0000`);
      s = s.replace(/\$([^$\n]+?)\$/g, (_, tex) => `\u0000${math.push({ tex, display: false }) - 1}\u0000`);
      return s.replace(/\u0000(\d+)\u0000/g, (_, i) => {
        const { tex, display } = math[Number(i)];
        return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' });
      });
    })
    .join('');
}
