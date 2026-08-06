'use strict';

const supplierNyanAssets = Object.freeze({
  'brand.mark.paw': '../assets/home-v1/icons/HOME-ICON-001-HeaderPaw_v1.0.svg',
  'background.homeForest': '../assets/home-v1/backgrounds/AST-002_v1.0.png',
  'character.explorerCat': '../assets/home-v1/characters/AST-001_v1.0.png',
  'card.woodA': '../assets/home-v1/cards/AST-003_v1.0.png',
  'nav.home.default': '../assets/home-v1/navigation/AST-010-Home-Default_v1.0.svg',
  'nav.home.selected': '../assets/home-v1/navigation/AST-010-Home-Selected_v1.0.svg',
  'nav.research.default': '../assets/home-v1/navigation/AST-010-ResearchList-Default_v1.0.svg',
  'nav.crate.default': '../assets/home-v1/navigation/AST-010-Crate-Default_v1.0.svg',
  'nav.knowledge.default': '../assets/home-v1/navigation/AST-010-KnowledgeForest-Default_v1.0.svg',
  'decoration.grass.left': '../assets/home-v1/decorations/AST-011-Left_v1.0.png',
  'decoration.grass.right': '../assets/home-v1/decorations/AST-011-Right_v1.0.png',
  'header.notification': '../assets/home-v1/icons/HOME-ICON-002-Notification_v1.0.svg',
  'header.mail': '../assets/home-v1/icons/HOME-ICON-003-Mail_v1.0.svg',
  'header.unreadBadge': '../assets/home-v1/header/AST-012-UnreadBadge_v1.0.svg',
  'home.heading.quest': '../assets/home-v1/icons/HOME-ICON-004-QuestHeading_v1.0.svg',
  'home.heading.recent': '../assets/home-v1/icons/HOME-ICON-005-RecentRequestsHeading_v1.0.svg',
  'home.heading.status': '../assets/home-v1/icons/HOME-ICON-006-ResearchStatusHeading_v1.0.svg',
  'home.quest.estimateReply': '../assets/home-v1/icons/HOME-ICON-007-EstimateReply_v1.0.svg',
  'home.quest.newSupplier': '../assets/home-v1/icons/HOME-ICON-008-NewSupplier_v1.0.svg',
  'home.quest.estimatePdf': '../assets/home-v1/icons/HOME-ICON-009-EstimatePDF_v1.0.svg',
  'home.request.row': '../assets/home-v1/icons/HOME-ICON-010-RequestRow_v1.0.svg',
  'home.chevron.right': '../assets/home-v1/icons/HOME-ICON-011-ChevronRight_v1.0.svg',
});

const mockHomeViewModel = Object.freeze({
  schemaVersion: '1.0',
  generatedAt: '2026-08-04T09:00:00+09:00',
  header: {
    brandAssetKey: 'brand.mark.paw',
    notificationCount: 0,
    unreadMailCount: 1,
  },
  hero: {
    backgroundAssetKey: 'background.homeForest',
    characterAssetKey: 'character.explorerCat',
    instruction: '今日は3件の\nご縁を探そう！',
  },
  questSummary: {
    label: '今日のクエスト',
    total: 3,
    completed: 0,
  },
  quests: [
    {
      id: 'quest-001',
      iconAssetKey: 'home.quest.estimateReply',
      type: 'quote_followup',
      title: '見積回答を確認',
      status: 'waiting',
      priority: 'high',
      countLabel: '2件',
      deadlineLabel: '今日12:00',
      action: { label: '確認する', intent: 'primary', target: 'quest-001' },
      appearance: { cardVariant: 'wood-a', accent: 'warm' },
    },
    {
      id: 'quest-002',
      iconAssetKey: 'home.quest.newSupplier',
      type: 'supplier_search',
      title: '新しい仕入先を調査',
      status: 'in_progress',
      priority: 'high',
      countLabel: '3社',
      deadlineLabel: '今日中',
      action: { label: '調査する', intent: 'primary', target: 'quest-002' },
      appearance: { cardVariant: 'wood-a', accent: 'warm' },
    },
    {
      id: 'quest-003',
      iconAssetKey: 'home.quest.estimatePdf',
      type: 'document_review',
      title: '見積PDFを確認',
      status: 'not_started',
      priority: 'normal',
      countLabel: '1件',
      deadlineLabel: '8/3',
      action: { label: '確認する', intent: 'secondary', target: 'quest-003' },
      appearance: { cardVariant: 'wood-a', accent: 'warm' },
    },
  ],
  recentRequests: [
    {
      id: 'request-001',
      title: '防災グッズ 300セット',
      organization: 'テスト市役所',
      receivedLabel: '10分前',
      isNew: true,
    },
  ],
  researchStatus: {
    current: 7,
    total: 10,
    unit: '社',
  },
  navigation: [
    {
      id: 'home',
      label: 'ホーム',
      iconAssetKey: 'nav.home.default',
      selectedIconAssetKey: 'nav.home.selected',
      active: true,
    },
    { id: 'research', label: '調査一覧', iconAssetKey: 'nav.research.default', active: false },
    { id: 'crate', label: '宝箱', iconAssetKey: 'nav.crate.default', active: false },
    { id: 'knowledge', label: '知識の森', iconAssetKey: 'nav.knowledge.default', active: false },
  ],
});

