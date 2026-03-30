const express = require("express");
const router = express.Router();
const {
  getCompanySettings,
  saveCompanySettings,
} = require("../../controllers/web/companySettingsController");

// Get company settings
router.get("/", getCompanySettings);

// Create or update company settings
router.post("/", saveCompanySettings);

module.exports = router;
