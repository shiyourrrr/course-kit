// 从 pptx 里抽出非文字位图，存成可复用素材
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

function sizeOf(buf, ext) {
  try {
    if (ext === 'png' && buf.length > 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (ext === 'gif' && buf.length > 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (ext === 'bmp' && buf.length > 26) return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
    }
  } catch {}
  return { width: 0, height: 0 };
}

export async function extractAssets(buffer, slug, assetsRoot) {
  const zip = await JSZip.loadAsync(buffer);
  const media = Object.keys(zip.files).filter((name) => /^ppt\/media\/.+\.(png|jpe?g|gif|webp|bmp)$/i.test(name));
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));

  // 媒体 → 首次出现的页码（用于按结构参考）
  const pageOf = new Map();
  for (const [index, slide] of slides.entries()) {
    const relsFile = slide.replace('slides/', 'slides/_rels/') + '.rels';
    const rels = await zip.file(relsFile)?.async('string') || '';
    const xml = await zip.file(slide).async('string');
    const ids = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids) {
      const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
      if (!target) continue;
      const name = 'ppt/' + target.replace(/^\.\//, '').replace(/^\.\.\//, '');
      if (!pageOf.has(name)) pageOf.set(name, index + 1);
    }
  }

  const dir = path.join(assetsRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  const seen = new Set();
  const manifest = [];
  let n = 0;
  for (const name of media) {
    const bytes = Buffer.from(await zip.file(name).async('base64'), 'base64');
    if (bytes.length < 4096) continue;
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (seen.has(hash)) continue;
    const ext = name.split('.').pop().toLowerCase();
    const mime = MIME[ext];
    if (!mime) continue;
    const { width, height } = sizeOf(bytes, ext);
    if (width && height && width < 48 && height < 48) continue;
    seen.add(hash);
    n += 1;
    const file = `img-${n}.${ext}`;
    await fs.writeFile(path.join(dir, file), bytes);
    manifest.push({
      file,
      mime,
      width,
      height,
      page: pageOf.get(name) || null,
      type: width * height >= 1280 * 720 * 0.25 ? 'photo' : 'icon',
      bytes: bytes.length,
    });
  }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { dir, manifest };
}
