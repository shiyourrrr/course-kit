/**
 * 微调模式右侧「PPT 轻量属性栏」与块级属性合并纯函数模块
 *
 * 借鉴 PPTist (MIT) 与 Excalidraw (MIT)：
 * - 选中模板块或自由块时，在右侧上下文属性栏提供字号、颜色色卡、对齐、图层叠放次序、隐藏与一键恢复。
 * - 所有块级属性变更同时支持即时预览样式下发（不白闪重载 iframe）与一步撤销。
 */

export const SWATCH_COLORS = [
  { hex: '#1e293b', name: '深墨' },
  { hex: '#17574e', name: '松绿' },
  { hex: '#941e7e', name: '师大紫' },
  { hex: '#2563eb', name: '群青' },
  { hex: '#dc2626', name: '强调红' },
  { hex: '#d97706', name: '琥珀橙' },
  { hex: '#ffffff', name: '纯白' },
];

export function tweakHasEffect(t) {
  if (!t || typeof t !== 'object') return false;
  return Boolean(
    t.dx || t.dy || t.widthStep || t.widthPx || t.heightPx || t.hidden ||
    t.fontSize !== undefined || (typeof t.color === 'string' && t.color) ||
    (typeof t.align === 'string' && t.align) || (Number.isSafeInteger(t.zIndex) && t.zIndex !== 0)
  );
}

/**
 * 合并同一 DOM 路径上的新旧微调记录（保证拖拽位移时不会把之前调好的字号/颜色/图层冲掉）。
 */
export function mergeBlockTweak(existingList = [], incoming) {
  if (!incoming || !Array.isArray(incoming.path)) return existingList;
  const pathKey = incoming.path.join('.');
  const prev = (existingList || []).find((b) => Array.isArray(b.path) && b.path.join('.') === pathKey);
  const rest = (existingList || []).filter((b) => !Array.isArray(b.path) || b.path.join('.') !== pathKey);

  const merged = {
    ...(prev || {}),
    ...incoming,
    path: [...incoming.path],
  };

  // 清理恢复为默认值的可选属性，保持 deck.json 干净
  if (!merged.widthPx) delete merged.widthPx;
  if (!merged.heightPx) delete merged.heightPx;
  if (!merged.targetKey) delete merged.targetKey;
  if (!merged.hidden) delete merged.hidden;
  if (merged.fontSize === undefined || merged.fontSize === null || merged.fontSize === '') delete merged.fontSize;
  if (!merged.color) delete merged.color;
  if (!merged.align) delete merged.align;
  if (!merged.zIndex) delete merged.zIndex;
  merged.dx = merged.dx || 0;
  merged.dy = merged.dy || 0;
  merged.widthStep = merged.widthStep || 0;

  if (tweakHasEffect(merged)) rest.push(merged);
  return rest;
}

export function findBlockTweak(page, pathArr) {
  if (!page?.blockTweaks || !Array.isArray(pathArr)) return null;
  const key = pathArr.join('.');
  return page.blockTweaks.find((b) => Array.isArray(b.path) && b.path.join('.') === key) || null;
}

export function hiddenBlocksOf(page) {
  return (page?.blockTweaks || []).filter((b) => b?.hidden);
}

const KIND_LABELS = {
  heading: '标题块',
  paragraph: '正文段落',
  'list-item': '列表条目',
  card: '要点卡片',
  'note-item': '讲解条目',
  figure: '图示容器',
  'cmp-col': '对比分栏',
  aim: '目标条目',
  task: '作业条目',
  table: '表格',
  formula: '数学公式框',
  image: '独立图片',
};

/**
 * 在 #freeForm 容器中渲染选中模板块的 PPT 轻量属性面板（字号 / 颜色 / 对齐 / 图层 / 隐藏 + 已隐藏恢复列表）。
 */
