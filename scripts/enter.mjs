#!/usr/bin/env node
/**
 * enter.mjs — Money Forward ME 手入力钱包支出自动录入脚本（默认口座 ANA Pay，可用 --account 改）
 *
 * 做什么：读取台账 JSON（anapay_mf_entries_*.json），把 status 匹配的条目逐条
 *         通过 MF 网页版（https://moneyforward.com/cf）的「手入力」弹窗录入为
 *         从指定的手入力钱包支出的记录；每条录后回读列表行 + 余额做校验。
 *
 * 登录：使用脚本目录下独立的持久 profile（.mf-profile/）。首次用 --login
 *       以有头模式打开浏览器，由用户本人手动登录（MF ID 邮箱+OTP 或 Apple），
 *       之后运行复用该会话。本脚本绝不保存、读取或要求任何密码/凭据；
 *       会话失效时以退出码 2 明确报错并退出，不尝试自动登录。
 *
 * 用法：
 *   node enter.mjs --login [--profile DIR]
 *   node enter.mjs --entries PATH [--account NAME] [--status ready] [--limit N]
 *                  [--dry-run] [--headless] [--continue-on-error]
 *                  [--report PATH] [--profile DIR]
 *
 * 退出码：0 全部成功（或无待处理条目） / 1 一般错误 / 2 需要重新手动登录 /
 *         3 中途校验失败而停止（部分条目可能已录入，见报告）
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/* =====================================================================
 * CONFIG — MF 页面结构与选择器集中区
 * MF 改版导致脚本失效时，优先只改这一区。定位策略：文本/role 优先，
 * 已知 id 次之，每处都给了多个候选，firstVisible() 取第一个可见的。
 * 已知 id（#js-large-category-selected 等）来自同类开源实现
 * （anapay2moneyforward，SBI 版 MF，同产品线），普通版 MF 上需首次实跑校准。
 *
 * 【校准记录 2026-10-28 #1】探针脚本（未随仓库发布，
 * 复用 .mf-profile 会话、headful）实测普通版 moneyforward.com/cf 的真实 DOM：
 * - 注意：headless 会被 MF 的 WAF 挡（页面只剩 "Forbidden"），必须 headful。
 * - 手入力按钮：<button class="cf-new-btn btn modal-switch btn-warning"
 *   href="#user_asset_act_new">手入力</button>（页面上有 2 个）。原候选里
 *   locator('button, a').filter({hasText:/^手入力$/}) 实测匹配 0 个，已降权。
 * - 弹窗本体：<div id="user_asset_act_new" class="modal fade hide in">。
 *   原第一候选 #fc-input-form 在普通版不存在（每次白等一个超时），已移除。
 * - 支出/収入/振替 不是 tab，而是 radio（name="user_asset_act[payment]"，
 *   class 分别为 minus-payment / plus-payment / transfer-payment，三者共用
 *   同一个 id），默认 支出 已选中。原 expenseTab 逻辑已改为 radio 断言。
 * - 日期：<input name="user_asset_act[updated_at]" id="updated-at">，
 *   值格式 YYYY/MM/DD。金额：<input name="user_asset_act[amount]"
 *   id="appendedPrependedInput">。内容：<input name="user_asset_act[content]"
 *   id="js-content-field">。
 * - 支払元：弹窗内可见的 <select name="user_asset_act[sub_account_id_hash]"
 *   id="user_asset_act_sub_account_id_hash">，选项如「<口座名> (12,345円)」
 *   （金额随余额变，须按口座名前缀匹配）。原 accountSelect 第二候选
 *   modal.locator('select').first() 会命中弹窗内先出现的振替用 hidden
 *   select（_from），是静默选错口座的坑，已改为按 name 精确匹配+取可见者。
 * - 分類：#js-large-category-selected / #js-middle-category-selected 是
 *   Bootstrap dropdown 的 <a data-toggle="dropdown">。点大分類弹出
 *   ul.dropdown-menu.main_menu，里面 a.l_c_name 是大分類、a.m_c_name 是
 *   其下中分類（同一菜单内的子菜单项）；点某个大分類后中分類トグル会
 *   自动变成「その他<大分類>」，再点中分類トグル弹出 ul.dropdown-menu
 *   .sub_menu（只有该大分類的中分類，a.m_c_name）。原 clickPickerOption
 *   在整页按文本找链接，会命中列表行/筛选器的同名分类，是误点源头，
 *   已改为只在打开的菜单内按 a.l_c_name / a.m_c_name 精确匹配クリック。
 * - 保存：<input type="submit" id="submit-button" value="保存する">；
 *   保存後の「続けて入力する」は <input type="button"
 *   id="confirmation-button">（初期 display:none）。閉じるは弹窗 header 内
 *   <div class="close" data-dismiss="modal">。
 * - 月份表头：/cf 默认是日历视图，期间文本为「2026/10/1 - 2026/10/31」
 *   形式，前/翌月按钮文本是 ◄ / ►（原候选里的 ◀/‹ 与实际字符不符，已补）。
 * - 【初回 dry-run 失败的真因】手入力按钮在页面上有 2 个，而旧 firstVisible()
 *   直接对多匹配 locator 调 waitFor()，Playwright 会立刻抛 strict mode
 *   violation（不是超时），于是所有候选瞬间全灭、误报「找不到按钮」。
 *   探针里 isVisible()/.first().waitFor() 都不受此限，所以探针全过、脚本独败。
 *   已改为对 .first() 等待。教训：凡 waitFor/click/fill 的 locator 必须先收窄到单个。
 * ===================================================================== */
