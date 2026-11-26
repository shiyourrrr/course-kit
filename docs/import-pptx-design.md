# 导入 PPT 的重新设计：只进不出

> 2026-11-21 21:15，老师定调："导入进来的只是素材和参考。不编辑，删。"
> 本文是设计，实现交给 codex（额度 00:29 恢复）。

## 一句话

导入一份 PPT = **抽取三种能力**（素材 / 风格参照 / 可复用版式），**不产出可编辑课件**。

## 为什么改

- 现在有两个入口：「＋ 导入 PPT」生成可编辑复制品（进「我的课件」），「＋ 导入参照」只抽结构。
- 老师从不需要改那份复制品。它出现在课件列表里，反而误导"这是要我接着改的稿子"。
- 但保真渲染那 7 个提交不是白做的：把文字抽成 `tN` 之后剩下的**就是"去掉文字的版式"**——正好是模板的原材料。问题只在出口：把原材料当成品交付了。

## 现状代码

| 位置 | 作用 |
|---|---|
| `server.mjs` `POST /api/import-pptx` | 生成 `packs/pptx-<名>/layouts/page-N.html` + `examples/pptx-<名>.deck.json`（要删的出口） |
| `server.mjs` `POST /api/reference` | `references/<slug>/reference.json`：structure / palette / fonts / background |
| `tools/pptx-reference.mjs` `pptx-assets.mjs` | 结构、配色、背景、图片素材抽取（保留） |
| `tools/pptx-import.mjs` `pptx-text.mjs` `pptx-effects.mjs` | 保真页 HTML、文字槽位 `t1..tN`、渐变/阴影（改为模板原料） |
| `tools/reference-map.mjs` | 参照结构 → 内置页型的页序映射（现有的"借用参考页序"） |

## 与「导入模板」的关系：合并成一个入口

老师 21:40 指出："导入模板和导入参照 PPT 感觉是一样的"——**对**。两者都是"导入一份外部版式变成我的模板"，只差文件类型：

| 现有入口 | 吃什么 | 产出 |
|---|---|---|
| ＋ 导入模板 | `.html` | 模板包（页型 + theme，`tools/import-template.mjs`） |
| ＋ 导入参照（PPT） | `.pptx` | 参照结构/配色/背景 + 素材 |
| ＋ 导入 PPT | `.pptx` | 可编辑复制品（**本轮删除**） |

合并后只留一个「＋ 导入模板 / 参照」，按扩展名分派：

- `.html` / `.htm` → 现有模板流程，行为完全不变（产出可用的模板包）
- `.pptx` → 结构/配色/素材 + 原稿只读预览；**版式模板**在第二步从这里提炼（`user-template-*`）

结果都归到「我的模板」/「素材库」/「参照」，都不进「我的课件」。

## 新流程

一个入口：**「＋ 导入 PPT」**（原来的「＋ 导入参照（PPT）」并入，文案改为"导入 PPT（只取素材与参考，不改课件）"）。

一次解析产出三份，**都不进「我的课件」**：

1. `references/<slug>/reference.json` — 结构 / 配色 / 字体 / 背景（已有）
2. `assets/<slug>/` — 可用素材图（已有）
3. `packs/user-template-<slug>/` — **模板（第一步就出）**：保真页已经是"去文字的版式"（文字抽成 `t1..tN` 槽位），只要放到 packs 下、标 `kind:"user-template"`、配一个从 palette/fonts 生成的 `theme.css`，就能立刻在「新建课件」里被选到
4. `references/<slug>/source.deck.json` — 只给"预览原稿"用的数据

删除的出口：
- 不再写 `examples/pptx-*.deck.json`
- 不再写 `packs/pptx-*`（改为写 `packs/user-template-*`）

## 只读预览（老师 21:30 要求保留）

导入后仍要能看原稿长什么样，但**只能看，不能改**：

- 服务端路由 `GET /api/reference-preview?slug=<参照>`：读取 `references/<slug>/source.deck.json` + 同目录 `pack/`，用现有渲染器输出**单页/整份放映 HTML**（与导出同一套渲染，图片内联）
- 界面入口三处之一：导入完成提示里给一个「预览原稿」链接；「🗂 素材库」对话框顶部也放一个；参照列表里同样可点
- 点开是**新标签页的纯放映**（左右键翻页），没有编辑面板、不改 `deck.json`、不进「我的课件」
- 渲染结果**不落盘**（按需生成，避免 13 MB 的静态文件堆在参照目录）

## 模板包契约

```jsonc
{
  "id": "user-template-活动创意款",
  "name": "活动创意款（师大紫）",
  "kind": "user-template",        // 选择器里归到「我的模板」
  "schemaVersion": 1,
  "theme": "theme.css",           // 由 palette/fonts 生成
  "layouts": [{
    "id": "page-4",
    "name": "四栏卡片",            // 老师能改的显示名，默认「第 4 页」
    "slots": ["t1", "t2", "t3"],
    "slotLabels": { "t1": "并列解释四个术语" },  // 原文，表单里直接显示
    // 第二步合并后才有：
    "items": { "key": "items", "bindings": [{ "title": "t2", "body": "t3" }] }
  }]
}
```

