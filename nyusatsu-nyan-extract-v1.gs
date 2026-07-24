/**
 * ============================================================
 * nyusatsu-nyan-extract-v2.3-register-v0.9.0.gs（正式登録統合）
 * ------------------------------------------------------------
 * 改善点
 *  1. PDF種別（公告・仕様書・見積依頼書・不明）を推定
 *  2. 「見出し直後を切り出すだけ」から、項目別の抽出ロジックへ変更
 *  3. 納期は日付・期限表現を優先し、注意書きの誤取得を抑制
 *  4. 発注元は官署名・担当官名を優先し、条文中の「発注者」を除外
 *  5. 参加資格は全文を返さず、資格種別・主要条件を短く要約
 *  6. OCRテキストを正規化し、改行・全角空白・連続空白の揺れに対応
 *  7. 一時セッションに「資料種別」「抽出信頼度」を保存
 *  8. 1案件へ公告・仕様書・別紙など複数PDFを追加可能
 *  9. 追加PDFだけOCRし、Phase1の3項目を資料横断で再選定
 *
 * 既存API名は維持
 *  - api_extractKey3
 *  - api_proceedToDetailExtraction
 *  - api_cancelExtractSession
 * ============================================================
 */

const EXTRACT_SESSION_SHEET_NAME = '一時抽出セッション';
const EXTRACT_DOCUMENT_SHEET_NAME = '一時抽出資料';
const EXTRACT_TEMP_FOLDER_NAME = '入札にゃんOS_一時PDF';
const OCR_CORRECTION_LOG_SHEET_NAME = 'OCR修正ログ';
const OCR_CORRECTION_LOG_HEADERS = [
  'logId', 'caseId', 'sessionId', 'fieldKey', 'originalText',
  'extractedValue', 'correctedValue', 'learningType', 'agencyType',
  'agencyName', 'sourceLabel', 'sourceText', 'reason', 'createdAt',
];
const LEARNING_CANDIDATE_SHEET_NAME = '学習候補';
const LEARNING_CANDIDATE_HEADERS = [
  'candidateKey', 'candidateId', 'firstLogId', 'term', 'correctedTerm',
  'semanticKey', 'learningType', 'agencyType', 'agencyName', 'status',
  'createdAt', 'updatedAt', 'lastCaseId', 'lastLogId',
];
const LEARNING_DECISION_SHEET_NAME = '学習判断履歴';
const LEARNING_DECISION_HEADERS = [
  'decisionId', 'candidateId', 'logId', 'candidateKey', 'caseId',
  'fieldKey', 'decision', 'term', 'correctedTerm', 'learningType',
  'agencyType', 'agencyName', 'createdAt',
];
const LEARNING_DECISIONS = ['register', 'once', 'ignore'];
const LEARNING_TARGET_FIELD_KEYS = [
  'delivery.place', 'delivery.date', 'submission.deadline', 'submission.method',
];
const SEMANTIC_LEARNING_CANDIDATE_SHEET_NAME = 'にゃん語辞典候補';
const SEMANTIC_LEARNING_CANDIDATE_HEADERS = [
  'candidateId', 'caseId', 'term', 'normalizedTerm', 'suggestedSemanticKey',
  'selectedSemanticKey', 'documentType', 'sourceLabel', 'relation', 'sourceText',
  'pageNumber', 'agencyType', 'agencyName', 'scope', 'status', 'createdAt',
  'updatedAt', 'decidedAt',
];
const SEMANTIC_DICTIONARY_SHEET_NAME = 'Semantic Dictionary';
const SEMANTIC_DICTIONARY_HEADERS = [
  'entryId', 'term', 'normalizedTerm', 'semanticKey', 'scope', 'agencyType',
  'agencyName', 'status', 'sourceCandidateId', 'createdAt', 'updatedAt',
];
const SEMANTIC_CANDIDATE_DECISIONS = ['teach', 'defer', 'not_heading', 'unmapped'];
const SEMANTIC_KEY_REGISTRY = [
  { semanticKey: 'delivery.place', displayName: '納品場所', valueType: 'location', category: 'delivery', status: 'active' },
  { semanticKey: 'delivery.date', displayName: '納期', valueType: 'date', category: 'delivery', status: 'active' },
  { semanticKey: 'submission.deadline', displayName: '提出期限', valueType: 'datetime', category: 'submission', status: 'active' },
  { semanticKey: 'submission.method', displayName: '提出方法', valueType: 'method', category: 'submission', status: 'active' },
  { semanticKey: 'question.deadline', displayName: '質問受付期限', valueType: 'datetime', category: 'question', status: 'active' },
];
const EXTRACT_SESSION_HEADERS = [
  'セッションID', '作成日時', 'ステータス', '元ファイル名',
  'PDFファイルID', 'OCR DocID', '資料種別',
  '抽出_参加資格', '抽出_納期', '抽出_発注元',
  '信頼度_参加資格', '信頼度_納期', '信頼度_発注元',
  'Phase2_JSONファイルID', 'Phase2更新日時', '備考',
];

const EXTRACT_DOCUMENT_HEADERS = [
  '資料ID', 'セッションID', '追加日時', 'ステータス',
  '元ファイル名', 'PDFファイルID', 'OCR DocID', '資料種別',
  '資料種別信頼度', 'OCR文字数', '備考',
];

// ── シート・フォルダ準備 ─────────────────────────────

function getOrCreateExtractSessionSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EXTRACT_SESSION_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EXTRACT_SESSION_SHEET_NAME);
  }

  const currentLastCol = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, currentLastCol).getValues()[0]
    .map(v => String(v || '').trim());

  EXTRACT_SESSION_HEADERS.forEach(header => {
    if (!currentHeaders.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      currentHeaders.push(header);
    }
  });

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setBackground('#2c2438')
    .setFontColor('#ede0e8')
    .setFontWeight('bold');

  return sheet;
}


function getOrCreateExtractDocumentSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EXTRACT_DOCUMENT_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(EXTRACT_DOCUMENT_SHEET_NAME);

  const currentLastCol = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, currentLastCol).getValues()[0]
    .map(v => String(v || '').trim());

  EXTRACT_DOCUMENT_HEADERS.forEach(header => {
    if (!currentHeaders.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      currentHeaders.push(header);
    }
  });

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setBackground('#2c2438')
    .setFontColor('#ede0e8')
    .setFontWeight('bold');
  return sheet;
}

function getOrCreateTempFolder_() {
  const folders = DriveApp.getFoldersByName(EXTRACT_TEMP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(EXTRACT_TEMP_FOLDER_NAME);
}

function getExtractHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const map = {};
  headerRow.forEach((h, idx) => { if (h) map[h] = idx + 1; });
  return map;
}

function findExtractSessionRow_(sheet, sessionId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const headerMap = getExtractHeaderMap_(sheet);
  const idCol = headerMap['セッションID'];
  if (!idCol) return null;

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === sessionId) {
      const row = i + 2;
      const rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      return { row, headerMap, rowValues };
    }
  }
  return null;
}

function trashFileIfExists_(fileId) {
  if (!fileId) return;
  try {
    const file = DriveApp.getFileById(fileId);
    if (!file.isTrashed()) file.setTrashed(true);
  } catch (e) {
    Logger.log('trashFileIfExists_: ' + fileId + ' / ' + e.message);
  }
}


function appendRowByHeaders_(sheet, data) {
  const headerMap = getExtractHeaderMap_(sheet);
  const row = new Array(sheet.getLastColumn()).fill('');
  Object.keys(data).forEach(header => {
    if (headerMap[header]) row[headerMap[header] - 1] = data[header];
  });
  sheet.appendRow(row);
}

function getExtractDocuments_(sessionId, includeOcrText) {
  const sheet = getOrCreateExtractDocumentSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const map = getExtractHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const docs = [];

  values.forEach((row, index) => {
    if (String(row[map['セッションID'] - 1]).trim() !== sessionId) return;
    if (String(row[map['ステータス'] - 1]).trim() === 'cancelled') return;

    const doc = {
      row: index + 2,
      documentId: String(row[map['資料ID'] - 1] || ''),
      sessionId: sessionId,
      fileName: String(row[map['元ファイル名'] - 1] || ''),
      pdfFileId: String(row[map['PDFファイルID'] - 1] || ''),
      ocrDocId: String(row[map['OCR DocID'] - 1] || ''),
      documentType: String(row[map['資料種別'] - 1] || '不明'),
      documentTypeConfidence: Number(row[map['資料種別信頼度'] - 1] || 0),
      ocrChars: Number(row[map['OCR文字数'] - 1] || 0),
      status: String(row[map['ステータス'] - 1] || ''),
    };

    if (includeOcrText && doc.ocrDocId) {
      try {
        doc.ocrText = DocumentApp.openById(doc.ocrDocId).getBody().getText();
      } catch (e) {
        doc.ocrText = '';
        doc.readError = e.message;
      }
    }
    docs.push(doc);
  });
  return docs;
}

function publicDocumentList_(docs) {
  return (docs || []).map(doc => ({
    documentId: doc.documentId,
    fileName: doc.fileName,
    documentType: doc.documentType || '不明',
    documentTypeConfidence: Number(doc.documentTypeConfidence || 0),
    ocrChars: Number(doc.ocrChars || 0),
    status: doc.status || 'ocr_saved',
  }));
}

// ── OCRテキスト整形 ───────────────────────────────────