const CONFIG = {
  cfUrl: 'https://moneyforward.com/cf',
  homeUrl: 'https://moneyforward.com/',
  // 落到登录页时的 URL 特征
  loginUrlPattern: /id\.moneyforward\.com|moneyforward\.com\/sign_in|\/login/,
  // 家計簿ページが表示されている目印（ログインボタンと誤認しないよう複数）
  loggedInMarkers: ['手入力', '家計簿'],
  defaultProfileDir: path.join(SCRIPT_DIR, '.mf-profile'),
  defaultEntries: path.join(SCRIPT_DIR, 'anapay_mf_entries.json'),
  viewport: { width: 1280, height: 900 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  // 前月/翌月ボタンの候補ラベル（校准 #1：実物は ◄ / ►）
  prevMonthLabels: ['◄', '前月', '< 前月', '‹', '◀'],
  nextMonthLabels: ['►', '翌月', '次月', '翌月 >', '›', '▶'],
};

const SEL = {
  // 「手入力」ボタン（cf ページ上部）— 校准 #1：実物は button.cf-new-btn.modal-switch
  manualEntryButton: (page) => [
    page.locator('button.cf-new-btn.modal-switch'),
    page.getByRole('button', { name: '手入力' }),
    page.locator('button[href="#user_asset_act_new"], a[href="#user_asset_act_new"]'),
  ],
  // 手入力モーダル本体 — 校准 #1：実物は #user_asset_act_new
  modal: (page) => [
    page.locator('#user_asset_act_new'),
    page.locator('.modal.in, .modal.show'),
    page.locator('[role="dialog"]:visible'),
  ],
  // 支出ラジオ（校准 #1：タブではなく radio、class=minus-payment、既定で選択済み）
  expenseRadio: (modal) => [
    modal.locator('input.minus-payment'),
    modal.locator('label:has(input.minus-payment)'),
  ],
  // 日付入力 — 校准 #1：name="user_asset_act[updated_at]" / #updated-at
  dateInput: (modal) => [
    modal.locator('input[name="user_asset_act[updated_at]"]'),
    modal.locator('#updated-at'),
    modal.locator('input[name="transaction_date"]'),
    modal.locator('input[type="date"]'),
  ],
  // 支出金額入力 — 校准 #1：name="user_asset_act[amount]" / #appendedPrependedInput
  amountInput: (modal) => [
    modal.locator('input[name="user_asset_act[amount]"]'),
    modal.locator('#appendedPrependedInput'),
    modal.locator('input[name="amount"]'),
  ],
  // 支払元（口座）のネイティブ select — 校准 #1：name で精確に（.first() は振替用 hidden を掴む）
  accountSelect: (modal) => [
    modal.locator('select[name="user_asset_act[sub_account_id_hash]"]'),
    modal.locator('select[name="account_id"]'),
  ],
  // 支払元のカスタムドロップダウン（combobox）候補（最終フォールバック）
  accountCombo: (modal) => [
    modal.locator('[role="combobox"]').first(),
    modal.locator('.account-select, .js-account-select'),
  ],
  // 大分類の現在値表示（クリックでピッカーを開く）
  largeCategorySelected: (modal) => [
    modal.locator('#js-large-category-selected'),
    modal.locator('.js-large-category'),
    modal.locator('a, div, span').filter({ hasText: /未分類|食費|日用品|趣味・娯楽|交通費|衣服・美容|住宅/ }).first(),
  ],
  // 中分類の現在値表示
  middleCategorySelected: (modal) => [
    modal.locator('#js-middle-category-selected'),
    modal.locator('.js-middle-category'),
  ],
  // 大分類ドロップダウンメニュー（校准 #1：ul.dropdown-menu.main_menu、項目は a.l_c_name）
  largeCategoryMenu: (page) => [
    page.locator('ul.dropdown-menu.main_menu'),
    page.locator('.btn_l_ctg.open .dropdown-menu'),
  ],
  // 中分類ドロップダウンメニュー（校准 #1：ul.dropdown-menu.sub_menu、項目は a.m_c_name）
  middleCategoryMenu: (page) => [
    page.locator('ul.dropdown-menu.sub_menu'),
    page.locator('.btn_m_ctg.open .dropdown-menu'),
  ],
  // 内容（任意）入力 — 校准 #1：#js-content-field
  contentInput: (modal) => [
    modal.locator('#js-content-field'),
    modal.locator('input[name="user_asset_act[content]"]'),
    modal.getByPlaceholder('内容をご入力下さい(任意)'),
  ],
  // 保存ボタン — 校准 #1：#submit-button（input[type=submit] value=保存する）
  saveButton: (modal) => [
    modal.locator('#submit-button'),
    modal.getByRole('button', { name: '保存する' }),
    modal.locator('input[type="submit"]'),
  ],
  // 保存成功後に現れる「続けて入力する」 — 校准 #1：#confirmation-button
  continueButton: (page) => [
    page.locator('#confirmation-button'),
    page.getByRole('button', { name: '続けて入力する' }),
    page.locator('button, a, input[type="button"]').filter({ hasText: /続けて入力する/ }),
  ],
  // モーダルを閉じる — 校准 #1：header 内 div.close[data-dismiss="modal"]
  closeButton: (modal) => [
    modal.locator('[data-dismiss="modal"]'),
    modal.locator('.modal-header .close'),
    modal.getByRole('button', { name: '閉じる' }),
  ],
};

/* ================= 参数解析 ================= */
function parseArgs(argv) {
  const args = {
    entries: CONFIG.defaultEntries,
    status: 'ready',
    limit: Infinity,
    dryRun: false,
    headless: false,
    login: false,
    continueOnError: false,
    account: null,
    allowFixMisSaved: false,
    profile: CONFIG.defaultProfileDir,
    report: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--entries': args.entries = path.resolve(argv[++i]); break;
      case '--status': args.status = argv[++i]; break;
      case '--limit': args.limit = parseInt(argv[++i], 10); break;
      case '--report': args.report = path.resolve(argv[++i]); break;
      case '--profile': args.profile = path.resolve(argv[++i]); break;
      case '--dry-run': args.dryRun = true; break;
      case '--headless': args.headless = true; break;
      case '--login': args.login = true; break;
      case '--continue-on-error': args.continueOnError = true; break;
      case '--account': args.account = argv[++i]; break;
      case '--allow-fix-mis-saved': args.allowFixMisSaved = true; break;
      case '--help': case '-h':
        printUsage(); process.exit(0); break;
      default:
        console.error(`未知参数: ${a}`); printUsage(); process.exit(1);
    }
  }
  return args;
}

