/************************************************************************
 * 入札にゃん Ver3 - 市場分析マスター（Phase1）
 * ---------------------------------------------------------------------
 * 目的: 「過去、この市場では誰が勝っているのか」を可視化する土台。
 *
 * このファイルでできること:
 *   1. 「市場分析マスター」シートの初期化（Phase2用の列も先に確保）
 *   2. 調達ポータル 落札実績オープンデータ（CSV/zip）の取り込み
 *   3. KKJ案件情報の取り込み（New Data連携）
 *   4. 案件名／発注機関／開札日での照合 → 落札会社・落札金額を書き戻し
 *
 * ★セットアップで1箇所だけ要設定 → RAKUSATSU_BASE_URL（下のCONFIG参照）
 ************************************************************************/

/* =========================================================
 * CONFIG（ここだけ翠ちゃんが設定してね）
 * =======================================================*/
const MA_CONFIG = {
  SHEET_NAME: '市場分析マスター',

  // ★要設定★ 落札実績zipのダウンロードURLの「ファイル名の直前まで」。
  //   調達ポータルのDLページ（UAB02/OAB0201）で、ファイル名リンクを
  //   右クリック →「リンクのアドレスをコピー」して、
  //   末尾の successful_bid_record_info_xxx.zip を除いた部分をここに貼る。
  //   例）'https://www.p-portal.go.jp/pps-web-biz/xxxxx/'（末尾スラッシュ込み）
  RAKUSATSU_BASE_URL: 'https://www.p-portal.go.jp/pps-web-biz/【ここを実URLに差し替え】/',

  // 照合の許容日数（落札決定日と開札日のズレ何日まで同一案件とみなすか）
  MATCH_DATE_TOLERANCE_DAYS: 21,
};

/* =========================================================
 * 市場分析マスターの列定義（Phase1 + Phase2用の空き列）
 * =======================================================*/
const MA_COLS = [
  '調達案件番号',   // 1  A
  '案件名',         // 2  B
  '発注機関',       // 3  C
  '品目カテゴリ',   // 4  D  ← KKJ側から
  '公告日',         // 5  E  ← KKJ側から
  '開札日',         // 6  F  ← 落札実績の「落札決定日」
  '落札会社',       // 7  G
  '落札金額',       // 8  H
  '落札率',         // 9  I  ← 現状オープンデータに無し（空欄）
  '入札参加者数',   // 10 J  ← 現状オープンデータに無し（空欄）
  '納期',           // 11 K  ← 仕様書から取得できた場合
  '入札方式',       // 12 L
  '法人番号',       // 13 M
  'データ取得元',   // 14 N  ← KKJ / 調達ポータル(diff_YYYYMMDD 等)
  '取得元URL',      // 15 O
  '照合ステータス', // 16 P  ← 照合済 / 落札のみ / 案件のみ
  '登録日時',       // 17 Q
  '更新日時',       // 18 R
  // --- ここから Phase2 で使う列（今回は空欄で確保）---
  '会社分類',       // 19 S
  '得意分野',       // 20 T
  '会社URL',        // 21 U
  'AI分析コメント', // 22 V
  '最終分析日',     // 23 W
];

// 列名 → 1始まりの列番号 を引くヘルパ
function maCol(name) {
  const i = MA_COLS.indexOf(name);
  if (i < 0) throw new Error('未定義の列名: ' + name);
  return i + 1;
}

/* =========================================================
 * 府省コード → 名称（落札実績仕様 v令和8年3月 準拠）
 * =======================================================*/
const MINISTRY_CODE_MAP = {
  A1: '衆議院', B1: '参議院', C1: '国立国会図書館', D1: '最高裁判所',
  E1: '会計検査院', F1: '人事院', F2: '国家公務員倫理審査会',
  G1: '内閣官房', H1: '内閣法制局', I1: '安全保障会議',
  J1: '内閣府', J2: '宮内庁', J3: '公正取引委員会', J4: '国家公安委員会',
  J5: '警察庁', J6: '金融庁', J7: '消費者庁', J8: '個人情報保護委員会',
  J9: 'カジノ管理委員会',
  K1: '総務省', K2: '公害等調整委員会', K3: '消防庁',
  L1: '法務省', L2: '検察庁', L3: '公安審査委員会', L4: '公安調査庁',
  M1: '外務省', N1: '財務省', N2: '国税庁',
  O1: '文部科学省', O2: '文化庁', O3: 'スポーツ庁',
  P1: '厚生労働省', P2: '中央労働委員会',
  Q1: '農林水産省', Q2: '林野庁', Q3: '水産庁',
  R1: '経済産業省', R2: '資源エネルギー庁', R3: '特許庁', R4: '中小企業庁',
  S1: '国土交通省', S2: '運輸安全委員会', S3: '観光庁', S4: '気象庁',
  S5: '海上保安庁',
  T1: '環境省', T2: '原子力安全庁',
  U1: '防衛省', V1: '復興庁', W1: 'デジタル庁',
  JA: 'こども家庭庁', JB: 'サイバー通信情報監理委員会',
};

