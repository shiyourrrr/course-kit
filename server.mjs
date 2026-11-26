import {writeBook,listBooks,readBook,deleteBook,generationContext,updateBookPageOffset} from './app/books.mjs';
import {parseMinerUZip,parsePdfWithMinerU} from './app/mineru.mjs';
import {listWidgetLibrary,fetchPhetWidget,importLocalWidget,saveEmbedWidget,deleteLocalWidget} from './app/widget-library.mjs';
import {getCacheStats,clearCache,listAssetGroups,deleteAssets} from './app/cache-store.mjs';
import {materialContext,writeMaterial} from './app/materials.mjs';
import {listQuestionBank, readQuestionQuestions, readQuestionSheet, saveQuestionSheet} from './app/question-bank.mjs';
import {parseQuestions} from './tools/question-parse.mjs';
import {editorPreviewHtml} from './app/editor-preview.mjs';
import {notesDocument} from './tools/notes.mjs';
import {ai, generateNotes,generateDeck,generateWidget,pickChaptersByToc,settings,saveSettings,publicSettings} from './app/ai.mjs';
import {buildHomeworkSkeleton,generateExamQuestions} from './app/exam-ai.mjs';
import {scaleSlides} from './app/slide-style.mjs';
import {fieldsOf,length} from './app/edit.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { mapStructure, paletteCss } from './tools/reference-map.mjs';
import { renameRetry } from './src/fs-retry.mjs';
import {
  enrichUserTemplatePack,
  buildHybridSkeleton,
  buildPromptSlotBudgets,
  enforceHybridBudgetsAndSplit,
  buildTemplateSkinCss,
  isUserTemplatePack,
} from './src/template-hybrid.mjs';
import { listTemplates, renameTemplate, deleteTemplate, buildTemplatePreviewDeck } from './src/template-store.mjs';
import { WIDGET_TEMPLATES } from './src/widget-templates.mjs';

import { themes, fonts } from './themes/catalog.mjs';

