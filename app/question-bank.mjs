import fs from 'node:fs/promises';
import path from 'node:path';
import {parseQuestionMarkdown, renderQuestions} from '../tools/questions.mjs';

function minuteStamp(date) {
  const two = n => String(n).padStart(2, '0');
  return date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) +
    '-' + two(date.getHours()) + two(date.getMinutes());
}

export async function saveQuestionSheet(dir, markdown) {
  if (typeof markdown !== 'string') throw Error('需要题单 Markdown');
  const {title, questions} = parseQuestionMarkdown(markdown);
  if (!questions.length || questions.some(q => !q.stem)) throw Error('需要至少一道题，且每题都应有题干');
  const student = renderQuestions(markdown, {mode:'student'});
  const teacher = renderQuestions(markdown, {mode:'teacher'});
  const safeTitle = Array.from(title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')).slice(0, 60).join('').trim() || '题单';
  const prefix = minuteStamp(new Date()) + '-' + safeTitle;
  await fs.mkdir(dir, {recursive:true});
  for (let copy = 1; ; copy++) {
    const filename = prefix + (copy === 1 ? '' : '-' + copy) + '.md';
    const file = path.join(dir, filename);
    let handle;
    try {
      handle = await fs.open(file, 'wx');
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    try {
      try { await handle.writeFile(markdown, 'utf8'); }
      finally { await handle.close(); }
    } catch (error) {
      await fs.unlink(file);
      throw error;
    }
    return {filename, student, teacher};
  }
}

export async function listQuestionBank(dir) {
  let entries;
  try { entries = await fs.readdir(dir, {withFileTypes:true}); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const [markdown, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    const {title, questions} = parseQuestionMarkdown(markdown, path.parse(entry.name).name);
    result.push({filename:entry.name, title, count:questions.length, modified:stat.mtime.toISOString()});
  }
  return result.sort((a,b) => b.modified.localeCompare(a.modified));
}

export async function readQuestionSheet(dir, filename) {
  if (typeof filename !== 'string' || !/\.md$/i.test(filename) || /[\\/]/.test(filename) || filename.startsWith('.')) {
    throw Error('题单文件名无效');
  }
  const markdown = await fs.readFile(path.join(dir, filename), 'utf8');
  const {title, questions} = parseQuestionMarkdown(markdown, path.parse(filename).name);
  return {filename, title, count: questions.length, markdown};
}


/** 读取一份题单并拆成单题（给「引用题目」用） */
export async function readQuestionQuestions(dir, filename) {
  if (typeof filename !== 'string' || !/\.md$/i.test(filename) || /[\\/]/.test(filename) || filename.startsWith('.')) {
    throw Error('题单文件名无效');
  }
  const markdown = await fs.readFile(path.join(dir, filename), 'utf8');
  const {title, questions} = parseQuestionMarkdown(markdown, path.parse(filename).name);
  return {
    filename,
    title,
    questions: questions.map((q, i) => ({
      no: i + 1,
      type: q.type,
      stem: String(q.stem || '').slice(0, 400),
      answer: String(q.answer || '').slice(0, 200),
    })),
  };
}
