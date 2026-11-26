// 页面元素级「点一下出现」：按 DOM 路径给任意元素加 data-build
// 路径格式：由元素节点序号组成的数组，如 [2, 0] = 第 3 个元素里的第 1 个元素
import { parseFragment, serialize } from 'parse5';
import { blockFingerprint, blockKind, validTweak } from '../app/block-rules.mjs';

function elementChildren(node) {
  return (node.childNodes || []).filter((child) => child.tagName);
}

function resolvePath(root, path) {
  let node = root;
  for (const index of path) {
    node = elementChildren(node)[index];
    if (!node) return null;
  }
  return node;
}

export function applyBlockTweaks(html, tweaks, onSkip) {
  if (!Array.isArray(tweaks) || !tweaks.length) return html;
  const tree = parseFragment(html);
  let changed = false;
  for (const tweak of tweaks) {
    if (!validTweak(tweak)) continue;
    const {path, kind, dx = 0, dy = 0, widthStep = 0, widthPx, heightPx, hidden, fontSize, color, align, zIndex} = tweak;
    const node = resolvePath(tree, path);
    if (!node || blockKind(node) !== kind || (tweak.targetKey && blockFingerprint(node) !== tweak.targetKey)) {
      onSkip?.(tweak);
      continue;
    }
    if (!dx && !dy && !widthStep && !widthPx && !heightPx && !hidden && fontSize === undefined && !color && !align && !zIndex) continue;
    if (hidden) node.attrs.push({name:'data-ck-hidden', value:''});
    let variables = '';
    if (dx || dy) {
      node.attrs.push({name:'data-ck-move', value:''});
      variables += `;--ck-dx:${dx}px;--ck-dy:${dy}px`;
    }
    if (widthStep) node.attrs.push({name:'data-ck-width',value:String(widthStep)});
    if (widthPx) {
      node.attrs.push({name:'data-ck-w', value:''});
      variables += `;--ck-w:${widthPx}px`;
    }
    if (heightPx) {
      node.attrs.push({name:'data-ck-h', value:''});
      variables += `;--ck-h:${heightPx}px`;
    }
    if (fontSize !== undefined) variables += `;font-size:${fontSize}px !important`;
    if (color) variables += `;color:${color} !important`;
    if (align) variables += `;text-align:${align} !important`;
    if (zIndex) {
      const existingStyle = node.attrs.find(attr => attr.name === 'style')?.value || '';
      if (!/\bposition\s*:/i.test(existingStyle)) variables += ';position:relative';
      variables += `;z-index:${zIndex} !important`;
    }
    if (variables) {
      let style = node.attrs.find(attr => attr.name === 'style');
      if (!style) node.attrs.push(style = {name:'style', value:''});
      style.value += variables;
    }
    changed = true;
  }
  return changed ? serialize(tree) : html;
}

/** 找出可以单独设置「第几次出现」的元素：顶层元素 + 容器里的直接子元素 */
export function listBlocks(fragmentHtml, maxDepth = 3) {
  const tree = parseFragment(fragmentHtml);
  const out = [];
  const containerRe = /(^|\s)(body|grid|notes|steps|cols|cards|points|tasks)(\s|$)/;
  const walk = (parent, path, depth) => {
    elementChildren(parent).forEach((child, index) => {
      const here = [...path, index];
      const cls = (child.attrs || []).find((a) => a.name === 'class')?.value || '';
      const text = textOf(child).replace(/\s+/g, ' ').trim();
      if (text || /img|figure/.test(child.tagName)) {
        out.push({ path: here, tag: child.tagName, cls, text: text.slice(0, 40) });
      }
      if (depth + 1 < maxDepth && containerRe.test(cls)) {
        walk(child, here, depth + 1);
      }
    });
  };
  walk(tree, [], 0);
  return out;
}

function textOf(node) {
  if (node.nodeName === '#text' || node.nodeName === '#comment') return node.value || '';
  return (node.childNodes || []).map(textOf).join('');
}

/** 按 {path, group, anim} 列表给元素加 data-build；同组一起出现；anim 是元素级入场动效（可选） */
export function applyBuildBlocks(fragmentHtml, blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return { html: fragmentHtml, applied: 0 };
  const tree = parseFragment(fragmentHtml);
  const ANIMS = ['fade', 'blur', 'fade-up', 'fade-down', 'slide-left', 'slide-right', 'scale', 'zoom', 'rotate', 'flip', 'bounce', 'none'];
  let applied = 0;
  for (const block of blocks) {
    const group = Number(block.group ?? block.g);
    const path = block.path ?? block.i;
    if (!Number.isInteger(group) || group < 1 || !Array.isArray(path)) continue;
    const node = resolvePath(tree, path);
    if (!node) continue;
    node.attrs = (node.attrs || []).filter((a) => a.name !== 'data-build');
    node.attrs.push({ name: 'data-build', value: String(group) });
    // 老师给这个元素单独选的入场动效：打 data-anim-key 标记，
    // 渲染器 applyEntrance 见到标记就不清（没选就不写，无改动时输出仍逐字节不变）
    const anim = String(block.anim || '');
    if (ANIMS.includes(anim)) {
      node.attrs = (node.attrs || []).filter((a) => a.name !== 'data-anim' && a.name !== 'data-anim-key');
      if (anim !== 'none') node.attrs.push({ name: 'data-anim', value: anim });
      node.attrs.push({ name: 'data-anim-key', value: anim });
    }
    applied += 1;
  }
  return { html: applied ? serialize(tree) : fragmentHtml, applied };
}
