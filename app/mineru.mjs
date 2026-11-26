/**
 * MinerU PDF 教材解析与结果包（ZIP）导入模块
 *
 * 支持两条路径（共用同一套解析落盘逻辑）：
 * 1. 云端 API v4（mineru.net）：上传本地 PDF -> 轮询任务 -> 下载结果 ZIP
 * 2. 本地导入 MinerU 网页版导出的 .zip（零配置、免 Token）
 *
 * 输出：
 * - 带 [P1]/[P2] 原书页码锚点与标准 $...$ LaTeX 公式的 Markdown 正文（进教材库）
 * - 自动提取课本插图到 assets/<slug>/（进素材库，含 manifest.json）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const MINERU_API = 'https://mineru.net/api/v4';
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const ZIP_LIMITS = {
  maxEntries: 2000,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxRatio: 100,
};

/**
 * 纯 Node 内置 zlib 解析标准 ZIP Buffer（支持 STORE=0 与 DEFLATE=8，零外部依赖）
 * 带硬资源预算（条目数、单文件大小、累计解压字节、压缩比），拒绝 ZIP64/多卷/损坏偏移（防 Zip Bomb）。
 * 返回 Map<规范化相对路径, Buffer>
 */
export function readZipEntries(buf, limits = {}) {
  const maxEntries = limits.maxEntries ?? ZIP_LIMITS.maxEntries;
  const maxEntryBytes = limits.maxEntryBytes ?? ZIP_LIMITS.maxEntryBytes;
  const maxTotalBytes = limits.maxTotalBytes ?? ZIP_LIMITS.maxTotalBytes;
  const maxRatio = limits.maxRatio ?? ZIP_LIMITS.maxRatio;

  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length < 22) throw Error('文件不是有效的 ZIP 压缩包');
  // 从末尾向前查找 End of Central Directory (0x06054b50)
  const minPos = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw Error('文件不是有效的 ZIP 压缩包');

  const diskNo = bytes.readUInt16LE(eocd + 4);
  const cdDisk = bytes.readUInt16LE(eocd + 6);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);

  if (diskNo !== 0 || cdDisk !== 0) throw Error('不支持多卷 ZIP 压缩包');
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw Error('暂不支持 ZIP64 超大压缩包，请按章节拆分后导入');
  }
  if (totalEntries > maxEntries) throw Error(`ZIP 条目数（${totalEntries}）超过上限 ${maxEntries}`);
  if (cdOffset + cdSize > bytes.length) throw Error('ZIP 中央目录已损坏或被截断');

  const entries = new Map();
  let pos = cdOffset;
  let totalUncompressed = 0;

  for (let n = 0; n < totalEntries; n++) {
    if (pos + 46 > cdOffset + cdSize || bytes.readUInt32LE(pos) !== 0x02014b50) {
      throw Error('ZIP 目录条目已损坏');
    }
    const method = bytes.readUInt16LE(pos + 10);
    const compSize = bytes.readUInt32LE(pos + 20);
    const uncompSize = bytes.readUInt32LE(pos + 24);
    const nameLen = bytes.readUInt16LE(pos + 28);
    const extraLen = bytes.readUInt16LE(pos + 30);
    const commentLen = bytes.readUInt16LE(pos + 32);
    const localOffset = bytes.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) {
      throw Error('ZIP 目录条目边界越界');
    }
    const rawName = bytes.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    const cleanName = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!cleanName || cleanName.endsWith('/') || cleanName.split('/').includes('..')) continue;
    if (entries.has(cleanName)) continue; // 忽略重复路径，保留首个声明

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw Error('暂不支持 ZIP64 条目');
    }
    if (uncompSize > maxEntryBytes) throw Error(`ZIP 单文件「${cleanName}」解压体积超过上限`);
    if (compSize > 0 && uncompSize / compSize > maxRatio) {
      throw Error(`ZIP 条目「${cleanName}」压缩比异常，已拒绝解压`);
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw Error(`ZIP 本地文件头损坏：${cleanName}`);
    }
    const lFlags = bytes.readUInt16LE(localOffset + 6);
    const lMethod = bytes.readUInt16LE(localOffset + 8);
    const lCompSize = bytes.readUInt32LE(localOffset + 18);
    const lUncompSize = bytes.readUInt32LE(localOffset + 22);
    const lNameLen = bytes.readUInt16LE(localOffset + 26);
    const lExtraLen = bytes.readUInt16LE(localOffset + 28);
    if (localOffset + 30 + lNameLen + lExtraLen > bytes.length) {
      throw Error(`ZIP 本地文件头越界：${cleanName}`);
    }
    const lRawName = bytes.subarray(localOffset + 30, localOffset + 30 + lNameLen).toString('utf8');
    if (lMethod !== method || lRawName !== rawName) {
      throw Error(`ZIP 中央目录与本地文件头不一致：${cleanName}`);
    }
    if ((lFlags & 0x08) === 0 && (lCompSize !== compSize || lUncompSize !== uncompSize)) {
      throw Error(`ZIP 条目长度与本地文件头不一致：${cleanName}`);
    }
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > bytes.length) throw Error(`ZIP 条目数据被截断：${cleanName}`);

    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let outBuf;
    if (method === 0) {
      outBuf = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        outBuf = zlib.inflateRawSync(compressed, { maxOutputLength: maxEntryBytes });
      } catch (e) {
        if (e?.code === 'ERR_BUFFER_TOO_LARGE') throw Error(`ZIP 单文件「${cleanName}」解压体积超过上限`);
        throw Error(`ZIP 解压失败（${cleanName}）：${e.message}`);
      }
    } else {
      continue;
    }

    if (outBuf.length > maxEntryBytes) throw Error(`ZIP 单文件「${cleanName}」解压体积超过上限`);
    if (outBuf.length !== uncompSize) {
      throw Error(`ZIP 条目「${cleanName}」实际解压长度与目录声明不一致`);
    }
    if (compSize > 0 && outBuf.length / compSize > maxRatio) {
      throw Error(`ZIP 条目「${cleanName}」实际压缩比异常，已拒绝解压`);
    }
    totalUncompressed += outBuf.length;
    if (totalUncompressed > maxTotalBytes) {
      throw Error(`ZIP 累计解压体积超过上限（${Math.round(maxTotalBytes / 1024 / 1024)} MB）`);
    }
    entries.set(cleanName, outBuf);
  }
  return entries;
}

