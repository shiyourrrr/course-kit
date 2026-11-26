# 安全检查报告（2026-11-21）

## 威胁模型

这是**本机单人使用**的工具：服务只监听 `127.0.0.1`，没有账号体系，课件就是本地文件。
真正需要防的不是"远程攻击者"，而是：

1. **不可信内容**：导入的 HTML 模板、导入的 PPT、别人分享的模板包（`packs/` 目录）
2. **课件产物**：导出的 HTML 会被发到微信/U 盘，在别人机器上打开
3. **本机数据**：`examples/` 里的课件与图片

## 修掉的漏洞（按严重度）

### 1. 模板包 layouts 完全不过滤（高）

**问题**：渲染器只对"自定义页"做安全检查；`packs/*/layouts/*.html` 里的内容原样进课件。
放一个含 `<script>` 的模板包，渲染出的课件里脚本完整保留：

```
含 __pwn: True   ← 打开课件就执行
```

**影响**：老师从网上拿到一个"模板包"，打开课件即被执行脚本（可读取页面内容、发外链）。

**修复**：新增 `src/sanitize.mjs`，渲染每个 layout 前统一清理，并在输出里告警：

```
· 第 1 页（page-1）已清理：<script>、行内事件属性、可执行协议（javascript: / data:text/html）
```

### 2. 导入模板残留 `javascript:` 链接与 `<form>` 外链（中高）

**问题**：模板导入的清理只处理 `<script>`、`on*`、`<link>`、外链 `src/href`，
漏掉了 `href="javascript:…"` 与 `<form action="http://evil…">`。老师点一下"链接"就执行脚本。

**修复**：导入与渲染都走统一清理（`<form>/<script>/<iframe>/<object>/<embed>` 删除、`javascript:` 与 `data:text/html` 协议删除）。
复测：`javascriptUrl: false`、`form: false`。

### 3. 导入模板的 CSS 可以外联（中）

**问题**：模板的 `<style>` 会原样写进 `theme.css`，`url(http://evil/bg.png)` 和 `@import url(http://evil/x.css)` 都保留。
**只要打开课件，浏览器就会向外部发请求**（泄露"谁在什么时候打开过"，还可能是 CSS 侧信道）。

**修复**：新增 `stripExternalCss()`：删除 `@import`、把外链 `url()` 换成 `none`。
模板导入与模板包渲染都会应用。复测：`含 http: False / 含 @import: False`。

### 4. 图片路径可越出仓库（中，之前已修）

`inlineImage` 用 `path.resolve(dir, src)` 直接读文件，`../../…` 能读到仓库外任意图片并内联进导出文件。
已改为只允许目录内路径，越界告警并跳过。

## 已验证的防护

| 检查项 | 方法 | 结果 |
|---|---|---|
| 跨站写操作 | 带 `Origin: http://evil.example` POST | **400** |
| 请求体上限 | 9 MB body | **400**（上限 8 MB） |
| 课件名 | 白名单正则 `/^[\p{L}\p{N}_-]{1,100}$/u` | 拒绝 `../`、`:` 等 |
| 自定义页文件 | 必须是 `pages/xxx.html` | 服务端校验 |
| 上传图片 | 扩展名白名单 + ≤3 MB + 服务端生成文件名 | 通过 |
| 自定义页脚本 | `<script>` | **硬失败**（不是静默清理） |
| 导出的课件 | 外链扫描 | 0 个 `http(s)` 资源引用 |
| 危险模式扫描 | `innerHTML` / `eval` / `new Function` | **0 处** |
| 子进程 | `execFile` 固定参数数组 | 无 shell 拼接 |
| 依赖已知漏洞 | OSV 查询 4 个包 | **0 条** |

## 残余风险（接受或待办）

1. **PPTX 解析在同进程**：`pptx-to-html` + `jsdom` 直接解析不可信文件。恶意构造的 pptx 可能造成内存暴涨/长时间占用（DoS），或触发解析器漏洞。缓解：导入限制 30 MB、工具 30 秒超时；彻底缓解需要子进程隔离（未做）。
2. **AI 接口的 `baseUrl` 可配**：设置里能改成任意地址，等于本机发起请求（SSRF）。但只有本机使用者能改，且不随课件分发，风险低。
3. **免安装包里的 `node.exe` 未签名**：来源是本机安装的 Node；分发给别人时应说明来源，或后续做代码签名。
4. **模板包的视觉风险**：清理只挡可执行/外联内容，第三方模板的排版仍可能崩坏（`check.mjs` 量溢出可发现）。

## 第二轮加固（同日晚）

### 5. 清理器可被编码/大小写/嵌套绕过（中高，已修）

第一轮的清理是"一遍正则"，能被这些方式绕过：

