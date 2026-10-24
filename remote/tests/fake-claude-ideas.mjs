#!/usr/bin/env node
// 假的 claude -p：提案部用。印出 --output-format json 的樣子，result 是一批提案。FAKE_IDEAS_LOG 記下收到的 prompt
import { appendFileSync } from 'fs';
const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
if (process.env.FAKE_IDEAS_LOG) appendFileSync(process.env.FAKE_IDEAS_LOG, JSON.stringify({ args: argv.filter(a => a !== prompt), prompt }) + '\n');
const result = JSON.stringify({ proposals: [
  { kind: 'feature', project: 'app', dir: process.env.FAKE_IDEAS_DIR || '', title: '加深色模式', hook: '晚上用不刺眼', see: '設定裡有開關', why_now: '最近改了樣式', days: 1, risk: '顏色要調', plan: { do: ['加開關'], not_do: [], first_step: 'style.css' } },
  { kind: 'project', project: 'newthing', dir: '', title: '新東西', hook: '一個新項目', see: '首頁', why_now: '零件都有了', days: 3, risk: '沒人用', plan: { do: ['建專案'], not_do: [], first_step: 'README' } },
], skipped: '' });
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '好的，這是提案：\n' + result, session_id: 'fake-ideas-session' }));
