# course-kit（课件工作台）

给中小学老师用的本地备课工具：输入课题或挂上教材，快速生成整节课、课后作业和 A4 试卷，在浏览器里微调完，导出成**单个断网可放的 HTML 文件**，拷进 U 盘或发微信群，到教室电脑双击就能全屏放映。

![课件工作台界面](docs/preview.png)

## 为什么要做这个

用通用 AI 直接画 PPT，常见的问题不是不好看，而是**版式不稳**——字一多就溢出、换台电脑缺字体、改一页全乱套，最后还得花一小时手动调格式。

`course-kit` 把**版式**和**内容**拆开：
- 每种课型（封面、目标、概念、公式、例题、练习、对比、小结、作业）都由固定页型和字数上限兜底，不容易撑爆屏幕；
- AI 只负责按教学重点往槽位里填内容、写讲稿、出变式题；
- 最终产物是自包含的单文件 HTML（公式字体 KaTeX 和图片全部内联），不依赖教室网络，也不用装 Office 或浏览器插件。

## 主要功能

- **一句话生成整节课**：选年级、课型和内容饱满度，AI 先拆教学重难点再逐页填内容，同时自动生成每页口述讲稿（支持导出 Markdown 或 A4 打印版讲稿）。
- **教材库与原书页码溯源**：支持导入 Word（`.docx`）、纯文本、以及 PDF / MinerU 结果包（`.zip`），保留公式与插图；生成课件时可按原书页码范围（如 `22-25`）精准截取，并支持无损校准纸质课本页码偏移。
- **可视化编辑与微调**：左侧选课件和页序，中间改文字/公式，右侧实时双缓冲预览；切到「微调版面」后可直接拖拽、拉角缩放，双击画布文字原地修改。
- **12 套主题与 8 种切页动效**：支持整本换主题，也支持单独给某一页换主题；内置 11 种元素入场动效与点击逐步揭示，上课按 `A` 键可随时一键关闭全部动效。
- **互动演示块**：内置 6 套数学参数化模板（二次函数、一次函数、三角函数、几何动点、勾股拼图等）、24 个精选 PhET 中文实验（备课按需缓存、上课断网可用），也支持导入本地 `.html` 或嵌入 GeoGebra / Desmos 链接。
- **AI 智能出卷与课后作业**：
  - 课后作业可选总题量（3 / 5 / 6 / 8 / 10 题）、AI 自由度（严格紧扣教材 / 标准变式 / 自由拓展）和难度侧重；
  - 新建试卷支持按单选、多选、判断、填空、解答精确配题量生成，进审核清单勾选修改后，一键导出**学生版 / 教师版** A4 打印 HTML。
- **导入学校 PPT / HTML 模板**：把 `.pptx` 转为可用模板包（导入时可选是否把装饰图抽进素材库），素材库支持分组查看和批量清理。
- **新手引导与缓存清理**：首次打开提供 6 步高亮指引（右上角 `?` 可随时重看）；设置面板自带本机缓存统计与一键清理。

## 快速开始

### 方式一：本地源码运行

需要 Node.js 20+（推荐 Node 24）：

```bash
git clone https://github.com/shiyourrrr/course-kit.git
cd course-kit
npm install
node server.mjs --open
```

启动后浏览器会自动打开 `http://127.0.0.1:5178`（Windows 也可以直接双击 `start.bat`）。

### 方式二：打包成免安装版（发给不想装 Node 的同事）

```bash
node tools/portable.mjs
```

会在 `dist/课件工作台/` 生成自带 `node.exe` 与运行依赖的独立文件夹（压成 zip 约 41 MB，不含本机 API Key 和个人教材数据）。对方解压后双击「**启动课件工作台.bat**」即可使用。

### 配置 AI（可选）

本地编辑、微调、导出、离线演示和题单排版均**无需联网、无需 API Key**。如需使用 AI 生成整课、单页改写、写讲稿或智能出卷：

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com)（或任意 OpenAI 兼容接口）创建 API Key；
2. 打开工作台右上角「⚙ 设置」，粘贴 Key 并保存；
3. 如需直接上传 PDF 教材做公式与页码解析，可在同一面板选填 [MinerU](https://mineru.net/apiManage) API Token（不填也可直接导入 MinerU 网页版导出的 `.zip`）。

所有密钥只保存在本机 `app-data/settings.json`（Windows 下自动收紧文件 ACL 仅当前用户可访问），不会被打包或上传。

## 放映快捷键

导出后的单文件 HTML 双击即可在任意现代浏览器放映：

| 操作 | 快捷键 |
| --- | --- |
| 下一页 / 下一步揭示 | `→`、`↓`、`空格`、`PageDown` |
| 上一页 | `←`、`↑`、`PageUp` |
| 全屏 / 退出全屏 | `F` / `Esc` |
| 九宫格总览 | `G` 或 `Esc` |
| 一键关闭 / 开启全部动效 | `A` |

## 命令行工具与测试

如果你习惯用命令行批量渲染或做二次开发：

```bash
# 渲染单份课件为离线 HTML
node src/render.mjs examples/gougu.deck.json --out examples/gougu.deck.html

# 静态自检（占位符 / 公式 / 外链 / 动效白名单）
node tools/lint.mjs examples/gougu.deck.html

# 真实浏览器量测页面是否溢出（需本机安装 Chrome 或 Edge）
node tools/check.mjs examples/gougu.deck.html

# 运行全套回归测试（334 条断言 + 8 份渲染 SHA-256 基线 + 38 项浏览器回归）
node tools/test.mjs

# 运行专项单元测试（MinerU / 演示库 / 缓存与素材 / AI 出卷 / 审计回归）
node --test test/mineru.test.mjs test/widget-library.test.mjs test/p5-audit-fixes.test.mjs test/cache-and-assets.test.mjs test/exam-ai.test.mjs
```

## 目录概览

```text
course-kit/
├── server.mjs               # 本地 HTTP 服务与 API 路由（默认 5178 端口）
├── app/                     # 工作台前端与业务模块
│   ├── index.html / app.js / app.css
│   ├── ai.mjs               # AI 填页、两阶段规划、单页改写、讲稿生成
│   ├── exam-ai.mjs          # AI 智能出卷与课后作业题量/自由度控制
│   ├── books.mjs / mineru.mjs # 教材库、MinerU 解析、页码截取与无损校准
│   ├── widget-library.mjs   # PhET 缓存、本地 HTML 与外链演示库
│   ├── cache-store.mjs      # 本机缓存清理与素材库管理
│   └── tour.mjs             # 6 步新手引导
├── src/                     # 离线单文件渲染器、运行时与清洗模块
├── packs/                   # 页型模板包（math-junior / cinema / general-elastic 等）
├── themes/                  # 12 套内置视觉主题 CSS
├── examples/                # 8 份内置示例课件
├── tools/                   # 打包、自检、PPT 导入与回归测试脚本
└── test/                    # 单元测试与渲染 SHA-256 基线
```

## 开源许可

MIT License。欢迎自由修改、自建学科页型包或在校内分发，保留出处即可。
