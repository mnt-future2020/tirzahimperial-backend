const express = require('express');
const {
  getAllBrands,
  createBrand,
  updateBrand,
  deleteBrand,
} = require('../../controllers/online/brandController');

const router = express.Router();

// Brand CRUD routes
router.get('/', getAllBrands);
router.post('/', createBrand);
router.put('/:id', updateBrand);
router.delete('/:id', deleteBrand);

module.exports = router;