function normalizeOcrText_(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 保存用の生OCRは変更せず、抽出時だけ使う解析用テキストを作る。 */
function normalizeAnalysisText_(text) {
  let value = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[０-９]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[：﹕]/g, ':')
    .replace(/，/g, ',')
    .replace(/[\u00A0\u3000]/g, ' ');

  const keywords = [
    '公告', '入札公告', 'オープンカウンター方式', 'グループ', '一連番号', '一連番',
    '契約実施計画番号', '品目等内訳書', '令和', '平成',
    '品目内訳書', '件名リスト', '案件リスト', '見積書提出期限', '見積書の提出期限',
    '見積書提出方法', '見積書の提出方法', '提出期限', '提出方法', '提出先',
    '納期', '納地', '納入期限', '納入期日', '納入場所', '納品場所',
    '電子メール', '会計隊', '契約班', '契約課', '調達係', '担当部署',
    '履行期限', '履行期間', '同等品不可', '同等品申請可', '同等品可',
    '又は同等品以上', 'または同等品以上', '調達要求番号',
  ];
  keywords.forEach(function(keyword) {
    const escaped = keyword.split('').map(function(char) {
      return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('[ \\t]*');
    value = value.replace(new RegExp(escaped, 'g'), keyword);
  });

  return value
    .split('\n')
    .map(function(line) { return line.replace(/[ \t]+/g, ' ').trim(); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function makeAnalysisDocuments_(docs) {
  return (docs || []).map(function(doc) {
    const analysisText = normalizeAnalysisText_(doc.ocrText || '');
    const classified = detectDocumentType_(analysisText, doc.fileName || '');
    const storedType = doc.documentType || 'その他';
    const shouldRefreshType = classified.confidence >= 60 || ['その他', '不明'].includes(storedType);
    return Object.assign({}, doc, {
      ocrText: analysisText,
      documentType: shouldRefreshType ? classified.type : storedType,
      documentTypeConfidence: shouldRefreshType
        ? classified.confidence : Number(doc.documentTypeConfidence || 0),
    });
  });
}

function toSingleLine_(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：,，、。・\-]+/, '')
    .trim();
}

function truncate_(text, maxChars) {
  const s = toSingleLine_(text);
  return s.length > maxChars ? s.slice(0, maxChars) + '…' : s;
}

function getLines_(text) {
  return normalizeOcrText_(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

// ── 資料種別判定 ─────────────────────────────────────

function detectDocumentType_(text, fileName) {
  const src = normalizeAnalysisText_(String(fileName || '') + '\n' + text).toLowerCase();
  const scores = {
    '公告': 0,
    '仕様書': 0,
    '見積依頼書': 0,
    '品目等内訳書': 0,
    '別紙': 0,
    '見積書様式': 0,
    'その他': 0,
  };

  if (/入札公告|公告第|一般競争入札|オープンカウンター方式による見積/.test(src)) scores['公告'] += 6;
  if (/(?:^|\n)公告(?:\n|$)|件名リスト|案件リスト/.test(src)) scores['公告'] += 4;
  if (/見積書提出期限/.test(src) && /(?:グループ|一連番号|一連番|件名リスト)/.test(src)) scores['公告'] += 3;
  if (/競争参加資格|入札参加資格|見積り合わせに参加/.test(src)) scores['公告'] += 2;
  if (/仕様書|仕様\s*$|納入仕様|業務仕様/.test(src)) scores['仕様書'] += 4;
  if (/品名|規格|数量|納入場所|検査|同等品/.test(src)) scores['仕様書'] += 2;
  if (/見積依頼書|見積書提出期限|見積合わせ|見積り合わせ/.test(src)) scores['見積依頼書'] += 4;
  if (/品目等内訳書|品目内訳書|内訳書|内訳明細/.test(src)) scores['品目等内訳書'] += 7;
  if (/(?:品名|品目).{0,30}(?:数量|単位)|(?:数量|単位).{0,30}(?:品名|品目)/s.test(src)) scores['品目等内訳書'] += 2;
  if (/別紙|別添|付表/.test(src)) scores['別紙'] += 4;
  if (/見積書\s*(?:様式|ひな形|雛形)|御?見積書|見積金額/.test(src)) scores['見積書様式'] += 4;
  if (/住所|商号|代表者|印\s*$|見積者/.test(src)) scores['見積書様式'] += 2;

  let bestType = 'その他';
  let bestScore = 0;
  Object.keys(scores).forEach(type => {
    if (scores[type] > bestScore) {
      bestType = type;
      bestScore = scores[type];
    }
  });

  return { type: bestType, confidence: Math.min(100, bestScore * 20) };
}

// ── 汎用ブロック抽出 ─────────────────────────────────

function extractBlockAfterLabels_(text, labels, maxLines, maxChars) {
  const lines = getLines_(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = labels.find(l => line.indexOf(l) !== -1);
    if (!label) continue;

    const inline = line.slice(line.indexOf(label) + label.length)
      .replace(/^[\s:：,，、。・\-]+/, '')
      .trim();

    const picked = [];
    if (inline) picked.push(inline);

    for (let j = i + 1; j < Math.min(lines.length, i + 1 + maxLines); j++) {
      const next = lines[j];
      if (/^(参加資格|競争参加資格|納期|納入期限|履行期限|発注者|発注元|契約担当者|問い合わせ先|提出期限|納入場所|仕様|数量)[\s:：]/.test(next)) break;
      picked.push(next);
      if (picked.join(' ').length >= maxChars) break;
    }

    const result = truncate_(picked.join(' '), maxChars);
    if (result) return result;
  }
  return '';
}

// ── 納期抽出 ─────────────────────────────────────────

function normalizeJapaneseDate_(raw) {
  return toSingleLine_(normalizeAnalysisText_(raw))
    .replace(/令和\s*([0-9０-９]+)\s*年\s*([0-9０-９]+)\s*月\s*([0-9０-９]+)\s*日/g, '令和$1年$2月$3日')
    .replace(/([0-9０-９]+)\s*年\s*([0-9０-９]+)\s*月\s*([0-9０-９]+)\s*日/g, '$1年$2月$3日')
    .replace(/(?:令和|R)?\s*(\d{1,2})[.／/]\s*(\d{1,2})[.／/]\s*(\d{1,2})/i, '令和$1年$2月$3日');
}

function extractSemanticDate_(text, targetLabels, competingLabels, includeTime) {
  const lines = getLines_(normalizeAnalysisText_(text));
  const targetIndexes = [];
  const competingIndexes = [];
  lines.forEach(function(line, index) {
    if (targetLabels.test(line)) targetIndexes.push(index);
    if (competingLabels.test(line)) competingIndexes.push(index);
  });
  if (!targetIndexes.length) return { value: '', confidence: 0 };

  const patterns = [
    /(令和|平成)\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/,
    /\d{4}[年.／/\-]\s*\d{1,2}[月.／/\-]\s*\d{1,2}日?/,
    /(?:令和|R)?\s*\d{1,2}[.／/]\s*\d{1,2}[.／/]\s*\d{1,2}/i,
  ];
  let best = null;
  lines.forEach(function(line, index) {
    let dateMatch = null;
    for (const pattern of patterns) {
      dateMatch = line.match(pattern);
      if (dateMatch) break;
    }
    if (!dateMatch) return;

    const targetDistance = Math.min.apply(null, targetIndexes.map(function(labelIndex) {
      return Math.abs(index - labelIndex);
    }));
    if (targetDistance > 12) return;
    const competingDistance = competingIndexes.length
      ? Math.min.apply(null, competingIndexes.map(function(labelIndex) { return Math.abs(index - labelIndex); }))
      : 999;
    const nextLine = lines[index + 1] || '';
    const timeContext = line + (/^\s*\d{1,2}(?:\s*時|\s*[:：])/.test(nextLine) ? ' ' + nextLine : '');
    const time = timeContext.match(/(\d{1,2})(?:\s*時|\s*[:：])\s*(\d{1,2})?\s*分?/);
    if (!includeTime && time && competingIndexes.length) return;
    if (competingDistance < targetDistance && !(includeTime && time)) return;
    const score = 100 - targetDistance * 5 + (includeTime && time ? 8 : 0) - (competingDistance === targetDistance ? 15 : 0);
    if (best && best.score >= score) return;

    let value = normalizeJapaneseDate_(dateMatch[0]);
    if (includeTime && time) {
      value += ' ' + time[1] + '時' + (time[2] ? time[2] + '分' : '');
    }
    best = { value: value, confidence: Math.max(60, Math.min(97, score)), score: score };
  });
  return best || { value: '', confidence: 0 };
}

function extractDeadline_(text) {
  text = normalizeAnalysisText_(text);
  const semantic = extractSemanticDate_(
    text,
    /納期|納入期限|納入期日|引渡年月日|引渡期限|履行期限|完了期限/,
    /見積書(?:の)?提出期限|提出期限|入札締切|公表日|公告日/,
    false
  );
  if (semantic.value) return semantic;
  const lines = getLines_(text);
  const labels = ['納期', '納入期限', '履行期限', '契約期間', '納入期日', '完了期限'];
  const datePatterns = [
    /令和\s*[0-9０-９]+\s*年\s*[0-9０-９]+\s*月\s*[0-9０-９]+\s*日(?:\s*まで|\s*限り|\s*とする)?/,
    /[0-9０-９]{4}\s*年\s*[0-9０-９]+\s*月\s*[0-9０-９]+\s*日(?:\s*まで|\s*限り|\s*とする)?/,
    /[0-9０-９]{1,2}\s*月\s*[0-9０-９]{1,2}\s*日(?:\s*まで|\s*限り|\s*とする)?/,
    /(?:令和|R)?\s*\d{1,2}[.／/]\s*\d{1,2}[.／/]\s*\d{1,2}/i,
    /契約締結(?:日|後)から[^。\n]{0,40}/,
  ];

  for (let i = 0; i < lines.length; i++) {
    if (!labels.some(label => lines[i].indexOf(label) !== -1)) continue;

    const localLines = lines.slice(i, Math.min(lines.length, i + 12));
    const competingIndex = localLines.slice(1).findIndex(function(line) {
      return /見積書(?:の)?提出期限|提出期限|公表日|公告日/.test(line);
    });
    const local = (competingIndex >= 0 ? localLines.slice(0, competingIndex + 1) : localLines).join(' ');
    for (let p = 0; p < datePatterns.length; p++) {
      const match = local.match(datePatterns[p]);
      if (match) {
        return { value: normalizeJapaneseDate_(match[0]), confidence: 95 };
      }
    }

    // 日付がない見出し語や説明文は納期として確定しない。
  }

  // ラベルなしでも「までとする」等の明確な日付を拾う
  for (let p = 0; p < datePatterns.length; p++) {
    const match = text.match(datePatterns[p]);
    if (match && /まで|期限|納入|履行/.test(match[0] + text.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20))) {
      return { value: normalizeJapaneseDate_(match[0]), confidence: 70 };
    }
  }

  return { value: '', confidence: 0 };
}

// ── 発注元抽出 ───────────────────────────────────────

function cleanOrganization_(value) {
  return truncate_(String(value || '')
    .replace(/^(発注者|発注元|契約担当者|支出負担行為担当官|分任支出負担行為担当官|担当官)[\s:：]*/, '')
    .replace(/\s+(オープンカウンター方式|入札公告|公告|仕様書|見積り合わせ).*$/, ''), 100);
}

function extractOrganization_(text) {
  const lines = getLines_(text);
  const directLabels = ['発注元', '発注機関', '契約担当者', '支出負担行為担当官', '分任支出負担行為担当官'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = directLabels.find(l => line.indexOf(l) !== -1);
    if (!label) continue;

    let candidate = line.slice(line.indexOf(label) + label.length).replace(/^[\s:：]+/, '').trim();
    if (!candidate && lines[i + 1]) candidate = lines[i + 1];
    candidate = cleanOrganization_(candidate);

    if (candidate && !/暴力団|不当介入|協議|受けた場合/.test(candidate)) {
      return { value: candidate, confidence: 95 };
    }
  }

  // 官署名＋長/官/所長/局長などを優先
  const organizationPatterns = [
    /(?:国土交通省\s*)?[一-龠々ヶ・\s]{2,40}(?:地方整備局|地方運輸局|防衛局|駐屯地|基地|庁|省|県|市|町|村|事務所)(?:長|局長|所長|課長|契約担当官|分任支出負担行為担当官)?(?:\s+[一-龠々ァ-ヶー]{2,15})?/,
    /(?:分任)?支出負担行為担当官\s+[一-龠々ヶ・\s]{2,50}/,
  ];

  for (let p = 0; p < organizationPatterns.length; p++) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(organizationPatterns[p]);
      if (!m) continue;
      const candidate = cleanOrganization_(m[0]);
      if (candidate && !/暴力団|不当介入|契約において/.test(candidate)) {
        return { value: candidate, confidence: 80 };
      }
    }
  }

  return { value: '', confidence: 0 };
}

// ── 参加資格抽出・要約 ───────────────────────────────

function summarizeQualification_(text) {
  const lines = getLines_(text);
  const qualificationBlocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/(?:参加資格|資格要件|競争参加|見積参加条件|見積り?合わせに参加)/.test(lines[i])) continue;
    const picked = [lines[i]];
    for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
      if (/^[（(]?\d+[）)]?\s*(?:提出|見積|納期|納入|問い合わせ|問合せ|その他|備考)/.test(lines[j])) break;
      picked.push(lines[j]);
    }
    qualificationBlocks.push(picked.join(' '));
  }
  // 資格見出しがある場合、備考等の全文ではなく資格ブロックだけを評価する。
  const full = qualificationBlocks.length ? qualificationBlocks.join(' ') : lines.join(' ');
  const items = [];

  const unifiedMatch = full.match(/全省庁統一資格[^。\n]{0,80}|競争参加資格[^。\n]{0,80}|入札参加資格[^。\n]{0,80}/);
  if (unifiedMatch && !/有していない|必要としない/.test(unifiedMatch[0])) {
    items.push(truncate_(unifiedMatch[0], 90));
  }

  if (/指名停止[^。\n]{0,50}(受けていない|期間中でない|措置を受けていない)/.test(full)) {
    items.push('指名停止期間中でないこと');
  }
  if (/暴力団[^。\n]{0,80}(該当しない|関係者でない|排除要請)/.test(full)) {
    items.push('暴力団等の排除要件を満たすこと');
  }
  if (/(会社更生法|民事再生法)[^。\n]{0,120}(申立てがなされていない|手続開始の申立てがされていない)/.test(full)) {
    items.push('会社更生・民事再生の手続開始申立てがないこと');
  }
  if (/予算決算及び会計令[^。\n]{0,100}(第70条|第７０条)/.test(full)) {
    items.push('予決令70条・71条に該当しないこと');
  }

  // 資格等級・地域・品目の記載がある場合
  const rankMatch = full.match(/(?:資格|等級)[^。\n]{0,50}(?:A|Ｂ|B|Ｃ|C|Ｄ|D)[^。\n]{0,40}/i);
  if (rankMatch && !items.length) items.push(truncate_(rankMatch[0], 80));

  const unique = [];
  items.forEach(item => {
    const normalized = toSingleLine_(item);
    if (normalized && !unique.includes(normalized)) unique.push(normalized);
  });

  if (unique.length) {
    return { value: unique.slice(0, 4).join('／'), confidence: unique.length >= 2 ? 90 : 75 };
  }

  const raw = extractBlockAfterLabels_(text, ['参加資格', '入札参加資格', '競争参加資格'], 8, 260);
  if (raw) return { value: raw, confidence: 55 };

  return { value: '', confidence: 0 };
}

function extractKey3_(docText, fileName) {
  const normalized = normalizeOcrText_(docText);
  const docType = detectDocumentType_(normalized, fileName);
  const qualification = summarizeQualification_(normalized);
  const deadline = extractDeadline_(normalized);
  const org = extractOrganization_(normalized);

  return {
    documentType: docType.type,
    documentTypeConfidence: docType.confidence,
    qualification: qualification.value,
    qualificationConfidence: qualification.confidence,
    deadline: deadline.value,
    deadlineConfidence: deadline.confidence,
    org: org.value,
    orgConfidence: org.confidence,
  };
}



// ── Phase2.1A：Drive APIの一時エラー対策 ─────────────

function isRetryableDriveError_(e) {
  const msg = String(e && e.message ? e.message : e || '');
  return /User rate limit exceeded|Rate Limit|rateLimitExceeded|429|500|502|503|backendError|Service invoked too many times|internal error/i.test(msg);
}

function withRetry_(fn, label, maxAttempts) {
  const attempts = Number(maxAttempts || 4);
  let lastError = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
      if (!isRetryableDriveError_(e) || i === attempts - 1) throw e;

      const waitMs = Math.pow(2, i) * 1000;
      Logger.log((label || 'Drive処理') + ' retry ' + (i + 1) + '/' + attempts + ': ' + e.message);
      Utilities.sleep(waitMs);
    }
  }
  throw lastError;
}

function readOcrDocTextWithRetry_(ocrDocId) {
  return withRetry_(function() {
    return DocumentApp.openById(ocrDocId).getBody().getText();
  }, 'OCR結果読み込み', 4);
}

function processExtractDocument_(base64Data, fileName, mimeType, sessionId) {
  if (!base64Data) throw new Error('PDFデータが空にゃん。');

  const folder = getOrCreateTempFolder_();
  const decoded = Utilities.base64Decode(base64Data);
  const safeFileName = fileName || 'upload.pdf';
  const blob = Utilities.newBlob(decoded, mimeType || 'application/pdf', safeFileName);
  const pdfFile = folder.createFile(blob);
  const pdfFileId = pdfFile.getId();

  let ocrDocId = '';
  try {
    const resource = {
      name: safeFileName + '_OCR',
      mimeType: MimeType.GOOGLE_DOCS,
      parents: [folder.getId()],
    };
    const converted = withRetry_(function() {
      return Drive.Files.create(resource, blob, {
        fields: 'id',
        ocrLanguage: 'ja',
      });
    }, 'OCR変換', 4);
    ocrDocId = converted.id;
  } catch (e) {
    trashFileIfExists_(pdfFileId);
    throw new Error('OCR変換に失敗したにゃん：' + e.message +
      '（Apps Scriptの「サービス」でDrive API v3を確認してにゃん）');
  }

  let docText = '';
  try {
    docText = readOcrDocTextWithRetry_(ocrDocId);
  } catch (e) {
    trashFileIfExists_(pdfFileId);
    trashFileIfExists_(ocrDocId);
    throw new Error('OCR結果の読み込みに失敗したにゃん：' + e.message);
  }

  const extracted = extractKey3_(docText, safeFileName);
  const documentId = Utilities.getUuid();
  const docSheet = getOrCreateExtractDocumentSheet_();
  appendRowByHeaders_(docSheet, {
    '資料ID': documentId,
    'セッションID': sessionId,
    '追加日時': new Date(),
    'ステータス': 'ocr_saved',
    '元ファイル名': safeFileName,
    'PDFファイルID': pdfFileId,
    'OCR DocID': ocrDocId,
    '資料種別': extracted.documentType,
    '資料種別信頼度': extracted.documentTypeConfidence,
    'OCR文字数': docText.length,
    '備考': '',
  });

  return {
    documentId: documentId,
    sessionId: sessionId,
    fileName: safeFileName,
    pdfFileId: pdfFileId,
    ocrDocId: ocrDocId,
    ocrText: docText,
    ocrChars: docText.length,
    documentType: extracted.documentType,
    documentTypeConfidence: extracted.documentTypeConfidence,
    extracted: extracted,
    status: 'ocr_saved',
  };
}

function pickBestExtractValue_(candidates, fieldName) {
  const typeBonus = {
    qualification: { '公告': 30, '見積依頼書': 25, '仕様書': 0, '不明': 0 },
    deadline:      { '仕様書': 30, '公告': 20, '見積依頼書': 15, '不明': 0 },
    org:           { '公告': 30, '見積依頼書': 20, '仕様書': 5, '不明': 0 },
  };

  let best = { value: '', confidence: 0, score: -1, documentId: '', sourceType: '', sourceFileName: '' };
  candidates.forEach(c => {
    const value = c.extracted[fieldName] || '';
    if (!value) return;
    const confidence = Number(c.extracted[fieldName + 'Confidence'] || 0);
    const score = confidence + Number((typeBonus[fieldName] || {})[c.documentType] || 0);
    if (score > best.score) {
      best = {
        value: value,
        confidence: confidence,
        score: score,
        documentId: c.documentId,
        sourceType: c.documentType,
        sourceFileName: c.fileName,
      };
    }
  });
  return best;
}

function mergeKey3ForDocuments_(docs) {
  const candidates = docs.map(doc => ({
    documentId: doc.documentId,
    fileName: doc.fileName,
    documentType: doc.documentType,
    extracted: extractKey3_(doc.ocrText || '', doc.fileName || ''),
  }));

  return {
    qualification: pickBestExtractValue_(candidates, 'qualification'),
    deadline: pickBestExtractValue_(candidates, 'deadline'),
    org: pickBestExtractValue_(candidates, 'org'),
    documents: docs,
  };
}

function mergeKey3ForSession_(sessionId) {
  return mergeKey3ForDocuments_(getExtractDocuments_(sessionId, true));
}

function updateExtractSessionSummary_(sessionId, merged) {
  const sheet = getOrCreateExtractSessionSheet_();
  const found = findExtractSessionRow_(sheet, sessionId);
  if (!found) throw new Error('セッションが見つからないにゃん。');
  const m = found.headerMap;

  sheet.getRange(found.row, m['抽出_参加資格']).setValue(merged.qualification.value || '');
  sheet.getRange(found.row, m['抽出_納期']).setValue(merged.deadline.value || '');
  sheet.getRange(found.row, m['抽出_発注元']).setValue(merged.org.value || '');
  sheet.getRange(found.row, m['信頼度_参加資格']).setValue(merged.qualification.confidence || 0);
  sheet.getRange(found.row, m['信頼度_納期']).setValue(merged.deadline.confidence || 0);
  sheet.getRange(found.row, m['信頼度_発注元']).setValue(merged.org.confidence || 0);
  sheet.getRange(found.row, m['備考']).setValue(
    '資料数=' + merged.documents.length +
    ' / 資格出典=' + (merged.qualification.sourceType || '未検出') +
    ' / 納期出典=' + (merged.deadline.sourceType || '未検出') +
    ' / 発注元出典=' + (merged.org.sourceType || '未検出')
  );
}

function buildSessionApiData_(sessionId, merged) {
  return {
    sessionId: sessionId,
    qualification: merged.qualification.value || '（未検出・推定できず）',
    qualificationConfidence: merged.qualification.confidence || 0,
    qualificationSource: merged.qualification.sourceType || '',
    deadline: merged.deadline.value || '（未検出・推定できず）',
    deadlineConfidence: merged.deadline.confidence || 0,
    deadlineSource: merged.deadline.sourceType || '',
    org: merged.org.value || '（未検出・推定できず）',
    orgConfidence: merged.org.confidence || 0,
    orgSource: merged.org.sourceType || '',
    documents: publicDocumentList_(merged.documents),
  };
}

// ── API①：最初のPDFアップロード→Phase1抽出 ─────────────

function api_extractKey3(base64Data, fileName, mimeType) {
  const sessionId = Utilities.getUuid();
  try {
    const sessionSheet = getOrCreateExtractSessionSheet_();
    appendRowByHeaders_(sessionSheet, {
      'セッションID': sessionId,
      '作成日時': new Date(),
      'ステータス': 'pending_review',
      '元ファイル名': fileName || '',
      '備考': '最初の資料を処理中',
    });

    const firstDoc = processExtractDocument_(base64Data, fileName, mimeType, sessionId);

    // 既存列との後方互換用に最初の資料IDをセッション側にも残す
    const found = findExtractSessionRow_(sessionSheet, sessionId);
    if (found) {
      sessionSheet.getRange(found.row, found.headerMap['PDFファイルID']).setValue(firstDoc.pdfFileId);
      sessionSheet.getRange(found.row, found.headerMap['OCR DocID']).setValue(firstDoc.ocrDocId);
      sessionSheet.getRange(found.row, found.headerMap['資料種別']).setValue(firstDoc.documentType);
    }

    const merged = mergeKey3ForSession_(sessionId);
    updateExtractSessionSummary_(sessionId, merged);
    const data = buildSessionApiData_(sessionId, merged);
    data.documentType = firstDoc.documentType;
    data.documentTypeConfidence = firstDoc.documentTypeConfidence;
    data.hint = firstDoc.documentType === '仕様書'
      ? '仕様書では参加資格が載っていないことがあるにゃん。公告も追加するともっと正確に見られるにゃん。'
      : '仕様書や別紙も追加すると、詳細抽出の精度が上がるにゃん。';
    return apiOk_(data);
  } catch (e) {
    Logger.log('api_extractKey3 error: ' + e.stack);
    try { api_cancelExtractSession(sessionId); } catch (ignore) {}
    return apiError_('抽出処理でエラーにゃん：' + e.message);
  }
}

