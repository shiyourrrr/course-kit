import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkWidget } from '../src/widgets.mjs';
import { WIDGET_TEMPLATES, detectWidgetTemplate, buildWidgetFromTemplate } from '../src/widget-templates.mjs';
import { resolveDeckThemeTokens, injectWidgetThemeAndEsc } from '../src/widget-theme.mjs';
import { mergeBlockTweak, hiddenBlocksOf } from '../app/tweak-inspector.mjs';
import { applyBlockTweaks } from '../src/blocks.mjs';
import { listTemplates, renameTemplate, deleteTemplate } from '../src/template-store.mjs';
import { ai } from '../app/ai.mjs';

test('all built-in parameterized widget templates pass offline checkWidget validation', () => {
  assert.ok(WIDGET_TEMPLATES.length >= 6);
  for (const tpl of WIDGET_TEMPLATES) {
    const built = buildWidgetFromTemplate(tpl.id, tpl.samplePrompt);
    assert.ok(built && built.html, `template ${tpl.id} should generate HTML`);
    const res = checkWidget(built.html);
    assert.equal(res.ok, true, `${tpl.id} failed checkWidget: ${res.reasons.join(', ')}`);
    assert.ok(res.bytes < 16 * 1024, `${tpl.id} should stay lightweight (<16KB), got ${res.bytes}`);
  }
  assert.equal(detectWidgetTemplate('二次函数 y = 2x^2 - 4x + 1 参数滑块'), 'quadratic-explorer');
  assert.equal(detectWidgetTemplate('矩形动点沿边运动面积探究'), 'geometry-glider');
  assert.equal(detectWidgetTemplate('自由落体小球碰撞实验'), null);
});

test('widget-theme extracts cascade colors and injects --ck-* + esc relay into srcdoc HTML', () => {
  const tokens = resolveDeckThemeTokens({
    packCss: ':root { --accent: #17574e; --bg: #faf9f4; --ink: #202823; }',
    deckCss: ':root { --accent: #941E7E; --bg: #FFFFFF; }',
  });
  assert.equal(tokens.brand, '#941E7E');
  assert.equal(tokens.bg, '#FFFFFF');
  assert.equal(tokens.dark, false);

  const injected = injectWidgetThemeAndEsc('<!doctype html><html><head></head><body><div>demo</div></body></html>', tokens);
  assert.match(injected, /--ck-brand:#941E7E/);
  assert.match(injected, /--ck-bg:#FFFFFF/);
  assert.match(injected, /ck:"widget-esc"/);
});

test('mergeBlockTweak and applyBlockTweaks preserve PPT fontSize, color, align, zIndex and hidden', () => {
  let tweaks = mergeBlockTweak([], { path: [0], kind: 'heading', fontSize: 44, color: '#941e7e', align: 'center', zIndex: 5 });
  // Dragging later should preserve style properties
  tweaks = mergeBlockTweak(tweaks, { path: [0], kind: 'heading', dx: 16, dy: -8 });
  assert.equal(tweaks.length, 1);
  assert.equal(tweaks[0].dx, 16);
  assert.equal(tweaks[0].fontSize, 44);
  assert.equal(tweaks[0].color, '#941e7e');
  assert.equal(tweaks[0].align, 'center');
  assert.equal(tweaks[0].zIndex, 5);

  const rendered = applyBlockTweaks('<h2 class="title">标题</h2>', tweaks);
  assert.match(rendered, /font-size:44px !important/);
  assert.match(rendered, /color:#941e7e !important/);
  assert.match(rendered, /text-align:center !important/);
  assert.match(rendered, /z-index:5 !important/);

  const hiddenTweaks = mergeBlockTweak(tweaks, { path: [0], kind: 'heading', hidden: true });
  assert.equal(hiddenBlocksOf({ blockTweaks: hiddenTweaks }).length, 1);
});

test('template-store lists, renames and deletes user templates while protecting built-in packs', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ck-tpl-store-'));
  try {
    await fs.mkdir(path.join(tmp, 'packs', 'math-junior'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'packs', 'general-elastic'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'packs', 'user-template-ref-demo'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'examples'), { recursive: true });

    await fs.writeFile(path.join(tmp, 'packs', 'math-junior', 'pack.json'), JSON.stringify({
      id: 'math-junior', name: '初中数学', layouts: [{ id: 'cover', role: 'cover' }],
    }));
    await fs.writeFile(path.join(tmp, 'packs', 'general-elastic', 'pack.json'), JSON.stringify({
      id: 'general-elastic', name: '通用弹性', layouts: [],
    }));
    await fs.writeFile(path.join(tmp, 'packs', 'user-template-ref-demo', 'pack.json'), JSON.stringify({
      id: 'user-template-ref-demo', name: '旧模板名', kind: 'user-template', skin: { palette: ['#941E7E'] },
      layouts: [{ id: 'page-1', role: 'cover' }, { id: 'page-2', role: 'content' }],
    }));

    const list = await listTemplates(tmp);
    assert.deepEqual(list.map((t) => t.id), ['user-template-ref-demo', 'math-junior']);
    assert.equal(list[0].editable, true);
    assert.equal(list[1].editable, false);

    await assert.rejects(() => deleteTemplate(tmp, 'math-junior'), /系统内置模板不能删除/);
    await renameTemplate(tmp, 'user-template-ref-demo', '新校本模板');
    const afterRename = await listTemplates(tmp);
    assert.equal(afterRename[0].name, '新校本模板');

    await deleteTemplate(tmp, 'user-template-ref-demo');
    const afterDel = await listTemplates(tmp);
    assert.deepEqual(afterDel.map((t) => t.id), ['math-junior']);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('ai page rewrite works on empty/optional slots in mock mode without throwing format error', async () => {
  const prev = process.env.COURSE_KIT_AI_MOCK;
  process.env.COURSE_KIT_AI_MOCK = '1';
  try {
    const pack = {
      id: 'math-junior',
      limits: { title: 24, stem: 120 },
      layouts: [{ id: 'example', slots: ['title', 'stem', 'answer'] }],
    };
    const deck = { pack: 'math-junior', pages: [{ layout: 'example' }] };
    const res = await ai({ pageIndex: 0, instruction: '重写这页', deck }, pack);
    assert.ok(Array.isArray(res.ops) && res.ops.length >= 1);
    assert.equal(res.ops[0].path, 'title');
  } finally {
    if (prev === undefined) delete process.env.COURSE_KIT_AI_MOCK;
    else process.env.COURSE_KIT_AI_MOCK = prev;
  }
});
