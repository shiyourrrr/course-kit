import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shorten, length } from '../app/edit.mjs';
import { paletteCss } from '../tools/reference-map.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ELASTIC_DIR = path.join(ROOT, 'packs', 'general-elastic');

const SHORT_ROLES = new Set(['cover', 'toc', 'section', 'closing']);

// 将预设课型的通用页型名映射到独立通用弹性包的页型 ID
const TO_ELASTIC_ID = {
  cover: 'elastic-cover',
  objectives: 'elastic-objectives',
  context: 'elastic-context',
  concept: 'elastic-concept',
  explain: 'elastic-concept',
  table: 'elastic-compare',
  formula: 'elastic-formula',
  derive: 'elastic-derive',
  example: 'elastic-example',
  exercise: 'elastic-example',
  variant: 'elastic-practice',
  mistake: 'elastic-compare',
  wrong: 'elastic-example',
  score: 'elastic-objectives',
  practice: 'elastic-practice',
  compare: 'elastic-compare',
  summary: 'elastic-summary',
  homework: 'elastic-homework',
};

const DEFAULT_CONTENT_SEQUENCE = [
  'elastic-objectives',
  'elastic-concept',
  'elastic-formula',
  'elastic-derive',
  'elastic-example',
  'elastic-practice',
  'elastic-summary',
  'elastic-homework',
];

let cachedElasticPack = null;
export function loadElasticPack(packsRoot = path.join(ROOT, 'packs')) {
  const file = path.join(packsRoot, 'general-elastic', 'pack.json');
  const fallback = path.join(ELASTIC_DIR, 'pack.json');
  const target = fs.existsSync(file) ? file : fallback;
  if (!fs.existsSync(target)) return null;
  if (target === fallback && cachedElasticPack) return cachedElasticPack;
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
  if (target === fallback) cachedElasticPack = parsed;
  return parsed;
}

export function isUserTemplatePack(pack) {
  return pack?.kind === 'user-template';
}

/**
 * 为编辑器/生成器/校验器合并导入模板包与通用弹性页型（不修改磁盘上的 pack.json，保持 /api/packs 原样）。
 */
export function enrichUserTemplatePack(pack, packsRoot) {
  if (!isUserTemplatePack(pack)) return pack;
  const elastic = loadElasticPack(packsRoot);
  if (!elastic) return pack;
  const existingIds = new Set((pack.layouts || []).map((l) => l.id));
  const mergedLayouts = [
    ...(pack.layouts || []),
    ...elastic.layouts.filter((l) => !existingIds.has(l.id)),
  ];
  return {
    ...pack,
    limits: { ...elastic.limits, ...(pack.limits || {}) },
    layouts: mergedLayouts,
  };
}

/**
 * 按「短文本页保真（cover/toc/section/closing），内容页弹性重排」生成混合骨架：
 * - 若模板含专门的 closing 致谢页且排在说明尾页之前，自动将致谢页放到整节课末尾；
 * - 每一页同时记录 fidelityLayout 与 elasticLayout，供编辑器一键双向可逆改道。
 */
