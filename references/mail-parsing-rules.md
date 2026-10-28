# Mail parsing rules

How to rebuild a ledger from ANA Pay notification emails. All amounts and
merchants in real ledgers are the user's private data and stay local.

## Source

- Sender: `payinfo@121.ana.co.jp`
- One email per event: a payment, a cancellation or a charge (top-up).

## Classify by body, never by subject

Payment and cancellation notices share the same subject. Read the body:

- Body contains 「決済が完了」: a payment. Record date, merchant and amount.
- Body contains 「取消が完了」: a cancellation. Pair it with the earlier
  payment of the same merchant and amount and remove both from the payable
  set. A cancellation is never a payment and never income.
- Charge notices: balance movement only. Whether a charge is recorded in
  Money Forward depends on the user's own funding chain. Keep charges in
  the ledger for balance rolling and mark them excluded from entries.

## Exclusions are user configuration

Wallet-to-wallet movements double count when the other wallet already
syncs into Money Forward. Which merchants count as such a movement is a
per-user decision, stored in the user's `config.json` (see
`examples/config.example.json`), not in this skill.

## Reconciliation before entry

- Anchor: the Money Forward balance of the wallet at the end of the
  previous month.
- Roll forward: anchor + charges - payments, day by day.
- Compare the rolled balance on a known date with the wallet app's real
  balance. Investigate any gap before entering anything. Gaps usually
  mean a missing charge whose matching transfer arrives late in
  Money Forward, not a missing payment.
- Only payments whose category has been confirmed become `ready`.

## Ledger format

See `examples/sample_entries.json`. Statuses: `draft` (category or data
undecided), `ready` (approved for entry), `entered` (written back by the
entry script with its verification), `entered-needs-fix` (entered with a
wrong category, to be corrected by hand in Money Forward).
