/************************************************************************
 * 入札にゃん Ver3 - 市場分析サマリー（品目別 市場活性度）
 * ---------------------------------------------------------------------
 * 「市場分析マスター」(生データ) を集計して、品目カテゴリ×集計期間ごとに
 * 「この市場は活きてるか / 狙い目か」を見える化する。
 *
 * 使い方: buildMarketSummary() を実行するだけ。
 *   → 「市場分析サマリー」シートを毎回作り直して結果を書き出す。
 *   ※ 市場分析マスター(生データ)と同じプロジェクトに置いてね
 *     （MA_COLS / maCol などの定義を共有して使うため）
 ************************************************************************/

const MS_CONFIG = {
  MASTER_SHEET: '市場分析マスター',   // 生データ（落札実績）
  SUMMARY_SHEET: '市場分析サマリー',  // 集計結果（このファイルが作る）
  PERIODS: [
    { label: '直近30日',  days: 30 },
    { label: '直近90日',  days: 90 },
    { label: '直近365日', days: 365 },
    { label: '全期間',    days: null },
  ],
  // 集計対象にする最小案件数（これ未満の品目×期間は行を出さない）
  MIN_CASES: 1,
};

// サマリーシートの列（にゃんちゃん仕様）
const MS_COLS = [
  '品目カテゴリ', '集計期間', '案件数', '落札企業数', 'TOP落札企業',
  'TOP企業落札件数', 'TOP企業シェア', '平均落札金額', '最終公告日', '最終開札日',
  '入札参加者数入力済み件数', '平均入札参加者数', '1社入札率',
  '市場活性度', '競争偏り度', '狙い目度', '備考',
];

/* 品目キーワード → カテゴリ（上から順に判定、最初にヒットしたものを採用）
 * 翠ちゃんのターゲット品目に寄せてある。増やしたければここに足すだけ。 */
const ITEM_CATEGORY_RULES = [
  { cat: '保存水',     kw: ['保存水', '備蓄水', 'ミネラルウォーター', '飲料水'] },
  { cat: '防災食',     kw: ['アルファ米', '防災食', '非常食', '備蓄食', '保存食'] },
  { cat: '印刷',       kw: ['ポスター', 'チラシ', '冊子', '印刷', 'パンフレット', 'リーフレット', '封筒'] },
  { cat: '紙類',       kw: ['トイレットペーパー', 'ティッシュ', 'ペーパータオル'] },
  { cat: 'ノベルティ', kw: ['マグネット', 'キーホルダー', 'ノベルティ', 'クリアファイル', 'うちわ', 'ぬいぐるみ', 'マスコット'] },
  { cat: '防災用品',   kw: ['毛布', '寝袋', '防災', '避難', '救助', 'ヘルメット', '担架'] },
  { cat: '事務用品',   kw: ['文具', '事務用品', '事務消耗品', '消耗品', 'ファイル', 'トナー'] },
];

// カテゴリ判定：既存カテゴリ列があればそれ、無ければ件名キーワードで仮分類
function classifyItem(category, name) {
  if (category && String(category).trim()) return String(category).trim();
  const t = String(name || '');
  for (let i = 0; i < ITEM_CATEGORY_RULES.length; i++) {
    const rule = ITEM_CATEGORY_RULES[i];
    if (rule.kw.some(function (k) { return t.indexOf(k) >= 0; })) {
      return rule.cat + '(推定)';
    }
  }
  return '未分類';
}

/* =========================================================
 * メイン：市場分析サマリーを生成
 * =======================================================*/
function buildMarketSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = ss.getSheetByName(MS_CONFIG.MASTER_SHEET);
  if (!master) throw new Error('先に「市場分析マスター」を作って落札実績を入れてね');
  const lastRow = master.getLastRow();
  if (lastRow < 2) throw new Error('市場分析マスターにデータが無いよ');

  const vals = master.getRange(2, 1, lastRow - 1, MA_COLS.length).getValues();
  const ci = {
    no:      maCol('調達案件番号') - 1,
    name:    maCol('案件名') - 1,
    cat:     maCol('品目カテゴリ') - 1,
    open:    maCol('開札日') - 1,
    cft:     maCol('公告日') - 1,
    company: maCol('落札会社') - 1,
    price:   maCol('落札金額') - 1,
    part:    maCol('入札参加者数') - 1,
  };

  // 生データを正規化
  const rows = vals.map(function (v) {
    const partRaw = v[ci.part];
    return {
      no:       String(v[ci.no] || ''),
      name:     v[ci.name] || '',
      category: classifyItem(v[ci.cat], v[ci.name]),
      company:  String(v[ci.company] || '').trim(),
      price:    Number(v[ci.price]) || 0,
      open:     _msDate(v[ci.open]),
      cft:      _msDate(v[ci.cft]),
      part:     (partRaw === '' || partRaw == null || isNaN(Number(partRaw))) ? null : Number(partRaw),
    };
  });

  // 全品目を収集（品目→期間の順で並べたいので先にカテゴリ一覧を作る）
  const catSet = {};
  rows.forEach(function (r) { catSet[r.category] = true; });
  const cats = Object.keys(catSet).sort();

  const today = new Date();
  const out = [];
  cats.forEach(function (cat) {
    MS_CONFIG.PERIODS.forEach(function (p) {
      const since = p.days ? new Date(today.getTime() - p.days * 86400000) : null;
      const rs = rows.filter(function (r) {
        if (r.category !== cat) return false;
        if (since && (!r.open || r.open < since)) return false;
        return true;
      });
      // 案件数（ユニーク案件番号）で足切り
      const caseNos = {};
      rs.forEach(function (r) { if (r.no) caseNos[r.no] = true; });
      if (Object.keys(caseNos).length < MS_CONFIG.MIN_CASES) return;
      out.push(_aggregate(cat, p.label, rs));
    });
  });

  // 書き出し（毎回作り直し）
  let sh = ss.getSheetByName(MS_CONFIG.SUMMARY_SHEET);
  if (!sh) sh = ss.insertSheet(MS_CONFIG.SUMMARY_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, MS_COLS.length).setValues([MS_COLS])
    .setFontWeight('bold').setBackground('#1b5e20').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, MS_COLS.length).setValues(out);

  Logger.log('市場分析サマリー生成 → ' + out.length + '行');
  return out.length;
}

/* =========================================================
 * 1品目×1期間ぶんの集計 → 1行の配列を返す
 * =======================================================*/
function _aggregate(cat, periodLabel, rs) {
  const caseNos = {};       // ユニーク案件番号
  const companyCount = {};  // 会社 → 落札件数
  let priceSum = 0, priceN = 0;
  let maxOpen = null, maxCft = null;
  let partFilled = 0, partSum = 0, oneBidCount = 0;
  let totalBids = 0;

  rs.forEach(function (r) {
    if (r.no) caseNos[r.no] = true;
    if (r.company) {
      companyCount[r.company] = (companyCount[r.company] || 0) + 1;
      totalBids++;
    }
    if (r.price > 0) { priceSum += r.price; priceN++; }
    if (r.open && (!maxOpen || r.open > maxOpen)) maxOpen = r.open;
    if (r.cft && (!maxCft || r.cft > maxCft)) maxCft = r.cft;
    if (r.part != null) {
      partFilled++; partSum += r.part;
      if (r.part === 1) oneBidCount++;
    }
  });

  const caseCount = Object.keys(caseNos).length;
  const companies = Object.keys(companyCount);
  const companyCnt = companies.length;

  // TOP企業
  let topCompany = '', topCount = 0;
  companies.forEach(function (c) {
    if (companyCount[c] > topCount) { topCount = companyCount[c]; topCompany = c; }
  });
  const topShare = totalBids ? topCount / totalBids : 0;

  const avgPrice = priceN ? Math.round(priceSum / priceN) : 0;
  const avgPart = partFilled ? Math.round(partSum / partFilled * 10) / 10 : '';
  const oneBidRate = partFilled ? oneBidCount / partFilled : null;

  return [
    cat, periodLabel, caseCount, companyCnt, topCompany,
    topCount, _msPct(topShare), avgPrice,
    maxCft ? _msFmt(maxCft) : '', maxOpen ? _msFmt(maxOpen) : '',
    partFilled, avgPart, (oneBidRate == null ? '' : _msPct(oneBidRate)),
    _activityLabel(caseCount, companyCnt, topShare),
    _biasLabel(topShare),
    _targetStars(caseCount, companyCnt, topShare, avgPart, oneBidRate),
    _note(caseCount, companyCnt, topCompany, topShare, partFilled),
  ];
}

/* =========================================================
 * スコア/ラベル（仮ロジック：実データ見ながら調整OK）
 * =======================================================*/
