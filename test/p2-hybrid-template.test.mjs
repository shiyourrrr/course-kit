import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSlotsAndRole } from '../tools/pptx-slots.mjs';
import { buildHybridSkeleton, enrichUserTemplatePack, enforceHybridBudgetsAndSplit } from '../src/template-hybrid.mjs';
import { toggleTemplateMode } from '../app/template-switch.mjs';

test('extractSlotsAndRole computes geometry max/min/decorative and slide role accurately', () => {
  const html = `
    <div class="pptx-page" style="position:relative;width:1280px;height:720px;overflow:hidden;">
      <div class="pptx-slide" style="position:absolute;left:0;top:0;width:1280px;height:720px;">
        <div style="position:absolute;left:54px;top:191px;width:613.2px;height:93.33px;font-size:66pt;">广西师范大学</div>
        <div style="position:absolute;left:133px;top:473px;width:538.7px;height:48.33px;font-size:24pt;">学生工作部（处）</div>
        <div style="position:absolute;left:80px;top:400px;width:85px;height:106px;font-size:48pt;">01</div>
      </div>
    </div>`;
  const res = extractSlotsAndRole(html, { slideIndex: 0, totalSlides: 11 });
  assert.equal(res.role, 'cover');
  // 66pt = 88px -> perLine = floor(613.2/88) = 6, lines = 1, max = floor(6*1*0.9) = 5
  assert.equal(res.slotSpecs.t1.max, 5);
  assert.equal(res.slotSpecs.t1.decorative, false);
  // 24pt = 32px -> perLine = floor(538.7/32) = 16, lines = 1, max = floor(16*0.9) = 14
  assert.equal(res.slotSpecs.t2.max, 14);
  // 85x106 @ 48pt(64px) "01" -> decorative: true
  assert.equal(res.slotSpecs.t3.decorative, true);
  assert.deepEqual(res.slots, ['t1', 't2']);
});

test('buildHybridSkeleton keeps short-text fidelity slides and maps content slides to elastic', () => {
  const rawPack = {
    id: 'user-template-demo',
    kind: 'user-template',
    layouts: [
      { id: 'page-1', role: 'cover', slots: ['t1', 't2'] },
      { id: 'page-2', role: 'content', slots: ['t1', 't2', 't3'] },
      { id: 'page-3', role: 'toc', slots: ['t1', 't2', 't3'] },
      { id: 'page-4', role: 'content', slots: ['t1', 't2', 't3'] },
      { id: 'page-5', role: 'section', slots: ['t1'] },
      { id: 'page-6', role: 'content', slots: ['t1', 't2', 't3'] },
      { id: 'page-7', role: 'closing', slots: ['t1'] },
    ],
  };
  const skel = buildHybridSkeleton(rawPack, ['cover', 'concept', 'example', 'homework'], 'lesson');
  assert.equal(skel[0].layout, 'page-1');
  assert.ok(skel[1].layout.startsWith('elastic-'));
  assert.equal(skel[2].layout, 'page-3');
  assert.ok(skel[3].layout.startsWith('elastic-'));
  assert.equal(skel[4].layout, 'page-5');
  assert.ok(skel[5].layout.startsWith('elastic-'));
  assert.equal(skel[6].layout, 'page-7');
});

test('enforceHybridBudgetsAndSplit auto-splits overcrowded elastic slides instead of shrinking font', () => {
  const rawPack = { id: 'user-template-demo', kind: 'user-template', layouts: [{ id: 'page-1', role: 'cover', slots: ['t1'], slotSpecs: { t1: { max: 5 } } }] };
  const enriched = enrichUserTemplatePack(rawPack);
  const pages = [
    { layout: 'page-1', t1: '这是一段超过五字的标题' },
    {
      layout: 'elastic-concept',
      title: '二次函数核心性质',
      items: Array.from({ length: 6 }, (_, i) => ({ num: String(i + 1), term: '性质' + (i + 1), text: '开口方向与对称轴判定规律说明' })),
    },
  ];
  const out = enforceHybridBudgetsAndSplit(pages, enriched);
  assert.equal([...out[0].t1].length, 5);
  assert.equal(out.length, 3, '6 items on elastic-concept should split into 2 slides (3 + 3)');
  assert.match(out[2].title, /（续）$/);
});

test('toggleTemplateMode switches reversibly between elastic and fidelity without losing content', () => {
  const rawPack = {
    id: 'user-template-demo',
    kind: 'user-template',
    layouts: [{ id: 'page-2', name: '第 2 页', role: 'content', slots: ['t1', 't2'], slotLabels: { t1: '标题', t2: '正文' } }],
  };
  const enriched = enrichUserTemplatePack(rawPack);
  const page = {
    layout: 'elastic-example',
    fidelityLayout: 'page-2',
    tag: '例 1',
    title: '求抛物线顶点',
    stem: '已知 y = x^2 - 4x + 3，求顶点坐标。',
    steps: [{ text: '配方得 y = (x-2)^2 - 1' }],
    answer: '(2, -1)',
  };
  const s1 = toggleTemplateMode(page, enriched, 1);
  assert.equal(s1.mode, 'fidelity');
  assert.equal(page.layout, 'page-2');
  assert.equal(page.t1, '求抛物线顶点');

  const s2 = toggleTemplateMode(page, enriched, 1);
  assert.equal(s2.mode, 'elastic');
  assert.equal(page.layout, 'elastic-example');
  assert.equal(page.stem, '已知 y = x^2 - 4x + 3，求顶点坐标。');
  assert.equal(page.steps[0].text, '配方得 y = (x-2)^2 - 1');
  assert.equal(page.answer, '(2, -1)');
});
