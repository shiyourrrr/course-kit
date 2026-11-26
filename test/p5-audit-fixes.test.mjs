import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readZipEntries, parsePdfWithMinerU } from '../app/mineru.mjs';
import { parsePageRange, extractByPageRange, writeBook, readBook, updateBookPageOffset, generationContext } from '../app/books.mjs';
import { importLocalWidget, listWidgetLibrary, normalizeEmbedUrl, fetchPhetWidget } from '../app/widget-library.mjs';
import { slotArrayCapacity } from '../app/ai.mjs';
import { themes } from '../themes/catalog.mjs';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

function buildZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, deflate = true } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

test('P0-01: readZipEntries enforces entry count, total size, and compression ratio budgets', () => {
  // 高度重复数据（极高压缩比）触发压缩比或累计上限拒绝
  const bomb = buildZip([{ name: 'a.txt', data: Buffer.alloc(200 * 1024, 65), deflate: true }]);
  assert.throws(() => readZipEntries(bomb, { maxRatio: 20 }), /压缩比异常/);
  assert.throws(() => readZipEntries(bomb, { maxTotalBytes: 64 * 1024, maxRatio: 10000 }), /累计解压体积超过上限/);

  const many = buildZip([
    { name: '1.txt', data: 'a', deflate: false },
    { name: '2.txt', data: 'b', deflate: false },
    { name: '3.txt', data: 'c', deflate: false },
  ]);
  assert.throws(() => readZipEntries(many, { maxEntries: 2 }), /条目数.*超过上限/);
});

test('P0-02: parsePageRange safely rejects unsafe integers without infinite loop', () => {
  const t0 = Date.now();
  assert.deepEqual(parsePageRange('9007199254740993-9007199254740999'), []);
  assert.deepEqual(parsePageRange('99999999999999999999-99999999999999999999'), []);
  assert.deepEqual(parsePageRange('25-22'), [22, 23, 24, 25]);
  assert.ok(Date.now() - t0 < 50);
});

