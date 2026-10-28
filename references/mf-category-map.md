# Money Forward category map

Verified on the standard edition of Money Forward ME (moneyforward.com/cf)
in October 2026. Categories can differ in other editions and can change.

## Subcategories that do not exist, and what to use instead

| Intended | Exists? | The entry script falls back to |
|---|---|---|
| 食費 / コンビニ | No | 食費 / ドリンク (nearest match, confirm with the user) |
| 衣服・美容 / 衣類 | No | 衣服・美容 / 衣服 |
| 趣味・娯楽 / グッズ | No | 趣味・娯楽 / その他趣味・娯楽 |
| 日用品 / (unspecified) | — | 日用品 / その他日用品 |

- Under 住宅, the middle category is named 「住宅」 itself, not 「住まい」.

## How the script chooses

The script first tries an exact subcategory match, then the longest
common-prefix partial match in the open dropdown menu only, and otherwise
keeps Money Forward's default. Whatever was actually saved is written to
the run report and to the ledger entry's `verification` as
`actualCategory` / `actualSub`, so a fallback is always visible and can be
corrected by hand.

## Merchant mappings are user data

Merchant to category mappings are built per user (see
`examples/store_categories.example.json` for the shape). Low-confidence
mappings must be confirmed with the user before use.
