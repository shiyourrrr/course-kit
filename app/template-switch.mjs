const META_KEYS = new Set([
  'layout', 'notes', 'minutes', 'anim', 'stagger', 'speed', 'build', 'buildBlocks',
  'blockTweaks', 'freeBlocks', 'css', 'cssFile', 'background', 'veil', 'bgBlur',
  'bgScale', 'bgX', 'bgY', 'bgFade', 'fidelityLayout', 'elasticLayout',
  'fidelityBackup', 'elasticBackup',
]);

export function isElasticLayout(layoutId) {
  return typeof layoutId === 'string' && layoutId.startsWith('elastic-');
}

export function canToggleTemplateMode(page, pack) {
  if (!page || pack?.kind !== 'user-template') return false;
  const hasElastic = pack.layouts?.some((l) => isElasticLayout(l.id));
  const hasFidelity = pack.layouts?.some((l) => !isElasticLayout(l.id));
  return Boolean(hasElastic && hasFidelity && (isElasticLayout(page.layout) || pack.layouts.some((l) => l.id === page.layout)));
}

function extractPlainFields(page) {
  const snap = {};
  for (const [k, v] of Object.entries(page)) {
    if (!META_KEYS.has(k)) snap[k] = structuredClone(v);
  }
  return snap;
}

function clearPlainFields(page) {
  for (const k of Object.keys(page)) {
    if (!META_KEYS.has(k)) delete page[k];
  }
}

function flattenElasticTexts(snap) {
  const list = [];
  if (typeof snap.title === 'string' && snap.title.trim()) list.push(snap.title.trim());
  for (const scalar of ['subtitle', 'kicker', 'tag', 'lead', 'goal', 'scene', 'question', 'stem', 'formula', 'condition', 'explain', 'hint', 'answer', 'conclusion', 'verdict', 'closing', 'tips', 'note', 'footnote']) {
    if (typeof snap[scalar] === 'string' && snap[scalar].trim()) list.push(snap[scalar].trim());
  }
  for (const arrKey of ['items', 'steps', 'points', 'tasks']) {
    if (!Array.isArray(snap[arrKey])) continue;
    for (const row of snap[arrKey]) {
      if (!row || typeof row !== 'object') continue;
      const line = [row.term, row.text, row.why].filter((s) => typeof s === 'string' && s.trim()).join('：');
      if (line) list.push(line);
    }
  }
  for (const side of ['left', 'right']) {
    if (snap[side]?.title) list.push(String(snap[side].title));
    if (Array.isArray(snap[side]?.items)) {
      for (const r of snap[side].items) if (r?.text) list.push(String(r.text));
    }
  }
  return list;
}

function buildElasticFromFidelity(snap, targetSpec) {
  const texts = Object.keys(snap)
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
    .map((k) => String(snap[k] ?? '').trim())
    .filter(Boolean);
  const title = texts[0] || '未命名页面';
  const rest = texts.slice(1);
  const id = targetSpec?.id || 'elastic-concept';

  if (id === 'elastic-cover') {
    return { title, subtitle: rest[0] || '', duration: rest[1] || '' };
  }
  if (id === 'elastic-summary') {
    return {
      title,
      points: (rest.length ? rest : ['核心要点梳理']).slice(0, 5).map((text) => ({ text })),
      closing: rest.length > 5 ? rest[5] : '',
    };
  }
  if (id === 'elastic-objectives') {
    return {
      title,
      items: (rest.length ? rest : ['掌握本节核心概念']).slice(0, 5).map((text, i) => ({ num: String(i + 1).padStart(2, '0'), text })),
    };
  }
  if (id === 'elastic-example') {
    return {
      tag: '例题',
      title,
      stem: rest[0] || title,
      steps: rest.slice(1, 4).map((text) => ({ text })),
      answer: rest[4] || '',
    };
  }
  if (id === 'elastic-derive') {
    return {
      kicker: '推导',
      title,
      steps: (rest.length ? rest : [title]).slice(0, 4).map((text) => ({ text })),
    };
  }
  if (id === 'elastic-practice') {
    return {
      kicker: '随堂练习',
      title,
      stem: rest[0] || title,
      hint: rest[1] || '',
      answer: rest[2] || '',
    };
  }
  if (id === 'elastic-homework') {
    return {
      kicker: '课后作业',
      title,
      tasks: (rest.length ? rest : [title]).slice(0, 5).map((text) => ({ text })),
    };
  }
  return {
    kicker: '要点',
    title,
    items: (rest.length ? rest : [title]).slice(0, 4).map((text, i) => ({
      num: String(i + 1).padStart(2, '0'),
      term: `要点 ${i + 1}`,
      text,
    })),
  };
}

