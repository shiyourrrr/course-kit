#!/usr/bin/env node
/**
 * 打包成「免安装」目录：自带 node.exe + 全部运行文件，老师解压双击即可用。
 *
 *   node tools/portable.mjs
 *   → dist/课件工作台/
 *
 * 说明：
 * - 只带运行时必需的东西（按 npm 锁文件复制）；playwright-core 是开发期工具，不带
 * - 不带已渲染的 .deck.html（5 MB+，进编辑器会重新渲染）
 * - 启动脚本用纯 ASCII + GBK 代码页，避免 Windows 批处理中文乱码
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', '课件工作台');

const skipDirs = new Set(['.git', '.tmp', '.shots', 'materials', 'books', 'papers', 'questions']);
const skipExt = new Set(['.prev']);

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) { if (!filter(entry.name, src)) continue; copyDir(src, dst, filter); continue; }
    if (skipExt.has(path.extname(entry.name))) continue;
    if (!filter(entry.name, src)) continue;
    fs.copyFileSync(src, dst);
  }
}

function sizeOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  }
  return total;
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. 自带 Node 运行时
const nodeExe = process.execPath;
fs.copyFileSync(nodeExe, path.join(out, 'node.exe'));

// 2. 运行代码
for (const dir of ['src', 'app', 'packs', 'themes', 'presets']) {
  copyDir(path.join(root, dir), path.join(out, dir), (name) => !/^(pptx-|user-template-)/.test(name));
}
fs.mkdirSync(path.join(out, 'tools'), { recursive: true });
for (const file of fs.readdirSync(path.join(root, 'tools'))) {
  // check.mjs 依赖 playwright，老师用不到
  if (file.startsWith('.') || !file.endsWith('.mjs') || file === 'check.mjs' || file === 'test.mjs') continue;
  fs.copyFileSync(path.join(root, 'tools', file), path.join(out, 'tools', file));
}
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(out, 'server.mjs'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(out, 'package.json'));

// 3. npm 锁文件记录了传递依赖的实际安装位置（包括嵌套版本）。
const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev || location.split('/').includes('playwright-core')) continue;
  const from = path.join(root,location);
  if (pkg.optional && !fs.existsSync(from)) continue;
  fs.cpSync(from,path.join(out,location),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
}

// 4. 示例课件（不带已渲染 HTML）
const examples = path.join(root, 'examples');
fs.mkdirSync(path.join(out, 'examples'), { recursive: true });
for (const entry of fs.readdirSync(examples, { withFileTypes: true })) {
  const src = path.join(examples, entry.name);
  const dst = path.join(out, 'examples', entry.name);
  if (/^pptx-/.test(entry.name)) continue; // 用户导入的 PPT 课件不随试用包分发
  if (entry.name === 'sources') continue; // 导入 PPT 的原文件（体积大、且属于个人材料）不分发
  if (entry.isDirectory()) { copyDir(src, dst); continue; }
  if (!/\.(deck\.json|md|png)$/i.test(entry.name)) continue;
  if (entry.name.endsWith('.deck.json')) {
    const deck = JSON.parse(fs.readFileSync(src,'utf8').replace(/^\uFEFF/,''));
    if (Object.hasOwn(deck,'materials')) {
      delete deck.materials;
      fs.writeFileSync(dst,JSON.stringify(deck,null,2)+'\n');
      continue;
    }
  }
  fs.copyFileSync(src, dst);
}

// 5. 启动脚本（纯 ASCII：Windows 批处理对中文编码很敏感）
const bat = `@echo off
chcp 936 >nul
cd /d "%~dp0"
if not exist node.exe (
  echo [error] node.exe is missing. Re-extract the whole folder.
  pause
  exit /b 1
)
echo.
echo   Course Kit - starting local workbench...
echo   Browser will open automatically. Close this window to stop.
echo.
node.exe server.mjs --open
pause
`;
fs.writeFileSync(path.join(out, '启动课件工作台.bat'), bat, 'ascii');

// 6. 使用说明（UTF-8 BOM，记事本直接可读）
const readme = `课件工作台 · 免安装版
==============================

五分钟上手
  1. 双击「启动课件工作台.bat」→ 浏览器自动打开 http://127.0.0.1:5178
  2. 右上角 ⚙ 填 DeepSeek API Key（只存在本机 app-data/settings.json，不会打包分发）
  3. 「⚡ 一句话生成」：填课题、年级、课型 → 生成整节课（含每页讲稿）
  4. 不满意的页：页面工具里改字号/元素入场；勾「微调」后可拖动、拉角改尺寸、双击文字直接改
  5. 「导出 HTML」得到单文件课件，发给学生或拷到教室电脑，断网也能放

能做什么
  · 生成：课题 → 整节课；可参考教材章节、试卷库、题库题目、课件材料
  · 版式：页型库 + 12 栅格，AI 只填内容；每页可调字号、元素入场、超字截断、长句分行
  · 微调：拖动、拉角改尺寸、双击文字改字、双击图片换图
  · 图片：页面工具「▣ 插入图片」任意页可插（不需要图片位）；选中后可调亮度/对比/饱和/模糊/圆角/透明/旋转/翻转/阴影/描边/裁切
  · 演示块：页面工具「▣ 演示块」→ 写需求（也可写 [动画: 函数图像]、[交互: 参数滑块] 等标签）→ 生成断网可用的交互组件
  · 讲稿：生成时自动写；也可「AI 写这一页」或「AI 补全全部讲稿」，再导出 Word / Markdown
  · 试卷：出题单（学生版 / 教师版 HTML，A4 打印），同时存入题库供以后参考
  · 导入：PPT 只抽素材、配色、结构当参考，不产生可编辑页；教材 DOCX 切章入库

这个文件夹里有什么
  node.exe                自带的运行环境，不用另外装 Node
  server.mjs / src / app  程序本体
  packs / themes          模板包与主题
  examples                课件都存在这里（想备份就整个文件夹拷走）
  tools                   命令行工具（会用的才用）

常见问题
  · 提示「API key 无效」：去 platform.deepseek.com 重新建 key，填进右上角 ⚙
  · 端口被占用：关掉另一个黑色窗口（或任务管理器结束 node.exe）再启动
  · 打印：Ctrl+P，纸张 A4，勾「适应页面」；带演示块的页建议先在浏览器里确认能印出来
  · 生成内容空泛：先在「教材库」导入教材并选章节，或在「补充要求」里写清难点与例题要求
  · 演示块生成失败：系统会自动返工并剥离外链；仍失败就换个说法再生成

注意
  - 整个文件夹要一起拷，不能只拷 .bat
  - 换电脑：整个文件夹拷过去照样双击就能用
  - 不要把 app-data 目录发给别人（里面是你的 API Key）
  - 教材 / 试卷 / 题库属于个人或版权内容，打包时已排除
`;
fs.writeFileSync(path.join(out, '使用说明.txt'), '\uFEFF' + readme.replace(/\n/g, '\r\n'), 'utf8');

// 记录 node.exe 的 sha256，方便接收方核对来源
const { createHash } = await import('node:crypto');
const nodeHash = createHash('sha256').update(fs.readFileSync(nodeExe)).digest('hex');
fs.appendFileSync(path.join(out, '使用说明.txt'),
  '\r\n运行时校验\r\n  node.exe SHA-256：' + nodeHash + '\r\n  这是本机安装的 Node（' + process.version + '），非官方签名包。\r\n', 'utf8');

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
console.log(`✓ 打包完成：${out}`);
console.log(`  总大小 ${mb(sizeOf(out))}（其中 node.exe ${mb(fs.statSync(nodeExe).size)}）`);
console.log('  双击「启动课件工作台.bat」即可使用');
