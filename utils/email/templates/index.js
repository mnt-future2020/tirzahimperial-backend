/**
 * Email Templates Index
 * Central export for all email templates
 */

const { getWelcomeEmailTemplate } = require("./welcomeEmailTemplate");
const {
  getPurchaseOrderInvoiceHTML,
  getPurchaseOrderInvoiceEmailTemplate,
} = require("./purchaseOrderInvoiceTemplate");

module.exports = {
  getWelcomeEmailTemplate,
  getPurchaseOrderInvoiceHTML,
  getPurchaseOrderInvoiceEmailTemplate,
};