// 市場活性度：案件が多く・企業が多く・偏りが小さいほど「高」
function _activityLabel(cases, companies, topShare) {
  let s = 0;
  if (cases >= 20) s += 3; else if (cases >= 10) s += 2; else if (cases >= 5) s += 1;
  if (companies >= 10) s += 3; else if (companies >= 5) s += 2; else if (companies >= 3) s += 1;
  if (topShare < 0.3) s += 2; else if (topShare < 0.5) s += 1; else if (topShare >= 0.7) s -= 1;
  if (s >= 6) return '高';
  if (s >= 3) return '中';
  return '低';
}

// 競争偏り度：TOP企業シェアの高さ＝特定企業への集中
function _biasLabel(topShare) {
  const p = Math.round(topShare * 100);
  if (topShare >= 0.7) return '寡占(' + p + '%)';
  if (topShare >= 0.4) return 'やや偏り(' + p + '%)';
  return '分散(' + p + '%)';
}

// 狙い目度：加点/減点して★1〜5に（仮スコア）
function _targetStars(cases, companies, topShare, avgPart, oneBidRate) {
  let s = 0;
  // 案件数
  if (cases >= 10) s += 2; else if (cases >= 5) s += 1; else if (cases < 3) s -= 1;
  // 落札企業数
  if (companies >= 5) s += 2; else if (companies >= 3) s += 1;
  // TOP企業シェア（低いほど入りやすい）
  if (topShare < 0.3) s += 2; else if (topShare < 0.5) s += 1; else if (topShare >= 0.7) s -= 2;
  // 入札参加者数（入力があれば）：少ないほど加点
  if (avgPart !== '' && !isNaN(avgPart)) {
    if (avgPart <= 2) s += 1; else if (avgPart >= 5) s -= 1;
  }
  // 1社入札率（高い＝競合が薄い）
  if (oneBidRate != null && oneBidRate >= 0.5) s += 1;

  // s の想定レンジ（約 -4〜+8）を 1〜5 に寄せる
  let stars = Math.round((s + 3) / 2);
  stars = Math.max(1, Math.min(5, stars));
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

// 備考：ひと目で市場感がわかる自動コメント
function _note(cases, companies, top, topShare, partFilled) {
  let n = cases + '案件 / ' + companies + '社が落札';
  if (topShare >= 0.7 && top) n += ' / ' + top + 'がほぼ独占';
  else if (companies >= 5 && topShare < 0.4) n += ' / 分散型、参入余地あり';
  if (partFilled === 0) n += ' / 入札者数は未入力';
  return n;
}

/* =========================================================
 * ユーティリティ（ms接頭辞で他ファイルと衝突回避）
 * =======================================================*/
function _msDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const m = String(s).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function _msFmt(d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); }
function _msPct(x) { return Math.round(x * 100) + '%'; }

/************************************************************************
 * 【通知強化】市場分析ルックアップ
 * ---------------------------------------------------------------------
 * 新着案件の件名・カテゴリから品目を判定し、市場分析サマリーを引いて
 * 通知用の「📊 市場分析」ブロックのテキストを組み立てる。
 *
 * 使い方（次回、既存の通知生成に差し込むイメージ）:
 *   const idx = getMarketIndex();                       // 通知ループの前に1回
 *   const block = buildMarketBlockFast(idx, 件名, 品目カテゴリ);  // 各案件で
 *   // block を既存の通知テキストに挿入するだけ
 ************************************************************************/

/* 市場分析サマリーを読んで {品目カテゴリ: {集計期間: {...}}} のインデックス化 */
function getMarketIndex() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MS_CONFIG.SUMMARY_SHEET);
  const index = {};
  if (!sh || sh.getLastRow() < 2) return index;

  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, MS_COLS.length).getValues();
  const c = {};
  MS_COLS.forEach(function (name, i) { c[name] = i; });

  vals.forEach(function (r) {
    const cat = String(r[c['品目カテゴリ']] || '');
    const period = String(r[c['集計期間']] || '');
    if (!cat || !period) return;
    (index[cat] = index[cat] || {})[period] = {
      cases:      r[c['案件数']],
      companies:  r[c['落札企業数']],
      topCompany: r[c['TOP落札企業']],
      topShare:   r[c['TOP企業シェア']], // "11%" の文字列
      avgPrice:   r[c['平均落札金額']],
      activity:   r[c['市場活性度']],
      bias:       r[c['競争偏り度']],
      target:     r[c['狙い目度']],       // "★★★★★"
    };
  });
  return index;
}

/* TOP企業シェアを 0.5 でも "50%" でも受けて、0〜100の整数(%)に正規化 */
function _sharePct(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (s.indexOf('%') >= 0) return parseInt(s.replace('%', ''), 10) || 0; // "50%"
  const n = Number(s);
  if (isNaN(n)) return null;
  return (n <= 1) ? Math.round(n * 100) : Math.round(n); // 0.5→50, 50→50
}

