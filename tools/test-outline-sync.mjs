import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {editorPreviewHtml} from '../app/editor-preview.mjs';
import {cpSync,existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

export async function checkOutlineSync(root, output) {
  const executablePath = [process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find(p => p && existsSync(p));
  const browser = await chromium.launch({executablePath});
  try {
    const page = await browser.newPage({viewport:{width:1400,height:720}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    const deck = JSON.parse(readFileSync(path.join(root,'examples/gougu.deck.json')));
    const pack = JSON.parse(readFileSync(path.join(root,'packs/math-junior/pack.json')));
    const html = path.join(output,'gougu.deck.html');
    const responses = {decks:[{name:'gougu',title:'勾股',pages:deck.pages.length}],
      deck:{deck,pack}, packs:[pack], draft:{token:'test'}};
    let previews = 0, draftPosts = 0, draftHtml = readFileSync(html,'utf8');
    const savedFile = path.join(output, 'saved.deck.json');
    const adjustedFile = path.join(output, 'adjusted.html');
    for (const dir of ['pages','images']) cpSync(path.join(root,'examples',dir),path.join(output,dir),{recursive:true});
    await page.route('http://editor.test/**', route => {
      const {pathname} = new URL(route.request().url());
      if (pathname === '/api/preview') {
        previews++;
        return route.fulfill({contentType:'text/html',body:editorPreviewHtml(draftHtml)});
      }
      if (pathname === '/api/deck') {
        if (route.request().method() === 'POST') writeFileSync(savedFile,route.request().postData());
        return route.fulfill({json:{deck:existsSync(savedFile) ? JSON.parse(readFileSync(savedFile)) : deck,pack}});
      }
      if (pathname === '/api/draft') {
        draftPosts++;
        const draft = route.request().postDataJSON();
        if (draft.pages.some(p => p.blockTweaks)) {
          const file = path.join(output,'draft.deck.json');
          writeFileSync(file,JSON.stringify(draft));
          execFileSync(process.execPath,['src/render.mjs',file,'--out',adjustedFile],{cwd:root});
          draftHtml = readFileSync(adjustedFile,'utf8');
        } else draftHtml = readFileSync(html,'utf8');
      }
      if (pathname.startsWith('/api/')) return route.fulfill({json:responses[pathname.slice(5)] ?? []});
      return route.fulfill({path:path.join(root,'app',pathname === '/' ? 'index.html' : pathname.slice(1))});
    });
    await page.goto('http://editor.test/');
    const frame = page.frameLocator('#frame');
    await frame.locator('.slide.active').waitFor();
    const selected = i => page.locator('#pages .selected[data-index="'+i+'"]').waitFor({timeout:3000});
    for (let i=0;i<3;i++) await page.locator('#pNext').click();
    await selected(3);
    const previewPage = Number(await frame.locator('.slide.active').getAttribute('data-index'));
    const outlinePage = Number(await page.locator('#pages .selected').getAttribute('data-index')) + 1;
    const current = await page.locator('#current').textContent();
    assert.deepEqual([current.match(/^第 (\d+) 页/)?.[1], outlinePage], [String(previewPage), previewPage],
      '编辑面板、大纲和预览应显示同一页');
    await page.locator('#pPrev').click();
    await selected(2);
    await page.evaluate(() => {
      const editorPreview = new URL(document.querySelector('#frame').src).searchParams.get('editorPreview');
      window.dispatchEvent(new MessageEvent('message',{source:window,data:{ck:'page',index:0,editorPreview}}));
    });
    await selected(2);
    await frame.locator('.slide.active').evaluate(slide => slide.click());
    await selected(3);
    await frame.locator('.slide.active').evaluate(slide => {
      const link = document.createElement('button');
      link.dataset.goto = '2';
      slide.append(link);
      link.click();
    });
    await selected(1);
    await frame.locator('.hud .prev').press('End');
    await selected(deck.pages.length-1);
    assert.ok(await page.locator('#pages .selected').evaluate(row => {
      const box = row.getBoundingClientRect(), list = row.parentElement.getBoundingClientRect();
      return row.parentElement.scrollTop > 0 && box.top >= list.top-1 && box.bottom <= list.bottom+1;
    }), '末行应滚入大纲可视区');
    assert.equal(previews,1);
    const showFigure = async () => {
      await page.locator('#pages [data-index="4"] button').first().click();
      await frame.locator('#p5.active .figure').waitFor();
    };
    await showFigure();
    await page.locator('#blockMode').check();
    const figure = frame.locator('#p5 .figure');
    await frame.locator('html[data-ck-edit]').waitFor({state:'attached'});
    const box = await figure.boundingBox();
    const x = box.x + 2, y = box.y + 2;
    const before = draftPosts;
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(x+18,y+8,{steps:5});
    // 拖拽可能落在比 .figure 更内层的元素（例如 img）上，所以等"页内任意被拖元素"出现，
    // 再读它自己的位移量；不要在固定延时后比对 .figure 的屏幕坐标（会因命中的元素不同而抖）
    const dragged = frame.locator('#p5 [data-ck-move]').first();
    await dragged.waitFor({ state: 'attached', timeout: 10000 });
    const shift = await dragged.evaluate((el) => ({
      dx: parseFloat(el.style.getPropertyValue('--ck-dx')) || 0,
      dy: parseFloat(el.style.getPropertyValue('--ck-dy')) || 0,
    }));
    assert.ok(shift.dx > 10 && shift.dy > 4, `拖拽位移应大于 10/4，实际 ${shift.dx}/${shift.dy}`);
    await page.mouse.up();
    await page.locator('#save').click();
    const saved = () => JSON.parse(readFileSync(savedFile)).pages[4].blockTweaks;
    await page.waitForFunction(() => document.querySelector('#status').textContent === '已保存');
    assert.equal(saved().length,1);
    assert.ok(saved()[0].kind === 'figure' && saved()[0].dx > 0 && saved()[0].dy > 0);
    assert.equal(draftPosts,before);
    await page.locator('#undo').click();
    await frame.locator('#p5.active .figure:not([data-ck-move])').waitFor();
    assert.ok(Math.abs((await figure.boundingBox()).x-box.x)<1);
    await figure.click({position:{x:2,y:2}});
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');
    assert.equal(await figure.evaluate(el => getComputedStyle(el).translate),'8px');
    await page.keyboard.press('Control+z');
    await frame.locator('#p5.active .figure:not([data-ck-move])').waitFor();
    await figure.click({position:{x:2,y:2}});
    for (const key of ['ArrowRight','Shift+ArrowUp','Alt+ArrowRight']) await page.keyboard.press(key);
    await page.waitForFunction(() => document.querySelector('#last').textContent === '可以存成新页型');
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '已保存');
    const [tweak] = saved();
    assert.deepEqual([tweak.dx,tweak.dy,tweak.widthStep],[4,-20,1]);
    await page.reload();
    await frame.locator('#p1.active').waitFor();
    await showFigure();
    const adjusted = el => [getComputedStyle(el).translate,el.dataset.ckWidth,el.getBoundingClientRect().width];
    const state = await figure.evaluate(adjusted);
    assert.deepEqual(state.slice(0,2),['4px -20px','1']);

    await page.locator('#blockMode').check();
    await frame.locator('html[data-ck-edit]').waitFor({state:'attached'});
    assert.ok((await figure.boundingBox()).width > box.width);
    await figure.click({position:{x:2,y:2}});
    for (const key of ['ArrowLeft','Shift+ArrowDown','Alt+ArrowLeft','Alt+ArrowLeft']) await page.keyboard.press(key);
    assert.equal(await figure.getAttribute('data-ck-width'),'-1');
    assert.ok((await figure.boundingBox()).width < box.width);
    await page.keyboard.press('Alt+ArrowRight');
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '已保存');
    assert.equal(saved(),undefined);
    await page.goto(pathToFileURL(adjustedFile).href+'#5');
    assert.deepEqual((await page.locator('#p5.active .figure').evaluate(adjusted)).slice(0,2),state.slice(0,2));
    assert.ok(!readFileSync(adjustedFile,'utf8').includes('blockCommit'));
    const examples = path.join(root,'examples');
    for (const file of [html,...readdirSync(examples).filter(f => f.endsWith('.deck.html')).map(f => path.join(examples,f))]) {
      await page.goto(pathToFileURL(file).href);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => location.hash === '#2');
    }
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
  }
}
