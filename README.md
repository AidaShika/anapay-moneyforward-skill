# anapay-moneyforward-skill

ANA Pay の支出を Money Forward ME（Web 版）の手入力口座へ 1 件ずつ自動で入力する Muse スキルです。

Money Forward ME の公式コネクタは読み取り専用のため、手入力口座への書き込みはできません。本スキルは ANA Pay の利用通知メールから再構築した台帳 JSON をもとに、Playwright で Web 版の「手入力」モーダルを操作して入力します。1 件ごとに入力済みでないかを確認し、入力後に一覧の行と残高の減少額で検証するため、二重計上を防げます。

> 非公式ツールです。Money Forward の公式 API ではありません。
> ブラウザ自動化は、サービス側の利用規約やページ仕様の変更の影響を受けます。
> ご自身のアカウントで、ご自身の責任においてご利用ください。

## なぜ Muse なのか

このスキルの強みは Muse とのネイティブ連携にあります。本スキルは [Muse](https://muse.ai) のスキルとして設計されています。単体のスクリプト集との決定的な違いは、**Muse が Money Forward ME と Gmail の両方に公式コネクタで直接つながっている**ことです。

| 手順 | 従来の方法 | 本スキル（Muse） |
|---|---|---|
| 支払いデータの入手 | 通知メールを手作業で転記する、メール転送の仕組みを自作する | Muse が Gmail コネクタで `payinfo@121.ana.co.jp` からの通知を直接検索して読み取る |
| 分類の判断 | すべて自分で決める | Muse が利用先ごとに分類を提案し、自信のないものだけ利用者に確認する |
| 入力 | 手入力を 1 件ずつ繰り返す | `enter.mjs` が重複防止と残高検証付きで 1 件ずつ入力する |
| 照合 | Money Forward とメールを見比べる | Muse が Money Forward コネクタ（読み取り専用）で残高と明細を読み、台帳と突き合わせる |

メール取得と残高照合に API キーやスクレイピングは不要で、コネクタが担います。ブラウザ自動化が必要なのは、手入力口座への書き込みだけです。公式コネクタが読み取り専用であるため、その書き込みの手順だけを Playwright のスクリプトが補います。

前提条件：Muse で Money Forward ME コネクタと Gmail コネクタを接続済みであること。未接続の場合は、Muse の案内に従って接続してください。

## 処理の流れ

```
ANA Pay 通知メール (payinfo@121.ana.co.jp)
  → 台帳 JSON を再構築する（支払い、取消、チャージを本文で判別）
  → 利用先ごとの分類を利用者と確認する
  → enter.mjs が手入力で登録する（重複チェックと残高検証付き）
  → 読み取り専用コネクタで残高と明細を照合する
```

## Muse スキルとしての導入方法

Muse のカスタムスキルとして使う場合は、このリポジトリをスキルのフォルダへクローンします。

```bash
git clone https://github.com/AidaShika/anapay-moneyforward-skill ~/workspace/custom-skills/mf_anapay_moneyforward_entry
cd ~/workspace/custom-skills/mf_anapay_moneyforward_entry
npm install
```

その後、Muse で Money Forward ME コネクタと Gmail コネクタを接続し、「ANA Pay の支出を Money Forward に入力して」と頼むだけです。Muse が台帳の作成、分類の確認、入力、照合の順に進めます。本番の入力は利用者が対象の一覧を確認して承認した後にだけ始まります。

スクリプト単体でも使えます。その場合の手順は「初回ログイン」と「日常の使い方」を参照してください。

## 動作環境

| 項目 | 条件 |
|---|---|
| Node.js | 18 以上 |
| Google Chrome | インストール済みであること（Playwright 付属のブラウザは使いません） |
| Money Forward ME | 手入力口座（例：ANA Pay）を作成済みであること |

依存パッケージは `playwright` のみです。

```bash
npm install
```

## 初回ログイン（初回のみ。セッションが切れたら再度実行）

スクリプトは専用の永続プロファイル（`.mf-profile/`）を使い、**パスワードなどの認証情報は一切保存しません**。ログインは必ず利用者本人が行います。

```bash
node scripts/enter.mjs --login
```

ブラウザのウィンドウに Money Forward が表示されます。普段の方法（MF ID とワンタイムコード、または Apple ログイン）でログインし、家計簿が表示されたらターミナルで Enter キーを押してください。

セッションが切れている場合、スクリプトは終了コード 2 で終了します。自動ログインは行いません。

注意：ヘッドレスモードでは Money Forward の WAF に遮断されるため、実行はブラウザ表示あり（headed）が前提です。

## 日常の使い方

台帳 JSON（形式は `examples/sample_entries.json` を参照）を用意し、まずドライランで 1 件だけ確認します。

```bash
# ドライラン：フォームへの入力まで行い、保存はしない
node scripts/enter.mjs --entries ./entries-2026-11.json --dry-run --limit 1

# 本番の入力（status が "ready" の項目だけが対象）
node scripts/enter.mjs --entries ./entries-2026-11.json

# 主なオプション
#   --account NAME         支払元口座名（既定値は台帳の account、次に ANA Pay）
#   --status S             処理対象の status を変更する
#   --limit N              最大 N 件まで処理する
#   --continue-on-error    検証に失敗しても続行する（既定値は即時停止）
#   --report PATH          実行レポート JSON の出力先
#   --profile DIR          プロファイルの保存先を変更する
#   --allow-fix-mis-saved  早期送信時の自動修正を有効にする（実験的機能、既定値は無効）
```

終了コード：0 はすべて成功、1 は一般エラー、2 は再ログインが必要、3 は検証失敗による停止を表します。入力済みの項目は台帳へ `entered` と記録されるため、再実行しても安全に再開できます。

## 個人設定の置き場所

資金移動の除外ルールや、利用先と分類の対応表は人によって異なるため、本リポジトリには含めていません。`examples/config.example.json` と `examples/store_categories.example.json` をコピーして、ご自身の設定ファイルを作成してください。作成した設定ファイルは `.gitignore` で除外されています。

## ファイル構成

- `SKILL.md`：Muse 向けの手順と安全ルール
- `skill.yaml`：スキルのメタデータ
- `scripts/enter.mjs`：入力スクリプト本体（セレクタは冒頭の CONFIG / SEL に集約）
- `references/mail-parsing-rules.md`：通知メールの判別方法と台帳の作り方
- `references/mf-category-map.md`：Money Forward の分類に実在しない項目と、その代替
- `references/calibration.md`：ページ仕様変更時の再調整手順
- `examples/`：架空データの台帳サンプルと設定テンプレート
- `tests/`：純粋関数のユニットテスト（`npm test`）

## ライセンス

MIT（`LICENSE` を参照）。一部のセレクタ ID は同種の先行実装（anapay2moneyforward、SBI 版 Money Forward 向け）を参考にしています。
