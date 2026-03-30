const express = require('express');
const router = express.Router();
const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  syncCart,

} = require('../../controllers/online/cartController');

// Get user's cart
router.get('/', getCart);

// Add item to cart
router.post('/', addToCart);

// Sync local cart to database (on login)
router.post('/sync', syncCart);



// Update cart item quantity
router.put('/:inventoryProductId', updateCartItem);

// Remove item from cart
router.delete('/:inventoryProductId', removeFromCart);

// Clear entire cart
router.delete('/', clearCart);

module.exports = router;