| 绕过方式 | 例子 |
|---|---|
| HTML 实体编码 | `href="java&#115;cript:alert(1)"` |
| 十六进制实体 | `href="&#x6a;avascript:alert(1)"` |
| 制表符分隔 | `href="java\tscript:alert(1)"` |
| 大小写 | `<ScRiPt>`、`OnErRoR` |
| 属性名与等号间空格 | `onerror = "alert(1)"` |
| SVG 命名空间 | `<svg onload="alert(1)">` |
| 嵌套拼接 | `<scr<script>ipt>alert(1)</script>`（删一层后拼出合法标签） |
| 协议变体 | `data:text/html;base64,…` |
| CSS 转义 | `url(\68 ttp://e/x.png)` |

**修复**（`src/sanitize.mjs` 重写）：

- 判定前**解码 HTML 实体**并去掉空白/控制字符
- 属性级处理：`on*`、`javascript:/vbscript:/data:text\/html`、表单外链
- **反复清理到稳定**（最多 5 轮），解决"删一层拼出新标签"
- 覆盖 `<svg>`/`<math>` 上的事件属性、`<base>`、`<meta refresh>`
- CSS 侧先还原 `\XX` 转义，再删 `@import`、外链 `url()`、`expression()`、`-moz-binding`、`behavior`

**验证**：`node tools/sec-fuzz.mjs` 覆盖 16 类 payload，输出「全部 payload 已中和」；
其中 12 类关键用例已进 `npm test` 回归（断言数 118 → 130）。

### 6. 接口地址可指向内网（SSRF，已修）

设置里的 `baseUrl` 只校验了 `http(s)://`，可以填 `http://127.0.0.1:…`、`http://169.254.169.254/…`。

**修复**：白名单式校验（`app/ai.mjs` 的 `isSafeBaseUrl`）：

- 公网必须 **https**；仅 `localhost / 127.0.0.1 / ::1` 允许 http
- 拒绝内网段（10/172.16-31/192.168/127 其它）、链路本地（169.254）、保留段
- 拒绝带账号密码、查询串、`file:`、`.local` / `.internal`

### 7. 编辑页没有 CSP（已修）

编辑器页面现在返回：

```
Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  connect-src 'self'; frame-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

预览 iframe 是独立文档（需要内联运行时脚本），不套这条 CSP。

### 8. 子进程没有内存上限（已修）

渲染/lint/导入都通过子进程跑，之前只限 30 秒超时。现在加 `--max-old-space-size=512`：
恶意构造的大文件最多把子进程撑爆，不影响主服务。

### 9. 免安装包里的 node.exe 无来源标识（改善）

`tools/portable.mjs` 现在会把 `node.exe` 的 SHA-256 写进 `使用说明.txt`，接收方可以核对。

### 10. HTML 片段与样式归一化复查

原先的实体表、属性正则和五轮删除无法稳定处理引号、实体边界及标签拼接。现在复用已安装的 parse5，在属性解码后检查协议、事件和命名空间属性，按节点删除并序列化修复后的片段。CSS 在比较副本中处理注释和转义，危险复杂样式整块丢弃。仍未覆盖完整 CSS 语法、所有资源地址或自定义页的独立渲染路径。

现有 sec-fuzz 全部通过，npm test 为 130 条断言、0 失败。六份课件重新渲染与仓库版本逐字节一致。20,480 字节正常 HTML 预热 20 次后测 100 次，平均 1.020 ms（Node v24.16.0）。

## 仍然不能完全解除的

| 风险 | 为什么解除不了 | 缓解 |
|---|---|---|
| PPTX/jsdom 解析不可信文件可能触发解析器漏洞 | 第三方解析器内部缺陷不在我们控制内 | 子进程隔离 + 512MB 内存上限 + 30s 超时 + 30MB 文件上限 |
| `node.exe` 未做代码签名 | 需要证书与签名流程 | 记录 SHA-256，接收方自行核对 |
| 清理器不是完整 sanitizer | 浏览器 HTML 解析的怪异行为无法穷举 | 只挡"能执行/能外联/能劫持"三类；不支持的内容一律删 |
| 模板包视觉崩坏 | 属于设计问题不是安全问题 | 导入后用 `check.mjs` 量溢出 |

## 复现方式

```bash
# 清理器对抗自检（16 类 payload）
node tools/sec-fuzz.mjs

# 全部回归（含 130 条断言，其中 30 条安全断言）
npm test

# 恶意模板包渲染（会被清理并告警）
node src/render.mjs <deck.json> --out <out.html>

# 跨站写操作
curl -X POST -H "Origin: http://evil.example" http://127.0.0.1:5178/api/deck?name=erci  # → 400
```
