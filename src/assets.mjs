/**
 * 静态资源：KaTeX 样式 + 字体内联
 * 渲染器和题单生成器共用，避免各写一遍把字体逻辑写歪。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const KATEX_DIST = path.join(ROOT, 'node_modules', 'katex', 'dist');

const cache = new Map();

/** KaTeX CSS：只保留 woff2（woff/ttf 会让体积翻倍），并把字体转成 base64 */
export function katexCss() {
  if (cache.has('katex')) return cache.get('katex');
  let css = fs.readFileSync(path.join(KATEX_DIST, 'katex.min.css'), 'utf8');
  css = css.replace(/src:([^;{}]+)([;}])/g, (_, body, delim) => {
    const keep = String(body).split(',').filter((part) => part.includes('.woff2'));
    const value = keep.length ? keep.join(',') : body;
    return `src:${value};${delim === '}' ? '}' : ''}`;
  });
  css = css.replace(/url\((?:\.\/)?fonts\/([^)]+?\.woff2)\)/g, (_, file) => {
    const buf = fs.readFileSync(path.join(KATEX_DIST, 'fonts', file));
    return `url(data:font/woff2;base64,${buf.toString('base64')})`;
  });
  cache.set('katex', css);
  return css;
}
