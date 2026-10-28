// Pure helpers for building a ledger from ANA Pay notification mail.
// No browser, no I/O: everything here is unit tested under tests/.
// scripts/enter.mjs keeps its own copies of parseYen for now; new ledger
// tooling should import from here.

/** Extract a yen amount from text like "¥12,345" or "12,345円". */
export function parseYen(text) {
  if (text === null || text === undefined) return null;
  const m = String(text).replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Classify one notification by its body text.
 * Payment and cancellation share a subject, so the body decides.
 * Returns 'payment', 'cancellation', 'charge' or 'unknown'.
 */
export function classifyNotice(body, markers = {}) {
  const payment = markers.payment ?? '決済が完了';
  const cancellation = markers.cancellation ?? '取消が完了';
  // No default charge marker: the charge wording is not verified here.
  // Pass markers.charge from your own config after checking a real notice.
  const charge = markers.charge ?? null;
  const t = String(body ?? '');
  if (t.includes(cancellation)) return 'cancellation';
  if (t.includes(payment)) return 'payment';
  if (charge && t.includes(charge)) return 'charge';
  return 'unknown';
}

/**
 * Pair cancellations with their payments.
 * Input events: {date, merchant, amount, kind} where kind comes from
 * classifyNotice. A cancellation removes the most recent earlier (or
 * same-day) unpaid payment with the same merchant and amount.
 * Returns { payable, cancelled, unmatchedCancellations }.
 */
export function pairCancellations(events) {
  const payable = [];
  const cancelled = [];
  const unmatchedCancellations = [];
  const sorted = [...events].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const ev of sorted) {
    if (ev.kind === 'cancellation') {
      const idx = payable.findLastIndex(
        (p) => p.merchant === ev.merchant && p.amount === ev.amount,
      );
      if (idx >= 0) {
        cancelled.push({ payment: payable.splice(idx, 1)[0], cancellation: ev });
      } else {
        unmatchedCancellations.push(ev);
      }
    } else if (ev.kind === 'payment') {
      payable.push(ev);
    }
  }
  return { payable, cancelled, unmatchedCancellations };
}

/** Longest common prefix length, used for fuzzy subcategory matching. */
export function commonPrefixLen(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  let i = 0;
  while (i < s.length && i < t.length && s[i] === t[i]) i++;
  return i;
}
