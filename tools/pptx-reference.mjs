// 导入 PPT 作为「生成参照」：抽结构（每页有哪些元素、谁是标题/正文/图）、背景、配色、字体。
// 不渲染页面、不修页面——输出一份 reference.json，给生成器当参照。
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const EMU = 9525;

const hex = (n) => '#' + n.toUpperCase();
const relTarget = (target) => 'ppt/' + target.replace(/^\.\//, '').replace(/^\.\.\//, '');

async function loadZip(buffer) {
  return JSZip.loadAsync(buffer);
}

function textOf(xml) {
  return (xml.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((m) => m.slice(5, -6)).join('');
}

function themeInfo(xml) {
  const palette = {};
  const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml)?.[1] || '';
  for (const name of ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'dk1', 'dk2', 'lt1', 'lt2']) {
    const block = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(scheme);
    const srgb = block && /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(block[1]);
    const sys = block && /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(block[1]);
    if (srgb) palette[name] = hex(srgb[1]);
    else if (sys) palette[name] = hex(sys[1]);
  }
  const fonts = {
    major: /<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(xml)?.[1] || '',
    minor: /<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(xml)?.[1] || '',
  };
  return { palette, fonts };
}

function shapeText(sp) {
  const body = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(sp)?.[1] || '';
  const paragraphs = (body.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map((p) => textOf(p)).filter((t) => t.trim());
  const sizes = [...body.matchAll(/sz="(\d+)"/g)].map((m) => Number(m[1]) / 100);
  const bold = /<a:b="1"/.test(body);
  return { text: paragraphs.join('\n'), paragraphs, sizes, bold };
}

function classify(sp, kind, ctx) {
  const { text, paragraphs, sizes } = kind === 'text' ? shapeText(sp) : { text: '', paragraphs: [], sizes: [] };
  const placeholder = /<p:ph[^>]*type="([^"]+)"/.exec(sp)?.[1] || '';
  if (kind === 'picture') return { type: 'image' };
  if (placeholder === 'title' || placeholder === 'ctrTitle') return { type: 'title', text };
  if (placeholder === 'subTitle') return { type: 'lead', text };
  if (placeholder === 'body' || placeholder === 'obj') {
    if (paragraphs.length >= 3) return { type: 'bullets', text, count: paragraphs.length };
    if (text) return { type: 'text', text };
    return { type: 'shape' };
  }
  if (!text.trim()) return { type: 'shape' };
  const max = Math.max(0, ...sizes);
  if (max >= ctx.titleSize) return { type: 'title', text };
  if (max >= ctx.leadSize) return { type: 'lead', text };
  if (paragraphs.length >= 3) return { type: 'bullets', text, count: paragraphs.length };
  return { type: 'text', text };
}

function slideShapes(xml) {
  const out = [];
  for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
    const off = /<a:off x="(-?[\d.]+)" y="(-?[\d.]+)"\s*\/>/.exec(sp);
    const ext = /<a:ext cx="([\d.]+)" cy="([\d.]+)"\s*\/>/.exec(sp);
    if (!off || !ext) continue;
    const box = { x: Math.round(Number(off[1]) / EMU), y: Math.round(Number(off[2]) / EMU), w: Math.round(Number(ext[1]) / EMU), h: Math.round(Number(ext[2]) / EMU) };
    const round = /prstGeom prst="roundRect"/.test(sp);
    out.push({ kind: 'text', box, sp, round });
  }
  for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) || []) {
    const off = /<a:off x="(-?[\d.]+)" y="(-?[\d.]+)"\s*\/>/.exec(pic);
    const ext = /<a:ext cx="([\d.]+)" cy="([\d.]+)"\s*\/>/.exec(pic);
    if (!off || !ext) continue;
    out.push({ kind: 'picture', box: { x: Math.round(Number(off[1]) / EMU), y: Math.round(Number(off[2]) / EMU), w: Math.round(Number(ext[1]) / EMU), h: Math.round(Number(ext[2]) / EMU) }, sp: pic });
  }
  return out;
}

