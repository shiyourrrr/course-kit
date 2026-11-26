/** 清理器自检：把常见的编码/命名空间/嵌套绕过都跑一遍（纯本地字符串，无攻击行为） */
import { stripDangerous, stripExternalCss } from '../src/sanitize.mjs';

const cases = [
  ['实体编码协议', '<a href="java&#115;cript:alert(1)">x</a>', /javascript:|&#115;/i],
  ['十六进制实体', '<a href="&#x6a;avascript:alert(1)">x</a>', /javascript:/i],
  ['制表符', '<a href="java\tscript:alert(1)">x</a>', /javascript:/i],
  ['大写标签', '<ScRiPt>alert(1)</ScRiPt>', /<script/i],
  ['事件空格', '<img src=x onerror = "alert(1)">', /\son[a-z]+\s*=/i],
  ['事件大小写', '<img src=x OnErRoR="alert(1)">', /\son[a-z]+\s*=/i],
  ['SVG onload', '<svg onload="alert(1)"></svg>', /onload/i],
  ['嵌套拼接', '<scr<script>ipt>alert(1)</script>', /<script/i],
  ['iframe', '<iframe src="http://e"></iframe>', /<iframe/i],
  ['表单外链', '<form action="http://e/x"></form>', /<form/i],
  ['data:text/html', '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', /data:text\/html/i],
  ['base 劫持', '<base href="http://e/">', /<base/i],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=http://e">', /refresh/i],
];

let failed = 0;
for (const [name, html, badPattern] of cases) {
  const { html: clean, notes } = stripDangerous(html);
  const ok = !badPattern.test(clean);
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name} → ${JSON.stringify(clean.slice(0, 60))} ${notes.length ? '· ' + notes.join('/') : ''}`);
}

const cssCases = [
  ['CSS 转义外链', 'a{background:url(\\68 ttp://e/x.png)}', /https?:/i],
  ['@import 注释', '@import/**/url("http://e/x.css");', /@import/i],
  ['expression', 'div{width:expression(alert(1))}', /expression\s*\(/i],
];
for (const [name, css, badPattern] of cssCases) {
  const { css: clean } = stripExternalCss(css);
  const ok = !badPattern.test(clean);
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name} → ${JSON.stringify(clean.slice(0, 60))}`);
}

console.log(failed ? `\n${failed} 类仍可绕过` : '\n全部 payload 已中和');
process.exit(failed ? 1 : 0);