// ── API②：同じセッションへ追加資料を保存・OCR ────────────

function api_addExtractDocument(sessionId, base64Data, fileName, mimeType) {
  try {
    if (!sessionId) return apiError_('セッションIDがないにゃん。');
    if (!base64Data) return apiError_('追加するPDFデータが空にゃん。');

    const sessionSheet = getOrCreateExtractSessionSheet_();
    const found = findExtractSessionRow_(sessionSheet, sessionId);
    if (!found) return apiError_('作業中のセッションが見つからないにゃん。');

    const status = String(found.rowValues[found.headerMap['ステータス'] - 1] || '');
    if (status !== 'pending_review') {
      return apiError_('このセッションは「' + status + '」状態なので資料を追加できないにゃん。');
    }

    const newDoc = processExtractDocument_(base64Data, fileName, mimeType, sessionId);
    const merged = mergeKey3ForSession_(sessionId);
    updateExtractSessionSummary_(sessionId, merged);

    const data = buildSessionApiData_(sessionId, merged);
    data.addedDocument = publicDocumentList_([newDoc])[0];
    data.message = newDoc.documentType + 'としてOCR保存できたにゃん！';
    return apiOk_(data);
  } catch (e) {
    Logger.log('api_addExtractDocument error: ' + e.stack);
    return apiError_('資料の追加でエラーにゃん：' + e.message);
  }
}

// ── API③：現在の資料一覧を取得 ─────────────────────────

function api_getExtractDocuments(sessionId) {
  try {
    if (!sessionId) return apiError_('セッションIDがないにゃん。');
    const sessionSheet = getOrCreateExtractSessionSheet_();
    if (!findExtractSessionRow_(sessionSheet, sessionId)) {
      return apiError_('作業中のセッションが見つからないにゃん。');
    }
    const merged = mergeKey3ForSession_(sessionId);
    return apiOk_(buildSessionApiData_(sessionId, merged));
  } catch (e) {
    return apiError_('資料一覧の取得でエラーにゃん：' + e.message);
  }
}


// ── Phase2：複数資料から案件カルテを組み立てる ───────────


function extractGroupNumbersFromText_(text, allowLeadingColumn) {
  const src = normalizeAnalysisText_(text);
  const values = [];
  const explicit = [
    /グループ\s*[:：]?\s*(\d{1,3})/g,
    /第\s*(\d{1,3})\s*グループ/g,
    /一連番号\s*[:：]?\s*(\d{1,3})/g,
    /一連番\s*号?\s*[:：]?\s*(\d{1,3})/g,
    /契約実施計画番号[^\n]{0,60}?(?:グループ|一連番号|一連番)\s*[:：]?\s*(\d{1,3})(?!\d)/g,
  ];
  explicit.forEach(function(pattern) {
    let match;
    while ((match = pattern.exec(src))) values.push(String(Number(match[1])));
  });
  if (allowLeadingColumn) {
    getLines_(src).forEach(function(line) {
      const match = line.match(/^\s*(\d{1,3})\s+(?=\S)/);
      if (match) values.push(String(Number(match[1])));
    });
  }
  return Array.from(new Set(values.filter(function(value) {
    return Number(value) > 0;
  })));
}

function detectGroupNumber_(docs, overrideGroupNumber) {
  const override = String(overrideGroupNumber == null ? '' : overrideGroupNumber).trim();
  if (/^\d{1,3}$/.test(override) && Number(override) > 0) {
    return { groupNumber: String(Number(override)), source: 'user', confidence: 100, candidates: [String(Number(override))], needsConfirmation: false };
  }

  const tiers = [
    { types: ['品目等内訳書', '別紙'], source: '品目内訳書・別紙本文', confidence: 96, fileNameOnly: false },
    { types: ['品目等内訳書', '別紙'], source: '品目内訳書・別紙ファイル名', confidence: 90, fileNameOnly: true },
    { types: null, source: 'ファイル名', confidence: 78, fileNameOnly: true },
  ];

  for (const tier of tiers) {
    const found = [];
    (docs || []).forEach(function(doc) {
      if (tier.types && !tier.types.includes(doc.documentType)) return;
      const sourceText = tier.fileNameOnly ? doc.fileName : doc.ocrText;
      extractGroupNumbersFromText_(sourceText || '', false).forEach(function(value) {
        found.push(value);
      });
    });
    const unique = Array.from(new Set(found));
    if (unique.length === 1) {
      return { groupNumber: unique[0], source: tier.source, confidence: tier.confidence, candidates: unique, needsConfirmation: false };
    }
    if (unique.length > 1) {
      return { groupNumber: '', source: tier.source, confidence: 0, candidates: unique, needsConfirmation: true };
    }
  }

  const announcementValues = [];
  (docs || []).filter(function(doc) { return doc.documentType === '公告'; }).forEach(function(doc) {
    extractGroupNumbersFromText_(doc.ocrText || '', false).forEach(function(value) { announcementValues.push(value); });
  });
  const uniqueAnnouncements = Array.from(new Set(announcementValues));
  if (uniqueAnnouncements.length === 1) {
    return { groupNumber: uniqueAnnouncements[0], source: '公告本文', confidence: 62, candidates: uniqueAnnouncements, needsConfirmation: false };
  }
  return {
    groupNumber: '',
    source: uniqueAnnouncements.length ? '公告本文' : '',
    confidence: 0,
    candidates: uniqueAnnouncements,
    needsConfirmation: uniqueAnnouncements.length > 1,
  };
}

function findAnnouncementGroupBlock_(text, groupNumber) {
  const lines = getLines_(normalizeAnalysisText_(text));
  const markers = [];
  lines.forEach(function(line, index) {
    let match = line.match(/(?:グループ\s*[:：]?\s*|第\s*)(\d{1,3})(?:\s*グループ)?|一連番号\s*[:：]?\s*(\d{1,3})/);
    let kind = 'explicit';
    if (!match) {
      match = line.match(/^\s*(\d{1,3})\s+(?=\S)/);
      kind = 'leading-column';
      if (match && /^\s*\d{1,3}\s+(?:EA|枚|個|本|冊|箱|式|組|台|袋|巻|セット|着|足|kg|g|L|ml|部|ケース|束|時|分)(?:\s|$)/i.test(line)) match = null;
    }
    if (!match) {
      match = line.match(/^\s*(\d{1,3})\s*$/);
      kind = 'standalone-column';
    }
    if (match) markers.push({ index: index, number: String(Number(match[1] || match[2])), kind: kind });
  });

  const distinct = Array.from(new Set(markers.map(function(marker) { return marker.number; })));
  if (distinct.length < 2) return { safe: false, reason: '公告に複数案件構造を確認できませんでした。' };
  const target = markers.find(function(marker) { return marker.number === String(Number(groupNumber)); });
  if (!target) return { safe: false, reason: '公告内にグループ' + groupNumber + 'の案件行が見つかりませんでした。' };
  const next = markers.find(function(marker) { return marker.index > target.index && marker.number !== target.number; });
  const end = next ? next.index : lines.length;
  const blockLines = lines.slice(target.index, end);
  if (!blockLines.length || blockLines.join('\n').length < 8) {
    return { safe: false, reason: '対象案件ブロックが短すぎるため安全に限定できませんでした。' };
  }
  return { safe: true, text: blockLines.join('\n'), markerKind: target.kind };
}

function inferScopedTitle_(blockText, groupNumber) {
  const labeled = extractFirstMatch_(blockText, [/(?:件\s*名|案件名|調達件名|品\s*名)\s*[:：]?\s*([^\n]{2,120})/], 120);
  if (labeled) return labeled;
  const lines = getLines_(blockText);
  for (let line of lines) {
    line = cleanExtractedValue_(line)
      .replace(new RegExp('^(?:グループ\\s*[:：]?\\s*|第\\s*)?' + groupNumber + '(?:\\s*グループ)?\\s*'), '')
      .replace(new RegExp('^一連番号\\s*[:：]?\\s*' + groupNumber + '\\s*'), '')
      .trim();
    const countedTitle = line.match(/^(.{3,100}?ほか\s*\d+\s*件)/);
    if (countedTitle) return truncate_(countedTitle[1], 120);
    line = line.split(/\s+(?:見積書提出期限|提出期限|納期|納入期限|数量|単位)\b/)[0].trim();
    if (line.length >= 3 && !isGenericHeading_(line) && !/^(?:番号|グループ|一連番号|品名|数量|単位)$/.test(line)) {
      return truncate_(line, 120);
    }
  }
  return '';
}

function prepareDocumentUnderstandingContext_(docs, overrideGroupNumber) {
  const originalDocs = makeAnalysisDocuments_(docs || []);
  const detected = detectGroupNumber_(originalDocs, overrideGroupNumber);
  const warnings = [];
  const metadata = {
    groupNumber: detected.groupNumber,
    groupNumberSource: detected.source,
    groupNumberConfidence: detected.confidence,
    groupNumberCandidates: detected.candidates || [],
    needsGroupConfirmation: detected.needsConfirmation,
    scopedTitle: '',
    scopedTitleConfidence: 0,
    scopeApplied: false,
    warnings: warnings,
  };

  if (originalDocs.length <= 1) {
    metadata.needsGroupConfirmation = false;
    warnings.push('単一資料案件のため従来の抽出処理を使用しました。');
    return { scopedDocuments: originalDocs, fullDocuments: originalDocs, metadata: metadata };
  }
  if (!detected.groupNumber) {
    metadata.needsGroupConfirmation = true;
    warnings.push(detected.needsConfirmation
      ? 'グループ番号が複数候補（' + detected.candidates.join('、') + '）のため自動確定していません。番号を確認してください。'
      : 'グループ番号を検出できなかったため従来の抽出処理を使用しました。');
    return { scopedDocuments: originalDocs, fullDocuments: originalDocs, metadata: metadata };
  }

  const announcements = originalDocs.filter(function(doc) { return doc.documentType === '公告'; });
  if (!announcements.length) {
    metadata.needsGroupConfirmation = false;
    warnings.push('公告資料がないため対象案件へ限定せず、従来の抽出処理を使用しました。');
    return { scopedDocuments: originalDocs, fullDocuments: originalDocs, metadata: metadata };
  }

  let scopedAnnouncement = null;
  for (const announcement of announcements) {
    const block = findAnnouncementGroupBlock_(announcement.ocrText || '', detected.groupNumber);
    if (block.safe) {
      scopedAnnouncement = Object.assign({}, announcement, { ocrText: block.text, isScopedAnnouncement: true });
      metadata.scopedTitle = inferScopedTitle_(block.text, detected.groupNumber);
      metadata.scopedTitleConfidence = metadata.scopedTitle ? 88 : 0;
      break;
    }
    if (block.reason) warnings.push(block.reason);
  }
  if (!scopedAnnouncement) {
    metadata.needsGroupConfirmation = true;
    warnings.push('対象公告ブロックを安全に特定できなかったため従来の抽出処理を使用しました。');
    return { scopedDocuments: originalDocs, fullDocuments: originalDocs, metadata: metadata };
  }

  const scoped = [];
  originalDocs.forEach(function(doc) {
    if (doc.documentType === '公告') {
      if (doc.documentId === scopedAnnouncement.documentId) scoped.push(scopedAnnouncement);
      return;
    }
    const candidates = extractGroupNumbersFromText_((doc.fileName || '') + '\n' + (doc.ocrText || ''), false);
    if (candidates.length && !candidates.includes(detected.groupNumber)) return;
    scoped.push(doc);
  });
  metadata.scopeApplied = true;
  return { scopedDocuments: scoped, fullDocuments: originalDocs, metadata: metadata };
}


