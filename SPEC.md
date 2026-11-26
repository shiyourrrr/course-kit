# SPEC · 模板包协议

这份文件是**贡献者的合同**：照着它写，你的学科包就能被同一个渲染器吃下去。
渲染器不认识数学，也不认识物理，它只认识这里定义的四个东西：`deck.json`、`pack.json`、`layouts/*.html`、`theme.css`。

---

## 1. deck.json

```json
{
  "pack": "math-junior",
  "meta": {
    "subject": "数学",
    "grade": "八年级",
    "title": "勾股定理",
    "teacher": "王老师",
    "date": "2026-11-21"
  },
  "pages": [
    { "layout": "cover", "title": "勾股定理", "subtitle": "…", "duration": 45 },
    { "layout": "objectives", "title": "…", "items": [{ "num": "1", "text": "…" }] }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `pack` | 否 | 模板包 id，缺省 `math-junior` |
| `meta` | 否 | 会合并进每一页的上下文：`{{meta.grade}}` 和 `{{grade}}` 都能取到 |
| `pages[].layout` | **是** | 必须是 `pack.json` 里登记过的页型 id |
| 其余字段 | — | 自由，由对应 layout 决定 |

**约束**：一份课件的页数建议 8–20 页；`pages` 顺序即播放顺序。

---

## 2. pack.json

```json
{
  "id": "math-junior",
  "name": "初中数学",
  "subject": "数学",
  "grade": "初中",
  "version": "0.1.0",
  "license": "MIT",
  "theme": "theme.css",
  "limits": { "title": 26, "text": 62, "stem": 130 },
  "layouts": [
    {
      "id": "concept",
      "name": "概念 / 定义",
      "when": "一个新概念，2-4 个要点卡片",
      "slots": ["kicker", "title", "lead", "items[].num", "items[].term", "items[].text", "note"]
    }
  ]
}
```

- `layouts[].id` 必须对应 `layouts/<id>.html`
- `limits` 按**字段名**给字数上限；渲染时超了会警告，不阻塞
- `slots` 只是给人看的文档，渲染器不校验（真正的槽位从 HTML 里扫）

---

## 3. layouts/*.html —— 一个页型 = 一个片段

**规则**

1. 只写**片段**，不要 `<html>` / `<head>` / `<section>`；渲染器会套上 `<section class="slide">`
2. 用 `{{字段}}` 取内容；不给的字段就是空，不要在模板里写死业务内容
3. 一个页型**只解决一种版面任务**。需要两种版面 → 写两个页型（AI 选页型，比 AI 想版面可靠）
4. 模板里**不要写 CSS**；样式只用 `base.css` 已有的类名，缺类名就提 PR 到 `base.css`（所有学科共享）

**可用类名速查**

| 用途 | 类名 |
|---|---|
| 页眉小标题 / 大标题 | `.kicker` / `h1.title` `h2.title` |
| 分隔线 / 导语 / 页脚 | `.rule` / `.lead` / `.footnote` |
| 主内容容器（垂直居中） | `.body` |
| 卡片网格 | `.grid` + `.grid-2` `.grid-3` `.grid-auto`，卡片 `.card` `.card-num` `.card-term` `.card-text` |
| 编号条目（学习目标） | `.aims` `.aim` `.aim-num` `.aim-text` |
| 公式框 | `.formula-box` `.cond` `.explain` |
| 例题 | `.example-head` `.tag` `.stem` `.steps` `.answer` |
| 图示 | `.figure` `.caption` |
| 折叠答案 | `details.answer`（原生，不用 JS） |
| 左右对比 | `.cmp` `.cmp-col` `.verdict` |
| 要点 / 作业 | `.points` / `.tasks` `.tips` |

**公式怎么写**

- 公式写在**字段值**里，不要写在模板里：`"formula": "$$a^2+b^2=c^2$$"`
- 行内 `$...$`，独占一行 `$$...$$`；模板里 `{{formula}}` 直接输出，KaTeX 在渲染时完成
- 化学式用 `\ce{H2SO4}` 需要在渲染器里注册 mhchem（尚未接，见「路线」）

**原始 HTML 怎么插**

- 三段花括号原样输出：`{{{svg}}}`（用于内联 SVG 图、`<img>`）
- 两段花括号会转义：`{{text}}` —— 内容里的 `<` 会变成 `&lt;`，防止 AI 生成的文本破坏结构

**列表怎么写**

```html
{{#items}}<div class="card"><span class="card-term">{{term}}</span>{{text}}</div>{{/items}}
```

- 数组循环；对象元素的字段直接展开
- `{{^items}}暂无{{/items}}` 为空时显示

---

## 3.5 自定义页：现成页型装不下的那一页

```json
{ "layout": "custom", "htmlFile": "pages/proof-area.html", "css": ".explain { margin-top: 12px }" }
```

| 字段 | 说明 |
|---|---|
| `html` / `htmlFile` | 二选一。`htmlFile` 相对 deck 文件所在目录，适合手写/版控的整页 |
| `css` / `cssFile` | 可选。渲染时自动加 `#pN` 前缀，**只作用于本页**，不会污染其他页 |

- 文本里的 `$…$` / `$$…$$` 照常渲染成公式
- `<!-- 注释 -->` 不会出现在产物里
- **允许**：任意静态 HTML、内联 SVG、`data:` 图片；样式优先用 `base.css` 的类名
- **禁止（渲染时直接报错退出）**：`<script>`、行内事件（`onclick`）、`javascript:`、`<iframe>/<link>/<form>/<object>`、外链资源、`<style>`（样式写 `css` 字段）

为什么留这个口子：模板覆盖不到的表达——拼图证明、电路图、实验装置、受力矢量——硬塞进文本框就是「内容对，但讲不清」，而这是老师最不能忍的失败。

## 3.6 沉淀：把一次发挥变成页型

```bash
node tools/promote.mjs examples/gougu.deck.json 6 proof-area --name "面积法证明"
```

做三件事：写 `layouts/<id>.html`（把页内 css 包进 `<style>`）、登记 `pack.json`、把 deck 里这一页改成 `layout: "<id>"`。

沉淀之后，这一页从「AI 现场写的」变成「模板」：下次直接可用，也能继续把写死的文案换成 `{{字段}}` 让它通用化。

**判断标准：同一种版面第二次出现，就沉淀。** 第一次允许自由发挥——这是「能改」和「不重复发明」之间的那条线。

## 3.7 积木（AI 自由编排的组件清单）

页型不是唯一的写法。任何页面都可以用 `base.css` 提供的组件直接拼，12 栏网格负责对齐：

| 类别 | 类名 |
|---|---|
| 结构 | `.body` `.stack` `.stack-sm` `.stack-lg` `.row` `.cols` + `.c3 .c4 .c5 .c6 .c7 .c8 .c9 .c12` |
| 文字 | `.kicker` `h1.title` `h2.title` `.lead` `.rule` `.footnote` `.caption` |
| 容器 | `.panel` `.panel-soft` `.card` `.cmp` `.cmp-col` `.verdict` |
| 教学 | `.aims` `.aim` `.formula-box` `.cond` `.explain` `.stem` `.steps` `.answer` `.callout` `.points` `.tasks` `.tips` `.tag` |
| 数据 | `.stat` `.table` |
| 图示 | `.figure` `.figure-img` `.img-frame` |
| 工具 | `.muted` `.accent` `.small` `.center` `.spacer` `.mono` `.nowrap` |

**规则**：新组件一律加进 `base.css`（所有学科共享）；**不要**在 pack 的 `theme.css` 里写布局，那会分叉成互不兼容的方言。

## 3.8 动效：只写属性

| 属性 | 取值 | 作用 |
|---|---|---|
| `data-anim` | `fade-up` `fade-down` `slide-left` `slide-right` `fade` `scale` `blur` | 入场方式 |
| `data-delay` | 整数毫秒 | 延迟 |
| `data-stagger` | 无值 | 加在容器上，子元素依次入场（80ms 递增） |
| `data-build` | 1..n | **点按才出现**；数字小的先出；全部揭示完才翻页 |

**默认入场**：一页若没有显式 `data-anim`，运行时会自动给它的子元素一个克制的依次入场（`.auto-in`）。所以「模板页」不会静止得像 PDF。

**关闭方式**：演讲时按 `A` 关闭全部动效；`prefers-reduced-motion` 与打印模式也会自动关闭。
**约束**：信息不能只靠动效传达（关了也得讲得下去）；`data-anim` 只允许上表 7 个值，`tools/lint.mjs` 会校验，写错直接报错。

## 3.9 图片：本地文件自动内联

```html
<img class="figure-img" src="images/xxx.png" alt="说明">
```

- 渲染时把**相对路径**的图片读成 base64 内联进产物，单文件仍可直接发送
- 查找顺序：deck 所在目录 → 自定义页所在目录 → pack 目录
- 单张上限 3MB，超过则跳过并警告；不支持 `http(s)` 外链（会破坏离线可用）
- 支持 png / jpg / webp / gif / svg

## 3.10 应急修改：`tools/quick.mjs`

```bash
node tools/quick.mjs examples/gougu.deck.json "第 3 页标题改成 三条边的名字"
```

- **离线规则**（无网络也能用）：`第 N 页<字段>改成 X`、`删掉第 N 页`、`把第 N 页和第 M 页换位置`、`主题色改成 #RRGGBB`
- **在线模型**（设了 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`）：返回结构化 ops，支持 `set / delete / swap / html / theme`，`html` 可以整页重写
- 改完自动重渲染 + 自检，老师只需在浏览器按 F5

## 4. theme.css —— 只改变量

```css
:root {
  --accent: #1d4ed8;        /* 主色，决定所有强调色 */
  --accent-soft: rgba(29,78,216,.07);
  --bg: #ffffff;
  --bg-soft: #f3f6fb;
  --ink: #111827;           /* 正文最深色 */
  --ink-2: #374151;         /* 次要文字 */
  --ink-3: #6b7280;         /* 页脚/提示 */
  --line: rgba(17,24,39,.1);
  --radius: 12px;
  --pad-x: 76px;            /* 左右留白 */
  --pad-y: 58px;
}
```

**不要**在 theme.css 里改布局（宽度、flex、定位）。改了就不是主题，是分叉。
需要新布局结构 → 提 PR 到 `src/base.css`，让所有学科一起受益。

---

## 5. 渲染规则（渲染器做了什么）

1. 读 deck + pack，逐页把 layout 片段用当前页字段渲染；自定义页（`html`/`htmlFile`）不套版式，但仍走同一套安全校验
2. `$...$` / `$$...$$` → KaTeX → HTML（**构建时**完成，产物不含 KaTeX JS）；模板里的字面量公式同样渲染
3. 图片相对路径 → base64 内联（单文件自足）
4. 把 `base.css` + `theme.css` + KaTeX CSS（20 个 woff2 字体转 base64）+ 各页的页内 css 内联进 `<style>`
5. 把 `runtime.js` 内联进 `<script>`；运行时负责缩放、翻页、点按揭示、总览、打印、关动效
6. 输出单个 HTML —— 无外链、无网络请求、可直接双击

**体积**：KaTeX 字体约 254 KB → base64 约 340 KB，所以一份纯文字课件也是 400 KB 起步。要更小：

- 删掉 css 里没用到的 `@font-face`（数学课一般用不到 `KaTeX_Caligraphic` 等）
- 用 `pyftsubset` 对中文字体做子集（如果你真的内嵌了中文字体）
- 不要再引第二套图标字体 —— 图标优先用内联 SVG

---

## 6. 路线（还没做的）

- [ ] 公式页支持 mhchem（化学式）
- [ ] `figure` 页接受 `figure` 字段 + 外部 SVG 文件路径，而不是整段字符串
- [ ] 编辑器 UI：改字段 → 实时预览（Tiptap/React 都行，但先别急）
- [ ] 复习课 / 习题课 / 实验课页型
- [ ] 题目模块：`questions.json` 与本 kit 同源（见调研笔记 §3）

## 页级背景图

模板页和自定义页都可用 `background` 指定本地图片的相对路径。依次查找 deck 目录、当前自定义页的 HTML 文件目录（使用 `htmlFile` 时）、pack 目录。图片等比裁剪铺满整页，打印时保留。支持 PNG、JPEG、WebP、GIF 和 SVG。图片缺失、格式不支持或单图超过 3 MB 时会警告并继续渲染。

可选的 `veil` 控制黑色遮罩的不透明度，默认 0.35。0 完全透明，1 完全遮住图片。

```json
{ "layout": "cover", "title": "勾股定理",
  "background": "images/desk.jpg",
  "veil": 0.45 }
```

## 热区跳页与页间转场

任意元素可用 `data-goto` 指定从 1 开始的页码，例如 `<button data-goto="3">跳到第三页</button>`。点击后页码与地址栏同步更新为第 3 页和 `#3`。总览中点击热区也会打开目标页，点击缩略图其他位置则打开该缩略图。无效页码会被忽略，并在控制台输出警告。

支持 View Transitions 的浏览器使用 0.42 秒淡入淡出与轻微缩放。按 A 键切换动效；启用 `body.no-anim`、系统偏好减少动态效果或浏览器缺少该 API 时，直接切页。
