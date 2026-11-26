import {readFileSync} from 'node:fs';

const rules = readFileSync(new URL('./block-rules.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
const script = readFileSync(new URL('./block-preview.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/block-tweaks.css', import.meta.url), 'utf8');

export function editorPreviewHtml(html) {
  return html.replace('</head>', () => `<style>${css}
    [data-ck-edit] .slide.active { touch-action:none; user-select:none; }
/* 动画在编辑时不重放：改参数引起的重载不应该每次"入场"一遍 */
[data-ck-edit] .slide.active .auto-in,
[data-ck-edit] .slide.active [data-anim],
[data-ck-edit] .slide.active [data-build] { transition: none !important; }
    html[data-ck-edit] body:not(.overview) .slide.active :is([data-build], [data-anim], .auto-in) { opacity:1 !important; transform:none !important; filter:none !important; }
    [data-ck-edit] [data-ck-selected] { outline:3px solid #087ac1 !important; outline-offset:2px; }
    [data-ck-edit] [data-ck-collision] { outline:3px dashed #ba4c00 !important; outline-offset:2px; }
[data-ck-edit] [data-ck-f] { cursor:text; }
[data-ck-edit] [data-ck-f]:hover { outline:2px dashed #087ac1; outline-offset:2px; border-radius:2px; }
[data-ck-edit] [data-ck-f][contenteditable="true"] { outline:2px solid #087ac1; outline-offset:2px; background:#eef7ff; color:#123; }
/* 微调模式下让演示块的播放层不抢指针：才能选中、拖动、拉角改尺寸；退出微调即可交互 */
[data-ck-edit] .free-block > iframe.ck-widget { pointer-events:none; }
[data-ck-edit] .free-block:has(> iframe.ck-widget) { background:repeating-linear-gradient(45deg,rgba(8,122,193,.06) 0 6px,transparent 6px 12px); }
    [data-ck-overlay] { position:fixed; inset:0; z-index:2147483647; pointer-events:none; }
    [data-ck-overlay] [hidden] { display:none !important; }
    [data-ck-handle] { position:absolute; width:14px; height:14px; border:2px solid white; box-sizing:border-box;
      background:#087ac1; box-shadow:0 0 0 1px #087ac1; touch-action:none; pointer-events:auto; cursor:nwse-resize; }
    [data-ck-handle="width"] { cursor:ew-resize; }
    [data-ck-guide] { position:absolute; background:#cf1673; }
    [data-ck-guide="x"] { width:1px; }
    [data-ck-guide="y"] { height:1px; }
  </style><script>(() => { ${rules}\n${script} })();</script></head>`);
}
