import {scaleRule} from './edit.mjs';
export function scaleSlides(html,pages) {
  const rules=pages.flatMap((page,i)=>{
    const match=scaleRule.exec(page.css||'');
    return match ? ['#p'+(i+1)+' { --page-scale: '+match[1]+'; font-size: calc(16px * var(--page-scale)); }'] : [];
  });
  if (!rules.length) return html;
  return html.replace(/<style>([\s\S]*?)<\/style>/,(_,css)=>'<style>'+css.replace(/(font-size:\s*)([\d.]+)px\b/g,'$1calc($2px * var(--page-scale, 1))')+'\n'+rules.join('\n')+'</style>');
}