function buildFidelityFromElastic(snap, fidelitySpec) {
  const slots = fidelitySpec?.slots || [];
  const lines = flattenElasticTexts(snap);
  const out = {};
  slots.forEach((slot, i) => {
    out[slot] = lines[i] ?? fidelitySpec?.slotLabels?.[slot] ?? '';
  });
  return out;
}

/**
 * 在「保真版式（page-N）」与「通用弹性版式（elastic-*）」之间无损双向切换：
 * - 完整备份切换前后的结构化字段，来回切换零信息丢失；
 * - 若在任一侧改过标题等文字且另一侧无备份（或需同步标题），自动映射填充。
 */
export function toggleTemplateMode(page, pack, pageIndex = 0) {
  if (!canToggleTemplateMode(page, pack)) return false;
  const fidelityLayouts = pack.layouts.filter((l) => !isElasticLayout(l.id));
  const elasticLayouts = pack.layouts.filter((l) => isElasticLayout(l.id));

  if (isElasticLayout(page.layout)) {
    // 弹性 -> 保真
    const currentElasticSnap = extractPlainFields(page);
    page.elasticLayout = page.layout;
    page.elasticBackup = { layout: page.layout, fields: currentElasticSnap };

    const fallbackFidelity = fidelityLayouts[Math.min(pageIndex, fidelityLayouts.length - 1)] || fidelityLayouts[0];
    const targetId = (page.fidelityLayout && fidelityLayouts.some((l) => l.id === page.fidelityLayout))
      ? page.fidelityLayout
      : fallbackFidelity.id;
    const fidelitySpec = fidelityLayouts.find((l) => l.id === targetId) || fallbackFidelity;

    clearPlainFields(page);
    page.layout = fidelitySpec.id;
    page.fidelityLayout = fidelitySpec.id;
    const restored = (page.fidelityBackup?.layout === fidelitySpec.id && page.fidelityBackup?.fields)
      ? structuredClone(page.fidelityBackup.fields)
      : buildFidelityFromElastic(currentElasticSnap, fidelitySpec);
    Object.assign(page, restored);
    return { mode: 'fidelity', layout: page.layout };
  }

  // 保真 -> 弹性
  const currentFidelitySnap = extractPlainFields(page);
  const currentSpec = fidelityLayouts.find((l) => l.id === page.layout);
  page.fidelityLayout = page.layout;
  page.fidelityBackup = { layout: page.layout, fields: currentFidelitySnap };

  const defaultElastic = currentSpec?.role === 'cover'
    ? 'elastic-cover'
    : currentSpec?.role === 'closing'
      ? 'elastic-summary'
      : currentSpec?.role === 'toc' || currentSpec?.role === 'section'
        ? 'elastic-objectives'
        : 'elastic-concept';
  const targetId = (page.elasticLayout && elasticLayouts.some((l) => l.id === page.elasticLayout))
    ? page.elasticLayout
    : defaultElastic;
  const elasticSpec = elasticLayouts.find((l) => l.id === targetId) || elasticLayouts[0];

  clearPlainFields(page);
  page.layout = elasticSpec.id;
  page.elasticLayout = elasticSpec.id;
  const restored = (page.elasticBackup?.layout === elasticSpec.id && page.elasticBackup?.fields)
    ? structuredClone(page.elasticBackup.fields)
    : buildElasticFromFidelity(currentFidelitySnap, elasticSpec);
  Object.assign(page, restored);
  return { mode: 'elastic', layout: page.layout };
}
