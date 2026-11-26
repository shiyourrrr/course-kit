# course-kit

## 三种用法

1. **网页界面（推荐）**。安装 Node.js 后双击 `start.bat`，选择课件和页面，修改后点「保存」。点「导出 HTML」即可得到能离线放映的课件。首次安装依赖需要联网，依赖装好后可断网使用。
2. **命令行**。运行 `npm install`，再运行 `npm run render -- examples/erci.deck.json` 生成课件。
3. **只改文件**。用文本编辑器修改 `examples/*.deck.json`，交给同事渲染，或在网页中打开后导出。已有 HTML 可直接双击放映。

> 截图占位：左侧选课件，中间调整页面顺序，右侧编辑文字并预览放映效果。

> 一句话：**AI 只负责填内容，版式由模板保证。**
> 输入一个 `deck.json`，输出一个能双击打开、全屏演示、断网可用的 HTML 课件。

这不是「让 AI 画 PPT」的项目。PPT 的问题不是 AI 画得丑，而是**每次画得都不一样**——溢出、字体缺失、改一处坏全局。
这里把版式从 AI 手里拿走：模板作者（老师）定义好每页长什么样，AI 只填字。

## 工作流：先对齐，再出方案，最后才做课件

页数和重点**不由工具决定**，由老师决定。所以顺序是：

1. **问** —— `prompts/teacher-intake.md` 里的 5 个问题（课型 / 时长 / 重心 / 学生易错 / 硬约束）
2. **方案卡** —— 出一份 `plan.json`，打印给老师看：多少页、每段几分钟、重点在哪、题量多少
   ```bash
   npm run plan        # 渲染 examples/plan-yicihanshu.json 成一张方案卡
   ```
   方案卡会检查：分钟合计是否对得上、讲授页占比、有没有情境导入与图示、重心说要"推导"却排了没推导的页
3. **确认后生成** —— 老师改完/点头，才写 `deck.json`

跳过第 1、2 步直接生成 11 页，就是这个项目最典型的失败方式。

## 快速开始

```bash
npm install
npm run demo        # 渲染 examples/gougu.deck.json → examples/gougu.deck.html
```

### 免安装版（给不想装 Node 的老师）

```bash
node tools/portable.mjs
# → dist/课件工作台/（约 113 MB，其中 node.exe 88 MB、运行时依赖 24 MB）
```

- 老师拿到 `dist/课件工作台/`（或压成 zip，约 41 MB），**双击「启动课件工作台.bat」**即可，浏览器自动打开
- 自带 Node 运行时与 `node_modules`，不需要装任何东西；课件存在该目录的 `examples/` 里，换电脑整包拷走
- 不随包分发：你导入的 PPT 原文件（`examples/sources/`）与派生课件（`examples/pptx-*`）
- 端口固定 `5178`；关掉黑色窗口即停止服务
- 注意：这是「免安装文件夹」，不是单文件 exe；要单文件需要 Node SEA 打包（未做）

打开 `examples/gougu.deck.html`：

| 操作 | 键 |
|---|---|
| 下一页 / 上一页 | `→` `↓` `空格` `PageDown` / `←` `↑` `PageUp` |
| 点按揭示下一步（有 `data-build` 时先揭示，揭示完才翻页） | `→` / `空格` |
| 全屏 | `F` |
| 总览（九宫格） | `Esc` 或 `G` |
| 热区跳页 | 点击带 `data-goto` 的元素可跳页 |
| **一键关动效**（投影卡顿 / 学生不适时应变） | `A` |
| 打印 / 导出 PDF | `P`（Chrome：另存为 PDF，保持 16:9） |

## 三种颗粒度的「改」

AI 不是只能填字段。按需求改不同的层：