/* =========================================================
 * 入札方式コード → 名称
 * =======================================================*/
const BIDDING_METHOD_MAP = {
  '8002010': '一般競争入札・最低価格',
  '8002020': '一般競争入札・最高価格',
  '8002040': '一般競争入札・総合評価',
  '8002050': '一般競争入札・複数落札',
  '8003010': '指名競争入札・最低価格',
  '8003020': '指名競争入札・最高価格',
  '8003040': '指名競争入札・総合評価',
  '8003050': '指名競争入札・複数落札',
  '8004025': '随意契約方式・複数業者',
  '8001010': '随意契約方式・オープンカウンタ',
  '8004020': '随意契約方式・特定業者',
  '8004030': '随意契約方式・公募型プロポーザル方式',
  '8014025': '随意契約方式・複数業者・少額',
  '8011010': '随意契約方式・オープンカウンタ・少額',
  '8014020': '随意契約方式・特定業者・少額',
  '8014030': '随意契約方式・公募型プロポーザル方式・少額',
};

/* =========================================================
 * 1. シート初期化
 * =======================================================*/
function setupMarketAnalysisSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(MA_CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(MA_CONFIG.SHEET_NAME);

  sh.getRange(1, 1, 1, MA_COLS.length).setValues([MA_COLS])
    .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, MA_COLS.length).setHorizontalAlignment('center');
  Logger.log('市場分析マスターを初期化したよ🐈 列数: ' + MA_COLS.length);
  return sh;
}

/* =========================================================
 * 2. 落札実績オープンデータの取得（zip → CSV → オブジェクト配列）
 *    type: 'diff'（YYYYMMDD） / 'all'（YYYY）
 * =======================================================*/
function fetchRakusatsuOpenData(key, type) {
  const fileName = (type === 'all')
    ? 'successful_bid_record_info_all_' + key + '.zip'
    : 'successful_bid_record_info_diff_' + key + '.zip';
  const url = MA_CONFIG.RAKUSATSU_BASE_URL + fileName;

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('取得スキップ(' + code + '): ' + fileName);
    return [];
  }
  const recs = _parseRakusatsuZipBlob(res.getBlob(),
    (type === 'all' ? 'all_' + key : 'diff_' + key), url);
  Logger.log(fileName + ' → ' + recs.length + '件');
  return recs;
}

/* --- ★フォールバック★ Driveにアップしたzipから読む ---
 * 直リンク自動取得が使えないとき用。手順はこれだけ：
 *   1. ブラウザで落札実績zipをダウンロード（ファイル名をクリック）
 *   2. そのzipをGoogleドライブにアップロード（解凍しなくてOK）
 *   3. ファイルを右クリック →「リンクをコピー」
 *      → URLの /d/ と /view の間がファイルID（例: 1A2b3C...xyz）
 *   4. importRakusatsuFromDrive('そのファイルID') を実行 */
function importRakusatsuFromDrive(fileId) {
  const file = DriveApp.getFileById(fileId);
  const label = file.getName().replace(/\.zip$/i, '');
  const recs = _parseRakusatsuZipBlob(file.getBlob(), label, 'drive:' + fileId);
  Logger.log(file.getName() + ' → ' + recs.length + '件');
  return upsertRakusatsuRecords(recs);
}

/* --- ★おすすめ★ フォルダ内のzipを全部まとめて取り込む ---
 * 「システム管理／過去データ」フォルダに年度別zipを全部入れて、
 * このフォルダのIDを1回渡すだけで、中の全zipがマスターに入る。
 *   フォルダID: Driveでフォルダを開いたとき、URL末尾
 *   .../folders/【★ここがフォルダID★】 の部分。
 * 取り込み後に照合まで自動で走らせるよ。 */
