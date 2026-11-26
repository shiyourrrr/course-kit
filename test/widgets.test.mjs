import assert from 'node:assert/strict';
import test from 'node:test';
import { checkWidget, stripWidgetFence, WIDGET_SPEC } from '../src/widgets.mjs';

const ok = `<!doctype html><html><body><div id="w" style="width:100%;height:100%">浮力方向？</div></body></html>`;

test('自包含的组件通过校验', () => {
  const result = checkWidget(ok);
  assert.equal(result.ok, true, result.reasons.join('；'));
  assert.ok(result.bytes > 0);
});

test('外链、外部脚本、外部样式都会被拒', () => {
  assert.equal(checkWidget(ok.replace('</body>', '<img src="https://x.test/a.png"></body>')).ok, false);
  assert.equal(checkWidget(ok.replace('</body>', '<script src="//cdn.test/x.js"></script></body>')).ok, false);
  assert.equal(checkWidget(ok.replace('</body>', '<link rel="stylesheet" href="https://cdn.test/a.css"></body>')).ok, false);
  assert.equal(checkWidget(ok.replace('</body>', '<style>@import url(x.css);</style></body>')).ok, false);
});

test('data URI 与内联 SVG 允许', () => {
  assert.equal(checkWidget(ok.replace('</body>', '<img src="data:image/png;base64,AAAA"><svg><circle r="4"/></svg></body>')).ok, true);
});

test('不是完整文档或超体积会被拒', () => {
  assert.equal(checkWidget('<div>片段</div>').ok, false);
  assert.equal(checkWidget(ok + 'x'.repeat(310 * 1024)).ok, false);
  assert.equal(checkWidget('').ok, false);
});

test('围栏与解释文字会被剥掉', () => {
  assert.equal(stripWidgetFence('这是组件：\n```html\n' + ok + '\n```\n希望有用'), ok);
  assert.equal(stripWidgetFence('说明\n' + ok).trim(), ok);
});

test('规范里写明了离线与主题约束', () => {
  assert.match(WIDGET_SPEC, /禁止任何外链/);
  assert.match(WIDGET_SPEC, /--ck-brand/);
  assert.match(WIDGET_SPEC, /<!doctype html>/);
});
