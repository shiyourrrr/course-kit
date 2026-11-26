(() => {
  const editorPreview = new URLSearchParams(location.search).get('editorPreview');
  if (!editorPreview || parent === window) return;

  let enabled = false, selected = null, slide = null, start = null, drag = null;
  let overlay, handle, guideX, guideY, keyboardGeometry, selectedMode;
  const held = new Set();
  const send = (ck, extra = {}) => parent.postMessage({ck, editorPreview,
    index: Number(slide?.dataset.index) - 1, ...extra}, '*');
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const on = (type, fn) => window.addEventListener(type, fn, {capture:true, passive:false});

  function overlayPart(attribute, value = '') {
    const el = document.createElement('div');
    el.setAttribute(attribute, value);
    el.hidden = true;
    overlay.append(el);
    return el;
  }
  function syncHandle() {
    if (!selected || !slide.classList.contains('active')) {
      if (handle) handle.hidden = true;
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-ck-overlay', '');
      document.body.append(overlay);
      handle = overlayPart('data-ck-handle');
      guideX = overlayPart('data-ck-guide', 'x');
      guideY = overlayPart('data-ck-guide', 'y');
    }
    const resizable = !!(selected?.dataset.freeId || blockKind(selected));
    handle.hidden = !resizable;
    handle.dataset.ckHandle = resizable ? 'both' : 'none';
    const rect = selected.getBoundingClientRect();
    handle.style.left = Math.max(0, Math.min(innerWidth - 14, rect.right - 7)) + 'px';
    handle.style.top = Math.max(0, Math.min(innerHeight - 14, rect.bottom - 7)) + 'px';
  }
  function values() {
    const style = selected.style;
    if (selected.dataset.freeId) return {dx:parseFloat(style.left),dy:parseFloat(style.top),widthPx:parseFloat(style.width),heightPx:parseFloat(style.height)};
    const size = key => parseInt(style.getPropertyValue(key)) || undefined;
    return {dx:size('--ck-dx') || 0, dy:size('--ck-dy') || 0,
      widthStep:Number(selected.dataset.ckWidth) || 0, widthPx:size('--ck-w'), heightPx:size('--ck-h')};
  }
  function paint({dx, dy, widthStep, widthPx, heightPx}) {
    if (selected.dataset.freeId) {
      Object.assign(selected.style,{left:dx+'px',top:dy+'px',width:widthPx+'px',height:heightPx+'px'});
      syncHandle(); return;
    }
    selected.toggleAttribute('data-ck-move', !!(dx || dy));
    selected.style.setProperty('--ck-dx', dx + 'px');
    selected.style.setProperty('--ck-dy', dy + 'px');
    if (widthStep) selected.dataset.ckWidth = widthStep;
    else delete selected.dataset.ckWidth;
    for (const [axis, size] of [['w',widthPx], ['h',heightPx]]) {
      selected.toggleAttribute('data-ck-' + axis, !!size);
      if (size) selected.style.setProperty('--ck-' + axis, size + 'px');
      else selected.style.removeProperty('--ck-' + axis);
    }
    syncHandle();
  }
  function selectedBlockGeometry() {
    if (!selected || selected.dataset.freeId || !slide) return null;
    const kind = blockKind(selected);
    if (!kind) return null;
    const path = [];
    for (let el = selected; el !== slide; el = el.parentElement) {
      if (!el?.parentElement) return null;
      let position = Array.prototype.indexOf.call(el.parentElement.children, el);
      if (el.parentElement === slide && slide.firstElementChild.classList.contains('slide-bg')) position--;
      path.unshift(position);
    }
    const rect = selected.getBoundingClientRect();
    const page = slide.getBoundingClientRect();
    const scale = 1280 / slide.offsetWidth;
    const cs = getComputedStyle(selected);
    const fontSize = Math.round(parseFloat(cs.fontSize)) || 22;
    const align = ['center', 'right'].includes(cs.textAlign) ? cs.textAlign : 'left';
    return {path, kind, targetKey:blockFingerprint(selected),
      x:(rect.left-page.left)*scale, y:(rect.top-page.top)*scale,
      w:rect.width*scale, h:rect.height*scale, fontSize, align};
  }
  function resolveDomPath(rootSlide, path) {
    if (!rootSlide || !Array.isArray(path)) return null;
    let cur = rootSlide;
    for (let depth = 0; depth < path.length; depth += 1) {
      let idx = path[depth];
      if (depth === 0 && cur.firstElementChild?.classList.contains('slide-bg')) idx += 1;
      cur = cur.children?.[idx];
      if (!cur) return null;
    }
    return cur;
  }
  function finish(cancel = false) {
    if (!start) return;
    const value = values();
    if (cancel) paint(start);
    else if (Object.keys(value).some(key => value[key] !== start[key])) {
      if (selected.dataset.freeId) {
        send('freeGeometry',{id:selected.dataset.freeId,x:value.dx,y:value.dy,w:value.widthPx,h:value.heightPx});
      } else {
        const target = selectedBlockGeometry();
        if (target) send('blockCommit', {target, tweak:{path:target.path, kind:target.kind,
          targetKey:target.targetKey, ...value}});
      }
    }
    const previous = drag;
    start = drag = keyboardGeometry = null;
    held.clear();
    if (previous?.capture.hasPointerCapture(previous.id)) previous.capture.releasePointerCapture(previous.id);
    if (guideX) guideX.hidden = guideY.hidden = true;
    slide?.querySelectorAll('[data-ck-collision]').forEach(el => el.removeAttribute('data-ck-collision'));
  }
  function select(el) {
    finish(!!drag);
    selected?.removeAttribute('data-ck-selected');
    selected = el;
    slide = el?.closest('.slide');
    selectedMode = el?.dataset.freeId ? 'both' : el ? resizeMode(el) : 'none';
    if (enabled) {
      const index = Number(document.querySelector('.slide.active')?.dataset.index)-1;
      send('freeSelection',{id:el?.dataset.freeId || null,index});
      send('blockSelection',{target:selectedBlockGeometry(),index});
    }
    el?.setAttribute('data-ck-selected', '');
    syncHandle();
  }
  function editable(target) {
    return enabled && !document.body.classList.contains('overview') && target.closest?.('.slide.active');
  }
  // 微调里点到文字字段时，拦住"点一下翻页"，否则双击的第一下就换了页
  on('click', (e) => {
    if (!enabled) return;
    const host = e.target?.closest?.('[data-ck-f]');
    if (host && editable(host)) stop(e);
  });

  function beginFieldEdit(host) {
    if (!enabled || !host || host.isContentEditable || !editable(host)) return;
    const path = host.getAttribute('data-ck-f');
    const original = host.innerHTML;
    if (host.dataset.ckOrigin === undefined) host.dataset.ckOrigin = host.innerText;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      host.removeAttribute('contenteditable');
      if (!commit) { host.innerHTML = original; drag = null; return; }
      const text = (host.innerText || '').replace(/\u00a0/g, ' ').replace(/\n$/, '');
      if (text.trim() === '') { host.innerHTML = original; return; } // 删空视为取消，别留空白
      if (text === host.dataset.ckOrigin) return;
      // 双击时没有先选中块，slide/index 可能是空的：按被编辑元素自己所在的页算
      const hostSlide = host.closest('.slide');
      parent.postMessage({ ck: 'fieldEdit', editorPreview, index: Number(hostSlide?.dataset.index) - 1, path, text }, '*');
    };
    host.setAttribute('contenteditable', 'true');
    host.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(host);
      range.collapse(false); // 光标落在末尾：改字时不会一按退格删光整段
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    // 编辑期间：Enter/Esc 归编辑；其余导航键只阻断传播，保留浏览器默认（删字、移动光标、输入空格）
    const NAV_KEYS = new Set(['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Spacebar','g','G','f','F','a','A']);
    host.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { stop(ev); finish(true); return; }
      if (ev.key === 'Escape') { stop(ev); finish(false); return; }
      if (NAV_KEYS.has(ev.key)) ev.stopImmediatePropagation();
    }, true);
    host.addEventListener('blur', () => finish(true), { once: true });
  }
  on('message', e => {
    if (e.source !== parent) return;
    if (e.data?.ck === 'liveStyle') {
      const slide = document.querySelector('.slide.active');
      const st = e.data.style || {};
      if (slide) {
        for (const [key, value] of Object.entries(st.vars || {})) slide.style.setProperty(key, value);
        if (st.veil !== undefined) slide.style.setProperty('--slide-veil', String(st.veil));
        if (st.fade !== undefined) {
          const bg = slide.querySelector('.slide-bg');
          if (bg) { if (st.fade) bg.setAttribute('data-bg-fade', ''); else bg.removeAttribute('data-bg-fade'); }
        }
      }
      return;
    }
    if (e.data?.ck === 'imgFx') {
      // 图片效果滑杆拖动中：就地改样式，不重载预览
      const img = document.querySelector('.free-block[data-free-id="' + CSS.escape(String(e.data.id || '')) + '"] img');
      if (img) img.style.cssText = String(e.data.css || '');
      return;
    }
    if (e.data?.ck === 'blockStyle' && e.data.editorPreview === editorPreview) {
      const activeSlide = document.querySelector('.slide.active');
      const node = resolveDomPath(activeSlide, e.data.path);
      const st = e.data.style || {};
      if (node) {
        if (st.hidden !== undefined) {
          if (st.hidden) {
            node.setAttribute('data-ck-hidden', '');
            if (selected === node) select(null);
          } else {
            node.removeAttribute('data-ck-hidden');
          }
        }
        if (st.fontSize !== undefined) {
          if (st.fontSize) node.style.setProperty('font-size', st.fontSize + 'px', 'important');
          else node.style.removeProperty('font-size');
        }
        if (st.color !== undefined) {
          if (st.color) node.style.setProperty('color', st.color, 'important');
          else node.style.removeProperty('color');
        }
        if (st.align !== undefined) {
          if (st.align) node.style.setProperty('text-align', st.align, 'important');
          else node.style.removeProperty('text-align');
        }
        if (st.zIndex !== undefined) {
          if (st.zIndex) {
            if (!node.style.position) node.style.position = 'relative';
            node.style.setProperty('z-index', String(st.zIndex), 'important');
          } else {
            node.style.removeProperty('z-index');
          }
        }
        syncHandle();
      }
      return;
    }
    if (e.data?.ck === 'replaceBlock' && e.data.editorPreview === editorPreview) {
      const activeIndex = Number(document.querySelector('.slide.active')?.dataset.index)-1;
      if (!enabled || !selected || selected.dataset.freeId || !editable(selected) || e.data.index !== activeIndex) return;
      const target = selectedBlockGeometry();
      if (target) send('blockReplacement',{...target, requestId:e.data.requestId, src:e.data.src, index:activeIndex});
    } else if (e.data?.ck === 'blockMode' && e.data.editorPreview === editorPreview) {
      enabled = !!e.data.enabled;
      const expectedW = Number(e.data.expectedW) || 0;
      const expectedH = Number(e.data.expectedH) || 0;
      const sizeMismatch = () =>
        (expectedW > 0 && Math.abs(innerWidth - expectedW) > 2) ||
        (expectedH > 0 && Math.abs(innerHeight - expectedH) > 2);
      const applyMode = () => {
        window.dispatchEvent(new Event('resize'));
        lastW = innerWidth; lastH = innerHeight;
        document.documentElement.toggleAttribute('data-ck-edit', enabled);
        if (enabled && e.data.freeId) {
          const wanted = document.querySelector('.slide.active [data-free-id="'+CSS.escape(e.data.freeId)+'"]');
          if (wanted && wanted !== selected) select(wanted);
        }
        if (!enabled || (slide && !editable(selected))) select(null);
      };
      if (enabled && sizeMismatch()) {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          window.removeEventListener('resize', onResize);
          requestAnimationFrame(applyMode);
        };
        const onResize = () => {
          if (!sizeMismatch()) done();
        };
        window.addEventListener('resize', onResize);
        setTimeout(done, 220);
      } else if (enabled && !document.documentElement.hasAttribute('data-ck-edit')) {
        requestAnimationFrame(applyMode);
      } else {
        applyMode();
      }
    } else if (['next','prev','overview','goto'].includes(e.data?.ck)) select(null);
  });

  function overlaps(a, b) {
    return Math.min(a.right,b.right) - Math.max(a.left,b.left) > 0.5 &&
      Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 0.5;
  }
  function geometry() {
    const rect = selected.getBoundingClientRect();
    const page = slide.getBoundingClientRect();
    const padding = getComputedStyle(slide);
    const xs = [page.left, page.right, (page.left + page.right)/2];
    const ys = [page.top, page.bottom, (page.top + page.bottom)/2];
    const neighbors = [];
    for (const el of slide.querySelectorAll('*')) {
      if ((!el.dataset.freeId && !blockKind(el)) || selected.contains(el) || el.contains(selected)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || !overlaps(r,page) || getComputedStyle(el).visibility === 'hidden') continue;
      xs.push(r.left, r.right);
      ys.push(r.top, r.bottom);
      neighbors.push({el, overlapping:overlaps(rect,r)});
    }
    const scale = page.width / slide.offsetWidth;
    const content = {left:page.left + parseFloat(padding.paddingLeft)*scale,
      right:page.right - parseFloat(padding.paddingRight)*scale,
      top:page.top + parseFloat(padding.paddingTop)*scale,
      bottom:page.bottom - parseFloat(padding.paddingBottom)*scale};
    return {page, rect, xs, ys, neighbors, scale, content,
      resizeXs:[...xs,content.left,content.right], resizeYs:[...ys,content.top,content.bottom]};
  }
  function feedback(context = drag) {
    const rect = selected.getBoundingClientRect();
    for (const {el, overlapping} of context.neighbors) {
      el.toggleAttribute('data-ck-collision', !overlapping && overlaps(rect,el.getBoundingClientRect()));
    }
  }
  let lastFieldTouch = { host: null, at: 0 };
  on('pointerdown', e => {
    if (!enabled || e.button !== 0 || !e.isPrimary || drag) return;
    const resizing = e.target === handle;
    // 同一段文字 450ms 内点第二下 → 就地改字（不依赖 dblclick，避免 pointerdown 取消兼容事件）
    const freeImageHost = resizing ? null : e.target?.closest?.('.free-block[data-free-id]');
    if (freeImageHost && freeImageHost.querySelector('img') && !e.target?.closest?.('[data-ck-f]')) {
      const now = performance.now();
      if (lastFieldTouch.host === freeImageHost && now - lastFieldTouch.at < 450) {
        e.preventDefault();
        send('freeImageEdit', { id: freeImageHost.dataset.freeId });
        lastFieldTouch = { host: null, at: 0 };
        return;
      }
      lastFieldTouch = { host: freeImageHost, at: now };
    }
    const fieldHost = resizing ? null : e.target?.closest?.('[data-ck-f]');
    if (fieldHost && editable(fieldHost)) {
      const now = performance.now();
      if (lastFieldTouch.host === fieldHost && now - lastFieldTouch.at < 450) {
        e.preventDefault();
        beginFieldEdit(fieldHost);
        lastFieldTouch = { host: null, at: 0 };
        return;
      }
      lastFieldTouch = { host: fieldHost, at: now };
    }
    if (!resizing && !editable(e.target)) { select(null); return; }
    stop(e);
    if (!resizing) {
      const chain = [];
      for (let el = e.target; el && !el.classList.contains('slide'); el = el.parentElement) {
        if (el.dataset.freeId || blockKind(el)) chain.push(el);
      }
      const next = e.altKey ? Math.min(chain.length - 1, Math.max(1,chain.indexOf(selected) + 1)) : 0;
      select(chain[next] || null);
    }
    if (!selected) return;
    window.focus();
    finish();
    start = values();
    const capture = resizing ? handle : selected;
    drag = {...geometry(), id:e.pointerId, x:e.clientX, y:e.clientY,
      lastX:e.clientX, lastY:e.clientY, capture,
      mode:resizing ? 'both' : 'move', lastValid:start};
    capture.setPointerCapture(e.pointerId);
  });

  function snap(points, targets, guide, axis) {
    let distance = Infinity, offset = 0, target;
    for (const p of points) for (const t of targets) {
      const diff = t - p;
      if (Math.abs(diff) <= 6 && Math.abs(diff) < distance) {
        distance = Math.abs(diff); offset = diff; target = t;
      }
    }
    guide.hidden = target === undefined;
    if (!guide.hidden) {
      const horizontal = axis === 'x';
      guide.style.left = (horizontal ? target : drag.page.left) + 'px';
      guide.style.top = (horizontal ? drag.page.top : target) + 'px';
      guide.style[horizontal ? 'height' : 'width'] = (horizontal ? drag.page.height : drag.page.width) + 'px';
    }
    return offset;
  }
  function textFits() {
    const page = drag.page, scale = drag.scale;
    const inside = (r, box) => r.left >= box.left-1 && r.top >= box.top-1 &&
      r.right <= box.right+1 && r.bottom <= box.bottom+1;
    if (!inside(selected.getBoundingClientRect(), drag.content)) return false;
    // Text may escape a visible-overflow child and be clipped several ancestors up.
    const clips = new Map([[slide, drag.content]]);
    function clipFor(el) {
      if (clips.has(el)) return clips.get(el);
      const parentClip = clipFor(el.parentElement);
      const style = getComputedStyle(el);
      let clip = parentClip;
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const r = el.getBoundingClientRect();
        const left = r.left + el.clientLeft*scale, top = r.top + el.clientTop*scale;
        clip = {left:parentClip.left, right:parentClip.right, top:parentClip.top, bottom:parentClip.bottom};
        if (style.overflowX !== 'visible') {
          clip.left = Math.max(clip.left,left);
          clip.right = Math.min(clip.right,left+el.clientWidth*scale);
        }
        if (style.overflowY !== 'visible') {
          clip.top = Math.max(clip.top,top);
          clip.bottom = Math.min(clip.bottom,top+el.clientHeight*scale);
        }
      }
      clips.set(el,clip);
      return clip;
    }
    const texts = document.createTreeWalker(selected, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      const el = node.parentElement;
      if (!node.textContent.trim() || el.closest('svg,math,.katex-mathml') || getComputedStyle(el).visibility === 'hidden') continue;
      range.selectNodeContents(node);
      const clip = clipFor(el);
      for (const rect of range.getClientRects()) {
        if (rect.width && rect.height && !inside(rect,clip)) return false;
      }
    }
    return true;
  }
  function move(e) {
    if (!drag || drag.id !== e.pointerId) return;
    stop(e);
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    const x = e.clientX-drag.x, y = e.clientY-drag.y;
    const {rect:r, scale, mode} = drag;
    if (!x && !y) {
      paint(start); drag.lastValid = start; guideX.hidden = guideY.hidden = true; feedback(); return;
    }
    if (mode === 'move') {
      const sx = snap([r.left+x,(r.left+r.right)/2+x,r.right+x],drag.xs,guideX,'x');
      const sy = snap([r.top+y,(r.top+r.bottom)/2+y,r.bottom+y],drag.ys,guideY,'y');
      paint({...start, dx:start.dx + Math.round((x+sx)/scale), dy:start.dy + Math.round((y+sy)/scale)});
    } else {
      const sx = snap([r.right+x],drag.resizeXs,guideX,'x');
      const sy = snap([r.bottom+y],drag.resizeYs,guideY,'y');
      const maxWidth = Math.floor((drag.content.right-r.left)/scale);
      const maxHeight = Math.floor((drag.content.bottom-r.top)/scale);
      if (maxWidth < 40 || maxHeight < 40) {
        paint(drag.lastValid);
        feedback();
        return;
      }
      let width = r.width+x+sx, height = r.height+y+sy;
      if (e.altKey) {
        const minFactor = Math.max(40/(r.width/scale),40/(r.height/scale));
        const maxFactor = Math.min(maxWidth/(r.width/scale),maxHeight/(r.height/scale));
        if (minFactor > maxFactor) {
          paint(drag.lastValid);
          feedback();
          return;
        }
        const factor = Math.max(minFactor, Math.min(maxFactor,
          (width*r.width+height*r.height)/(r.width*r.width+r.height*r.height)));
        width = r.width*factor;
        height = r.height*factor;
      }
      const next = {...start,
        widthPx:Math.min(maxWidth,Math.max(40,Math.round(width/scale))),
        heightPx:Math.min(maxHeight,Math.max(40,Math.round(height/scale)))};
      paint(next);
      if (!selected.dataset.freeId) {
        const moved = selected.getBoundingClientRect();
        next.dx += Math.round((r.left-moved.left)/scale);
        next.dy += Math.round((r.top-moved.top)/scale);
        paint(next);
      }
      const actual = selected.getBoundingClientRect();
      const sizeFits = Math.abs(actual.width/scale-next.widthPx) <= 1 &&
        Math.abs(actual.height/scale-next.heightPx) <= 1;
      if (!sizeFits || (!selected.dataset.freeId && !textFits())) paint(drag.lastValid);
      else drag.lastValid = next;
    }
    feedback();
  }
  on('pointermove', move);
  on('pointerup', e => { if (drag?.id === e.pointerId) {
    if (e.clientX !== drag.lastX || e.clientY !== drag.lastY) move(e);
    finish();
  } });
  on('pointercancel', e => { if (drag?.id === e.pointerId) finish(true); });
  on('lostpointercapture', e => { if (drag?.id === e.pointerId) finish(true); });
  on('click', e => { if (editable(e.target) || e.target === handle) stop(e); });
  on('blur', e => { if (e.target === window) finish(!!drag); });
  let lastW = innerWidth, lastH = innerHeight;
  on('resize', () => {
    if (innerWidth === lastW && innerHeight === lastH) return;
    lastW = innerWidth; lastH = innerHeight;
    if (selected) { finish(!!drag); requestAnimationFrame(syncHandle); }
  });
  on('keydown', e => {
    if (!enabled) return;
    if (document.activeElement?.isContentEditable) return; // 正在改字，别抢按键
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && ['s','z'].includes(e.key.toLowerCase())) {
      stop(e); finish(!!drag); send(e.key.toLowerCase() === 'z' ? 'blockUndo' : 'blockSave'); return;
    }
    if (!selected || !editable(selected)) return;
    if (selected.dataset.freeId && ['Delete','Backspace'].includes(e.key)) {
      stop(e); finish(true); send('freeDelete',{id:selected.dataset.freeId}); return;
    }
    if (e.key === 'Escape') {
      stop(e);
      finish(true);
      select(null);
      // 交给父窗口裁决：全屏中就退出全屏；否则什么都不做（微调里 Esc 只取消选中）
      parent.postMessage({ ck: 'blockEscape', editorPreview }, '*');
      return;
    }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
      if (['Home','End','PageUp','PageDown','Backspace','Enter',' ','g','G'].includes(e.key)) select(null);
      return;
    }
    stop(e);
    if (drag) return;
    const value = values();
    if (!start) { start = value; keyboardGeometry = geometry(); }
    held.add(e.key);
    const change = ['ArrowLeft','ArrowUp'].includes(e.key) ? -1 : 1;
    const horizontal = ['ArrowLeft','ArrowRight'].includes(e.key);
    if (!selected.dataset.freeId && e.altKey && horizontal && selectedMode !== 'none') {
      paint({...value, widthPx:undefined, heightPx:selectedMode === 'ratio' ? undefined : value.heightPx,
        widthStep:Math.max(-1, Math.min(1, value.widthStep + change))});
    } else if (!e.altKey) {
      const axis = horizontal ? 'dx' : 'dy';
      paint({...value, [axis]:value[axis] + change * (e.shiftKey ? 20 : 4)});
    }
    feedback(keyboardGeometry);
  });
  on('keyup', e => {
    if (held.delete(e.key)) { stop(e); if (!held.size) finish(); }
  });
})();
