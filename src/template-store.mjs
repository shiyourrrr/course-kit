import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renameRetry } from './fs-retry.mjs';

const BUILTIN_PACKS = new Set(['math-junior', 'cinema']);
const HIDDEN_PACKS = new Set(['general-elastic']);

async function readJson(file) {
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

function validPackId(id) {
  return typeof id === 'string' && /^[\p{L}\p{N}_-]{1,100}$/u.test(id) && !HIDDEN_PACKS.has(id) && !id.startsWith('pptx-');
}

function extractCssPalette(cssText = '') {
  const colors = [];
  for (const m of String(cssText).matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const upper = m[0].toUpperCase();
    if (!colors.includes(upper)) colors.push(upper);
    if (colors.length >= 6) break;
  }
  return colors;
}

/**
 * 列出所有可用模板（排除内部支撑包 general-elastic），返回预览、配色、角色分布与可编辑标记。
 */
export async function listTemplates(rootDir) {
  const packsDir = path.join(rootDir, 'packs');
  const entries = await fs.readdir(packsDir, { withFileTypes: true }).catch(() => []);
  const items = [];

  for (const d of entries) {
    if (!d.isDirectory() || !validPackId(d.name)) continue;
    const packFile = path.join(packsDir, d.name, 'pack.json');
    const pack = await readJson(packFile).catch(() => null);
    if (!pack) continue;

    const builtin = BUILTIN_PACKS.has(d.name);
    const kind = builtin
      ? 'builtin'
      : pack.kind === 'user-template'
        ? 'user-template'
        : 'imported';
    const slug = d.name.startsWith('user-template-') ? d.name.slice('user-template-'.length) : '';
    let palette = Array.isArray(pack.skin?.palette) ? pack.skin.palette.slice(0, 6) : [];
    if (!palette.length && slug) {
      const ref = await readJson(path.join(rootDir, 'references', slug, 'reference.json')).catch(() => null);
      if (Array.isArray(ref?.palette)) palette = ref.palette.slice(0, 6);
    }
    if (!palette.length) {
      const themeCss = await fs.readFile(path.join(packsDir, d.name, pack.theme || 'theme.css'), 'utf8').catch(() => '');
      palette = extractCssPalette(themeCss);
    }

    const roles = {};
    for (const l of pack.layouts || []) {
      const r = l.role || 'content';
      roles[r] = (roles[r] || 0) + 1;
    }

    const hasRefPreview = Boolean(slug && fsSync.existsSync(path.join(rootDir, 'references', slug, 'source.deck.json')));
    const stat = await fs.stat(packFile).catch(() => ({ mtimeMs: 0 }));

    items.push({
      id: pack.id || d.name,
      name: pack.name || d.name,
      kind,
      subject: pack.subject || '通用',
      grade: pack.grade || '通用',
      pages: (pack.layouts || []).length,
      roles,
      palette,
      referenceSlug: slug || null,
      editable: !builtin,
      mtime: stat.mtimeMs,
      previewUrl: hasRefPreview
        ? `/api/reference-preview?slug=${encodeURIComponent(slug)}`
        : `/api/template-preview?id=${encodeURIComponent(d.name)}`,
    });
  }

  // 用户导入模板按最近修改优先排在前面，系统内置紧随其后
  items.sort((a, b) => {
    if (a.editable !== b.editable) return a.editable ? -1 : 1;
    return b.mtime - a.mtime;
  });
  return items;
}

/**
 * 重命名用户导入模板（原子写盘 + 同步更新关联 reference.json / source.deck.json）。
 */
export async function renameTemplate(rootDir, packId, newName) {
  if (!validPackId(packId)) throw new Error('模板编号无效');
  if (BUILTIN_PACKS.has(packId)) throw new Error('系统内置模板不能重命名');
  const title = String(newName || '').trim();
  if (!title || title.length > 60) throw new Error('请输入 1~60 字的模板名称');

  const packFile = path.join(rootDir, 'packs', packId, 'pack.json');
  const pack = await readJson(packFile);
  pack.name = title;

  const writeAtomic = async (targetFile, obj) => {
    const tmp = `${targetFile}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
      await renameRetry(tmp, targetFile);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  };

  await writeAtomic(packFile, pack);

  if (packId.startsWith('user-template-')) {
    const slug = packId.slice('user-template-'.length);
    const refFile = path.join(rootDir, 'references', slug, 'reference.json');
    const ref = await readJson(refFile).catch(() => null);
    if (ref) {
      ref.name = title;
      await writeAtomic(refFile, ref);
    }
    const srcDeckFile = path.join(rootDir, 'references', slug, 'source.deck.json');
    const srcDeck = await readJson(srcDeckFile).catch(() => null);
    if (srcDeck) {
      srcDeck.meta = { ...(srcDeck.meta || {}), title };
      await writeAtomic(srcDeckFile, srcDeck);
    }
  }
  return { ok: true, id: packId, name: title };
}

/**
 * 删除用户导入模板（保护内置模板与正在被现有课件使用的模板）。
 */
export async function deleteTemplate(rootDir, packId) {
  if (!validPackId(packId)) throw new Error('模板编号无效');
  if (BUILTIN_PACKS.has(packId)) throw new Error('系统内置模板不能删除');
  const packDir = path.join(rootDir, 'packs', packId);
  const stat = await fs.stat(packDir).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('找不到该模板');

  // 检查 examples 下是否有课件正在使用此模板
  const examplesDir = path.join(rootDir, 'examples');
  const files = (await fs.readdir(examplesDir).catch(() => [])).filter((f) => f.endsWith('.deck.json'));
  const inUse = [];
  for (const file of files) {
    const deck = await readJson(path.join(examplesDir, file)).catch(() => null);
    if (deck?.pack === packId) inUse.push(deck.meta?.title || file.slice(0, -10));
  }
  if (inUse.length) {
    throw new Error(`该模板正在被课件「${inUse.slice(0, 2).join('、')}」使用，请先删除或另存相关课件`);
  }

  await fs.rm(packDir, { recursive: true, force: true });
  if (packId.startsWith('user-template-')) {
    const slug = packId.slice('user-template-'.length);
    if (/^ref-[\p{L}\p{N}_-]+$/u.test(slug)) {
      await fs.rm(path.join(rootDir, 'references', slug), { recursive: true, force: true }).catch(() => {});
    }
  }
  return { ok: true, id: packId };
}

/**
 * 为任意模板构建一份可即时渲染预览的样张 deck 对象。
 */
export async function buildTemplatePreviewDeck(rootDir, packId) {
  if (!validPackId(packId)) throw new Error('模板编号无效');
  if (packId.startsWith('user-template-')) {
    const slug = packId.slice('user-template-'.length);
    const srcFile = path.join(rootDir, 'references', slug, 'source.deck.json');
    const existing = await readJson(srcFile).catch(() => null);
    if (existing) return existing;
  }
  if (packId === 'math-junior') {
    const gougu = await readJson(path.join(rootDir, 'examples', 'gougu.deck.json')).catch(() => null);
    if (gougu) return { ...gougu, pages: gougu.pages.slice(0, 6) };
  }
  if (packId === 'cinema') {
    const cine = await readJson(path.join(rootDir, 'examples', 'cinema-gougu.deck.json')).catch(() => null);
    if (cine) return cine;
  }
  const pack = await readJson(path.join(rootDir, 'packs', packId, 'pack.json'));
  const pages = (pack.layouts || []).slice(0, 8).map((l, idx) => {
    const p = { layout: l.id };
    for (const slot of l.slots || []) {
      const [base, child] = slot.split('[].');
      const key = base.split('.').pop();
      if (child) {
        p[key] = [{ [child]: `${l.name || l.id} · 示例条目 1` }, { [child]: '示例条目 2' }];
      } else {
        p[key] = l.slotLabels?.[slot] || (key === 'title' ? `${pack.name} · 第 ${idx + 1} 页` : `示例内容（${key}）`);
      }
    }
    return p;
  });
  return { pack: packId, meta: { title: pack.name || packId }, pages };
}
