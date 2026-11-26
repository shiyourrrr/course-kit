import { createHash } from 'node:crypto';

const CSS_DATA_URL_RE = /url\(\s*(?:(['"])(data:[^'")\s]+)\1|&quot;(data:[^&\s]+)&quot;|(data:[^'")\s&]+))\s*\)/gi;
const IMG_DATA_SRC_RE = /<img\b([^>]*?)\bsrc=(["'])(data:image\/[^"']+)\2([^>]*)>/gi;

const shortHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 8);

/**
 * 单文件 HTML 内联资源去重（仅针对总出现次数 ≥ 2 的资源，零重复时输出原样不变，守住既有 SHA-256 基线）：
 * 1. 纯 CSS 内部重复的 `url(data:...)`（含单双引号、`&quot;`、无引号及 background/mask-image 等属性）
 *    提取为 `:root { --ck-a-<hash>: url("data:..."); }`，原位置替换为 `var(--ck-a-<hash>)`。
 * 2. 重复的 `<img src="data:image/...">`（排除正文插图 `.figure-img` 以免改动既有示例基线），
 *    以及同时在 `<img src>` 与 CSS `url()` 各出现一次的跨载体重复资源：
 *    首次 `<img src>` 保留原始载荷并标记 `data-ck-def`，其余 `<img src>` 改为 `data-ck-ref`，
 *    跨载体的 CSS `url()` 替换为 `var(--ck-a-<hash>)` 并由首帧同步脚本从 `data-ck-def` 注入变量。
 */
export function deduplicateAssets(sections, pageStyles = []) {
  const cssCounts = new Map();
  const scanCss = (text) => {
    for (const m of text.matchAll(CSS_DATA_URL_RE)) {
      const uri = m[2] || m[3] || m[4];
      if (uri && uri.length >= 256) cssCounts.set(uri, (cssCounts.get(uri) || 0) + 1);
    }
  };
  sections.forEach(scanCss);
  pageStyles.forEach(scanCss);

  const imgCounts = new Map();
  for (const section of sections) {
    for (const m of section.matchAll(IMG_DATA_SRC_RE)) {
      const [full, , , uri] = m;
      if (uri.length < 512 || /\bfigure-img\b/.test(full)) continue;
      imgCounts.set(uri, (imgCounts.get(uri) || 0) + 1);
    }
  }

  // Cross-carrier duplicates: present in BOTH <img src> and CSS url()
  const crossShared = new Set();
  for (const uri of cssCounts.keys()) {
    if (imgCounts.has(uri)) crossShared.add(uri);
  }

  const cssVars = new Map();
  const staticCssVars = new Map();
  for (const [uri, count] of cssCounts) {
    if (crossShared.has(uri)) {
      cssVars.set(uri, `--ck-a-${shortHash(uri)}`);
    } else if (count >= 2) {
      const name = `--ck-a-${shortHash(uri)}`;
      cssVars.set(uri, name);
      staticCssVars.set(uri, name);
    }
  }

  const replaceCssUrls = (text) => {
    if (!cssVars.size) return text;
    return text.replace(CSS_DATA_URL_RE, (match, _q, u1, u2, u3) => {
      const uri = u1 || u2 || u3;
      const varName = cssVars.get(uri);
      return varName ? `var(${varName})` : match;
    });
  };

  let nextSections = cssVars.size ? sections.map(replaceCssUrls) : sections.slice();
  const nextPageStyles = cssVars.size ? pageStyles.map(replaceCssUrls) : pageStyles.slice();

  const imgDefs = new Map();
  for (const [uri, count] of imgCounts) {
    if (count >= 2 || crossShared.has(uri)) {
      imgDefs.set(uri, `ck-i-${shortHash(uri)}`);
    }
  }

  const emittedDefs = new Set();
  let refCount = 0;
  let crossCount = 0;
  if (imgDefs.size) {
    nextSections = nextSections.map((section) =>
      section.replace(IMG_DATA_SRC_RE, (full, before, quote, uri, after) => {
        const defId = imgDefs.get(uri);
        if (!defId || /\bfigure-img\b/.test(full)) return full;
        if (!emittedDefs.has(defId)) {
          emittedDefs.add(defId);
          const cssVar = crossShared.has(uri) ? cssVars.get(uri) : '';
          if (cssVar) crossCount += 1;
          const cssAttr = cssVar ? ` data-ck-css="${cssVar}"` : '';
          return `<img data-ck-def="${defId}"${cssAttr}${before}src=${quote}${uri}${quote}${after}>`;
        }
        refCount += 1;
        return `<img data-ck-ref="${defId}"${before}${after}>`;
      })
    );
  }

  const cssRule = staticCssVars.size
    ? `:root {\n${[...staticCssVars.entries()].map(([uri, name]) => `  ${name}: url("${uri}");`).join('\n')}\n}`
    : '';

  const scripts = [];
  if (crossCount > 0) {
    scripts.push('document.querySelectorAll("img[data-ck-css]").forEach(function(e){document.documentElement.style.setProperty(e.dataset.ckCss,\'url("\'+e.src+\'")\');});');
  }
  if (refCount > 0) {
    scripts.push('document.querySelectorAll("img[data-ck-ref]").forEach(function(e){var s=document.querySelector(\'img[data-ck-def="\'+e.dataset.ckRef+\'"]\');if(s)e.src=s.src;});');
  }

  return {
    sections: nextSections,
    pageStyles: nextPageStyles,
    cssRule,
    bootScript: scripts.join(''),
    dedupedCssCount: cssVars.size,
    dedupedImgCount: refCount,
  };
}
