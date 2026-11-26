/* course-kit 演示运行时：不依赖任何库，随 HTML 一起内联 */
(() => {
  // 先亮出“运行时已接管”的旗子：CSS 只有看到它才会把动效元素藏起来。
  // 脚本如果根本没跑（旧浏览器报错、被拦截），内容仍然是可见的。
  document.documentElement.classList.add('anim-ready');

  // 万一后面哪一步抛错（老浏览器、异常 DOM），立刻把旗子撤掉，别让内容跟着消失。
  const unmask = () => document.documentElement.classList.remove('anim-ready');
  window.addEventListener('error', unmask);
  window.addEventListener('unhandledrejection', unmask);

  const stage = document.querySelector('.stage');
  const slides = Array.from(document.querySelectorAll('.slide'));
  if (!stage || slides.length === 0) return;

  const noScale = new URLSearchParams(location.search).has('no-scale');
  const pager = document.querySelector('.hud .pager');
  const bar = document.querySelector('.progress');
  const hud = document.querySelector('.hud');
  const STAGGER = 80;

  let index = 0;
  const editorPreview = window.parent !== window && new URLSearchParams(location.search).get('editorPreview');
  let initialized = false;
  let idleTimer = 0;

  const clamp = (n, min, max) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);

  function initialIndex() {
    const fromHash = parseInt((location.hash || '').replace('#', ''), 10);
    return clamp(fromHash - 1, 0, slides.length - 1);
  }

  function fit() {
    if (noScale) return;
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.transform = 'scale(' + scale + ')';
  }

  /* ---------- 动效与讲课节奏 ---------- */

  const anims = (slide) => Array.from(slide.querySelectorAll('[data-anim]'));
  const builds = (slide) =>
    Array.from(slide.querySelectorAll('[data-build]')).sort(
      (a, b) => (Number(a.dataset.build) || 0) - (Number(b.dataset.build) || 0)
    );

  function resetAnim(slide) {
    slide.querySelectorAll('.in').forEach((el) => el.classList.remove('in'));
    anims(slide).forEach((el) => { el.style.transitionDelay = ''; });
  }

  /** 没写显式 data-anim 的页面：给它一个克制的默认入场，避免整份课件死板 */
  function prepareAuto(slide) {
    if (slide.querySelector('[data-anim]')) return;
    const cover = slide.querySelector(':scope > .cover');
    const targets = cover ? Array.from(cover.children) : Array.from(slide.children);
    targets.forEach((el, i) => {
      /* grouped builds */
      if (slide.hasAttribute('data-build-groups') && el.hasAttribute('data-build')) return;
      /* end grouped builds */
      el.classList.add('auto-in');
      el.style.transitionDelay = i * 90 + 'ms';
    });
  }

  function playAnim(slide) {
    // data-stagger：容器里的子元素依次入场
    slide.querySelectorAll('[data-stagger]').forEach((container) => {
      Array.from(container.children).forEach((child, i) => {
        if (child.hasAttribute('data-anim')) child.style.transitionDelay = i * STAGGER + 'ms';
      });
    });

    const list = [
      ...anims(slide).filter((el) => !el.hasAttribute('data-build')),
      ...Array.from(slide.querySelectorAll('.auto-in')),
    ];
    requestAnimationFrame(() => requestAnimationFrame(() => {
      list.forEach((el) => {
        if (el.dataset.delay) el.style.transitionDelay = el.dataset.delay + 'ms';
        el.classList.add('in');
      });
    }));
  }

  /** 点一下揭示下一个 data-build，揭示完才允许翻页 */
  function revealNextBuild(slide) {
    /* grouped builds */
    if (slide.hasAttribute('data-build-groups')) {
      const pending = builds(slide).filter(el => !el.classList.contains('in'));
      if (!pending.length) return false;
      const first = Number(pending[0].dataset.build);
      for (const el of pending) {
        if (Number(el.dataset.build) !== first) break;
        el.style.transitionDelay = '0ms';
        el.classList.add('in');
      }
      return true;
    }
    /* end grouped builds */
    const el = builds(slide).find((node) => !node.classList.contains('in'));
    if (!el) return false;
    if (el.dataset.delay) el.style.transitionDelay = el.dataset.delay + 'ms';
    el.classList.add('in');
    return true;
  }

  function revealAllBuilds(slide) {
    builds(slide).forEach((el) => el.classList.add('in'));
  }

  let leaving = null;
  let swapTimer = null;
  function endSwap() {
    if (swapTimer) { clearTimeout(swapTimer); swapTimer = null; }
    if (leaving) { leaving.hidden = true; leaving.classList.remove('slide-leaving'); leaving = null; }
    if (slides[index]) slides[index].classList.remove('slide-entering');
  }

  function navigate(next, push = true, forward = true, instant = false) {
    const target = clamp(next, 0, slides.length - 1);
    endSwap();
    if (instant || (initialized && target === index) ||
        document.body.classList.contains('no-anim') ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      show(target, push, forward);
      return;
    }
    show(target, push, forward, forward); // 后退不做过场：直接显示，避免露出白底
  }

  function show(target, push, forward, animate = false) {
    if (initialized && target === index) {
      if (push && location.hash !== '#' + (target + 1)) history.replaceState(null, '', '#' + (target + 1));
      return;
    }
    initialized = true;

    const from = slides[index];
    resetAnim(slides[index]);
    index = target;

    slides.forEach((slide, i) => {
      const on = i === index;
      slide.classList.toggle('active', on);
      slide.hidden = !on;
    });

    // 纯 CSS 两层淡出/淡入：不拍全页快照，避免首次切页 50ms 长任务
    if (animate && from && from !== slides[index]) {
      from.hidden = false;
      from.classList.add('slide-leaving');
      slides[index].classList.add('slide-entering');
      leaving = from;
      swapTimer = setTimeout(() => { if (leaving === from) endSwap(); }, 240);
    } else {
      slides[index].classList.remove('slide-entering');
    }

    resetAnim(slides[index]);
    if (forward) playAnim(slides[index]);
    else {
      // 后退时不做入场动画，但必须把元素标成已入场，否则 .auto-in 会停在 opacity:0（白屏）
      revealAllBuilds(slides[index]);
      slides[index].querySelectorAll('.auto-in, [data-anim]').forEach((el) => el.classList.add('in'));
    }

    if (pager) pager.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    if (bar) bar.style.width = ((index + 1) / slides.length) * 100 + '%';
    if (editorPreview) window.parent.postMessage({ck:'page', index, editorPreview}, '*');
    if (push) history.replaceState(null, '', '#' + (index + 1));
    document.title = document.title.replace(/\s*·\s*\d+\/\d+$/, '') + ' · ' + (index + 1) + '/' + slides.length;
    wake();
  }

  function wake() {
    if (!hud) return;
    hud.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => hud.classList.add('is-idle'), 2200);
  }

  function toggleOverview(force) {
    const on = typeof force === 'boolean' ? force : !document.body.classList.contains('overview');
    document.body.classList.toggle('overview', on);
    slides.forEach((slide, i) => { slide.hidden = on ? false : i !== index; });
    if (on) {
      // 总览把所有页都显示出来：没上过场的页，default-entrance 元素还停在 opacity:0
      slides.forEach((slide) => {
        slide.querySelectorAll('.auto-in, [data-anim]').forEach((el) => el.classList.add('in'));
        builds(slide).forEach((el) => el.classList.add('in'));
      });
    }
    fit();
  }

  document.addEventListener('keydown', (event) => {
    if (document.activeElement?.isContentEditable) return; // 正在改字，不翻页/不切总览
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;

    if (key === 'ArrowRight' || key === 'ArrowDown' || key === ' ' || key === 'PageDown' || key === 'Enter') {
      event.preventDefault();
      if (document.body.classList.contains('overview')) return toggleOverview(false);
      if (revealNextBuild(slides[index])) return; // 先走讲课节奏，再翻页
      navigate(index + 1);
    } else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || key === 'Backspace') {
      event.preventDefault();
      navigate(index - 1, true, false);
    } else if (key === 'Home') {
      navigate(0, true, false);
    } else if (key === 'End') {
      navigate(slides.length - 1);
    } else if (key === 'Escape') {
      if (event.repeat) return;
      if (document.fullscreenElement) return; // 原生全屏由浏览器处理，别去切总览
      event.preventDefault();
      // 编辑器里 Esc 由父窗口裁决：改完动效会重载预览，靠"全屏标记"会因消息竞态失效，
      // 所以一律先问父窗口；导出后的独立课件没有父窗口，直接切总览。
      if (window.parent !== window) {
        window.parent.postMessage({ ck: 'esc', editorPreview }, '*');
      } else {
        toggleOverview();
      }
    } else if (key === 'f' || key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    } else if (key === 'a' || key === 'A') {
      // 投影卡顿/学生走神：一键关掉所有动效，内容立刻全出来
      document.body.classList.toggle('no-anim');
      if (document.body.classList.contains('no-anim')) {
        revealAllBuilds(slides[index]);
      } else {
        resetAnim(slides[index]);
        playAnim(slides[index]);
      }
    } else if (key === 'p' || key === 'P') {
      window.print();
    } else if (key === 'g' || key === 'G') {
      toggleOverview();
    }
  });

  document.addEventListener('click', (event) => {
    const hotspot = event.target.closest('[data-goto]');
    const overview = document.body.classList.contains('overview');
    if (hotspot) {
      event.preventDefault();
      const value = hotspot.dataset.goto.trim();
      const page = Number(value);
      if (!/^\d+$/.test(value) || page < 1 || page > slides.length) {
        console.warn('无效的 data-goto 页码：', value);
        return;
      }
      if (overview) toggleOverview(false);
      navigate(page - 1);
    } else if (overview) {
      const slide = event.target.closest('.slide');
      if (!slide) return;
      toggleOverview(false);
      navigate(slides.indexOf(slide));
    } else if (!event.target.closest('a, button, summary, details, input, textarea, select, .hud, [data-goto]')) {
      // 放映习惯：点画面 = 下一步（先揭示 build，揭示完再翻页）
      if (event.target.closest('.slide')) {
        if (revealNextBuild(slides[index])) return;
        navigate(index + 1);
      }
    }
  });

  // 编辑器里的预览可以用 postMessage 控制：{ck:'next'|'prev'|'overview'|'first'}
  window.addEventListener('message', (event) => {
    const kind = event.data && event.data.ck;
    if (!kind) return;
    if (kind === 'full') {
      document.documentElement.toggleAttribute('data-preview-full', Boolean(event.data.on));
      if (event.data.on && document.body.classList.contains('overview')) toggleOverview(false);
      return;
    }
    if (kind === 'widget-esc') {
      if (window.parent !== window) window.parent.postMessage({ ck: 'esc', editorPreview }, '*');
      return;
    }
    if (kind === 'next') {
      if (document.body.classList.contains('overview')) return toggleOverview(false);
      if (revealNextBuild(slides[index])) return;
      navigate(index + 1);
    } else if (kind === 'prev') {
      navigate(index - 1, true, false);
    } else if (kind === 'overview') {
      toggleOverview();
    } else if (kind === 'first') {
      navigate(0, true, false);
    } else if (kind === 'goto') {
      const target = clamp(Number(event.data.index), 0, slides.length - 1);
      if (document.body.classList.contains('overview')) toggleOverview(false);
      if (initialized && target === index) {
        if (editorPreview) window.parent.postMessage({ ck: 'page', index, editorPreview }, '*');
      } else {
        navigate(target, true, true, true);
      }
    }
  });

  document.querySelector('.hud .prev')?.addEventListener('click', () => navigate(index - 1, true, false));
  document.querySelector('.hud .next')?.addEventListener('click', () => {
    if (revealNextBuild(slides[index])) return;
    navigate(index + 1);
  });
  document.querySelector('.hud .grid')?.addEventListener('click', () => toggleOverview());
  document.querySelector('.hud .full')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });

  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', () => { navigate(initialIndex(), false); });
  document.addEventListener('mousemove', wake);

  fit();
  slides.forEach(prepareAuto);
  navigate(initialIndex(), false);
  // 看门狗：2.5 秒后当前页还有没入场的元素，说明动效没跑起来 → 全部放出来
  setTimeout(() => {
    const active = slides[index];
    if (!active) return;
    const stuck = active.querySelectorAll('[data-anim]:not([data-build]):not(.in)');
    if (stuck.length) unmask();
  }, 2500);
})();
