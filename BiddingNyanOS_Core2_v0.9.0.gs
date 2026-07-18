/**
 * =====================================================================
 *  入札にゃんOS - Core
 *  正式案件ID発番 / 取得元管理（1案件N取得元）/ 重複判定
 * ---------------------------------------------------------------------
 *  ■ 設計思想（ここが背骨）
 *    - 案件マスターが唯一の親テーブル。案件IDが全データの主キー。
 *    - 原価計算 / 仕入先 / 市場価格 / 見積比較 / 提出書類 / 実績 は
 *      各シートに情報をコピーせず、案件IDから「参照」する構造へ育てる。
 *    - 外部（NewData / Briefing / Manual / GAS / 将来API）からの入口は
 *      intakeProject() ただ一つ。正式案件IDはここでしか発番しない。
 *    - 正式案件ID = YYYY-MM-NNN（月次連番）。一度振ったら不変。
 *
 *  ■ 重複判定（確実 → 要確認 の順）
 *    ① 発注機関案件番号キー（機関＋公告/案件番号）一致 → 確実 → 自動マージ
 *    ② URL正規化一致                                → 確実 → 自動マージ
 *    ③ 機関＋件名＋締切キー一致                      → ⚠️要確認マージ
 *    （将来）④ AIによる類似判定 … findSimilarByAI_() のフックを用意
 *
 *  ■ 開発フェーズ（迷子防止の章立て）
 *    Phase0：案件ID発番・取得元・重複判定の土台        … 実装済み
 *    Phase1：情報源マスター育成 / NewData強化           … 次ここ
 *    Phase2：市場価格DB・仕入先候補・見積比較（参照方式）
 *    Phase3：原価計算・提出書類自動生成・実績・PWA
 * =====================================================================
 */

const NYAN_VERSION = "0.9.0";


/* =====================================================================
 *  [Phase2.3] 案件JSONスキーマ v1
 *  JSONを唯一の正本とし、Web画面・スプレッドシート・見積書は
 *  この構造から描画／登録する。キー名は原則として今後変更しない。
 * ===================================================================== */
const NYAN_CASE_SCHEMA_VERSION = '1.0.0';

const NYAN_CASE_TEMPLATE = {
  schemaVersion: NYAN_CASE_SCHEMA_VERSION,
  caseId: '',
  status: 'draft',

  title: '',
  summary: '',
  agency: '',
  category: '',
  qualification: '',

  items: [
    {
      name: '',
      specification: '',
      quantity: '',
      unit: ''
    }
  ],

  submission: {
    deadline: '',
    method: '',
    destination: '',
    email: '',
    url: ''
  },

  delivery: {
    date: '',
    place: '',
    method: ''
  },

  equivalentProduct: {
    allowed: null,
    note: '資料に記載なし・要確認'
  },

  attachments: [],

  source: {
    originalFileName: '',
    originalFileId: '',
    ocrTextFileId: '',
    jsonFileId: '',
    historyFileId: '',
    logFileId: '',
    folderId: '',
    folderUrl: '',
    subfolderIds: {}
  },

  extraction: {
    ocrEngine: 'Google Drive OCR',
    ocrVersion: '2.3',
    extractedAt: '',
    warnings: []
  },

  audit: {
    createdAt: '',
    updatedAt: ''
  }
};

/** 空の案件JSONを返す。テンプレート本体は変更しない。 */
function createEmptyCaseJson_() {
  const data = JSON.parse(JSON.stringify(NYAN_CASE_TEMPLATE));
  const now = new Date().toISOString();
  data.audit.createdAt = now;
  data.audit.updatedAt = now;
  return data;
}

/**
 * OCR等の既存データを案件JSON v1へ安全に寄せる。
 * 未知のキーは捨てず raw に保持し、移行時の情報欠落を防ぐ。
 */
function normalizeCaseJson_(input) {
  input = input || {};
  const out = createEmptyCaseJson_();

  out.caseId       = String(input.caseId || '').trim();
  out.status       = String(input.status || 'draft').trim();
  out.title        = String(input.title || input.projectName || '').trim();
  out.summary      = String(input.summary || input.overview || '').trim();
  out.agency       = String(input.agency || input.organization || input.org || '').trim();
  out.category     = String(input.category || '').trim();
  out.qualification= String(input.qualification || '').trim();

  const srcItems = Array.isArray(input.items) ? input.items : [];
  out.items = srcItems.length ? srcItems.map(function(item){
    item = item || {};
    return {
      name: String(item.name || item.itemName || '').trim(),
      specification: String(item.specification || item.spec || '').trim(),
      quantity: item.quantity == null ? '' : item.quantity,
      unit: String(item.unit || '').trim()
    };
  }) : JSON.parse(JSON.stringify(NYAN_CASE_TEMPLATE.items));

  const sub = input.submission || {};
  out.submission.deadline    = String(sub.deadline || input.deadline || '').trim();
  out.submission.method      = String(sub.method || input.submissionMethod || '').trim();
  out.submission.destination = String(sub.destination || input.submissionDestination || '').trim();
  out.submission.email       = String(sub.email || input.submissionEmail || '').trim();
  out.submission.url         = String(sub.url || input.url || '').trim();

  const del = input.delivery || {};
  out.delivery.date   = String(del.date || input.deliveryDate || '').trim();
  out.delivery.place  = String(del.place || input.deliveryPlace || '').trim();
  out.delivery.method = String(del.method || input.deliveryMethod || '').trim();

  const eq = input.equivalentProduct || {};
  if (typeof eq === 'string') {
    out.equivalentProduct.note = eq.trim();
  } else {
    out.equivalentProduct.allowed = typeof eq.allowed === 'boolean' ? eq.allowed : null;
    out.equivalentProduct.note = String(eq.note || input.equivalentProductNote || out.equivalentProduct.note).trim();
  }

  out.attachments = Array.isArray(input.attachments) ? input.attachments.map(function(a){
    if (typeof a === 'string') return { type:'other', name:a, fileId:'', url:'' };
    a = a || {};
    return {
      type: String(a.type || 'other').trim(),
      name: String(a.name || a.fileName || '').trim(),
      fileId: String(a.fileId || '').trim(),
      url: String(a.url || '').trim()
    };
  }) : [];

  const source = input.source || {};
  Object.keys(out.source).forEach(function(k){
    if (k === 'subfolderIds') {
      out.source.subfolderIds = source.subfolderIds && typeof source.subfolderIds === 'object'
        ? JSON.parse(JSON.stringify(source.subfolderIds)) : {};
    } else {
      out.source[k] = String(source[k] || input[k] || '').trim();
    }
  });

  const extraction = input.extraction || {};
  out.extraction.ocrEngine = String(extraction.ocrEngine || out.extraction.ocrEngine).trim();
  out.extraction.ocrVersion = String(extraction.ocrVersion || input.ocrVersion || out.extraction.ocrVersion).trim();
  out.extraction.extractedAt = String(extraction.extractedAt || input.extractedAt || '').trim();
  out.extraction.warnings = Array.isArray(extraction.warnings) ? extraction.warnings : [];

  const audit = input.audit || {};
  out.audit.createdAt = String(audit.createdAt || input.createdAt || out.audit.createdAt).trim();
  out.audit.updatedAt = new Date().toISOString();

  out.raw = input.raw || {};
  return out;
}