function importRakusatsuFromFolder(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles(); // 全ファイルを走査（MIMEタイプに依存しない）
  let total = { added: 0, updated: 0, fileCount: 0 };
  while (files.hasNext()) {
    const f = files.next();
    if (!/\.zip$/i.test(f.getName())) continue; // ファイル名が .zip のものだけ対象
    const r = importRakusatsuFromDrive(f.getId());
    total.added += r.added;
    total.updated += r.updated;
    total.fileCount++;
    Utilities.sleep(300); // サーバ/シート負荷を考えて小休止
  }
  Logger.log('フォルダ取り込み完了 → ' + total.fileCount + 'ファイル / 追加'
    + total.added + ' / 更新' + total.updated);
  matchKkjWithRakusatsu(); // まとめ取り込みの後に照合も実行
  return total;
}

/* zip Blob → レコード配列（URL取得でもDrive取得でも共通のパース処理） */
function _parseRakusatsuZipBlob(zipBlob, sourceLabel, sourceUrl) {
  const files = Utilities.unzip(zipBlob); // zip内にCSVが入っている想定
  const records = [];
  files.forEach(function (blob) {
    let text = blob.getDataAsString('UTF-8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM除去
    if (!text.trim()) return;

    // ヘッダ無し・ダブルクォート囲み・カンマ区切り
    const rows = Utilities.parseCsv(text);
    rows.forEach(function (r) {
      if (!r || r.length < 7) return;
      records.push({
        procurementNo: (r[0] || '').trim(),   // 調達案件番号
        name:          (r[1] || '').trim(),   // 調達案件名称
        bidDate:       (r[2] || '').trim(),   // 落札決定日 YYYY-MM-DD
        price:         parseFloat(r[3]) || 0, // 落札価格
        ministry:      MINISTRY_CODE_MAP[(r[4] || '').trim()] || (r[4] || '').trim(),
        method:        BIDDING_METHOD_MAP[(r[5] || '').trim()] || (r[5] || '').trim(),
        company:       (r[6] || '').trim(),   // 商号又は名称
        corpNo:        (r[7] || '').trim(),   // 法人番号
        source:        sourceLabel,
        sourceUrl:     sourceUrl,
      });
    });
  });
  return records;
}

/* =========================================================
 * 3. 落札実績を市場分析マスターへ upsert
 *    キー = 調達案件番号 ＋ 落札会社（複数落札でも各社を別行で保持）
 * =======================================================*/
function upsertRakusatsuRecords(records) {
  if (!records.length) return { added: 0, updated: 0 };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MA_CONFIG.SHEET_NAME);
  const lastRow = sh.getLastRow();
  const cNo = maCol('調達案件番号') - 1;
  const cCo = maCol('落札会社') - 1;

  // 既存の「調達案件番号|落札会社」→ 行番号 のインデックス
  const idx = {};
  if (lastRow >= 2) {
    const vals = sh.getRange(2, 1, lastRow - 1, MA_COLS.length).getValues();
    vals.forEach(function (v, i) {
      if (v[cNo]) idx[v[cNo] + '|' + v[cCo]] = i + 2;
    });
  }

  const now = new Date();
  let added = 0, updated = 0;
  const newRows = [];
  const batchSeen = {}; // 同一バッチ内の重複よけ（-1マーカーは使わない）

  records.forEach(function (rec) {
    if (!rec.procurementNo) return;
    const key = rec.procurementNo + '|' + rec.company;
    const row = idx[key];
    if (row && row > 0) {
      // 既存行 → 落札系フィールドを更新（会社はキーなので不変）
      sh.getRange(row, maCol('落札金額')).setValue(rec.price);
      sh.getRange(row, maCol('開札日')).setValue(rec.bidDate);
      sh.getRange(row, maCol('入札方式')).setValue(rec.method);
      sh.getRange(row, maCol('法人番号')).setValue(rec.corpNo);
      sh.getRange(row, maCol('更新日時')).setValue(now);
      updated++;
    } else if (batchSeen[key]) {
      return; // このバッチで既に追加済み → スキップ
    } else {
      const arr = new Array(MA_COLS.length).fill('');
      arr[maCol('調達案件番号') - 1] = rec.procurementNo;
      arr[maCol('案件名') - 1]       = rec.name;
      arr[maCol('発注機関') - 1]     = rec.ministry;
      arr[maCol('開札日') - 1]       = rec.bidDate;
      arr[maCol('落札会社') - 1]     = rec.company;
      arr[maCol('落札金額') - 1]     = rec.price;
      arr[maCol('入札方式') - 1]     = rec.method;
      arr[maCol('法人番号') - 1]     = rec.corpNo;
      arr[maCol('データ取得元') - 1] = rec.source;
      arr[maCol('取得元URL') - 1]    = rec.sourceUrl;
      arr[maCol('照合ステータス') - 1] = '落札のみ';
      arr[maCol('登録日時') - 1]     = now;
      arr[maCol('更新日時') - 1]     = now;
      newRows.push(arr);
      batchSeen[key] = true;
      added++;
    }
  });

  if (newRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, MA_COLS.length).setValues(newRows);
  }
  Logger.log('落札実績 upsert → 追加' + added + ' / 更新' + updated);
  return { added: added, updated: updated };
}

