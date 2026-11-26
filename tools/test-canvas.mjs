import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {renameSyncRetry} from '../src/fs-retry.mjs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

export async function checkCanvas() {
  let assertions = 0;
  const check = (value, message) => { assert.ok(value, message); assertions++; };
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const root = path.resolve(import.meta.dirname, '..');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'course-kit-canvas-'));
  const fixture = path.join(temp, 'examples', 'canvas.deck.json');
  const log = (name, value) => console.log(name, JSON.stringify(value));
  const near = (actual, expected, tolerance = 1) => check(Math.abs(actual - expected) <= tolerance,
    `expected ${actual} within ${tolerance} of ${expected}`);
  const deck = {pack:'math-junior', meta:{title:'Canvas test'}, pages:[{layout:'custom', html:`
    <h2 id="heading" style="position:absolute;left:83px;top:54px;margin:0;width:180px">Heading</h2>
    <div id="card" class="card" style="position:absolute;left:105px;top:215px;width:320px;padding:12px">
      <p id="paragraph" style="margin:0;font:20px/1.4 sans-serif"><span>Paragraph</span> with enough words to wrap when the card becomes narrower.</p></div>
    <img id="picture" width="160" height="80" style="position:absolute;left:701px;top:142px" src="images/sample.png">
    <h3 id="neighbor" style="position:absolute;left:927px;top:403px;margin:0;width:160px">Neighbor</h3>
    <ul style="position:absolute;left:405px;top:445px"><li id="item">Item</li></ul>
    <table id="table" style="position:absolute;left:670px;top:511px;width:130px"><tr><td>Cell</td></tr></table>
    <div id="formula" class="formula-box" style="position:absolute;left:870px;top:531px;width:150px"><span>Formula</span></div>
    <div id="media" class="figure" style="position:absolute;left:510px;top:80px;width:110px;height:82px"><svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="22"/></svg></div>
  `,freeBlocks:[{id:'free-test',type:'text',x:1050,y:100,w:90,h:42,text:'Free text'}]}]};
  let browser, server;
  try {
    mkdirSync(path.join(temp, 'examples/images'), {recursive:true});
    copyFileSync(path.join(root, 'examples/images/squares-on-sides.png'),path.join(temp,'examples/images/sample.png'));
    copyFileSync(path.join(root, 'server.mjs'),path.join(temp,'server.mjs'));
    for (const dir of ['app','src','packs','themes','tools','node_modules']) {
      symlinkSync(path.join(root, dir), path.join(temp, dir), 'junction');
    }
    writeFileSync(fixture, JSON.stringify(deck));
    const socket = net.createServer().listen(0,'127.0.0.1');
    await once(socket,'listening');
    const {port} = socket.address();
    await new Promise(resolve => socket.close(resolve));
    server = spawn(process.execPath,['server.mjs'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true});
    server.stderr.on('data', data => process.stderr.write(data));
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(([code]) => {throw Error('server exited '+code);})]);
    const origin = 'http://127.0.0.1:'+port;
    const executablePath = [process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(file => file && existsSync(file));
    browser = await chromium.launch({executablePath});
    const page = await browser.newPage({viewport:{width:1440,height:900}, reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') errors.push([message.text(),message.location().url]);});
    page.setDefaultTimeout(5000);
    await page.goto(origin);
    const iframe = page.locator('#frame'), frame = page.frameLocator('#frame');
    const el = id => frame.locator('#'+id);
    const rect = target => target.boundingBox();
    const center = box => ({x:box.x+box.width/2,y:box.y+box.height/2});
    const selected = async id => equal(await frame.locator('[data-ck-selected]').getAttribute('id'),id);
    const handle = frame.locator('[data-ck-handle]');
    const begin = async target => {
      const point = center(await rect(target));
      await page.mouse.move(point.x,point.y);
      await page.mouse.down();
      return point;
    };
    const download = async file => {
      const result = page.waitForEvent('download');
      await page.locator('#export').click();
      await (await result).saveAs(file);
      return readFileSync(file);
    };
    const save = async () => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/deck' && r.request().method() === 'POST');
      await page.locator('#save').click();
      check((await response).ok());
      return JSON.parse(readFileSync(fixture)).pages[0].blockTweaks;
    };
    await el('heading').waitFor();
    const baseline = await download(path.join(temp,'baseline.html'));
    const before = await rect(iframe);
    await page.locator('#blockMode').check();
    await frame.locator('html[data-ck-edit]').waitFor({state:'attached'});
    const during = await rect(iframe);
    check(during.width > before.width && during.height > before.height);
    const slide = await rect(frame.locator('.slide.active'));
    const scale = slide.width/1280;
    log('iframe.before/during',{before,during,scale});
    for (const [id,child] of [['item','#item'],['table','#table td'],['formula','#formula span'],['heading','#heading'],['paragraph','#paragraph span']]) {
      await frame.locator(child).click();
      await selected(id);
      equal(await handle.isVisible(),true);
      equal(await handle.getAttribute('data-ck-handle'),'both');
    }
    await el('paragraph').click({modifiers:['Alt']});
    await selected('card');
    check(await handle.isVisible());
    log('alt.parent','card');
    let point = await begin(handle);
    const cardBefore = await rect(el('card'));
    await page.mouse.move(point.x-115*scale,point.y+20);
    const narrow = await rect(el('card'));
    check(narrow.width < cardBefore.width && narrow.height > cardBefore.height);
    await page.mouse.move(point.x+1500,point.y);
    const rejected = await rect(el('card'));
    near(rejected.width,narrow.width);
    near(rejected.height,narrow.height);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    near((await rect(el('card'))).width,cardBefore.width);
    log('text.resize.cancel',{cardBefore,narrow,rejected});
    const paragraph = el('paragraph');
    const paragraphBefore = await rect(paragraph);
    await paragraph.click();
    await selected('paragraph');
    point = await begin(handle);
    await page.mouse.move(point.x+36*scale,point.y+28*scale);
    const paragraphResized = await rect(paragraph);
    check(paragraphResized.width > paragraphBefore.width && paragraphResized.height > paragraphBefore.height);
    near(paragraphResized.x,paragraphBefore.x);
    near(paragraphResized.y,paragraphBefore.y);
    await page.mouse.up();
    let paragraphTweaks = await save();
    let paragraphSize = paragraphTweaks.find(t => t.kind === 'paragraph');
    check(Number.isSafeInteger(paragraphSize.widthPx) && Number.isSafeInteger(paragraphSize.heightPx));
    const undoSrc = await iframe.getAttribute('src');
    await page.locator('#undo').click();
    await page.waitForFunction(src => document.querySelector('#frame').getAttribute('src')!==src,undoSrc);
    await frame.locator('html[data-ck-edit]').waitFor({state:'attached'});
    near((await rect(paragraph)).width,paragraphBefore.width);
    near((await rect(paragraph)).height,paragraphBefore.height);
    log('paragraph.resize.undo',{before:paragraphBefore,resized:paragraphResized,saved:paragraphSize,restored:await rect(paragraph)});
    await paragraph.click();
    await selected('paragraph');
    point = await begin(handle);
    await page.mouse.move(point.x+36*scale,point.y+28*scale);
    await page.mouse.up();
    paragraphTweaks = await save();
    paragraphSize = paragraphTweaks.find(t => t.kind === 'paragraph');
    check(Number.isSafeInteger(paragraphSize.widthPx) && Number.isSafeInteger(paragraphSize.heightPx));
    log('paragraph.resize.saved',paragraphSize);
    for (const id of ['heading','paragraph']) {
      const box = await rect(el(id));
      point = await begin(el(id));
      await page.mouse.move(point.x+37*scale,point.y+28*scale);
      await page.mouse.up();
      const after = await rect(el(id));
      check(after.x > box.x+8 && after.y > box.y+5);
      const saved = await save();
      log('drag.'+id,{box,after,saved:saved.at(-1)});
    }
    const heading = el('heading');
    for (const [name,target] of [['center',slide.x+slide.width/2],['neighbor',(await rect(el('neighbor'))).x]]) {
      const box = await rect(heading);
      point = await begin(heading);
      const from = name === 'center' ? center(box).x : box.x;
      await page.mouse.move(point.x+target-from+(name === 'center' ? 3 : 0.8),point.y+40);
      const guide = frame.locator('[data-ck-guide="x"]');
      check(await guide.isVisible());
      const snapped = await rect(heading);
      const edge = name === 'center' ? center(snapped).x : snapped.x;
      near(edge,target);
      log('snap.'+name,{target,edge,guide:await rect(guide)});
      await page.mouse.up();
      equal(await guide.isVisible(),false);
      const src = await iframe.getAttribute('src');
      await page.locator('#undo').click();
      await page.waitForFunction(src => document.querySelector('#frame').getAttribute('src')!==src,src);
      await frame.locator('html[data-ck-edit]').waitFor({state:'attached'});
      near((await rect(heading)).x,box.x);
    }
    const neighborBox = await rect(el('neighbor'));
    point = await begin(heading);
    await page.mouse.move(center(neighborBox).x,center(neighborBox).y);
    check(await frame.locator('[data-ck-collision]').count());
    log('collision',await frame.locator('[data-ck-collision]').evaluateAll(nodes => nodes.map(node => node.id)));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const image = el('picture');
    await image.click();
    const imageBefore = await rect(image);
    point = await begin(handle);
    await page.mouse.move(point.x+65*scale,point.y+27*scale,{steps:3});
    await page.mouse.up();
    const resized = await rect(image);
    check(resized.width > imageBefore.width && resized.height > imageBefore.height);
    check(Math.abs(resized.width/resized.height-imageBefore.width/imageBefore.height) > 0.1);
    let tweaks = await save();
    let size = tweaks.find(t => t.kind === 'image');
    near(size.widthPx,resized.width/scale);
    near(size.heightPx,resized.height/scale);
    const freeResizeBefore = await rect(image);
    point = await begin(handle);
    await page.keyboard.down('Alt');
    await page.mouse.move(point.x+52*scale,point.y+19*scale,{steps:3});
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const altResized = await rect(image);
    log('image.resize.alt',{freeResizeBefore,altResized});
    near(altResized.width/altResized.height,freeResizeBefore.width/freeResizeBefore.height,0.03);
    tweaks = await save();
    size = tweaks.find(t => t.kind === 'image');
    near(size.widthPx,altResized.width/scale);
    near(size.heightPx,altResized.height/scale);
    const minBefore = await rect(image);
    point = await begin(handle);
    await page.mouse.move(point.x-300,point.y-80);
    const minimum = await rect(image);
    near(minimum.width/scale,40,1);
    near(minimum.height/scale,40,1);
    await page.mouse.up();
    const minTweaks = await save();
    const minSize = minTweaks.find(t => t.kind === 'image');
    equal([minSize.widthPx,minSize.heightPx],[40,40]);
    const minUndoSrc = await iframe.getAttribute('src');
    await page.locator('#undo').click();
    await page.waitForFunction(src => document.querySelector('#frame').getAttribute('src')!==src,minUndoSrc);
    await frame.locator('html[data-ck-edit]').waitFor({state:'attached'});
    near((await rect(image)).width,minBefore.width);
    near((await rect(image)).height,minBefore.height);
    log('image.resize.minimum.undo',{before:minBefore,minimum,saved:minSize,restored:await rect(image)});
    const mediaNode = el('media');
    await mediaNode.click();
    const mediaBefore = await rect(mediaNode);
    point = await begin(handle);
    await page.mouse.move(point.x+38*scale,point.y+61*scale);
    await page.mouse.up();
    const mediaAfter = await rect(mediaNode);
    const media = (await save()).find(t => t.kind === 'figure');
    check(mediaAfter.width > mediaBefore.width && mediaAfter.height > mediaBefore.height);
    near(media.widthPx,mediaAfter.width/scale);
    near(media.heightPx,mediaAfter.height/scale);
    log('media.resize',{before:mediaBefore,after:mediaAfter,saved:media});
    const freeBlock = frame.locator('[data-free-id="free-test"]');
    await freeBlock.click();
    equal(await frame.locator('[data-ck-selected]').getAttribute('data-free-id'),'free-test');
    const freeBefore = await rect(freeBlock);
    point = await begin(handle);
    await page.mouse.move(point.x+30*scale,point.y+18*scale);
    const freeAfter = await rect(freeBlock);
    await page.mouse.up();
    check(freeAfter.width > freeBefore.width && freeAfter.height > freeBefore.height);
    await save();
    const freeSaved = JSON.parse(readFileSync(fixture)).pages[0].freeBlocks[0];
    near(freeSaved.w,freeAfter.width/scale);
    near(freeSaved.h,freeAfter.height/scale);
    log('free.resize',{before:freeBefore,after:freeAfter,saved:{w:freeSaved.w,h:freeSaved.h}});
    await image.click();
    const boundaryStart = await rect(image);
    const slideBounds = await rect(frame.locator('.slide.active'));
    const slidePadding = await frame.locator('.slide.active').evaluate(node => {
      const style = getComputedStyle(node);
      return {left:parseFloat(style.paddingLeft),right:parseFloat(style.paddingRight),
        top:parseFloat(style.paddingTop),bottom:parseFloat(style.paddingBottom)};
    });
    const boundaryX = slideBounds.x+slideBounds.width-slidePadding.right*scale;
    const boundaryY = slideBounds.y+slideBounds.height-slidePadding.bottom*scale;
    point = await begin(handle);
    await page.mouse.move(boundaryX,boundaryY);
    const boundaryResize = await rect(image);
    near(boundaryResize.x+boundaryResize.width,slideBounds.x+slideBounds.width-slidePadding.right*scale,1);
    near(boundaryResize.y+boundaryResize.height,slideBounds.y+slideBounds.height-slidePadding.bottom*scale,1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    log('image.resize.boundary',{boundaryStart,boundaryResize,slideBounds,slidePadding});
    await page.locator('#blockMode').uncheck();
    const after = await rect(iframe);
    near(after.width,before.width); near(after.height,before.height);
    log('iframe.after',after);
    await page.reload();
    await image.waitFor();
    const persisted = await image.evaluate(node => ({width:node.offsetWidth,height:node.offsetHeight,mode:getComputedStyle(node).boxSizing}));
    equal(persisted,{width:size.widthPx,height:size.heightPx,mode:'border-box'});
    const paragraphPersisted = await paragraph.evaluate(node => ({width:node.offsetWidth,height:node.offsetHeight}));
    equal(paragraphPersisted,{width:paragraphSize.widthPx,height:paragraphSize.heightPx});
    log('image.paragraph.resize.reopen',{imageBefore,resized,altResized,size,persisted,paragraphSize,paragraphPersisted});
    const adjustedPath = path.join(temp,'adjusted.html');
    const adjusted = await download(adjustedPath);
    check(!/data-ck-(handle|guide|overlay)|blockCommit|setPointerCapture/.test(adjusted.toString()));
    await page.locator('#blockMode').check();
    await frame.locator('html[data-ck-edit]').waitFor({state:'attached'});
    await image.click();
    await page.keyboard.press('Alt+ArrowLeft');
    const stepped = (await save()).find(t => t.kind === 'image');
    equal(stepped.widthStep,-1);
    equal(stepped.widthPx,undefined);
    log('image.explicit.to.step',stepped);
    const legacy = {path:[1],kind:'card',dx:7,dy:-3,widthStep:-1};
    deck.pages[0].blockTweaks = [legacy];
    writeFileSync(fixture + '.tmp', JSON.stringify(deck));
    renameSyncRetry(fixture + '.tmp', fixture);
    await page.reload();
    await el('card').waitFor();
    const old = await el('card').evaluate(node => ({translate:getComputedStyle(node).translate,step:node.dataset.ckWidth,width:node.offsetWidth}));
    equal(old.translate,'7px -3px');
    equal(old.step,'-1');
    check(old.width > 0);
    log('legacy.reopen',{legacy,old});
    log('editor.console',errors);
    check(errors.every(entry => Array.isArray(entry) && entry[1].endsWith('/favicon.ico')));
    errors.length = 0;
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(adjustedPath).href);
    const offline = await page.evaluate(() => {
      const image = document.querySelector('#picture');
      const paragraph = document.querySelector('#paragraph');
      const free = document.querySelector('[data-free-id="free-test"]');
      return {image:{width:image.offsetWidth,height:image.offsetHeight,loaded:image.complete && image.naturalWidth>0},
        paragraph:{width:paragraph.offsetWidth,height:paragraph.offsetHeight},
        free:{width:free.offsetWidth,height:free.offsetHeight}};
    });
    equal(offline,{image:{width:size.widthPx,height:size.heightPx,loaded:true},
      paragraph:{width:paragraphSize.widthPx,height:paragraphSize.heightPx},
      free:{width:freeSaved.w,height:freeSaved.h}});
    equal(errors,[]);
    log('offline.export',{protocol:new URL(page.url()).protocol,baselineBytes:baseline.length,exportBytes:adjusted.length,
      deltaKiB:(adjusted.length-baseline.length)/1024,offline,errors});
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {const exit = once(server,'exit'); server.kill(); await exit;}
    rmSync(temp,{recursive:true,force:true});
  }
  return assertions;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log('Browser assertions passed:', await checkCanvas());
}