/** 最低限の必須項目を検査。保存自体は止めず、警告一覧を返す。 */
function validateCaseJson_(data) {
  const warnings = [];
  if (!data || typeof data !== 'object') return ['案件JSONがオブジェクトではありません'];
  if (!data.title) warnings.push('正式案件名が空です');
  if (!data.agency) warnings.push('発注元が空です');
  if (!data.submission || !data.submission.deadline) warnings.push('提出期限が空です');
  if (!Array.isArray(data.items) || !data.items.length || !data.items[0].name) warnings.push('品目名が空です');
  if (!data.delivery || !data.delivery.place) warnings.push('納品場所が空です');
  return warnings;
}

/** Phase2.3のスキーマ単体テスト。 */
function testCaseJsonSchema() {
  const sample = normalizeCaseJson_({
    title: '角2封筒 2,000枚',
    org: '九州地方整備局 北九州港湾・空港整備事務所',
    category: '印刷',
    qualification: '全省庁統一資格',
    items: [{ name:'封筒', spec:'角2 クラフト85kg 〒枠あり センター貼り 黒1色', quantity:2000, unit:'枚' }],
    deadline: '令和8年7月16日 9:30',
    submissionEmail: 'kitakyu-e89gv@mlit.go.jp',
    deliveryPlace: '指定場所',
    attachments: ['仕様書', '別紙', '内訳書', '見積依頼書']
  });
  sample.extraction.warnings = validateCaseJson_(sample);
  Logger.log(JSON.stringify(sample, null, 2));
  return sample;
}


/* =====================================================================
 *  [Phase2.3] OCR抽出結果 → 案件JSON → 案件マスター 接続
 *
 *  既存OCR側は、抽出結果オブジェクトをこの入口へ渡すだけでよい。
 *  PDF/OCR固有のキー名はここで吸収し、以降は固定JSONだけを扱う。
 * ===================================================================== */

/**
 * OCR抽出結果を案件JSON v1へ変換する。
 * fileMeta = { fileId, fileName, fileUrl, ocrTextFileId, folderId }
 */
function buildCaseJsonFromOcrResult_(ocrResult, fileMeta) {
  ocrResult = ocrResult || {};
  fileMeta = fileMeta || {};

  const itemName = ocrResult.itemName || ocrResult.productName ||
    (ocrResult.items && ocrResult.items[0] && (ocrResult.items[0].name || ocrResult.items[0].itemName)) || '';
  const specification = ocrResult.specification || ocrResult.spec || ocrResult.standard ||
    (ocrResult.items && ocrResult.items[0] && (ocrResult.items[0].specification || ocrResult.items[0].spec)) || '';
  const quantity = ocrResult.quantity != null ? ocrResult.quantity :
    (ocrResult.items && ocrResult.items[0] ? ocrResult.items[0].quantity : '');
  const unit = ocrResult.unit ||
    (ocrResult.items && ocrResult.items[0] && ocrResult.items[0].unit) || '';

  const input = {
    title: ocrResult.title || ocrResult.projectName || ocrResult.caseName || '',
    summary: ocrResult.summary || ocrResult.overview || '',
    agency: ocrResult.agency || ocrResult.organization || ocrResult.org || '',
    category: ocrResult.category || '',
    qualification: ocrResult.qualification || ocrResult.eligibility || '',
    items: (Array.isArray(ocrResult.items) && ocrResult.items.length)
      ? ocrResult.items.map(function(item) {
          item = item || {};
          return {
            name: item.name || item.itemName || '',
            specification: item.specification || item.spec || '',
            quantity: item.quantity != null ? item.quantity : '',
            unit: item.unit || ''
          };
        })
      : [{
          name: itemName,
          specification: specification,
          quantity: quantity,
          unit: unit
        }],
    submission: {
      deadline: ocrResult.submissionDeadline || ocrResult.deadline || '',
      method: ocrResult.submissionMethod || '',
      destination: ocrResult.submissionDestination || ocrResult.destination || '',
      email: ocrResult.submissionEmail || ocrResult.email || '',
      url: ocrResult.url || ocrResult.sourceUrl || ''
    },
    delivery: {
      date: ocrResult.deliveryDate || ocrResult.deliveryDeadline || '',
      place: ocrResult.deliveryPlace || '',
      method: ocrResult.deliveryMethod || ''
    },
    equivalentProduct: ocrResult.equivalentProduct || {
      allowed: typeof ocrResult.equivalentAllowed === 'boolean' ? ocrResult.equivalentAllowed : null,
      note: ocrResult.equivalentProductNote || '資料に記載なし・要確認'
    },
    attachments: ocrResult.attachments || [],
    source: {
      originalFileName: fileMeta.fileName || ocrResult.originalFileName || '',
      originalFileId: fileMeta.fileId || ocrResult.originalFileId || '',
      ocrTextFileId: fileMeta.ocrTextFileId || ocrResult.ocrTextFileId || '',
      jsonFileId: '',
      historyFileId: '',
      logFileId: '',
      folderId: fileMeta.folderId || ocrResult.folderId || '',
      folderUrl: '',
      subfolderIds: {}
    },
    extraction: {
      ocrEngine: ocrResult.ocrEngine || 'Google Drive OCR',
      ocrVersion: ocrResult.ocrVersion || '2.3',
      extractedAt: ocrResult.extractedAt || new Date().toISOString(),
      warnings: []
    },
    raw: ocrResult
  };

  const data = normalizeCaseJson_(input);
  data.extraction.warnings = validateCaseJson_(data);
  return data;
}