- **不做** `slotMeta` 语义键（标题/正文）与 `role` 页型角色——老师判断无价值，见上文
- 页型显示名可以手改，但默认就是"第 N 页"，不猜

## 生成时两条路（并存）

`POST /api/generate` 增 `referenceMode`：

- `structure`（默认，现有行为）：参照结构 → 内置 19 个页型，套参照配色/背景
- `layout`（新）：用 `user-template-*` 的页型，按 `role/when/capacity` 选页序并填槽位

界面：生成对话框里一个选项「借用参考页序」/「套用参考版式」。

## 现成项目：查了什么，用不用

| 项目 | 判断 |
|---|---|
| [@imgly/pptx-importer](https://www.npmjs.com/package/@imgly/pptx-importer) | 浏览器端解析 pptx 的库。**不引入**（我们要的是结构化几何与槽位，不是像素级渲染）；只在补"形状/颜色提取"细节时参考实现 |
| [OpenDocument.core](https://github.com/opendocument-app/OpenDocument.core) | LibreOffice 系 C++，office→HTML。**不引入**：C++ 依赖 + 体积，老师机器上跑不动 |
| [pptx2html](https://docsearch.algolia.com/mcp/docs/repo/g21589/pptx2html) | 转换器思路可参考，但输出是死 HTML，无槽位 |
| [extract_pptx_theme.py](https://github.com/Atom-oh/oh-my-cloud-skills/blob/main/plugins/aws-content-plugin/skills/reactive-presentation/scripts/extract_pptx_theme.py) | 主题色板/字体方案的提取思路，**借鉴**：读 `ppt/theme/theme1.xml` 的 `clrScheme`/`fontScheme` |
| [Reference-Deck Analysis Patterns](https://github.com/sickn33/agentic-awesome-skills/blob/6d4ea18320984083107f07ff69587fa355ee94c0/plugins/agentic-awesome-skills/skills/pptx-deck-creation/references/reference-deck-analysis-patterns.md) | "参考稿要分析哪些维度"的清单，**借鉴**（角色、层级、密度、配色） |

结论：**不换渲染引擎**。现有 `@jvmr/pptx-to-html` + 自己的 effects/text 抽取能给出几何与槽位，这是像素级转换器给不了的；只借用"主题提取"和"参考分析维度"的思路。

## 分四步（每步可独立验收）

1. **合并入口 + 出模板 + 停产出复制品 + 只读预览**：一个「＋ 导入模板 / 参照」按扩展名分派；`.pptx` 立刻产出一套 `user-template-*`（原始形态：`page-N` 页型 + `tN` 槽位 + 主题），能在新建课件时选到；不产可编辑课件；保留预览原稿
2. **同构合并 + 条目数组化**（老师点名的核心）：结构相同的多页并成一个页型，重复块变成 `items:[{…}]`，于是**能加一项、减一项**而不动手排版
3. **（可选，暂缓）语义标注**：`slotMeta`（标题/正文）+ 页型 `role/name/when`。老师判断"标题就叫标题、页型对老师没用"，所以只在将来要做"AI 自动选页型"时才需要
4. **（可选）AI 语义复核**：同上，暂缓

### 为什么语义标注被降级

- 表单里已经显示 `slotLabels` 原文，老师看得懂 `t1` 对应哪段字，不需要再起一个"标题/正文"的名字
- 页型角色只在"让 AI 自己挑页型"时有用；老师的工作流是"拿这套模板往里填"，角色概念不产生价值
- 真正影响手感的是**同构合并**：不合并，四页"标题+四列卡片"就是四个死版式，加一项要手动排版；合并了才是"能装 N 条内容的容器"

## 同构合并的设计要点（第二步展开）

- **判据**：DOM 形状指纹（节点类型 + 顺序 + 类名归一化）+ 几何容差（±2px）+ 字号/背景一致，全部吻合才合并；差异页保留独立页型
- **数据结构**：`layouts[].slots` 里的重复组改为 `items:[{title:"t2",body:"t3"},{title:"t4",body:"t5"}]`（即原有 tN 的分组绑定），渲染时按数组循环
- **编辑**：老师看到的是"条目 1..N"，能「加一条 / 删一条」；底层仍写回 tN
- **容量**：原版式的宽度是死的——条目从 4 变 5 时按可用宽度自动分配；超出一行放不下时提示"这一版式最多 N 项，要么拆成两页，要么换个版式"
- **代价**：编辑往返映射、少项留空、多项分页；合并默认**可拆回**单个页型

## 验收（每步都查）

- 导入一份 pptx 后：**「我的课件」数量不变**；`references/`（含 `source.deck.json` 与 `pack/`）、`assets/` 各多一份；`packs/` 不变
- 「预览原稿」能打开纯放映页，翻页正常，无编辑面板
- 已存在的 8 份课件渲染 **SHA-256 逐字节不变**；`node tools/test.mjs`（现 204 条）0 失败
- 素材库能直接看到新素材；生成能用「套用参考版式」（第三步后）
- 导出 HTML 不含参照/模板/材料内容
- `tools/portable.mjs` 跳过 `references/`、`assets/`、`packs/user-template-*`（私人内容不进试用包）
- 旧数据：如还残留 `packs/pptx-*` 或 `examples/pptx-*.deck.json`，提供一次「提升为模板后删除」的命令行；不删也不报错