/**
 * 从 MinerU content_list.json 重建带 [P1]/[P2] 原书页码锚点的 Markdown（保留公式与层级）
 * @param {number} bodyStartPage 正文第 1 页在 PDF 中的页码（默认 1；例如封面+目录占 5 页则填 6）
 */
function buildMarkdownFromContentList(items, imageMap, bodyStartPage = 1) {
  const start = Number.isInteger(bodyStartPage) && bodyStartPage >= 1 ? bodyStartPage : 1;
  const parts = [];
  let lastPage = -1;
  let maxPage = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const pdfPage = Number.isInteger(item.page_idx) ? item.page_idx + 1 : 0;
    if (pdfPage > maxPage) maxPage = pdfPage;
    if (pdfPage > 0 && pdfPage !== lastPage) {
      const label = pdfPage >= start ? `[P${pdfPage - start + 1}]` : `[前页${pdfPage}]`;
      parts.push(`\n${label}`);
      lastPage = pdfPage;
    }
    const type = String(item.type || 'text').toLowerCase();
    if (type === 'image' || type === 'table') {
      const imgPath = String(item.img_path || '').replace(/\\/g, '/').split('/').pop();
      const mapped = imgPath ? imageMap.get(imgPath) : '';
      const caption = []
        .concat(item.image_caption || [], item.table_caption || [])
        .map(s => String(s || '').trim())
        .filter(Boolean)
        .join(' ');
      if (type === 'table' && typeof item.table_body === 'string' && item.table_body.trim()) {
        parts.push(item.table_body.trim());
      }
      if (mapped || caption) {
        parts.push(`[教材插图：${mapped || imgPath}${caption ? ' · ' + caption : ''}]`);
      }
      continue;
    }
    const text = String(item.text || '').trim();
    if (!text) continue;
    if (type === 'equation') {
      parts.push(text.startsWith('$$') ? text : `$$\n${text}\n$$`);
    } else if (Number.isInteger(item.text_level) && item.text_level >= 1 && item.text_level <= 6) {
      parts.push(`${'#'.repeat(item.text_level)} ${text}`);
    } else {
      parts.push(text);
    }
  }
  return { text: parts.join('\n\n').trim(), pageCount: maxPage };
}

/**
 * 无损重新校准教材正文中的页码标记（[P1]/[前页1]）：
 * 先按 oldStartPage 还原为 PDF 物理页码，再按 newStartPage 重新标注，可反复调整不失真。
 */
export function recalibrateBookPages(text, oldStartPage = 1, newStartPage = 1) {
  const oldStart = Number.isInteger(oldStartPage) && oldStartPage >= 1 ? oldStartPage : 1;
  const newStart = Number.isInteger(newStartPage) && newStartPage >= 1 ? newStartPage : 1;
  return String(text || '').replace(/(^|\n)\[(P|前页)(\d+)\]/g, (_, lead, kind, numStr) => {
    const n = Number(numStr);
    const pdfPage = kind === '前页' ? n : n + oldStart - 1;
    const nextLabel = pdfPage >= newStart ? `[P${pdfPage - newStart + 1}]` : `[前页${pdfPage}]`;
    return lead + nextLabel;
  });
}