export function renderTemplateBlockInspector(container, { target, page, onPatch, onUnhide, onReset, onReplaceImage }) {
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };

  container.replaceChildren();
  const saved = findBlockTweak(page, target.path) || {};

  const head = el('div', undefined, 'pptHead');
  head.append(
    el('strong', KIND_LABELS[target.kind] || '页面元素'),
    el('small', `路径 #${target.path.join('.')}`)
  );
  container.append(head);

  const isPureMedia = target.kind === 'image' || target.kind === 'figure';

  // 1. 字号调节（数值 + 快捷 A- / A+）
  if (!isPureMedia) {
    const sizeSec = el('div', undefined, 'pptGroup');
    sizeSec.append(el('span', '字号 (px)', 'pptLabel'));
    const sizeRow = el('div', undefined, 'pptInline');
    const curSize = Number.isFinite(saved.fontSize) ? saved.fontSize : (Math.round(target.fontSize) || 22);
    const sizeInput = el('input');
    sizeInput.type = 'number';
    sizeInput.min = '12';
    sizeInput.max = '120';
    sizeInput.value = String(curSize);
    sizeInput.ariaLabel = '元素字号';
    const applySize = (val) => {
      const clamped = Math.max(12, Math.min(120, Math.round(val)));
      sizeInput.value = String(clamped);
      onPatch({ fontSize: clamped }, '调整块字号');
    };
    const btnDec = el('button', 'A-'); btnDec.type = 'button';
    btnDec.onclick = () => applySize((Number(sizeInput.value) || curSize) - 2);
    const btnInc = el('button', 'A+'); btnInc.type = 'button';
    btnInc.onclick = () => applySize((Number(sizeInput.value) || curSize) + 2);
    sizeInput.onchange = () => { if (Number.isFinite(sizeInput.valueAsNumber)) applySize(sizeInput.valueAsNumber); };
    sizeRow.append(btnDec, sizeInput, btnInc);
    sizeSec.append(sizeRow);
    container.append(sizeSec);

    // 2. 文字颜色（预设色板 + 自定义取色器）
    const colorSec = el('div', undefined, 'pptGroup');
    colorSec.append(el('span', '文字颜色', 'pptLabel'));
    const swatches = el('div', undefined, 'pptSwatches');
    for (const s of SWATCH_COLORS) {
      const b = el('button', '', 'pptSwatch');
      b.type = 'button';
      b.style.background = s.hex;
      b.title = s.name + ' ' + s.hex;
      if ((saved.color || '').toLowerCase() === s.hex.toLowerCase()) b.classList.add('active');
      b.onclick = () => onPatch({ color: s.hex }, '修改文字颜色');
      swatches.append(b);
    }
    const picker = el('input', undefined, 'pptColorInput');
    picker.type = 'color';
    picker.title = '自定义颜色';
    picker.value = /^#[0-9a-fA-F]{6}$/.test(saved.color || '') ? saved.color : '#17574e';
    picker.oninput = () => onPatch({ color: picker.value }, '修改文字颜色', true);
    swatches.append(picker);
    colorSec.append(swatches);
    container.append(colorSec);

    // 3. 对齐方式（左 / 居中 / 右）
    const alignSec = el('div', undefined, 'pptGroup');
    alignSec.append(el('span', '对齐方式', 'pptLabel'));
    const alignRow = el('div', undefined, 'pptSeg');
    const curAlign = saved.align || target.align || 'left';
    for (const [val, label] of [['left', '居左'], ['center', '居中'], ['right', '居右']]) {
      const b = el('button', label);
      b.type = 'button';
      if (curAlign === val) b.classList.add('active');
      b.onclick = () => onPatch({ align: val }, '修改对齐方式');
      alignRow.append(b);
    }
    alignSec.append(alignRow);
    container.append(alignSec);
  }

  // 4. 图层叠放次序（上移 / 下移 / 置顶 / 置底）
  const layerSec = el('div', undefined, 'pptGroup');
  const curZ = Number.isSafeInteger(saved.zIndex) ? saved.zIndex : 0;
  layerSec.append(el('span', `图层顺序（当前 ${curZ >= 0 ? '+' + curZ : curZ}）`, 'pptLabel'));
  const layerRow = el('div', undefined, 'pptSeg');
  for (const [label, nextZ] of [
    ['置顶', 20],
    ['上移', Math.min(50, curZ + 1)],
    ['下移', Math.max(-10, curZ - 1)],
    ['置底', -5],
  ]) {
    const b = el('button', label);
    b.type = 'button';
    b.onclick = () => onPatch({ zIndex: nextZ }, '调整图层顺序');
    layerRow.append(b);
  }
  layerSec.append(layerRow);
  container.append(layerSec);

  // 5. 隐藏与重置操作
  const actSec = el('div', undefined, 'pptActions');
  if (onReplaceImage) {
    const repBtn = el('button', '用素材替换此块');
    repBtn.type = 'button';
    repBtn.onclick = onReplaceImage;
    actSec.append(repBtn);
  }
  const hideBtn = el('button', '隐藏本元素');
  hideBtn.type = 'button';
  hideBtn.onclick = () => onPatch({ hidden: true }, '隐藏元素');
  const resetBtn = el('button', '↺ 恢复默认样式');
  resetBtn.type = 'button';
  resetBtn.onclick = () => onReset?.();
  actSec.append(hideBtn, resetBtn);
  container.append(actSec);

  // 6. 若当前页有已隐藏元素，底部列出「一键恢复显示」
  const hiddenList = hiddenBlocksOf(page);
  if (hiddenList.length) {
    const hiddenSec = el('div', undefined, 'pptGroup pptHiddenBox');
    hiddenSec.append(el('span', `本页已隐藏 (${hiddenList.length})`, 'pptLabel'));
    for (const h of hiddenList) {
      const row = el('div', undefined, 'pptHiddenRow');
      row.append(
        el('small', `${KIND_LABELS[h.kind] || h.kind} #${h.path.join('.')}`),
        (() => {
          const b = el('button', '显示');
          b.type = 'button';
          b.onclick = () => onUnhide?.(h.path);
          return b;
        })()
      );
      hiddenSec.append(row);
    }
    container.append(hiddenSec);
  }
}
