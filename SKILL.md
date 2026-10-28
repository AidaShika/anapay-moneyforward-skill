# ANA Pay to Money Forward Entry

## When to use it and when to skip it

- Use it when the user wants ANA Pay spending recorded in Money Forward ME, where ANA Pay exists only as a manual (手入力) wallet that Money Forward cannot sync automatically.

- Use it for other unsynced wallets only after adapting the mail parser rules and the account name, and say plainly that only the ANA Pay path is verified.

- Skip it when the account already syncs into Money Forward, because manual entries would double count.

- Record expenses one by one, never as a monthly lump sum, so each entry keeps its date, merchant and amount.

## Safety rules that never bend

- Treat every run as writing to a financial ledger. Show the user the exact batch (dates, merchants, amounts, categories) and get approval for that batch before any non dry-run entry.

- Run `scripts/enter.mjs --dry-run --limit 1` first in every new environment and after any Money Forward page change.

- Never store, read or ask for the user's Money Forward password or one-time codes. The user logs in by hand through `--login`, and the script only reuses the local browser profile.

- Stop the whole run on the first verification failure unless the user explicitly chose `--continue-on-error` for that run.

- Keep ledger files, reports and the browser profile local. None of them belong in a git repository.

- Leave the experimental mis-saved-entry auto-fix off. It stays behind `--allow-fix-mis-saved` because its edit-modal selectors are not fully calibrated.

## Prepare the environment

- Require Node.js 18 or newer and an installed Google Chrome. The script drives the installed Chrome through Playwright and does not download a browser.

- Install dependencies once with `npm install` in this folder.

- Run the login step once with `node scripts/enter.mjs --login` and let the user sign in themselves in the headed window. Headless mode is blocked by Money Forward's WAF, so keep runs headed.

- Read the Money Forward ME connector doc before reconciling, because that connector is read-only and is the check on what the script wrote, never the write path.

## Build the ledger from notification mail

- Search the user's mail for ANA Pay notifications from `payinfo@121.ana.co.jp` in the target month and read each message body, because the subject alone cannot separate a payment from a cancellation.

- Classify each notice by its body text. Treat 「決済が完了」 as a payment, 「取消が完了」 as a cancellation that cancels its matching payment, and a charge notice as balance movement only.

- Follow the parsing and exclusion rules in `references/mail-parsing-rules.md`. Exclusion rules such as wallet-to-wallet top-ups live in the user's own `config.json`, copied from `examples/config.example.json`, never in this skill.

- Write the ledger in the format of `examples/sample_entries.json`, with one entry per payment and a status of `ready` only after its category is confirmed.

## Confirm categories before entry

- Propose a category and subcategory per merchant using `references/mf-category-map.md`, which records which subcategories Money Forward actually offers and what the script falls back to.

- Ask the user about every low-confidence merchant instead of guessing, and save confirmed mappings in the user's own store-category file so the next month reuses them.

- Leave an entry out of the `ready` set while its category is undecided.

## Enter and verify

- Run the entry with `node scripts/enter.mjs --entries <ledger.json>`, adding `--account <name>` when the wallet is not the ledger's account.

- Rely on the script's per-entry checks. It skips entries already present in the month list, writes each saved entry back to the ledger as `entered` at once, and verifies the list row plus an exact balance decrease before continuing.

- Read the run report under `reports/` and reconcile the final balance and the month's entries through the read-only Money Forward connector before telling the user the batch is done.

- Report failures by entry, with the script's note, and never re-run a batch blindly. Entries already marked `entered` are skipped by design, so a re-run resumes safely.

## When the script breaks

- Suspect a Money Forward page change first. Recalibrate only the `CONFIG` and `SEL` sections at the top of `scripts/enter.mjs`, following `references/calibration.md`.

- Exit code 2 means the saved session expired. Ask the user to repeat the manual `--login` step instead of trying any automated sign-in.

## Available connectors

- [Money Forward ME](/opt/hatch/connectors/moneyforward_me/CONNECTOR.md) for read-only balance, holdings and transaction checks that reconcile what the script entered.

- [Gmail](/opt/hatch/connectors/gmail/CONNECTOR.md) for reading the ANA Pay notification mail that the ledger is built from.

- Use `muse.connector_search` to find other connectors and `muse.skill_search` to find related skills.

- If nothing here fits, look on the web for a maintained API or MCP server and set it up with [Custom Connectors and MCPs](/opt/muse/skills/custom-connector-setup/SKILL.md), or build a custom connector.
