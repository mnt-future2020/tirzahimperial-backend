const express = require('express');
const {
  getAllBadges,
  getHomepageBadges,
  createBadge,
  updateBadge,
  resetStaticBadge,
  deleteBadge,
} = require('../../controllers/online/badgeController');

const router = express.Router();

// Badge CRUD routes
router.get('/', getAllBadges);
router.get('/homepage', getHomepageBadges);
router.post('/', createBadge);
router.put('/:id', updateBadge);
router.post('/:id/reset', resetStaticBadge);
router.delete('/:id', deleteBadge);

module.exports = router;