export function buildHybridSkeleton(rawPack, lessonTypePages = [], mode = 'lesson') {
  const fidelityLayouts = (rawPack?.layouts || []).filter((l) => !String(l.id).startsWith('elastic-'));
  if (!fidelityLayouts.length) return [];

  if (mode === 'homework') {
    const cover = fidelityLayouts.find((l) => l.role === 'cover') || fidelityLayouts[0];
    const closing = fidelityLayouts.find((l) => l.role === 'closing');
    const contentFidelity = fidelityLayouts.find((l) => l.role === 'content') || fidelityLayouts[0];
    const hwPageCount = Math.max(1, lessonTypePages.filter((id) => id === 'homework').length, lessonTypePages.length >= 6 ? 2 : 1);
    const seq = [
      { layout: cover.id, role: 'cover', fidelityLayout: cover.id, elasticLayout: 'elastic-cover' },
      { layout: 'elastic-example', role: 'content', fidelityLayout: contentFidelity.id, elasticLayout: 'elastic-example' },
      { layout: 'elastic-practice', role: 'content', fidelityLayout: contentFidelity.id, elasticLayout: 'elastic-practice' },
      ...Array.from({ length: hwPageCount }, () => ({ layout: 'elastic-homework', role: 'content', fidelityLayout: contentFidelity.id, elasticLayout: 'elastic-homework' })),
    ];
    if (closing && closing.id !== cover.id) {
      seq.push({ layout: closing.id, role: 'closing', fidelityLayout: closing.id, elasticLayout: 'elastic-summary' });
    }
    return seq;
  }

  // 把预设课型里的内容页序列转成弹性页型池，同时保证核心教学环节（概念/推导/例题/练习/小结/作业）齐全
  const mappedPool = lessonTypePages
    .filter((id) => id !== 'cover' && TO_ELASTIC_ID[id])
    .map((id) => TO_ELASTIC_ID[id]);
  const contentPool = mappedPool.length >= 6 ? mappedPool : DEFAULT_CONTENT_SEQUENCE;

  // 若模板存在 closing 页且后面跟着版权/模板说明页，把 closing 移到最后一页
  const ordered = fidelityLayouts.slice();
  const closingIdx = ordered.findIndex((l) => l.role === 'closing');
  if (closingIdx >= 0 && closingIdx < ordered.length - 1 && ordered.at(-1)?.role === 'content') {
    const [closingSlide] = ordered.splice(closingIdx, 1);
    ordered.push(closingSlide);
  }

  const contentIndices = ordered
    .map((l, idx) => (SHORT_ROLES.has(l.role) ? -1 : idx))
    .filter((idx) => idx >= 0);

  // 确保内容页覆盖完整的教学闭环（概念/推导/例题/练习/小结/作业）
  const pickElasticForContent = (pos, totalContent) => {
    const presets = {
      6: ['elastic-concept', 'elastic-derive', 'elastic-example', 'elastic-practice', 'elastic-summary', 'elastic-homework'],
      7: ['elastic-objectives', 'elastic-concept', 'elastic-derive', 'elastic-example', 'elastic-practice', 'elastic-summary', 'elastic-homework'],
      8: ['elastic-objectives', 'elastic-concept', 'elastic-formula', 'elastic-derive', 'elastic-example', 'elastic-practice', 'elastic-summary', 'elastic-homework'],
      9: ['elastic-objectives', 'elastic-context', 'elastic-concept', 'elastic-formula', 'elastic-derive', 'elastic-example', 'elastic-practice', 'elastic-summary', 'elastic-homework'],
    };
    if (presets[totalContent]) return presets[totalContent][pos];
    if (totalContent >= 10) {
      const tail = ['elastic-derive', 'elastic-example', 'elastic-practice', 'elastic-summary', 'elastic-homework'];
      const tailStart = totalContent - tail.length;
      if (pos >= tailStart) return tail[pos - tailStart];
      if (pos === 0) return 'elastic-objectives';
      if (pos === 1) return 'elastic-concept';
    }
    if (pos === totalContent - 1) return 'elastic-homework';
    if (pos === totalContent - 2 && totalContent >= 3) return 'elastic-summary';
    return contentPool[pos % contentPool.length] || 'elastic-concept';
  };

  let contentCursor = 0;
  return ordered.map((l) => {
    const role = l.role || (l.id === 'page-1' ? 'cover' : 'content');
    if (SHORT_ROLES.has(role)) {
      const fallbackElastic = role === 'cover'
        ? 'elastic-cover'
        : role === 'closing'
          ? 'elastic-summary'
          : 'elastic-objectives';
      return {
        layout: l.id,
        role,
        fidelityLayout: l.id,
        elasticLayout: fallbackElastic,
      };
    }
    const elasticId = pickElasticForContent(contentCursor, contentIndices.length);
    contentCursor += 1;
    return {
      layout: elasticId,
      role: 'content',
      fidelityLayout: l.id,
      elasticLayout: elasticId,
    };
  });
}

/**
 * 构建供 AI 生成提示词参考的每页槽位字数预算说明。
 */
export function buildPromptSlotBudgets(skeleton, enrichedPack) {
  const budgets = {};
  for (const item of skeleton) {
    const spec = enrichedPack.layouts.find((l) => l.id === item.layout);
    if (!spec) continue;
    if (spec.slotSpecs) {
      budgets[item.layout] = Object.fromEntries(
        Object.entries(spec.slotSpecs)
          .filter(([, v]) => !v.decorative)
          .map(([k, v]) => [k, { max: v.max, min: v.min }])
      );
    } else if (enrichedPack.limits) {
      const perLayout = {};
      for (const slot of spec.slots || []) {
        const leaf = slot.split('[].').pop().split('.').pop();
        if (enrichedPack.limits[leaf]) perLayout[slot] = { max: enrichedPack.limits[leaf] };
      }
      budgets[item.layout] = perLayout;
    }
  }
  return budgets;
}

/**
 * 初次生成后的硬兜底（绝不将内容页字号缩到 18px 以下）：
 * 1. 保真短文本页：严格按槽位几何预算裁剪超长文本，防止固定高度框溢出；
 * 2. 弹性内容页：字段遵守上限；若数组条目超出页型安全容量或整页文本过密，自动拆分为两页弹性页（标题 + 标题（续））。
 */
