const express = require('express');
const { getDashboardData } = require('../../controllers/dashboard/dashboardController');
const { authenticateToken } = require('../../middleware/auth');

const router = express.Router();

// Get comprehensive dashboard data
// GET /api/dashboard?startDate=2024-01-01&endDate=2024-01-31
router.get('/', authenticateToken, getDashboardData);

module.exports = router;
