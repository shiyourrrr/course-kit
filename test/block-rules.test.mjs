import assert from 'node:assert/strict';
import test from 'node:test';
import {parseFragment} from 'parse5';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {blockFingerprint, blockKind, resizeMode, validTweak} from '../app/block-rules.mjs';
import {applyBlockTweaks} from '../src/blocks.mjs';

test('same-kind reorder skips the old path and reports its record', () => {
  const html = '<p>second</p><p>first</p>';
  const targetKey = blockFingerprint(parseFragment('<p>first</p>').childNodes[0]);
  const tweak = {kind:'paragraph', path:[0], dx:8, targetKey};
  const skipped = [];
  assert.equal(applyBlockTweaks(html, [tweak], item => skipped.push(item)), html);
  assert.deepEqual(skipped, [tweak]);
  assert.match(applyBlockTweaks(html, [{...tweak, path:[1]}]), /<p data-ck-move="" style=";--ck-dx:8px;--ck-dy:0px">first/);
});

test('hidden block tweaks render the target with display none', () => {
  const hidden = applyBlockTweaks('<p>target</p>', [{path:[0], kind:'paragraph', hidden:true}]);
  assert.match(hidden, /<p data-ck-hidden="">target/);
  const css = readFileSync(new URL('../src/block-tweaks.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<style>${css}</style><div class="slide">${hidden}</div>`);
  assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('p')).display, 'none');
});

test('whole table and formula own their internal nodes', () => {
  const {childNodes:[table, formula]} = parseFragment('<table><tr><td><p>x</p></td></tr></table><div class="formula-box"><img></div>');
  assert.equal(blockKind(table), 'table');
  assert.equal(blockKind(table.childNodes[0].childNodes[0].childNodes[0].childNodes[0]), null);
  assert.equal(blockKind(formula), 'formula');
  assert.equal(blockKind(formula.childNodes[0]), null);
  assert.equal(validTweak({path:[0], kind:'heading', widthPx:90, heightPx:60}), true);
});

test('explicit axes follow the media or text content of a legacy block', () => {
  const html = '<div class="figure"><svg><text>A</text></svg></div><div class="card">caption<img></div>';
  const {childNodes:[figure, card]} = parseFragment(html);
  assert.equal(resizeMode(figure), 'both');
  assert.equal(resizeMode(card), 'width');
  assert.equal(resizeMode(card.childNodes[1]), 'none');
  assert.equal(resizeMode(parseFragment('<img>').childNodes[0]), 'ratio');
  assert.match(applyBlockTweaks(html, [{path:[1],kind:'card',heightPx:8}]), /data-ck-h=""/);
  const result = applyBlockTweaks(html, [{path:[0],kind:'figure',widthPx:250,heightPx:100,widthStep:1}]);
  assert.match(result, /data-ck-w=""/);
  assert.match(result, /data-ck-h=""/);
  assert.match(result, /--ck-w:250px;--ck-h:100px/);
  for (const widthPx of [0, -1, 1.5, '80', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(applyBlockTweaks(html, [{path:[0],kind:'figure',widthPx}]), html);
  }
});

test('paragraph tweaks render explicit width and height as CSS pixel dimensions', () => {
  const tweak = {path:[0],kind:'paragraph',widthPx:160,heightPx:64};
  assert.equal(validTweak(tweak), true);
  const rendered = applyBlockTweaks('<p>Text</p>', [tweak]);
  const css = readFileSync(new URL('../src/block-tweaks.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<style>${css}</style><div class="slide">${rendered}</div>`);
  const paragraph = dom.window.document.querySelector('p');
  assert.equal(dom.window.getComputedStyle(paragraph).width, '160px');
  assert.equal(dom.window.getComputedStyle(paragraph).height, '64px');
});

test('standalone images are selectable while inline illustrations belong to their text', () => {
  const {childNodes:[inline, figure, paragraph, mixed]} = parseFragment(
    '<p><strong>label</strong><a><img></a></p><figure><img><figcaption>caption</figcaption></figure>' +
    '<p><a><picture><img></picture></a></p><p>look <img> here</p>');
  assert.equal(blockKind(inline.childNodes[1].childNodes[0]), null);
  assert.equal(blockKind(figure.childNodes[0]), 'image');
  assert.equal(blockKind(paragraph.childNodes[0].childNodes[0].childNodes[0]), 'image');
  assert.equal(blockKind(mixed.childNodes[1]), null);
});

test('display math owns its descendants and yields to an enclosing formula box', () => {
  const math = '<span class="katex-display"><span class="katex">x</span></span>';
  const {childNodes:[display, box]} = parseFragment(math + '<div class="formula-box">' + math + '</div>');
  assert.equal(blockKind(display), 'formula');
  assert.equal(blockKind(display.childNodes[0]), null);
  assert.equal(blockKind(box), 'formula');
  assert.equal(blockKind(box.childNodes[0]), null);
});

test('custom block titles are headings and page chrome stays outside selection', () => {
  const {childNodes:[title, aria, span, footer, bg]} = parseFragment(
    '<div class="title">X</div><div role="heading">Y</div><span class="title">Z</span>' +
    '<footer><p>page</p></footer><div class="slide-bg"><img></div>');
  assert.equal(blockKind(title), 'heading');
  assert.equal(blockKind(aria), 'heading');
  assert.equal(blockKind(span), null);
  assert.equal(blockKind(footer.childNodes[0]), null);
  assert.equal(blockKind(bg.childNodes[0]), null);
});