/**
 * 解包 MinerU 结果 ZIP（云端 API 下载或网页端导出均适用）：
 * - 先校验并解析 Markdown 正文（若存在 content_list.json 则自动附带 [P1]/[P2] 页码锚点）
 * - 正文校验通过后再将插图写入 assetsRoot/<slug>/，避免解析失败留下孤立素材目录
 */
export async function parseMinerUZip(zipBuffer, { assetsRoot, slug = '', bodyStartPage = 1, zipLimits } = {}) {
  const entries = readZipEntries(zipBuffer, zipLimits);
  if (!entries.size) throw Error('MinerU 压缩包为空');

  // 1. 先规划插图映射（按完整相对路径 + basename 双键，避免不同子目录同名图冲突；此时尚未落盘）
  const imageEntries = [...entries.entries()]
    .filter(([name]) => /(^|\/)images\//i.test(name) && IMAGE_EXT.test(name))
    .sort(([a], [b]) => a.localeCompare(b));

  const imageMap = new Map();
  const plannedImages = [];
  const assetSlug = slug || ('book-' + crypto.randomUUID().slice(0, 8));

  if (assetsRoot && imageEntries.length) {
    let seq = 1;
    for (const [entryPath, data] of imageEntries) {
      if (data.length < 256 || data.length > 10 * 1024 * 1024) continue;
      const origBase = entryPath.split('/').pop();
      const ext = (origBase.split('.').pop() || 'png').toLowerCase().replace(/^jpeg$/, 'jpg');
      const file = `img-${String(seq++).padStart(3, '0')}.${ext}`;
      imageMap.set(entryPath, file);
      if (!imageMap.has(origBase)) imageMap.set(origBase, file);
      plannedImages.push({ file, original: origBase, sourcePath: entryPath, data });
    }
  }

  // 2. 先解析并校验正文（优先 content_list.json，回退 full.md / markdown.md）
  const contentListEntry = [...entries.entries()].find(([name]) => /content_list\.json$/i.test(name));
  const mdEntry = [...entries.entries()]
    .filter(([name]) => /\.md$/i.test(name))
    .sort((a, b) => {
      const score = (n) => (/(^|\/)(full|markdown)\.md$/i.test(n) ? 1 : 0);
      return score(b[0]) - score(a[0]) || b[1].length - a[1].length;
    })[0];

  let text = '';
  let pageCount = 0;

  if (contentListEntry) {
    try {
      const parsed = JSON.parse(contentListEntry[1].toString('utf8'));
      if (Array.isArray(parsed) && parsed.length) {
        const built = buildMarkdownFromContentList(parsed, imageMap, bodyStartPage);
        if (built.text.length >= 20) {
          text = built.text;
          pageCount = built.pageCount;
        }
      }
    } catch {}
  }

  if (!text && mdEntry) {
    text = mdEntry[1].toString('utf8').replace(/\r\n?/g, '\n');
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, rawRef) => {
      const norm = rawRef.replace(/\\/g, '/').replace(/^\.\//, '');
      const base = norm.split('/').pop();
      const mapped = imageMap.get(norm) || imageMap.get(base) || base;
      return `[教材插图：${mapped}${alt ? ' · ' + alt : ''}]`;
    });
  }

  if (!text.trim()) throw Error('压缩包中未找到可读取的 Markdown 或 content_list.json（请确认是 MinerU 导出的结果包）');

  // 3. 正文校验通过后再落盘插图与 manifest.json
  const manifest = [];
  if (assetsRoot && plannedImages.length) {
    const targetDir = path.join(assetsRoot, assetSlug);
    await fs.mkdir(targetDir, { recursive: true });
    for (const img of plannedImages) {
      await fs.writeFile(path.join(targetDir, img.file), img.data);
      manifest.push({ file: img.file, original: img.original, type: 'textbook-figure', bytes: img.data.length });
    }
    await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  return {
    text: text.trim(),
    pageCount,
    hasPageAnchors: pageCount > 0,
    imageCount: manifest.length,
    assetRef: manifest.length ? assetSlug : '',
  };
}

async function readResponseWithLimit(res, maxBytes, signal) {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw Error(`MinerU 结果包超过大小上限（${Math.round(maxBytes / 1024 / 1024)} MB）`);
    return buf;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    if (signal?.aborted) throw Error('MinerU 下载已超时');
    total += chunk.length;
    if (total > maxBytes) throw Error(`MinerU 结果包超过大小上限（${Math.round(maxBytes / 1024 / 1024)} MB）`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

/**
 * 调用 MinerU 官方云端 API v4 解析本地 PDF Buffer -> 返回结果 ZIP Buffer
 * 全流程共用同一总截止时间（AbortSignal），并限制下载响应体上限。
 */
export async function parsePdfWithMinerU(pdfBuffer, filename, {
  token,
  modelVersion = 'vlm',
  fetchImpl = fetch,
  pollIntervalMs = 3000,
  timeoutMs = 5 * 60 * 1000,
  maxZipBytes = 64 * 1024 * 1024,
} = {}) {
  const apiToken = String(token || '').trim();
  if (!apiToken) {
    throw Error('未配置 MinerU API Token（请在右上角 ⚙ 设置中填入，或直接使用 MinerU 网页版导出 .zip 导入）');
  }
  const safeName = String(filename || 'textbook.pdf').replace(/[^\w.\-\u4e00-\u9fff]+/g, '_');
  const dataId = 'ck_' + crypto.randomUUID().slice(0, 12);
  const deadline = Date.now() + timeoutMs;
  const remainingSignal = (capMs = 60000) => {
    const left = deadline - Date.now();
    if (left <= 0) throw Error('MinerU 解析超时，建议拆成单章 PDF 或改用网页版导出 .zip 导入');
    return AbortSignal.timeout(Math.min(left, capMs));
  };

  // Step 1: 申请批量上传预签名链接
  const initRes = await fetchImpl(`${MINERU_API}/file-urls/batch`, {
    method: 'POST',
    signal: remainingSignal(30000),
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_version: modelVersion,
      files: [{
        name: safeName,
        data_id: dataId,
        is_ocr: true,
        enable_formula: true,
        enable_table: true,
        language: 'ch',
      }],
    }),
  });
  const initJson = await initRes.json().catch(() => null);
  if (!initRes.ok || !initJson || initJson.code !== 0) {
    throw Error('MinerU 申请上传失败（HTTP ' + initRes.status + '）');
  }
  const batchId = initJson.data?.batch_id;
  const uploadUrl = initJson.data?.file_urls?.[0];
  if (!batchId || !uploadUrl) throw Error('MinerU 未返回有效的上传链接');

  // Step 2: PUT 上传原始 PDF（不带 Authorization 或额外 Header，避免 OSS 签名 403）
  const putRes = await fetchImpl(uploadUrl, {
    method: 'PUT',
    signal: remainingSignal(120000),
    body: pdfBuffer,
  });
  if (!putRes.ok) {
    throw Error(`PDF 上传到 MinerU 失败（HTTP ${putRes.status}）`);
  }

  // Step 3: 轮询解析状态（受总截止时间约束，单次临时故障允许最多 3 次退避重试）
  let zipUrl = '';
  let transientErrs = 0;
  while (Date.now() < deadline) {
    const waitMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    if (Date.now() >= deadline) break;

    let pollRes;
    try {
      pollRes = await fetchImpl(`${MINERU_API}/extract-results/batch/${encodeURIComponent(batchId)}`, {
        signal: remainingSignal(20000),
        headers: { 'Authorization': `Bearer ${apiToken}` },
      });
    } catch (err) {
      if (Date.now() >= deadline) break;
      if (++transientErrs <= 3) continue;
      throw Error('查询 MinerU 解析进度超时或网络异常');
    }
    const pollJson = await pollRes.json().catch(() => null);
    if (!pollRes.ok || !pollJson || pollJson.code !== 0) {
      if (pollRes.status >= 500 && ++transientErrs <= 3) continue;
      throw Error('查询 MinerU 解析进度失败（HTTP ' + pollRes.status + '）');
    }
    transientErrs = 0;
    const item = pollJson.data?.extract_result?.[0];
    const state = item?.state;
    if (state === 'done') {
      zipUrl = item.full_zip_url;
      break;
    }
    if (state === 'failed') {
      throw Error('MinerU 解析失败，请检查 PDF 是否加密或损坏');
    }
  }
  if (!zipUrl) throw Error('MinerU 解析超时，建议拆成单章 PDF 或改用网页版导出 .zip 导入');

  // Step 4: 下载结果 ZIP（带总截止时间与字节上限）
  const dlSignal = remainingSignal(120000);
  const zipRes = await fetchImpl(zipUrl, { signal: dlSignal });
  if (!zipRes.ok) throw Error(`下载 MinerU 解析结果失败（HTTP ${zipRes.status}）`);
  return readResponseWithLimit(zipRes, maxZipBytes, dlSignal);
}
