const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const supplierRoot = path.join(root, 'supplier-nyan');
const assetRoot = path.join(supplierRoot, 'assets', 'home-v1');
const output = path.join(supplierRoot, 'supplier-nyan-home-assets.html');
const manifest = Object.freeze({
  'brand.mark.paw': 'icons/HOME-ICON-001-HeaderPaw_v1.0.svg',
  'background.homeForest': 'backgrounds/AST-002_v1.0.png',
  'character.explorerCat': 'characters/AST-001_v1.0.png',
  'card.woodA': 'cards/AST-003_v1.0.png',
  'nav.home.default': 'navigation/AST-010-Home-Default_v1.0.svg',
  'nav.home.selected': 'navigation/AST-010-Home-Selected_v1.0.svg',
  'nav.research.default': 'navigation/AST-010-ResearchList-Default_v1.0.svg',
  'nav.crate.default': 'navigation/AST-010-Crate-Default_v1.0.svg',
  'nav.knowledge.default': 'navigation/AST-010-KnowledgeForest-Default_v1.0.svg',
  'decoration.grass.left': 'decorations/AST-011-Left_v1.0.png',
  'decoration.grass.right': 'decorations/AST-011-Right_v1.0.png',
  'header.notification': 'icons/HOME-ICON-002-Notification_v1.0.svg',
  'header.mail': 'icons/HOME-ICON-003-Mail_v1.0.svg',
  'header.unreadBadge': 'header/AST-012-UnreadBadge_v1.0.svg',
  'home.heading.quest': 'icons/HOME-ICON-004-QuestHeading_v1.0.svg',
  'home.heading.recent': 'icons/HOME-ICON-005-RecentRequestsHeading_v1.0.svg',
  'home.heading.status': 'icons/HOME-ICON-006-ResearchStatusHeading_v1.0.svg',
  'home.quest.estimateReply': 'icons/HOME-ICON-007-EstimateReply_v1.0.svg',
  'home.quest.newSupplier': 'icons/HOME-ICON-008-NewSupplier_v1.0.svg',
  'home.quest.estimatePdf': 'icons/HOME-ICON-009-EstimatePDF_v1.0.svg',
  'home.request.row': 'icons/HOME-ICON-010-RequestRow_v1.0.svg',
  'home.chevron.right': 'icons/HOME-ICON-011-ChevronRight_v1.0.svg'
});

function dataUri(relativePath) {
  const filePath = path.join(assetRoot, relativePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === '.svg' ? 'image/svg+xml' : 'image/png';
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

const assets = Object.fromEntries(
  Object.entries(manifest).map(([key, relativePath]) => [key, dataUri(relativePath)])
);
const html = '<script>window.SUPPLIER_NYAN_HOME_ASSETS = Object.freeze(' +
  JSON.stringify(assets) + ');</script>\n';
fs.writeFileSync(output, html, 'utf8');