class MockHomeDataSource {
  async getHomeViewModel() {
    return mockHomeViewModel;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function assetPath(assetKey) {
  const path = supplierNyanAssets[assetKey];
  if (!path) throw new Error(`未登録のAsset Keyです: ${assetKey}`);
  return path;
}

function normalizeBadgeCount(value) {
  const count = Number(value) || 0;
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

function clampProgress(current, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return {
    current: Math.min(Math.max(Number(current) || 0, 0), total),
    total,
  };
}

function applyAssetManifest() {
  document.querySelectorAll('[data-asset-key]').forEach((element) => {
    const assetKey = element.dataset.assetKey;
    element.src = assetPath(assetKey);
  });
  document.documentElement.style.setProperty(
    '--asset-card-wood-a',
    `url("${assetPath('card.woodA')}")`,
  );
  document.documentElement.style.setProperty(
    '--asset-unread-badge',
    `url("${assetPath('header.unreadBadge')}")`,
  );
}

function renderBadge(elementId, value) {
  const element = document.getElementById(elementId);
  const label = normalizeBadgeCount(value);
  element.hidden = label === '';
  element.textContent = label;
}

function questRowMarkup(quest) {
  return `
    <button class="quest-row" type="button" data-quest-id="${escapeHtml(quest.id)}"
      data-quest-type="${escapeHtml(quest.type)}" aria-label="${escapeHtml(quest.title)} ${escapeHtml(quest.countLabel)}">
      <img class="quest-row__icon" src="${escapeHtml(assetPath(quest.iconAssetKey))}" alt="">
      <div class="quest-row__main">
        <span class="quest-row__title">${escapeHtml(quest.title)}</span>
      </div>
      <div class="quest-row__side">
        <span class="count-tag">${escapeHtml(quest.countLabel)}</span>
        <span class="deadline">${escapeHtml(quest.deadlineLabel)}</span>
      </div>
      <img class="chevron" src="${escapeHtml(assetPath('home.chevron.right'))}" alt="">
    </button>`;
}

function recentRowMarkup(request) {
  return `
    <div class="recent-row" data-request-id="${escapeHtml(request.id)}">
      <img class="recent-row__icon" src="${escapeHtml(assetPath('home.request.row'))}" alt="">
      <div class="recent-row__main">
        <span class="recent-row__title">${escapeHtml(request.title)}</span>
        <span class="recent-row__meta">
          <span>${escapeHtml(request.organization)}</span>
          <span>${escapeHtml(request.receivedLabel)}</span>
        </span>
      </div>
      <div class="recent-row__side">
        ${request.isNew ? '<span class="new-tag">NEW</span>' : ''}
      </div>
      <img class="chevron" src="${escapeHtml(assetPath('home.chevron.right'))}" alt="">
    </div>`;
}

function navItemMarkup(item) {
  const activeAttributes = item.active ? ' aria-current="page"' : '';
  const activeClass = item.active ? ' nav-item--home' : '';
  const iconMarkup = item.selectedIconAssetKey
    ? `<span class="nav-item__icon-stack" aria-hidden="true">
        <img class="nav-item__icon--default" src="${escapeHtml(assetPath(item.iconAssetKey))}" alt="">
        <img class="nav-item__icon--selected" src="${escapeHtml(assetPath(item.selectedIconAssetKey))}" alt="">
      </span>`
    : `<img src="${escapeHtml(assetPath(item.iconAssetKey))}" alt="">`;
  return `
    <button class="nav-item${activeClass}" type="button" data-nav-id="${escapeHtml(item.id)}"
      aria-label="${escapeHtml(item.label)}"${activeAttributes}>
      ${iconMarkup}
      <span class="sr-only">${escapeHtml(item.label)}</span>
    </button>`;
}

function renderResearchStatus(status) {
  const progress = clampProgress(status.current, status.total);
  if (!progress) {
    document.getElementById('statusBoard').innerHTML = '<p>調査状況はまだありません。</p>';
    return;
  }
  const percent = Math.round((progress.current / progress.total) * 100);
  const remaining = progress.total - progress.current;
  document.getElementById('statusBoard').innerHTML = `
    <div class="status-progress">
      <div class="progress-track" role="progressbar"
        aria-label="調査状況 ${progress.current} / ${progress.total}${escapeHtml(status.unit)}"
        aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.current}">
        <span class="progress-track__value" style="width:${percent}%"></span>
      </div>
      <strong class="status-count">${progress.current} / ${progress.total}${escapeHtml(status.unit)}</strong>
      <span class="status-remaining">あと${remaining}${escapeHtml(status.unit)}</span>
    </div>`;
}

function renderHome(viewModel) {
  renderBadge('notificationBadge', viewModel.header.notificationCount);
  renderBadge('mailBadge', viewModel.header.unreadMailCount);
  document.getElementById('dailyInstruction').textContent = viewModel.hero.instruction;
  document.getElementById('questSummary').textContent =
    `${viewModel.questSummary.completed}/${viewModel.questSummary.total} 完了`;
  document.getElementById('questList').innerHTML =
    viewModel.quests.length
      ? viewModel.quests.map(questRowMarkup).join('')
      : '<p>今日のクエストは完了です。</p>';
  document.getElementById('recentList').innerHTML =
    viewModel.recentRequests.length
      ? viewModel.recentRequests.map(recentRowMarkup).join('')
      : '<p>新しい依頼はありません。</p>';
  renderResearchStatus(viewModel.researchStatus);
  document.getElementById('navItems').innerHTML =
    viewModel.navigation.map(navItemMarkup).join('');
}

async function startHome() {
  applyAssetManifest();
  const dataSource = new MockHomeDataSource();
  const viewModel = await dataSource.getHomeViewModel();
  renderHome(viewModel);
}

startHome().catch((error) => {
  console.error(error);
  document.getElementById('appShell').innerHTML =
    '<p class="fatal-error">画面を表示できませんでした。</p>';
});