function normalizeWideChars_(text) {
  return String(text || '')
    .replace(/[０-９]/g, function(c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .replace(/，/g, ',')
    .replace(/：/g, ':');
}

function isWeakGenericValue_(value) {
  const s = toSingleLine_(value);
  return !s || /^(?:期間|別表のとおり|別紙のとおり|仕様書のとおり|以下のとおり|上記のとおり|同上)$/i.test(s);
}

function isBadSubmissionTo_(value) {
  const s = toSingleLine_(value);
  if (!s) return true;
  if (/承諾を得る|協議を行う|措置について|契約において|暴力団|遅れが生じる|見積書の記名|記名にあたって|押印|代表者名の記載/.test(s)) return true;
  return !/(?:課|係|室|班|事務所|官|担当|宛|〒|@|電話|FAX|メール|地方整備局|会計隊|契約)/.test(s);
}

function cleanExtractedValue_(value) {
  return toSingleLine_(String(value || ''))
    .replace(/^[（(]?\d+[）)]?\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isGenericHeading_(value) {
  const text = cleanExtractedValue_(value).replace(/[：:]$/, '').trim();
  return /^(?:リスト|件名リスト|案件リスト|見積依頼書|品目等内訳書|品目内訳書|仕様書|別紙|公告|備考|件名|案件名|品名|使用期限等?|賞味期限等?)$/i.test(text);
}


function extractFirstMatch_(text, patterns, maxChars) {
  const src = normalizeOcrText_(text);
  for (let i = 0; i < patterns.length; i++) {
    const m = src.match(patterns[i]);
    if (m && m[1]) return truncate_(m[1], maxChars || 200);
  }
  return '';
}

function extractTitleDetail_(docs) {
  const ordered = docs.slice().sort((a, b) => {
    const rank = { '公告': 1, '見積依頼書': 2, '品目等内訳書': 3, '仕様書': 4, '別紙': 5, '見積書様式': 8, 'その他': 9, '不明': 9 };
    return (rank[a.documentType] || 9) - (rank[b.documentType] || 9);
  });
  const patterns = [
    /(?:件\s*名|案件名|調達件名|品\s*名)\s*[:：]?\s*([^\n]{2,120})/,
    /(?:見積り合わせに付する事項|競争入札に付する事項)[\s\S]{0,200}?(?:件\s*名|品\s*名)\s*[:：]?\s*([^\n]{2,120})/,
  ];
  for (const doc of ordered) {
    const v = extractFirstMatch_(doc.ocrText || '', patterns, 120);
    if (v && !isGenericHeading_(v)) return sourceValue_(v, doc, 85);
  }
  return sourceValue_('', null, 0);
}

function extractSubmissionDeadline_(docs) {
  const ordered = docs.slice().sort((a, b) => {
    const rank = {
      '見積依頼書': 1,
      '公告': 2,
      '別紙': 3,
      '仕様書': 4,
      '不明': 5,
    };
    return (rank[a.documentType] || 5) - (rank[b.documentType] || 5);
  });

  for (const doc of ordered) {
    const semantic = extractSemanticDate_(
      doc.ocrText || '',
      /見積書(?:の)?提出期限|見積提出期限|提出期限|入札書提出期限|入札締切|見積期限|見積合わせ日時/,
      /納期|納入期限|納入期日|引渡年月日|引渡期限|履行期限|完了期限|公表日|公告日/,
      true
    );
    if (semantic.value) return sourceValue_(semantic.value, doc, semantic.confidence);
  }

  return sourceValue_('', null, 0);
}

function extractSubmissionMethod_(docs) {
  const ordered = docs.slice().sort(function(a, b) {
    const rank = {
      '見積依頼書': 1,
      '公告': 2,
      '別紙': 3,
      '仕様書': 4,
      '不明': 5,
    };
    return (rank[a.documentType] || 5) - (rank[b.documentType] || 5);
  });

  const mailPattern = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
  const methods = /電子メール|E-?mail|メール|郵送|持参|電子調達システム|調達ポータル|FAX|ファクシミリ/ig;
  const foundMethods = [];

  function addMethod_(value) {
    let method = String(value || '');
    if (/E-?mail|メール/i.test(method)) method = '電子メール';
    else if (/ファクシミリ|FAX/i.test(method)) method = 'FAX';
    if (method && !foundMethods.includes(method)) foundMethods.push(method);
  }

  for (const doc of ordered) {
    const text = normalizeAnalysisText_(doc.ocrText || '');
    if (!/見積書|提出|送付|入札/.test(text)) continue;
    (text.match(methods) || []).forEach(addMethod_);
    if (mailPattern.test(text)) addMethod_('電子メール');
  }

  if (foundMethods.length) {
    const sourceDoc = ordered.find(function(doc) {
      return foundMethods.some(function(method) {
        return method === '電子メール'
          ? /電子メール|E-?mail|メール/i.test(doc.ocrText || '')
          : /FAX|ファクシミリ/i.test(doc.ocrText || '');
      });
    });
    return sourceValue_(foundMethods.join('／'), sourceDoc, foundMethods.length > 1 ? 92 : 80);
  }

  return sourceValue_('', null, 0);
}


function findReferencedSectionText_(text, sectionNumber) {
  const lines = getLines_(text || '');
  const sectionLabel = new RegExp('^\\s*[（(]?' + sectionNumber + '[）)]?\\s*');

  for (let i = 0; i < lines.length; i++) {
    if (!sectionLabel.test(lines[i])) continue;

    const block = lines.slice(i, Math.min(lines.length, i + 8)).join(' ');
    if (/(提出場所|提出先|送付先|担当|契約|調達|会計|総務|課|係|室|班|事務所)/.test(block)) {
      return truncate_(cleanExtractedValue_(block), 240);
    }
  }
  return '';
}

function extractSubmissionTo_(docs) {
  const ordered = docs.slice().sort(function(a, b) {
    const rank = {
      '見積依頼書': 1,
      '公告': 2,
      '別紙': 3,
      '仕様書': 4,
      '不明': 5,
    };
    return (rank[a.documentType] || 5) - (rank[b.documentType] || 5);
  });

  const labels = /提出先|送付先|見積書提出先|宛先|提出場所|担当部署|担当者/;
  const referencePattern = /上記\s*(\d+)\s*に同じ/;

  // 説明文より先に、提出先として具体性の高い担当部署・連絡先を探す。
  for (const doc of ordered) {
    const lines = getLines_(doc.ocrText || '');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      if (!/(?:契約|調達|会計|総務|業務).*(?:課|係|室|班)|(?:課|係|室|班).*(?:担当|電話|FAX|メール)|(?:駐屯地|基地).*(?:会計隊|業務隊)/.test(line)) continue;
      const candidate = cleanExtractedValue_(lines.slice(i, Math.min(lines.length, i + 2)).join(' '));
      if (!isBadSubmissionTo_(candidate)) return sourceValue_(truncate_(candidate, 220), doc, 94);
    }
  }

  for (const doc of ordered) {
    const lines = getLines_(doc.ocrText || '');

    for (let i = 0; i < lines.length; i++) {
      const current = lines[i] || '';
      if (!labels.test(current)) continue;

      const nearby = cleanExtractedValue_(
        lines.slice(i, Math.min(lines.length, i + 4)).join(' ')
      );

      const ref = nearby.match(referencePattern);
      if (ref) {
        const referenced = findReferencedSectionText_(doc.ocrText || '', ref[1]);
        if (referenced && !isBadSubmissionTo_(referenced)) {
          return sourceValue_(referenced, doc, 92);
        }
      }

      if (!isBadSubmissionTo_(nearby)) {
        return sourceValue_(truncate_(nearby, 220), doc, 88);
      }
    }
  }

  // 提出先ラベルが崩れている場合、部署名・メール・電話を含む短い行を候補にする
  for (const doc of ordered) {
    const lines = getLines_(doc.ocrText || '');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      if (/(?:契約|調達|会計|総務).*(?:課|係|室|班)|(?:課|係|室|班).*(?:電話|FAX|メール)|地方整備局.*事務所/.test(line)) {
        const candidate = cleanExtractedValue_(
          lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join(' ')
        );
        if (!isBadSubmissionTo_(candidate)) {
          return sourceValue_(truncate_(candidate, 220), doc, 72);
        }
      }
    }
  }

  return sourceValue_('', null, 0);
}

function extractDeliveryPlace_(docs) {
  const patterns = [
    /(?:納入場所|納品場所|履行場所|納入先|納地)\s*[:：]?\s*([^\n。]{2,180})/,
  ];
  for (const doc of docs) {
    if (!['仕様書','品目等内訳書','別紙','その他','不明','公告'].includes(doc.documentType)) continue;
    const v = extractFirstMatch_(doc.ocrText || '', patterns, 180);
    if (v && !/^(?:納期|数量|単位|品名|規格|使用期限等?)$/.test(v)) return sourceValue_(v, doc, 85);

    const lines = getLines_(doc.ocrText || '');
    for (let i = 0; i < lines.length; i++) {
      if (!/(?:納入場所|納品場所|履行場所|納入先|納地)/.test(lines[i])) continue;
      const candidates = lines.slice(i + 1, Math.min(lines.length, i + 10));
      const strong = candidates.find(function(line) {
        return /(?:駐屯地|基地|庁舎|事務所|倉庫|センター|市|区|町|村|県|都|府|道)/.test(line) &&
          !/^(?:納期|数量|単位|品名|規格|使用期限等?)$/.test(line);
      });
      if (strong) return sourceValue_(truncate_(strong, 180), doc, 88);
    }
  }
  return sourceValue_('', null, 0);
}

function extractDeliveryMethod_(docs) {
  const ordered = docs.slice().sort(function(a, b) {
    const rank = { '仕様書': 1, '別紙': 2, '公告': 3, '見積依頼書': 4, '不明': 5 };
    return (rank[a.documentType] || 5) - (rank[b.documentType] || 5);
  });

  const labels = /納入方法|納品方法|搬入条件|納入条件|引渡方法|配送条件/;
  const concrete = /一括納入|一括納品|分納|指定場所(?:へ|に)?納品|指定場所渡し|軒先渡し|搬入設置|宅配便|配送|持参|梱包|平日|開庁日|日時指定/;

  for (const doc of ordered) {
    const lines = getLines_(doc.ocrText || '');

    for (let i = 0; i < lines.length; i++) {
      const nearby = cleanExtractedValue_(
        lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join(' ')
      );

      if (labels.test(lines[i] || '')) {
        const matches = nearby.match(new RegExp(concrete.source, 'g')) || [];
        if (matches.length) {
          return sourceValue_(uniqueNonEmpty_(matches).join('／'), doc, 88);
        }
      }

      const direct = (lines[i] || '').match(concrete);
      if (direct) {
        return sourceValue_(direct[0], doc, 72);
      }
    }
  }

  return sourceValue_('', null, 0);
}

function extractTaxTreatment_(docs) {
  const patterns = [
    /((?:消費税及び地方消費税|消費税)[^\n。]{0,140}(?:含む|含まない|加算|除く|税抜|税込))/,
    /((?:見積金額|見積価格|見積書)[^\n。]{0,100}(?:税抜|税込|税別)[^\n。]{0,40})/,
    /((?:税込|税抜|税別)[^\n。]{0,60})/,
  ];

  for (const doc of docs) {
    const value = extractFirstMatch_(doc.ocrText || '', patterns, 150);
    if (value) return sourceValue_(cleanExtractedValue_(value), doc, 78);
  }
  return sourceValue_('', null, 0);
}

function extractEquivalentProduct_(docs) {
  const joined = docs.map(function(doc) {
    return normalizeOcrText_(doc.ocrText || '');
  }).join('\n');

  if (/同等品\s*(?:不可|認めない|不可とする)|同等品は認めない/.test(joined)) {
    const doc = docs.find(function(d) {
      return /同等品\s*(?:不可|認めない|不可とする)|同等品は認めない/.test(d.ocrText || '');
    });
    return sourceValue_('同等品不可', doc, 97);
  }

  if (/同等品申請可|同等品申請|同等品確認|同等品承認|事前承認/.test(joined)) {
    const doc = docs.find(function(d) {
      return /同等品申請可|同等品申請|同等品確認|同等品承認|事前承認/.test(d.ocrText || '');
    });
    return sourceValue_('同等品可（要申請・要承認）', doc, 92);
  }

  if (/同等品\s*(?:可|可能)|同等以上の品|同等又はそれ以上|(?:又は|または)同等品以上/.test(joined)) {
    const doc = docs.find(function(d) {
      return /同等品\s*(?:可|可能)|同等以上の品|同等又はそれ以上|(?:又は|または)同等品以上/.test(d.ocrText || '');
    });
    return sourceValue_('同等品可', doc, 90);
  }

  return sourceValue_('資料に記載なし・要確認', null, 55);
}

function extractEquivalentDeadline_(docs) {
  const patterns = [
    /(?:同等品申請期限|同等品確認期限|同等品承認申請期限)\s*[:：]?\s*([^\n。]{2,100})/,
    /同等品[^\n。]{0,80}((?:令和|平成)\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^\n。]{0,20})/,
  ];
  for (const doc of docs) {
    const v = extractFirstMatch_(doc.ocrText || '', patterns, 100);
    if (v) return sourceValue_(v, doc, 75);
  }
  return sourceValue_('', null, 0);
}


// ── Phase2.2：規格・仕様の構造抽出 ─────────────

function uniqueNonEmpty_(values) {
  const seen = {};
  const out = [];
  (values || []).forEach(function(value) {
    const clean = cleanExtractedValue_(value);
    if (!clean || seen[clean]) return;
    seen[clean] = true;
    out.push(clean);
  });
  return out;
}

function normalizeSpecToken_(value) {
  return cleanExtractedValue_(String(value || ''))
    .replace(/[、，]\s*/g, '、')
    .replace(/\s*×\s*/g, '×')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectEnvelopeSize_(text) {
  const src = normalizeWideChars_(text || '');
  const patterns = [
    /(?:角|長|洋)\s*[0-9]{1,2}\s*(?:形|号)?/,
    /(?:角形|長形|洋形)\s*[0-9]{1,2}\s*号?/,
  ];

  for (const pattern of patterns) {
    const match = src.match(pattern);
    if (!match) continue;

    return normalizeSpecToken_(match[0])
      .replace(/角形/g, '角')
      .replace(/長形/g, '長')
      .replace(/洋形/g, '洋')
      .replace(/\s+/g, '')
      .replace(/形$/, '')
      .replace(/号$/, '');
  }
  return '';
}

function extractSpecificationTags_(docs, itemName, titleValue) {
  const ordered = docs.slice().sort(function(a, b) {
    const rank = {
      '仕様書': 1,
      '別紙': 2,
      '見積依頼書': 3,
      '公告': 4,
      '不明': 5,
    };
    return (rank[a.documentType] || 5) - (rank[b.documentType] || 5);
  });

  const weighted = [];
  const sourceNames = [];
  const itemWord = cleanExtractedValue_(itemName || '');
  const isEnvelope = /封筒/.test(itemWord + ' ' + String(titleValue || ''));

  function addTag_(value, score, sourceName) {
    const clean = normalizeSpecToken_(value);
    if (!clean) return;
    weighted.push({ value: clean, score: Number(score || 0) });
    if (sourceName) sourceNames.push(sourceName);
  }

  ordered.forEach(function(doc) {
    const text = normalizeWideChars_(doc.ocrText || '');
    const lines = getLines_(text);
    const sourceName = doc.fileName || doc.documentType || '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const nearItem = itemWord && (
        line.indexOf(itemWord) !== -1 ||
        lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(' ').indexOf(itemWord) !== -1
      );

      const specSignal = /角形?|長形?|洋形?|クラフト|ケント|上質|コート|マット|坪量|g\/㎡|kg|窓|郵便番号枠|〒枠|センター貼り|サイド貼り|中貼り|片面|両面|黒|カラー|特色|刷色|寸法|サイズ|縦|横|厚さ|容量|保存期間|本入|枚入|個入/.test(line);

      if (!nearItem && !specSignal) continue;

      const block = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join(' ');
      const baseScore = nearItem ? 95 : (doc.documentType === '仕様書' ? 82 : 68);

      const size = detectEnvelopeSize_(block);
      if (size) addTag_(size, baseScore + 3, sourceName);

      const patterns = [
        { re: /(?:クラフト|ケント|上質|コート|マット)(?:紙)?[^\s、。]{0,12}(?:\d+(?:\.\d+)?\s*(?:kg|g\/㎡))?/g, score: 92 },
        { re: /\d+(?:\.\d+)?\s*(?:kg|g\/㎡)/g, score: 80 },
        { re: /窓(?:付|付き|あり|なし|有|無)/g, score: 90 },
        { re: /(?:郵便番号枠|〒枠)(?:あり|なし|有|無)?/g, score: 90 },
        { re: /(?:センター貼り|サイド貼り|中貼り)/g, score: 88 },
        { re: /(?:片面|両面)(?:印刷)?/g, score: 86 },
        { re: /(?:黒|赤|青|緑|カラー|フルカラー|モノクロ)\s*\d*\s*色?/g, score: 82 },
        { re: /特色\s*\d+\s*色/g, score: 86 },
        { re: /(?:縦|横)\s*\d+(?:\.\d+)?\s*(?:mm|cm)/g, score: 80 },
        { re: /\d+(?:\.\d+)?\s*[×xX]\s*\d+(?:\.\d+)?\s*(?:mm|cm)/g, score: 86 },
        { re: /\d+(?:\.\d+)?\s*(?:ml|mL|L)/g, score: 84 },
        { re: /\d+\s*(?:本|枚|個)入/g, score: 84 },
        { re: /\d+\s*年保存/g, score: 90 },
      ];

      patterns.forEach(function(entry) {
        const matches = block.match(entry.re) || [];
        matches.forEach(function(value) {
          addTag_(value, Math.max(baseScore, entry.score), sourceName);
        });
      });
    }

    // 封筒案件は仕様書全文から封筒特有語を補完
    if (isEnvelope && doc.documentType === '仕様書') {
      const fullSize = detectEnvelopeSize_(text);
      if (fullSize) addTag_(fullSize, 96, sourceName);

      [
        /(?:クラフト|ケント|上質)(?:紙)?[^\s、。]{0,12}(?:\d+(?:\.\d+)?\s*(?:kg|g\/㎡))?/g,
        /窓(?:付|付き|あり|なし|有|無)/g,
        /(?:郵便番号枠|〒枠)(?:あり|なし|有|無)?/g,
        /(?:センター貼り|サイド貼り|中貼り)/g,
        /(?:片面|両面)(?:印刷)?/g,
        /(?:黒|カラー|フルカラー|モノクロ)\s*\d*\s*色?/g,
      ].forEach(function(pattern) {
        (text.match(pattern) || []).forEach(function(value) {
          addTag_(value, 88, sourceName);
        });
      });
    }
  });

  const best = {};
  weighted.forEach(function(entry) {
    if (!best[entry.value] || best[entry.value] < entry.score) {
      best[entry.value] = entry.score;
    }
  });

  const sorted = Object.keys(best)
    .map(function(value) { return { value: value, score: best[value] }; })
    .sort(function(a, b) { return b.score - a.score; });

  return {
    tags: sorted.slice(0, 20).map(function(entry) { return entry.value; }),
    tagScores: sorted.slice(0, 20),
    sourceFiles: uniqueNonEmpty_(sourceNames).slice(0, 10),
    confidence: sorted.length
      ? Math.round(sorted.reduce(function(sum, entry) { return sum + entry.score; }, 0) / sorted.length)
      : 0,
  };
}

function buildSpecificationText_(specInfo) {
  const tags = specInfo && specInfo.tags ? specInfo.tags : [];
  return tags.join('／');
}

function isBadItemNameCandidate_(value) {
  const name = cleanExtractedValue_(value);
  if (!name || isGenericHeading_(name)) return true;
  if (/^(?:\d{3,6}|[A-Z0-9._\/-]{6,}|EA|本|個|箱|セット|枚|式|台)$/i.test(name)) return true;
  if (/^[.\d]+$|^EA\s*\d/i.test(name)) return true;
  if (/^(?:又は|または)同等品以上$|^同等品(?:可|不可|申請可)$/.test(name)) return true;
  if (/^(?:令和|平成)?\d{1,4}[年.／/]\d{1,2}[月.／/]\d{1,2}日?$/.test(name)) return true;
  if (/(?:陸上|海上|航空)自衛隊|駐屯地|基地|庁舎|納入場所|納品場所|納地|発注機関|発注者/.test(name)) return true;
  if (/^(?:調達要求番号|物品番号|一連番号|番号|品目番号|契約実施計画番号)/.test(name)) return true;
  if (/^(?:数量|単位|品名|品目|規格|仕様|備考|No\.?\s*\d*)$/i.test(name)) return true;
  if (/リスト|オープンカウンター|見積り?合わせ|公告|提出方法|提出期限|見積期限|納期|納入期限/.test(name)) return true;
  return false;
}

function normalizeItemQuantity_(value) {
  const raw = normalizeAnalysisText_(value).replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return '';
  if (/^0\d{3,}$/.test(raw) && !/^0\.\d+$/.test(raw)) return '';
  const number = Number(raw);
  if (!isFinite(number)) return '';
  return String(number);
}

function extractInlineItemSpecification_(value, itemName) {
  const text = cleanExtractedValue_(value).replace(itemName || '', ' ').trim();
  const parts = [];
  [
    /\b(?=[A-Z0-9._\/-]{6,}\b)(?=[A-Z0-9._\/-]*[A-Z])(?=[A-Z0-9._\/-]*\d)[A-Z0-9._\/-]+\b/ig,
    /(?:又は|または)同等品以上|同等品(?:可|申請可)/g,
    /[^、。\n]{0,20}(?:味|色|寸法|サイズ|縦|横|厚さ|容量)[^、。\n]{0,30}/g,
  ].forEach(function(pattern) {
    (text.match(pattern) || []).forEach(function(part) {
      part = cleanExtractedValue_(part);
      if (part && !parts.includes(part)) parts.push(part);
    });
  });
  return parts;
}

