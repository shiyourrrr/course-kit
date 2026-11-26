// 新手引导模块（借鉴 Driver.js MIT 的 SVG 镂空聚光灯与智能弹层定位，零外部依赖）

const STORAGE_KEY = 'ck_tour_done_v1';

export const DEFAULT_TOUR_STEPS = [
  {
    selector: '#settings',
    title: '① 先配 AI（只需一次）',
    body: '点击右上角设置，填入 DeepSeek API Key 即可启用 AI 备课；如需直接解析 PDF 教材，也可在此填入 MinerU Token。所有密钥仅保存在本机。',
    side: 'bottom',
  },
  {
    selector: '#generate',
    title: '② 一句话生成整节课',
    body: '输入课题、年级与课型，AI 会先梳理教学重难点再逐页填满干货与讲稿；支持选择内容饱满度，并自动回填教材页码。',
    side: 'right',
  },
  {
    selector: '#books',
    title: '③ 教材库与资源库',
    body: '支持上传 PDF（MinerU 保留公式、插图与原书页码）、Word 教材、试卷与模板；生成课件时可按页码范围精准引用。',
    side: 'right',
  },
  {
    selector: '#editTools',
    title: '④ 单页改写与互动演示块',
    body: '用「充实内容 / 突出重难点」一键打磨单页；点「演示块」可插入 PhET 离线实验、内置数学滑块或 GeoGebra / Desmos 链接。',
    side: 'bottom',
  },
  {
    selector: '.modeTabs',
    title: '⑤ 填内容 / 微调版面自由切换',
    body: '默认专注填文字和公式；切到「微调版面」后，可在右侧预览画布直接拖拽、拉角缩放，或双击文字原地修改。',
    side: 'bottom',
  },
  {
    selector: '#export',
    title: '⑥ 导出断网可放的单文件 HTML',
    body: '备课完成后点击「导出 HTML」，直接得到单个离线文件，拷到教室电脑双击即可全屏放映；旁边也可导出 Markdown / 打印版讲稿。',
    side: 'bottom',
  },
];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function buildSpotlightPath(vw, vh, rect, pad = 8, radius = 10) {
  const outer = `M0,0 H${vw} V${vh} H0 Z`;
  if (!rect) return outer;
  const x = clamp(rect.left - pad, 4, vw - 8);
  const y = clamp(rect.top - pad, 4, vh - 8);
  const w = clamp(rect.width + pad * 2, 16, vw - x - 4);
  const h = clamp(rect.height + pad * 2, 16, vh - y - 4);
  const r = Math.min(radius, w / 2, h / 2);
  // 逆时针内孔路径（配合 fill-rule="evenodd" 挖出圆角高亮窗口）
  const inner = [
    `M${x + r},${y}`,
    `H${x + w - r}`,
    `A${r},${r} 0 0 1 ${x + w},${y + r}`,
    `V${y + h - r}`,
    `A${r},${r} 0 0 1 ${x + w - r},${y + h}`,
    `H${x + r}`,
    `A${r},${r} 0 0 1 ${x},${y + h - r}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y} Z`,
  ].join(' ');
  return `${outer} ${inner}`;
}

