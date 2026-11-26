import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readZipEntries, parseMinerUZip, parsePdfWithMinerU } from '../app/mineru.mjs';

/** 构造最小标准 ZIP（支持 STORE 与 DEFLATE）用于离线测试 */
function buildTestZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate = false } of files) {
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

test('parseMinerUZip extracts [P] page anchors, LaTeX formulas, and textbook figures', async () => {
  const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 1)]);
  const contentList = [
    { type: 'text', text: '第17章 勾股定理', text_level: 1, page_idx: 0 },
    { type: 'equation', text: 'a^2 + b^2 = c^2', page_idx: 0 },
    { type: 'image', img_path: 'images/fig1.png', image_caption: ['图 17.1-1 赵爽弦图'], page_idx: 1 },
    { type: 'text', text: '例 1 已知直角边为 3 和 4，求斜边。', page_idx: 1 },
  ];
  const zip = buildTestZip([
    { name: 'auto/book_content_list.json', data: JSON.stringify(contentList), deflate: true },
    { name: 'auto/full.md', data: '# 第17章 勾股定理\n\n$a^2+b^2=c^2$', deflate: true },
    { name: 'auto/images/fig1.png', data: fakePng, deflate: false },
  ]);

  const entries = readZipEntries(zip);
  assert.equal(entries.size, 3);

  const tmpAssets = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-mineru-'));
  try {
    const res = await parseMinerUZip(zip, { assetsRoot: tmpAssets, slug: 'book-test1' });
    assert.equal(res.pageCount, 2);
    assert.equal(res.imageCount, 1);
    assert.equal(res.assetRef, 'book-test1');
    assert.match(res.text, /\[P1\]/);
    assert.match(res.text, /\[P2\]/);
    assert.match(res.text, /a\^2 \+ b\^2 = c\^2/);
    assert.match(res.text, /\[教材插图：img-001\.png · 图 17\.1-1 赵爽弦图\]/);

    const manifest = JSON.parse(await fs.readFile(path.join(tmpAssets, 'book-test1', 'manifest.json'), 'utf8'));
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].file, 'img-001.png');
  } finally {
    await fs.rm(tmpAssets, { recursive: true, force: true });
  }
});

test('parsePdfWithMinerU follows v4 batch-upload, clean PUT, poll, and ZIP download flow', async () => {
  const sampleZip = buildTestZip([{ name: 'full.md', data: '# 测试\n正文', deflate: false }]);
  const calls = [];
  let polls = 0;

  const mockFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    if (url.endsWith('/file-urls/batch')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { batch_id: 'b-123', file_urls: ['https://oss.example/upload-1'] } }),
      };
    }
    if (url === 'https://oss.example/upload-1') {
      // 关键断言：PUT 到 OSS 不带 Authorization 头，防止 403
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.headers?.Authorization, undefined);
      return { ok: true, status: 200 };
    }
    if (url.includes('/extract-results/batch/b-123')) {
      polls += 1;
      const state = polls < 2 ? 'running' : 'done';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            extract_result: [{ state, full_zip_url: state === 'done' ? 'https://cdn.example/out.zip' : '' }],
          },
        }),
      };
    }
    if (url === 'https://cdn.example/out.zip') {
      return { ok: true, status: 200, arrayBuffer: async () => sampleZip };
    }
    throw Error('Unexpected URL: ' + url);
  };

  const outZip = await parsePdfWithMinerU(Buffer.from('%PDF-1.4 mock'), 'math.pdf', {
    token: 'tok-test',
    fetchImpl: mockFetch,
    pollIntervalMs: 5,
    timeoutMs: 5000,
  });

  assert.equal(Buffer.compare(outZip, sampleZip), 0);
  assert.equal(calls.length, 5); // init + put + 2 polls + download
});

import { writeBook, parsePageRange, extractByPageRange, locateChaptersByQuery, generationContext } from '../app/books.mjs';

