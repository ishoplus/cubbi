// 本機取名：不呼叫模型，從第一句話用規則抓
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessName, fitWidth } from '../server/sources/naming.js';

test('角色設定取角色名', () => {
  assert.equal(guessName('你是「AI 发布雷达」的判断员。下面是今天的新闻…'), 'AI 发布雷达');
  assert.equal(guessName('你是這個 Threads 帳號的寫稿人。帳號在做…'), '這個 Threads 帳號');
  assert.equal(guessName('You are a code reviewer for the payments team.'), 'code reviewer');
});

test('斜線指令與一般請求', () => {
  assert.equal(guessName('/review 123'), 'review 123');
  assert.equal(guessName('幫我修登入頁的錯誤，手機上按不下去'), '修登入頁的錯誤');
  assert.equal(guessName('Please fix the flaky login test, it fails on CI'), 'fix the flaky login');
  assert.equal(guessName('看一下 ~/projects/cubbi/web/space/main.js 為什麼報錯'), '看一下 main.js 為什麼');
  assert.equal(guessName('```\ncode\n```'), 'code');
  assert.equal(guessName('用 Task 工具（不要背景執行）派一個子 agent'), '用 Task 工具');
  assert.equal(guessName(''), '');
});

test('寬度：中文算 1、英文算 0.55，不從單字中間切', () => {
  assert.equal(fitWidth('一二三四五六七八九十十一十二'), '一二三四五六七八九十十');
  assert.equal(fitWidth('refactor the authentication module'), 'refactor the');
});