/* =========================================================
 * 4-a. 差分1日分を取り込み（YYYYMMDD）
 * =======================================================*/
function importRakusatsuDiff(yyyymmdd) {
  const recs = fetchRakusatsuOpenData(yyyymmdd, 'diff');
  return upsertRakusatsuRecords(recs);
}

/* 4-b. 年度の全件を取り込み（YYYY）＝初期ロード用 */
function importRakusatsuAll(year) {
  const recs = fetchRakusatsuOpenData(String(year), 'all');
  return upsertRakusatsuRecords(recs);
}

/* 4-c. 毎日トリガー用：前日の差分を取り込む */
function dailyImportRakusatsu() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const ymd = Utilities.formatDate(y, 'Asia/Tokyo', 'yyyyMMdd');
  const r = importRakusatsuDiff(ymd);
  matchKkjWithRakusatsu(); // 取り込み後に照合も走らせる
  return r;
}

/* 4-d. 期間の差分をまとめて取り込み（初期の穴埋め等）
 *      fromYmd / toYmd は 'YYYYMMDD' 文字列 */
function importRakusatsuRange(fromYmd, toYmd) {
  const from = _ymdToDate(fromYmd), to = _ymdToDate(toYmd);
  let total = { added: 0, updated: 0 };
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const ymd = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd');
    const r = importRakusatsuDiff(ymd);
    total.added += r.added; total.updated += r.updated;
    Utilities.sleep(500); // サーバ負荷を考慮して小休止
  }
  Logger.log('期間取り込み完了 → 追加' + total.added + ' / 更新' + total.updated);
  return total;
}

/* =========================================================
 * 5. KKJ案件情報の取り込み（New Data連携）
 * ---------------------------------------------------------
 * New Data側の案件配列を渡すと、市場分析マスターに「案件のみ」行として保存。
 * 各要素は下記キーを持つオブジェクトにして渡してね（マッピングは調整可）:
 *   { caseId, name, org, category, cftDate, openDate, url }
 *     caseId   : KKJのKey（案件ID）
 *     name     : 案件名（ProjectName）
 *     org      : 発注機関（OrganizationName）
 *     category : 品目カテゴリ
 *     cftDate  : 公告日（CftIssueDate）
 *     openDate : 開札日（OpeningTendersEvent）
 *     url      : 取得元URL（ExternalDocumentURI）
 * =======================================================*/
function importKkjCasesToMaster(cases) {
  if (!cases || !cases.length) return { added: 0, skipped: 0 };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MA_CONFIG.SHEET_NAME);
  const lastRow = sh.getLastRow();

  // 既存のKKJ案件ID（取得元=KKJ の行）をキーにインデックス
  const seen = {};
  if (lastRow >= 2) {
    const rng = sh.getRange(2, 1, lastRow - 1, MA_COLS.length).getValues();
    rng.forEach(function (r) {
      if (r[maCol('データ取得元') - 1] === 'KKJ') {
        seen[String(r[maCol('調達案件番号') - 1])] = true;
      }
    });
  }

  const now = new Date();
  let added = 0, skipped = 0;
  const newRows = [];
  cases.forEach(function (c) {
    if (!c.caseId || seen[String(c.caseId)]) { skipped++; return; }
    const arr = new Array(MA_COLS.length).fill('');
    arr[maCol('調達案件番号') - 1] = c.caseId;
    arr[maCol('案件名') - 1]       = c.name || '';
    arr[maCol('発注機関') - 1]     = c.org || '';
    arr[maCol('品目カテゴリ') - 1] = c.category || '';
    arr[maCol('公告日') - 1]       = c.cftDate || '';
    arr[maCol('開札日') - 1]       = c.openDate || '';
    arr[maCol('データ取得元') - 1] = 'KKJ';
    arr[maCol('取得元URL') - 1]    = c.url || '';
    arr[maCol('照合ステータス') - 1] = '案件のみ';
    arr[maCol('登録日時') - 1]     = now;
    arr[maCol('更新日時') - 1]     = now;
    newRows.push(arr);
    seen[String(c.caseId)] = true;
    added++;
  });
  if (newRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, MA_COLS.length).setValues(newRows);
  }
  Logger.log('KKJ案件取り込み → 追加' + added + ' / スキップ' + skipped);
  return { added: added, skipped: skipped };
}