| 颗粒度 | 谁改 | 改什么 | 会不会污染别人 |
|---|---|---|---|
| **填内容** | AI | `deck.json` 的字段 | 不会 |
| **改这一页的版面** | AI | 自定义页 `html` / 页内 `css`（自动只作用于本页） | 不会 |
| **改通用版式** | 人 | `layouts/*.html`、`base.css` | 会，所有用这个包的课件都变 |
| **沉淀** | 人 / AI | `tools/promote.mjs` 把自定义页变成页型 | 变强了，不是污染 |

判断标准就一句：**同一版面第二次出现，就该沉淀；第一次允许自由发挥。**

```bash
# AI 现场写了一页（examples/pages/proof-area.html），用过后沉淀成页型
node tools/promote.mjs examples/gougu.deck.json 6 proof-area --name "面积法证明"
```

沉淀会：写 `layouts/proof-area.html`（含页内 css）→ 登记 `pack.json` → 把 deck 里那页改成 `layout:"proof-area"`。

## 动效是属性，不是代码

AI 不需要写 CSS 动画，只加属性：

```html
<h2 class="title" data-anim="fade-up">标题</h2>
<div class="panel" data-build="1">点一下才出现</div>
<div class="stack" data-stagger>子元素依次入场</div>
```

- 7 种入场：`fade-up` `fade-down` `slide-left` `slide-right` `fade` `scale` `blur`
- `data-build="1..n"` 是**讲课节奏**：按右方向键逐步揭示，揭示完才翻页
- 没写属性的页面，运行时自动给一个克制的默认入场——所以「模板页」不会静止得像 PDF
- 写错属性值不会崩，但会静默失效，所以 `lint` 会校验（`data-anim="wobble"` 直接报错）
- 课上按 `A` 一键关掉全部动效；`prefers-reduced-motion` 与打印也会自动关

## 图片：截图就行

截图 → 存到 `examples/images/`（或任意相对路径）→ deck 里写：

```html
<img class="figure-img" src="images/squares-on-sides.png" alt="三边上的正方形">
```

渲染时自动读成 base64 内联，**产物仍是单个文件，可以直接发微信**。查找顺序：deck 目录 → 自定义页目录 → pack 目录；单张上限 3MB。
建议文件名带页码或主题（`p5-squares.png`），半年后还认得出是哪一页的图。

## 题单：Markdown → 学生版 / 教师版

```bash
node tools/questions.mjs examples/questions.md            # 一次出两份
node tools/questions.mjs examples/questions.md --mode teacher
```

题目就用 Markdown 写——老师能读能改，AI 也能写，改动能 diff：

```markdown
### 1. [单选] 在 Rt△ABC 中，∠C = 90°，$a=3$，$b=4$，则 $c=$（　）
- [ ] 3
- [x] 5
> 答案：5
> 解析：由 $a^2+b^2=c^2$ 得 $c=\sqrt{3^2+4^2}=5$。
```

- 题型：`[单选]` `[多选]` `[判断]` `[填空]` `[解答]`
- **学生版**自动去掉答案解析；**教师版**勾出正确项（☑）、附答案与解析
- A4 打印友好：题目不跨页、解答题自带横线留白、页眉有姓名/班级/日期 —— 浏览器 `Ctrl+P` 存 PDF 即可
- 格式是给你自己用的：**工具不碰任何题库**，题目来源你自己把握

## 课上临时改：一句话

```bash
node tools/quick.mjs examples/gougu.deck.json "第 3 页标题改成 三条边的名字"
node tools/quick.mjs examples/gougu.deck.json "删掉第 9 页"
node tools/quick.mjs examples/gougu.deck.json "主题色改成 #0f766e"
```

