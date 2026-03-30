const express = require("express");
const {
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
  getWishlist,
  checkWishlistItem,
} = require("../../controllers/online/wishlistController");

const router = express.Router();

// Get user's wishlist
router.get("/", getWishlist);

// Add to wishlist
router.post("/", addToWishlist);

// Clear wishlist
router.delete("/", clearWishlist);

// Check if product is in wishlist
router.get("/check/:productId", checkWishlistItem);

// Remove from wishlist
router.delete("/:productId", removeFromWishlist);

module.exports = router;
