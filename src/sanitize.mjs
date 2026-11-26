// parse5 已由 jsdom 锁定并安装。片段只解析为数据，不创建浏览器文档。
import { parseFragment, serialize } from 'parse5';

const blocked = new Set(['script', 'iframe', 'object', 'embed', 'form', 'noscript',
  'template', 'link', 'base', 'style', 'plaintext', 'xmp', 'noembed', 'noframes']);
const urls = new Set(['href', 'src', 'action', 'formaction', 'poster', 'data']);
const compact = value => value.replace(/[\u0000-\u0020\u007f-\u009f\u00a0]/g, '').toLowerCase();
const unsafeUrl = /^(?:(?:javascript|vbscript|livescript):|data:(?!image\/(?:png|jpeg|gif|webp|avif);base64,))/;

export function stripDangerous(html, notes = []) {
  const source = String(html);
  let changed = false;
  function mark(label) {
    changed = true;
    if (!notes.includes(label)) notes.push(label);
  }
  const tree = parseFragment(source, {
    onParseError() { mark('HTML 语法修复'); },
  });
  const parents = [tree];
  while (parents.length) {
    const parent = parents.pop();
    parent.childNodes = parent.childNodes.filter(node => {
      if (!node.tagName) return true;
      const tag = node.tagName.toLowerCase();
      if (blocked.has(tag) || /[<>"']/.test(tag) || (tag === 'meta' &&
          node.attrs.some(a => a.name === 'http-equiv' && compact(a.value) === 'refresh'))) {
        mark('移除元素 ' + tag);
        return false;
      }
      node.attrs = node.attrs.filter(attr => {
        const name = attr.name.toLowerCase();
        if (/[<>"']/.test(name) || name.startsWith('on')) {
          mark('不安全属性');
          return false;
        }
        if (urls.has(name) || name === 'xlink:href') {
          const value = compact(attr.value);
          if (unsafeUrl.test(value) || (['src', 'poster', 'action', 'formaction'].includes(name) &&
              /^(?:https?:|[/\\]{2})/.test(value))) {
            mark('不安全 URL');
            return false;
          }
        }
        if (name === 'style') {
          const result = stripExternalCss(attr.value, notes);
          if (result.changed) {
            changed = true;
            return false;
          }
        }
        return true;
      });
      parents.push(node);
      return true;
    });
  }
  return { html: changed ? serialize(tree) : source, changed, notes };
}

export function stripExternalCss(css, notes = []) {
  const source = String(css);
  // 归一化副本仅用于判定，避免把字符串里的转义写回为 CSS 或 HTML 语法。
  const probe = source.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\\([a-f\d]{1,6})(?:\r\n|[\t\n\f\r ])?|\\(.)/gis, (_, hex, char) => {
      if (!hex) return char;
      const point = parseInt(hex, 16);
      return point && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
    });
  const external = /url\s*\(\s*['"]?\s*(?:https?:|[/\\]{2})/i;
  const forbidden = /@import|expression\s*\(|(?:-moz-binding|behavior)\s*:|<\/style\b/i;
  if (!forbidden.test(probe) && !external.test(probe) && !/<\/style\b/i.test(source)) {
    return { css: source, changed: false, notes };
  }
  if (!notes.includes('不安全 CSS')) notes.push('不安全 CSS');
  // 仅保留可独立判读的简单规则。复杂语法有风险时丢弃整块。
  let clean = '';
  if (probe === source) {
    // 只从语法完整的平面样式表恢复简单声明，避免从字符串或嵌套块截取规则。
    const flat = /\s*(?:@import\s+url\("[^"\\\r\n]*"\)\s*;|([^{}@;"'\\<>]+)\{([^{}"'\\<>]*)\})/igy;
    let pos = 0;
    while (pos < source.trimEnd().length) {
      const match = flat.exec(source);
      if (!match) { clean = ''; break; }
      pos = flat.lastIndex;
      if (match[1] && !external.test(match[0]) && !forbidden.test(match[0])) clean += match[0];
    }
  }
  return { css: clean, changed: true, notes };
}

export function assertNoDangerous(html, where) {
  const { notes } = stripDangerous(html);
  if (notes.length) throw new Error(where + '里出现了不允许的内容：' + notes.join('、'));
}
