const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const supplierRoot = path.join(root, 'supplier-nyan');
const assetRoot = path.join(supplierRoot, 'assets');
const output = path.join(supplierRoot, 'supplier-nyan-home-assets.html');
const manifest = Object.freeze({
  'app.icon': 'home-v1-optimized/adopted/app-icon.png',
  'brand.mark.paw': 'home-v1/icons/HOME-ICON-001-HeaderPaw_v1.0.svg',
  'background.homeForest': 'home-v1-optimized/adopted/home-forest.webp',
  'character.explorerCat': 'home-v1-optimized/adopted/explorer-cat.webp',
  'card.woodA': 'home-v1-optimized/adopted/card-wood-a.webp',
  'nav.home.default': 'home-v1/navigation/AST-010-Home-Default_v1.0.svg',
  'nav.home.selected': 'home-v1/navigation/AST-010-Home-Selected_v1.0.svg',
  'nav.research.default': 'home-v1/navigation/AST-010-ResearchList-Default_v1.0.svg',
  'nav.crate.default': 'home-v1/navigation/AST-010-Crate-Default_v1.0.svg',
  'nav.knowledge.default': 'home-v1/navigation/AST-010-KnowledgeForest-Default_v1.0.svg',
  'decoration.grass.left': 'home-v1-optimized/adopted/grass-left.webp',
  'decoration.grass.right': 'home-v1-optimized/adopted/grass-right.webp',
  'header.notification': 'home-v1/icons/HOME-ICON-002-Notification_v1.0.svg',
  'header.mail': 'home-v1/icons/HOME-ICON-003-Mail_v1.0.svg',
  'header.unreadBadge': 'home-v1/header/AST-012-UnreadBadge_v1.0.svg',
  'home.heading.quest': 'home-v1/icons/HOME-ICON-004-QuestHeading_v1.0.svg',
  'home.heading.recent': 'home-v1/icons/HOME-ICON-005-RecentRequestsHeading_v1.0.svg',
  'home.heading.status': 'home-v1/icons/HOME-ICON-006-ResearchStatusHeading_v1.0.svg',
  'home.quest.estimateReply': 'home-v1/icons/HOME-ICON-007-EstimateReply_v1.0.svg',
  'home.quest.newSupplier': 'home-v1/icons/HOME-ICON-008-NewSupplier_v1.0.svg',
  'home.quest.estimatePdf': 'home-v1/icons/HOME-ICON-009-EstimatePDF_v1.0.svg',
  'home.request.row': 'home-v1/icons/HOME-ICON-010-RequestRow_v1.0.svg',
  'home.chevron.right': 'home-v1/icons/HOME-ICON-011-ChevronRight_v1.0.svg'
});

function dataUri(relativePath) {
  const filePath = path.join(assetRoot, relativePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === '.svg' ? 'image/svg+xml' :
    extension === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

const assets = Object.fromEntries(
  Object.entries(manifest).map(([key, relativePath]) => [key, dataUri(relativePath)])
);
const html = '<script>window.SUPPLIER_NYAN_HOME_ASSETS = Object.freeze(' +
  JSON.stringify(assets) + ');</script>\n';
fs.writeFileSync(output, html, 'utf8');
