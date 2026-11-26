import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { renameRetry } from '../src/fs-retry.mjs';

const REF_RE = /^[\p{L}\p{N}_-]{1,120}$/u;
const ASSET_FILE_RE = /^img-\d+\.(png|jpe?g|gif|webp|bmp)$/i;
const assetLocks = new Map();

function withAssetLock(key, fn) {
  const prev = assetLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = () => { if (assetLocks.get(key) === next) assetLocks.delete(key); };
  next.then(cleanup, cleanup);
  assetLocks.set(key, next);
  return next;
}

async function statDirFiles(dir, filterFn = () => true) {
  let count = 0, bytes = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    if (!ent.isFile() || !filterFn(ent.name)) continue;
    const st = await fs.stat(path.join(dir, ent.name)).catch(() => null);
    if (st) { count++; bytes += st.size; }
  }
  return { count, bytes };
}

/** 统计本机缓存与素材占用（不含用户密钥、课件正文、教材与试卷） */
export async function getCacheStats(root, drafts = new Map()) {
  const widgetsDir = path.join(root, 'app-data', 'widgets');
  const examplesDir = path.join(root, 'examples');
  const phet = await statDirFiles(widgetsDir, (n) => /^phet-.*\.html$/i.test(n));
  const prev = await statDirFiles(examplesDir, (n) => n.endsWith('.deck.json.prev'));
  let draftBytes = 0;
  for (const d of drafts.values()) draftBytes += d?.bytes || Buffer.byteLength(d?.html || '', 'utf8');
  const groups = await listAssetGroups(root);
  const assets = {
    groups: groups.length,
    count: groups.reduce((s, g) => s + g.count, 0),
    bytes: groups.reduce((s, g) => s + g.bytes, 0),
  };
  return {
    phet,
    drafts: { count: drafts.size, bytes: draftBytes },
    prev,
    assets,
  };
}

/** 清理指定缓存：'phet' | 'drafts' | 'all' */
export async function clearCache(root, drafts = new Map(), target = 'drafts') {
  const removed = { phet: 0, drafts: 0, prev: 0 };
  const failed = { phet: 0, prev: 0 };
  if (target === 'phet' || target === 'all') {
    const widgetsDir = path.join(root, 'app-data', 'widgets');
    const entries = await fs.readdir(widgetsDir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (ent.isFile() && /^phet-.*\.html$/i.test(ent.name)) {
        try {
          await fs.rm(path.join(widgetsDir, ent.name), { force: true });
          removed.phet++;
        } catch {
          failed.phet++;
        }
      }
    }
  }
  if (target === 'drafts' || target === 'all') {
    removed.drafts = drafts.size;
    drafts.clear();
    const examplesDir = path.join(root, 'examples');
    const entries = await fs.readdir(examplesDir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith('.deck.json.prev')) {
        try {
          await fs.rm(path.join(examplesDir, ent.name), { force: true });
          removed.prev++;
        } catch {
          failed.prev++;
        }
      }
    }
  }
  const hasFailed = failed.phet > 0 || failed.prev > 0;
  return { ok: !hasFailed, removed, failed, stats: await getCacheStats(root, drafts) };
}

/** 列出素材库中的所有素材组（PPT 参照抽图、教材插图等） */
export async function listAssetGroups(root) {
  const assetsRoot = path.join(root, 'assets');
  const entries = await fs.readdir(assetsRoot, { withFileTypes: true }).catch(() => []);
  const groups = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || !REF_RE.test(ent.name)) continue;
    const dir = path.join(assetsRoot, ent.name);
    const manifestRaw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => null);
    if (!manifestRaw) continue;
    let manifest;
    try { manifest = JSON.parse(manifestRaw); } catch { continue; }
    if (!Array.isArray(manifest) || !manifest.length) continue;
    const refMeta = await fs.readFile(path.join(root, 'references', ent.name, 'reference.json'), 'utf8')
      .then((s) => JSON.parse(s))
      .catch(() => null);
    let bytes = 0;
    for (const item of manifest) {
      if (!ASSET_FILE_RE.test(String(item?.file || ''))) continue;
      const st = await fs.stat(path.join(dir, item.file)).catch(() => null);
      if (st) bytes += st.size;
    }
    groups.push({
      ref: ent.name,
      name: refMeta?.name || (ent.name.startsWith('book-') ? '教材插图 · ' + ent.name : ent.name),
      preview: refMeta?.preview === true,
      count: manifest.length,
      bytes,
    });
  }
  return groups;
}