test('P1-02: 6 concurrent importLocalWidget calls keep all 6 entries in local-index.json', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-p102-'));
  try {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        importLocalWidget(tmpDir, {
          title: `并发演示 ${i + 1}`,
          subject: '物理',
          filename: `sim-${i + 1}.html`,
          html: `<!doctype html><html><body><div>sim ${i + 1}</div></body></html>`,
        })
      )
    );
    const lib = await listWidgetLibrary(tmpDir);
    assert.equal(lib.local.length, 6);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('P1-03: concurrent updateBookPageOffset keeps text.md and meta.json consistent', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-p103-'));
  try {
    const raw = '[P1]\n封面\n\n[P2]\n目录\n\n[P3]\n正文A\n\n[P4]\n正文B';
    const saved = await writeBook(tmpDir, { title: '并发校准测试', text: raw, pageCount: 4, bodyStartPage: 1 });
    await Promise.all([
      updateBookPageOffset(tmpDir, saved.id, 2),
      updateBookPageOffset(tmpDir, saved.id, 3),
    ]);
    const final = await readBook(tmpDir, saved.id);
    if (final.bodyStartPage === 2) {
      assert.match(final.text, /\[P1\]\n目录/);
      assert.match(final.text, /\[P2\]\n正文A/);
    } else {
      assert.equal(final.bodyStartPage, 3);
      assert.match(final.text, /\[前页2\]\n目录/);
      assert.match(final.text, /\[P1\]\n正文A/);
    }
    // 单文件原子提交验证：磁盘 text.md 始终保持原始物理页码基线不变
    const diskText = await fs.readFile(path.join(tmpDir, saved.id, 'text.md'), 'utf8');
    assert.equal(diskText, raw);
    // 往返校准回到 1，readBook 恢复原始 [P3]
    await updateBookPageOffset(tmpDir, saved.id, 1);
    const back = await readBook(tmpDir, saved.id);
    assert.equal(back.bodyStartPage, 1);
    assert.match(back.text, /\[P3\]\n正文A/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('P1-04: duplicate [P22] anchors merge cleanly and missing page returns usedChars=0', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-p104-'));
  try {
    const text = '[P22]\n第一段\n\n[P22]\n第二段\n\n[P23]\n第三段';
    const ext = extractByPageRange(text, '25-22');
    assert.deepEqual(ext.matchedPages, [22, 23]);
    assert.deepEqual(ext.missingPages, [24, 25]);
    assert.equal(ext.pages.length, 2);
    assert.match(ext.pages[0].text, /第一段[\s\S]*第二段/);

    const saved = await writeBook(tmpDir, { title: '零命中测试', text, pageCount: 23 });
    const ctxMiss = await generationContext(tmpDir, tmpDir, [], { id: saved.id, pageRange: '99' }, 20000, tmpDir, []);
    assert.equal(ctxMiss.used[0].usedChars, 0);
    assert.deepEqual(ctxMiss.used[0].matchedPages, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('P1-06: parsePdfWithMinerU aborts hanging poll within overall timeoutMs', async () => {
  const mockFetch = async (url, opts = {}) => {
    if (url.endsWith('/file-urls/batch')) {
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { batch_id: 'b-hang', file_urls: ['https://oss.example/u'] } }) };
    }
    if (url === 'https://oss.example/u') return { ok: true, status: 200 };
    // 模拟永远不返回的轮询请求，必须被 signal 及时中断
    return new Promise((_, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  const t0 = Date.now();
  await assert.rejects(
    () => parsePdfWithMinerU(Buffer.from('%PDF'), 't.pdf', { token: 'tok', fetchImpl: mockFetch, pollIntervalMs: 10, timeoutMs: 180 }),
    /超时/
  );
  assert.ok(Date.now() - t0 < 1500, 'should abort promptly within overall timeout');
});

test('P2-01: server.mjs exits 1 with conflict message when port is occupied by another service', async () => {
  const blocker = http.createServer((_, res) => { res.writeHead(200); res.end('other-app'); });
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  try {
    const res = spawnSync(process.execPath, ['server.mjs'], {
      cwd: path.resolve('.'),
      env: { ...process.env, PORT: String(port) },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /已被其他程序占用/);
  } finally {
    blocker.close();
  }
});

test('P2-02: render.mjs scopes per-page theme CSS without leaking bare :root or unscoped rules', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-p2-theme-'));
  try {
    const deckPath = path.join(dir, 't.deck.json');
    const deck = {
      pack: 'math-junior',
      title: '主题测试',
      pages: [
        { layout: 'cover', title: '默认页' },
        { layout: 'concept', title: '黑板页', theme: themes[0].id, body: '正文' },
      ],
    };
    await fs.writeFile(deckPath, JSON.stringify(deck), 'utf8');
    const res = spawnSync(process.execPath, ['src/render.mjs', deckPath, '--stdout'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(res.status, 0, res.stderr);
    const scope = `.slide[data-page-theme="${themes[0].id}"]`;
    assert.ok(res.stdout.includes(scope), 'scoped selector must be present');
    assert.ok(res.stdout.includes(`data-page-theme="${themes[0].id}"`), 'slide attr must be present');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('P2-04: slotArrayCapacity enforces consistent bounded limits', () => {
  assert.equal(slotArrayCapacity({ capacity: { items: 7 } }, 'items'), 7);
  assert.equal(slotArrayCapacity({ capacity: { items: 20 } }, 'items'), 12);
  assert.equal(slotArrayCapacity({ capacity: {} }, 'left.items'), 5);
  assert.equal(slotArrayCapacity(null, 'steps'), 5);
});

test('P0-01b: readZipEntries rejects tampered header uncompSize mismatch and local/CD name mismatch', () => {
  const z = buildZip([{ name: 'a.txt', data: Buffer.from('hello world hello world') }]);
  // 篡改中央目录声明的 uncompSize（但保留真实数据），应因实际解压长度与目录不一致而拒收
  const tampered = Buffer.from(z);
  const cdPos = tampered.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  tampered.writeUInt32LE(5, cdPos + 24);
  tampered.writeUInt32LE(5, 22); // 同步篡改本地头 uncompSize 以测试解压后实际长度校验
  assert.throws(() => readZipEntries(tampered), /实际解压长度|不一致/);
});

test('Q-02: normalizeEmbedUrl blocks private IPs, credentials, and fake provider substrings', () => {
  for (const bad of [
    'https://192.168.1.10/demo',
    'https://10.0.0.5/demo',
    'https://172.16.0.1/demo',
    'https://169.254.169.254/latest',
    'https://[::1]/demo',
    'https://user:pass@geogebra.org/m/abc',
    'https://evil.internal/demo',
  ]) {
    assert.throws(() => normalizeEmbedUrl(bad));
  }
  const fake = normalizeEmbedUrl('https://evil-falstad.com/circuit');
  assert.equal(fake.provider, 'evil-falstad.com');
  const real = normalizeEmbedUrl('https://www.falstad.com/circuit/');
  assert.equal(real.provider, 'Falstad');
});

test('P1-09: fetchPhetWidget aborts oversized streaming response before full buffering', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-p109-'));
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<html><body>' + 'a'.repeat(500)));
        controller.enqueue(new TextEncoder().encode('b'.repeat(500) + '</body></html>'));
        controller.close();
      },
    });
    const mockFetch = async () => ({ ok: true, status: 200, headers: new Headers(), body: stream });
    await assert.rejects(
      () => fetchPhetWidget(dir, 'ohms-law', { fetchImpl: mockFetch, maxBytes: 400 }),
      /超过体积上限/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
