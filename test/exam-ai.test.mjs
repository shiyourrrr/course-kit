import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHomeworkSkeleton,
  homeworkGuidance,
  normalizeExamCounts,
  formatQuestionsToMarkdown,
  generateExamQuestions,
  FREEDOM_PRESETS,
} from '../app/exam-ai.mjs';
import { parseQuestions } from '../tools/question-parse.mjs';

test('exam-ai: buildHomeworkSkeleton scales pages by question count and keeps 5-question default', () => {
  assert.deepEqual(buildHomeworkSkeleton(5), ['cover', 'exercise', 'exercise', 'variant', 'homework']);
  assert.equal(buildHomeworkSkeleton(2).length, 3);
  assert.equal(buildHomeworkSkeleton(3).length, 4);
  assert.equal(buildHomeworkSkeleton(6).length, 6);
  assert.equal(buildHomeworkSkeleton(10).length, 8);
});

test('exam-ai: homeworkGuidance maps freedom presets to exact temperatures and prompts', () => {
  const s = homeworkGuidance({ questionCount: 8, freedom: 'strict', difficulty: 'basic' });
  assert.equal(s.count, 8);
  assert.equal(s.temperature, FREEDOM_PRESETS.strict.temperature);
  assert.match(s.prompt, /严格 8 题/);
  assert.match(s.prompt, /严禁超纲/);

  const c = homeworkGuidance({ questionCount: 6, freedom: 'creative', difficulty: 'challenge' });
  assert.equal(c.temperature, FREEDOM_PRESETS.creative.temperature);
  assert.match(c.prompt, /自由拓展/);
});

test('exam-ai: normalizeExamCounts validates bounds and rejects 0, >15 per type, decimals, negatives, or >30 total', () => {
  assert.throws(() => normalizeExamCounts({ single: 0, essay: 0 }), /至少设置 1 道题/);
  assert.throws(() => normalizeExamCounts({ single: 31 }), /单次最多 15 题/);
  assert.throws(() => normalizeExamCounts({ single: -1, blank: 2 }), /非负整数/);
  assert.throws(() => normalizeExamCounts({ single: 1.5, blank: 2 }), /非负整数/);
  assert.throws(() => normalizeExamCounts({ single: 15, blank: 15, essay: 1 }), /最多 30 题/);
  assert.throws(() => buildHomeworkSkeleton(0), /1~12/);
  assert.throws(() => buildHomeworkSkeleton(1.5), /1~12/);
  assert.throws(() => buildHomeworkSkeleton(31), /1~12/);
  const ok = normalizeExamCounts({ single: 4, multi: 1, judge: 2, blank: 3, essay: 2 });
  assert.equal(ok.total, 12);
  // 10 题作业自动拆为 2 页 homework 清单以容纳 >8 题
  assert.equal(buildHomeworkSkeleton(10).filter((x) => x === 'homework').length, 2);
});

test('exam-ai: mock generateExamQuestions round-trips cleanly through parseQuestions with 0 unparsed', async () => {
  const prevMock = process.env.COURSE_KIT_AI_MOCK;
  process.env.COURSE_KIT_AI_MOCK = '1';
  try {
    const out = await generateExamQuestions({
      title: '勾股定理',
      grade: '八年级',
      freedom: 'strict',
      difficulty: 'tiered',
      counts: { single: 2, multi: 1, judge: 1, blank: 2, essay: 1 },
    });
    assert.equal(out.total, 7);
    assert.equal(out.freedom, 'strict');
    const parsed = parseQuestions(out.markdown);
    assert.equal(parsed.questions.length, 7);
    assert.equal(parsed.unparsed.length, 0);
    assert.deepEqual(
      parsed.questions.map((q) => q.type),
      ['单选', '单选', '多选', '判断', '填空', '填空', '解答']
    );
  } finally {
    if (prevMock === undefined) delete process.env.COURSE_KIT_AI_MOCK;
    else process.env.COURSE_KIT_AI_MOCK = prevMock;
  }
});
