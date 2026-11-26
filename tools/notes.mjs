const escape = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

export function notesDocument(deck, pack, markdown) {
  const meta = deck.meta || {}, book = meta.textbook || {};
  const textbook = [book.book, book.chapter, book.section].filter(Boolean).join(' ')
    + (book.pages ? '（'+book.pages+'）' : '');
  const title = (meta.title || deck.pages[0]?.title || '课件')+' · 讲稿';
  const total = deck.pages.reduce((sum,p)=>sum+(Number.isFinite(p.minutes)?p.minutes:0),0);
  const annotated = deck.pages.filter(p=>Number.isFinite(p.minutes)).length;
  const totalLine = annotated
    ? '时长：已标注 '+annotated+'/'+deck.pages.length+' 页 · 合计 '+Number(total.toFixed(1))+' 分钟'
    : '时长：未标注';
  const info = [textbook && '教材：'+textbook, totalLine, '共 '+deck.pages.length+' 页'].filter(Boolean);
  const sections = deck.pages.map((page,i)=>{
    const layout = pack.layouts.find(l=>l.id===page.layout)?.name || '自定义页';
    const heading = '第 '+(i+1)+' 页 · '+layout;
    const time = Number.isFinite(page.minutes) ? page.minutes+' 分钟' : '';
    const bookPages = page.textbookPages?.trim() || '';
    const label = page.title || page.statement || '';
    const notes = page.notes?.trim() ? page.notes : '（本页未写讲稿）';
    if (markdown) return ['## '+heading,bookPages && '**教材页码**：'+bookPages,time && '**时长**：'+time,label && '**页面**：'+label].filter(Boolean).join('\n')+'\n\n'+notes;
    return '<section><h2>'+escape(heading)+'</h2>'+(bookPages?'<div>教材页码：'+escape(bookPages)+'</div>':'')+(time?'<div>时长：'+escape(time)+'</div>':'')
      +(label?'<strong>'+escape(label)+'</strong>':'')+'<p>'+escape(notes)+'</p></section>';
  });
  if (markdown) return '# '+title+'\n\n'+info.map(s=>'- '+s).join('\n')+'\n\n'+sections.join('\n\n')+'\n';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(title)}</title>
<style>
@page{size:A4;margin:16mm 18mm 20mm;@bottom-center{content:"第 " counter(page) " 页";font:10pt sans-serif}}
*{box-sizing:border-box}body{max-width:174mm;margin:0 auto;color:#111;font:11pt/1.6 "SimSun",serif;overflow-wrap:anywhere}
header{border-bottom:1.5pt solid;padding-bottom:3mm}h1{font-size:19pt;margin:0 0 2mm}
section{break-inside:avoid;border-bottom:.5pt solid #aaa;padding:4mm 0}h2{font-size:13pt;margin:0}
p{white-space:pre-wrap;margin:2mm 0 0}@media screen{body{padding:10mm 0}}
</style><header><h1>${escape(title)}</h1>${info.map(s=>'<div>'+escape(s)+'</div>').join('')}</header>${sections.join('\n')}</html>`;
}
