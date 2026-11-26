/**
 * 演示块主题变量同步模块（参考 CourseForge MIT 主题令牌契约）
 *
 * 解决 <iframe sandbox="allow-scripts" srcdoc="..."> 无法继承父文档 :root CSS 变量、
 * 导致所有演示块回退到 #0f172a 深色底而与浅色/学校主题色课件格格不入的问题。
 */

const ESC_RELAY_SCRIPT = '<script>(function(){document.addEventListener("keydown",function(e){if(e.key==="Escape"){try{parent.postMessage({ck:"widget-esc"},"*")}catch(_){}}},true)})();</script>';

function extractVar(cssText, names) {
  if (!cssText) return '';
  let found = '';
  for (const name of names) {
    const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;!}]+)`, 'gi');
    for (const m of cssText.matchAll(re)) {
      const val = m[1].trim();
      if (val && !val.startsWith('var(')) found = val;
    }
  }
  return found;
}

function parseHexRgb(color) {
  const s = String(color || '').trim();
  const m6 = /^#([0-9a-f]{6})$/i.exec(s);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m3 = /^#([0-9a-f]{3})$/i.exec(s);
  if (m3) {
    return m3[1].split('').map((c) => parseInt(c + c, 16));
  }
  return null;
}

function isDarkColor(color) {
  const rgb = parseHexRgb(color);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.42;
}

/**
 * 按样式层叠顺序（base -> pack -> theme -> deck.css）提取当前课件生效的配色令牌。
 */
export function resolveDeckThemeTokens({ packCss = '', themeCss = '', deckCss = '' } = {}) {
  const combined = [packCss, themeCss, deckCss].filter(Boolean).join('\n');
  const brand = extractVar(combined, ['--accent', '--ck-brand']) || '#17574e';
  const bg = extractVar(combined, ['--bg', '--ck-bg']) || '#ffffff';
  const dark = isDarkColor(bg);
  const text = extractVar(combined, ['--ink', '--ck-text']) || (dark ? '#f8fafc' : '#1e293b');
  const surface = extractVar(combined, ['--bg-soft', '--ck-surface'])
    || (dark ? 'rgba(255,255,255,0.07)' : `color-mix(in srgb, ${brand} 7%, ${bg})`);
  const muted = extractVar(combined, ['--ink-3', '--ink-2', '--ck-muted'])
    || (dark ? '#94a3b8' : '#64748b');
  const border = extractVar(combined, ['--line', '--ck-border'])
    || (dark ? 'rgba(255,255,255,0.16)' : `color-mix(in srgb, ${brand} 22%, ${bg})`);

  return { brand, bg, surface, text, muted, border, dark };
}

export function buildWidgetThemeStyle(tokens) {
  const t = tokens || resolveDeckThemeTokens();
  const sanitizeVal = (v) => String(v || '').replace(/[<>{};]/g, '').trim();
  return `<style id="ck-theme-vars">:root{--ck-brand:${sanitizeVal(t.brand)};--ck-bg:${sanitizeVal(t.bg)};--ck-surface:${sanitizeVal(t.surface)};--ck-text:${sanitizeVal(t.text)};--ck-muted:${sanitizeVal(t.muted)};--ck-border:${sanitizeVal(t.border)};color-scheme:${t.dark ? 'dark' : 'light'}}html,body{background:var(--ck-bg);color:var(--ck-text)}</style>`;
}

/**
 * 将当前课件的 --ck-* 主题变量与 Esc 退出全屏转发脚本一并注入演示块 HTML。
 */
export function injectWidgetThemeAndEsc(rawHtml, tokens) {
  let html = String(rawHtml || '');
  const styleTag = buildWidgetThemeStyle(tokens);

  // 移除之前可能注入的同名块，保证幂等
  html = html.replace(/<style id="ck-theme-vars">[\s\S]*?<\/style>/i, '');
  if (/<\/head\s*>/i.test(html)) {
    html = html.replace(/<\/head\s*>/i, styleTag + '</head>');
  } else if (/<body[\s>]/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<head>${styleTag}</head><body$1>`);
  } else {
    html = styleTag + html;
  }

  if (!html.includes('ck:"widget-esc"')) {
    html = /<\/body\s*>/i.test(html)
      ? html.replace(/<\/body\s*>/i, ESC_RELAY_SCRIPT + '</body>')
      : html + ESC_RELAY_SCRIPT;
  }
  return html;
}