function printUsage() {
  console.log(`用法:
  node enter.mjs --login [--profile DIR]
      首次（或会话失效后）：有头打开浏览器，手动登录 Money Forward，登录后在终端按 Enter。
  node enter.mjs --entries PATH [选项]
      --status S          只处理 status == S 的条目（默认 ready）
      --limit N           最多处理 N 条
      --dry-run           只打开页面与表单并填好字段，不点保存（用于选择器校准）
      --headless          无头运行（默认有头，方便观察）
      --continue-on-error 某条校验失败时不停止、继续后续条目（默认停止）
      --report PATH       运行报告 JSON 路径（默认 reports/run-<时间>.json）
      --profile DIR       持久 profile 目录（默认 ./.mf-profile）
      --account NAME      支払元口座名（默认取台帳 JSON 的 account 字段，再无则 ANA Pay）
      --allow-fix-mis-saved  允许自动行内編集修正早期提交的误存条目（实验功能，默认关）`);
}

/* ================= 通用小工具 ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 调试日志（MF_ENTRY_DEBUG=1 时输出到 stderr；校准 #1 排查用，平时无输出）
const DEBUG = !!process.env.MF_ENTRY_DEBUG;
const DBG_T0 = Date.now();
function dlog(...args) {
  if (DEBUG) console.error(`[debug +${((Date.now() - DBG_T0) / 1000).toFixed(1)}s]`, ...args);
}

/** 在候选 locator 中返回第一个可见的；都不可见返回 null。 */
async function firstVisible(candidates, { timeout = 2500 } = {}) {
  // 校准 #1 修正：waitFor は複数マッチで strict mode violation になり即失敗する
  // （手入力ボタンはページに2個ある）。必ず .first() に対して待つこと。
  for (let i = 0; i < candidates.length; i++) {
    const first = candidates[i].first();
    try {
      await first.waitFor({ state: 'visible', timeout });
      return first;
    } catch (e) {
      dlog(`firstVisible candidate#${i} failed:`, String((e && e.message) || e).split('\n')[0]);
    }
  }
  return null;
}

/** 等待并断言：locator 必须在超时内可见，否则抛错（带上下文）。 */
async function mustVisible(candidates, what, timeout = 10000) {
  const loc = await firstVisible(candidates, { timeout });
  if (!loc) throw new Error(`找不到页面元素（需校准选择器）: ${what}`);
  return loc;
}

