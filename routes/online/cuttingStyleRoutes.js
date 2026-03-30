const express = require('express');
const {
  getAllCuttingStyles,
  getActiveCuttingStyles,
  getCuttingStyleById,
  createCuttingStyle,
  updateCuttingStyle,
  deleteCuttingStyle,
  toggleCuttingStyleStatus,
} = require('../../controllers/online/cuttingStyleController');

const router = express.Router();

// Cutting Style CRUD routes
router.get('/', getAllCuttingStyles);
router.get('/active', getActiveCuttingStyles);
router.get('/:id', getCuttingStyleById);
router.post('/', createCuttingStyle);
router.put('/:id', updateCuttingStyle);
router.put('/:id/toggle-status', toggleCuttingStyleStatus);
router.delete('/:id', deleteCuttingStyle);

module.exports = router;
