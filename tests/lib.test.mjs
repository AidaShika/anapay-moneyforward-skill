import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYen, classifyNotice, pairCancellations, commonPrefixLen } from '../scripts/lib.mjs';

test('parseYen extracts amounts', () => {
  assert.equal(parseYen('¥12,345'), 12345);
  assert.equal(parseYen('残高 1,000円'), 1000);
  assert.equal(parseYen('no digits'), null);
  assert.equal(parseYen(null), null);
});

test('classifyNotice reads the body, not the subject', () => {
  assert.equal(classifyNotice('決済が完了しました'), 'payment');
  assert.equal(classifyNotice('取消が完了しました'), 'cancellation');
  assert.equal(classifyNotice('チャージが完了しました', { charge: 'チャージが完了' }), 'charge');
  assert.equal(classifyNotice('チャージが完了しました'), 'unknown');
  assert.equal(classifyNotice('something else'), 'unknown');
});

test('pairCancellations cancels the matching payment only', () => {
  const events = [
    { date: '2026-11-01', merchant: 'EXAMPLE EATS', amount: 1200, kind: 'payment' },
    { date: '2026-11-01', merchant: 'EXAMPLE EATS', amount: 1200, kind: 'cancellation' },
    { date: '2026-11-02', merchant: 'EXAMPLE SHOP', amount: 800, kind: 'payment' },
    { date: '2026-11-03', merchant: 'EXAMPLE NOWHERE', amount: 500, kind: 'cancellation' },
  ];
  const { payable, cancelled, unmatchedCancellations } = pairCancellations(events);
  assert.equal(payable.length, 1);
  assert.equal(payable[0].merchant, 'EXAMPLE SHOP');
  assert.equal(cancelled.length, 1);
  assert.equal(unmatchedCancellations.length, 1);
});

test('commonPrefixLen', () => {
  assert.equal(commonPrefixLen('その他食費', 'その他日用品'), 3);
  assert.equal(commonPrefixLen('食費', '日用品'), 0);
});
