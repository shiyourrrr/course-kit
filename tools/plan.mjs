#!/usr/bin/env node
/**
 * 方案卡：把 plan.json 打成老师能一眼看懂的卡片，并做一致性检查。
 *
 *   node tools/plan.mjs examples/plan-yicihanshu.json
 *
 * 它不生成课件——只负责在动工之前，让老师看清楚「多少页、每段几分钟、重心在哪」。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('用法：node tools/plan.mjs <plan.json>');
  process.exit(1);
}

const file = path.resolve(input);
if (!fs.existsSync(file)) {
  console.error(`文件不存在：${file}`);
  process.exit(1);
}

let plan;
try {
  plan = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
} catch (error) {
  console.error(`JSON 解析失败：${error.message}`);
  process.exit(1);
}

const problems = [];
const warnings = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };

for (const key of ['topic', 'subject', 'grade', 'lessonType', 'duration']) {
  need(plan[key] !== undefined && plan[key] !== '', `缺少字段「${key}」`);
}
need(Array.isArray(plan.objectives) && plan.objectives.length >= 2, 'objectives 至少 2 条（建议 3 条可检验的目标）');
need(Array.isArray(plan.objectives) && plan.objectives.length <= 4, 'objectives 超过 4 条：一节课讲不完');
need(Array.isArray(plan.difficulties) && plan.difficulties.length > 0, '没写 difficulties：难点说不清，课就容易平均用力');
need(Array.isArray(plan.structure) && plan.structure.length >= 3, 'structure 至少 3 段');

const structure = Array.isArray(plan.structure) ? plan.structure : [];
for (const [i, item] of structure.entries()) {
  const at = `structure[${i}]`;
  need(item.section, `${at} 缺 section`);
  need(Number.isFinite(item.pages) && item.pages > 0, `${at} 的 pages 必须是正整数`);
  need(Number.isFinite(item.minutes) && item.minutes > 0, `${at} 的 minutes 必须是正数`);
}

const totalPages = structure.reduce((n, s) => n + (Number(s.pages) || 0), 0);
const totalMinutes = structure.reduce((n, s) => n + (Number(s.minutes) || 0), 0);
if (Number.isFinite(plan.duration) && Math.abs(totalMinutes - plan.duration) > 2) {
  warnings.push(`各段分钟合计 ${totalMinutes}'，与课时 ${plan.duration}' 差 ${(totalMinutes - plan.duration).toFixed(0)}'，建议对齐`);
}

// 题目页（例题/变式/练习/作业）占比过高，就说明这节课更像一套卷子
const QUESTION = /^(example|practice|homework)$/;
const questionPages = structure
  .filter((s) => QUESTION.test(String(s.role || '').trim()))
  .reduce((n, s) => n + (Number(s.pages) || 0), 0);
const qRatio = totalPages ? questionPages / totalPages : 0;
if (qRatio > 0.35) {
  warnings.push(`题目页占 ${Math.round(qRatio * 100)}%（${questionPages}/${totalPages}）：更像一套卷子，建议换成情境/概念/推导页`);
}

const roles = structure.map((s) => String(s.role || '')).join(' ');
// 三种课型的骨架不同，检查规则也要分（新授 / 习题 / 讲评）
const rawType = String(plan.type || plan.lessonType || 'new');
const isExercise = /习题|练习|exercise/i.test(rawType);
const isReview = /讲评|试卷|review/i.test(rawType);
const isNew = !isExercise && !isReview;

if (isNew) {
  if (!/context/.test(roles)) warnings.push('没有情境导入（context）：上课开头容易直接进知识，学生没被带进来');
  if (!/explain|figure|custom/.test(roles)) warnings.push('没有图示类页面（explain/figure）：数学课缺图，讲不清空间关系');
}
if (isExercise) {
  if (!/exercise|example/.test(roles)) warnings.push('习题课没有例题/习题精讲页（exercise）：全是练习会变成对答案');
  if (!/variant/.test(roles)) warnings.push('习题课没有变式（variant）：讲完一题不迁移，学生只会这一道');
  if (!/mistake/.test(roles)) warnings.push('习题课没有错因归类（mistake）：错了不知道为什么错');
}
if (isReview) {
  if (!/score/.test(roles)) warnings.push('试卷讲评没有总体情况（score）：上来就讲题，学生不知道自己在班级里的位置');
  if (!/table/.test(roles)) warnings.push('试卷讲评缺错误率/分布表（table）：没有数据撑着，讲哪题全凭印象');
  if (!/wrong/.test(roles)) warnings.push('试卷讲评没有典型错题（wrong）：讲评课的核心是错在哪、怎么改');
}

// 知识点覆盖：knowledgePoints 是清单，每段的 covers 认领，检查有没有漏
const kps = Array.isArray(plan.knowledgePoints) ? plan.knowledgePoints : [];
const covered = new Map();
for (const item of structure) {
  for (const kp of Array.isArray(item.covers) ? item.covers : []) {
    if (!covered.has(kp)) covered.set(kp, []);
    covered.get(kp).push(`${item.section}（${item.minutes}'）`);
  }
}
const missingKp = kps.filter((kp) => !covered.has(kp));
const extraKp = [...covered.keys()].filter((kp) => !kps.includes(kp));
if (kps.length && missingKp.length) {
  problems.push(`这些知识点没有任何一段认领：${missingKp.join('、')}`);
}
if (extraKp.length) {
  warnings.push(`covers 里出现了清单外的知识点：${extraKp.join('、')}（检查拼写，或补进 knowledgePoints）`);
}
const focusText = [].concat(plan.focus || [], plan.keyPoints || [], plan.difficulties || []).join(' ');
if (/推导|证明|为什么/.test(focusText) && !/derive/.test(roles)) {
  warnings.push('重心提到“推导/证明”，但结构里没有 derive 页');
}
// 题量天花板只对新授课成立：习题课本就该多题，讲评课的 5 题是待讲题数
if (isNew && plan.questions && Number(plan.questions.inClass) >= 4) {
  warnings.push(`课内题量 ${plan.questions.inClass} 题：45 分钟里讲 + 练可能来不及，建议压到 2-3 题`);
}

/* ---------------- 输出 ---------------- */