export function createTour({ steps = DEFAULT_TOUR_STEPS, storageKey = STORAGE_KEY, onBeforeStep } = {}) {
  let active = false;
  let stepIndex = 0;
  let rootEl = null;
  let svgPath = null;
  let ringEl = null;
  let popEl = null;
  let resizeObs = null;
  let settleTimer = null;

  const markDone = () => {
    try { localStorage.setItem(storageKey, '1'); } catch {}
  };

  const isDone = () => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  };

  const getTargetRect = (selector) => {
    const el = selector ? document.querySelector(selector) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return r;
  };

  const positionPopover = (rect, preferredSide) => {
    if (!popEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = Math.min(340, vw - 24);
    popEl.style.width = pw + 'px';
    const ph = popEl.offsetHeight || 190;
    const gap = 16;

    if (!rect) {
      popEl.style.left = Math.round((vw - pw) / 2) + 'px';
      popEl.style.top = Math.round((vh - ph) / 2) + 'px';
      return;
    }

    const candidates = {
      bottom: { left: rect.left + rect.width / 2 - pw / 2, top: rect.bottom + gap },
      top: { left: rect.left + rect.width / 2 - pw / 2, top: rect.top - ph - gap },
      right: { left: rect.right + gap, top: rect.top + rect.height / 2 - ph / 2 },
      left: { left: rect.left - pw - gap, top: rect.top + rect.height / 2 - ph / 2 },
    };

    const order = [preferredSide, 'bottom', 'right', 'top', 'left'].filter(
      (s, i, a) => s && candidates[s] && a.indexOf(s) === i
    );
    let chosen = candidates[order[0]];
    for (const side of order) {
      const c = candidates[side];
      if (c.left >= 12 && c.left + pw <= vw - 12 && c.top >= 12 && c.top + ph <= vh - 12) {
        chosen = c;
        break;
      }
    }
    popEl.style.left = Math.round(clamp(chosen.left, 12, vw - pw - 12)) + 'px';
    popEl.style.top = Math.round(clamp(chosen.top, 12, vh - ph - 12)) + 'px';
  };

  const syncGeometry = () => {
    if (!active || !rootEl) return;
    const step = steps[stepIndex];
    if (!step) return;
    const rect = getTargetRect(step.selector);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    svgPath.setAttribute('d', buildSpotlightPath(vw, vh, rect));
    if (rect) {
      ringEl.hidden = false;
      ringEl.style.left = Math.round(rect.left - 8) + 'px';
      ringEl.style.top = Math.round(rect.top - 8) + 'px';
      ringEl.style.width = Math.round(rect.width + 16) + 'px';
      ringEl.style.height = Math.round(rect.height + 16) + 'px';
    } else {
      ringEl.hidden = true;
    }
    positionPopover(rect, step.side || 'bottom');
  };

  const renderStep = () => {
    if (!active || !rootEl) return;
    const step = steps[stepIndex];
    if (!step) return close(true);
    if (typeof onBeforeStep === 'function') onBeforeStep(step, stepIndex);

    const target = step.selector ? document.querySelector(step.selector) : null;
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (target && typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(() => syncGeometry());
      resizeObs.observe(target);
      const sidebar = document.getElementById('sidebar');
      if (sidebar) resizeObs.observe(sidebar);
    }

    const dots = steps.map((_, i) =>
      `<span class="ck-tour-dot${i === stepIndex ? ' is-active' : ''}"></span>`
    ).join('');
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === steps.length - 1;

    popEl.innerHTML = [
      `<div class="ck-tour-head"><span class="ck-tour-step">${stepIndex + 1} / ${steps.length}</span><button type="button" class="ck-tour-skip" data-tour="skip">跳过指引</button></div>`,
      `<h3 class="ck-tour-title"></h3>`,
      `<p class="ck-tour-body"></p>`,
      `<div class="ck-tour-foot"><div class="ck-tour-dots">${dots}</div><div class="ck-tour-actions">`,
      isFirst ? '' : `<button type="button" class="ck-tour-btn" data-tour="prev">上一步</button>`,
      `<button type="button" class="ck-tour-btn primary" data-tour="next">${isLast ? '开始备课' : '下一步'}</button>`,
      `</div></div>`,
    ].join('');
    popEl.querySelector('.ck-tour-title').textContent = step.title;
    popEl.querySelector('.ck-tour-body').textContent = step.body;
    syncGeometry();
    // 侧栏展开等 CSS 过渡完成后补一次对齐，防止动画中途测到的尺寸残留
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settleTimer = null; syncGeometry(); }, 320);
  };

  const onKeyDown = (e) => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close(true);
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopImmediatePropagation();
      prev();
    }
  };

  const onResize = () => {
    if (active) renderStep();
  };

  const mount = () => {
    if (rootEl) return;
    rootEl = document.createElement('div');
    rootEl.className = 'ck-tour-root';
    rootEl.setAttribute('role', 'dialog');
    rootEl.setAttribute('aria-modal', 'true');
    rootEl.setAttribute('aria-label', '新手引导');

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'ck-tour-overlay');
    svgPath = document.createElementNS(svgNS, 'path');
    svgPath.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(svgPath);

    ringEl = document.createElement('div');
    ringEl.className = 'ck-tour-ring';

    popEl = document.createElement('div');
    popEl.className = 'ck-tour-popover';
    popEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tour]');
      if (!btn) return;
      const act = btn.dataset.tour;
      if (act === 'skip') close(true);
      else if (act === 'prev') prev();
      else if (act === 'next') next();
    });

    svg.addEventListener('click', () => close(true));

    rootEl.append(svg, ringEl, popEl);
    document.body.appendChild(rootEl);
  };

  const start = (fromIndex = 0) => {
    if (!steps.length) return;
    mount();
    stepIndex = clamp(fromIndex, 0, steps.length - 1);
    if (!active) {
      active = true;
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onResize, true);
    }
    rootEl.hidden = false;
    renderStep();
  };

  const next = () => {
    if (stepIndex >= steps.length - 1) return close(true);
    stepIndex++;
    renderStep();
  };

  const prev = () => {
    if (stepIndex <= 0) return;
    stepIndex--;
    renderStep();
  };

  const close = (persist = true) => {
    if (!active) return;
    active = false;
    if (persist) markDone();
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize, true);
    if (rootEl) rootEl.hidden = true;
  };

  const maybeAutoStart = () => {
    const force = new URLSearchParams(location.search).get('tour') === '1';
    if (force) {
      setTimeout(() => start(0), 250);
      return true;
    }
    // 自动化浏览器测试（navigator.webdriver）不自动弹窗，避免干扰测试脚本
    if (navigator.webdriver || isDone()) return false;
    setTimeout(() => start(0), 450);
    return true;
  };

  return { start, next, prev, close, maybeAutoStart, isActive: () => active };
}