const IMAGE_FIELD_KEYS = new Set(['background', 'img', 'image', 'figure', 'picture', 'photo', 'src']);

function collectDeckImageRefs(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectDeckImageRefs(item, out);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'notes') continue;
    if (typeof v === 'string' && IMAGE_FIELD_KEYS.has(k)) {
      out.push(v);
    } else if (v && typeof v === 'object') {
      collectDeckImageRefs(v, out);
    }
  }
}

/** 检查待删素材是否仍被 examples/*.deck.json 中的已保存课件图片字段引用（忽略讲稿等纯文本） */
export async function findAssetReferences(root, ref, files) {
  const examplesDir = path.join(root, 'examples');
  const entries = await fs.readdir(examplesDir, { withFileTypes: true }).catch(() => []);
  const targets = files.map((f) => ({ file: f, needle: `${ref}/${f}` }));
  const hits = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.deck.json')) continue;
    const raw = await fs.readFile(path.join(examplesDir, ent.name), 'utf8').catch(() => '');
    if (!raw || !raw.includes(ref + '/')) continue;
    let deck;
    try { deck = JSON.parse(raw); } catch { continue; }
    const imageValues = [];
    collectDeckImageRefs(deck?.pages, imageValues);
    const matchedFiles = targets
      .filter((t) => imageValues.some((val) => val === t.needle || val.endsWith('/' + t.needle)))
      .map((t) => t.file);
    if (!matchedFiles.length) continue;
    const title = deck?.meta?.title || ent.name.slice(0, -'.deck.json'.length);
    hits.push({ deck: ent.name, title, files: matchedFiles });
  }
  return hits;
}

/** 删除指定素材组中的单个或多个图片文件，按组串行防并发覆盖，仅同步移除磁盘实际删除成功的条目 */
export async function deleteAssets(root, ref, files) {
  const cleanRef = String(ref || '');
  if (!REF_RE.test(cleanRef)) throw Error('素材组编号无效');
  const list = Array.isArray(files) ? files : (typeof files === 'string' ? [files] : []);
  const validFiles = [...new Set(list.map(String).filter((f) => ASSET_FILE_RE.test(f)))];
  if (!validFiles.length) throw Error('请选择要删除的素材');

  const dir = path.join(root, 'assets', cleanRef);
  return withAssetLock(path.resolve(dir), async () => {
    const refs = await findAssetReferences(root, cleanRef, validFiles);
    if (refs.length) {
      const detail = refs.slice(0, 3).map((r) => `「${r.title}」（${r.files.join('、')}）`).join('、');
      throw Error(`以下素材仍被已保存课件引用，请先从对应课件移除后再删除：${detail}`);
    }

    const manifestPath = path.join(dir, 'manifest.json');
    const raw = await fs.readFile(manifestPath, 'utf8').catch(() => { throw Error('素材组不存在'); });
    const manifest = JSON.parse(raw);
    if (!Array.isArray(manifest)) throw Error('素材索引损坏');

    const actuallyDeleted = new Set();
    const failedFiles = [];
    for (const f of validFiles) {
      try {
        await fs.rm(path.join(dir, f), { force: true });
        actuallyDeleted.add(f);
      } catch {
        failedFiles.push(f);
      }
    }

    if (failedFiles.length && !actuallyDeleted.size) {
      throw Error(`素材文件正被其他程序占用，无法删除：${failedFiles.join('、')}`);
    }

    const remaining = manifest.filter((item) => !actuallyDeleted.has(item?.file));
    const deletedCount = manifest.length - remaining.length;

    if (remaining.length === 0 && !failedFiles.length) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    } else {
      const tmp = path.join(dir, '.manifest-' + crypto.randomUUID());
      try {
        await fs.writeFile(tmp, JSON.stringify(remaining, null, 2) + '\n');
        await renameRetry(tmp, manifestPath);
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    }
    return {
      ok: failedFiles.length === 0,
      ref: cleanRef,
      deleted: deletedCount,
      remaining: remaining.length,
      ...(failedFiles.length ? { failed: failedFiles } : {}),
    };
  });
}
