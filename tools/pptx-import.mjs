import { analyzeReference } from './pptx-reference.mjs';
import { extractAssets } from './pptx-assets.mjs';
import { paletteCss } from './reference-map.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {JSDOM} from 'jsdom';
import {pptxToHtml} from '@jvmr/pptx-to-html';
import { stripDangerous } from '../src/sanitize.mjs';
import { renameRetry } from '../src/fs-retry.mjs';
import { readPptxEffects, applyEffectsToHtml, readPictureFills, applyPictureFills, readPictureSoftEdges, applySoftEdges, readGradientFills, applyGradientFills, readSolidFills, applySolidFills } from './pptx-effects.mjs';
import { extractSlotsAndRole } from './pptx-slots.mjs';

const root = path.resolve(import.meta.dirname, '..');
const duplicate = '已经导入过，换个名字或先删掉旧包';
const invalid = '无法打开这个 PPT，请确认文件是完整的 .pptx 课件';
const writeJson = (file, value, options) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', options);

async function main() {
  const {values, positionals: [file]} = parseArgs({allowPositionals:true, options:{
    name:{type:'string'}, id:{type:'string'}, json:{type:'boolean'}, 'no-assets':{type:'boolean'}
  }});
  if (!file || !/\.pptx$/i.test(file)) throw Error('请选择 .pptx 格式的课件');
  const name = values.name?.trim() || path.parse(file).name;
  const base = values.id ?? ('ref-' + (name.replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,76) || createHash('sha256').update(name).digest('hex').slice(0,12)));
  if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(base)) throw Error('模板编号无效');
  let slug = base;
  const exists = file => fs.access(file).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
  // 旧参照也可能有同名素材，另取编号保留原件。
  for (let n=2; ; n++) {
    if (await exists(path.join(root,'packs','user-template-'+slug))) throw Error(duplicate);
    if (!await exists(path.join(root,'references',slug)) && !await exists(path.join(root,'assets',slug))) break;
    slug = base+'-'+n;
  }
  const packId = 'user-template-'+slug;
  const pack = path.join(root,'packs',packId);
  const window = new JSDOM('').window;
  const bytes = await fs.readFile(file);
  const shadows = await readPptxEffects(bytes).catch(() => []);
  const pictures = await readPictureFills(bytes).catch(() => []);
  const softEdges = await readPictureSoftEdges(bytes).catch(() => []);
  const gradients = await readGradientFills(bytes).catch(() => []);
  const solids = await readSolidFills(bytes).catch(() => []);
  let slides;
  try {
    slides = await pptxToHtml(bytes, {
      width:1280, height:720, scaleToFit:true, domParserFactory:()=>new window.DOMParser()
    });
  } catch { throw Error(invalid); }
  finally { window.close(); }
  if (!slides.length) throw Error('没有转换出页面，这个 ppt 可能是空的或加密的');
  const stage = await fs.mkdtemp(path.join(root,'.pptx-'));
  const published = [];
  const stagedPack = path.join(stage,'pack');
  const dir = path.join(stage,'reference');
  let out;
  try {
    await fs.mkdir(path.join(stagedPack,'layouts'),{recursive:true});
    await fs.mkdir(dir);
    const layouts = [];
    const pageText = [];
    const packSlots = {};
    const roleLabels = {
      cover: 'PPT 封面保真页',
      toc: 'PPT 目录保真页',
      section: 'PPT 章节过渡页',
      closing: 'PPT 结束致谢页',
      content: 'PPT 保真页',
    };
    for (const [i, html] of slides.entries()) {
      const id = 'page-'+(i+1);
      // 转换器会丢阴影、把主题线条画成硬边框：按 PPT XML 里的几何回填
      const renamed = html.replaceAll('class="slide-container"','class="pptx-page"')
                          .replaceAll('class="slide"','class="pptx-slide"');
      const withPictures = pictures[i]?.length ? applyPictureFills(renamed, pictures[i]).html : renamed;
      const withSolid = solids[i]?.length ? applySolidFills(withPictures, solids[i]).html : withPictures;
      const withGradient = gradients[i]?.length ? applyGradientFills(withSolid, gradients[i]).html : withSolid;
      const withSoft = softEdges[i]?.length ? applySoftEdges(withGradient, softEdges[i]).html : withGradient;
      const effect = shadows[i] ? applyEffectsToHtml(withSoft, shadows[i]) : { html: withSoft, applied: 0 };
      // PPT 里可能带超链接/事件属性：先清理再落盘
      const safe = stripDangerous(effect.html).html;
      // 文字变成可编辑字段：按几何计算每槽容量预算与页面角色，装饰编号固定保留在 HTML 中
      const text = extractSlotsAndRole(safe, { slideIndex: i, totalSlides: slides.length });
      packSlots[id] = text.slotSpecs;
      layouts.push({
        id,
        name: '第 '+(i+1)+' 页',
        when: roleLabels[text.role] || 'PPT 保真页',
        role: text.role,
        roleReason: text.roleReason,
        slots: text.slots,
        slotLabels: text.labels,
        slotSpecs: text.slotSpecs,
      });
      pageText.push(text.values);
      await fs.writeFile(path.join(stagedPack,'layouts',id+'.html'),text.html);
    }
    const analysis = await analyzeReference(bytes, name);
    out = { name, slug, preview: true, createdAt: new Date().toISOString(), background: analysis.background, palette: analysis.palette, fonts: analysis.fonts, structure: analysis.structure, summary: analysis.summary };
    if (analysis.background?.base64) {
      const ext = (analysis.background.mime || 'image/png').split('/')[1].replace('jpeg', 'jpg');
      await fs.writeFile(path.join(dir, 'background.' + ext), Buffer.from(analysis.background.base64, 'base64'));
      out.background = { kind: 'photo', file: 'background.' + ext };
    }
    await fs.writeFile(path.join(dir, 'reference.json'), JSON.stringify(out, null, 2) + '\n');
    const skipAssets = Boolean(values['no-assets']);
    const extractedManifest = skipAssets ? [] : await extractAssets(bytes,slug,path.join(stage,'assets')).catch(() => []);
    const motifPick = Array.isArray(extractedManifest)
      ? (extractedManifest.find(a => a.type !== 'photo' && a.width >= 32 && a.width <= 640) || extractedManifest[0])
      : null;
    const skin = {
      palette: out.palette,
      fonts: out.fonts,
      background: out.background,
      ...(motifPick?.file ? { motifAsset: `${slug}/${motifPick.file}` } : {}),
    };
    await writeJson(path.join(stagedPack,'pack.json'),{
      id:packId,
      name,
      kind:'user-template',
      schemaVersion:2,
      subject:'通用',
      grade:'通用',
      theme:'theme.css',
      limits:{},
      skin,
      slots:packSlots,
      layouts,
    });
    const font = (out.fonts.minor || out.fonts.major || 'sans-serif').replace(/[^\p{L}\p{N} _-]/gu,'');
    await fs.writeFile(path.join(stagedPack,'theme.css'),paletteCss(out.palette)+'\n.slide:has(> .pptx-page){padding:0}\n.slide{font-family:"'+font+'",sans-serif}\n.pptx-page{width:1280px !important;height:720px !important}\n');
    await writeJson(path.join(dir,'source.deck.json'),{pack:packId,meta:{title:name},pages:layouts.map(({id},i)=>({layout:id,...pageText[i]}))});
    const publishPairs = [
      ...(skipAssets ? [] : [[path.join(stage,'assets',slug),path.join(root,'assets',slug)]]),
      [dir,path.join(root,'references',slug)],
      [stagedPack,pack],
    ];
    for (const [src,dst] of publishPairs) {
      await fs.mkdir(path.dirname(dst),{recursive:true});
      await renameRetry(src,dst);
      published.push(dst);
    }
  } catch(e) {
    for (const dst of published.reverse()) await fs.rm(dst,{recursive:true,force:true});
    if (['EEXIST','ENOTEMPTY'].includes(e.code)) throw Error(duplicate);
    throw e;
  } finally { await fs.rm(stage,{recursive:true,force:true}); }
  const info = {...out,packId,pages:slides.length,assetsExtracted:!values['no-assets']};
  console.log(values.json ? JSON.stringify(info) : '已导入「'+name+'」· '+slides.length+' 页');
}
main().catch(e=>{console.error(e.code ? '导入失败，请检查文件和保存位置是否可用' : e.message);process.exitCode=1;});
