// Mirrors ATTACHMENT_SECTIONS in the API's lib/attachments.ts. The backend
// rejects anything not in its own list, so this is a convenience for callers
// rather than the enforcement point.
//
// Lives apart from PhotoAttachments.jsx so that component file exports only a
// component (react-refresh/only-export-components).
export const PHOTO_SECTIONS = {
  shopSale: 'shopSale',
  cashBanking: 'cashBanking',
  creditCardBanking: 'creditCardBanking',
  deductions: 'deductions',
  safeDrop: 'safeDrop',
  lottery: 'lottery',
  paypoint: 'paypoint',
  instantLotteryInventory: 'instantLotteryInventory',
  supplierInvoices: 'supplierInvoices',
  summary: 'summary',
  commit: 'commit',
  scratchCards: 'scratchCards',
  zReports: 'zReports',
};
