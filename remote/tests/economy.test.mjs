// 積木帳本：只獎勵成果、防灌水、加成與上限
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test, RULES } from '../economy.js';

const T0 = Date.parse('2026-10-20T10:00:00+08:00');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const prompt = (sec, text = '幫我改一下') => ({ type: 'user', timestamp: at(sec), cwd: '/p', message: { role: 'user', content: text } });
const endTurn = (sec, extra = {}) => ({ type: 'assistant', timestamp: at(sec), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '好了' }] }, ...extra });
const toolUse = (sec, id, name, input) => ({ type: 'assistant', timestamp: at(sec), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (sec, id, content, isError = false) => ({ type: 'user', timestamp: at(sec), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const run = (lines) => { const s = _test.newSess(); return lines.flatMap(l => _test.eventsOf(s, l)).map(e => e.kind); };

test('回合：10 秒以上才算，不到 10 秒不算', () => {
  assert.deepEqual(run([prompt(0), endTurn(12)]), ['turn']);
  assert.deepEqual(run([prompt(0), endTurn(5)]), []);
});

test('回合：沒有人問、claude 自己開的回合（背景任務回報）不算', () => {
  assert.deepEqual(run([endTurn(30)]), []);
});

test('回合：API 錯誤訊息不算', () => {
  assert.deepEqual(run([prompt(0), endTurn(20, { isApiErrorMessage: true })]), []);
});

test('改檔：成功才算，同一段對話同一個檔只算一次', () => {
  const kinds = run([
    toolUse(1, 'a', 'Edit', { file_path: '/p/x.js' }), toolResult(2, 'a', 'ok'),
    toolUse(3, 'b', 'Edit', { file_path: '/p/x.js' }), toolResult(4, 'b', 'ok'),
    toolUse(5, 'c', 'Write', { file_path: '/p/y.js' }), toolResult(6, 'c', 'boom', true),
  ]);
  assert.deepEqual(kinds, ['file']);
});

test('git commit：輸出有分支與雜湊才算', () => {
  const ok = run([toolUse(1, 'a', 'Bash', { command: 'git add . && git commit -m "x"' }), toolResult(2, 'a', '[main 1a2b3c4] x\n 1 file changed')]);
  assert.deepEqual(ok, ['commit']);
  const nothing = run([toolUse(1, 'a', 'Bash', { command: 'git commit -m "x"' }), toolResult(2, 'a', 'nothing to commit, working tree clean')]);
  assert.deepEqual(nothing, []);
  const failed = run([toolUse(1, 'a', 'Bash', { command: 'git commit -m "x"' }), toolResult(2, 'a', '[main 1a2b3c4] x', true)]);
  assert.deepEqual(failed, []);
  const dry = run([toolUse(1, 'a', 'Bash', { command: 'git commit --dry-run' }), toolResult(2, 'a', '[main 1a2b3c4] x')]);
  assert.deepEqual(dry, []);
});

test('git commit -q：成功時沒輸出，沒報錯就算', () => {
  const qm = run([toolUse(1, 'a', 'Bash', { command: 'git add . && git commit -qm "x" && git log --oneline -1' }), toolResult(2, 'a', '1a2b3c4 x')]);
  assert.deepEqual(qm, ['commit']);
  const tail = run([toolUse(1, 'a', 'Bash', { command: 'git commit -am "x" -q' }), toolResult(2, 'a', '')]);
  assert.deepEqual(tail, ['commit']);
  const nothing = run([toolUse(1, 'a', 'Bash', { command: 'git commit -qm "x"; git status' }), toolResult(2, 'a', 'nothing to commit, working tree clean')]);
  assert.deepEqual(nothing, []);
  const failed = run([toolUse(1, 'a', 'Bash', { command: 'git commit -qm "x"' }), toolResult(2, 'a', '', true)]);
  assert.deepEqual(failed, []);
  const loud = run([toolUse(1, 'a', 'Bash', { command: 'git commit -m "x"' }), toolResult(2, 'a', '')]);
  assert.deepEqual(loud, [], '沒加 -q 還是要看到分支與雜湊');
});

test('背景任務：完成才算，同一個任務只算一次', () => {
  const note = (sec, id, status) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at(sec), content: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>` });
  assert.deepEqual(run([note(1, 't1', 'completed'), note(2, 't1', 'completed'), note(3, 't2', 'failed')]), ['bg']);
});

test('待辦：勾掉才算，同一項只算一次', () => {
  const todo = (sec, status) => toolUse(sec, 'td' + sec, 'TodoWrite', { todos: [{ content: '寫測試', status }, { content: '部署', status: 'pending' }] });
  assert.deepEqual(run([todo(1, 'in_progress'), todo(2, 'completed'), todo(3, 'completed')]), ['todo']);
});

test('子 agent 的紀錄（sidechain）不算', () => {
  assert.deepEqual(run([{ ...prompt(0), isSidechain: true }, { ...endTurn(20), isSidechain: true }]), []);
});

test('入帳：每天第一筆送簽到，一半進部門一半進公司', () => {
  _test.reset();
  _test.credit({ at: T0, cwd: '/p', sid: 's', kind: 'turn' });
  const st = _test.state;
  assert.equal(st.total, RULES.checkin + RULES.turn);
  assert.equal(st.company.balance, st.total / 2);
  assert.equal(st.depts['/p'].balance, st.total / 2);
  _test.credit({ at: T0 + 60_000, cwd: '/p', sid: 's', kind: 'turn' });
  assert.equal(st.total, RULES.checkin + RULES.turn * 2, '同一天第二筆不再送簽到');
});

test('入帳：每個專案每小時最多 30 塊', () => {
  _test.reset();
  for (let i = 0; i < 20; i++) _test.credit({ at: T0 + i * 1000, cwd: '/p', sid: 's', kind: 'commit' });
  const st = _test.state;
  assert.equal(st.total - RULES.checkin, 30);
  _test.credit({ at: T0 + 1000, cwd: '/q', sid: 's', kind: 'commit' });
  assert.equal(st.depts['/q'].earned, RULES.commit / 2, '別的專案不受影響');
});

test('入帳：連續上班加成，每天 +10%，最多 1.5 倍', () => {
  _test.reset();
  const day = 86400_000;
  for (let d = 0; d < 8; d++) _test.credit({ at: T0 + d * day, cwd: '/p', sid: 's', kind: 'turn' });
  const st = _test.state;
  assert.equal(st.daily.streak, 8);
  const last = st.ledger.filter(l => l.kind === 'turn').at(-1);
  assert.equal(last.amount, 1.5);
  const second = st.ledger.filter(l => l.kind === 'turn')[1];
  assert.equal(second.amount, 1.1);
});

test('入帳：中斷一天，連續天數重來', () => {
  _test.reset();
  const day = 86400_000;
  _test.credit({ at: T0, cwd: '/p', sid: 's', kind: 'turn' });
  _test.credit({ at: T0 + day, cwd: '/p', sid: 's', kind: 'turn' });
  _test.credit({ at: T0 + 3 * day, cwd: '/p', sid: 's', kind: 'turn' });
  assert.equal(_test.state.daily.streak, 1);
});

test('獎盃：第一次背景任務做完就頒「第一位同事」', () => {
  _test.reset();
  _test.credit({ at: T0, cwd: '/p', sid: 's', kind: 'bg' });
  assert.ok(_test.state.trophies.first_bg);
});

import { questsOf, QUESTS } from '../economy.js';
test('每日任務：每天三個不同種類、同一天固定', () => {
  const a = questsOf('2026-10-21'), b = questsOf('2026-10-21');
  assert.equal(a.length, 3);
  assert.deepEqual(a.map(q => q.id), b.map(q => q.id));
  assert.equal(new Set(a.map(q => q.kind)).size, 3);
  assert.ok(a.every(q => QUESTS.includes(q)));
});
test('用量：同一則回覆拆成多行只算一次', () => {
  const s = _test.newSess();
  const line = (sec) => ({ type: 'assistant', timestamp: at(sec), message: { id: 'msg_1', usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: 20 }, content: [{ type: 'text', text: 'x' }] } });
  const ev = [line(1), line(2), line(3)].flatMap(l => _test.eventsOf(s, l)).filter(e => e.kind === 'usage');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].usage, { in: 5, cr: 100, cw: 10, out: 20 });
});
test('公共設施：整層樓才解鎖的那批，等級不到不能買、到了照常扣公司積木', () => {
  _test.reset();
  const st = _test.state;
  st.company.balance = 5000;
  st.total = 11999;   // 正式辦公室
  assert.throws(() => _test.buyFacility('gym'), /公司等級還不夠/);
  assert.equal(st.facilities.gym, 0);
  _test.buyFacility('coffee');   // 舊的設施不受影響
  st.total = 12000;   // 整層樓
  _test.buyFacility('gym');
  assert.equal(st.facilities.gym, 1);
  assert.equal(st.company.balance, 5000 - 150 - 600);
});