function extractItemsDetail_(docs, titleValue) {
  const items = [];
  const seen = {};
  const unitPattern = '(枚|個|本|冊|箱|式|組|台|袋|巻|セット|着|足|kg|g|L|ml|部|ケース|束|EA)';
  const ordered = docs.slice().sort(function(a, b) {
    const rank = {
      '品目等内訳書': 1,
      '仕様書': 2,
      '別紙': 3,
      '見積依頼書': 4,
      '公告': 5,
      '見積書様式': 8,
      'その他': 9,
      '不明': 9,
    };
    return (rank[a.documentType] || 5) - (rank[b.documentType] || 5);
  });

  function addItem_(name, quantity, unit, doc, confidence, specificationHint) {
    let cleanName = cleanExtractedValue_(name)
      .replace(/^[（(]?\d+[）)]?\s*/, '')
      .replace(/(?:購入|調達|納入|製作)\s*$/, '')
      .trim();

    const cleanQuantity = normalizeItemQuantity_(quantity);
    const cleanUnit = String(unit || '').toUpperCase() === 'EA' ? 'EA' : String(unit || '');

    if (!cleanQuantity || isBadItemNameCandidate_(cleanName) || /令和|平成|第\d+条|期限|場所|資格|ページ|頁/.test(cleanName)) return;

    // 「角2封筒」などは品目と規格を分離
    let embeddedSize = detectEnvelopeSize_(cleanName);
    if (embeddedSize) {
      cleanName = cleanName.replace(/(?:角|長|洋)\s*[0-9]{1,2}\s*(?:形|号)?/, '').trim();
    }

    const key = cleanName + '|' + cleanQuantity + '|' + cleanUnit;
    if (seen[key]) return;
    seen[key] = true;

    const specInfo = extractSpecificationTags_(docs, cleanName, titleValue);
    extractInlineItemSpecification_(specificationHint || '', cleanName).forEach(function(spec) {
      if (!specInfo.tags.includes(spec)) specInfo.tags.unshift(spec);
    });
    if (embeddedSize && !specInfo.tags.includes(embeddedSize)) {
      specInfo.tags.unshift(embeddedSize);
    }

    items.push({
      name: truncate_(cleanName, 80),
      quantity: cleanQuantity,
      unit: cleanUnit,
      specification: buildSpecificationText_(specInfo),
      specificationTags: specInfo.tags,
      specificationSourceFiles: specInfo.sourceFiles,
      sourceType: doc ? doc.documentType : '案件名',
      sourceFileName: doc ? doc.fileName : '',
      confidence: Number(confidence || 0),
      specificationConfidence: Number(specInfo.confidence || 0),
    });
  }

  for (const doc of ordered) {
    const text = normalizeAnalysisText_(doc.ocrText || '');
    const patterns = [
      new RegExp('(?:品名|名称|品目)\\s*[:：]?\\s*([^\\n]{1,80})[\\s\\S]{0,160}?(?:数量|予定数量)\\s*[:：]?\\s*(\\d[\\d,.]*)\\s*' + unitPattern, 'gi'),
      new RegExp('([^\\n]{1,80}?)\\s+(\\d[\\d,.]*)\\s*' + unitPattern, 'gi'),
    ];

    patterns.forEach(function(pattern) {
      let match;
      while ((match = pattern.exec(text)) && items.length < 20) {
        addItem_(match[1], match[2], match[3], doc, 76, match[0]);
      }
    });

    // 崩れた表の「品名 / 商品番号 / 同等品注記 / 単位 / 数量」を近接行から復元する。
    const lines = getLines_(text);
    for (let i = 0; i < lines.length && items.length < 20; i++) {
      if (!/^\d{4}\s*$/.test(lines[i])) continue;
      const blockLines = [];
      for (let j = i; j < Math.min(lines.length, i + 7); j++) {
        if (j > i && /^\d{4}\s*$/.test(lines[j])) break;
        blockLines.push(lines[j]);
      }
      const block = blockLines.join(' ').replace(/^\d{4}\s+/, '');
      let match = block.match(new RegExp('\\b' + unitPattern + '\\s+(\\d+(?:\\.\\d+)?)\\b', 'i'));
      let unit = '';
      let quantity = '';
      if (match) {
        unit = match[1];
        quantity = match[2];
      } else {
        match = block.match(new RegExp('\\b(\\d+(?:\\.\\d+)?)\\s*' + unitPattern + '\\b', 'i'));
        if (match) {
          quantity = match[1];
          unit = match[2];
        }
      }
      if (!match) continue;

      let itemName = '';
      for (let j = 0; j < blockLines.length; j++) {
        let candidate = cleanExtractedValue_(blockLines[j])
          .replace(/^\d{4}\s+/, '')
          .replace(/^(?:品名|品目|名称)\s*[:：]?\s*/, '');
        candidate = candidate.split(/\s+(?=[A-Z0-9._\/-]{6,}\b)|\s+(?=(?:又は|または)同等品以上)|\s+(?=(?:EA|本|個|箱|セット|枚|式|台)\b)/i)[0];
        if (!isBadItemNameCandidate_(candidate)) {
          itemName = candidate;
          break;
        }
      }
      if (itemName) addItem_(itemName, quantity, unit, doc, 82, block);
    }
  }

  if (!items.length && titleValue) {
    const title = normalizeWideChars_(toSingleLine_(titleValue));
    const match = title.match(/^(.{1,60}?)\s*(\d[\d,]*)\s*(枚|個|本|冊|箱|式|組|台|袋|巻|セット|着|足|kg|g|L|ml|部|ケース|束|EA)\s*(?:購入|調達|納入|製作)?$/i);

    if (match) {
      addItem_(match[1], match[2], match[3], null, 88);
    }
  }

  return items;
}

function sourceValue_(value, doc, confidence) {
  return {
    value: value || '',
    sourceType: doc ? (doc.documentType || '') : '',
    sourceFileName: doc ? (doc.fileName || '') : '',
    documentId: doc ? (doc.documentId || '') : '',
    confidence: Number(confidence || 0),
  };
}

function detectCategoryAndFeatures_(title, docs, items) {
  const fileNames = docs.map(function(doc) {
    return doc.fileName || '';
  }).join('\n');

  const ocrBody = docs.map(function(doc) {
    return doc.ocrText || '';
  }).join('\n');

  const all = normalizeWideChars_(
    [title, fileNames, ocrBody].join('\n')
  );

  const scores = {
    '物品': 10,
    '印刷': 0,
    '防災・備蓄': 0,
    '食品': 0,
    'ノベルティ': 0,
    '役務': 0,
  };

  const features = [];

  [
    [/印刷/, 30],
    [/刷色|刷り込み|刷込/, 26],
    [/版下|入稿データ|印刷データ/, 24],
    [/校正/, 16],
    [/封筒[^\n]{0,80}(?:印|刷)/, 32],
    [/片面|両面|特色|オフセット/, 14],
    [/見積書.*印刷|仕様書.*印刷/, 18],
  ].forEach(function(signal) {
    if (signal[0].test(all)) scores['印刷'] += signal[1];
  });

  if (/印刷/.test(fileNames)) scores['印刷'] += 24;
  if (/封筒/.test(title) && /印刷|刷色|版下|校正|片面|両面/.test(all)) {
    scores['印刷'] += 28;
  }

  if (scores['印刷'] >= 24) features.push('印刷あり');
  if (/デザイン|データ作成|レイアウト|版下作成/.test(all)) {
    features.push('デザイン・データ作成あり');
  }
  if (/校正/.test(all)) features.push('校正あり');
  if (/色校正/.test(all)) features.push('色校正あり');

  if (/非常食|保存水|備蓄|防災|簡易トイレ/.test(all)) {
    scores['防災・備蓄'] += 55;
    features.push('防災・備蓄品');
  }

  if (/ノベルティ|キーホルダー|ぬいぐるみ|記念品|缶バッジ/.test(all)) {
    scores['ノベルティ'] += 50;
    features.push('ノベルティ');
  }

  if (/食品|飲料|精米|アルファ米|パン|缶詰|レトルト/.test(all)) {
    scores['食品'] += 42;
  }

  const serviceWords = [
    '清掃', '保守', '点検', '警備', '運転管理', '調査業務',
    '設計業務', '派遣', '受付業務', '剪定', '草刈',
    '修繕', '施工', '据付', '取付', '撤去'
  ];

  let serviceHits = 0;
  serviceWords.forEach(function(word) {
    if (all.indexOf(word) !== -1) serviceHits++;
  });

  scores['役務'] += serviceHits * 18;

  if (serviceHits >= 2 || /業務委託|役務の提供/.test(all)) {
    scores['役務'] += 24;
    features.push('作業あり');
  }

  if (/サンプル|見本品/.test(all)) {
    features.push('サンプル・見本品あり');
  }

  if (/複数(?:箇所|か所)|分納/.test(all)) {
    features.push('複数納品・分納');
  }

  if (scores['印刷'] >= 40) {
    scores['役務'] = Math.min(scores['役務'], scores['印刷'] - 15);
    scores['物品'] = Math.min(scores['物品'], scores['印刷'] - 10);
  }

  let category = '物品';
  Object.keys(scores).forEach(function(key) {
    if (scores[key] > scores[category]) category = key;
  });

  const tags = [];
  [
    '封筒', 'チラシ', 'ポスター', 'パンフレット', '冊子',
    '保存水', '非常食', '印刷', '同等品', '電子入札',
    '分納', '校正'
  ].forEach(function(word) {
    if (all.indexOf(word) !== -1) tags.push(word);
  });

  (items || []).slice(0, 5).forEach(function(item) {
    if (item.name && !tags.includes(item.name)) tags.push(item.name);
  });

  (items || []).forEach(function(item) {
    (item.specificationTags || []).forEach(function(tag) {
      if (!tags.includes(tag)) tags.push(tag);
    });
  });

  return {
    category: category,
    features: Array.from(new Set(features)),
    tags: Array.from(new Set(tags)).slice(0, 20),
  };
}

function detectAttachmentFlags_(docs) {
  const fileNames = docs.map(doc => String(doc.fileName || '')).join('\n');
  const ocrText = docs.map(doc => String(doc.ocrText || '')).join('\n');
  const uploadedTypes = docs.map(doc => doc.documentType || '不明');

  return {
    hasAttachments: docs.length > 1,
    hasSpecification: uploadedTypes.includes('仕様書') || /仕様書/.test(fileNames),
    hasAppendix: /別紙|別添/.test(fileNames),
    hasDrawing: /図面/.test(fileNames),
    hasPrintData: /印刷データ|版下データ|入稿データ|\.ai\b|Illustrator/i.test(fileNames),
    hasBreakdown: /内訳書|明細書/.test(fileNames),
    hasContractDraft: /契約書\s*[（(]?案[）)]?|契約書案/.test(fileNames),

    mentionedAppendix: /別紙|別添/.test(ocrText),
    mentionedDrawing: /図面/.test(ocrText),
    mentionedPrintData: /印刷データ|版下データ|入稿データ|Illustrator/i.test(ocrText),
    mentionedBreakdown: /内訳書|明細書/.test(ocrText),

    files: publicDocumentList_(docs),
  };
}

function makeSummary_(title, category, items, features, deliveryPlace) {
  const item = items && items[0];
  let subject = '';

  if (item && item.name) {
    subject = item.name;
    if (item.quantity) {
      subject += ' ' + Number(item.quantity).toLocaleString('ja-JP') + (item.unit || '');
    }
  } else {
    subject = title || '案件';
  }

  let action = 'を調達する';

  if (category === '印刷') {
    action = 'へ指定内容の印刷を行い納品する';
  } else if (category === '役務') {
    action = 'に関する業務を実施する';
  } else if (category === '防災・備蓄') {
    action = 'を防災備蓄品として納品する';
  } else if (category === 'ノベルティ') {
    action = 'を製作・納品する';
  }

  let summary = subject + action;
  const place = cleanExtractedValue_(deliveryPlace || '');

  if (place && place.length <= 100) {
    summary += '（納品先：' + place + '）';
  }

  return truncate_(summary + '案件。', 190);
}


function makeSafeSubmissionFallback_(orgValue) {
  const org = cleanExtractedValue_(orgValue || '');
  if (!org) return '';
  if (!/(事務所|地方整備局|会計隊|役所|役場|庁|局|部|課|室)/.test(org)) return '';
  return org;
}

function buildPhase2Detail_(sessionId, overrideGroupNumber) {
  const docs = getExtractDocuments_(sessionId, true);
  if (!docs.length) throw new Error('詳細を調べる資料が見つからないにゃん。');

  const understanding = prepareDocumentUnderstandingContext_(docs, overrideGroupNumber);
  const scopedDocs = understanding.scopedDocuments;
  const fullDocs = understanding.fullDocuments;
  const fullMerged = mergeKey3ForDocuments_(fullDocs);
  const scopedMerged = understanding.metadata.scopeApplied ? mergeKey3ForDocuments_(scopedDocs) : fullMerged;
  let title = extractTitleDetail_(scopedDocs);
  if (understanding.metadata.scopeApplied && understanding.metadata.scopedTitle) {
    title = sourceValue_(understanding.metadata.scopedTitle, null, understanding.metadata.scopedTitleConfidence);
  }
  const items = extractItemsDetail_(scopedDocs, title.value);
  const cf = detectCategoryAndFeatures_(title.value, scopedDocs, items);
  const deliveryPlace = extractDeliveryPlace_(scopedDocs);
  const deliveryMethod = extractDeliveryMethod_(scopedDocs);
  let submissionDeadline = extractSubmissionDeadline_(scopedDocs);
  let submissionDeadlineFromFull = false;
  if (!submissionDeadline.value && understanding.metadata.scopeApplied) {
    submissionDeadline = extractSubmissionDeadline_(fullDocs);
    submissionDeadlineFromFull = Boolean(submissionDeadline.value);
  }
  const submissionMethod = extractSubmissionMethod_(docs);
  let submissionTo = extractSubmissionTo_(docs);
  const taxTreatment = extractTaxTreatment_(docs);
  const equivalentStatus = extractEquivalentProduct_(scopedDocs);

  if (!submissionTo.value || /上記\s*\d+\s*に同じ|回答書|ホームページに掲載/.test(submissionTo.value)) {
    const fallback = makeSafeSubmissionFallback_(fullMerged.org && fullMerged.org.value);
    if (fallback) {
      submissionTo = sourceValue_(fallback, null, 68);
    }
  }

  const detail = {
    sessionId: sessionId,
    version: '2.2-Final',
    generatedAt: new Date().toISOString(),
    basic: {
      title: title,
      org: fullMerged.org,
      qualification: fullMerged.qualification,
      category: sourceValue_(cf.category, null, 70),
      summary: sourceValue_(makeSummary_(title.value, cf.category, items, cf.features, deliveryPlace.value), null, 78),
    },
    items: items,
    delivery: {
      deadline: scopedMerged.deadline,
      place: deliveryPlace,
      method: deliveryMethod,
    },
    submission: {
      deadline: submissionDeadline,
      method: submissionMethod,
      to: submissionTo,
      taxTreatment: taxTreatment,
    },
    equivalentProduct: {
      status: equivalentStatus,
      deadline: extractEquivalentDeadline_(scopedDocs),
    },
    attachments: detectAttachmentFlags_(fullDocs),
    features: cf.features,
    tags: cf.tags,
    confidence: {
      title: Number(title.confidence || 0),
      org: Number(fullMerged.org && fullMerged.org.confidence || 0),
      qualification: Number(fullMerged.qualification && fullMerged.qualification.confidence || 0),
      category: 88,
      summary: 82,
      items: items.length ? Math.round(items.reduce(function(sum, item) {
        return sum + Number(item.confidence || 0);
      }, 0) / items.length) : 0,
      specification: items.length ? Math.round(items.reduce(function(sum, item) {
        return sum + Number(item.specificationConfidence || 0);
      }, 0) / items.length) : 0,
      deliveryDeadline: Number(scopedMerged.deadline && scopedMerged.deadline.confidence || 0),
      deliveryPlace: Number(deliveryPlace.confidence || 0),
      deliveryMethod: Number(deliveryMethod.confidence || 0),
      submissionDeadline: Number(submissionDeadline.confidence || 0),
      submissionMethod: Number(submissionMethod.confidence || 0),
      submissionTo: Number(submissionTo.confidence || 0),
      taxTreatment: Number(taxTreatment.confidence || 0),
      equivalentProduct: Number(equivalentStatus.confidence || 0),
    },
    warnings: understanding.metadata.warnings.slice(),
    documents: publicDocumentList_(fullDocs),
    documentUnderstanding: understanding.metadata,
    fieldReasons: {
      title: understanding.metadata.scopeApplied ? '公告の対象行から取得' : '従来抽出へフォールバック',
      org: fullMerged.org && fullMerged.org.value ? '公告全文から推定' : '未検出',
      qualification: fullMerged.qualification && fullMerged.qualification.value ? '公告全文から推定' : '未検出',
      category: '案件名・品目から推定',
      summary: '案件名・品目から生成',
      items: items.length && items[0].sourceType === '品目等内訳書' ? '品目等内訳書から取得' : (items.length ? '対象資料から推定' : '未検出'),
      deliveryDeadline: scopedMerged.deadline && scopedMerged.deadline.value
        ? (understanding.metadata.scopeApplied ? '対象行・対象資料から取得' : '従来抽出へフォールバック') : '未検出',
      deliveryPlace: deliveryPlace.value ? '対象資料から取得' : '未検出',
      deliveryMethod: deliveryMethod.value ? '対象資料から取得' : '未検出',
      submissionDeadline: submissionDeadline.value
        ? (submissionDeadlineFromFull ? '公告全文から推定' : (understanding.metadata.scopeApplied ? '公告の対象行から取得' : '従来抽出へフォールバック')) : '未検出',
      submissionMethod: submissionMethod.value ? '公告全文から推定' : '未検出',
      submissionTo: submissionTo.value ? '公告全文から推定' : '未検出',
      taxTreatment: taxTreatment.value ? '公告全文から推定' : '未検出',
      equivalentProduct: equivalentStatus.value === '資料に記載なし・要確認'
        ? '未検出' : (understanding.metadata.scopeApplied ? '対象グループ資料から取得' : '従来抽出へフォールバック'),
    },
  };

  if (!detail.basic.title.value) detail.warnings.push('正式案件名を確認してにゃん。');
  if (!detail.items.length) detail.warnings.push('品目・数量をうまく抽出できなかったにゃん。手入力で確認してにゃん。');
  if (!detail.delivery.place.value) detail.warnings.push('納品場所が未検出にゃん。');
  if (!detail.submission.deadline.value) detail.warnings.push('提出期限が未検出にゃん。');
  if (detail.equivalentProduct.status.value === '資料に記載なし・要確認') detail.warnings.push('同等品可否は資料に明確な記載が見つからないにゃん。');

  return detail;
}

