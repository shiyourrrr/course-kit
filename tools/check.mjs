#!/usr/bin/env node
/**
 * 课件体检：用真实浏览器量每一页有没有溢出 / 太空
 *
 *   node tools/check.mjs examples/gougu.deck.html
 *   node tools/check.mjs examples/gougu.deck.html --shots .shots   # 顺便给每页截图
 *
 * 用本机已装的 Edge/Chrome（playwright-core 不下载浏览器，几百 MB 省了）。
 * 退出码：有页面溢出 → 1，全通过 → 0。可以挂到 CI 或 AI 的自检回路里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const RENDER = { width: 1280, height: 720 };
const TOLERANCE = 2; // px，浏览器取整误差

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const shotsAt = (() => {
  const i = args.indexOf('--shots');
  return i >= 0 ? args[i + 1] : null;
})();

if (!target) {
  console.error('用法：node tools/check.mjs <课件.html> [--shots <目录>]');
  process.exit(1);
}

const file = path.resolve(target);
if (!fs.existsSync(file)) {
  console.error(`文件不存在：${file}`);
  process.exit(1);
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('没找到本机浏览器，请设置环境变量 CHROME_PATH 指向 chrome.exe / msedge.exe');
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch({ executablePath, args: ['--font-render-hinting=none'] });
} catch (error) {
  const hint = /EPERM|spawn/i.test(String(error.message))
    ? '当前环境禁止启动浏览器子进程（沙箱/命名管道限制）。请在普通终端里直接运行本命令，或改用 npm run lint 做静态自检。'
    : String(error.message).split('\n')[0];
  console.error(`\n无法启动浏览器（${path.basename(executablePath)}）：\n  ${hint}\n`);
  process.exit(2);
}
const page = await browser.newPage({ viewport: RENDER, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(file).href + '?no-scale=1', { waitUntil: 'load' });
await page.waitForTimeout(250); // 等字体与 KaTeX 落位

const report = await page.evaluate(() => {
  // 量测/截图前先关动效：否则未入场的元素是 opacity:0，截出来是白页
  document.body.classList.add('no-anim');
  const slides = Array.from(document.querySelectorAll('.slide'));
  const out = [];
  slides.forEach((slide, i) => {
    slides.forEach((s, k) => { s.hidden = k !== i; });
    const style = getComputedStyle(slide);
    const box = slide.getBoundingClientRect();
    const padTop = parseFloat(style.paddingTop);
    const padBottom = parseFloat(style.paddingBottom);

    // 横向：只判是否超出 1280×720 舞台本身。
    // 内容溢出到内边距是设计允许的（封面是满幅出血），超出舞台才会被裁切。
    // 注意：负 margin 的满幅元素是刻意的，按舞台边界判就不会误报。
    const all = Array.from(slide.querySelectorAll('*'));
    let left = Infinity;
    let right = -Infinity;
    let inkBottom = -Infinity;
    let minTop = Infinity;
    let maxBottom = -Infinity;
    const pptxPage = slide.querySelector('.pptx-page');
    const clip = pptxPage && getComputedStyle(pptxPage).overflow === 'hidden' ? pptxPage.getBoundingClientRect() : null;
    for (const el of all) {
      // 跳过 SVG 内部图元：KaTeX 根号是 <svg width="400em"> 里的一条 path，
      // 几何宽度上万像素但被 svg 自身裁掉，不是真的越界。
      if (el.ownerSVGElement) continue;
      let r = el.getBoundingClientRect();
      // PPT 封面常有跨出画布的背景图形。仅量已裁切的空装饰 div 的可见部分。
      if (clip && el.tagName === 'DIV' && !el.hasChildNodes() && pptxPage.contains(el)) {
        const left = Math.max(r.left, clip.left), top = Math.max(r.top, clip.top);
        const right = Math.min(r.right, clip.right), bottom = Math.min(r.bottom, clip.bottom);
        if (right <= left || bottom <= top) continue;
        r = new DOMRect(left, top, right-left, bottom-top);
      }
      if (r.width === 0 && r.height === 0) continue;
      left = Math.min(left, r.left - box.left);
      right = Math.max(right, r.right - box.left);
      minTop = Math.min(minTop, r.top - box.top);
      maxBottom = Math.max(maxBottom, r.bottom - box.top);
      // 内容密度只算“叶子节点”（有文字的），避免 flex 拉伸的容器永远占满
      if (el.children.length === 0 && el.textContent.trim()) {
        inkBottom = Math.max(inkBottom, r.bottom - box.top);
      }
    }
    const usable = box.height - padTop - padBottom;
    const used = Number.isFinite(inkBottom) ? Math.max(0, inkBottom - padTop) : 0;

    // 纵向：scrollHeight 抓不到绝对定位满幅容器（.cine）内部的溢出，
    // 所以再按元素真实上下边界量一次。
    const overflowDown = Number.isFinite(maxBottom) ? Math.max(0, maxBottom - box.height) : 0;
    const overflowUp = Number.isFinite(minTop) ? Math.max(0, -minTop) : 0;

    out.push({
      index: i + 1,
      layout: slide.dataset.layout || '?',
      overY: Math.round(Math.max(slide.scrollHeight - slide.clientHeight, overflowDown, overflowUp)),
      overX: Math.round(Math.max(0, right - box.width, -left)),
      fill: usable > 0 ? Math.min(1.2, used / usable) : 0,
    });
  });
  return out;
});

if (shotsAt) {
  fs.mkdirSync(shotsAt, { recursive: true });
  for (let i = 0; i < report.length; i++) {
    await page.evaluate((idx) => {
      const slides = Array.from(document.querySelectorAll('.slide'));
      slides.forEach((s, k) => { s.hidden = k !== idx; });
    }, i);
    await page.screenshot({ path: path.join(shotsAt, `${String(i + 1).padStart(2, '0')}-${report[i].layout}.png`) });
  }
}

await browser.close();

/* ---------------- 输出 ---------------- */

const pad = (v, n) => String(v).padStart(n);
let failed = 0;
console.log('\n页码  页型         内容占用     纵向溢出  横向溢出   状态');
console.log('─'.repeat(66));
for (const r of report) {
  const over = r.overY > TOLERANCE || r.overX > TOLERANCE || r.scrollX > TOLERANCE;
  const low = r.fill < 0.42;
  const status = over ? '溢出 ✗' : low ? '偏空 ⚠' : 'OK';
  if (over) failed += 1;
  console.log(
    `${pad(r.index, 3)}   ${r.layout.padEnd(12)}  ${pad(Math.round(r.fill * 100), 3)}%` +
      `        ${pad(r.overY, 6)}px  ${pad(r.overX, 6)}px   ${status}`
  );
}

console.log('─'.repeat(66));
if (failed) {
  console.log(`\n${failed} 页内容超出画布。修法顺序：删字 → 拆页 → 换页型（不要靠缩字号硬塞）。\n`);
  process.exit(1);
}
const empty = report.filter((r) => r.fill < 0.42).length;
console.log(`\n全部 ${report.length} 页尺寸安全${empty ? `，其中 ${empty} 页偏空（可补内容或并页）` : ''}。\n`);