export function enforceHybridBudgetsAndSplit(pages, enrichedPack) {
  const limits = enrichedPack?.limits || {};
  const result = [];

  // 21px 正文在 1280×720 弹性画布中的实测不溢出安全容量
  const SAFE_ARRAY_CAP = {
    'elastic-objectives': { key: 'items', maxItems: 4, itemBudget: 44 },
    'elastic-concept': { key: 'items', maxItems: 3, itemBudget: 48 },
    'elastic-derive': { key: 'steps', maxItems: 3, itemBudget: 52 },
    'elastic-example': { key: 'steps', maxItems: 3, itemBudget: 52 },
    'elastic-summary': { key: 'points', maxItems: 4, itemBudget: 50 },
    'elastic-homework': { key: 'tasks', maxItems: 4, itemBudget: 52 },
  };

  for (const page of pages) {
    const spec = enrichedPack?.layouts?.find((l) => l.id === page.layout);
    if (!spec) {
      result.push(page);
      continue;
    }

    // 1) 保真页：按几何算出的 slotSpecs.max 严格守住短框
    if (!String(page.layout).startsWith('elastic-') && spec.slotSpecs) {
      const next = { ...page };
      for (const slot of spec.slots || []) {
        const max = spec.slotSpecs[slot]?.max;
        if (max && typeof next[slot] === 'string' && length(next[slot]) > max) {
          next[slot] = shorten(next[slot], max, slot);
        }
      }
      result.push(next);
      continue;
    }

    // 2) 弹性内容页：先约束单字段长度，再检查条目容量，超容量自动拆页（保持字号 >= 18px）
    const copy = structuredClone(page);
    for (const [k, v] of Object.entries(copy)) {
      if (['layout', 'notes', 'fidelityLayout', 'elasticLayout', 'anim', 'stagger', 'speed', 'css', 'background', 'veil'].includes(k)) continue;
      if (typeof v === 'string' && limits[k] && k !== 'formula' && length(v) > limits[k]) {
        copy[k] = shorten(v, limits[k], k);
      } else if (Array.isArray(v)) {
        for (const row of v) {
          if (!row || typeof row !== 'object') continue;
          for (const [rk, rv] of Object.entries(row)) {
            if (typeof rv === 'string' && limits[rk] && length(rv) > limits[rk]) {
              row[rk] = shorten(rv, limits[rk], rk);
            }
          }
        }
      }
    }

    if (copy.layout === 'elastic-compare') {
      for (const side of ['left', 'right']) {
        if (Array.isArray(copy[side]?.items) && copy[side].items.length > 3) {
          copy[side].items = copy[side].items.slice(0, 3);
        }
      }
      result.push(copy);
      continue;
    }

    const rule = SAFE_ARRAY_CAP[copy.layout];
    if (rule && Array.isArray(copy[rule.key])) {
      const arr = copy[rule.key];
      for (const item of arr) {
        if (item && typeof item.text === 'string' && length(item.text) > rule.itemBudget) {
          item.text = shorten(item.text, rule.itemBudget, 'text');
        }
      }
      if (arr.length > rule.maxItems) {
        for (let offset = 0; offset < arr.length; offset += rule.maxItems) {
          const chunk = arr.slice(offset, offset + rule.maxItems);
          const part = structuredClone(copy);
          part[rule.key] = chunk;
          if (offset > 0) {
            part.title = String(copy.title || '内容').replace(/（续\d*）$/, '') + '（续）';
            delete part.lead;
            delete part.goal;
            delete part.stem;
            delete part.notes;
          }
          if (offset + rule.maxItems < arr.length) {
            delete part.answer;
            delete part.conclusion;
            delete part.closing;
          }
          result.push(part);
        }
        continue;
      }
    }

    result.push(copy);
  }

  return result;
}

/**
 * 生成导入模板皮肤样式（主色/强调色变量 + 模板同源装饰徽记），注入到混合课件 deck.css。
 */
export function buildTemplateSkinCss(rawPack, rootDir = ROOT, fallbackPalette = []) {
  const slug = String(rawPack?.id || '').replace(/^user-template-/, '');
  let palette = rawPack?.skin?.palette || fallbackPalette || [];
  if (!palette.length && slug) {
    const refJson = path.join(rootDir, 'references', slug, 'reference.json');
    if (fs.existsSync(refJson)) {
      try {
        palette = JSON.parse(fs.readFileSync(refJson, 'utf8')).palette || [];
      } catch {}
    }
  }
  const base = palette.length ? paletteCss(palette) : '';
  let motifRel = rawPack?.skin?.motifAsset || '';
  if (!motifRel && slug) {
    const manifestFile = path.join(rootDir, 'assets', slug, 'manifest.json');
    if (fs.existsSync(manifestFile)) {
      try {
        const list = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        const candidate = list.find((a) => a.type !== 'photo' && a.width >= 32 && a.width <= 640) || list[0];
        if (candidate?.file) motifRel = `${slug}/${candidate.file}`;
      } catch {}
    }
  }
  let motifRule = '';
  if (typeof motifRel === 'string' && /^[\p{L}\p{N}_-]+\/img-\d+\.(?:png|jpe?g|webp|gif)$/iu.test(motifRel)) {
    const abs = path.join(rootDir, 'assets', motifRel);
    if (fs.existsSync(abs) && fs.statSync(abs).size <= 512 * 1024) {
      const ext = path.extname(abs).slice(1).toLowerCase().replace('jpg', 'jpeg');
      const b64 = fs.readFileSync(abs).toString('base64');
      motifRule = `\n:root { --ck-skin-motif: url("data:image/${ext};base64,${b64}"); }`;
    }
  }
  return (base + motifRule).trim();
}
