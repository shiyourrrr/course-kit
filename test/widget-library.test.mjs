import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listWidgetLibrary, fetchPhetWidget, importLocalWidget, deleteLocalWidget } from '../app/widget-library.mjs';

test('widget-library lists builtin/PhET/portals, caches PhET on demand, and imports/deletes local HTML', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-wlib-'));
  try {
    const initial = await listWidgetLibrary(tmpDir);
    assert.ok(initial.builtin.length >= 6);
    assert.ok(initial.phet.length >= 20);
    assert.ok(initial.portals.length >= 4);
    assert.equal(initial.phet[0].cached, false);

    // 模拟联网拉取 PhET 单文件 HTML 并缓存
    let fetchCount = 0;
    const mockFetch = async (url) => {
      fetchCount += 1;
      assert.match(url, /phet\.colorado\.edu\/sims\/html\/ohms-law\/latest\/ohms-law_zh_CN\.html$/);
      return { ok: true, status: 200, text: async () => '<!doctype html><html><body><div>' + 'x'.repeat(2000) + '</div></body></html>' };
    };
    const r1 = await fetchPhetWidget(tmpDir, 'ohms-law', { fetchImpl: mockFetch });
    assert.equal(r1.widgetRef, 'phet-ohms-law');
    assert.equal(fetchCount, 1);

    // 第二次拉取直接命中本地缓存，不再联网
    const r2 = await fetchPhetWidget(tmpDir, 'ohms-law', { fetchImpl: mockFetch });
    assert.equal(r2.widgetRef, 'phet-ohms-law');
    assert.equal(fetchCount, 1);

    // 导入本地离线 HTML 并删除
    const imp = await importLocalWidget(tmpDir, { title: 'GeoGebra 圆锥曲线', subject: '数学', filename: 'conic.html', html: '<!doctype html><html><body><canvas></canvas></body></html>' });
    assert.match(imp.widgetRef, /^local-/);
    const afterImp = await listWidgetLibrary(tmpDir);
    assert.equal(afterImp.local.length, 1);
    assert.equal(afterImp.phet.find(x => x.slug === 'ohms-law').cached, true);

    await deleteLocalWidget(tmpDir, imp.widgetRef);
    const afterDel = await listWidgetLibrary(tmpDir);
    assert.equal(afterDel.local.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('render.mjs inlines widgetRef cached HTML into standalone offline deck', async () => {
  const widgetsDir = path.resolve('app-data/widgets');
  await fs.mkdir(widgetsDir, { recursive: true });
  const refId = 'local-testref1';
  const refFile = path.join(widgetsDir, refId + '.html');
  const tmpDeck = path.join(os.tmpdir(), 'ck-wref.deck.json');
  const tmpOut = path.join(os.tmpdir(), 'ck-wref.html');
  try {
    await fs.writeFile(refFile, '<!doctype html><html><body><div id="phet-mock">OHM</div></body></html>');
    await fs.writeFile(tmpDeck, JSON.stringify({
      pack: 'math-junior',
      pages: [{ layout: 'cover', title: '演示页', freeBlocks: [{ id: 'w1', type: 'widget', widgetRef: refId, x: 100, y: 100, w: 600, h: 400 }] }],
    }));
    execFileSync(process.execPath, ['src/render.mjs', tmpDeck, '--out', tmpOut]);
    const html = await fs.readFile(tmpOut, 'utf8');
    assert.match(html, /class="ck-widget"/);
    assert.match(html, /phet-mock/);
  } finally {
    await fs.rm(refFile, { force: true });
    await fs.rm(tmpDeck, { force: true });
    await fs.rm(tmpOut, { force: true });
  }
});

import { normalizeEmbedUrl, saveEmbedWidget } from '../app/widget-library.mjs';

test('normalizeEmbedUrl converts GeoGebra/Desmos links and render.mjs embeds embedUrl cleanly', async () => {
  const ggb = normalizeEmbedUrl('https://www.geogebra.org/m/abc12345');
  assert.equal(ggb.provider, 'GeoGebra');
  assert.match(ggb.embedUrl, /geogebra\.org\/material\/iframe\/id\/abc12345/);

  const desmos = normalizeEmbedUrl('https://www.desmos.com/calculator/xyz999');
  assert.equal(desmos.provider, 'Desmos');
  assert.match(desmos.embedUrl, /\?embed$/);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-wembed-'));
  const tmpDeck = path.join(os.tmpdir(), 'ck-wembed.deck.json');
  const tmpOut = path.join(os.tmpdir(), 'ck-wembed.html');
  try {
    const saved = await saveEmbedWidget(tmpDir, { title: '圆锥曲线', subject: '数学', url: 'https://www.geogebra.org/m/abc12345' });
    assert.match(saved.widgetRef, /^embed-/);
    const listed = await listWidgetLibrary(tmpDir);
    assert.equal(listed.local.length, 1);

    await fs.writeFile(tmpDeck, JSON.stringify({
      pack: 'math-junior',
      pages: [{ layout: 'cover', title: 'GGB', freeBlocks: [{ id: 'e1', type: 'widget', embedUrl: saved.embedUrl, x: 100, y: 100, w: 800, h: 480 }] }],
    }));
    execFileSync(process.execPath, ['src/render.mjs', tmpDeck, '--out', tmpOut]);
    const html = await fs.readFile(tmpOut, 'utf8');
    assert.match(html, /geogebra\.org\/material\/iframe\/id\/abc12345/);

    await deleteLocalWidget(tmpDir, saved.widgetRef);
    const afterDel = await listWidgetLibrary(tmpDir);
    assert.equal(afterDel.local.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(tmpDeck, { force: true });
    await fs.rm(tmpOut, { force: true });
  }
});