- **离线规则**认这几种说法（教室没网也能用）：改某页某字段、删页、换页序、换主题色
- **联网时**（设 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`）可以说得更自由，模型返回结构化 ops，支持整页重写
- 改完自动重渲染 + 自检，浏览器按 F5 就能看到

## 目录结构

```
course-kit/
├── src/
│   ├── template.mjs    # 40 行模板引擎：{{字段}} {{{原始HTML}}} {{#列表}}...{{/列表}}
│   ├── base.css        # 版式骨架（所有学科共用，改它要慎重）
│   ├── runtime.js      # 演示运行时：缩放、翻页、总览、打印
│   └── render.mjs      # 渲染器：deck.json + pack → 单个 HTML
├── packs/              # ★ 模板包＝一个学科/学段。这里是产品真正的资产
│   └── math-junior/    #   初中数学：19 个页型
│       ├── pack.json   #   页型清单 + 字数上限
│       ├── theme.css   #   主题：只改变量
│       └── layouts/    #   每页一个 HTML 片段
├── examples/           # gougu.deck.json（勾股定理，11 页）+ 渲染产物
│   ├── pages/          # 自定义页（AI 自己写的整页 HTML）
│   └── images/         # 本地图片（渲染时自动内联）
├── prompts/deck-gen.md # ★ 给 AI 的契约：一句话题目 → deck.json
└── tools/
    ├── new-pack.mjs    # 一键新建学科模板包
    ├── promote.mjs     # 把自定义页沉淀成页型
    ├── quick.mjs       # 课上一句话改课件（离线规则 + 可选模型）
    ├── questions.mjs   # Markdown 题单 → 学生版 / 教师版 A4
    ├── outline.mjs     # 打印大纲：每页页型/字数/公式数
    ├── lint.mjs        # 静态自检：占位符/公式/动效属性/外链
    ├── check.mjs       # 真实量溢出（需要本机 Chrome/Edge）
    └── figures/        # 用 Pillow 画教学示意图的脚本