test('parsePageRange & extractByPageRange extract exact whole pages without truncating examples', () => {
  assert.deepEqual(parsePageRange('P22-24, 28'), [22, 23, 24, 28]);
  assert.deepEqual(parsePageRange('12～14、18'.replace('～', '~')), [12, 13, 14, 18]);

  const sample = '[P21]\n旧内容\n\n[P22]\n勾股定理定义：a^2+b^2=c^2\n\n[P23]\n例1 完整例题与解答\n\n[P25]\n练习题';
  const res = extractByPageRange(sample, '22-23,25');
  assert.deepEqual(res.matchedPages, [22, 23, 25]);
  assert.doesNotMatch(res.text, /旧内容/);
  assert.match(res.text, /勾股定理定义/);
  assert.match(res.text, /例1 完整例题与解答/);
  assert.match(res.text, /练习题/);
});

test('locateChaptersByQuery & generationContext auto-locate relevant chapter by topic', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-book-loc-'));
  try {
    const bookText = [
      '第16章 二次根式',
      '[P2]',
      '二次根式的概念与性质。',
      '第17章 勾股定理',
      '[P22]',
      '17.1 勾股定理：直角三角形两直角边平方和等于斜边平方。',
      '17.2 勾股定理的逆定理',
      '[P31]',
      '如果三角形三边满足 a^2+b^2=c^2，那么它是直角三角形。',
    ].join('\n');
    const saved = await writeBook(tmpDir, { title: '人教版八年级下册', text: bookText });
    const full = { ...saved, text: bookText };
    const matched = locateChaptersByQuery(full, '勾股定理的逆定理');
    const inverseNo = saved.chapters.find(c => c.title.includes('逆定理'))?.no;
    assert.ok(matched.includes(inverseNo), `expected chapter ${inverseNo}, got ${JSON.stringify(matched)}`);

    // generationContext: autoLocate 模式
    const ctxAuto = await generationContext(tmpDir, tmpDir, [], { id: saved.id, chapters: [], autoLocate: true }, 20000, tmpDir, [], { query: '勾股定理的逆定理' });
    assert.match(ctxAuto.suffix, /如果三角形三边满足/);
    assert.equal(ctxAuto.used[0].autoLocated, true);

    // generationContext: pageRange 模式
    const ctxPage = await generationContext(tmpDir, tmpDir, [], { id: saved.id, pageRange: '22' }, 20000, tmpDir, []);
    assert.match(ctxPage.suffix, /直角三角形两直角边平方和/);
    assert.doesNotMatch(ctxPage.suffix, /二次根式的概念/);
    assert.deepEqual(ctxPage.used[0].matchedPages, [22]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

import { recalibrateBookPages } from '../app/mineru.mjs';
import { updateBookPageOffset, readBook } from '../app/books.mjs';

test('recalibrateBookPages & updateBookPageOffset shift PDF pages losslessly and reversibly', async () => {
  const raw = '[P1]\n封面\n\n[P5]\n目录\n\n[P6]\n第1章 正文第一页\n\n[P7]\n第1章 正文第二页';
  const shifted = recalibrateBookPages(raw, 1, 6);
  assert.match(shifted, /\[前页1\]/);
  assert.match(shifted, /\[前页5\]/);
  assert.match(shifted, /\[P1\]\n第1章 正文第一页/);
  assert.match(shifted, /\[P2\]\n第1章 正文第二页/);

  // 再次微调（比如发现实际应从 PDF 第 7 页起）仍无损准确
  const reShifted = recalibrateBookPages(shifted, 6, 7);
  assert.match(reShifted, /\[前页6\]\n第1章 正文第一页/);
  assert.match(reShifted, /\[P1\]\n第1章 正文第二页/);

  // 持久化 updateBookPageOffset 验证
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-book-offset-'));
  try {
    const saved = await writeBook(tmpDir, { title: '测试教材', text: raw, pageCount: 7, bodyStartPage: 1 });
    await updateBookPageOffset(tmpDir, saved.id, 6);
    const updated = await readBook(tmpDir, saved.id);
    assert.equal(updated.bodyStartPage, 6);
    assert.match(updated.text, /\[P1\]\n第1章 正文第一页/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