export async function analyzeReference(buffer, name) {
  const zip = await loadZip(buffer);
  const themeFile = Object.keys(zip.files).find((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n));
  const { palette, fonts } = themeInfo(themeFile ? await zip.file(themeFile).async('string') : '');

  // 背景：母版/版式优先，其次最大全屏形状
  let background = { kind: 'white' };
  const masterFile = Object.keys(zip.files).find((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n));
  const masterXml = masterFile ? await zip.file(masterFile).async('string') : '';
  const bg = /<p:bg>([\s\S]*?)<\/p:bg>/.exec(masterXml)?.[1] || '';
  const bgColor = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(bg);
  const bgImage = /<a:blip[^>]*r:embed="([^"]+)"/.exec(bg);
  if (bgImage) {
    const relsFile = masterFile.replace('slideMasters/', 'slideMasters/_rels/') + '.rels';
    const rels = await zip.file(relsFile)?.async('string') || '';
    const target = new RegExp(`Id="${bgImage[1]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
    if (target) {
      const mediaName = relTarget(target);
      if (zip.file(mediaName)) {
        const ext = mediaName.split('.').pop().toLowerCase();
        const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/png';
        const b64 = await zip.file(mediaName).async('base64');
        background = { kind: 'image', mime, base64: b64 };
      }
    }
  } else if (bgColor) {
    background = { kind: 'solid', color: hex(bgColor[1]) };
  }

  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));

  const pages = [];
  const colorCount = new Map();
  for (const [index, slideFile] of slides.entries()) {
    const xml = await zip.file(slideFile).async('string');
    const shapes = slideShapes(xml);
    // 背景候选：铺满整页的图片（p:pic 或图片填充）
    if (background.kind !== 'image' || !background.base64) {
      const full = shapes.find((shape) => shape.box.w >= 1100 && shape.box.h >= 600 && shape.kind === 'picture');
      const relsFile = slideFile.replace('slides/', 'slides/_rels/') + '.rels';
      const relsXml = await zip.file(relsFile)?.async('string') || '';
      const relEntry = (id) => {
        const m = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(relsXml);
        return m ? m[1] : '';
      };
      const embed = full ? /r:embed="([^"]+)"/.exec(full.sp)?.[1] : '';
      const target = embed ? relEntry(embed) : '';
      if (target) {
        const mediaName = relTarget(target);
        if (zip.file(mediaName)) {
          const ext = mediaName.split('.').pop().toLowerCase();
          const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/png';
          background = { kind: 'photo', mime, base64: await zip.file(mediaName).async('base64') };
        }
      }
    }
    for (const m of xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g)) colorCount.set(hex(m[1]), (colorCount.get(hex(m[1])) || 0) + 1);

    const sizes = shapes.filter((s) => s.kind === 'text').map((s) => Math.max(0, ...shapeText(s.sp).sizes));
    const titleSize = Math.max(24, ...sizes);
    const leadSize = Math.max(14, titleSize * 0.5);
    const roles = (() => {
      const raw = shapes
        .filter((shape) => shape.box.w >= 40 && shape.box.h >= 30 && shape.box.w * shape.box.h >= 2000)
        .map((shape) => ({ ...classify(shape.sp, shape.kind, { titleSize, leadSize }), box: shape.box, round: Boolean(shape.round) }))
        .filter((role) => role.type !== 'shape' || role.box.w * role.box.h >= 40000);
      const out = [];
      let leadUsed = false;
      for (const role of raw) {
        if (role.type === 'image') {
          if (role.box.w < 120) continue;      // 图标不算图
        }
        if (role.type === 'lead') {
          if (leadUsed) role.type = 'text';    // 只保留一个导语
          else leadUsed = true;
        }
        if (role.type === 'text' && !role.text?.trim()) continue;
        out.push(role);
        if (out.length >= 8) break;
      }
      return out;
    })();

    pages.push({
      index: index + 1,
      roles: roles.map((r) => ({ type: r.type, text: r.text?.slice(0, 60), box: r.box, round: r.round })),
    });
  }

  const paletteTop = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
  const summary = pages.map((p, i) => {
    const count = { title: 0, lead: 0, bullets: 0, image: 0, text: 0, shape: 0 };
    for (const r of p.roles) count[r.type] = (count[r.type] || 0) + 1;
    const parts = [];
    if (count.title) parts.push('标题');
    if (count.lead) parts.push('副标题');
    if (count.bullets) parts.push('要点列表');
    if (count.image) parts.push(`图片×${count.image}`);
    if (count.text) parts.push(`文字块×${count.text}`);
    if (count.shape >= 2) parts.push(`色块×${count.shape}`);
    return { page: i + 1, layout: parts.join(' + ') || '装饰页' };
  });

  return {
    name,
    background: background.kind === 'image' && !background.base64 ? { kind: 'photo' } : background,
    palette: paletteTop.length ? paletteTop : Object.values(palette),
    themePalette: palette,
    fonts,
    structure: pages,
    summary,
  };
}