/**
 * 固定案件JSONを、既存の唯一入口 intakeProject() が受け取る payload に変換する。
 * OCR・CSV・手入力など、将来どの入力元でもこの関数を共通利用する。
 */
function caseJsonToPayload_(caseJson, sourceOverride) {
  const data = normalizeCaseJson_(caseJson);
  const source = String(sourceOverride || 'OCR').trim() || 'OCR';
  const sourceId = data.source.originalFileId || data.source.ocrTextFileId ||
    data.source.originalFileName ||
    (source + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'));

  const item = data.items && data.items.length ? data.items[0] : null;
  const itemSummary = item ? [
    item.name || '',
    item.specification || '',
    item.quantity !== '' && item.quantity != null ? item.quantity : '',
    item.unit || ''
  ].filter(String).join(' / ') : '';

  return {
    source: source,
    sourceId: String(sourceId),
    title: data.title,
    agency: data.agency,
    noticeNo: data.raw && (data.raw.noticeNo || data.raw.noticeNumber) || '',
    agencyNo: data.raw && (data.raw.agencyNo || data.raw.agencyNumber) || '',
    contractNo: data.raw && (data.raw.contractNo || data.raw.contractNumber) || '',
    url: data.submission.url,
    deadline: data.submission.deadline,
    note: data.summary || itemSummary
  };
}

/**
 * 案件JSONを既存の唯一入口 intakeProject() へ渡して登録する。
 * 戻り値のprojectIdと案件フォルダ情報をJSONへ反映する。
 */
function registerCaseJsonToProject_(caseJson, sourceOverride, assetMeta) {
  const data = normalizeCaseJson_(caseJson);
  const payload = caseJsonToPayload_(data, sourceOverride);
  const result = intakeProject(payload);

  data.caseId = result.projectId;
  if (result.folderId) data.source.folderId = result.folderId;
  if (result.folderUrl) data.source.folderUrl = result.folderUrl;
  data.audit.updatedAt = new Date().toISOString();

  try {
    const saved = saveCaseAssets_(data, assetMeta || {});
    data.source = saved.source;
    result.folderId = data.source.folderId;
    result.folderUrl = data.source.folderUrl;
    result.savedFiles = saved.savedFiles;
    return { caseJson: data, payload: payload, registration: result };
  } catch (e) {
    if (result.isNew) rollbackNewProject_(result.projectId, payload.source, payload.sourceId, result.folderId);
    throw new Error('案件資産の保存に失敗したため、新規登録を取り消しました: ' + e.message);
  }
}

/**
 * OCR側から呼ぶ正式な接続入口。
 * OCR抽出結果 → 固定JSON → 案件マスター登録までを一括実行する。
 */
function processOcrResultToProject_(ocrResult, fileMeta) {
  fileMeta = fileMeta || {};
  const caseJson = buildCaseJsonFromOcrResult_(ocrResult, fileMeta);
  return registerCaseJsonToProject_(caseJson, 'OCR', {
    originalFileId: fileMeta.fileId || caseJson.source.originalFileId || '',
    originalFileName: fileMeta.fileName || caseJson.source.originalFileName || '',
    originalBlob: fileMeta.originalBlob || null,
    ocrText: fileMeta.ocrText || ocrResult.ocrText || ocrResult.fullText || ocrResult.rawText || '',
    actor: fileMeta.actor || 'OCR'
  });
}

/** 接続テスト。実行すると案件マスターへ1件登録される。 */
function testOcrToProjectConnection() {
  const ocrResult = {
    title: '角2封筒 2,000枚',
    org: '九州地方整備局 北九州港湾・空港整備事務所',
    category: '印刷',
    qualification: '全省庁統一資格',
    itemName: '封筒',
    specification: '角2 クラフト85kg 〒枠あり センター貼り 黒1色',
    quantity: 2000,
    unit: '枚',
    deadline: '令和8年7月16日 9:30',
    submissionEmail: 'kitakyu-e89gv@mlit.go.jp',
    deliveryPlace: '指定場所',
    attachments: ['仕様書', '別紙', '内訳書', '見積依頼書']
  };
  const result = processOcrResultToProject_(ocrResult, {
    fileId: 'TEST-PDF-001',
    fileName: '印刷☆福岡_仕様書.pdf'
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** v0.7.0 月次採番＋案件フォルダ作成テスト。案件マスターへ新規1件を登録する。 */
function testMonthlyIdAndFolderCreation() {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const result = processOcrResultToProject_({
    title: 'v0.7採番フォルダテスト ' + stamp,
    org: '入札にゃんOS テスト機関',
    category: 'テスト',
    itemName: 'テスト品',
    specification: '月次採番・フォルダ作成確認',
    quantity: 1,
    unit: '件',
    deadline: ''
  }, {
    fileId: 'TEST-V070-' + stamp,
    fileName: 'v0.7.0-test.pdf'
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


/** v0.8.0 フォルダ階層＋原本/OCR/JSON/履歴/ログ保存テスト。 */
function testCaseAssetPersistence() {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const temp = DriveApp.createFile(
    Utilities.newBlob('入札にゃんOS v0.8.0 テスト原本 ' + stamp, MimeType.PDF, 'v0.8.0-test.pdf')
  );
  try {
    const result = processOcrResultToProject_({
      title: 'v0.8資産保存テスト ' + stamp,
      org: '入札にゃんOS テスト機関',
      category: 'テスト',
      itemName: 'テスト品',
      specification: '原本・OCR・JSON・履歴・ログ保存確認',
      quantity: 1,
      unit: '件',
      deadline: '',
      deliveryPlace: 'テスト納品場所',
      ocrText: 'これは v0.8.0 のOCR全文テストです。\n案件IDと保存先の連携を確認します。'
    }, {
      fileId: temp.getId(),
      fileName: 'v0.8.0-test.pdf',
      ocrText: 'これは v0.8.0 のOCR全文テストです。\n案件IDと保存先の連携を確認します。',
      actor: 'testCaseAssetPersistence'
    });
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    temp.setTrashed(true);
  }
}

// ===== シート名 =====
const NYAN_SHEETS = {
  PROJECT:      '案件マスター',
  SOURCE_LINK:  '取得元リンク',
  SOURCE_MASTER:'情報源マスター',
  SUPPLIER:     '仕入先DB',
  PRICE:        '市場価格DB',
  QUOTE:        '見積比較',
  COST:         '原価計算',
  DOC_LOG:      '提出書類ログ',
  NOTIFY_LOG:   '通知ログ',
  JUDGE_LOG:    '判定ログ',
};

/* =====================================================================
 *  案件マスターの列
 *  【可視列】ユーザーが日常で見る列（左側）
 *  【システム列】判定用の内部キー（右側にまとめて非表示にする）
 * ===================================================================== */
const PROJECT_HEADERS = [
  // --- 可視列 ---
  '案件ID',          // 1  YYYY-MM-NNN（不変）
  '件名',            // 2
  '発注機関',        // 3
  '公告番号',        // 4  発注機関側の番号
  '発注機関案件番号',// 5  入札番号/調達番号など
  '契約番号',        // 6  落札後
  'URL',             // 7
  '締切日',          // 8  YYYY-MM-DD
  'ステータス',      // 9  新規/検討中/PASS/HOLD/DROP/落札/失注 など
  '主取得元',        // 10 最初に見つかった取得元
  '取得元数',        // 11 ぶら下がる取得元の件数
  '要確認',          // 12 キー一致マージで ⚠️ が立つ
  '登録日時',        // 13
  '更新日時',        // 14
  '備考',            // 15
  // --- システム列（非表示）---
  'URL正規化キー',   // 16
  '重複判定キー',    // 17 機関|件名|締切
  '機関番号キー',    // 18 機関|公告/案件番号
];

// 案件マスター列インデックス（1始まり）
const P = {
  ID:1, TITLE:2, AGENCY:3,
  NOTICE_NO:4, AGENCY_NO:5, CONTRACT_NO:6,
  URL:7, DEADLINE:8, STATUS:9,
  MAIN_SRC:10, SRC_COUNT:11, NEEDS_CHECK:12,
  CREATED:13, UPDATED:14, NOTE:15,
  URLKEY:16, DUPKEY:17, AGENCYKEY:18,
};
// システム列（右端）を非表示にする範囲
const P_SYSTEM_FIRST = P.URLKEY;   // 16
const P_SYSTEM_COUNT = 3;          // 16,17,18

// ===== 取得元リンクの列 =====
const SOURCE_LINK_HEADERS = [
  '案件ID',    // 1 案件マスターへの参照
  '取得元',    // 2 NewData / Briefing / Manual …
  '取得元ID',  // 3 ND-JGSDF-... / BRIEF-... / MANUAL-...
  '取得日時',  // 4
  'マッチ種別',// 5 NEW / 機関番号一致 / URL一致 / キー一致
  '備考',      // 6
];

/* =====================================================================
 *  [Phase0] セットアップ：シートとヘッダーを用意（既存データは壊さない）
 *  ヘッダーが古い場合は1行目だけ最新に同期（データ行は触らない）
 * ===================================================================== */
function setupNyanOS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const proj = ensureSheetWithHeader_(ss, NYAN_SHEETS.PROJECT, PROJECT_HEADERS);
  ensureSheetWithHeader_(ss, NYAN_SHEETS.SOURCE_LINK, SOURCE_LINK_HEADERS);
  hideSystemColumns_(proj); // システム列を非表示に

  [
    NYAN_SHEETS.SOURCE_MASTER, NYAN_SHEETS.SUPPLIER, NYAN_SHEETS.PRICE,
    NYAN_SHEETS.QUOTE, NYAN_SHEETS.COST, NYAN_SHEETS.DOC_LOG,
    NYAN_SHEETS.NOTIFY_LOG, NYAN_SHEETS.JUDGE_LOG,
  ].forEach(function(name){
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  SpreadsheetApp.getActive().toast('入札にゃんOS v' + NYAN_VERSION + ' セットアップ完了 🐱', 'setup', 5);
}

/* テストデータをまっさらにして作り直したいとき用（本番前だけ推奨） */
function resetNyanOS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [NYAN_SHEETS.PROJECT, NYAN_SHEETS.SOURCE_LINK].forEach(function(name){
    const sh = ss.getSheetByName(name);
    if (sh) sh.clear();
  });
  setupNyanOS();
  SpreadsheetApp.getActive().toast('案件マスター/取得元リンクを初期化しました 🧹', 'reset', 5);
}

function ensureSheetWithHeader_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const firstCell = sh.getRange(1, 1).getValue();
  if (firstCell === '' || firstCell == null) {
    // まっさら → ヘッダー新規作成
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0f0f0');
    sh.setFrozenRows(1);
  } else {
    // 既存 → 1行目が最新ヘッダーと違えば同期（列追加に追従・データ行は不変）
    const width = Math.max(headers.length, sh.getLastColumn());
    const cur = sh.getRange(1, 1, 1, width).getValues()[0];
    let diff = false;
    for (let i = 0; i < headers.length; i++) {
      if (String(cur[i] || '') !== headers[i]) { diff = true; break; }
    }
    if (diff) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0f0f0');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function hideSystemColumns_(sh) {
  try { sh.hideColumns(P_SYSTEM_FIRST, P_SYSTEM_COUNT); } catch (e) {}
}

/* =====================================================================
 *  [Phase0] 案件の取り込み（唯一の入口）
 *  どのルートも必ずここを通す。
 *
 *  payload = {
 *    source:     'NewData' | 'Briefing' | 'Manual' | 'GAS' | 'API',
 *    sourceId:   '取得元ID',
 *    title:      '件名',
 *    agency:     '発注機関',
 *    noticeNo:   '公告番号(任意)',
 *    agencyNo:   '発注機関案件番号(任意)',
 *    contractNo: '契約番号(任意)',
 *    url:        'URL(任意)',
 *    deadline:   '締切(任意 / Date か 文字列)',
 *    note:       '備考(任意)'
 *  }
 *  戻り値 = { projectId, isNew, matchType, needsCheck, sourceLinkAdded }
 * ===================================================================== */
function intakeProject(payload) {
  if (!payload || !payload.source || !payload.sourceId) {
    throw new Error('intakeProject: source と sourceId は必須です');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const projSheet = ensureSheetWithHeader_(ss, NYAN_SHEETS.PROJECT, PROJECT_HEADERS);

  const title      = String(payload.title  || '').trim();
  const agency     = String(payload.agency || '').trim();
  const noticeNo   = String(payload.noticeNo   || '').trim();
  const agencyNo   = String(payload.agencyNo   || '').trim();
  const contractNo = String(payload.contractNo || '').trim();
  const urlNorm    = normalizeUrl_(payload.url);
  const deadline   = normalizeDate_(payload.deadline);
  const dupKey     = buildDupKey_(agency, title, deadline);
  const agencyKey  = buildAgencyKey_(agency, noticeNo, agencyNo);

  const found = findExistingProject_(projSheet, agencyKey, urlNorm, dupKey);

  let projectId, isNew, matchType, needsCheck = false;
  let createdFolder = null;

  if (found) {
    projectId = found.projectId;
    isNew = false;
    matchType = found.matchType;                 // 機関番号一致 / URL一致 / キー一致
    if (matchType === 'キー一致') {
      needsCheck = true;
      markNeedsCheck_(projSheet, found.row);
    }
    touchUpdated_(projSheet, found.row);
  } else {
    // 採番→案件フォルダ作成→案件マスター追加を同一ロック内で行い、
    // 同時実行時の重複IDを防ぐ。
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      // ロック待機中に別実行が登録した可能性があるため再確認する。
      const foundAfterLock = findExistingProject_(projSheet, agencyKey, urlNorm, dupKey);
      if (foundAfterLock) {
        projectId = foundAfterLock.projectId;
        isNew = false;
        matchType = foundAfterLock.matchType;
        if (matchType === 'キー一致') {
          needsCheck = true;
          markNeedsCheck_(projSheet, foundAfterLock.row);
        }
        touchUpdated_(projSheet, foundAfterLock.row);
      } else {
        projectId = issueProjectId_(projSheet);
        createdFolder = createProjectFolder_(projectId);
        isNew = true;
        matchType = 'NEW';
        try {
          appendProjectRow_(projSheet, {
            projectId, title, agency, noticeNo, agencyNo, contractNo,
            url: payload.url || '', deadline,
            mainSource: payload.source, urlNorm, dupKey, agencyKey,
            note: payload.note || ''
          });
        } catch (e) {
          // シート登録に失敗した場合は空フォルダをゴミ箱へ移し、半端な状態を残さない。
          if (createdFolder) createdFolder.setTrashed(true);
          throw e;
        }
      }
    } finally {
      lock.releaseLock();
    }
  }

  const sourceLinkAdded = addSourceLink_(ss, {
    projectId, source: payload.source, sourceId: payload.sourceId,
    matchType, note: payload.note || ''
  });
  if (sourceLinkAdded && !isNew) bumpSourceCount_(projSheet, projectId);

  let folderId = '';
  let folderUrl = '';
  if (isNew && createdFolder) {
    folderId = createdFolder.getId();
    folderUrl = createdFolder.getUrl();
  }

  return { projectId, isNew, matchType, needsCheck, sourceLinkAdded, folderId, folderUrl };
}

/* =====================================================================
 *  [Phase2.3] 正式案件ID発番：YYYY-MM-NNN（月次連番）
 *  例：2026-07-001。月が変わると001から再開する。
 * ===================================================================== */
function issueProjectId_(projSheet) {
  const tz = Session.getScriptTimeZone();
  const ym = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const prefix = ym + '-';
  const last = projSheet.getLastRow();
  let maxSeq = 0;

  if (last >= 2) {
    const ids = projSheet.getRange(2, P.ID, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i][0] || '').trim();
      if (id.indexOf(prefix) === 0) {
        const seq = parseInt(id.slice(prefix.length), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }

  if (maxSeq >= 999) {
    throw new Error('月次案件IDが999件に達しました: ' + ym);
  }
  return prefix + ('00' + (maxSeq + 1)).slice(-3);
}

/* =====================================================================
 *  [Phase2.3] 案件フォルダ
 *  Script Properties の NYAN_PROJECT_ROOT_FOLDER_ID があればその配下、
 *  未設定ならマイドライブ直下の「入札にゃんOS_案件管理」を使用する。
 * ===================================================================== */
function getProjectRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const configuredId = String(props.getProperty('NYAN_PROJECT_ROOT_FOLDER_ID') || '').trim();
  if (configuredId) {
    try {
      return DriveApp.getFolderById(configuredId);
    } catch (e) {
      throw new Error('NYAN_PROJECT_ROOT_FOLDER_ID のフォルダを開けません: ' + configuredId);
    }
  }

  const folderName = '入札にゃんOS_案件管理';
  const folders = DriveApp.getFoldersByName(folderName);
  const root = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  props.setProperty('NYAN_PROJECT_ROOT_FOLDER_ID', root.getId());
  return root;
}

function createProjectFolder_(projectId) {
  if (!/^\d{4}-\d{2}-\d{3}$/.test(String(projectId || ''))) {
    throw new Error('案件フォルダ作成: 不正な案件IDです: ' + projectId);
  }
  const root = getProjectRootFolder_();
  const existing = root.getFoldersByName(projectId);
  const folder = existing.hasNext() ? existing.next() : root.createFolder(projectId);
  ensureProjectSubfolders_(folder);
  return folder;
}

const NYAN_CASE_SUBFOLDERS = [
  '01_原本', '02_OCR', '03_JSON', '04_見積', '05_提出', '06_納品'
];

function ensureProjectSubfolders_(projectFolder) {
  const map = {};
  NYAN_CASE_SUBFOLDERS.forEach(function(name){
    const it = projectFolder.getFoldersByName(name);
    const folder = it.hasNext() ? it.next() : projectFolder.createFolder(name);
    map[name] = folder;
  });
  return map;
}

function getOrCreateTextFile_(folder, name, content, mimeType) {
  const files = folder.getFilesByName(name);
  const file = files.hasNext() ? files.next() : folder.createFile(name, '', mimeType || MimeType.PLAIN_TEXT);
  file.setContent(String(content == null ? '' : content));
  return file;
}

function copyOriginalToCase_(originalFolder, meta, fallbackName) {
  const targetName = 'original.pdf';
  const existing = originalFolder.getFilesByName(targetName);
  while (existing.hasNext()) existing.next().setTrashed(true);

  if (meta.originalBlob) {
    const blob = meta.originalBlob.copyBlob().setName(targetName);
    return originalFolder.createFile(blob);
  }
  const fileId = String(meta.originalFileId || '').trim();
  if (!fileId) return null;
  try {
    return DriveApp.getFileById(fileId).makeCopy(targetName, originalFolder);
  } catch (e) {
    throw new Error('元PDFを取得できません（fileId=' + fileId + '）: ' + e.message);
  }
}

function saveCaseAssets_(caseJson, meta) {
  const data = normalizeCaseJson_(caseJson);
  if (!data.caseId) throw new Error('caseIdが空です');
  if (!data.source.folderId) throw new Error('folderIdが空です');

  const projectFolder = DriveApp.getFolderById(data.source.folderId);
  const folders = ensureProjectSubfolders_(projectFolder);
  const now = new Date().toISOString();
  const savedFiles = {};

  const originalFile = copyOriginalToCase_(folders['01_原本'], meta || {}, data.source.originalFileName);
  if (originalFile) {
    data.source.originalFileId = originalFile.getId();
    data.source.originalFileName = 'original.pdf';
    savedFiles.original = { id: originalFile.getId(), url: originalFile.getUrl(), name: originalFile.getName() };
  }

  const ocrText = String((meta && meta.ocrText) || '');
  const ocrFile = getOrCreateTextFile_(folders['02_OCR'], 'OCR.txt', ocrText, MimeType.PLAIN_TEXT);
  data.source.ocrTextFileId = ocrFile.getId();
  savedFiles.ocr = { id: ocrFile.getId(), url: ocrFile.getUrl(), name: ocrFile.getName() };

  const history = [{
    time: now,
    actor: String((meta && meta.actor) || 'OCR'),
    action: '案件作成',
    caseId: data.caseId
  }];
  const historyFile = getOrCreateTextFile_(folders['03_JSON'], 'history.json', JSON.stringify(history, null, 2), 'application/json');
  const logFile = getOrCreateTextFile_(folders['03_JSON'], 'log.txt', '[' + now + '] v0.9.0 案件資産を保存しました。', MimeType.PLAIN_TEXT);
  data.source.historyFileId = historyFile.getId();
  data.source.logFileId = logFile.getId();
  data.source.folderUrl = projectFolder.getUrl();
  data.source.subfolderIds = {};
  Object.keys(folders).forEach(function(name){ data.source.subfolderIds[name] = folders[name].getId(); });

  data.audit.updatedAt = now;
  const jsonFile = getOrCreateTextFile_(folders['03_JSON'], 'case.json', '{}', 'application/json');
  data.source.jsonFileId = jsonFile.getId();
  jsonFile.setContent(JSON.stringify(data, null, 2));

  savedFiles.caseJson = { id: jsonFile.getId(), url: jsonFile.getUrl(), name: jsonFile.getName() };
  savedFiles.history = { id: historyFile.getId(), url: historyFile.getUrl(), name: historyFile.getName() };
  savedFiles.log = { id: logFile.getId(), url: logFile.getUrl(), name: logFile.getName() };

  return { source: data.source, savedFiles: savedFiles };
}

function rollbackNewProject_(projectId, source, sourceId, folderId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const proj = ss.getSheetByName(NYAN_SHEETS.PROJECT);
  if (proj && proj.getLastRow() >= 2) {
    const ids = proj.getRange(2, P.ID, proj.getLastRow() - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(projectId)) proj.deleteRow(i + 2);
    }
  }
  const link = ss.getSheetByName(NYAN_SHEETS.SOURCE_LINK);
  if (link && link.getLastRow() >= 2) {
    const rows = link.getRange(2, 1, link.getLastRow() - 1, SOURCE_LINK_HEADERS.length).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0]) === String(projectId) && String(rows[i][1]) === String(source) && String(rows[i][2]) === String(sourceId)) {
        link.deleteRow(i + 2);
      }
    }
  }
  if (folderId) {
    try { DriveApp.getFolderById(folderId).setTrashed(true); } catch (e) {}
  }
}

/* =====================================================================
 *  [Phase0] 重複検索：機関番号 → URL → 機関＋件名＋締切
 *  （将来）AI類似判定を差し込むならこの関数の最後にフックする
 * ===================================================================== */
function findExistingProject_(projSheet, agencyKey, urlNorm, dupKey) {
  const last = projSheet.getLastRow();
  if (last < 2) return null;
  const values = projSheet.getRange(2, 1, last - 1, PROJECT_HEADERS.length).getValues();

  // ① 発注機関案件番号キー（最も確実）
  if (agencyKey && agencyKey.replace(/\|/g, '') !== '') {
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][P.AGENCYKEY - 1] || '') === agencyKey) {
        return { projectId: values[i][P.ID - 1], row: i + 2, matchType: '機関番号一致' };
      }
    }
  }
  // ② URL正規化一致
  if (urlNorm) {
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][P.URLKEY - 1] || '') === urlNorm) {
        return { projectId: values[i][P.ID - 1], row: i + 2, matchType: 'URL一致' };
      }
    }
  }
  // ③ 機関＋件名＋締切キー一致（要確認）
  if (dupKey && dupKey.replace(/\|/g, '') !== '') {
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][P.DUPKEY - 1] || '') === dupKey) {
        return { projectId: values[i][P.ID - 1], row: i + 2, matchType: 'キー一致' };
      }
    }
  }
  // ④ （将来）AI類似判定フック
  // const ai = findSimilarByAI_(values, {agency, title, deadline});
  // if (ai) return { ...ai, matchType: 'AI類似' };
  return null;
}

