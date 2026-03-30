/**
 * Delivery Partner Email Templates
 * Centralized export for all delivery partner email templates
 */

const { getApprovedEmailTemplate } = require("./approved");
const { getRejectedEmailTemplate } = require("./rejected");
const { getSuspendedEmailTemplate } = require("./suspended");

module.exports = {
  getApprovedEmailTemplate,
  getRejectedEmailTemplate,
  getSuspendedEmailTemplate,
};
