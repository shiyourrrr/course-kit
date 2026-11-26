import { parseFragment, serialize } from 'parse5';

const PURE_PUNCT = /^[\s·•.,，、。:：;；\-—–/\\|()（）\[\]【】★☆◆◇▶▷]+$/;
const BADGE_TEXT = /^(?:0?\d|[1-9]\d?\.?|PART\s*0?\d|SECTION\s*0?\d|[IVX]{1,4}|[A-D])$/i;

function parseCssMap(styleStr = '') {
  const map = new Map();
  for (const part of String(styleStr).split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (key && val) map.set(key, val);
  }
  return map;
}

function serializeCssMap(map) {
  return [...map.entries()].map(([k, v]) => `${k}: ${v}`).join('; ') + (map.size ? ';' : '');
}

function toPx(val, fallback = 0) {
  if (!val) return fallback;
  const m = /^(-?[\d.]+)\s*(px|pt)?$/i.exec(String(val).trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallback;
  return (m[2] || '').toLowerCase() === 'pt' ? n * (4 / 3) : n;
}

function parsePadding(map) {
  const raw = map.get('padding');
  let top = 0, right = 0, bottom = 0, left = 0;
  if (raw) {
    const nums = raw.trim().split(/\s+/).map((v) => toPx(v, 0));
    if (nums.length === 1) top = right = bottom = left = nums[0];
    else if (nums.length === 2) { top = bottom = nums[0]; right = left = nums[1]; }
    else if (nums.length === 3) { top = nums[0]; right = left = nums[1]; bottom = nums[2]; }
    else if (nums.length >= 4) [top, right, bottom, left] = nums;
  }
  if (map.has('padding-top')) top = toPx(map.get('padding-top'), top);
  if (map.has('padding-right')) right = toPx(map.get('padding-right'), right);
  if (map.has('padding-bottom')) bottom = toPx(map.get('padding-bottom'), bottom);
  if (map.has('padding-left')) left = toPx(map.get('padding-left'), left);
  return { top, right, bottom, left };
}

function getAttr(node, name) {
  return node.attrs?.find((a) => a.name === name)?.value ?? '';
}

function setAttr(node, name, value) {
  node.attrs ??= [];
  const hit = node.attrs.find((a) => a.name === name);
  if (hit) hit.value = value;
  else node.attrs.push({ name, value });
}

function hasTextDescendant(node) {
  for (const child of node.childNodes || []) {
    if (child.nodeName === '#text' && child.value.trim()) return true;
    if (child.tagName && hasTextDescendant(child)) return true;
  }
  return false;
}

/**
 * 将 .pptx-page 内跨出 1280×720 画布的出血装饰图与负边距文本框收敛进画布几何边界内，
 * 视觉上与外层 overflow:hidden 裁切完全一致，同时避免越界 DOM 元素干扰版面测量。
 */
export function normalizeBleedSlideHtml(html) {
  const tree = parseFragment(html);
  const SLIDE_W = 1280;
  const SLIDE_H = 720;

  const convertImgToClampedBgDiv = (imgNode, offsetX = 0, offsetY = 0, clipW = SLIDE_W, clipH = SLIDE_H) => {
    const src = getAttr(imgNode, 'src');
    const st = parseCssMap(getAttr(imgNode, 'style'));
    if (!src || st.get('position') !== 'absolute') return null;
    const left = toPx(st.get('left'), 0) + offsetX;
    const top = toPx(st.get('top'), 0) + offsetY;
    const width = toPx(st.get('width'), 0);
    const height = toPx(st.get('height'), 0);
    if (width <= 0 || height <= 0) return null;
    if (left >= 0 && top >= 0 && left + width <= clipW && top + height <= clipH) return null;

    const cl = Math.max(0, left);
    const ct = Math.max(0, top);
    const cr = Math.min(clipW, left + width);
    const cb = Math.min(clipH, top + height);
    if (cr <= cl || cb <= ct) {
      st.set('display', 'none');
      setAttr(imgNode, 'style', serializeCssMap(st));
      return imgNode;
    }

    const next = new Map();
    next.set('position', 'absolute');
    if (st.has('z-index')) next.set('z-index', st.get('z-index'));
    next.set('left', `${cl}px`);
    next.set('top', `${ct}px`);
    next.set('width', `${cr - cl}px`);
    next.set('height', `${cb - ct}px`);
    next.set('background-image', `url('${src}')`);
    next.set('background-size', `${width}px ${height}px`);
    next.set('background-position', `${left - cl}px ${top - ct}px`);
    next.set('background-repeat', 'no-repeat');
    for (const k of ['opacity', 'filter', 'mask-image', '-webkit-mask-image', 'transform', 'transform-origin', 'mix-blend-mode']) {
      if (st.has(k)) next.set(k, st.get(k));
    }
    return {
      nodeName: 'div',
      tagName: 'div',
      namespaceURI: imgNode.namespaceURI,
      attrs: [{ name: 'style', value: serializeCssMap(next) }],
      childNodes: [],
      parentNode: imgNode.parentNode,
    };
  };

  const walk = (parent) => {
    const kids = parent.childNodes || [];
    for (let i = 0; i < kids.length; i += 1) {
      const node = kids[i];
      if (!node.tagName) continue;
      if (node.tagName === 'img') {
        const replaced = convertImgToClampedBgDiv(node);
        if (replaced) kids[i] = replaced;
        continue;
      }
      if (node.tagName === 'div') {
        const cls = getAttr(node, 'class');
        if (!/\bpptx-(page|slide)\b/.test(cls)) {
          const st = parseCssMap(getAttr(node, 'style'));
          if (st.get('position') === 'absolute' && st.has('width') && st.has('height')) {
            const left = toPx(st.get('left'), 0);
            const top = toPx(st.get('top'), 0);
            const width = toPx(st.get('width'), 0);
            const height = toPx(st.get('height'), 0);
            const outOfBounds = left < 0 || top < 0 || left + width > SLIDE_W || top + height > SLIDE_H;
            if (outOfBounds) {
              const hasText = hasTextDescendant(node);
              const elementKids = (node.childNodes || []).filter((c) => c.tagName);
              if (!hasText && elementKids.length === 1 && elementKids[0].tagName === 'img') {
                const cl = Math.max(0, left);
                const ct = Math.max(0, top);
                const cr = Math.min(SLIDE_W, left + width);
                const cb = Math.min(SLIDE_H, top + height);
                if (cr > cl && cb > ct) {
                  st.set('left', `${cl}px`);
                  st.set('top', `${ct}px`);
                  st.set('width', `${cr - cl}px`);
                  st.set('height', `${cb - ct}px`);
                  setAttr(node, 'style', serializeCssMap(st));
                  const childReplaced = convertImgToClampedBgDiv(elementKids[0], left - cl, top - ct, cr - cl, cb - ct);
                  if (childReplaced) {
                    const idx = node.childNodes.indexOf(elementKids[0]);
                    node.childNodes[idx] = childReplaced;
                  }
                  continue;
                }
              } else if (hasText && !st.has('transform')) {
                let nl = left, nw = width, nt = top, nh = height;
                if (nl < 0) {
                  if (st.get('text-align') === 'center') nw = Math.max(40, nw + nl * 2);
                  else nw = Math.max(40, nw + nl);
                  nl = 0;
                }
                if (nl + nw > SLIDE_W) nw = Math.max(40, SLIDE_W - nl);
                if (nt < 0) { nh = Math.max(24, nh + nt); nt = 0; }
                if (nt + nh > SLIDE_H) nh = Math.max(24, SLIDE_H - nt);
                st.set('left', `${nl}px`);
                st.set('top', `${nt}px`);
                st.set('width', `${nw}px`);
                st.set('height', `${nh}px`);
                setAttr(node, 'style', serializeCssMap(st));
              }
            }
          }
        }
      }
      walk(node);
    }
  };
  walk(tree);
  return serialize(tree);
}

/**
 * 提取文本槽位并按几何尺寸计算每个槽位的容量预算（max/min/decorative/wrap），同时判定页面角色。
 */
export function extractSlotsAndRole(rawHtml, { slideIndex = 0, totalSlides = 1, maxSlots = 120 } = {}) {
  const normalizedHtml = normalizeBleedSlideHtml(rawHtml);
  const tree = parseFragment(normalizedHtml);
  const leafEntries = [];

  const collectLeaves = (node, ancestors) => {
    for (const child of node.childNodes || []) {
      if (!child.tagName) continue;
      const nextAncestors = [...ancestors, child];
      const kids = child.childNodes || [];
      const hasElement = kids.some((k) => k.tagName);
      const text = kids.filter((k) => k.nodeName === '#text').map((k) => k.value).join('').trim();
      if (!hasElement && text && leafEntries.length < maxSlots && !PURE_PUNCT.test(text)) {
        // 找到最近的带绝对定位宽高的外层文本框容器
        let boxNode = null;
        let boxCss = null;
        for (let i = nextAncestors.length - 1; i >= 0; i -= 1) {
          const anc = nextAncestors[i];
          const cls = getAttr(anc, 'class');
          if (/\bpptx-(page|slide)\b/.test(cls)) break;
          const css = parseCssMap(getAttr(anc, 'style'));
          if (css.has('width') && css.has('height')) {
            boxNode = anc;
            boxCss = css;
            break;
          }
        }
        let fontSize = 0;
        let nowrap = false;
        for (let i = nextAncestors.length - 1; i >= 0; i -= 1) {
          const css = parseCssMap(getAttr(nextAncestors[i], 'style'));
          if (!fontSize && css.has('font-size')) fontSize = toPx(css.get('font-size'), 0);
          if (css.get('white-space') === 'nowrap') nowrap = true;
        }
        leafEntries.push({ node: child, text, boxNode, boxCss, fontSize: fontSize || 24, nowrap });
      }
      collectLeaves(child, nextAncestors);
    }
  };
  collectLeaves(tree, []);

  // 统计同一外框内的兄弟文本槽数量，均摊可用高度
  const boxCounts = new Map();
  for (const entry of leafEntries) {
    if (entry.boxNode) boxCounts.set(entry.boxNode, (boxCounts.get(entry.boxNode) || 0) + 1);
  }

  const values = {};
  const labels = {};
  const slotSpecs = {};
  const contentSlots = [];

  leafEntries.forEach((entry, i) => {
    const key = 't' + (i + 1);
    const { text, boxNode, boxCss, fontSize, nowrap } = entry;
    const width = boxCss ? toPx(boxCss.get('width'), 400) : 400;
    const height = boxCss ? toPx(boxCss.get('height'), fontSize * 1.6) : fontSize * 1.6;
    const pad = boxCss ? parsePadding(boxCss) : { top: 0, right: 0, bottom: 0, left: 0 };
    const siblings = boxNode ? (boxCounts.get(boxNode) || 1) : 1;

    const usableW = Math.max(fontSize * 0.8, width - pad.left - pad.right);
    const usableH = Math.max(fontSize * 0.8, (height - pad.top - pad.bottom) / siblings);
    const perLine = Math.max(1, Math.floor(usableW / fontSize));
    const lines = nowrap ? 1 : Math.max(1, Math.floor(usableH / (1.4 * fontSize)));
    const rawMax = Math.floor(perLine * lines * 0.9);

    const isBadge = BADGE_TEXT.test(text);
    const decorative = rawMax <= 1 || (isBadge && (rawMax <= 4 || text.length <= 2));
    const max = decorative ? Math.max(1, Math.min(4, rawMax || 1)) : Math.max(2, rawMax);
    const min = decorative ? 1 : Math.min(max, Math.max(2, Math.floor(max * 0.25)));
    const wrap = nowrap || lines === 1 ? 'none' : 'word';

    values[key] = text;
    labels[key] = text.length > 14 ? text.slice(0, 14) + '…' : text;
    slotSpecs[key] = {
      max,
      min,
      decorative,
      wrap,
      box: { width: Math.round(width), height: Math.round(height), fontSize: Math.round(fontSize), lines, perLine },
    };

    if (!decorative) {
      contentSlots.push(key);
      entry.node.childNodes = [{ nodeName: '#text', value: '{{' + key + '}}' }];
    }
    // 装饰性编号槽（如 01/02/03）直接固定保留在模板 HTML 中，不暴露给 AI 改写，彻底杜绝塞入正文
  });

  const allTexts = Object.values(values).join('\n');
  const activeCount = contentSlots.length;
  const maxSingleSlot = Math.max(0, ...contentSlots.map((k) => slotSpecs[k]?.max || 0));

  let role = 'content';
  let roleReason = `有效内容槽 ${activeCount} 个，按正文页处理`;

  if (/(?:^|\n)\s*(?:目录|CONTENTS|CONTENT|大纲|AGENDA)\s*(?:$|\n)/i.test(allTexts) && activeCount <= 8) {
    role = 'toc';
    roleReason = '包含「目录/CONTENTS」关键词且槽位数适中';
  } else if (/谢谢|感谢(?:聆听|观看|指导)|THANKS(?:\s+FOR)?|THANK\s+YOU|敬请(?:批评)?指正|Q\s*&\s*A/i.test(allTexts) && activeCount <= 4) {
    role = 'closing';
    roleReason = '包含结束致谢关键词且有效槽位 ≤ 4';
  } else if (slideIndex === 0 && activeCount <= 6) {
    role = 'cover';
    roleReason = `第 1 页且有效内容槽 ${activeCount} 个（封面）`;
  } else if (slideIndex === totalSlides - 1 && activeCount <= 3 && maxSingleSlot <= 24) {
    role = 'closing';
    roleReason = `末页且短文本槽位 ${activeCount} 个（尾页）`;
  } else if (activeCount >= 1 && activeCount <= 2 && maxSingleSlot <= 24) {
    role = 'section';
    roleReason = `非首尾页且仅 ${activeCount} 个短标题槽（章节过渡页）`;
  }

  // source.deck.json 仅需为模板中的可替换占位符提供键值
  const activeValues = Object.fromEntries(contentSlots.map((k) => [k, values[k]]));
  const activeLabels = Object.fromEntries(contentSlots.map((k) => [k, labels[k]]));

  return {
    html: serialize(tree),
    values: activeValues,
    labels: activeLabels,
    slots: contentSlots,
    slotSpecs,
    role,
    roleReason,
  };
}
