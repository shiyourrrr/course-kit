/**
 * 独立「🎨 模板库」前端对话框控制器（与「🗂 素材库」彻底分离）
 */

const KIND_BADGES = {
  builtin: '系统内置',
  'user-template': 'PPT 混合模板',
  imported: '网页模板',
};

const ROLE_LABELS = {
  cover: '封面',
  toc: '目录',
  section: '过渡',
  closing: '致谢',
  content: '正文',
};

export function initTemplateLibrary({ request, notice, onCreateWithPack, onGenerateWithPack, onTriggerImport, onPacksChanged }) {
  const dialog = document.getElementById('templatesDialog');
  const openBtn = document.getElementById('templates');
  if (!dialog || !openBtn) return null;

  const listEl = document.getElementById('tplList');
  const previewSlot = document.getElementById('tplPreviewSlot');
  const previewTitle = document.getElementById('tplPreviewTitle');
  const previewLink = document.getElementById('tplPreviewNewTab');
  const filterBar = document.getElementById('tplFilters');
  const importBtn = document.getElementById('tplImportBtn');
  const closeBtn = document.getElementById('tplCloseBtn');

  function ensurePreviewFrame() {
    let f = document.getElementById('tplPreviewFrame');
    if (!f && previewSlot) {
      f = document.createElement('iframe');
      f.id = 'tplPreviewFrame';
      f.setAttribute('sandbox', 'allow-scripts');
      f.title = '模板效果预览';
      previewSlot.replaceChildren(f);
    }
    return f;
  }
  dialog.addEventListener('close', () => { previewSlot?.replaceChildren(); });

  let templates = [];
  let currentFilter = 'all';
  let activeId = '';

  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  function roleSummary(roles = {}) {
    const parts = [];
    for (const [k, label] of Object.entries(ROLE_LABELS)) {
      if (roles[k]) parts.push(`${label} ${roles[k]}`);
    }
    return parts.join(' · ');
  }

  function showPreview(tpl) {
    if (!tpl) {
      previewTitle.textContent = '选择左侧模板查看预览';
      previewSlot?.replaceChildren();
      previewLink.hidden = true;
      return;
    }
    activeId = tpl.id;
    previewTitle.textContent = `${tpl.name}（${tpl.pages} 页 · ${KIND_BADGES[tpl.kind] || tpl.kind}）`;
    const previewFrame = ensurePreviewFrame();
    if (previewFrame) previewFrame.src = tpl.previewUrl;
    previewLink.href = tpl.previewUrl;
    previewLink.hidden = false;
    for (const card of listEl.querySelectorAll('.tplCard')) {
      card.classList.toggle('selected', card.dataset.id === activeId);
    }
  }

  function renderList() {
    const filtered = templates.filter((t) => {
      if (currentFilter === 'mine') return t.editable;
      if (currentFilter === 'builtin') return !t.editable;
      return true;
    });

    listEl.replaceChildren();
    if (!filtered.length) {
      const empty = el('p', currentFilter === 'mine'
        ? '还没有导入自己的学校 PPT 或网页模板。点击上方「＋ 导入新模板」上传 .pptx 即可入库复用。'
        : '暂无匹配的模板。', 'genHint');
      listEl.append(empty);
      showPreview(null);
      return;
    }

    for (const tpl of filtered) {
      const card = el('div', undefined, 'tplCard' + (tpl.id === activeId ? ' selected' : ''));
      card.dataset.id = tpl.id;

      const top = el('div', undefined, 'tplCardTop');
      top.append(el('strong', tpl.name), el('span', KIND_BADGES[tpl.kind] || tpl.kind, 'tplBadge'));
      card.append(top);

      const meta = el('small', `${tpl.pages} 页 · ${roleSummary(tpl.roles) || tpl.subject}`, 'tplMeta');
      card.append(meta);

      if (tpl.palette?.length) {
        const pal = el('div', undefined, 'tplSwatches');
        for (const c of tpl.palette.slice(0, 6)) {
          const sw = el('span');
          sw.style.background = c;
          sw.title = c;
          pal.append(sw);
        }
        card.append(pal);
      }

      const actions = el('div', undefined, 'tplCardActions');
      const btnPrev = el('button', '预览');
      btnPrev.type = 'button';
      btnPrev.onclick = (e) => { e.stopPropagation(); showPreview(tpl); };

      const btnNew = el('button', '一键新建', 'primary');
      btnNew.type = 'button';
      btnNew.onclick = (e) => {
        e.stopPropagation();
        dialog.close();
        onCreateWithPack?.(tpl.id);
      };

      const btnGen = el('button', 'AI 生成');
      btnGen.type = 'button';
      btnGen.onclick = (e) => {
        e.stopPropagation();
        dialog.close();
        onGenerateWithPack?.(tpl.id, tpl.referenceSlug || '');
      };

      actions.append(btnPrev, btnNew, btnGen);

      if (tpl.editable) {
        const btnRename = el('button', '重命名');
        btnRename.type = 'button';
        btnRename.onclick = async (e) => {
          e.stopPropagation();
          const next = prompt('请输入新的模板名称：', tpl.name);
          if (!next || next.trim() === tpl.name) return;
          try {
            await request('/api/templates/rename', { id: tpl.id, name: next.trim() });
            await refresh(tpl.id);
            await onPacksChanged?.();
            notice(`模板已重命名为「${next.trim()}」`);
          } catch (err) {
            notice(err.message);
          }
        };

        const btnDel = el('button', '删除');
        btnDel.type = 'button';
        btnDel.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`确定从模板库删除「${tpl.name}」吗？`)) return;
          try {
            const res = await fetch('/api/templates?id=' + encodeURIComponent(tpl.id), { method: 'DELETE' });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || '删除失败');
            await refresh('');
            await onPacksChanged?.();
            notice(`已删除模板「${tpl.name}」`);
          } catch (err) {
            notice(err.message);
          }
        };
        actions.append(btnRename, btnDel);
      }

      card.onclick = () => showPreview(tpl);
      card.append(actions);
      listEl.append(card);
    }

    const active = filtered.find((t) => t.id === activeId) || filtered[0];
    showPreview(active);
  }

  async function refresh(preferId = activeId) {
    templates = await request('/api/templates');
    if (preferId) activeId = preferId;
    renderList();
  }

  filterBar?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    for (const b of filterBar.querySelectorAll('button[data-filter]')) {
      b.classList.toggle('active', b === btn);
    }
    renderList();
  });

  importBtn?.addEventListener('click', () => {
    dialog.close();
    onTriggerImport?.();
  });

  closeBtn?.addEventListener('click', () => dialog.close());

  openBtn.addEventListener('click', async () => {
    try {
      await refresh();
      dialog.showModal();
    } catch (err) {
      notice(err.message);
    }
  });

  return { refresh };
}