// 将来のAI類似判定用スタブ（今は常に該当なし）
function findSimilarByAI_(rows, target) {
  return null;
}

/* =====================================================================
 *  [Phase0] 行の追加・更新
 * ===================================================================== */
function appendProjectRow_(projSheet, o) {
  const now = new Date();
  const row = [];
  row[P.ID - 1]          = o.projectId;
  row[P.TITLE - 1]       = o.title;
  row[P.AGENCY - 1]      = o.agency;
  row[P.NOTICE_NO - 1]   = o.noticeNo;
  row[P.AGENCY_NO - 1]   = o.agencyNo;
  row[P.CONTRACT_NO - 1] = o.contractNo;
  row[P.URL - 1]         = o.url;
  row[P.DEADLINE - 1]    = o.deadline;
  row[P.STATUS - 1]      = '新規';
  row[P.MAIN_SRC - 1]    = o.mainSource;
  row[P.SRC_COUNT - 1]   = 1;
  row[P.NEEDS_CHECK - 1] = '';
  row[P.CREATED - 1]     = now;
  row[P.UPDATED - 1]     = now;
  row[P.NOTE - 1]        = o.note;
  row[P.URLKEY - 1]      = o.urlNorm;
  row[P.DUPKEY - 1]      = o.dupKey;
  row[P.AGENCYKEY - 1]   = o.agencyKey;
  projSheet.appendRow(row);
}

