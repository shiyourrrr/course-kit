/**
 * 演示块（AI 生成的离线交互小组件）
 *
 * 规范改写自 CourseForge 的 widgets/PROMPT_FRAMEWORK.md（MIT，Copyright (c) 2026 The CourseForge authors），
 * 改动：主题变量换成我们的 --ck-*、增加课堂投屏与打印约束、去掉它的 cf:* 消息协议（我们还没用到）。
 */

export const WIDGET_SPEC = `你是离线课件小组件生成器，输出必须严格遵守规范：
1. 自包含可离线：禁止任何外链（CDN / 字体 / 图片 / JS），全部内联；图片用 base64 或内联 SVG。
2. 根元素填满容器：width:100%;height:100%，内部用相对单位（%、clamp、vmin/vmax、em），不要写死大的像素尺寸；设计基准 320×200。
3. 主题色用 CSS 变量并带兜底：var(--ck-brand,#2563eb)、var(--ck-bg,#0f172a)、var(--ck-text,#f8fafc)。
4. 只输出一个完整 HTML 文档（以 <!doctype html> 开头），不要 markdown 代码块、不要任何解释文字。
5. 不要请求摄像头 / 麦克风 / 网络，不要使用 alert / confirm。
6. 面向课堂投屏：字号偏大、对比度高；动画以淡入、生长为主，避免全屏闪烁。
7. 打印友好：可加 @media print 把动画层隐藏掉。
8. 输出前自检：整份 HTML 里不得出现 "http://" 或 "https://" 字样；图片只能 <img src="data:..."> 或内联 <svg>；不要 <link>、不要 @import、不要外链字体。

动效规范（照这个做，别用花哨库）：
- 统一缓动 cubic-bezier(.2,.8,.2,1)：入场 520ms、状态变化 280ms、画线 1.6s。
- 入场：opacity 0→1、translateY(8px)→0、scale(.98)→1；多条内容依次 60ms 错开。
- 画曲线/画线：SVG 用 stroke-dasharray = 路径长度、stroke-dashoffset 从长度→0，1.6s 画出来。
- 强调重点：关键帧 50% 时颜色提亮 + text-shadow: 0 0 18px 品牌色。
- 判断反馈：正确 scale 1→1.06→1（320ms）并变绿；错误左右位移 ±4px 三下并变红。
- 进度或不确定等待：一条横向扫光（margin-left -30% → 100%）。
- 通关/庆祝：少量粒子下落（≤ 24 个，translateY 120vh、rotate 540deg、opacity .2）。
- 必须加 @media (prefers-reduced-motion: reduce){ *{animation-duration:.01ms!important;transition-duration:.01ms!important} }

需求可以用标注 DSL 写（老师或上游模型都能写，出现标签就按标签做）：
- [动画: 公式推导] 逐步展开公式，每一步高亮当前项
- [动画: 几何变换] 图形旋转 / 缩放 / 平移，带轨迹
- [动画: 函数图像] 动态绘制函数曲线（路径描边）
- [动画: 概念图解] 流程图 / 思维导图 / 对比表
- [交互: 参数滑块] 可调参数，实时重算
需求：`;

const MAX_BYTES = 300 * 1024;

/** 校验 AI 产出的组件：必须是完整文档、不得外链、体积受控 */
export function checkWidget(html) {
  const reasons = [];
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, reasons: ['内容为空'], bytes: 0 };
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_BYTES) reasons.push(`体积 ${(bytes / 1024).toFixed(0)}KB 超过 ${MAX_BYTES / 1024}KB 上限`);
  if (!/<(html|body)[\s>]/i.test(html)) reasons.push('不是完整的 HTML 文档');
  if (/https?:\/\//i.test(html)) reasons.push('包含外部链接');
  if (/<script[^>]+\bsrc\s*=/i.test(html)) reasons.push('引用了外部脚本');
  if (/<link\b[^>]*\bhref\s*=/i.test(html)) reasons.push('引用了外部样式');
  if (/@import/i.test(html)) reasons.push('CSS 里 import 了外部资源');
  if (/url\(\s*['"]?\s*(?:https?:)?\/\//i.test(html)) reasons.push('CSS 里引用了外部资源');
  if (/\bsrcset\s*=/i.test(html)) reasons.push('使用了 srcset');
  return { ok: reasons.length === 0, reasons, bytes };
}

/** 去掉模型可能加的 ```html 围栏与前后解释 */
export function stripWidgetFence(text) {
  if (typeof text !== 'string') return '';
  let out = text.trim();
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(out);
  if (fence) out = fence[1].trim();
  const start = out.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) out = out.slice(start);
  return out.trim();
}