/* TOP企業シェア(%)から市場タイプ名を決める */
function _marketType(share) {
  const p = _sharePct(share);
  if (p == null) return '-';
  if (p >= 70) return '寡占市場';
  if (p >= 40) return '準寡占市場';
  return '開放市場';
}

/* 表示用に品目名の "(推定)" を外す */
function _displayCat(cat) {
  return String(cat).replace(/\(推定\)$/, '');
}

/* 案件1件ぶんの「📊 市場分析」ブロックを返す（index使い回し版・推奨）
 *   name     : 案件名（件名）
 *   category : 品目カテゴリ（生データに値があれば渡す。無ければ ''）
 * 市場データが無い品目（未分類など）は空文字を返す＝通知にブロックを出さない */
function buildMarketBlockFast(index, name, category) {
  const cat = classifyItem(category, name);
  if (cat === '未分類' || !index[cat]) return '';

  const p90 = index[cat]['直近90日'];
  const base = p90 || index[cat]['直近365日'] || index[cat]['全期間'];
  if (!base) return '';

  const disp = _displayCat(cat);
  const cases90 = p90 ? p90.cases : 0;
  const note = p90 ? '' : '（市場感は全期間ベース）';
  const sharePct = _sharePct(base.topShare);

  let block = '📊 市場分析\n';
  block += '品目：' + disp + '\n';
  block += '直近90日：' + cases90 + '件\n';
  block += 'TOP企業シェア：' + (sharePct == null ? '-' : sharePct + '%') + '\n';
  block += '市場タイプ：' + _marketType(base.topShare) + '\n';
  block += '狙い目度：' + (base.target || '-');
  if (note) block += '\n' + note;
  return block;
}

/* 単体版（1件だけ手軽に確認したいとき。内部でサマリーを読む） */
function buildMarketBlock(name, category) {
  return buildMarketBlockFast(getMarketIndex(), name, category);
}

/* 動作確認用 */
function testMarketBlock() {
  Logger.log('--- 保存水 ---\n' + buildMarketBlock('〇〇市 保存水購入', ''));
  Logger.log('--- 印刷 ---\n'   + buildMarketBlock('封筒印刷 一式', ''));
  Logger.log('--- 事務用品 ---\n' + buildMarketBlock('コピー用紙外 事務消耗品', ''));
}



// ============================================================
// 診断専用：市場分析マスターから印刷関連の落札実績を検索
// ============================================================
// 読み取り専用。何も変更しません。
// 案件名に印刷関連キーワードを含む行を抽出してログに出します。

var PRINT_SEARCH_KEYWORDS = [
  'パンフレット', 'リーフレット', 'ポスター', 'チラシ', '冊子',
  '印刷', '広報誌', '広報紙', 'カタログ'
];

function searchPrintRelatedAwards() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('市場分析マスター');
  if (!sheet) { Logger.log('市場分析マスターが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var nameCol = headers.indexOf('案件名');
  if (nameCol === -1) { Logger.log('「案件名」列が見つかりません'); return; }

  Logger.log('全データ行数: ' + (lastRow - 1));

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var matched = [];

  data.forEach(function(row) {
    var title = String(row[nameCol] || '');
    var hit = PRINT_SEARCH_KEYWORDS.some(function(kw) { return title.indexOf(kw) !== -1; });
    if (hit) matched.push(row);
  });

  Logger.log('=== 印刷関連キーワードにヒットした件数: ' + matched.length + '件 ===');
  Logger.log('');

  // キーワード別の内訳
  var byKeyword = {};
  matched.forEach(function(row) {
    var title = String(row[nameCol] || '');
    PRINT_SEARCH_KEYWORDS.forEach(function(kw) {
      if (title.indexOf(kw) !== -1) {
        byKeyword[kw] = (byKeyword[kw] || 0) + 1;
      }
    });
  });
  Logger.log('【キーワード別内訳】');
  Object.keys(byKeyword).forEach(function(kw) {
    Logger.log('  ' + kw + '：' + byKeyword[kw] + '件');
  });

  Logger.log('');
  Logger.log('【該当案件（最大30件まで表示）】');
  matched.slice(0, 30).forEach(function(row, i) {
    Logger.log((i + 1) + '. ' + row.join(' / '));
  });

  if (matched.length > 30) {
    Logger.log('… 他 ' + (matched.length - 30) + '件（全件はスプレッドシート上で直接確認してください）');
  }
}