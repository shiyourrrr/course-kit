import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCacheStats, clearCache, listAssetGroups, deleteAssets } from '../app/cache-store.mjs';

test('cache-store: getCacheStats & clearCache only delete cache targets and preserve user files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-cache-'));
  try {
    await fs.mkdir(path.join(root, 'app-data', 'widgets'), { recursive: true });
    await fs.mkdir(path.join(root, 'examples'), { recursive: true });
    await fs.writeFile(path.join(root, 'app-data', 'widgets', 'phet-ohms-law.html'), '<html>phet</html>');
    await fs.writeFile(path.join(root, 'app-data', 'widgets', 'local-user1.html'), '<html>mine</html>');
    await fs.writeFile(path.join(root, 'examples', 'demo.deck.json'), '{}');
    await fs.writeFile(path.join(root, 'examples', 'demo.deck.json.prev'), '{"old":1}');

    const drafts = new Map([['t1', { name: 'demo', html: '<html>draft</html>', bytes: 18 }]]);
    const before = await getCacheStats(root, drafts);
    assert.equal(before.phet.count, 1);
    assert.equal(before.prev.count, 1);
    assert.equal(before.drafts.count, 1);

    const r1 = await clearCache(root, drafts, 'drafts');
    assert.equal(r1.removed.drafts, 1);
    assert.equal(r1.removed.prev, 1);
    assert.equal(drafts.size, 0);
    // 用户课件与 PhET 均未受影响
    assert.ok(await fs.stat(path.join(root, 'examples', 'demo.deck.json')));
    assert.ok(await fs.stat(path.join(root, 'app-data', 'widgets', 'phet-ohms-law.html')));

    const r2 = await clearCache(root, drafts, 'phet');
    assert.equal(r2.removed.phet, 1);
    // 用户本地导入的 .html 完整保留
    assert.ok(await fs.stat(path.join(root, 'app-data', 'widgets', 'local-user1.html')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cache-store: listAssetGroups & deleteAssets support single/batch delete and empty-dir cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-assets-'));
  try {
    const refDir = path.join(root, 'assets', 'ref-demo');
    await fs.mkdir(refDir, { recursive: true });
    await fs.writeFile(path.join(refDir, 'img-1.png'), Buffer.from('1111'));
    await fs.writeFile(path.join(refDir, 'img-2.png'), Buffer.from('22222'));
    await fs.writeFile(path.join(refDir, 'img-3.jpg'), Buffer.from('333333'));
    await fs.writeFile(path.join(refDir, 'manifest.json'), JSON.stringify([
      { file: 'img-1.png', width: 100, height: 100 },
      { file: 'img-2.png', width: 200, height: 100 },
      { file: 'img-3.jpg', width: 300, height: 200 },
    ]));

    const groups1 = await listAssetGroups(root);
    assert.equal(groups1.length, 1);
    assert.equal(groups1[0].count, 3);

    // 单个删除
    const d1 = await deleteAssets(root, 'ref-demo', ['img-1.png']);
    assert.equal(d1.deleted, 1);
    assert.equal(d1.remaining, 2);
    await assert.rejects(() => fs.stat(path.join(refDir, 'img-1.png')));

    // 批量删除剩余全部，应自动清理空目录
    const d2 = await deleteAssets(root, 'ref-demo', ['img-2.png', 'img-3.jpg']);
    assert.equal(d2.deleted, 2);
    assert.equal(d2.remaining, 0);
    await assert.rejects(() => fs.stat(refDir));
    assert.equal((await listAssetGroups(root)).length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('P1-01 & P1-02: concurrent deleteAssets serializes manifest and blocks deleting referenced assets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-assets-lock-'));
  try {
    const refDir = path.join(root, 'assets', 'ref-lock');
    await fs.mkdir(refDir, { recursive: true });
    await fs.mkdir(path.join(root, 'examples'), { recursive: true });
    for (const f of ['img-1.png', 'img-2.png', 'img-3.png']) {
      await fs.writeFile(path.join(refDir, f), Buffer.from('abc'));
    }
    await fs.writeFile(path.join(refDir, 'manifest.json'), JSON.stringify([
      { file: 'img-1.png', width: 100, height: 100 },
      { file: 'img-2.png', width: 100, height: 100 },
      { file: 'img-3.png', width: 100, height: 100 },
    ]));
    // 讲稿中的纯文本提及文件名不应误触发引用拦截
    await fs.writeFile(path.join(root, 'examples', 'note-only.deck.json'), JSON.stringify({
      meta: { title: '讲稿提及测试' },
      pages: [{ layout: 'cover', notes: '记得讲 ref-lock/img-1.png 这张图' }],
    }));
    // 课件真正引用 img-3.png：删除 img-3.png 必须被拦截，防止破坏已保存课件导出
    await fs.writeFile(path.join(root, 'examples', 'used.deck.json'), JSON.stringify({
      meta: { title: '引用测试课' },
      pages: [{ layout: 'cover', freeBlocks: [{ type: 'image', src: 'ref-lock/img-3.png' }] }],
    }));
    await assert.rejects(() => deleteAssets(root, 'ref-lock', ['img-3.png']), /仍被已保存课件引用/);

    // 并发删除 img-1.png（仅在讲稿中被提及，应允许删除）和 img-2.png：最终 manifest 必须只剩 img-3.png
    await Promise.all([
      deleteAssets(root, 'ref-lock', ['img-1.png']),
      deleteAssets(root, 'ref-lock', ['img-2.png']),
    ]);
    const manifest = JSON.parse(await fs.readFile(path.join(refDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.map((x) => x.file), ['img-3.png']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