/* =========================================================
 * 6. 照合: KKJ案件（案件のみ）× 落札実績（落札のみ）
 *    キー: 正規化案件名 ＋ 開札日±許容日数 ＋ 発注機関の緩い一致
 *    マッチしたらKKJ行に落札会社・落札金額を書き戻し「照合済」に更新。
 * =======================================================*/
function matchKkjWithRakusatsu() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MA_CONFIG.SHEET_NAME);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { matched: 0 };

  const data = sh.getRange(2, 1, lastRow - 1, MA_COLS.length).getValues();
  const cName = maCol('案件名') - 1, cOrg = maCol('発注機関') - 1;
  const cOpen = maCol('開札日') - 1, cCompany = maCol('落札会社') - 1;
  const cPrice = maCol('落札金額') - 1, cStatus = maCol('照合ステータス') - 1;

  // 落札実績（落札のみ）行を正規化名でインデックス
  const bids = [];
  data.forEach(function (r, i) {
    if (r[cStatus] === '落札のみ') {
      bids.push({
        rowIdx: i, key: _normalizeName(r[cName]),
        date: _parseDate(r[cOpen]), org: _normalizeName(r[cOrg]),
        company: r[cCompany], price: r[cPrice],
      });
    }
  });

  const tol = MA_CONFIG.MATCH_DATE_TOLERANCE_DAYS;
  const now = new Date();
  let matched = 0;

  data.forEach(function (r, i) {
    if (r[cStatus] !== '案件のみ') return;
    const kName = _normalizeName(r[cName]);
    const kDate = _parseDate(r[cOpen]);
    const kOrg  = _normalizeName(r[cOrg]);
    if (!kName) return;

    const hit = bids.find(function (b) {
      if (!b.key) return false;
      const nameOk = (b.key === kName) || (b.key.indexOf(kName) >= 0) || (kName.indexOf(b.key) >= 0);
      if (!nameOk) return false;
      // 発注機関: 府省名がKKJ機関名に含まれる等の緩い一致（片方空なら日付で救う）
      const orgOk = !kOrg || !b.org || kOrg.indexOf(b.org) >= 0 || b.org.indexOf(kOrg) >= 0;
      // 日付: 両方あれば許容日数以内、片方でも欠ければ名前一致で通す
      let dateOk = true;
      if (kDate && b.date) dateOk = Math.abs(kDate - b.date) <= tol * 86400000;
      return orgOk && dateOk;
    });

    if (hit) {
      const row = i + 2;
      sh.getRange(row, cCompany + 1).setValue(hit.company);
      sh.getRange(row, cPrice + 1).setValue(hit.price);
      sh.getRange(row, cStatus + 1).setValue('照合済');
      sh.getRange(row, maCol('更新日時')).setValue(now);
      // 落札実績側も照合済にして二重カウントを避ける
      sh.getRange(hit.rowIdx + 2, cStatus + 1).setValue('照合済');
      matched++;
    }
  });
  Logger.log('照合完了 → ' + matched + '件マッチ');
  return { matched: matched };
}

/* =========================================================
 * ユーティリティ
 * =======================================================*/
// 案件名・機関名の正規化（全半角統一・空白/記号/法人格除去）
function _normalizeName(s) {
  if (s == null) return '';
  let t = String(s).normalize('NFKC').toLowerCase();
  t = t.replace(/株式会社|有限会社|合同会社|合名会社|合資会社|（株）|\(株\)|㈱|（有）|\(有\)|㈲/g, '');
  t = t.replace(/[\s　]/g, '');                 // 空白（全角含む）
  t = t.replace(/[、。・,\.\-—―ー－_（）\(\)\[\]「」【】]/g, ''); // 記号
  return t;
}

function _parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s.getTime();
  const m = String(s).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

function _ymdToDate(ymd) {
  const s = String(ymd);
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}

/* =========================================================
 * 動作確認用まとめ実行（初回セットアップ）
 * =======================================================*/
function ma_firstRunExample() {
  setupMarketAnalysisSheet();
  // 例）今年度の全件を初期ロード（RAKUSATSU_BASE_URL 設定後に）
  // importRakusatsuAll(2026);
  // 例）過去2週間の差分を穴埋め
  // importRakusatsuRange('20260619', '20260703');
  // 照合
  // matchKkjWithRakusatsu();
}


function testFolderImport() {
  importRakusatsuFromFolder('1fQqw7kffhCp3US9Mx5C8RxjEebHFoM1I');
}