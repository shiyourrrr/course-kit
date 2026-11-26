#!/usr/bin/env node
/**
 * 同构页检测（保守版）：找出"结构相同、只有条目数量不同"的页，并给出可承载条数。
 *
 *   node tools/layout-clusters.mjs packs/user-template-xxx
 *
 * 判据：
 *  1. 条目组：任一容器下 ≥2 个兄弟，子树形状相同、同一行/列、等宽等距（容差 2px）
 *  2. 骨干签名：条目组折叠成 ITEMGROUP[轴|单条尺寸|间距]，**条数与整组跨度不进签名**
 *  3. 同构 = 骨干签名完全一致；两页只在条目数上不同也算同构
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';

const dir = process.argv[2];
if (!dir) { console.error('用法：node tools/layout-clusters.mjs <模板包目录>'); process.exit(1); }
const TOL = 2;

const attrs = (n) => Object.fromEntries((n.attrs || []).map((a) => [a.name, a.value]));
const kids = (n) => (n.childNodes || []).filter((c) => c.tagName);
const textOf = (n) => (n.nodeName === '#text' ? n.value : (n.childNodes || []).map(textOf).join(''));
const num = (style, k) => {
  const m = String(style || '').match(new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*(-?[\\d.]+)px'));
  return m ? Number(m[1]) : null;
};
const geom = (n) => {
  const s = attrs(n).style || '';
  const g = { left: num(s, 'left'), top: num(s, 'top'), width: num(s, 'width'), height: num(s, 'height') };
  return Object.values(g).every((v) => v === null) ? null : g;
};
const clsOf = (n) => (attrs(n).class || '').split(/\s+/).filter(Boolean).sort().join('.');
const hasMedia = (n) => /img|svg|picture/i.test(n.tagName || '') || kids(n).some((c) => /img|svg/i.test(c.tagName || ''));

function shapeSig(n, depth = 0) {
  if (depth > 9) return '…';
  const child = kids(n);
  const sigs = child.map((c) => shapeSig(c, depth + 1));
  const counts = new Map();
  for (const s of sigs) counts.set(s, (counts.get(s) || 0) + 1);
  const body = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([s, k]) => (k >= 2 ? `rep(${s})` : s)).join(',');
  return `${n.tagName}|${clsOf(n)}|${hasMedia(n) ? 'm' : '-'}{${body}}`;
}

/** 在给定的子节点集合里找出"等宽等距、同一行/列"的同形兄弟组 */
function groupsAmong(children) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < children.length; i++) {
    if (used.has(i)) continue;
    const base = children[i];
    const g0 = geom(base);
    if (!g0) continue;
    const sig = shapeSig(base);
    const members = [i];
    for (let j = i + 1; j < children.length; j++) {
      if (used.has(j)) continue;
      const g = geom(children[j]);
      if (!g || shapeSig(children[j]) !== sig) continue;
      if (Math.abs((g.width ?? 0) - (g0.width ?? 0)) > TOL) continue;
      if (Math.abs((g.height ?? 0) - (g0.height ?? 0)) > TOL) continue;
      const prev = geom(children[members[members.length - 1]]);
      const sameRow = Math.abs((g.top ?? 0) - (prev.top ?? 0)) <= TOL && (g.left ?? 0) > (prev.left ?? 0);
      const sameCol = Math.abs((g.left ?? 0) - (prev.left ?? 0)) <= TOL && (g.top ?? 0) > (prev.top ?? 0);
      if (sameRow || sameCol) members.push(j);
    }
    if (members.length >= 2) {
      members.forEach((k) => used.add(k));
      const gs = members.map((k) => geom(children[k]));
      const axis = Math.abs((gs[1].top ?? 0) - (gs[0].top ?? 0)) <= TOL ? 'row' : 'col';
      const sorted = [...gs].sort((a, b) => (axis === 'row' ? a.left - b.left : a.top - b.top));
      const gaps = [];
      for (let k = 1; k < sorted.length; k++) {
        gaps.push(axis === 'row'
          ? sorted[k].left - (sorted[k - 1].left + (sorted[k - 1].width ?? 0))
          : sorted[k].top - (sorted[k - 1].top + (sorted[k - 1].height ?? 0)));
      }
      const gap = Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length);
      const span = axis === 'row'
        ? Math.max(...gs.map((g) => g.left + (g.width ?? 0))) - Math.min(...gs.map((g) => g.left))
        : Math.max(...gs.map((g) => g.top + (g.height ?? 0))) - Math.min(...gs.map((g) => g.top));
      out.push({ members, count: members.length, axis, itemW: Math.round(gs[0].width ?? 0), itemH: Math.round(gs[0].height ?? 0), gap, span: Math.round(span), startLeft: Math.round(Math.min(...gs.map((g) => g.left))), startTop: Math.round(Math.min(...gs.map((g) => g.top))) });
    }
  }
  return out;
}

