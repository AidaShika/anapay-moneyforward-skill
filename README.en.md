# anapay-moneyforward-skill

[日本語](README.md) | English

A Muse skill that enters ANA Pay expenses into a Money Forward ME manual-entry account, one transaction at a time, with a verification step for each.

Money Forward's official connector is read-only, so nothing can write to a manual-entry account through it. This skill rebuilds a ledger (JSON) from ANA Pay's transaction notification emails, then drives the web version's manual-entry dialog with Playwright. Before each entry it checks the transaction is not already recorded; after saving, it verifies the new row and confirms the balance dropped by exactly that amount, so nothing gets double-counted.

> Unofficial tool. This is not a Money Forward API.
> Browser automation can break when the service changes its pages, and using it is subject to the service's terms.
> Use it with your own account, at your own responsibility.

## Why Muse

The point of this skill is how Muse connects natively. It is built as a skill for [Muse](https://muse.ai), and what sets it apart from a standalone script is that **Muse already talks to both Money Forward ME and Gmail through official connectors**.

| Step | The usual way | With this skill (Muse) |
|---|---|---|
| Getting the transactions | Copy notification emails by hand, or build your own mail-forwarding setup | Muse searches and reads the notifications from `payinfo@121.ana.co.jp` through the Gmail connector |
| Choosing categories | Decide every single one yourself | Muse proposes a category per merchant and only asks about the ones it is unsure of |
| Data entry | Repeat manual entry for every transaction | `enter.mjs` enters them one by one, with duplicate checks and balance verification |
| Reconciliation | Eyeball Money Forward against the emails | Muse reads balances and transactions back through the read-only Money Forward connector and matches them against the ledger |

No API keys and no scraping for mail or reconciliation — the connectors handle that. Browser automation is needed for exactly one step: writing to the manual-entry account, which the read-only connector cannot do. The Playwright script fills that gap.

Prerequisite: the Money Forward ME and Gmail connectors are connected in Muse. If they are not, follow Muse's prompts to connect them.

## How it flows

```
ANA Pay notification email (payinfo@121.ana.co.jp)
  → Rebuild the ledger JSON (payments, cancellations and top-ups told apart by the email body)
  → Confirm the category of each merchant with the user
  → enter.mjs registers the entries (duplicate check + balance verification)
  → Reconcile balances and transactions through the read-only connector
```

## Installing as a Muse skill

To use it as a custom skill in Muse, clone this repository into your skills folder:

```bash
git clone https://github.com/AidaShika/anapay-moneyforward-skill ~/workspace/custom-skills/mf_anapay_moneyforward_entry
cd ~/workspace/custom-skills/mf_anapay_moneyforward_entry
npm install
```

Then connect the Money Forward ME and Gmail connectors in Muse and simply ask: "Enter my ANA Pay expenses into Money Forward." Muse walks through building the ledger, confirming categories, entering, and reconciling. Nothing is actually entered until you have seen the list of transactions and approved it.

The script also runs on its own; see "First login" and "Daily use" below.

## Requirements

| Item | Requirement |
|---|---|
| Node.js | 18 or newer |
| Google Chrome | Installed (the browser bundled with Playwright is not used) |
| Money Forward ME | A manual-entry account (e.g. ANA Pay) already created |

The only dependency is `playwright`.

```bash
npm install
```

## First login (once; repeat when the session expires)

The script uses its own persistent profile (`.mf-profile/`) and **never stores passwords or other credentials**. The user always logs in personally.

```bash
node scripts/enter.mjs --login
```

Money Forward opens in a browser window. Log in the way you normally do (MF ID with a one-time code, or Apple sign-in); once the household budget view appears, press Enter in the terminal.

If the session has expired, the script exits with code 2. It never logs in automatically.

Note: Money Forward's WAF blocks headless mode, so the browser must run headed.

## Daily use

Prepare a ledger JSON (format: `examples/sample_entries.json`) and check a single entry with a dry run first.

```bash
# Dry run: fills the form but does not save
node scripts/enter.mjs --entries ./entries-2026-11.json --dry-run --limit 1

# Real run (only entries whose status is "ready")
node scripts/enter.mjs --entries ./entries-2026-11.json

# Main options
#   --account NAME         Source account name (default: the ledger's account, then ANA Pay)
#   --status S             Only process entries with this status
#   --limit N              Process at most N entries
#   --continue-on-error    Keep going even if verification fails (default: stop immediately)
#   --report PATH          Where to write the run report JSON
#   --profile DIR          Change the profile directory
#   --allow-fix-mis-saved  Enable automatic repair of early-submitted entries (experimental, off by default)
```

Exit codes: 0 means everything succeeded, 1 a general error, 2 login required, 3 stopped on a verification failure. Entered items are marked `entered` in the ledger, so re-running resumes safely.

## Where personal settings live

Rules for excluding money movements and the merchant-to-category table differ from person to person, so they are not part of this repository. Copy `examples/config.example.json` and `examples/store_categories.example.json` and make your own settings files. They are excluded by `.gitignore`.

## Files

- `SKILL.md` — workflow and safety rules for Muse
- `skill.yaml` — skill metadata
- `scripts/enter.mjs` — the entry script (selectors are collected in CONFIG / SEL at the top)
- `references/mail-parsing-rules.md` — how to tell notification emails apart and build the ledger
- `references/mf-category-map.md` — category names that do not actually exist in Money Forward, and their substitutes
- `references/calibration.md` — how to recalibrate when the pages change
- `examples/` — sample ledger with fictional data, and settings templates
- `tests/` — unit tests for the pure functions (`npm test`)

## License

MIT (see `LICENSE`). Some selector IDs were informed by an earlier project of the same kind, anapay2moneyforward, which targets the SBI edition of Money Forward.