function savePhase2Json_(sessionId, detail) {
  const folder = getOrCreateTempFolder_();
  const sheet = getOrCreateExtractSessionSheet_();
  const found = findExtractSessionRow_(sheet, sessionId);
  if (!found) throw new Error('セッションが見つからないにゃん。');

  const oldId = found.rowValues[found.headerMap['Phase2_JSONファイルID'] - 1];
  if (oldId) trashFileIfExists_(String(oldId));

  const blob = Utilities.newBlob(
    JSON.stringify(detail, null, 2),
    'application/json',
    'Phase2_' + sessionId + '.json'
  );
  const file = folder.createFile(blob);
  sheet.getRange(found.row, found.headerMap['Phase2_JSONファイルID']).setValue(file.getId());
  sheet.getRange(found.row, found.headerMap['Phase2更新日時']).setValue(new Date());
  sheet.getRange(found.row, found.headerMap['ステータス']).setValue('phase2_draft');
  return file.getId();
}

function sanitizePhase2Payload_(payload) {
  const p = payload || {};
  const cleanText = v => truncate_(String(v || ''), 4000);
  const truncateLearning = function(value, limit) {
    const text = String(value || '');
    return text.length > limit ? text.slice(0, Math.max(0, limit - 1)) + '…' : text;
  };
  const cleanLearningValue = v => truncateLearning(v, 1000);
  const cleanLearningLabel = v => truncateLearning(v, 200);
  const cleanLearningSource = v => truncateLearning(v, 500);
  const cleanLearningReason = v => truncateLearning(v, 300);
  const understanding = p.documentUnderstanding || {};
  const learningContext = p.learningContext || {};
  const learningFields = learningContext.fields || {};
  const cleanItems = Array.isArray(p.items) ? p.items.slice(0, 50).map(i => ({
    name: cleanText(i.name),
    quantity: cleanText(i.quantity),
    unit: cleanText(i.unit),
    specification: cleanText(i.specification),
    specificationTags: Array.isArray(i.specificationTags)
      ? i.specificationTags.slice(0, 30).map(cleanText)
      : [],
    specificationSourceFiles: Array.isArray(i.specificationSourceFiles)
      ? i.specificationSourceFiles.slice(0, 20).map(cleanText)
      : [],
    specificationConfidence: Number(i.specificationConfidence || 0),
    sourceType: cleanText(i.sourceType),
    sourceFileName: cleanText(i.sourceFileName),
    confidence: Number(i.confidence || 0),
  })) : [];

  return {
    sessionId: cleanText(p.sessionId),
    version: '2.2-Final',
    savedAt: new Date().toISOString(),
    basic: {
      title: { value: cleanText(p.basic && p.basic.title && p.basic.title.value) },
      org: { value: cleanText(p.basic && p.basic.org && p.basic.org.value) },
      qualification: { value: cleanText(p.basic && p.basic.qualification && p.basic.qualification.value) },
      category: { value: cleanText(p.basic && p.basic.category && p.basic.category.value) },
      summary: { value: cleanText(p.basic && p.basic.summary && p.basic.summary.value) },
    },
    items: cleanItems,
    delivery: {
      deadline: { value: cleanText(p.delivery && p.delivery.deadline && p.delivery.deadline.value) },
      place: { value: cleanText(p.delivery && p.delivery.place && p.delivery.place.value) },
      method: { value: cleanText(p.delivery && p.delivery.method && p.delivery.method.value) },
    },
    submission: {
      deadline: { value: cleanText(p.submission && p.submission.deadline && p.submission.deadline.value) },
      method: { value: cleanText(p.submission && p.submission.method && p.submission.method.value) },
      to: { value: cleanText(p.submission && p.submission.to && p.submission.to.value) },
      taxTreatment: { value: cleanText(p.submission && p.submission.taxTreatment && p.submission.taxTreatment.value) },
    },
    equivalentProduct: {
      status: { value: cleanText(p.equivalentProduct && p.equivalentProduct.status && p.equivalentProduct.status.value) },
      deadline: { value: cleanText(p.equivalentProduct && p.equivalentProduct.deadline && p.equivalentProduct.deadline.value) },
    },
    attachments: p.attachments || {},
    features: Array.isArray(p.features) ? p.features.slice(0, 30).map(cleanText) : [],
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 30).map(cleanText) : [],
    confidence: p.confidence || {},
    warnings: Array.isArray(p.warnings) ? p.warnings.slice(0, 30).map(cleanText) : [],
    documents: Array.isArray(p.documents) ? p.documents.slice(0, 30) : [],
    documentUnderstanding: {
      groupNumber: cleanText(understanding.groupNumber),
      groupNumberSource: cleanText(understanding.groupNumberSource),
      groupNumberConfidence: Number(understanding.groupNumberConfidence || 0),
      groupNumberCandidates: Array.isArray(understanding.groupNumberCandidates)
        ? understanding.groupNumberCandidates.slice(0, 30).map(cleanText) : [],
      needsGroupConfirmation: Boolean(understanding.needsGroupConfirmation),
      scopedTitle: cleanText(understanding.scopedTitle),
      scopedTitleConfidence: Number(understanding.scopedTitleConfidence || 0),
      scopeApplied: Boolean(understanding.scopeApplied),
      warnings: Array.isArray(understanding.warnings) ? understanding.warnings.slice(0, 30).map(cleanText) : [],
    },
    fieldReasons: Object.keys(p.fieldReasons || {}).reduce(function(out, key) {
      out[cleanText(key)] = cleanText(p.fieldReasons[key]);
      return out;
    }, {}),
    learningContext: {
      agencyName: cleanLearningReason(learningContext.agencyName),
      fields: LEARNING_TARGET_FIELD_KEYS.reduce(function(out, fieldKey) {
        const field = learningFields[fieldKey] || {};
        out[fieldKey] = {
          originalText: cleanLearningValue(field.originalText),
          extractedValue: cleanLearningValue(field.extractedValue),
          correctedValue: cleanLearningValue(field.correctedValue),
          sourceLabel: cleanLearningLabel(field.sourceLabel),
          sourceText: cleanLearningSource(field.sourceText),
          reason: cleanLearningReason(field.reason),
        };
        return out;
      }, {}),
    },
  };
}

function normalizeLearningComparisonText_(value) {
  let text = String(value == null ? '' : value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text.replace(/[\s\u3000]+/g, ' ').trim();
}

function normalizeSubmissionMethodsForComparison_(value) {
  const text = normalizeLearningComparisonText_(value)
    .replace(/電子\s*メール/gi, '電子メール')
    .replace(/E\s*メール/gi, 'Eメール');
  const known = [];
  const pattern = /電子メール|Eメール|FAX|ファクス|郵送|持参|窓口|電子調達|オンライン|メール/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) known.push(match[0].toUpperCase());
  const residual = text.replace(pattern, ' ')
    .replace(/[\s,，、・;；:：/／|｜]+/g, ' ')
    .trim();
  const tokens = known.concat(residual ? [residual] : []);
  return Array.from(new Set(tokens)).sort().join('|');
}

function isMeaningfulLearningChange_(fieldKey, extractedValue, correctedValue) {
  const before = fieldKey === 'submission.method'
    ? normalizeSubmissionMethodsForComparison_(extractedValue)
    : normalizeLearningComparisonText_(extractedValue);
  const after = fieldKey === 'submission.method'
    ? normalizeSubmissionMethodsForComparison_(correctedValue)
    : normalizeLearningComparisonText_(correctedValue);
  return before !== after;
}

function learningEditDistance_(a, b) {
  const left = Array.from(normalizeLearningComparisonText_(a));
  const right = Array.from(normalizeLearningComparisonText_(b));
  const previous = right.map(function(_, index) { return index + 1; });
  previous.unshift(0);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j < current.length; j++) previous[j] = current[j];
  }
  return previous[right.length];
}

function classifyLearningCorrection_(fieldKey, field) {
  const before = normalizeLearningComparisonText_(field.extractedValue);
  const after = normalizeLearningComparisonText_(field.correctedValue);
  if (!before || !after) return 'value_correction';
  if (fieldKey === 'delivery.date' || fieldKey === 'submission.deadline') {
    return 'value_correction';
  }

  const distance = learningEditDistance_(before, after);
  if (before.length >= 3 && after.length >= 3 && distance === 1) {
    return 'ocr_correction';
  }

  const hasHeadingEvidence = Boolean(normalizeLearningComparisonText_(field.sourceLabel)) &&
    /見出し|ラベル|項目名|同義|類義/.test(String(field.reason || ''));
  if (hasHeadingEvidence) return 'synonym';
  return 'value_correction';
}

function detectAgencyType_(agencyName) {
  const name = normalizeLearningComparisonText_(agencyName);
  if (!name) return '未判定';
  if (/(?:陸上|海上|航空)自衛隊|駐屯地|基地/.test(name)) return '自衛隊';
  if (/都|道|府|県|市|区|町|村/.test(name)) return '自治体';
  if (/省|庁|局|裁判所|国立|独立行政法人/.test(name)) return '国・独立行政法人';
  return 'その他';
}

function buildOcrCorrectionLogs_(caseId, sessionId, clean) {
  if (!String(caseId || '').trim() || !String(sessionId || '').trim()) {
    throw new Error('修正ログ識別子が不足しています');
  }
  const context = clean.learningContext || {};
  const fields = context.fields || {};
  const agencyName = String(context.agencyName || clean.basic && clean.basic.org && clean.basic.org.value || '');
  const agencyType = detectAgencyType_(agencyName);
  const createdAt = new Date().toISOString();

  return LEARNING_TARGET_FIELD_KEYS.reduce(function(logs, fieldKey) {
    const field = fields[fieldKey] || {};
    if (!isMeaningfulLearningChange_(fieldKey, field.extractedValue, field.correctedValue)) return logs;
    logs.push({
      logId: Utilities.getUuid(),
      caseId: String(caseId || ''),
      sessionId: String(sessionId || ''),
      fieldKey: fieldKey,
      originalText: String(field.originalText || ''),
      extractedValue: String(field.extractedValue || ''),
      correctedValue: String(field.correctedValue || ''),
      learningType: classifyLearningCorrection_(fieldKey, field),
      agencyType: agencyType,
      agencyName: agencyName,
      sourceLabel: String(field.sourceLabel || ''),
      sourceText: String(field.sourceText || ''),
      reason: String(field.reason || ''),
      createdAt: createdAt,
    });
    return logs;
  }, []);
}

function getOrCreateOcrCorrectionLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OCR_CORRECTION_LOG_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(OCR_CORRECTION_LOG_SHEET_NAME);
  const currentHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) {
        return String(value || '').trim();
      })
    : [];
  OCR_CORRECTION_LOG_HEADERS.forEach(function(header) {
    if (!currentHeaders.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      currentHeaders.push(header);
    }
  });
  const finalHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(value) { return String(value || '').trim(); });
  OCR_CORRECTION_LOG_HEADERS.forEach(function(header) {
    const count = finalHeaders.filter(function(value) { return value === header; }).length;
    if (count !== 1) throw new Error('OCR修正ログのヘッダーが競合しています: ' + header);
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function escapeOcrCorrectionLogCell_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function saveOcrCorrectionLogs_(logs) {
  if (!Array.isArray(logs) || !logs.length) return 0;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('OCR修正ログの書き込みロックを取得できませんでした');
  try {
    const sheet = getOrCreateOcrCorrectionLogSheet_();
    const headerMap = {};
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach(function(header, index) {
      headerMap[String(header || '').trim()] = index;
    });
    const rows = logs.map(function(log) {
      const row = new Array(sheet.getLastColumn()).fill('');
      OCR_CORRECTION_LOG_HEADERS.forEach(function(header) {
        if (headerMap[header] != null) {
          row[headerMap[header]] = escapeOcrCorrectionLogCell_(log[header]);
        }
      });
      return row;
    });
    const targetRange = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, sheet.getLastColumn());
    targetRange.setNumberFormat('@');
    targetRange.setValues(rows);
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

function semanticFieldLabel_(fieldKey) {
  return {
    'delivery.place': '納品場所',
    'delivery.date': '納期',
    'submission.deadline': '提出期限',
    'submission.method': '提出方法',
  }[fieldKey] || '';
}

function buildLearningReviewCandidateFromLog_(log) {
  log = log || {};
  const logId = String(log.logId || '').trim();
  const caseId = String(log.caseId || '').trim();
  const fieldKey = String(log.fieldKey || '').trim();
  const learningType = String(log.learningType || '').trim();
  if (!logId || !caseId || !LEARNING_TARGET_FIELD_KEYS.includes(fieldKey)) return null;

  let term = '';
  let correctedTerm = '';
  if (learningType === 'ocr_correction') {
    term = normalizeLearningComparisonText_(log.extractedValue);
    correctedTerm = normalizeLearningComparisonText_(log.correctedValue);
    if (!term || !correctedTerm || learningEditDistance_(term, correctedTerm) !== 1) return null;
  } else if (learningType === 'synonym') {
    const sourceLabel = normalizeLearningComparisonText_(log.sourceLabel);
    if (!sourceLabel || !/見出し|ラベル|項目名|同義|類義/.test(String(log.reason || ''))) return null;
    term = semanticFieldLabel_(fieldKey);
    correctedTerm = sourceLabel;
  } else {
    return null;
  }

  const agencyType = normalizeLearningComparisonText_(log.agencyType) || '未判定';
  const candidateKey = JSON.stringify([fieldKey, learningType, agencyType, term, correctedTerm]
    .map(normalizeLearningComparisonText_));
  return {
    candidateId: logId,
    logId: logId,
    caseId: caseId,
    fieldKey: fieldKey,
    semanticKey: fieldKey,
    learningType: learningType,
    term: term,
    correctedTerm: correctedTerm,
    agencyType: agencyType,
    agencyName: String(log.agencyName || ''),
    candidateKey: candidateKey,
  };
}

function buildLearningReviewCandidates_(logs) {
  return (Array.isArray(logs) ? logs : [])
    .map(buildLearningReviewCandidateFromLog_)
    .filter(Boolean)
    .map(function(candidate) {
      return {
        candidateId: candidate.candidateId,
        logId: candidate.logId,
        caseId: candidate.caseId,
        fieldKey: candidate.fieldKey,
        semanticKey: candidate.semanticKey,
        learningType: candidate.learningType,
        term: candidate.term,
        correctedTerm: candidate.correctedTerm,
        agencyType: candidate.agencyType,
      };
    });
}

function getValidatedLearningHeaderMap_(sheet, requiredHeaders, sheetName) {
  if (!sheet || sheet.getLastColumn() < 1) throw new Error(sheetName + 'のヘッダーがありません');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(value) { return String(value || '').trim(); });
  const map = {};
  requiredHeaders.forEach(function(header) {
    const positions = [];
    headers.forEach(function(value, index) { if (value === header) positions.push(index); });
    if (positions.length !== 1) throw new Error(sheetName + 'のヘッダーが競合しています: ' + header);
    map[header] = positions[0];
  });
  return map;
}

function getOrCreateLearningSheet_(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  const currentHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function(value) { return String(value || '').trim(); })
    : [];
  headers.forEach(function(header) {
    if (!currentHeaders.includes(header)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      currentHeaders.push(header);
    }
  });
  getValidatedLearningHeaderMap_(sheet, headers, sheetName);
  sheet.setFrozenRows(1);
  return sheet;
}

function learningRowToObject_(headers, row) {
  const out = {};
  headers.forEach(function(header, index) { out[String(header || '').trim()] = row[index]; });
  return out;
}

function findOcrCorrectionLogForDecision_(caseId, logId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OCR_CORRECTION_LOG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('対象のOCR修正ログが見つかりません');
  const headerMap = getValidatedLearningHeaderMap_(sheet, OCR_CORRECTION_LOG_HEADERS, OCR_CORRECTION_LOG_SHEET_NAME);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][headerMap.logId] || '').trim() === logId &&
        String(rows[i][headerMap.caseId] || '').trim() === caseId) {
      return learningRowToObject_(headers, rows[i]);
    }
  }
  throw new Error('案件と一致するOCR修正ログが見つかりません');
}

