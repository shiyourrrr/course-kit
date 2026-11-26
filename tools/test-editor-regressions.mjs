import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

/**
 * 编辑器行为回归：这一组用例守的是最近修过的"跨层按键 / 预览重载"问题：
 *  - Esc 优先级（编辑 > 选中块 > 全屏 > 总览）
 *  - 编辑文字时 Backspace 不翻页
 *  - 滑杆不再重载预览（白闪根因）
 *  - 演示块里的 Esc 能转出来退出全屏
 */
export async function checkEditorRegressions() {
  let assertions = 0;
  const check = (value, message) => { assert.ok(value, message); assertions++; };
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };

  const root = path.resolve(import.meta.dirname, '..');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'course-kit-regress-'));
  const fixture = path.join(temp, 'examples', 'regress.deck.json');
  let browser, server;
  try {
    mkdirSync(path.join(temp, 'examples', 'images'), {recursive: true});
    copyFileSync(path.join(root, 'examples', 'images', 'squares-on-sides.png'), path.join(temp, 'examples', 'images', 'sample.png'));
    copyFileSync(path.join(root, 'server.mjs'), path.join(temp, 'server.mjs'));
    for (const dir of ['app', 'src', 'packs', 'themes', 'tools', 'node_modules']) {
      symlinkSync(path.join(root, dir), path.join(temp, dir), 'junction');
    }

    const widgetHtml = '<!doctype html><html><body><div style="width:100%;height:100%;display:grid;place-items:center;font:700 24px sans-serif">widget</div></body></html>';
    const deck = {
      pack: 'math-junior',
      meta: {title: '回归测试'},
      pages: [
        {
          layout: 'context', kicker: '情境', title: '回归测试一页', question: '为什么会这样', note: '备注一行',
          background: 'images/sample.png',
        },
        {
          layout: 'concept', kicker: '概念', title: '回归测试二页',
          items: [{num: '1', term: '甲', text: 'a'}, {num: '2', term: '乙', text: 'b'}],
          freeBlocks: [
            {id: 'img-1', type: 'image', x: 120, y: 120, w: 220, h: 140, src: 'images/sample.png'},
            {id: 'widget-1', type: 'widget', x: 520, y: 240, w: 320, h: 200, html: widgetHtml},
          ],
        },
      ],
    };
    writeFileSync(fixture, JSON.stringify(deck));

    const socket = net.createServer().listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const {port} = socket.address();
    await new Promise((resolve) => socket.close(resolve));
    server = spawn(process.execPath, ['server.mjs'], {cwd: temp, env: {...process.env, PORT: String(port)}, windowsHide: true});
    server.stderr.on('data', (data) => process.stderr.write(data));
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(([code]) => { throw Error('server exited ' + code); })]);
    const origin = 'http://127.0.0.1:' + port;

    const executablePath = [process.env.CHROME_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((file) => file && existsSync(file));
    browser = await chromium.launch({executablePath});
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector('#decks .deck');
    const readme = page.frames();
    const frame = () => page.frames().find((f) => f !== page.mainFrame());
    const full = () => page.evaluate(() => document.querySelector('#stage').classList.contains('full'));
    const overview = () => frame().evaluate(() => document.body.classList.contains('overview'));
    const dispatchEsc = (opts = {}) => frame().evaluate((o) => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, ...o}));
    }, opts);
    const clickBlockAt = async (selector) => {
      const box = await page.locator('#frame').boundingBox();
      const rect = await frame().evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = el.closest('.slide').getBoundingClientRect();
        return {x: (r.left + r.width / 2 - s.left) / s.width, y: (r.top + r.height / 2 - s.top) / s.height};
      }, selector);
      assert.ok(rect, '找不到元素 ' + selector);
      await page.mouse.click(box.x + box.width * rect.x, box.y + box.height * rect.y);
    };
    const enterEdit = async (field) => {
      const sel = `.slide.active [data-ck-f="${field}"]`;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await clickBlockAt(sel);
        await page.waitForTimeout(150);
        await clickBlockAt(sel);
        await page.waitForTimeout(350);
        const ok = await frame().evaluate((s) => !!document.querySelector(s)?.isContentEditable, sel);
        if (ok) return true;
      }
      return false;
    };

    await page.locator('#decks .deck').first().click();
    await page.waitForFunction(() => document.querySelector('#frame')?.src.includes('/api/preview'));
    await page.waitForTimeout(900);

    // ---------- A. Esc 优先级 ----------
    await page.locator('#pFull').click();
    await page.waitForTimeout(300);
    check(await full(), '全屏预览应已打开');
    await dispatchEsc();
    await page.waitForTimeout(700);
    check(!(await full()), 'A1 全屏中按 Esc 应退出全屏');
    check(!(await overview()), 'A1 退出全屏后不应停在总览');

    await page.locator('#blockMode').check();
    await page.waitForTimeout(1200); // 微调开启会让预览重载一次
    let selected = false;
    for (let attempt = 0; attempt < 3 && !selected; attempt += 1) {
      await clickBlockAt('.slide.active [data-ck-f="title"]');
      await page.waitForTimeout(400);
      selected = await frame().evaluate(() => !!document.querySelector('.slide.active [data-ck-selected]'));
    }
    check(selected, '微调里点击文字应能选中块');
    await page.locator('#pFull').click();
    await page.waitForTimeout(300);
    await dispatchEsc();
    await page.waitForTimeout(700);
    check(!(await full()), 'A2 微调选中块 + 全屏，Esc 应退出全屏');
    check(!(await overview()), 'A2 不应切到总览');

    await clickBlockAt('.slide.active [data-ck-f="kicker"]');
    await page.waitForTimeout(150);
    await clickBlockAt('.slide.active [data-ck-f="kicker"]');
    await page.waitForTimeout(300);
    check(await frame().evaluate(() => !!document.querySelector('.slide.active [data-ck-f="kicker"]')?.isContentEditable), 'A3 连点两下应进入就地编辑');
    const kickerBefore = await frame().evaluate(() => document.querySelector('.slide.active [data-ck-f="kicker"]')?.innerText);
    await frame().evaluate(() => {
      const host = document.querySelector('.slide.active [contenteditable="true"]');
      (host || document).dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    });
    await page.waitForTimeout(600);
    const kickerAfter = await frame().evaluate(() => document.querySelector('.slide.active [data-ck-f="kicker"]')?.innerText);
    check(!(await frame().evaluate(() => !!document.querySelector('.slide.active [contenteditable="true"]'))), 'A3 编辑中 Esc 应取消编辑');
    equal(kickerAfter, kickerBefore, 'A3 取消编辑不应改字段值');
    check(!(await overview()), 'A3 编辑中 Esc 不应切总览');

    // A4 编辑提交后全屏 Esc
    check(await enterEdit('kicker'), 'A4 应能进入编辑');
    // 编辑态默认光标在末尾：先全选再输入，验证"整段替换"也能提交
    await frame().evaluate(() => {
      const host = document.querySelector('.slide.active [contenteditable="true"]');
      const range = document.createRange();
      range.selectNodeContents(host);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.keyboard.insertText('改后的栏目');
    await page.keyboard.press('Enter');
    let edited = '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      edited = await frame().evaluate(() => document.querySelector('.slide.active [data-ck-f="kicker"]')?.innerText ?? '');
      if (edited === '改后的栏目') break;
      await page.waitForTimeout(300);
    }
    equal(edited, '改后的栏目', 'A4 回车应提交字段');
    await page.locator('#pFull').click();
    await page.waitForTimeout(300);
    await dispatchEsc();
    await page.waitForTimeout(700);
    check(!(await full()), 'A4 提交后全屏 Esc 仍应退出全屏');
    check(!(await overview()), 'A4 不应切总览');

    // ---------- B. 编辑态按键 ----------
    check(await enterEdit('title'), 'B 应进入编辑');
    const indexBefore = await frame().evaluate(() => Number(document.querySelector('.slide.active')?.dataset.index));
    const titleLen = await frame().evaluate(() => document.querySelector('.slide.active [data-ck-f="title"]')?.innerText.length ?? 0);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    const indexAfter = await frame().evaluate(() => Number(document.querySelector('.slide.active')?.dataset.index));
    equal(indexAfter, indexBefore, 'B6 编辑时 Backspace 不应翻页');
    check(await frame().evaluate(() => !!document.querySelector('.slide.active [contenteditable="true"]')), 'B6 编辑时 Backspace 后仍应在编辑态');
    const titleLen2 = await frame().evaluate(() => document.querySelector('.slide.active [data-ck-f="title"]')?.innerText.length ?? 0);
    check(titleLen2 < titleLen, 'B6 Backspace 应真的删掉字符');
    await page.keyboard.insertText('补');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const titleSaved = await frame().evaluate(() => document.querySelector('.slide.active [data-ck-f="title"]')?.innerText);
    check(typeof titleSaved === 'string' && titleSaved.length > 0, 'B7 回车后字段应有内容');

    // ---------- C. 滑杆不重载 ----------
    // 图片和演示块在第 2 页；压暗滑杆要回到带背景的第 1 页
    await page.locator('#pages .row').nth(1).locator('button').first().click();
    await page.waitForTimeout(1200);
    await clickBlockAt('.slide.active .free-block[data-free-id="img-1"]');
    await page.waitForTimeout(500);
    check(await page.locator('#freeForm input[type=range]').count() > 0, 'C 选中图片应出现效果滑杆');
    await page.evaluate(() => { window.__loads = 0; document.querySelector('#frame').addEventListener('load', () => window.__loads++); });
    const bright = page.locator('#freeForm input[type=range]').first();
    for (const value of ['110', '120', '130']) {
      await bright.fill(value);
      await bright.dispatchEvent('input');
      await page.waitForTimeout(120);
    }
    equal(await page.evaluate(() => window.__loads), 0, 'C8 拖动图片滑杆不应重载预览');
    const filter = await frame().evaluate(() => getComputedStyle(document.querySelector('.slide.active .free-block img')).filter);
    check(/brightness/.test(filter), 'C8 图片效果应实时生效');

    // 压暗滑杆（回到第 1 页；退出微调后外观面板可见）
    await page.locator('#blockMode').uncheck();
    await page.locator('#pages .row').nth(0).locator('button').first().click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__loads = 0; });
    const veil = page.locator('.appearance input[type=range]').first();
    for (const value of ['0.2', '0.4']) {
      await veil.fill(value);
      await veil.dispatchEvent('input');
      await page.waitForTimeout(120);
    }
    equal(await page.evaluate(() => window.__loads), 0, 'C9 拖动压暗滑杆不应重载预览');
    const veilVar = await frame().evaluate(() => getComputedStyle(document.querySelector('.slide.active')).getPropertyValue('--slide-veil').trim());
    check(veilVar === '0.4', 'C9 压暗应实时生效，实际 ' + veilVar);
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '已保存');
    const saved = JSON.parse(readFileSync(fixture, 'utf8'));
    equal(saved.pages[0].veil, 0.4, 'C9 保存后文件里是最新压暗值');

    // ---------- D. 演示块 Esc 转发 ----------
    await page.locator('#pages .row').nth(1).locator('button').first().click();
    await page.waitForTimeout(900);
    await page.locator('#pFull').click();
    await page.waitForTimeout(400);
    check(await full(), 'D 应进入全屏');
    const inner = page.frames().filter((f) => f !== page.mainFrame());
    const widgetFrame = inner[inner.length - 1];
    assert.ok(widgetFrame && widgetFrame !== frame(), 'D 应存在演示块内层 iframe');
    await widgetFrame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
    await page.waitForTimeout(900);
    check(!(await full()), 'D 演示块里按 Esc 应能退出全屏');

    // ---------- E. 连发 Esc 不误切总览 ----------
    await page.locator('#pFull').click();
    await page.waitForTimeout(300);
    await frame().evaluate(() => {
      for (let i = 0; i < 3; i += 1) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, repeat: i > 0}));
    });
    await page.waitForTimeout(900);
    check(!(await full()), 'E 连发 Esc 应退出全屏');
    check(!(await overview()), 'E 连发 Esc 不应切到总览');

    // ---------- F. 大纲秒切、滚动保持、连点不串页、脏编辑必重渲 ----------
    for (let k = 3; k <= 12; k += 1) {
      await page.locator('#add').click();
    }
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '已保存');
    await page.frameLocator('#frame').locator('#p12.active').waitFor({ timeout: 10000 });
    await page.waitForTimeout(100);

    let draftCount = 0;
    const onReq = (req) => { if (req.method() === 'POST' && req.url().includes('/api/draft')) draftCount += 1; };
    page.on('request', onReq);

    await page.evaluate(() => {
      const list = document.querySelector('#pages');
      list.style.maxHeight = '180px';
      list.style.overflowY = 'auto';
      list.scrollTop = Math.floor((list.scrollHeight - list.clientHeight) / 2);
    });
    const scrollBefore = await page.evaluate(() => document.querySelector('#pages').scrollTop);
    const targetRow = await page.evaluate(() => {
      const list = document.querySelector('#pages');
      const lr = list.getBoundingClientRect();
      for (const row of list.children) {
        const rr = row.getBoundingClientRect();
        if (rr.top >= lr.top + 4 && rr.bottom <= lr.bottom - 4) return Number(row.dataset.index);
      }
      return 5;
    });

    const elapsedMs = await page.evaluate((idx) => new Promise((resolve) => {
      const t0 = performance.now();
      const handler = (ev) => {
        if (ev.data?.ck === 'page' && ev.data.index === idx) {
          window.removeEventListener('message', handler);
          resolve(performance.now() - t0);
        }
      };
      window.addEventListener('message', handler);
      document.querySelector(`#pages .row[data-index="${idx}"] button`).click();
    }), targetRow);
    const scrollAfter = await page.evaluate(() => document.querySelector('#pages').scrollTop);
    check(elapsedMs < 100, `F1 大纲切页应 < 100ms，实际 ${elapsedMs.toFixed(1)}ms`);
    equal(draftCount, 0, 'F1 未改内容切页不应请求 POST /api/draft');
    check(Math.abs(scrollAfter - scrollBefore) <= 4, `F2 大纲滚动条变化应 ≤ 4px，实际 ${Math.abs(scrollAfter - scrollBefore)}px`);

    // F3 快速连点第 3、7、9 页（0-based: 2, 6, 8）不串页
    await page.evaluate(() => {
      for (const idx of [2, 6, 8]) {
        document.querySelector(`#pages .row[data-index="${idx}"] button`).click();
      }
    });
    await page.waitForTimeout(150);
    const finalState = await Promise.all([
      page.evaluate(() => Number(document.querySelector('#pages .row.selected')?.dataset.index)),
      page.locator('#current').textContent(),
      frame().evaluate(() => Number(document.querySelector('.slide.active')?.dataset.index) - 1),
    ]);
    equal(finalState[0], 8, 'F3 连点后大纲选中应停在第 9 页');
    check(/^第 9 页/.test(finalState[1] || ''), 'F3 连点后编辑面板应停在第 9 页');
    equal(finalState[2], 8, 'F3 连点后预览画面应停在第 9 页');

    // F4 改字标脏后切页必须重新提交草稿
    const titleBox = page.locator('#fields textarea[name="title"]').first();
    await titleBox.fill('脏编辑测试标题');
    await page.locator('#pages .row[data-index="0"] button').first().click();
    await page.frameLocator('#frame').locator('#p1.active').waitFor({ timeout: 10000 });
    await page.waitForFunction(() => true);
    const p9Text = await frame().evaluate(() => document.querySelector('#p9')?.textContent || '');
    check(p9Text.includes('脏编辑测试标题'), 'F4 脏编辑切页后预览应包含最新内容');
    check(draftCount >= 1, 'F4 有未提交改动时切页应触发草稿重渲染');
    page.off('request', onReq);

    equal(errors.length, 0, '页面不应有脚本错误：' + errors.slice(0, 2).join(' | '));
    console.log('editor.regressions passed: ' + assertions);
    return assertions;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    try { rmSync(temp, {recursive: true, force: true}); } catch {}
  }
}