const line = '─'.repeat(58);
console.log(`\n${line}\n方案卡：${plan.topic || '（未命名）'}\n${line}`);
console.log(`学段/学科：${plan.grade || '?'} ${plan.subject || '?'}    课型：${plan.lessonType || '?'}    时长：${plan.duration}'`);
console.log(`重心：${(plan.focus || []).join(' + ') || '（未填）'}`);
console.log(`\n目标（${(plan.objectives || []).length} 条）`);
(plan.objectives || []).forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
if (plan.keyPoints?.length) console.log(`\n重点：${plan.keyPoints.join('；')}`);
if (plan.difficulties?.length) console.log(`难点：${plan.difficulties.join('；')}`);

console.log(`\n结构（页数 / 分钟）`);
for (const s of structure) {
  console.log(`  ${String(s.section).padEnd(12)} ${String(s.pages).padStart(2)} 页  ${String(s.minutes).padStart(3)}'   ${s.role || ''}  ${s.note || ''}`);
}
console.log(`  ${'合计'.padEnd(12)} ${String(totalPages).padStart(2)} 页  ${String(totalMinutes).padStart(3)}'`);

if (kps.length) {
  const miss = kps.filter((kp) => !covered.has(kp)).length;
  console.log(`\n知识点覆盖（${kps.length} 条${miss ? `，漏 ${miss} 条` : '，全部有人认领'}）`);
  for (const kp of kps) {
    const where = covered.get(kp);
    console.log(`  ${where ? '✓' : '✗'} ${kp}${where ? '  ← ' + where.join('、') : '  ← 没有页面讲'}`);
  }
}

if (plan.questions) console.log(`\n题量：课内 ${plan.questions.inClass ?? 0} 题，课后 ${plan.questions.homework ?? 0} 题`);
if (plan.media?.length) console.log(`图示：${plan.media.join('；')}`);
if (plan.outOfScope?.length) console.log(`不做：${plan.outOfScope.join('；')}`);

if (warnings.length) {
  console.log('\n提醒：');
  warnings.forEach((w) => console.log(`  · ${w}`));
}
if (problems.length) {
  console.log('\n问题（必须改）：');
  problems.forEach((p) => console.log(`  ✗ ${p}`));
  console.log('');
  process.exit(1);
}
console.log(`\n${line}\n老师确认（或改完）之后，再按这张卡生成 deck.json。\n`);