```

## 加一个新的年级 / 学科

```bash
node tools/new-pack.mjs physics-junior "初中物理"   # 以 math-junior 为蓝本复制
```

然后改三样东西：

1. `packs/physics-junior/theme.css` —— 换主色、字体、圆角（**只改变量，别碰 base.css**）
2. `packs/physics-junior/layouts/*.html` —— 改文案、加页型（比如「实验演示」「受力分析」）
3. `packs/physics-junior/pack.json` —— 登记页型，写清楚每个页型什么时候用、有哪些槽

**加页型的门槛**：写一个 HTML 片段，放几个 `{{字段}}`，在 `pack.json` 里登记一行。不需要写 JS、不需要写 CSS（除非真要新样式）。

### 习题课与试卷讲评页型

| 页型 | 课堂用途 | 主要内容 |
|---|---|---|
| `exercise` 习题精讲 | 让学生先做，再逐步核对 | 题号与分值、题干、提示、解题步骤、答案与易错点 |
| `variant` 变式训练 | 比较同一原题改动条件后的解法 | 原题要点、变式卡片、提示、统一答案 |
| `mistake` 错因归类 | 横向对照多种错误 | 常见错法、原因、纠正动作 |
| `wrong` 典型错题讲评 | 围绕一道题定位第一处错步 | 原题、学生错解、诊断、逐步正解、追问 |
| `score` 总体情况 | 根据全班答题表现确定讲评重点 | 数字卡、课堂结论、统计口径 |

## 导入第三方 HTML 模板

GitHub 上有大量现成的 HTML 演示模板，导入后就能当模板包用：

**网页界面**：左栏「＋ 导入模板」→ 选一个 `.html` 文件 → 自动切页、抽样式、推断槽位 → 直接用于新建课件。

**命令行**：

```bash
node tools/import-template.mjs 某个模板.html --name "杂志风" --source https://原项目地址
# → 生成 packs/imported-杂志风/（pack.json + theme.css + layouts/page-N.html）
```

**它自动做的**：

- 去掉 `<script>`、行内事件、外链资源（离线 + 安全）
- 抽出页面里的 `<style>`，把 `body/html` 选择器改写成 `.slide`、`section` 改写成 `.tpl-page`
- 按 `<section>` 或 `<hr>` 切页，每页一个 layout
- 第一个标题 → `{{title}}`，前三个段落 → `{{text}}` / `{{text2}}` / `{{text3}}`
- 类名隔离：模板里的 `.tag` / `.card` / `.title` 和我们的组件撞车时，先恢复默认再让模板样式覆盖

**做不到的（会提示）**：

- reveal.js 的垂直分页会被拍平
- 依赖外部 CSS / JS 插件的模板（先另存成单文件再导入）
- 复杂组件（图表、时间线）不会被字段化——导入后**只能改文字，版式固定**

**许可**：导入前确认原模板许可证；把作者和链接填进 `pack.json` 的 `source` 字段。AGPL / 非商用模板不要用于对外分发。

## 三层自检

```bash
npm test                                                  # 回归测试：会先重新渲染，再按页断言（不需要浏览器，约 0.4 秒）
npm run lint -- examples/gougu.deck.html                  # 静态自检（不需要浏览器）
node tools/check.mjs examples/gougu.deck.html --shots .shots  # 真实量溢出 + 每页截图（需要本机 Chrome/Edge）
```

- `test` 查：页数、页序、每页锚句、公式数、`data-build` 数、图片可解码、无外链、无模板残留；期望值在 `test/expected.json`
- `lint` 查：占位符残留、公式是否渲染、CSS 括号、每页内容量、动效属性合法性、外部依赖
- `check` 量：每页**真实溢出**（`scrollHeight > 720`）和横向越界，可同时给每页截图

> 溢出时的修复顺序：**删字 → 拆页 → 换页型**。不要靠缩字号硬塞——投影仪上 18px 以下学生真的看不清。

## 为什么是单文件

- 老师双击就能放，不用装软件、不用联网、不怕教室电脑没网
- 能直接发微信群 / 存 U 盘
- 代价：KaTeX 字体内联，约 400 KB。发之前可以再压（见 `SPEC.md` 的「优化体积」）

## 已知边界（别指望它现在就能干的事）

- **版式与动效未经人眼验收**：本仓库的截图/量测依赖本机浏览器，开发环境起不了浏览器，所以 `examples/gougu.deck.html` 请你自己打开翻一遍
- **默认入场是"温和版"**：如果你想更活泼，让 AI 显式加 `data-anim`；想更稳，把 `A` 按下去讲
- 没有编辑器 UI：改课件 = 改 `deck.json` / 自定义页，再渲染（这是刻意的，点选式编辑器后面再说）
- 没有配图生成：图要么内联 SVG，要么用 `tools/figures/` 的脚本画，要么外部生成后放进 `images/`
- 初中数学包有 19 个页型，提供新授课、习题课和试卷讲评示例。

## 许可

MIT。模板随便改、随便商用、随便改成你自己的学科包——只保留出处即可。

老师想自己换背景时，把图放进 deck 旁的 `images/`，在对应页加上 `"background": "images/desk.jpg"`，可用 `veil` 调整遮罩深浅。
## 配置 AI（可选）

1. 打开 [DeepSeek 开放平台](https://platform.deepseek.com) 注册账号。
2. 在平台充值，几元即可开始使用。
3. 创建 API key，在工作台右上角齿轮中粘贴并保存。默认模型为 `deepseek-chat`，可修改模型和兼容接口地址。

密钥保存在本机 `app-data/settings.json`。本地改短、拆行、字号和撤销均可离线使用。AI 仅编辑当前页已有文字，拆页可用页面列表的「复制」。

## 导入 PPT

点击左栏「＋ 导入 PPT」，选择 30 MB 以内的 `.pptx` 文件。转换在本机 Node 中完成，成功后编辑器会打开新课件。每张幻灯片生成一个固定布局的保真页，页内元素不可重排。图片和表格的还原效果取决于原模板。

命令行也可运行 `node tools/pptx-import.mjs "课件.pptx" --name "显示名"`。模板保存在 `packs/`，可直接打开的课件保存在 `examples/`。
