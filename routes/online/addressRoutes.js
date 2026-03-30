const express = require('express');
const router = express.Router();
const {
  getAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
} = require('../../controllers/online/addressController');

// Get all addresses
router.get('/', getAddresses);

// Get address by ID
router.get('/:id', getAddressById);

// Create new address
router.post('/', createAddress);

// Update address
router.put('/:id', updateAddress);

// Delete address
router.delete('/:id', deleteAddress);

// Set default address
router.patch('/:id/default', setDefaultAddress);

module.exports = router;
