const express = require('express');
const router = express.Router();
const {
  getCourierSettings,
  updateCourierSettings,
} = require('../../controllers/courier/courierController');

// Get courier settings
router.get('/settings', getCourierSettings);

// Update courier settings
router.patch('/settings', updateCourierSettings);

module.exports = router;