function markNeedsCheck_(projSheet, row) {
  projSheet.getRange(row, P.NEEDS_CHECK).setValue('⚠️要確認');
}
function touchUpdated_(projSheet, row) {
  projSheet.getRange(row, P.UPDATED).setValue(new Date());
}
function bumpSourceCount_(projSheet, projectId) {
  const last = projSheet.getLastRow();
  if (last < 2) return;
  const ids = projSheet.getRange(2, P.ID, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(projectId)) {
      const cur = projSheet.getRange(i + 2, P.SRC_COUNT).getValue() || 0;
      projSheet.getRange(i + 2, P.SRC_COUNT).setValue(Number(cur) + 1);
      return;
    }
  }
}

/* =====================================================================
 *  [Phase0] 取得元リンク追記（案件ID×取得元×取得元ID の重複は登録しない）
 * ===================================================================== */
function addSourceLink_(ss, o) {
  const sh = ensureSheetWithHeader_(ss, NYAN_SHEETS.SOURCE_LINK, SOURCE_LINK_HEADERS);
  const last = sh.getLastRow();
  if (last >= 2) {
    const rows = sh.getRange(2, 1, last - 1, 3).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(o.projectId) &&
          String(rows[i][1]) === String(o.source) &&
          String(rows[i][2]) === String(o.sourceId)) {
        return false;
      }
    }
  }
  sh.appendRow([o.projectId, o.source, o.sourceId, new Date(), o.matchType, o.note || '']);
  return true;
}