/** 从文本里抽出金额数字（"¥12,345" / "12,345円" → 12345）。找不到返回 null。 */
function parseYen(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ================= 浏览器与会话 ================= */
async function launchContext(profileDir, headless) {
  return chromium.launchPersistentContext(profileDir, {
    channel: 'chrome', // 用 Mac 上已安装的 Google Chrome，不下载 Playwright 自带 Chromium
    headless,
    viewport: CONFIG.viewport,
    locale: CONFIG.locale,
    timezoneId: CONFIG.timezoneId,
  });
}

/** 当前是否处于已登录状态（能看到家計簿 UI）。 */
async function isLoggedIn(page) {
  if (CONFIG.loginUrlPattern.test(page.url())) return false;
  const marker = await firstVisible(
    SEL.manualEntryButton(page).concat([
      page.locator('a, span, div').filter({ hasText: /^家計簿$/ }),
    ]),
    { timeout: 4000 },
  );
  return !!marker;
}

/** 打开家計簿并确认登录；未登录则抛 NeedsLogin。 */
class NeedsLogin extends Error {}
async function openLedger(page) {
  await page.goto(CONFIG.cfUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1500); // 等 SPA 渲染，随后用元素断言兜底
  if (!(await isLoggedIn(page))) {
    throw new NeedsLogin(
      'Money Forward 会话已失效或尚未登录。请先运行 `node enter.mjs --login` 手动登录后再重试。本脚本不会自动登录、也不保存任何凭据。',
    );
  }
}

/**
 * 在首页读取指定口座的余额。读不到返回 null（调用方降级为仅行校验）。
 * 首页「口座一覧」等区域里，找同时包含口座名与金额的最小容器。
 */
async function readBalance(page, accountName) {
  await page.goto(CONFIG.homeUrl, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  const nameLoc = page.getByText(accountName, { exact: false }).first();
  try {
    await nameLoc.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    return null;
  }
  // 从口座名元素向上找几层容器，取第一个带金额文本的
  for (let depth = 1; depth <= 6; depth++) {
    const container = nameLoc.locator(`xpath=ancestor::*[${depth}]`);
    const text = (await container.innerText().catch(() => '')) || '';
    if (text.includes(accountName)) {
      const yen = parseYen(text.replace(accountName, ''));
      if (yen !== null) return yen;
    }
  }
  return null;
}

/* ================= 家計簿リスト：月份导航与回读 ================= */
/** 读取列表当前显示的年月。校准 #1：/cf 日历视图的期间表头是「2026/10/1 - 2026/10/31」形式，优先按期间范围取起始年月；其次「2026年10月」；最后兜底「2026/10/01」。 */
async function currentListYearMonth(page) {
  const header = await page.locator('body').innerText().catch(() => '');
  const range = header.match(/(20\d{2})\/(\d{1,2})\/\d{1,2}\s*[-–−~〜]\s*(20\d{2})\/(\d{1,2})\/\d{1,2}/);
  if (range) return { year: parseInt(range[1], 10), month: parseInt(range[2], 10) };
  const m = header.match(/(20\d{2})年(\d{1,2})月/) || header.match(/(20\d{2})\/(\d{1,2})\/01/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

async function clickMonthPager(page, labels) {
  const btn = await firstVisible([
    ...labels.map((t) => page.getByRole('button', { name: t })),
    ...labels.map((t) => page.getByRole('link', { name: t })),
    ...labels.map((t) => page.locator('button, a').filter({ hasText: t })),
  ], { timeout: 2000 });
  if (!btn) return false;
  await btn.click();
  await sleep(1200);
  return true;
}

/** 把列表切到指定年月；切不过去就抛错（避免在错误的月份里录/查）。 */
async function gotoListMonth(page, year, month) {
  for (let i = 0; i < 30; i++) {
    const cur = await currentListYearMonth(page);
    if (!cur) throw new Error('无法读出家計簿列表当前月份（需校准月份表头选择器）');
    if (cur.year === year && cur.month === month) return;
    const curIdx = cur.year * 12 + cur.month;
    const tgtIdx = year * 12 + month;
    const ok = await clickMonthPager(page, tgtIdx < curIdx ? CONFIG.prevMonthLabels : CONFIG.nextMonthLabels);
    if (!ok) throw new Error('找不到前月/翌月切换按钮（需校准选择器）');
  }
  throw new Error(`月份导航超过上限仍未到达 ${year}-${month}`);
}

/**
 * 在当前列表里按「内容（商户名）」找条目行，返回行文本（找不到返回 null）。
 * 同一商户同月多条时，用金额二次确认。
 */
async function findEntryRowText(page, entry) {
  const hits = page.getByText(entry.merchant, { exact: false });
  const count = await hits.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = hits.nth(i);
    for (let depth = 1; depth <= 6; depth++) {
      const row = el.locator(`xpath=ancestor::*[${depth}]`);
      const text = (await row.innerText().catch(() => '')) || '';
      const flat = text.replace(/\s+/g, ' ');
      if (flat.includes(entry.merchant) && flat.replace(/,/g, '').includes(String(entry.amount))) {
        return flat;
      }
    }
  }
  return null;
}

/** 行文本里是否包含目标口座名与分类名（回读校验用，宽松匹配）。 */
function rowMatchesAccountCategory(rowText, accountName, category, sub) {
  if (!rowText) return { account: false, category: false, sub: !sub };
  return {
    account: rowText.includes(accountName),
    category: !category || rowText.includes(category),
    sub: !sub || rowText.includes(sub),
  };
}

/* ================= 手入力フォーム操作 ================= */
async function openEntryModal(page) {
  // 校准 #1：ページ描画が遅いとボタンが見つからないことがあるため、1回だけリロードして再試行
  let btn = await firstVisible(SEL.manualEntryButton(page), { timeout: 6000 });
  if (!btn) {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(2500);
    btn = await mustVisible(SEL.manualEntryButton(page), '手入力ボタン');
  }
  await btn.click();
  const modal = await mustVisible(SEL.modal(page), '手入力モーダル', 8000);
  // 校准 #1：支出/収入/振替はタブではなく radio。支出（minus-payment）が既定で選択済みのはずだが断言する
  const minus = modal.locator('input.minus-payment').first();
  if ((await minus.count().catch(() => 0)) > 0) {
    const checked = await minus.isChecked().catch(() => true);
    if (!checked) {
      const label = modal.locator('label:has(input.minus-payment)').first();
      if ((await label.count().catch(() => 0)) > 0) await label.click().catch(() => {});
      else await minus.click({ force: true }).catch(() => {});
      await sleep(300);
      if (!(await minus.isChecked().catch(() => false))) {
        throw new Error('支出ラジオを選択できませんでした（需校准）');
      }
    }
  }
  return modal;
}

async function closeModal(page, modal) {
  const btn = await firstVisible(SEL.closeButton(modal), { timeout: 1500 });
  if (btn) { await btn.click().catch(() => {}); await sleep(600); }
  else { await page.keyboard.press('Escape').catch(() => {}); await sleep(600); }
}

/**
 * 支払元口座を選ぶ：ネイティブ select 優先、無ければカスタムドロップダウン。
 * 校准 #1：弹窗内 name="user_asset_act[sub_account_id_hash]" の select は
 * 可視のものが正（振替用 _from/_to は別 name で hidden）。同名が複数あれば
 * 可視のものを選ぶ。選択後は実際に選ばれた option テキストで検証する。
 * option テキストは「<口座名> (12,345円)」のように残高を含むため前方一致で探す。
 */
async function selectAccount(modal, accountName) {
  for (const cands of SEL.accountSelect(modal)) {
    const all = cands;
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const sel = all.nth(i);
      if (!(await sel.isVisible().catch(() => false))) continue;
      const options = await sel.locator('option').allInnerTexts().catch(() => []);
      const target = options.find((t) => t.includes(accountName));
      if (!target) continue;
      await sel.selectOption({ label: target });
      const chosen = await sel.evaluate((el) => (el.options[el.selectedIndex]?.text || '')).catch(() => '');
      if (!chosen.includes(accountName)) {
        throw new Error(`口座選択の検証に失敗: 期待 ${accountName} を含む / 実際 ${chosen}`);
      }
      return chosen.trim();
    }
  }
  const combo = await firstVisible(SEL.accountCombo(modal), { timeout: 2000 });
  if (combo) {
    await combo.click();
    await sleep(400);
    const opt = await firstVisible([
      modal.page().getByRole('option', { name: new RegExp(accountName) }),
      modal.page().locator('li, div, span').filter({ hasText: accountName }),
    ], { timeout: 3000 });
    if (opt) {
      const label = (await opt.innerText().catch(() => accountName)).trim();
      await opt.click();
      return label;
    }
  }
  throw new Error(`支払元口座「${accountName}」を選択できませんでした（需校准口座選択）`);
}

/**
 * 開いたドロップダウンメニュー内でのみ項目をクリックする（校准 #1）。
 * ページ全体をテキスト検索すると一覧行や絞り込み select の同名カテゴリを
 * 誤ってクリックするため、必ずメニュー要素にスコープする。
 * 完全一致 → 部分一致（双方向）→ 共通部分文字列が最長の候補、の順。
 * @returns {Promise<{text:string, exact:boolean}|null>} 実際にクリックした項目
 */
async function clickMenuItem(menu, itemSelector, name) {
  if (!name) return null;
  const items = menu.locator(itemSelector);
  const n = await items.count().catch(() => 0);
  const texts = [];
  for (let i = 0; i < n; i++) {
    texts.push(((await items.nth(i).innerText().catch(() => '')) || '').trim());
  }
  const commonLen = (a, b) => {
    let best = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j <= a.length; j++) {
        if (b.includes(a.slice(i, j))) best = Math.max(best, j - i);
      }
    }
    return best;
  };
  let idx = texts.findIndex((t) => t === name);
  const exact = idx >= 0;
  if (idx < 0) {
    idx = texts.findIndex((t) => t && (t.includes(name) || name.includes(t)));
  }
  if (idx < 0) {
    let bestScore = 0;
    texts.forEach((t, i) => {
      if (!t) return;
      const s = commonLen(name, t);
      if (s > bestScore) { bestScore = s; idx = i; }
    });
    if (bestScore < 1) idx = -1;
  }
  if (idx < 0) return null;
  await items.nth(idx).click();
  await sleep(400);
  return { text: texts[idx], exact };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 現在表示されている大分類/中分類のテキストを読む（取得できなければ ''）。 */
async function readSelectedCategories(modal) {
  const read = async (cands) => {
    const el = await firstVisible(cands, { timeout: 1200 });
    return el ? (await el.innerText().catch(() => '')).trim() : '';
  };
  return {
    large: await read(SEL.largeCategorySelected(modal)),
    middle: await read(SEL.middleCategorySelected(modal)),
  };
}

/**
 * 分類ピッカーで大分類→中分類を選ぶ。
 * - 中分類が選択肢に無い場合：最も近い候補（部分一致）を試み、最終的に
 *   実際に表示されている値を actual として返す（呼び出し側が報告に残す）。
 * - 既知の坑：中分類操作中にモーダルが閉じる（＝早期提交）ことがある。
 *   ここでは検知だけ行い、例外 EarlySubmit を投げる（修正は呼び出し側）。
 */
class EarlySubmit extends Error {}
async function pickCategories(page, modal, entry) {
  if (!entry.category) return readSelectedCategories(modal);
  // 大分類：トグルを開き、main_menu 内の a.l_c_name をクリック（校准 #1）
  const largeEl = await mustVisible(SEL.largeCategorySelected(modal), '大分類ピッカー');
  await largeEl.click();
  await sleep(500);
  const mainMenu = await mustVisible(SEL.largeCategoryMenu(page), '大分類メニュー', 5000);
  const largeHit = await clickMenuItem(mainMenu, 'a.l_c_name', entry.category);
  if (!largeHit) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error(`大分類の選択肢に「${entry.category}」がありません`);
  }
  // 中分類：大分類を選ぶと中分類トグルは「その他<大分類>」に自動設定される。
  // 指定があれば中分類トグルを開き、sub_menu 内の a.m_c_name をクリック。
  if (entry.sub) {
    const midEl = await firstVisible(SEL.middleCategorySelected(modal), { timeout: 2000 });
    if (midEl) {
      await midEl.click();
      await sleep(500);
      const subMenu = await firstVisible(SEL.middleCategoryMenu(page), { timeout: 3000 });
      if (subMenu) {
        const midHit = await clickMenuItem(subMenu, 'a.m_c_name', entry.sub);
        if (!midHit) {
          // 中分類候補が無い：メニューを閉じてデフォルト（その他〜）のままにする（actual で報告）
          await page.keyboard.press('Escape').catch(() => {});
        }
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
  }
  // 早期提交の検知：モーダルが消えていないか
  const stillOpen = await firstVisible(SEL.modal(page), { timeout: 800 });
  if (!stillOpen) throw new EarlySubmit('中分類操作中にモーダルが閉じました（早期提交の可能性）');
  return readSelectedCategories(modal);
}

/** フォームに一通りの値を入れる。順序は坑回避のため：口座→分類→内容→金額→日付。 */
async function fillForm(page, modal, entry, accountName) {
  const accountLabel = await selectAccount(modal, accountName);
  const actualCats = await pickCategories(page, modal, entry);

  const content = await mustVisible(SEL.contentInput(modal), '内容入力欄');
  await content.fill(entry.merchant);

  const amount = await mustVisible(SEL.amountInput(modal), '支出金額入力欄');
  await amount.fill(String(entry.amount));
  const amountBack = parseYen(await amount.inputValue());
  if (amountBack !== entry.amount) throw new Error(`金額が正しく入力できませんでした: ${await amount.inputValue()}`);

  const date = await mustVisible(SEL.dateInput(modal), '日付入力欄');
  const mfDate = entry.date.replace(/-/g, '/');
  await date.fill(mfDate);
  await page.keyboard.press('Tab').catch(() => {});
  const dateBack = (await date.inputValue().catch(() => '')).replace(/-/g, '/');
  if (!dateBack.includes(mfDate)) {
    throw new Error(`日付が正しく入力できませんでした: 期待 ${mfDate} / 実際 ${dateBack}`);
  }
  return { accountLabel, actualCats };
}

/**
 * 早期提交で误存された条目を探して行内編集で直す（試录時の手動復旧と同じ手順）。
 * 見つからない/直せない場合は false。対象は「本日の日付・同額・同口座」の条目。
 */
async function fixMisSavedEntry(page, entry, accountName) {
  try {
    await gotoListMonth(page, new Date().getFullYear(), new Date().getMonth() + 1);
    const rowText = await findEntryRowText(page, entry);
    if (!rowText) return false;
    // 行の編集ボタンを押してモーダル（編集モード）を開く
    const hit = page.getByText(entry.merchant, { exact: false }).first();
    const row = hit.locator('xpath=ancestor::*[self::tr or contains(@class,"row")][1]');
    const editBtn = await firstVisible([
      row.getByRole('button', { name: /編集/ }),
      row.locator('a, button').filter({ hasText: /編集/ }),
      row.locator('[class*="edit"], [title*="編集"]'),
    ], { timeout: 3000 });
    if (!editBtn) { await hit.click().catch(() => {}); }
    else await editBtn.click();
    const modal = await mustVisible(SEL.modal(page), '編集モーダル', 8000);
    // 日付を正す
    const date = await mustVisible(SEL.dateInput(modal), '日付入力欄（編集）');
    await date.fill(entry.date.replace(/-/g, '/'));
    await page.keyboard.press('Tab').catch(() => {});
    // 中分類を正す（指定がある場合のみ）
    if (entry.sub) await pickCategories(page, modal, entry).catch(() => {});
    const save = await mustVisible(SEL.saveButton(modal), '保存ボタン（編集）');
    await save.click();
    await sleep(1500);
    return true;
  } catch {
    return false;
  }
}

/* ================= 一条分の処理 ================= */
/**
 * @returns {Promise<{status:'entered'|'skipped-duplicate'|'failed'|'dry-run', ...}>}
 */
async function processEntry(page, entry, accountName, ctx) {
  const [y, m] = entry.date.split('-').map(Number);
  const result = {
    date: entry.date, merchant: entry.merchant, amount: entry.amount,
    intendedCategory: entry.category || '', intendedSub: entry.sub || '',
    actualCategory: '', actualSub: '', status: 'failed', note: '',
    balanceBefore: ctx.balance, balanceAfter: null,
  };

  // 防重复：先在该月列表里查同日・同額・同内容の既存行
  await gotoListMonth(page, y, m);
  const existing = await findEntryRowText(page, entry);
  if (existing) {
    result.status = 'skipped-duplicate';
    result.note = `一覧に既存行あり: ${existing.slice(0, 120)}`;
    return result;
  }

  const modal = await openEntryModal(page);
  let filled;
  try {
    filled = await fillForm(page, modal, entry, accountName);
    result.actualCategory = filled.actualCats.large || entry.category;
    result.actualSub = filled.actualCats.middle || '';
  } catch (e) {
    if (e instanceof EarlySubmit) {
      // 中分類操作中に提交されてしまった
      if (!ctx.allowFixMisSaved) {
        result.note = '早期提交が発生しました。自動修正は既定で無効です（--allow-fix-mis-saved で有効化、実験機能）。MF を目視確認してください。';
        return result;
      }
      const fixed = await fixMisSavedEntry(page, entry, accountName);
      if (!fixed) {
        result.note = '早期提交が発生し、误存条目を特定/修正できませんでした。MF を目視確認してください。';
        return result;
      }
      result.note = '早期提交が発生しましたが、误存条目を行内編集で修正しました。';
      // この後は通常の回読校验に進む（モーダルは閉じている前提）
      return verifyEntered(page, entry, accountName, ctx, result);
    }
    await closeModal(page, modal).catch(() => {});
    throw e;
  }

  if (ctx.dryRun) {
    result.status = 'dry-run';
    result.note = 'dry-run：フォーム入力まで完了、保存していません。';
    await closeModal(page, modal);
    return result;
  }

  // 保存
  const save = await mustVisible(SEL.saveButton(modal), '保存するボタン');
  await save.click();
  const success = await firstVisible(SEL.continueButton(page), { timeout: 8000 });
  const modalGone = !(await firstVisible(SEL.modal(page), { timeout: 1500 }));
  if (!success && !modalGone) {
    result.note = '保存後の成功表示（続けて入力する等）を確認できませんでした。';
    return result;
  }
  if (success) await closeModal(page, modal).catch(() => {});

  return verifyEntered(page, entry, accountName, ctx, result);
}

/** 保存後の回読校验：リスト行の存在・口座・分類 + 残高の減少額。 */
async function verifyEntered(page, entry, accountName, ctx, result) {
  const [y, m] = entry.date.split('-').map(Number);
  await page.goto(CONFIG.cfUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  await gotoListMonth(page, y, m);
  const rowText = await findEntryRowText(page, entry);
  if (!rowText) {
    result.status = 'failed';
    result.note = '保存後に一覧で条目行を確認できませんでした。';
    return result;
  }
  const match = rowMatchesAccountCategory(rowText, accountName, entry.category, entry.sub);
  result.actualCategory = result.actualCategory || (match.category ? entry.category : '');
  if (!match.account) {
    result.status = 'failed';
    result.note = `行は見つかりましたが口座名が一致しません: ${rowText.slice(0, 120)}`;
    return result;
  }
  // 残高校验（読めた場合のみ・最大3回読み直す）
  if (ctx.balance !== null && ctx.balance !== undefined) {
    let after = null;
    for (let i = 0; i < 3; i++) {
      after = await readBalance(page, accountName);
      if (after === ctx.balance - entry.amount) break;
      await sleep(3000);
    }
    result.balanceAfter = after;
    if (after !== ctx.balance - entry.amount) {
      result.status = 'failed';
      result.note = `残高の変化が一致しません: 前 ${ctx.balance} / 期待 ${ctx.balance - entry.amount} / 実際 ${after}`;
      return result;
    }
    ctx.balance = after;
    // 校验後に家計簿へ戻る
    await page.goto(CONFIG.cfUrl, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
  }
  result.status = 'entered';
  return result;
}

/* ================= 台帳の読み書き ================= */
function loadEntries(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.entries)) throw new Error(`台帳の形式が不正です: ${file}`);
  return data;
}

function saveEntries(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/* ================= --login モード ================= */
async function loginMode(args) {
  console.log('有头模式でブラウザを開きます。Money Forward に手動でログインしてください。');
  console.log('（MF ID のメール+ワンタイムコード、または Apple ログイン。認証情報は保存されません）');
  const context = await launchContext(args.profile, false);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(CONFIG.cfUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((res) => rl.question('ログインが完了したら Enter を押してください… ', res));
  rl.close();
  const ok = await isLoggedIn(page).catch(() => false);
  await context.close();
  if (!ok) {
    console.error('ログイン状態を確認できませんでした。もう一度 --login を実行してください。');
    process.exit(2);
  }
  console.log('ログインセッションを保存しました（profile: ' + args.profile + '）。次回から enter.mjs が再利用します。');
  process.exit(0);
}

/* ================= main ================= */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.login) return loginMode(args);

  const data = loadEntries(args.entries);
  const accountName = args.account || data.account || 'ANA Pay';
  const targets = data.entries
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e.status === args.status)
    .slice(0, args.limit === Infinity ? undefined : args.limit);

  const report = {
    startedAt: new Date().toISOString(),
    entriesFile: args.entries,
    account: accountName,
    statusFilter: args.status,
    dryRun: args.dryRun,
    startBalance: null,
    endBalance: null,
    results: [],
  };
  const reportPath = args.report || path.join(
    SCRIPT_DIR, 'reports',
    `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );

  if (targets.length === 0) {
    console.log(`処理対象なし（status=${args.status} の条目がありません）。`);
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`報告: ${reportPath}`);
    return;
  }

  const context = await launchContext(args.profile, args.headless);
  const page = context.pages()[0] ?? (await context.newPage());
  let exitCode = 0;
  try {
    await openLedger(page);
    const startBalance = await readBalance(page, accountName);
    report.startBalance = startBalance;
    if (startBalance === null) {
      console.warn(`警告: ${accountName} の残高を読み取れませんでした。残高校验なし（行校验のみ）で続行します。`);
    } else {
      console.log(`開始残高 ${accountName}: ${startBalance}`);
    }
    await page.goto(CONFIG.cfUrl, { waitUntil: 'domcontentloaded' });
    await sleep(1200);

    const ctx = { balance: startBalance, dryRun: args.dryRun, allowFixMisSaved: args.allowFixMisSaved };
    for (const { e, idx } of targets) {
      console.log(`\n▶ ${e.date} ${e.merchant} ¥${e.amount}（${e.category || '分類未定'}${e.sub ? '・' + e.sub : ''}）`);
      let r;
      try {
        r = await processEntry(page, e, accountName, ctx);
      } catch (err) {
        r = {
          date: e.date, merchant: e.merchant, amount: e.amount,
          intendedCategory: e.category || '', intendedSub: e.sub || '',
          actualCategory: '', actualSub: '', status: 'failed',
          note: `例外: ${err.message}`, balanceBefore: ctx.balance, balanceAfter: null,
        };
      }
      console.log(`  → ${r.status}${r.note ? ' / ' + r.note : ''}`);
      report.results.push(r);

      if (r.status === 'entered' && !args.dryRun) {
        // 台帳へ即時回写（一件ごとに保存し、中断しても再開可能に）
        data.entries[idx].status = 'entered';
        data.entries[idx].enteredAt = new Date().toISOString();
        data.entries[idx].verification = {
          actualCategory: r.actualCategory, actualSub: r.actualSub,
          balanceBefore: r.balanceBefore, balanceAfter: r.balanceAfter,
        };
        saveEntries(args.entries, data);
      }
      if (r.status === 'failed' && !args.continueOnError) {
        console.error('校验に失敗したため停止します（--continue-on-error で継続可能）。');
        exitCode = 3;
        break;
      }
    }
    report.endBalance = ctx.balance;
  } catch (e) {
    if (e instanceof NeedsLogin) {
      console.error('エラー: ' + e.message);
      exitCode = 2;
    } else {
      console.error('エラー: ' + e.message);
      exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n報告: ${reportPath}`);
    await context.close().catch(() => {});
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('致命的エラー: ' + (e && e.stack || e));
  process.exit(1);
});
