# Calibration and troubleshooting

Money Forward has no public write API for manual wallets, so this skill
drives the web UI. When Money Forward changes its pages, recalibrate
instead of rewriting.

## Rules

- All selectors live in the `CONFIG` and `SEL` sections at the top of
  `scripts/enter.mjs`. Change only that area first.
- Always recalibrate with `--dry-run --limit 1` on one harmless entry.
  A dry run fills the form and never saves.
- Set `MF_ENTRY_DEBUG=1` for timestamped debug logs on stderr.
- Every locator passed to waitFor, click or fill must be narrowed to a
  single element first (`.first()`), or Playwright throws a strict mode
  violation that looks like "element not found".

## Known facts about the standard edition (verified October 2026)

- Headless browsers are blocked by the WAF (a bare Forbidden page).
  Run headed with the installed Chrome.
- The manual entry button is `button.cf-new-btn.modal-switch` and appears
  twice on the page. The modal is `#user_asset_act_new`.
- Expense, income and transfer are radio inputs, not tabs.
- The account select must be matched by
  `name="user_asset_act[sub_account_id_hash]"` and visibility. The modal
  also contains a hidden transfer select that a naive `.first()` grabs.
- Large and middle categories are Bootstrap dropdowns. Pick items only
  inside the opened menu (`ul.dropdown-menu.main_menu` /
  `ul.dropdown-menu.sub_menu`), never by page-wide text, or list rows
  with the same category name get clicked.
- Choosing a middle category can submit the form early. The script
  fills the date last and asserts the modal is still open after each
  step to catch this.
- The month header is a period range such as `2026/10/1 - 2026/10/31`,
  and the pager buttons are ◄ and ►.

## Not yet verified

- Editing an already saved entry through the script (the auto-fix path)
  is experimental and disabled by default. Correct a wrong category by
  hand in Money Forward instead.
