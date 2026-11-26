import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestions } from '../tools/question-parse.mjs';

test('单选：行内和换行选项、答案和解析', () => {
  const {questions, unparsed} = parseQuestions('1. 选择 A. 苹果 B、梨\nC．桃 （D）李\n【答案】B\n【解析】理由');
  assert.deepEqual(unparsed, []);
  assert.deepEqual(questions, [{type:'单选', stem:'选择', options:['苹果','梨','桃','李'].map((text,i)=>({text,correct:i===1})), answer:'B', explain:'理由'}]);
});
test('多选：行末两种正确标记', () => {
  const [q] = parseQuestions('2、选出 A. 一√ B. 二 C. 三*').questions;
  assert.equal(q.type, '多选');
  assert.equal(q.answer, 'AC');
});
test('判断：显式类型与 Markdown 复选框', () => {
  const [q] = parseQuestions('### 1. [判断] 命题成立\n- [x] 正确\n- [ ] 错误\n> 答案：正确').questions;
  assert.equal(q.type, '判断');
  assert.equal(q.options[0].correct, true);
});
test('填空：保留公式中的选项外观及乘号', () => {
  const [q] = parseQuestions('（1）$A. x*y$ 的值是 ___\n答：$a*b$').questions;
  assert.equal(q.type, '填空');
  assert.equal(q.stem, '$A. x*y$ 的值是 ___');
  assert.equal(q.answer, '$a*b$');
});
test('解答：长文本及按原题号匹配的参考答案块', () => {
  const {questions,unparsed} = parseQuestions('第8题 请说明如何根据勾股定理求出三角形斜边的长度。\n9、数值 ___\n参考答案\n9. 3 8. 运用勾股定理\n解析：先平方');
  assert.deepEqual(unparsed, []);
  assert.equal(questions[0].type, '解答');
  assert.deepEqual(questions.map(q=>q.answer), ['运用勾股定理','3']);
  assert.equal(questions[0].explain, '先平方');
});
test('游离答案、无题号文本、过短待推断题干逐行报错', () => {
  const {questions, unparsed} = parseQuestions('答案：A\r\n资料随笔\r\n\r\n1. 一句');
  assert.deepEqual(questions, []);
  assert.deepEqual(unparsed.map(e=>[e.line,e.text]), [[1,'答案：A'],[2,'资料随笔'],[4,'1. 一句']]);
  assert.ok(unparsed.every(e=>e.reason));
});
test('跳号选项及冲突答案拒绝整题，后续有效题保留', () => {
  const {questions,unparsed} = parseQuestions('1. 选择 A. 一 C. 三\n2. 选择 A. 一√ B. 二\n答案：B\n3. 数值 ___');
  assert.equal(questions.length, 1);
  assert.deepEqual(unparsed.map(e=>e.line),[1,2,3]);
});
test('参考答案的重复题号不猜映射', () => {
  const {questions,unparsed} = parseQuestions('1. 数值 ___\n1. 另一个 ___\n参考答案：\n1、三');
  assert.deepEqual(questions.map(q=>q.answer),['','']);
  assert.deepEqual(unparsed.map(e=>e.line),[4]);
});
test('无法归属的前缀整行进入诊断，不改动题目答案', () => {
  const {questions,unparsed} = parseQuestions('1. 数值 ___\n资料说明 答案：123');
  assert.equal(questions[0].answer,'');
  assert.deepEqual(unparsed.map(e=>e.line),[2]);
});
test('越界的选项字母不可吞入题干或选项', () => {
  const {questions,unparsed} = parseQuestions('1. 选择 A. 甲 B. 乙 I. 丙\n2. 请分析下列各个选项中描述的情况 I. 丙');
  assert.deepEqual(questions,[]);
  assert.deepEqual(unparsed.map(e=>e.line),[1,2]);
});
test('普通句子以参考答案开头，后续仍然能识别新题', () => {
  const {questions,unparsed} = parseQuestions('参考答案如下的观点需要讨论。\n1. 数值 ___');
  assert.equal(questions.length,1);
  assert.deepEqual(unparsed.map(e=>e.line),[1]);
});
