'use strict';

const mockResearchCases = Object.freeze([
  {
    id: 'TEST-SUP-001',
    name: '防災備蓄品の調達',
    organization: 'テスト市役所',
    deadline: '2026/08/15',
    status: '調査中',
    questTypes: ['quote_followup', 'supplier_search', 'document_review'],
    items: [
      { id: 'TEST-SUP-001-001', name: '防災帽子', quantity: 308, unit: '個', specification: '折りたたみ式・あご紐付き', equivalent: '同等品可' },
      { id: 'TEST-SUP-001-002', name: '保存水 500ml', quantity: 24, unit: '本', specification: '賞味期限5年以上', equivalent: '未確認' },
    ],
  },
  {
    id: 'TEST-SUP-002',
    name: '啓発用品の製作',
    organization: 'テスト県庁',
    deadline: '2026/08/20',
    status: '未着手',
    questTypes: ['supplier_search'],
    items: [
      { id: 'TEST-SUP-002-001', name: 'エコバッグ', quantity: 100, unit: '枚', specification: 'コットン製・A4対応', equivalent: '同等品不可' },
    ],
  },
  {
    id: 'TEST-SUP-003',
    name: '庁内消耗品購入',
    organization: 'テスト区役所',
    deadline: '2026/08/28',
    status: '回答待ち',
    questTypes: ['quote_followup', 'supplier_search'],
    items: [
      { id: 'TEST-SUP-003-001', name: 'コピー用紙 A4', quantity: 50, unit: '箱', specification: '白色度80%以上・500枚×5冊', equivalent: '同等品可' },
      { id: 'TEST-SUP-003-002', name: '油性ボールペン', quantity: 200, unit: '本', specification: '黒・0.7mm', equivalent: '同等品可' },
      { id: 'TEST-SUP-003-003', name: '付箋セット', quantity: 80, unit: '組', specification: '5色・紙製', equivalent: '未確認' },
    ],
  },
]);

function navEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function caseCardMarkup(caseData) {
  const itemPreview = caseData.items.slice(0, 2)
    .map((item) => `<li><strong>${navEscape(item.name)}</strong><span>${item.quantity}${navEscape(item.unit)}</span></li>`)
    .join('');
  const remaining = Math.max(caseData.items.length - 2, 0);
  return `
    <button class="case-card" type="button" data-case-id="${navEscape(caseData.id)}">
      <span class="case-card__topline"><span>${navEscape(caseData.status)}</span><span>${navEscape(caseData.deadline)}締切</span></span>
      <ul class="case-card__items">${itemPreview}</ul>
      ${remaining ? `<span class="case-card__more">ほか${remaining}品目</span>` : ''}
      <span class="case-card__meta">${navEscape(caseData.id)}｜${navEscape(caseData.organization)}</span>
      <span class="case-card__name">${navEscape(caseData.name)}</span>
      <span class="case-card__chevron" aria-hidden="true">›</span>
    </button>`;
}

function detailItemMarkup(item) {
  return `
    <article class="detail-item-card">
      <div class="detail-item-card__heading">
        <div><span class="item-id">${navEscape(item.id)}</span><h3>${navEscape(item.name)}</h3></div>
        <strong>${item.quantity}${navEscape(item.unit)}</strong>
      </div>
      <p class="item-spec">${navEscape(item.specification)}</p>
      <span class="equivalent-chip">${navEscape(item.equivalent)}</span>
      <div class="future-action-slot" aria-label="将来の仕入先追加操作の配置予定">仕入先追加は次フェーズ</div>
    </article>`;
}

const questFilterLabels = Object.freeze({
  quote_followup: '見積回答を確認',
  supplier_search: '新しい仕入先を調査',
  document_review: '見積PDFを確認',
});

let prototypeToastTimer = null;

