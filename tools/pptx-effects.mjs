// PPT 阴影与线条保真：转换器会丢掉 effectRef（主题阴影），并把 lnRef 画成硬边框。
// 这里从 pptx 的 XML 里把「哪些形状有阴影、多大、多深」读出来，按几何位置回填到输出 HTML。
import JSZip from 'jszip';
import { parseFragment, serialize } from 'parse5';

const EMU = 9525; // 1px = 9525 EMU（96dpi）

function styleValue(html) {
  const match = /style="([^"]*)"/.exec(html);
  return match ? match[1] : '';
}

function pxOf(style, key) {
  const match = new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*(-?[\\d.]+)px`).exec(style);
  return match ? Number(match[1]) : null;
}

function shadowsFromTheme(themeXml) {
  const list = [];
  const styles = themeXml.match(/<a:effectStyleLst>[\s\S]*?<\/a:effectStyleLst>/)?.[0] || '';
  for (const block of styles.match(/<a:effectStyle>[\s\S]*?<\/a:effectStyle>/g) || []) {
    const shdw = /<a:outerShdw([^>]*)>([\s\S]*?)<\/a:outerShdw>/.exec(block);
    if (!shdw) { list.push(null); continue; }
    const attr = (name, fallback) => {
      const m = new RegExp(`${name}="(-?[\\d.]+)"`).exec(shdw[1]);
      return m ? Number(m[1]) : fallback;
    };
    const alpha = /<a:alpha val="(\d+)"/.exec(shdw[2]);
    list.push({
      blur: attr('blurRad', 0) / EMU,
      dist: attr('dist', 0) / EMU,
      dir: attr('dir', 0) / 60000, // 1/60000 度
      alpha: alpha ? Number(alpha[1]) / 100000 : 0.4,
    });
  }
  return list;
}

/** 每个 slide 的「有阴影的形状」几何：{left,top,width,height,shadow} */
function shapesBySlide(slideXml, effects) {
  const out = [];
  for (const sp of slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
    // 阴影可能来自主题（effectRef），也可能直接写在形状上（effectLst）
    let effect = null;
    const idx = /<a:effectRef idx="(\d+)"/.exec(sp);
    if (idx && Number(idx[1]) > 0) effect = effects[Number(idx[1]) - 1] || null;
    if (!effect) {
      const inline = /<a:outerShdw([^>]*)>([\s\S]*?)<\/a:outerShdw>/.exec(sp);
      if (inline) {
        const num = (name, fallback) => {
          const m = new RegExp(`${name}="(-?[\\d.]+)"`).exec(inline[1]);
          return m ? Number(m[1]) : fallback;
        };
        const alpha = /<a:alpha val="(\d+)"/.exec(inline[2]);
        effect = {
          blur: num('blurRad', 0) / EMU,
          dist: num('dist', 0) / EMU,
          dir: num('dir', 0) / 60000,
          alpha: alpha ? Number(alpha[1]) / 100000 : 0.35,
        };
      }
    }
    if (!effect) continue;
    const off = /<a:off x="(-?[\d.]+)" y="(-?[\d.]+)"\s*\/>/.exec(sp);
    const ext = /<a:ext cx="([\d.]+)" cy="([\d.]+)"\s*\/>/.exec(sp);
    if (!off || !ext) continue;
    // 只处理有填充的图形（卡片/色块）；纯文本框的阴影在 PowerPoint 里也看不见
    if (!/<a:solidFill>|<a:gradFill>/.test(sp)) continue;
    const width = Number(ext[1]) / EMU;
    const height = Number(ext[2]) / EMU;
    if (width * height > 1280 * 720 * 0.85) continue; // 整页底色不加阴影
    if (width < 40 || height < 40 || width > 1100 || width * height < 8000) continue; // 细线/色条/标题带不加
    out.push({
      left: Number(off[1]) / EMU,
      top: Number(off[2]) / EMU,
      width,
      height,
      shadow: effect,
    });
  }
  return out;
}

function cssShadow({ blur, dist, dir, alpha }) {
  const rad = (dir * Math.PI) / 180;
  const x = Math.sin(rad) * dist;
  const y = Math.cos(rad) * dist;
  return `${x.toFixed(1)}px ${y.toFixed(1)}px ${Math.max(1, blur).toFixed(1)}px rgba(0,0,0,${Math.min(0.6, alpha).toFixed(2)})`;
}

/** 按几何位置把阴影写回 HTML（同一位置只匹配一次） */
export function applyEffectsToHtml(html, shapes) {
  if (!shapes?.length) return { html, applied: 0 };
  const tree = parseFragment(html);
  const candidates = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.tagName) {
        const style = (child.attrs || []).find((a) => a.name === 'style')?.value || '';
        if (/position\s*:\s*absolute/i.test(style)) {
          const box = { left: pxOf(style, 'left'), top: pxOf(style, 'top'), width: pxOf(style, 'width'), height: pxOf(style, 'height') };
          if (Object.values(box).every((v) => v != null)) candidates.push({ node: child, style, box, used: false });
        }
        walk(child);
      }
    }
  };
  walk(tree);
  let applied = 0;
  for (const shape of shapes) {
    let best = null;
    let bestGap = Infinity;
    for (const cand of candidates) {
      if (cand.used) continue;
      const gap = Math.abs(cand.box.left - shape.left) + Math.abs(cand.box.top - shape.top)
        + Math.abs(cand.box.width - shape.width) + Math.abs(cand.box.height - shape.height);
      if (gap < bestGap && gap <= 6) { best = cand; bestGap = gap; }
    }
    if (!best) continue;
    best.used = true;
    applied += 1;
    const clean = best.style
      .replace(/(-?[a-z-]*border(?:-[a-z]+)?)\s*:[^;]*;?/gi, '') // 转换器用 lnRef 加的硬边框，PowerPoint 里看不到
      .replace(/box-shadow\s*:[^;]*;?/gi, '');
    const attr = best.node.attrs.find((a) => a.name === 'style');
    attr.value = `${clean.replace(/;+\s*$/, '')};box-shadow:${cssShadow(shape.shadow)};`;
  }
  return { html: applied ? serialize(tree) : html, applied };
}

/** 读取 pptx：返回按页顺序的阴影几何数组 */
export async function readPptxEffects(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const themeFile = Object.keys(zip.files).find((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name));
  if (!themeFile) return [];
  const effects = shadowsFromTheme(await zip.file(themeFile).async('string'));
  if (!effects.some(Boolean)) return [];
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const out = [];
  for (const name of slides) out.push(shapesBySlide(await zip.file(name).async('string'), effects));
  return out;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/** 形状的「图片填充」（p:sp + blipFill）：转换器会丢掉图片，只留一个纯色块 */
export async function readPictureFills(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const out = [];
  for (const name of slides) {
    const xml = await zip.file(name).async('string');
    const relFile = name.replace('slides/', 'slides/_rels/') + '.rels';
    const rels = {};
    if (zip.file(relFile)) {
      const relXml = await zip.file(relFile).async('string');
      for (const rel of relXml.match(/<Relationship\b[^>]*>/g) || []) {
        const id = /Id="([^"]+)"/.exec(rel);
        const target = /Target="([^"]+)"/.exec(rel);
        if (id && target) rels[id[1]] = target[1].replace(/^\.\//, '');
      }
    }
    const fills = [];
    for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
      const blip = /<a:blip[^>]*r:embed="([^"]+)"/.exec(sp);
      if (!blip) continue;
      const off = /<a:off x="(-?[\d.]+)" y="(-?[\d.]+)"\s*\/>/.exec(sp);
      const ext = /<a:ext cx="([\d.]+)" cy="([\d.]+)"\s*\/>/.exec(sp);
      if (!off || !ext) continue;
      const target = rels[blip[1]];
      if (!target) continue;
      const mediaName = 'ppt/' + target.replace(/^\.\.\//, '');
      if (!zip.file(mediaName)) continue;
      const extName = mediaName.split('.').pop().toLowerCase();
      const mime = MIME[extName];
      if (!mime) continue;
      const bytes = await zip.file(mediaName).async('base64');
      const soft = /<a:softEdge rad="([\d.]+)"/.exec(sp);
      const alphaFix = /<a:alphaModFix amt="(\d+)"/.exec(sp);
      fills.push({
        left: Number(off[1]) / EMU,
        top: Number(off[2]) / EMU,
        width: Number(ext[1]) / EMU,
        height: Number(ext[2]) / EMU,
        softEdge: soft ? Number(soft[1]) / EMU : 0,
        alpha: alphaFix ? Number(alphaFix[1]) / 100000 : 1,
        dataUri: `data:${mime};base64,${bytes}`,
      });
    }
    out.push(fills);
  }
  return out;
}

/** 把图片填充贴回对应几何位置的 div */
export function applyPictureFills(html, fills) {
  if (!fills?.length) return { html, applied: 0 };
  const tree = parseFragment(html);
  const candidates = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.tagName) {
        const styleAttr = (child.attrs || []).find((a) => a.name === 'style');
        const style = styleAttr?.value || '';
        if (/position\s*:\s*absolute/i.test(style)) {
          const box = { left: pxOf(style, 'left'), top: pxOf(style, 'top'), width: pxOf(style, 'width'), height: pxOf(style, 'height') };
          if (Object.values(box).every((v) => v != null)) candidates.push({ node: child, styleAttr, box, used: false });
        }
        walk(child);
      }
    }
  };
  walk(tree);
  let applied = 0;
  for (const fill of fills) {
    let best = null;
    let bestGap = Infinity;
    for (const cand of candidates) {
      if (cand.used) continue;
      const gap = Math.abs(cand.box.left - fill.left) + Math.abs(cand.box.top - fill.top)
        + Math.abs(cand.box.width - fill.width) + Math.abs(cand.box.height - fill.height);
      if (gap < bestGap && gap <= 6) { best = cand; bestGap = gap; }
    }
    if (!best) continue;
    best.used = true;
    applied += 1;
    const clean = best.styleAttr.value
      .replace(/(-?[a-z-]*border(?:-[a-z]+)?)\s*:[^;]*;?/gi, '')
      .replace(/background-color\s*:[^;]*;?/gi, '')
      .replace(/background-image\s*:[^;]*;?/gi, '')
      .replace(/background\s*:[^;]*;?/gi, '');
    const alphaCss = Number.isFinite(fill.alpha) && fill.alpha > 0 && fill.alpha < 1 ? `opacity:${fill.alpha};` : '';
    const maskCss = fill.softEdge ? maskStyle(fill.softEdge, fill.width, fill.height) : '';
    best.styleAttr.value = `${clean.replace(/;+\s*$/, '')};background-image:url("${fill.dataUri}");background-size:cover;background-position:center;background-color:transparent;${alphaCss}${maskCss}`;
  }
  return { html: applied ? serialize(tree) : html, applied };
}
/** PowerPoint 柔化边缘 → SVG 遮罩：按图片框尺寸羽化四边 */
function maskStyle(radius, width, height) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const r = Math.max(1, Math.min(radius, w / 2, h / 2));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w.toFixed(1)} ${h.toFixed(1)}' preserveAspectRatio='none'><defs><filter id='f' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='${(r / 2).toFixed(1)}'/></filter></defs><rect x='${r.toFixed(1)}' y='${r.toFixed(1)}' width='${Math.max(1, w - 2 * r).toFixed(1)}' height='${Math.max(1, h - 2 * r).toFixed(1)}' fill='white' filter='url(#f)'/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return `mask-image:${url};mask-size:${w.toFixed(1)}px ${h.toFixed(1)}px;mask-position:center;mask-repeat:no-repeat;-webkit-mask-image:${url};-webkit-mask-size:${w.toFixed(1)}px ${h.toFixed(1)}px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;`;
}
/** 普通插图（p:pic）的柔化边缘：按图片出现顺序记录，渲染端按 <img> 顺序对齐 */
export async function readPictureSoftEdges(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const out = [];
  for (const name of slides) {
    const xml = await zip.file(name).async('string');
    const edges = [];
    let index = 0;
    for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) || []) {
      const soft = /<a:softEdge rad="([\d.]+)"/.exec(pic);
      const alphaFix = /<a:alphaModFix amt="(\d+)"/.exec(pic);
      if (soft || alphaFix) {
        edges.push({
          index,
          radius: soft ? Number(soft[1]) / EMU : 0,
          alpha: alphaFix ? Number(alphaFix[1]) / 100000 : 1,
        });
      }
      index += 1;
    }
    out.push(edges);
  }
  return out;
}

/** 按图片顺序给 <img> 加柔化遮罩 */
export function applySoftEdges(html, edges) {
  if (!edges?.length) return { html, applied: 0 };
  const tree = parseFragment(html);
  const images = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.tagName === 'img') {
        const styleAttr = (child.attrs || []).find((a) => a.name === 'style');
        images.push({ node: child, styleAttr });
      }
      walk(child);
    }
  };
  walk(tree);
  let applied = 0;
  for (const edge of edges) {
    const image = images[edge.index];
    if (!image || !image.styleAttr) continue;
    const style = image.styleAttr.value;
    const width = pxOf(style, 'width') ?? 400;
    const height = pxOf(style, 'height') ?? 400;
    const parts = [style.replace(/;+\s*$/, '')];
    if (Number.isFinite(edge.alpha) && edge.alpha > 0 && edge.alpha < 1) parts.push(`opacity:${edge.alpha}`);
    if (edge.radius > 0) parts.push(maskStyle(edge.radius, width, height));
    image.styleAttr.value = parts.filter(Boolean).join(';') + ';';
    applied += 1;
  }
  return { html: applied ? serialize(tree) : html, applied };
}

const THEME_COLOR = { accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6' };

async function themePalette(zip) {
  const out = { ...THEME_COLOR };
  const file = Object.keys(zip.files).find((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name));
  if (!file) return out;
  const xml = await zip.file(file).async('string');
  const scheme = /<a:clrScheme[^>]*>[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] || '';
  for (const name of Object.keys(THEME_COLOR)) {
    const block = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(scheme);
    const hex = block && /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(block[1]);
    if (hex) out[name] = hex[1];
  }
  return out;
}

/** 形状的渐变填充（gradFill）：转换器会丢掉，只剩一个空块 */
export async function readGradientFills(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const palette = await themePalette(zip);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const out = [];
  for (const name of slides) {
    const xml = await zip.file(name).async('string');
    const fills = [];
    for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
      const grad = /<a:gradFill[\s\S]*?<\/a:gradFill>/.exec(sp);
      if (!grad) continue;
      const off = /<a:off x="(-?[\d.]+)" y="(-?[\d.]+)"\s*\/>/.exec(sp);
      const ext = /<a:ext cx="([\d.]+)" cy="([\d.]+)"\s*\/>/.exec(sp);
      if (!off || !ext) continue;
      const stops = [];
      for (const gs of grad[0].match(/<a:gs pos="(\d+)">([\s\S]*?)<\/a:gs>/g) || []) {
        const pos = Number(/pos="(\d+)"/.exec(gs)[1]) / 1000;
        const srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(gs);
        const scheme = /<a:schemeClr val="([^"]+)"/.exec(gs);
        const mod = /<a:lumMod val="(\d+)"/.exec(gs);
        let color = srgb ? '#' + srgb[1] : scheme ? '#' + (palette[scheme[1]] || '000000') : null;
        if (!color) continue;
        if (mod) color = shade(color, Number(mod[1]) / 100000);
        stops.push({ pos, color });
      }
      if (stops.length < 2) continue;
      const ang = /<a:lin ang="(-?\d+)"/.exec(grad[0]);
      const rot = /<a:path path="([^"]+)"/.exec(grad[0]);
      fills.push({
        left: Number(off[1]) / EMU,
        top: Number(off[2]) / EMU,
        width: Number(ext[1]) / EMU,
        height: Number(ext[2]) / EMU,
        stops,
        angle: ang ? Number(ang[1]) / 60000 : 90,
        radial: Boolean(rot),
      });
    }
    // 组合形状的渐变：p:grpSpPr 上的填充作用于整组
    for (const grp of xml.match(/<p:grpSp>[\s\S]*?<\/p:grpSpPr>/g) || []) {
      const grad = /<a:gradFill[\s\S]*?<\/a:gradFill>/.exec(grp);
      if (!grad) continue;
      const xfrm = /<p:grpSpPr>[\s\S]*?<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(grp);
      if (!xfrm) continue;
      const off = /<a:off x="(-?[\d.]+)" y="(-?[\d.]+)"\s*\/>/.exec(xfrm[1]);
      const ext = /<a:ext cx="([\d.]+)" cy="([\d.]+)"\s*\/>/.exec(xfrm[1]);
      if (!off || !ext) continue;
      const stops = [];
      for (const gs of grad[0].match(/<a:gs pos="(\d+)">([\s\S]*?)<\/a:gs>/g) || []) {
        const pos = Number(/pos="(\d+)"/.exec(gs)[1]) / 1000;
        const srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(gs);
        const scheme = /<a:schemeClr val="([^"]+)"/.exec(gs);
        if (srgb) stops.push({ pos, color: '#' + srgb[1] });
        else if (scheme) stops.push({ pos, color: '#' + (palette[scheme[1]] || '000000') });
      }
      if (stops.length < 2) continue;
      const ang = /<a:lin ang="(-?\d+)"/.exec(grad[0]);
      fills.push({
        left: Number(off[1]) / EMU,
        top: Number(off[2]) / EMU,
        width: Number(ext[1]) / EMU,
        height: Number(ext[2]) / EMU,
        stops,
        angle: ang ? Number(ang[1]) / 60000 : 90,
        radial: false,
        group: true,
      });
    }
    out.push(fills);
  }
  return out;
}

function shade(hex, factor) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** 把渐变写回对应几何位置的 div */
export function applyGradientFills(html, fills) {
  if (!fills?.length) return { html, applied: 0 };
  const tree = parseFragment(html);
  const candidates = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.tagName) {
        const styleAttr = (child.attrs || []).find((a) => a.name === 'style');
        const style = styleAttr?.value || '';
        if (/position\s*:\s*absolute/i.test(style)) {
          const box = { left: pxOf(style, 'left'), top: pxOf(style, 'top'), width: pxOf(style, 'width'), height: pxOf(style, 'height') };
          if (Object.values(box).every((v) => v != null)) candidates.push({ node: child, styleAttr, box, used: false });
        }
        walk(child);
      }
    }
  };
  walk(tree);
  let applied = 0;
  const overlays = [];
  for (const fill of fills) {
    if (fill.group) {
      const { left: L, top: T, width: W, height: H } = fill;
      for (const cand of candidates) {
        const inside = cand.box.left >= L - 2 && cand.box.top >= T - 2
          && cand.box.left + cand.box.width <= L + W + 2 && cand.box.top + cand.box.height <= T + H + 2;
        if (!inside) continue;
        const style = cand.styleAttr.value;
        if (/background-color:\s*(#fff|rgb\(255,\s*255,\s*255\)|transparent)/i.test(style)) {
          cand.styleAttr.value = style.replace(/background-color\s*:[^;]*;?/gi, 'background-color:transparent;');
        }
      }
      const stops = fill.stops.map((s) => `${s.color} ${s.pos}%`).join(', ');
      const css = `linear-gradient(${Math.round((fill.angle + 90) % 360)}deg, ${stops})`;
      overlays.push(`<div style="position:absolute;left:${L}px;top:${T}px;width:${W}px;height:${H}px;z-index:1;background-image:${css};background-color:transparent;"></div>`);
      applied += 1;
      continue;
    }
    let best = null;
    let bestGap = Infinity;
    for (const cand of candidates) {
      if (cand.used) continue;
      const gap = Math.abs(cand.box.left - fill.left) + Math.abs(cand.box.top - fill.top)
        + Math.abs(cand.box.width - fill.width) + Math.abs(cand.box.height - fill.height);
      if (gap < bestGap && gap <= 8) { best = cand; bestGap = gap; }
    }
    if (!best) continue;
    best.used = true;
    applied += 1;
    const stops = fill.stops.map((s) => `${s.color} ${s.pos}%`).join(', ');
    const css = fill.radial
      ? `radial-gradient(circle, ${stops})`
      : `linear-gradient(${Math.round((fill.angle + 90) % 360)}deg, ${stops})`;
    const clean = best.styleAttr.value
      .replace(/background-color\s*:[^;]*;?/gi, '')
      .replace(/background-image\s*:[^;]*;?/gi, '')
      .replace(/background\s*:[^;]*;?/gi, '');
    best.styleAttr.value = `${clean.replace(/;+\s*$/, '')};background-image:${css};background-color:transparent;`;
  }
  let out = applied ? serialize(tree) : html;
  if (overlays.length) out = out.replace(/(<div class="pptx-slide"[^>]*>)/, (match) => match + overlays.join(""));
  return { html: out, applied };
}
/** 半透明纯色填充（白面板/遮罩）：转换器会丢掉 alpha */
export async function readSolidFills(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const palette = await themePalette(zip);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const out = [];
  for (const name of slides) {
    const xml = await zip.file(name).async('string');
    const fills = [];
    for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
      const solid = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(sp);
      if (!solid) continue;
      const alpha = /<a:alpha val="(\d+)"/.exec(solid[1]);
      if (!alpha) continue;
      const a = Number(alpha[1]) / 100000;
      if (a >= 0.99 || a <= 0.01) continue;
      const off = /<a:off x="(-?[\d.]+)" y="(-?[\d.]+)"\s*\/>/.exec(sp);
      const ext = /<a:ext cx="([\d.]+)" cy="([\d.]+)"\s*\/>/.exec(sp);
      if (!off || !ext) continue;
      const srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(solid[1]);
      const scheme = /<a:schemeClr val="([^"]+)"/.exec(solid[1]);
      const color = srgb ? '#' + srgb[1] : scheme ? '#' + (palette[scheme[1]] || 'FFFFFF') : null;
      if (!color) continue;
      fills.push({
        left: Number(off[1]) / EMU,
        top: Number(off[2]) / EMU,
        width: Number(ext[1]) / EMU,
        height: Number(ext[2]) / EMU,
        color,
        alpha: a,
      });
    }
    out.push(fills);
  }
  return out;
}

/** 把半透明纯色写回对应几何位置的 div */
export function applySolidFills(html, fills) {
  if (!fills?.length) return { html, applied: 0 };
  const tree = parseFragment(html);
  const candidates = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.tagName) {
        const styleAttr = (child.attrs || []).find((a) => a.name === 'style');
        const style = styleAttr?.value || '';
        if (/position\s*:\s*absolute/i.test(style)) {
          const box = { left: pxOf(style, 'left'), top: pxOf(style, 'top'), width: pxOf(style, 'width'), height: pxOf(style, 'height') };
          if (Object.values(box).every((v) => v != null)) candidates.push({ node: child, styleAttr, box, used: false });
        }
        walk(child);
      }
    }
  };
  walk(tree);
  let applied = 0;
  for (const fill of fills) {
    let best = null;
    let bestGap = Infinity;
    for (const cand of candidates) {
      if (cand.used) continue;
      const gap = Math.abs(cand.box.left - fill.left) + Math.abs(cand.box.top - fill.top)
        + Math.abs(cand.box.width - fill.width) + Math.abs(cand.box.height - fill.height);
      if (gap < bestGap && gap <= 8) { best = cand; bestGap = gap; }
    }
    if (!best) continue;
    best.used = true;
    applied += 1;
    const n = Number.parseInt(fill.color.slice(1), 16);
    const rgba = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${fill.alpha})`;
    const style = best.styleAttr.value.replace(/background-color\s*:[^;]*;?/gi, '');
    best.styleAttr.value = `${style.replace(/;+\s*$/, '')};background-color:${rgba};`;
  }
  return { html: applied ? serialize(tree) : html, applied };
}