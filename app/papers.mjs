import {saveEntry,readEntry} from './library-store.mjs';
import {paperIntro} from './materials.mjs';
import {parseQuestions} from '../tools/question-parse.mjs';
export {readEntry as readPaper,listEntries as listPapers,deleteEntry as deletePaper} from './library-store.mjs';

export async function writePaper(dir,input){
  const text=input.text;
  if(typeof text!=='string'||!text.trim())throw Error('请填写试卷正文');
  const meta={id:crypto.randomUUID(),uploadedAt:new Date().toISOString(),chars:Array.from(text).length};
  for(const key of ['title','subject','grade','term'])meta[key]=String(input[key]||'').trim();
  meta.title ||= '未命名试卷';
  const {questions}=parseQuestions(text);
  const byType=Object.create(null);
  for(const {type} of questions)byType[type]=(byType[type]||0)+1;
  return saveEntry(dir,{...meta,questions:{total:questions.length,byType}},text);
}

export async function paperContext(dir,papers,budget){
  if(!Array.isArray(papers)||papers.length>3)throw Error('最多选择 3 份参考试卷');
  const used=[];
  let suffix='';
  for(const {id} of papers){
    const paper=await readEntry(dir,id);
    const count=Math.min(paper.chars,Math.max(0,budget-Array.from(paperIntro).length));
    if(count){
      const section=paperIntro+Array.from(paper.text).slice(0,count).join('');
      suffix+=section;
      budget-=Array.from(section).length;
    }
    used.push({kind:'paper',from:'library',id,title:paper.title,usedChars:count,truncated:count<paper.chars});
  }
  return {suffix,used};
}