/* =====================================================================
 *  [Phase0] 正規化ユーティリティ
 * ===================================================================== */
function normalizeText_(s) {
  if (s == null) return '';
  let t = String(s);
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(c){
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  t = t.replace(/[\s\u3000]/g, '');
  t = t.replace(/[()（）\[\]「」『』【】〔〕、。・,\.\-―ー_/／\\：:；;]/g, '');
  return t.toLowerCase();
}
function normalizeUrl_(url) {
  if (!url) return '';
  let u = String(url).trim().toLowerCase();
  if (!u) return '';
  u = u.replace(/^https?:\/\//, '');
  u = u.replace(/^www\./, '');
  u = u.split('#')[0].split('?')[0];
  u = u.replace(/\/+$/, '');
  return u;
}
function normalizeDate_(d) {
  if (!d) return '';
  const tz = Session.getScriptTimeZone();
  if (Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d)) {
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
  const s = String(d).trim();
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return s;
}
// 機関＋件名＋締切
function buildDupKey_(agency, title, deadlineNorm) {
  return normalizeText_(agency) + '|' + normalizeText_(title) + '|' + (deadlineNorm || '');
}
// 機関＋（公告番号 or 発注機関案件番号）
function buildAgencyKey_(agency, noticeNo, agencyNo) {
  const primary = (noticeNo || agencyNo || '').trim();
  if (!primary) return '';
  return normalizeText_(agency) + '|' + normalizeText_(primary);
}

/* =====================================================================
 *  [Phase0] 参照系ヘルパー（後続Phaseの土台）
 * ===================================================================== */
function getSourcesOfProject(projectId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(NYAN_SHEETS.SOURCE_LINK);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, SOURCE_LINK_HEADERS.length).getValues();
  return rows
    .filter(function(r){ return String(r[0]) === String(projectId); })
    .map(function(r){
      return { source: r[1], sourceId: r[2], fetchedAt: r[3], matchType: r[4], note: r[5] };
    });
}
function listNeedsCheckProjects() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(NYAN_SHEETS.PROJECT);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, PROJECT_HEADERS.length).getValues();
  const out = [];
  values.forEach(function(v){
    if (String(v[P.NEEDS_CHECK - 1] || '') !== '') {
      out.push({ projectId: v[P.ID - 1], title: v[P.TITLE - 1], agency: v[P.AGENCY - 1] });
    }
  });
  return out;
}

