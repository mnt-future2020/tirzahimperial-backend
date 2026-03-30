const express = require("express");
const router = express.Router();
const { submitContactForm } = require("../../controllers/web/contactController");

// Submit contact form
router.post("/", submitContactForm);

module.exports = router;