function collectGroups(n, out = []) {
  const g = groupsAmong(kids(n));
  if (g.length) out.push(...g);
  kids(n).forEach((c) => collectGroups(c, out));
  return out;
}

function skeleton(n, depth = 0) {
  if (depth > 9) return '…';
  const child = kids(n);
  const groups = groupsAmong(child);
  const consumed = new Set();
  const marks = [];
  for (const g of groups) {
    g.members.forEach((i) => consumed.add(i));
    // 单条尺寸与间距是版式常量；条数与整组跨度随内容变，绝不进签名
    marks.push(`ITEMGROUP[${g.axis}|${g.itemW}x${g.itemH}|gap${g.gap}|at${g.startLeft},${g.startTop}]`);
  }
  const rest = [];
  child.forEach((c, i) => { if (!consumed.has(i)) rest.push(skeleton(c, depth + 1) + '@' + (geom(c) ? JSON.stringify(geom(c)) : '-')); });
  rest.sort();
  return `${n.tagName}|${clsOf(n)}{${marks.sort().join(',')}+${rest.join(',')}}`;
}

const layoutsDir = path.join(dir, 'layouts');
const files = fs.readdirSync(layoutsDir).filter((f) => f.endsWith('.html'))
  .sort((a, b) => Number((a.match(/(\d+)/) || [])[1]) - Number((b.match(/(\d+)/) || [])[1]));

const pages = files.map((file) => {
  const doc = parse(fs.readFileSync(path.join(layoutsDir, file), 'utf8'));
  const body = doc.childNodes.find((n) => n.tagName === 'html')?.childNodes.find((n) => n.tagName === 'body');
  const root = kids(body)[0] || body;
  return { file, no: (file.match(/(\d+)/) || [])[1], skeleton: skeleton(root), groups: collectGroups(root), text: textOf(root).replace(/\s+/g, ' ').trim().slice(0, 36) };
});

const bySkeleton = new Map();
for (const p of pages) {
  if (!bySkeleton.has(p.skeleton)) bySkeleton.set(p.skeleton, []);
  bySkeleton.get(p.skeleton).push(p);
}
console.log(`模板：${path.basename(dir)} · ${pages.length} 页 · 容差 ${TOL}px\n`);
const clusters = [...bySkeleton.values()].filter((l) => l.length >= 2);
if (!clusters.length) console.log('没有发现同构页。\n');
clusters.forEach((list, i) => {
  const counts = list.map((p) => p.groups.reduce((s, g) => s + g.count, 0));
  const g = [...list[0].groups].sort((a, b) => b.count - a.count)[0];
  console.log(`簇 ${i + 1}：${list.length} 页 —— 第 ${list.map((p) => p.no).join('、')} 页（条目数 ${counts.join(' / ')}）`);
  if (g) {
    const maxItems = Math.max(1, Math.floor((g.span + g.gap) / (g.itemW + g.gap)));
    console.log(`  条目组：${g.axis === 'row' ? '横向' : '纵向'} · 单条 ${g.itemW}×${g.itemH}px · 间距 ${g.gap}px · 最宽组跨 ${g.span}px`);
    console.log(`  → 合并后至少能承载 1~${Math.max(maxItems, ...counts)} 条（多出来按可用宽度重排，超了提示拆页）`);
  } else {
    console.log('  同构但没有并列条目（可共用版式，不能加项）');
  }
  console.log('  摘要：' + list.map((p) => p.text.slice(0, 18)).join(' / '));
  console.log('');
});
const single = pages.filter((p) => !clusters.some((l) => l.includes(p)));
console.log('单页：第 ' + (single.map((p) => p.no).join('、') || '(无)') + ' 页');