function findLearningDecisionByLogId_(sheet, logId) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const headerMap = getValidatedLearningHeaderMap_(sheet, LEARNING_DECISION_HEADERS, LEARNING_DECISION_SHEET_NAME);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][headerMap.logId] || '').trim() === logId) {
      return learningRowToObject_(headers, rows[i]);
    }
  }
  return null;
}

function appendLearningObject_(sheet, headers, value) {
  const headerMap = getValidatedLearningHeaderMap_(sheet, headers, sheet.getName());
  const row = new Array(sheet.getLastColumn()).fill('');
  headers.forEach(function(header) {
    row[headerMap[header]] = escapeOcrCorrectionLogCell_(value[header]);
  });
  const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, sheet.getLastColumn());
  range.setNumberFormat('@');
  range.setValues([row]);
}

function upsertLearningCandidate_(candidate) {
  const sheet = getOrCreateLearningSheet_(LEARNING_CANDIDATE_SHEET_NAME, LEARNING_CANDIDATE_HEADERS);
  const headerMap = getValidatedLearningHeaderMap_(sheet, LEARNING_CANDIDATE_HEADERS, LEARNING_CANDIDATE_SHEET_NAME);
  const now = new Date().toISOString();
  if (sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][headerMap.candidateKey] || '') === candidate.candidateKey) {
        const rowNumber = i + 2;
        ['updatedAt', 'lastCaseId', 'lastLogId'].forEach(function(header) {
          const range = sheet.getRange(rowNumber, headerMap[header] + 1);
          range.setNumberFormat('@');
          range.setValue(escapeOcrCorrectionLogCell_(
            header === 'updatedAt' ? now : (header === 'lastCaseId' ? candidate.caseId : candidate.logId)
          ));
        });
        return { created: false };
      }
    }
  }
  appendLearningObject_(sheet, LEARNING_CANDIDATE_HEADERS, {
    candidateKey: candidate.candidateKey,
    candidateId: candidate.candidateId,
    firstLogId: candidate.logId,
    term: candidate.term,
    correctedTerm: candidate.correctedTerm,
    semanticKey: candidate.semanticKey,
    learningType: candidate.learningType,
    agencyType: candidate.agencyType,
    agencyName: candidate.agencyName,
    status: 'candidate',
    createdAt: now,
    updatedAt: now,
    lastCaseId: candidate.caseId,
    lastLogId: candidate.logId,
  });
  return { created: true };
}

function appendLearningDecision_(sheet, candidate, decision) {
  appendLearningObject_(sheet, LEARNING_DECISION_HEADERS, {
    decisionId: Utilities.getUuid(),
    candidateId: candidate.candidateId,
    logId: candidate.logId,
    candidateKey: candidate.candidateKey,
    caseId: candidate.caseId,
    fieldKey: candidate.fieldKey,
    decision: decision,
    term: candidate.term,
    correctedTerm: candidate.correctedTerm,
    learningType: candidate.learningType,
    agencyType: candidate.agencyType,
    agencyName: candidate.agencyName,
    createdAt: new Date().toISOString(),
  });
}

function api_recordLearningDecision(caseId, decisionPayload) {
  const safeCaseId = String(caseId || '').trim();
  const payload = decisionPayload || {};
  const candidateId = String(payload.candidateId || '').trim();
  const decision = String(payload.decision || '').trim();
  if (!safeCaseId || safeCaseId.length > 100 || !candidateId || candidateId.length > 100) {
    return apiError_('学習候補を特定できなかったにゃん。');
  }
  if (!LEARNING_DECISIONS.includes(decision)) return apiError_('学習候補の操作が正しくないにゃん。');

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return apiError_('学習候補を記録できなかったにゃん。案件登録は完了しています。');
  try {
    const log = findOcrCorrectionLogForDecision_(safeCaseId, candidateId);
    const candidate = buildLearningReviewCandidateFromLog_(log);
    if (!candidate || candidate.caseId !== safeCaseId) return apiError_('この修正は学習候補の対象ではないにゃん。');

    const decisionSheet = getOrCreateLearningSheet_(LEARNING_DECISION_SHEET_NAME, LEARNING_DECISION_HEADERS);
    const existing = findLearningDecisionByLogId_(decisionSheet, candidate.logId);
    if (existing) {
      return apiOk_({
        candidateId: candidate.candidateId,
        decision: String(existing.decision || ''),
        alreadyRecorded: true,
      });
    }

    if (decision === 'register') upsertLearningCandidate_(candidate);
    appendLearningDecision_(decisionSheet, candidate, decision);
    return apiOk_({candidateId: candidate.candidateId, decision: decision, alreadyRecorded: false});
  } catch (e) {
    Logger.log('api_recordLearningDecision error: ' + e.stack);
    return apiError_('学習候補を記録できなかったにゃん。案件登録は完了しています。');
  } finally {
    lock.releaseLock();
  }
}

function getSemanticRegistryEntry_(semanticKey) {
  const key = String(semanticKey || '').trim();
  return SEMANTIC_KEY_REGISTRY.find(function(entry) {
    return entry.semanticKey === key && entry.status === 'active';
  }) || null;
}

function normalizeSemanticTerm_(value) {
  return normalizeLearningComparisonText_(value).replace(/[：:]+$/g, '').trim();
}

function semanticHeadingDefinitions_() {
  return [
    {
      semanticKey: 'delivery.place',
      terms: ['引渡場所', '引渡し場所', '搬入場所', '納入場所', '納品場所', '納地', '履行場所'],
      mediumTerms: ['納地'],
    },
    {
      semanticKey: 'delivery.date',
      terms: ['引渡年月日', '引渡期限', '履行期限', '履行期間', '納期'],
      mediumTerms: ['履行期間'],
    },
    {
      semanticKey: 'submission.deadline',
      terms: ['見積書提出期限', '見積提出期限', '入札書提出期限', '提出期限'],
      mediumTerms: ['提出期限'],
    },
    {
      semanticKey: 'submission.method',
      terms: ['見積書提出方法', '見積提出方法', '入札方法', '提出方法', '提出手段'],
      mediumTerms: ['入札方法', '提出方法'],
    },
    {
      semanticKey: 'question.deadline',
      terms: ['質問書提出期限', '質問提出期限', '質問受付期限', '質疑期限'],
      mediumTerms: [],
    },
  ];
}

function buildSemanticKeyOptions_(suggestedSemanticKey) {
  const suggested = getSemanticRegistryEntry_(suggestedSemanticKey);
  const ordered = [];
  if (suggested) ordered.push(suggested);
  SEMANTIC_KEY_REGISTRY.forEach(function(entry) {
    if (entry.status !== 'active' || ordered.some(function(item) { return item.semanticKey === entry.semanticKey; })) return;
    if (suggested && entry.category === suggested.category) ordered.push(entry);
  });
  SEMANTIC_KEY_REGISTRY.forEach(function(entry) {
    if (entry.status === 'active' && !ordered.some(function(item) { return item.semanticKey === entry.semanticKey; })) {
      ordered.push(entry);
    }
  });
  return ordered.slice(0, 4).map(function(entry) {
    return { semanticKey: entry.semanticKey, displayName: entry.displayName };
  });
}

function compactSemanticEvidence_(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  return truncate_(lines.slice(start, end).map(function(line) {
    return normalizeLearningComparisonText_(line);
  }).filter(Boolean).join('\n'), 300);
}

function buildSemanticHeadingCandidates_(caseId, docs, agencyName) {
  const safeCaseId = String(caseId || '').trim();
  if (!safeCaseId || !Array.isArray(docs) || !docs.length) return [];
  const definitions = semanticHeadingDefinitions_();
  const agency = truncate_(String(agencyName || ''), 300);
  const agencyType = detectAgencyType_(agency);
  const seen = {};
  const candidates = [];

  docs.forEach(function(doc) {
    const text = String(doc && doc.ocrText || '').replace(/\r\n?/g, '\n');
    const documentType = truncate_(String(doc && doc.documentType || 'その他'), 100);
    const pages = text.split(/\f/);
    pages.forEach(function(pageText, pageIndex) {
      const lines = String(pageText || '').split('\n');
      lines.forEach(function(rawLine, lineIndex) {
        const line = normalizeLearningComparisonText_(rawLine);
        if (!line || line.length > 180) return;
        const matches = [];
        definitions.forEach(function(definition) {
          definition.terms.forEach(function(term) {
            const index = line.indexOf(term);
            if (index >= 0) matches.push({definition: definition, term: term, index: index});
          });
        });
        if (!matches.length) return;
        matches.sort(function(a, b) { return b.term.length - a.term.length || a.index - b.index; });
        const best = matches[0];
        const definition = best.definition;
        const matchedTerm = best.term;
        const normalizedTerm = normalizeSemanticTerm_(matchedTerm);
        if (!normalizedTerm || normalizedTerm.length > 60) return;
        const duplicateKey = JSON.stringify([normalizedTerm, safeCaseId, documentType, normalizedTerm]);
        if (seen[duplicateKey]) return;
        seen[duplicateKey] = true;
        const suffix = line.slice(best.index + matchedTerm.length).replace(/^[\s:：・-]+/, '');
        const confidence = definition.mediumTerms.includes(matchedTerm) ? 'medium' : 'high';
        candidates.push({
          candidateId: Utilities.getUuid(),
          caseId: safeCaseId,
          term: matchedTerm,
          normalizedTerm: normalizedTerm,
          suggestedSemanticKey: definition.semanticKey,
          selectedSemanticKey: '',
          documentType: documentType,
          sourceLabel: matchedTerm,
          relation: suffix ? 'inline' : 'below',
          sourceText: compactSemanticEvidence_(lines, lineIndex),
          pageNumber: pages.length > 1 ? String(pageIndex + 1) : '',
          agencyType: agencyType,
          agencyName: agency,
          scope: 'unassigned',
          status: 'pending',
          confidence: confidence,
        });
      });
    });
  });
  return candidates.slice(0, 6);
}

function semanticCandidateDuplicateKey_(candidate) {
  return JSON.stringify([
    normalizeSemanticTerm_(candidate.normalizedTerm || candidate.term),
    String(candidate.caseId || '').trim(),
    String(candidate.documentType || '').trim(),
    normalizeSemanticTerm_(candidate.sourceLabel),
  ]);
}

function ensureSemanticDictionarySheet_() {
  return getOrCreateLearningSheet_(SEMANTIC_DICTIONARY_SHEET_NAME, SEMANTIC_DICTIONARY_HEADERS);
}

function saveSemanticLearningCandidates_(candidates) {
  candidates = Array.isArray(candidates) ? candidates : [];
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('にゃん語辞典候補の書き込みロックを取得できませんでした');
  try {
    const sheet = getOrCreateLearningSheet_(SEMANTIC_LEARNING_CANDIDATE_SHEET_NAME, SEMANTIC_LEARNING_CANDIDATE_HEADERS);
    ensureSemanticDictionarySheet_();
    if (!candidates.length) return [];
    const headerMap = getValidatedLearningHeaderMap_(sheet, SEMANTIC_LEARNING_CANDIDATE_HEADERS, SEMANTIC_LEARNING_CANDIDATE_SHEET_NAME);
    const existingKeys = {};
    if (sheet.getLastRow() >= 2) {
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
      rows.forEach(function(row) {
        existingKeys[semanticCandidateDuplicateKey_({
          normalizedTerm: row[headerMap.normalizedTerm],
          caseId: row[headerMap.caseId],
          documentType: row[headerMap.documentType],
          sourceLabel: row[headerMap.sourceLabel],
        })] = true;
      });
    }
    const saved = [];
    candidates.forEach(function(candidate) {
      const duplicateKey = semanticCandidateDuplicateKey_(candidate);
      if (existingKeys[duplicateKey]) return;
      const now = new Date().toISOString();
      appendLearningObject_(sheet, SEMANTIC_LEARNING_CANDIDATE_HEADERS, {
        candidateId: candidate.candidateId,
        caseId: candidate.caseId,
        term: truncate_(candidate.term, 100),
        normalizedTerm: truncate_(candidate.normalizedTerm, 100),
        suggestedSemanticKey: candidate.suggestedSemanticKey,
        selectedSemanticKey: '',
        documentType: truncate_(candidate.documentType, 100),
        sourceLabel: truncate_(candidate.sourceLabel, 100),
        relation: truncate_(candidate.relation, 30),
        sourceText: truncate_(candidate.sourceText, 300),
        pageNumber: truncate_(candidate.pageNumber, 20),
        agencyType: truncate_(candidate.agencyType, 100),
        agencyName: truncate_(candidate.agencyName, 300),
        scope: 'unassigned',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        decidedAt: '',
      });
      existingKeys[duplicateKey] = true;
      saved.push(candidate);
    });
    return saved;
  } finally {
    lock.releaseLock();
  }
}

function buildSemanticReviewResponse_(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map(function(candidate) {
    return {
      candidateId: candidate.candidateId,
      term: candidate.term,
      documentType: candidate.documentType,
      sourceText: candidate.sourceText,
      suggestedSemanticKey: candidate.suggestedSemanticKey,
      preselectedSemanticKey: candidate.confidence === 'high' ? candidate.suggestedSemanticKey : '',
      semanticKeyOptions: buildSemanticKeyOptions_(candidate.suggestedSemanticKey),
    };
  });
}

function findSemanticLearningCandidate_(caseId, candidateId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SEMANTIC_LEARNING_CANDIDATE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('にゃん語辞典候補が見つかりません');
  const headerMap = getValidatedLearningHeaderMap_(sheet, SEMANTIC_LEARNING_CANDIDATE_HEADERS, SEMANTIC_LEARNING_CANDIDATE_SHEET_NAME);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][headerMap.candidateId] || '').trim() === candidateId &&
        String(rows[i][headerMap.caseId] || '').trim() === caseId) {
      return { sheet: sheet, headerMap: headerMap, rowNumber: i + 2, value: learningRowToObject_(headers, rows[i]) };
    }
  }
  throw new Error('案件と一致するにゃん語辞典候補が見つかりません');
}

function setSemanticCandidateDecision_(found, decision, selectedSemanticKey) {
  const statusMap = {
    teach: 'candidate',
    defer: 'deferred',
    not_heading: 'rejected',
    unmapped: 'unmapped',
  };
  const now = new Date().toISOString();
  const values = {
    selectedSemanticKey: decision === 'teach' ? selectedSemanticKey : '',
    status: statusMap[decision],
    updatedAt: now,
    decidedAt: now,
  };
  Object.keys(values).forEach(function(header) {
    const range = found.sheet.getRange(found.rowNumber, found.headerMap[header] + 1);
    range.setNumberFormat('@');
    range.setValue(escapeOcrCorrectionLogCell_(values[header]));
  });
  return values.status;
}