/* =====================================================================
 *  [Phase0] 動作確認用テスト（ドロップダウンで選んで実行）
 *  ※ 末尾に "_" を付けると実行メニューに出ないので付けないこと！
 * ===================================================================== */
function testIntake() {
  resetNyanOS(); // テストは毎回まっさらから

  const cases = [
    // ① NewData 由来
    { source:'NewData',  sourceId:'ND-JGSDF-20260702-001',
      title:'事務用品一式の調達', agency:'陸上自衛隊○○駐屯地',
      noticeNo:'R8-調達-0012',
      url:'https://example.go.jp/bid/12345', deadline:'2026-07-20' },

    // ② ブリーフィング由来（別案件）
    { source:'Briefing', sourceId:'BRIEF-20260702-001',
      title:'防災備品の購入', agency:'長野県○○町',
      url:'https://town-example.lg.jp/n/98', deadline:'2026-07-25' },

    // ③ 手動登録（別案件）
    { source:'Manual',   sourceId:'MANUAL-20260702-001',
      title:'印刷物作成業務', agency:'○○市教育委員会',
      url:'', deadline:'2026-08-01' },

    // ④ ①とURL一致 → 自動マージ（取得元だけ増える）
    { source:'Briefing', sourceId:'BRIEF-20260702-002',
      title:'事務用品 一式 の調達', agency:'陸上自衛隊○○駐屯地',
      url:'https://example.go.jp/bid/12345?utm=x', deadline:'2026-07-20' },

    // ⑤ ②とURL違い・機関/件名/締切ほぼ同じ → キー一致で⚠️要確認
    { source:'Manual',   sourceId:'MANUAL-20260702-002',
      title:'防災備品の購入', agency:'長野県○○町',
      url:'https://another.example.com/x', deadline:'2026/7/25' },

    // ⑥ ①とURLも件名も違うが、機関＋公告番号が一致 → 機関番号一致で自動マージ
    { source:'Manual',   sourceId:'MANUAL-20260702-003',
      title:'事務用品調達（再掲）', agency:'陸上自衛隊○○駐屯地',
      noticeNo:'R8-調達-0012',
      url:'https://zenmqchi.example.jp/y', deadline:'2026-07-20' },
  ];

  cases.forEach(function(c, i){
    const r = intakeProject(c);
    Logger.log('case%s → %s', i + 1, JSON.stringify(r));
  });
  Logger.log('⚠️要確認: %s', JSON.stringify(listNeedsCheckProjects()));
  Logger.log('v%s / 001の取得元: %s', NYAN_VERSION, JSON.stringify(getSourcesOfProject(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM') + '-001')));
}