function showPrototypeMessage(message) {
  const toast = document.getElementById('prototypeToast');
  clearTimeout(prototypeToastTimer);
  toast.textContent = message;
  toast.hidden = false;
  prototypeToastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function casesForQuestType(questType) {
  if (!questType) return mockResearchCases;
  return mockResearchCases.filter((caseData) => caseData.questTypes.includes(questType));
}

function renderResearchCases(questType = '') {
  const cases = casesForQuestType(questType);
  const filterLabel = questFilterLabels[questType] || '';
  document.getElementById('researchScreenTitle').textContent = filterLabel || '調査一覧';
  document.getElementById('researchSummaryCount').textContent = `調査対象 ${cases.length}案件`;
  document.getElementById('researchSummaryDescription').textContent = filterLabel
    ? `「${filterLabel}」が必要な案件を表示しています。`
    : '品目を選ぶと詳細を確認できます。';
  document.getElementById('caseList').innerHTML = cases.map(caseCardMarkup).join('');
}

function renderCaseDetail(caseId) {
  const caseData = mockResearchCases.find((entry) => entry.id === caseId);
  if (!caseData) throw new Error(`案件が見つかりません: ${caseId}`);
  document.getElementById('caseDetailTitle').textContent = caseData.items.length === 1
    ? caseData.items[0].name
    : `${caseData.items.length}品目の調査`;
  document.getElementById('caseDetailSummary').innerHTML = `
    <dl>
      <div><dt>案件ID</dt><dd>${navEscape(caseData.id)}</dd></div>
      <div><dt>発注機関</dt><dd>${navEscape(caseData.organization)}</dd></div>
      <div><dt>締切</dt><dd>${navEscape(caseData.deadline)}</dd></div>
      <div><dt>状態</dt><dd>${navEscape(caseData.status)}</dd></div>
    </dl>
    <p>${navEscape(caseData.name)}</p>`;
  document.getElementById('detailItemList').innerHTML = caseData.items.map(detailItemMarkup).join('');
}

function setNavigationState(screenName) {
  document.querySelectorAll('[data-nav-id]').forEach((button) => {
    const active = screenName === 'home' ? button.dataset.navId === 'home' : button.dataset.navId === 'research';
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.classList.toggle('nav-item--selected', active);
  });
}

function showPrototypeScreen(screenName, options = {}) {
  document.getElementById('appShell').classList.toggle('app-shell--subscreen', screenName !== 'home');
  document.querySelectorAll('[data-screen]').forEach((screen) => {
    screen.hidden = screen.dataset.screen !== screenName;
  });
  if (screenName === 'research') renderResearchCases(options.questType || '');
  if (screenName === 'case-detail') renderCaseDetail(options.caseId);
  setNavigationState(screenName);
  const scrollTop = screenName === 'home' ? Number(options.scrollY) || 0 : 0;
  requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: 'auto' }));
  document.title = screenName === 'home'
    ? '仕入先にゃん｜Home Design Ver.1.4'
    : screenName === 'research' ? '仕入先にゃん｜調査一覧' : '仕入先にゃん｜案件詳細';
}

function navigatePrototype(screenName, options = {}, replace = false) {
  const currentState = history.state || { screenName: 'home' };
  if (!replace && currentState.screenName === 'home') {
    history.replaceState({ ...currentState, scrollY: window.scrollY }, '', location.pathname);
  }
  const state = { screenName, ...options };
  if (replace) history.replaceState(state, '', location.pathname);
  else history.pushState(state, '', location.pathname);
  showPrototypeScreen(screenName, options);
}

document.addEventListener('click', (event) => {
  const historyBackButton = event.target.closest('[data-history-back]');
  if (historyBackButton) {
    history.back();
    return;
  }
  const navButton = event.target.closest('[data-nav-id]');
  if (navButton?.dataset.navId === 'home') navigatePrototype('home');
  if (navButton?.dataset.navId === 'research') navigatePrototype('research');
  const questRow = event.target.closest('[data-quest-type]');
  if (questRow) {
    const questType = questRow.dataset.questType;
    const cases = casesForQuestType(questType);
    if (cases.length === 0) {
      showPrototypeMessage('今は確認が必要な案件はありません。');
      return;
    }
    if (cases.length === 1) {
      navigatePrototype('case-detail', { caseId: cases[0].id, questType });
      return;
    }
    navigatePrototype('research', { questType });
    return;
  }
  const caseCard = event.target.closest('[data-case-id]');
  if (caseCard) navigatePrototype('case-detail', { caseId: caseCard.dataset.caseId });
});

window.addEventListener('popstate', (event) => {
  const state = event.state || { screenName: 'home' };
  showPrototypeScreen(state.screenName || 'home', state);
});

renderResearchCases();
if (history.state?.screenName) showPrototypeScreen(history.state.screenName, history.state);
else navigatePrototype('home', {}, true);