function api_recordSemanticCandidateDecision(caseId, decisionPayload) {
  const safeCaseId = String(caseId || '').trim();
  const payload = decisionPayload || {};
  const candidateId = String(payload.candidateId || '').trim();
  const decision = String(payload.decision || '').trim();
  const selectedSemanticKey = String(payload.selectedSemanticKey || '').trim();
  if (!safeCaseId || safeCaseId.length > 100 || !candidateId || candidateId.length > 100) {
    return apiError_('にゃん語辞典候補を特定できなかったにゃん。');
  }
  if (!SEMANTIC_CANDIDATE_DECISIONS.includes(decision)) {
    return apiError_('にゃん語辞典の操作が正しくないにゃん。');
  }
  if (decision === 'teach' && !getSemanticRegistryEntry_(selectedSemanticKey)) {
    return apiError_('選択した意味は、にゃん語辞典で使用できないにゃん。');
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return apiError_('にゃん語辞典候補を記録できなかったにゃん。案件登録は完了しています。');
  try {
    const found = findSemanticLearningCandidate_(safeCaseId, candidateId);
    const currentStatus = String(found.value.status || '').trim();
    if (currentStatus !== 'pending') {
      return apiOk_({
        candidateId: candidateId,
        decision: decision,
        status: currentStatus,
        alreadyRecorded: true,
      });
    }
    const status = setSemanticCandidateDecision_(found, decision, selectedSemanticKey);
    return apiOk_({candidateId: candidateId, decision: decision, status: status, alreadyRecorded: false});
  } catch (e) {
    Logger.log('api_recordSemanticCandidateDecision error: ' + e.stack);
    return apiError_('にゃん語辞典候補を記録できなかったにゃん。案件登録は完了しています。');
  } finally {
    lock.releaseLock();
  }
}

function api_savePhase2Draft(sessionId, payload) {
  try {
    if (!sessionId) return apiError_('セッションIDがないにゃん。');
    const clean = sanitizePhase2Payload_(payload);
    clean.sessionId = sessionId;
    const jsonFileId = savePhase2Json_(sessionId, clean);
    return apiOk_({
      sessionId: sessionId,
      jsonFileId: jsonFileId,
      message: '入力内容を保存したにゃん！次は案件登録へ進めるにゃん🐈',
    });
  } catch (e) {
    Logger.log('api_savePhase2Draft error: ' + e.stack);
    return apiError_('Phase2の保存でエラーにゃん：' + e.message);
  }
}




// ── Phase2.3 / v0.9.0：案件カルテ確認後の正式登録 ─────────────

function phase2PayloadToOcrResult_(clean, docs) {
  const firstItem = clean.items && clean.items.length ? clean.items[0] : {};
  const equivalentText = clean.equivalentProduct && clean.equivalentProduct.status
    ? clean.equivalentProduct.status.value : '';
  let equivalentAllowed = null;
  if (/不可|認めない/.test(equivalentText)) equivalentAllowed = false;
  else if (/可|可能/.test(equivalentText)) equivalentAllowed = true;

  return {
    title: clean.basic.title.value,
    summary: clean.basic.summary.value,
    org: clean.basic.org.value,
    category: clean.basic.category.value,
    qualification: clean.basic.qualification.value,
    items: (clean.items || []).map(function(item) {
      return {
        name: item.name || '',
        specification: item.specification || '',
        quantity: item.quantity || '',
        unit: item.unit || ''
      };
    }),
    itemName: firstItem.name || '',
    specification: firstItem.specification || '',
    quantity: firstItem.quantity || '',
    unit: firstItem.unit || '',
    submissionDeadline: clean.submission.deadline.value,
    submissionMethod: clean.submission.method.value,
    submissionDestination: clean.submission.to.value,
    deliveryDate: clean.delivery.deadline.value,
    deliveryPlace: clean.delivery.place.value,
    deliveryMethod: clean.delivery.method.value,
    equivalentAllowed: equivalentAllowed,
    equivalentProductNote: equivalentText || '資料に記載なし・要確認',
    attachments: (docs || []).map(function(doc) {
      return {
        type: doc.documentType || 'other',
        name: doc.fileName || '資料',
        fileId: doc.pdfFileId || '',
        url: doc.pdfFileId ? DriveApp.getFileById(doc.pdfFileId).getUrl() : ''
      };
    }),
    ocrEngine: 'Google Drive OCR',
    ocrVersion: '2.3-web-v0.9.0',
    rawPhase2: clean
  };
}

function makeUniqueFileNameInFolder_(folder, requestedName) {
  let name = String(requestedName || 'document.pdf').replace(/[\\/:*?"<>|]/g, '_');
  if (!folder.getFilesByName(name).hasNext()) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (folder.getFilesByName(stem + '_' + n + ext).hasNext()) n++;
  return stem + '_' + n + ext;
}

function copyAdditionalSessionDocuments_(docs, registrationResult) {
  if (!registrationResult || !registrationResult.caseJson) return [];
  const source = registrationResult.caseJson.source || {};
  const originalFolderId = source.subfolderIds && source.subfolderIds['01_原本'];
  if (!originalFolderId) return [];
  const folder = DriveApp.getFolderById(originalFolderId);
  const copied = [];

  (docs || []).slice(1).forEach(function(doc) {
    if (!doc.pdfFileId) return;
    const original = DriveApp.getFileById(doc.pdfFileId);
    const name = makeUniqueFileNameInFolder_(folder, doc.fileName || original.getName());
    const file = original.makeCopy(name, folder);
    copied.push({ id:file.getId(), url:file.getUrl(), name:file.getName(), documentType:doc.documentType || '不明' });
  });
  return copied;
}

function finalizeRegisteredCaseJson_(registrationResult, docs, additionalFiles) {
  const caseJson = registrationResult.caseJson;
  caseJson.status = 'registered';
  caseJson.attachments = [];

  (docs || []).forEach(function(doc, index) {
    let fileInfo = null;
    if (index === 0 && registrationResult.registration.savedFiles && registrationResult.registration.savedFiles.original) {
      fileInfo = registrationResult.registration.savedFiles.original;
    } else if (index > 0) {
      fileInfo = (additionalFiles || [])[index - 1] || null;
    }
    caseJson.attachments.push({
      type: doc.documentType || 'other',
      name: doc.fileName || (fileInfo && fileInfo.name) || '資料',
      fileId: fileInfo ? fileInfo.id : '',
      url: fileInfo ? fileInfo.url : ''
    });
  });
  caseJson.audit.updatedAt = new Date().toISOString();

  if (caseJson.source && caseJson.source.jsonFileId) {
    DriveApp.getFileById(caseJson.source.jsonFileId).setContent(JSON.stringify(caseJson, null, 2));
  }
  registrationResult.caseJson = caseJson;
  registrationResult.registration.additionalOriginals = additionalFiles || [];
  return registrationResult;
}

function markExtractSessionRegistered_(sessionId, projectId, folderUrl) {
  const sheet = getOrCreateExtractSessionSheet_();
  const found = findExtractSessionRow_(sheet, sessionId);
  if (!found) return;
  sheet.getRange(found.row, found.headerMap['ステータス']).setValue('registered');
  sheet.getRange(found.row, found.headerMap['Phase2更新日時']).setValue(new Date());
  sheet.getRange(found.row, found.headerMap['備考']).setValue(
    '正式登録完了：' + projectId + (folderUrl ? ' / ' + folderUrl : '')
  );
}

function cleanupRegisteredTempDocuments_(docs) {
  (docs || []).forEach(function(doc) {
    trashFileIfExists_(doc.pdfFileId);
    trashFileIfExists_(doc.ocrDocId);
  });
}

/**
 * 案件カルテの確認・修正内容を正式登録するWeb API。
 * PDF/OCR一時セッション → Core v0.9.0 → 案件マスター＋案件フォルダ。
 */
function api_registerPhase2Case(sessionId, payload) {
  try {
    if (!sessionId) return apiError_('セッションIDがないにゃん。');
    if (typeof processOcrResultToProject_ !== 'function') {
      return apiError_('Core v0.9.0 が同じApps Scriptプロジェクトに入っていないにゃん。');
    }

    const sessionSheet = getOrCreateExtractSessionSheet_();
    const found = findExtractSessionRow_(sessionSheet, sessionId);
    if (!found) return apiError_('作業中のセッションが見つからないにゃん。');
    const status = String(found.rowValues[found.headerMap['ステータス'] - 1] || '');
    if (status === 'registered') return apiError_('この案件はすでに正式登録済みにゃん。');
    if (!['pending_review', 'phase2_draft'].includes(status)) {
      return apiError_('このセッションは「' + status + '」状態なので登録できないにゃん。');
    }

    const clean = sanitizePhase2Payload_(payload);
    clean.sessionId = sessionId;
    const docs = getExtractDocuments_(sessionId, true);
    if (!docs.length) return apiError_('登録するPDF資料が見つからないにゃん。');

    const combinedOcr = docs.map(function(doc) {
      return '===== ' + (doc.fileName || doc.documentType || '資料') + ' =====\n' + (doc.ocrText || '');
    }).join('\n\n');
    const ocrResult = phase2PayloadToOcrResult_(clean, docs);
    const primary = docs[0];

    let result = processOcrResultToProject_(ocrResult, {
      fileId: primary.pdfFileId,
      fileName: primary.fileName,
      ocrText: combinedOcr,
      actor: 'Web案件カルテ'
    });

    const additionalFiles = copyAdditionalSessionDocuments_(docs, result);
    result = finalizeRegisteredCaseJson_(result, docs, additionalFiles);
    let learningLogCount = 0;
    let learningReview = [];
    let semanticReview = [];
    const learningWarnings = [];
    try {
      const learningLogs = buildOcrCorrectionLogs_(result.registration.projectId, sessionId, clean);
      learningLogCount = saveOcrCorrectionLogs_(learningLogs);
      if (learningLogCount === learningLogs.length) {
        learningReview = buildLearningReviewCandidates_(learningLogs);
      }
    } catch (learningError) {
      Logger.log('OCR correction log warning: ' + learningError.stack);
      learningWarnings.push('修正ログを保存できませんでした。案件登録は完了しています。');
    }
    try {
      const agencyName = String(clean.basic && clean.basic.org && clean.basic.org.value || '');
      const semanticCandidates = buildSemanticHeadingCandidates_(
        result.registration.projectId,
        docs,
        agencyName
      );
      const savedSemanticCandidates = saveSemanticLearningCandidates_(semanticCandidates);
      semanticReview = buildSemanticReviewResponse_(savedSemanticCandidates);
    } catch (semanticError) {
      Logger.log('Semantic learning candidate warning: ' + semanticError.stack);
      learningWarnings.push('にゃん語辞典候補を準備できませんでした。案件登録は完了しています。');
    }
    markExtractSessionRegistered_(sessionId, result.registration.projectId, result.registration.folderUrl);
    cleanupRegisteredTempDocuments_(docs);

    return apiOk_({
      sessionId: sessionId,
      caseId: result.registration.projectId,
      isNew: result.registration.isNew,
      matchType: result.registration.matchType,
      needsCheck: result.registration.needsCheck,
      folderUrl: result.registration.folderUrl,
      savedFiles: result.registration.savedFiles || {},
      learningLogCount: learningLogCount,
      learningWarnings: learningWarnings,
      learningReview: learningReview,
      semanticReview: semanticReview,
      message: '案件ID ' + result.registration.projectId + ' で正式登録できたにゃん！🐈✨'
    });
  } catch (e) {
    Logger.log('api_registerPhase2Case error: ' + e.stack);
    return apiError_('案件登録でエラーにゃん：' + e.message);
  }
}


// ── API④：「もっと詳しく調べるにゃん」 ─────────────────

function api_proceedToDetailExtraction(sessionId, overrideGroupNumber) {
  try {
    if (!sessionId) return apiError_('セッションIDが指定されていないにゃん。');
    const sheet = getOrCreateExtractSessionSheet_();
    const found = findExtractSessionRow_(sheet, sessionId);
    if (!found) return apiError_('セッションが見つからないにゃん。');

    const status = String(found.rowValues[found.headerMap['ステータス'] - 1] || '');
    if (!['pending_review', 'phase2_draft'].includes(status)) {
      return apiError_('このセッションは既に「' + status + '」状態にゃん。');
    }

    const detail = buildPhase2Detail_(sessionId, overrideGroupNumber);
    return apiOk_({
      sessionId: sessionId,
      detail: detail,
      documentCount: detail.documents.length,
      message: detail.documents.length + '件の資料から案件カルテを作ったにゃん！内容を確認・修正してにゃん🐈',
    });
  } catch (e) {
    Logger.log('api_proceedToDetailExtraction error: ' + e.stack);
    return apiError_('詳細抽出でエラーにゃん：' + e.message);
  }
}

// ── API⑤：キャンセル（同じセッションの全資料を破棄） ──────

function api_cancelExtractSession(sessionId) {
  try {
    if (!sessionId) return apiError_('セッションIDが指定されていないにゃん。');
    const sessionSheet = getOrCreateExtractSessionSheet_();
    const found = findExtractSessionRow_(sessionSheet, sessionId);
    if (!found) return apiError_('セッションが見つからないにゃん（既に処理済みの可能性）。');

    const docSheet = getOrCreateExtractDocumentSheet_();
    const docMap = getExtractHeaderMap_(docSheet);
    const docs = getExtractDocuments_(sessionId, false);
    const phase2JsonId = found.rowValues[found.headerMap['Phase2_JSONファイルID'] - 1];
    trashFileIfExists_(phase2JsonId);

    docs.forEach(doc => {
      trashFileIfExists_(doc.pdfFileId);
      trashFileIfExists_(doc.ocrDocId);
      if (doc.row) {
        docSheet.getRange(doc.row, docMap['ステータス']).setValue('cancelled');
        docSheet.getRange(doc.row, docMap['備考']).setValue('キャンセル：' + new Date());
      }
    });

    // Ver1/旧セッションも安全に片付けるための後方互換
    if (!docs.length) {
      trashFileIfExists_(found.rowValues[found.headerMap['PDFファイルID'] - 1]);
      trashFileIfExists_(found.rowValues[found.headerMap['OCR DocID'] - 1]);
    }

    sessionSheet.getRange(found.row, found.headerMap['ステータス']).setValue('cancelled');
    sessionSheet.getRange(found.row, found.headerMap['備考']).setValue(
      docs.length + '資料をキャンセル：' + new Date()
    );

    return apiOk_({ cancelled: true, documentCount: docs.length });
  } catch (e) {
    return apiError_('キャンセル処理でエラーにゃん：' + e.message);
  }
}

// ── メンテナンス ─────────────────────────────────────

function cleanupOrphanedExtractSessions(hoursThreshold) {
  const hours = Number(hoursThreshold) || 24;
  const thresholdMs = hours * 60 * 60 * 1000;
  const sessionSheet = getOrCreateExtractSessionSheet_();
  const lastRow = sessionSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('セッションなし');
    return;
  }

  const map = getExtractHeaderMap_(sessionSheet);
  const values = sessionSheet.getRange(2, 1, lastRow - 1, sessionSheet.getLastColumn()).getValues();
  const now = Date.now();
  let cleanedSessions = 0;
  let cleanedDocuments = 0;

  values.forEach((row, index) => {
    const status = String(row[map['ステータス'] - 1] || '');
    const createdAt = row[map['作成日時'] - 1];
    if (status !== 'pending_review' || !(createdAt instanceof Date)) return;
    if ((now - createdAt.getTime()) <= thresholdMs) return;

    const sessionId = String(row[map['セッションID'] - 1] || '');
    const docs = getExtractDocuments_(sessionId, false);
    const docSheet = getOrCreateExtractDocumentSheet_();
    const docMap = getExtractHeaderMap_(docSheet);
    docs.forEach(doc => {
      trashFileIfExists_(doc.pdfFileId);
      trashFileIfExists_(doc.ocrDocId);
      docSheet.getRange(doc.row, docMap['ステータス']).setValue('cleaned_up');
      docSheet.getRange(doc.row, docMap['備考']).setValue('自動整理：' + new Date());
      cleanedDocuments++;
    });

    if (!docs.length) {
      trashFileIfExists_(row[map['PDFファイルID'] - 1]);
      trashFileIfExists_(row[map['OCR DocID'] - 1]);
    }

    sessionSheet.getRange(index + 2, map['ステータス']).setValue('cleaned_up');
    sessionSheet.getRange(index + 2, map['備考']).setValue(
      docs.length + '資料を整理：' + new Date()
    );
    cleanedSessions++;
  });

  Logger.log('整理完了：' + cleanedSessions + 'セッション / ' + cleanedDocuments + '資料');
}

// ── 動作確認用 ───────────────────────────────────────

function testExtractSchema() {
  const sheet = getOrCreateExtractSessionSheet_();
  Logger.log('一時抽出セッション準備OK：' + sheet.getName());
  const docSheet = getOrCreateExtractDocumentSheet_();
  Logger.log('一時抽出資料準備OK：' + docSheet.getName());
  const folder = getOrCreateTempFolder_();
  Logger.log('一時フォルダ準備OK：' + folder.getName() + ' / ' + folder.getId());
}

function testExtractLogic_() {
  const sample = [
    'オープンカウンター方式による見積り合わせに付する事項',
    '（1）件名 封筒2000枚購入',
    '（2）参加資格 予算決算及び会計令第70条及び第71条に該当しない者であること。',
    '見積り合わせ時において指名停止を受けている期間中の者でないこと。',
    '納期 令和8年8月27日までとする。',
    '発注元 九州地方整備局北九州港湾・空港整備事務所長 鈴木賢治',
  ].join('\n');
  Logger.log(JSON.stringify(extractKey3_(sample, '公告.pdf'), null, 2));
}
