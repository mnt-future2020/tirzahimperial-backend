const express = require('express');
const { 
    getEmail,
    postEmail,
    putEmail,
    testEmail
} = require("../../controllers/email/emailConfigController");

const router = express.Router();

// GET /api/email/dashboard/settings/email-configuration
router.get('/', getEmail);

// POST /api/email/dashboard/settings/email-configuration
router.post('/', postEmail);

// PUT /api/email/dashboard/settings/email-configuration/:id
router.put('/:id', putEmail);

// POST /api/email/dashboard/settings/email-configuration/test
router.post('/test', testEmail);

module.exports = router;