const root = import.meta.dirname;
import {writePaper,listPapers,readPaper,deletePaper} from './app/papers.mjs';
const papersDir=path.join(root,'papers');
const booksDir = path.join(root,'books');
const materialsDir = path.join(root,'materials');
const questionsDir = path.join(root,'questions');
const examples = path.join(root, 'examples');
const packs = path.join(root, 'packs');
const port = Number(process.env.PORT || 5178);
let origin;
const drafts = new Map();
const read = file => fs.readFile(file, 'utf8');
const json = async file => JSON.parse((await read(file)).replace(/^\uFEFF/, ''));
function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}
function id(value) {
  requireValue(typeof value === 'string' && /^[\p{L}\p{N}_-]{1,100}$/u.test(value), '文件名无效');
  return value;
}
const rawPackFor = packName => json(path.join(packs, id(packName || 'math-junior'), 'pack.json'));
const packFor = async deck => enrichUserTemplatePack(await rawPackFor(deck?.pack), packs);
async function validate(deck) {
  const pack = await packFor(deck);
  requireValue(Array.isArray(deck.pages) && deck.pages.length, '课件至少需要一页');
  for (const page of deck.pages) {
    requireValue(page && (pack.layouts.some(l => l.id === page.layout) || page.html || page.htmlFile), '课件含有未知页型');
    for (const [key, ext] of [['htmlFile','html'], ['cssFile','css']]) {
      if (page[key]) requireValue(new RegExp('^pages/[\\w.-]+\\.' + ext + '$','i').test(page[key]), '自定义页文件位置无效');
    }
  }
}
async function body(req, limit = 8 * 1024 * 1024) {
  requireValue(req.headers['content-type']?.startsWith('application/json'), '请使用编辑器提交内容');
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size <= limit, '文件太大');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString());
}
function run(args, lint = false) {
  // 子进程加内存上限：导入的 PPT/第三方模板再大也撑不爆主进程
  return new Promise((resolve, reject) => execFile(process.execPath, ['--max-old-space-size=512', ...args], {cwd:root, windowsHide:true, timeout:30000, maxBuffer:args.includes('--stdout') ? 128*1024*1024 : 4000000}, (err, stdout, stderr) => {
    if (err && !(lint && err.code === 1 && stdout)) reject(new Error(stderr.trim() || '生成课件失败'));
    else resolve(stdout);
  }));
}
async function render(deck, check = false, tweakWarnings, annotate = false) {
  await validate(deck);
  const file = path.join(examples, '.editor-' + crypto.randomUUID());
  const out = file + '.html';
  try {
    await fs.writeFile(file, JSON.stringify(deck), {flag:'wx'});
    const log = await run(['src/render.mjs', file, '--out', out, ...(tweakWarnings ? ['--report-tweaks'] : []), ...(annotate ? ['--annotate'] : [])]);
    if (tweakWarnings) {
      const line = log.split(/\r?\n/).find(s => s.startsWith('CK_TWEAK_WARNINGS='));
      if (line) tweakWarnings.push(...JSON.parse(line.slice('CK_TWEAK_WARNINGS='.length)));
    }
    let html = scaleSlides(await read(out),deck.pages);
    // 普通文本槽会转义标签，只还原编辑器插入的本地图片。
    const pattern = /&lt;img class=&quot;figure-img&quot; src=&quot;images\/([\w-]+\.(?:png|jpeg|jpg|webp|gif))&quot;&gt;/gi;
    for (const [tag, name] of html.matchAll(pattern)) {
      const bytes = await fs.readFile(path.join(examples,'images',name));
      const mime = path.extname(name).slice(1).replace(/^jpg$/, 'jpeg');
      html = html.replaceAll(tag, '<img class="figure-img" src="data:image/' + mime + ';base64,' + bytes.toString('base64') + '">');
    }
    if (!check) return html;
    if (html.includes('class="katex-error"')) throw Error('公式解析失败');
    await fs.writeFile(out, html);
    return await run(['tools/lint.mjs',out], true);
  } finally {
    await Promise.all([file,out].map(p => fs.rm(p,{force:true})));
  }
}
const assets = {'/mammoth.browser.min.js':['../node_modules/mammoth/mammoth.browser.min.js','text/javascript'], '/block-rules.mjs':['block-rules.mjs','text/javascript'], '/edit.mjs':['edit.mjs','text/javascript'], '/template-switch.mjs':['template-switch.mjs','text/javascript'], '/tweak-inspector.mjs':['tweak-inspector.mjs','text/javascript'], '/template-library.mjs':['template-library.mjs','text/javascript'], '/tour.mjs':['tour.mjs','text/javascript'], '/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/app.css':['app.css','text/css']};
const server = http.createServer(async (req,res) => {
  let materialUsage = [];
  const send = (value,type='application/json') => {
    res.setHeader('Content-Type',type + '; charset=utf-8');
    res.end(type === 'application/json' ? JSON.stringify(value) : value);
  };
  try {
    requireValue('http://' + req.headers.host === origin && (!req.headers.origin || req.headers.origin === origin), '请从本机编辑器打开');
    res.setHeader('Cache-Control','no-store');
    const url = new URL(req.url, origin);
    const route = url.pathname;
    const post = req.method === 'POST';
    if (route === '/api/paper' && req.method === 'DELETE') {
      await deletePaper(papersDir,url.searchParams.get('id'));
      return send({ok:true});
    }
    if (route === '/api/book' && req.method === 'DELETE') {
      await deleteBook(booksDir,url.searchParams.get('id'));
      return send({ok:true});
    }
    if (route === '/api/templates' && req.method === 'DELETE') {
      return send(await deleteTemplate(root, url.searchParams.get('id')));
    }
    if (route === '/api/widget-library' && req.method === 'DELETE') {
      return send(await deleteLocalWidget(path.join(root, 'app-data', 'widgets'), url.searchParams.get('id')));
    }
    requireValue(post || req.method === 'GET','操作无效');
    if (!post && route === '/api/health') return send({ ok: true, app: 'course-kit' });
    if (!post && Object.hasOwn(assets,route)) {
      const [file,type] = assets[route];
      if (type === 'text/html') {
        // 编辑页只允许自己的脚本；预览 iframe 是独立文档，不受这条 CSP 影响
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
      }
      return send(await read(path.join(root,'app',file)),type);
    }
    if (route === '/api/paper') return send(post ? await writePaper(papersDir,await body(req,32*1024*1024)) : await readPaper(papersDir,url.searchParams.get('id')));
    if (!post && route === '/api/papers') return send(await listPapers(papersDir));
    if (post && route === '/api/book/page-offset') {
      const { id: bookId, bodyStartPage } = await body(req);
      return send(await updateBookPageOffset(booksDir, bookId, bodyStartPage));
    }
    if (post && route === '/api/book/mineru') {
      const payload = await body(req, 64 * 1024 * 1024);
      const kind = String(payload.kind || '').toLowerCase();
      requireValue(kind === 'pdf' || kind === 'zip', '仅支持 .pdf 或 MinerU 导出的 .zip 文件');
      requireValue(typeof payload.dataBase64 === 'string' && payload.dataBase64.length > 0, '文件内容为空');
      const bodyStartPage = Number.isInteger(Number(payload.bodyStartPage)) && Number(payload.bodyStartPage) >= 1 ? Number(payload.bodyStartPage) : 1;
      const rawBuf = Buffer.from(payload.dataBase64, 'base64');
      const filename = String(payload.filename || (kind === 'pdf' ? 'textbook.pdf' : 'mineru.zip'));
      const bookTitle = String(payload.title ?? filename.replace(/\.(pdf|zip)$/i, '')).trim();
      requireValue(bookTitle.length > 0 && bookTitle.length <= 120, '教材书名不能为空且不超过 120 字');
      let zipBuf = rawBuf;
      if (kind === 'pdf') {
        const cfg = await settings();
        zipBuf = await parsePdfWithMinerU(rawBuf, filename, { token: cfg.mineruToken });
      }
      const parsed = await parseMinerUZip(zipBuf, { assetsRoot: path.join(root, 'assets'), bodyStartPage });
      try {
        const book = await writeBook(booksDir, {
          title: bookTitle,
          publisher: payload.publisher,
          edition: payload.edition,
          grade: payload.grade,
          volume: payload.volume,
          source: filename + (kind === 'pdf' ? '（MinerU 云解析）' : '（MinerU 结果包）'),
          text: parsed.text,
          pageCount: parsed.pageCount,
          imageCount: parsed.imageCount,
          assetRef: parsed.assetRef,
          bodyStartPage,
        });
        return send(book);
      } catch (err) {
        if (parsed.assetRef) {
          await fs.rm(path.join(root, 'assets', parsed.assetRef), { recursive: true, force: true }).catch(() => {});
        }
        throw err;
      }
    }
    if (route === '/api/book') return send(post ? await writeBook(booksDir,await body(req,32*1024*1024)) : await readBook(booksDir,url.searchParams.get('id'),url.searchParams.get('chapter')));
    if (!post && route === '/api/books') return send(await listBooks(booksDir));
    if (!post && route === '/api/decks') {
      const files = (await fs.readdir(examples)).filter(s => s.endsWith('.deck.json') && !s.startsWith('pptx-'));
      return send(await Promise.all(files.map(async filename => {
        const file = path.join(examples,filename);
        const [deck,stat] = await Promise.all([json(file),fs.stat(file)]);
        return {name:filename.slice(0,-10),filename,mtime:stat.mtimeMs,title:deck.meta?.title || filename,pages:deck.pages.length};
      })));
    }
    if (!post && route === '/api/themes') return send(themes);
    if (!post && route === '/api/lesson-types') {
      const requestedPack = url.searchParams.get('pack');
      const [types, rawPack] = await Promise.all([
        json(path.join(root, 'presets', 'lesson-types.json')),
        rawPackFor(requestedPack)
      ]);
      if (isUserTemplatePack(rawPack)) {
        return send(types.map(type => {
          const skel = buildHybridSkeleton(rawPack, type.pages, 'lesson');
          return {...type, pages: skel.length ? skel.map(s => s.layout) : [rawPack.layouts[0].id]};
        }));
      }
      const pack = await packFor({pack: requestedPack});
      const supported = new Set(pack.layouts.map(layout => layout.id));
      return send(types.map(type => {
        const pages = type.pages.filter(layout => supported.has(layout));
        const skipped = [...new Set(type.pages.filter(layout => !supported.has(layout)))];
        return {...type, pages:pages.length ? pages : [pack.layouts[0].id], ...(skipped.length && {skipped})};
      }));
    }
    if (!post && route === '/api/fonts') return send(fonts.map(({id,name})=>({id,name})));
    if (!post && route === '/api/packs') {
      const dirs = await fs.readdir(packs,{withFileTypes:true});
      return send(await Promise.all(dirs.filter(d=>d.isDirectory() && !d.name.startsWith('pptx-') && d.name !== 'general-elastic').map(d=>rawPackFor(d.name))));
    }
    if (!post && route === '/api/templates') return send(await listTemplates(root));
    if (post && route === '/api/templates/rename') {
      const { id: tplId, name: tplName } = await body(req);
      return send(await renameTemplate(root, tplId, tplName));
    }
    if (!post && route === '/api/template-preview') {
      const tplId = id(url.searchParams.get('id'));
      const previewDeck = await buildTemplatePreviewDeck(root, tplId);
      const html = await render(previewDeck, false);
      res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:");
      return send(scaleSlides(html, previewDeck.pages), 'text/html');
    }
    if (!post && route === '/api/widget-templates') return send(WIDGET_TEMPLATES);
    if (post && ['/api/import-pptx','/api/reference'].includes(route)) {
      const limit = 30 * 1024 * 1024;
      const {filename,base64,name,extractAssets} = await body(req, 4 * limit / 3 + 8192).catch(()=>{throw Error('上传内容无效或文件超过 30 MB');});
      requireValue(typeof filename === 'string' && /\.pptx$/i.test(filename),'请选择 .pptx 格式的课件');
      requireValue(typeof base64 === 'string' && base64.length <= 4 * limit / 3,'PPT 文件不能超过 30 MB');
      requireValue(base64.length && !/[^A-Za-z0-9+/=]/.test(base64),'文件内容无效，请重新选择 PPT');
      const bytes = Buffer.from(base64,'base64');
      requireValue(bytes.length <= limit,'PPT 文件不能超过 30 MB');
      const dir = await fs.mkdtemp(path.join(root,'.upload-pptx-')).catch(()=>{throw Error('无法创建临时文件，请检查磁盘空间');});
      let result;
      try {
        const temp = path.join(dir,'upload.pptx');
        await fs.writeFile(temp,bytes);
        const title = String(name || path.parse(filename).name).trim();
        const args = ['tools/pptx-import.mjs',temp,'--name='+title,'--json'];
        if (extractAssets === false) args.push('--no-assets');
        const out = await run(args);
        result = JSON.parse(out.trim().split('\n').at(-1));
      } catch(e) {
        throw Error(/^(已经导入过|无法打开这个 PPT|没有转换出页面)/.test(e.message) ? e.message : 'PPT 转换失败，请检查文件是否完整以及磁盘空间是否充足');
      } finally { await fs.rm(dir,{recursive:true,force:true}); }
      return send(result);
    }
    if (post && route === '/api/import') {
      const {filename,html,name:title,source} = await body(req);
      requireValue(typeof html === 'string' && html.length > 200,'没有收到网页内容：文件可能是空的，或者不是网页文件');
      const temp = path.join(examples,'.import-' + crypto.randomUUID() + '.html');
      try {
        await fs.writeFile(temp,html,'utf8');
        const out = await run(['tools/import-template.mjs',temp,
          '--name',String(title || filename || '导入模板').slice(0,40),
          '--source',String(source || ''),
          '--json']);
        return send(JSON.parse(out.trim().split('\n').filter(Boolean).pop()));
      } finally {
        await fs.unlink(temp).catch((e) => {
          if (e?.code !== 'ENOENT') console.warn('[import] 清理临时文件失败:', e.message);
        });
      }
    }
    if (post && route === '/api/upload') {
      const {filename,base64} = await body(req);
      const ext = path.extname(filename).toLowerCase();
      requireValue(['.png','.jpg','.jpeg','.gif','.webp'].includes(ext),'请选择 PNG、JPEG、GIF 或 WebP 图片');
      const bytes = Buffer.from(base64,'base64');
      requireValue(bytes.length && bytes.length <= 3*1024*1024,'图片请控制在 3 MB 以内');
      const relative = 'images/' + crypto.randomUUID() + ext;
      await fs.mkdir(path.join(examples,'images'),{recursive:true});
      await fs.writeFile(path.join(examples,relative),bytes,{flag:'wx'});
      return send({path:relative});
    }
    if (!post && route === '/api/material-text') {
      const materialId = url.searchParams.get('id');
      requireValue(/^[a-f0-9-]{36}$/.test(materialId), '材料编号无效');
      return send({text:await read(path.join(materialsDir,materialId + '.md'))});
    }
    if (post && route === '/api/parse-questions') {
      const {text} = await body(req);
      requireValue(typeof text === 'string', '需要题目文本');
      return send(parseQuestions(text));
    }
    if (post && route === '/api/generate-exam') {
      const input = await body(req);
      const source = input.deckName ? await json(path.join(examples, id(input.deckName) + '.deck.json')).catch(() => ({})) : {};
      const bookQuery = [input.title, input.brief].filter(Boolean).join(' ');
      const context = await generationContext(booksDir, materialsDir, source.materials, input.book, undefined, papersDir, input.papers, { query: bookQuery, aiPickChapters: pickChaptersByToc });
      materialUsage = context.used;
      const result = await generateExamQuestions(input, context.suffix);
      return send(materialUsage.length ? { ...result, materialUsage } : result);
    }
    if (route === '/api/question-bank') {
      if (!post && url.searchParams.get('file')) {
        const name=String(url.searchParams.get('file'));
        if (url.searchParams.get('parsed')) return send(await readQuestionQuestions(questionsDir,name));
        return send(await readQuestionSheet(questionsDir,name));
      }
      if (!post) return send(await listQuestionBank(questionsDir));
      const {markdown} = await body(req);
      return send(await saveQuestionSheet(questionsDir,markdown));
    }
    if (post && route === '/api/material') {
      const {name,text,kind}=await body(req);
      return send(await writeMaterial(materialsDir,name,text,kind));
    }
    if (route === '/api/settings') return send(post ? await saveSettings(await body(req)) : publicSettings(await settings()));
    if (!post && route === '/api/cache') return send(await getCacheStats(root, drafts));
    if (post && route === '/api/cache/clear') {
      const { target } = await body(req);
      requireValue(['phet', 'drafts', 'all'].includes(target), '无效的缓存清理范围');
      return send(await clearCache(root, drafts, target));
    }
    if (route === '/api/widget-library') {
      const widgetsDir = path.join(root, 'app-data', 'widgets');
      if (req.method === 'DELETE') return send(await deleteLocalWidget(widgetsDir, url.searchParams.get('id')));
      if (!post) return send(await listWidgetLibrary(widgetsDir));
    }
    if (post && route === '/api/widget-library/fetch') {
      const { id: slug } = await body(req);
      return send(await fetchPhetWidget(path.join(root, 'app-data', 'widgets'), slug));
    }
    if (post && route === '/api/widget-library/import') {
      const payload = await body(req, 16 * 1024 * 1024);
      return send(await importLocalWidget(path.join(root, 'app-data', 'widgets'), payload));
    }
    if (post && route === '/api/widget-library/embed') {
      const payload = await body(req);
      return send(await saveEmbedWidget(path.join(root, 'app-data', 'widgets'), payload));
    }
    if (post && route === '/api/widget') {
      const input = await body(req);
      id(input.name);
      return send(await generateWidget({
        instruction: input.instruction,
        subject: input.subject,
        grade: input.grade,
        theme: input.theme,
        templateId: input.templateId,
      }));
    }
    if (post && route === '/api/notes') {
      const input = await body(req);
      id(input.name);
      return send(await generateNotes({ deck: input.deck }));
    }
    if (post && route === '/api/ai') {
      const input=await body(req);
      id(input.name);
      const context=await materialContext(materialsDir,input.deck.materials);
      materialUsage=context.used;
      const result=await ai(input,await packFor(input.deck),context.suffix);
      return send(materialUsage.length ? {...result,materialUsage} : result);
    }
    if (!post && route === '/api/asset-groups') {
      return send(await listAssetGroups(root));
    }
    if (post && route === '/api/assets/delete') {
      const { ref, files } = await body(req);
      return send(await deleteAssets(root, ref, files));
    }
    if (!post && route === '/api/assets') {
      const ref = String(url.searchParams.get('ref') || '');
      requireValue(/^[\p{L}\p{N}_-]{1,120}$/u.test(ref), '参照编号无效');
      const manifest = await json(path.join(root, 'assets', ref, 'manifest.json')).catch(() => []);
      return send(manifest.map((item) => ({ ...item, url: '/api/asset?ref=' + encodeURIComponent(ref) + '&file=' + encodeURIComponent(item.file) })));
    }
    if (!post && route === '/api/asset') {
      const ref = String(url.searchParams.get('ref') || '');
      const file = String(url.searchParams.get('file') || '');
      requireValue(/^[\p{L}\p{N}_-]{1,120}$/u.test(ref), '参照编号无效');
      requireValue(/^img-\d+\.(png|jpe?g|gif|webp|bmp)$/i.test(file), '素材文件名无效');
      const target = path.join(root, 'assets', ref, file);
      const bytes = await fs.readFile(target).catch(() => { throw Error('素材不存在'); });
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[file.split('.').pop().toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      return res.end(bytes);
    }
    if (!post && route === '/api/reference-preview') {
      const slug = id(url.searchParams.get('slug'));
      const source = path.join(root,'references',slug,'source.deck.json');
      const deck = await json(source);
      requireValue(deck.pack === 'user-template-'+slug,'参照与模板不匹配');
      const html = await run(['src/render.mjs',source,'--stdout']);
      res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:");
      return send(scaleSlides(html,deck.pages),'text/html');
    }
    if (!post && route === '/api/references') {
      const refsDir = path.join(root, 'references');
      const names = await fs.readdir(refsDir).catch(() => []);
      const list = [];
      for (const slug of names) {
        const file = path.join(refsDir, slug, 'reference.json');
        const data = await json(file).catch(() => null);
        if (data) list.push({ slug, preview: data.preview === true, name: data.name, palette: data.palette, summary: data.summary, background: data.background });
      }
      return send(list);
    }
    if (post && route === '/api/generate') {
      const input = await body(req);
      const source=input.deckName ? await json(path.join(examples,id(input.deckName)+'.deck.json')) : {};
      const bookQuery = [input.title, input.brief].filter(Boolean).join(' ');
      const context=await generationContext(booksDir,materialsDir,source.materials,input.book,undefined,papersDir,input.papers,{query:bookQuery,aiPickChapters:pickChaptersByToc});
      materialUsage=context.used;
      let packId = id(input.pack);
      let rawPack = await rawPackFor(packId);
      let userTpl = isUserTemplatePack(rawPack);
      const mode = input.mode === 'homework' ? 'homework' : 'lesson';
      // 作业模式要求模板支持 homework 页型；若当前模板（如 cinema）不含作业页型，自动回退至内置 math-junior，避免生成 0 题封面
      if (mode === 'homework' && !userTpl && !rawPack.layouts.some((item) => item.id === 'homework')) {
        packId = 'math-junior';
        rawPack = await rawPackFor(packId);
        userTpl = false;
      }
      const pack = userTpl ? enrichUserTemplatePack(rawPack, packs) : rawPack;
      const types = await json(path.join(root, 'presets', 'lesson-types.json'));
      let mapped, css, background;
      const autoSlug = userTpl ? packId.replace(/^user-template-/, '') : '';
      const refSlug = (typeof input.reference === 'string' && /^ref-[\p{L}\p{N}_-]+$/u.test(input.reference))
        ? String(input.reference)
        : (/^ref-[\p{L}\p{N}_-]+$/u.test(autoSlug) ? autoSlug : '');
      if (refSlug) {
        const refFile = path.join(root, 'references', refSlug, 'reference.json');
        const ref = await json(refFile).catch(() => null);
        if (ref) {
          if (!userTpl && mode !== 'homework') mapped = mapStructure(ref.structure, pack);
          css = paletteCss(ref.palette);
          const file = ref.background?.file;
          if (ref.background?.kind === 'photo' && /^background\.(?:png|jpe?g|webp|gif)$/i.test(file)) {
            const stat = await fs.stat(path.join(path.dirname(refFile), file)).catch(() => null);
            if (stat?.isFile()) background = ['references', refSlug, file].join('/');
          }
          input.referenceData = { name: ref.name, summary: ref.summary, palette: ref.palette, fonts: ref.fonts, background: ref.background?.kind || 'none' };
        }
      }
      const layoutIds = mode === 'homework'
        ? buildHomeworkSkeleton(input.questionCount)
        : (types.find((type) => type.id === input.lessonType) || types[0]).pages;
      const skeleton = userTpl
        ? buildHybridSkeleton(rawPack, layoutIds, mode)
        : (mapped || layoutIds
            .filter((layout) => pack.layouts.some((item) => item.id === layout))
            .map((layout) => ({ layout })));
      if (!skeleton.length) throw Error('模板包里没有可用的页型');
      if (userTpl) input.slotBudgets = buildPromptSlotBudgets(skeleton, pack);
      const deck = await generateDeck(input, pack, skeleton, context.suffix);
      if (userTpl) {
        deck.pages = deck.pages.map((p, idx) => ({
          ...p,
          ...(skeleton[idx]?.fidelityLayout ? { fidelityLayout: skeleton[idx].fidelityLayout } : {}),
          ...(skeleton[idx]?.elasticLayout ? { elasticLayout: skeleton[idx].elasticLayout } : {}),
        }));
        deck.pages = enforceHybridBudgetsAndSplit(deck.pages, pack);
        const skinCss = buildTemplateSkinCss(rawPack, root, input.referenceData?.palette);
        if (skinCss) css = skinCss;
      }
      if (materialUsage.length) deck.materialUsage=materialUsage;
      const bookUsed = materialUsage.find((u) => u.kind === 'book');
      if (bookUsed && bookUsed.usedChars > 0) {
        const tb = {};
        if (bookUsed.title) tb.book = bookUsed.title;
        if (bookUsed.chapters?.length) tb.chapter = '第 ' + bookUsed.chapters.join('、') + ' 章';
        if (bookUsed.matchedPages?.length) {
          const ps = bookUsed.matchedPages;
          tb.pages = ps.length > 1 && ps.at(-1) - ps[0] === ps.length - 1 ? `P${ps[0]}–${ps.at(-1)}` : ps.map((n) => 'P' + n).join('、');
        } else {
          const fromSlides = [...new Set(deck.pages.map((p) => String(p.textbookPages || '').trim()).filter(Boolean))];
          if (fromSlides.length) tb.pages = fromSlides.join('、').slice(0, 80);
        }
        if (Object.keys(tb).length) (deck.meta ??= {}).textbook = tb;
      }
      if (css) deck.css = css;
      if (background) deck.pages.forEach((page, i) => {
        if (page.layout === 'cover' || page.layout === 'elastic-cover' || (!userTpl && mapped?.[i]?.divider)) {
          Object.assign(page, { background, veil: 0.67 });
        }
      });
      return send(deck);
    }
    const name = id(url.searchParams.get('name'));
    const file = path.join(examples,name + '.deck.json');
    if (route === '/api/notes-html' || route === '/api/notes-md') {
      const deck = post ? await body(req) : await json(file);
      const markdown = route.endsWith('-md');
      if (markdown) res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name+'-讲稿.md'));
      return send(notesDocument(deck,await packFor(deck),markdown),markdown?'text/markdown':'text/html');
    }
    if (route === '/api/deck') {
      if (!post) {
        const deck = await json(file);
        return send({deck,pack:await packFor(deck)});
      }
      const deck = await body(req);
      await validate(deck);
      const temp = file + '.' + crypto.randomUUID();
      try {
        // 保留上一版，误删/改坏时能从 .prev 找回
        await fs.copyFile(file, file + '.prev').catch((e) => {
          if (e?.code !== 'ENOENT') console.warn('[deck] 写入 .prev 备份失败:', e.message);
        });
        await fs.writeFile(temp,JSON.stringify(deck,null,2)+'\n',{flag:'wx'});
        await renameRetry(temp,file);
      } finally { await fs.rm(temp,{force:true}); }
      return send({ok:true});
    }
    if (post && route === '/api/draft') {
      const tweakWarnings = [];
      const html = await render(await body(req), false, tweakWarnings, true);
      const token = crypto.randomUUID();
      const bytes = Buffer.byteLength(html, 'utf8');
      drafts.set(token, { name, html, bytes });
      let totalBytes = 0;
      for (const d of drafts.values()) totalBytes += d.bytes || 0;
      const MAX_DRAFTS_BYTES = 24 * 1024 * 1024;
      while (drafts.size > 8 || (drafts.size > 1 && totalBytes > MAX_DRAFTS_BYTES)) {
        const oldestKey = drafts.keys().next().value;
        totalBytes -= drafts.get(oldestKey)?.bytes || 0;
        drafts.delete(oldestKey);
      }
      return send({token,tweakWarnings});
    }
    if (post && route === '/api/check') {
      const deck=await body(req), output=await render(deck,true);
      const errors=output.split('\n').filter(s=>s.includes('✗'));
      const pack = await packFor(deck);
      if(url.searchParams.has('page')){
        const page=deck.pages[Number(url.searchParams.get('page'))];
        if (page) {
          for(const [fieldPath,f] of fieldsOf(page,pack)){
            const len = length(f.value);
            if(f.limit && len>f.limit)errors.push(fieldPath+' 超过 '+f.limit+' 字（超过 '+(len-f.limit)+' 字）');
            if(/<br\s*\/?>/i.test(f.value))errors.push(fieldPath+' 含有 <br> 标签');
            if(f.value.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g,'').includes("$"))errors.push(fieldPath+' 公式定界符不完整');
          }
        }
      } else {
        const budgetLines = [];
        deck.pages.forEach((page, i) => {
          for (const [fieldPath, f] of fieldsOf(page, pack)) {
            const len = length(f.value);
            if (f.limit && len > f.limit) {
              const msg = `✗ 第 ${i + 1} 页 ${fieldPath} 超过上限 ${f.limit} 字（已用 ${len} 字，超过 ${len - f.limit} 字）`;
              errors.push(msg);
              budgetLines.push(msg);
            }
          }
        });
        if (budgetLines.length) {
          return send({output: budgetLines.join('\n') + '\n' + output, errors});
        }
      }
      return send({output,errors});
    }
    if (!post && ['/api/preview','/api/export'].includes(route)) {
      const token = url.searchParams.get('draft');
      const draft = drafts.get(token);
      if (token) requireValue(draft?.name === name,'预览已过期，请重新预览');
      if (route.endsWith('/export')) res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name)+'.html');
      let html = draft?.html ?? await render(await json(file));
      // 离屏预览中的浏览器转场可能无限延后，预览直接切页。
      if (route.endsWith('/preview')) html = html.replace('<script>', '<script>document.startViewTransition = undefined;');
      if (route === '/api/preview' && url.searchParams.has('editorPreview')) html = editorPreviewHtml(html);
      return send(html,'text/html');
    }
    res.statusCode = 404;
    send({error:'找不到页面'});
  } catch (err) {
    res.statusCode = 400;
    const error=err.code === 'ENOENT' ? '找不到所需文件' : err.message;
    send(materialUsage.length ? {error:error+'（参考材料：'+materialUsage.map(m=>m.title||m.name).join('、')+'）',materialUsage} : {error});
  }
}).on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    const addr = 'http://127.0.0.1:' + port;
    try {
      const probe = await fetch(addr + '/api/health', { signal: AbortSignal.timeout(1500) });
      const info = probe.ok ? await probe.json().catch(() => null) : null;
      if (info?.app === 'course-kit') {
        console.log('课件编辑器已在运行 ' + addr);
        if (process.argv.includes('--open') && process.platform === 'win32') execFile('explorer.exe', [addr]);
        process.exit(0);
      }
    } catch {}
    console.error(`端口 ${port} 已被其他程序占用，请关闭占用该端口的程序，或设置环境变量 PORT（如 PORT=5179）后重试`);
    process.exit(1);
  }
  throw err;
}).listen(port,'127.0.0.1',()=>{
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('课件编辑器已启动 ' + origin);
  if (process.argv.includes('--open') && process.platform === 'win32') execFile('explorer.exe',[origin]);
});
