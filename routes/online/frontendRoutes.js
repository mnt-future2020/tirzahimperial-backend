const express = require("express");
const router = express.Router();

// Import frontend controllers
const {
  getCategories,
  getCategoryByIdentifier,
} = require("../../controllers/online/frontend/frontendCategoriesController");

const {
  getSubcategoriesByCategory,
  getSubcategoryById,
} = require("../../controllers/online/frontend/frontendSubcategoriesController");

const {
  getProducts,
  getProductById,
  getHomepageProducts,

  getFrequentlyBoughtTogether,
  getComboHomepageProducts, // 🆕 Import new controller
} = require("../../controllers/online/frontend/frontendProductsController");

// ============================================
// FRONTEND ROUTES - Public API for website
// ============================================

// Categories Routes
router.get("/categories", getCategories);
router.get("/categories/:identifier", getCategoryByIdentifier);

// Subcategories Routes
router.get("/subcategories", getSubcategoriesByCategory);
router.get("/subcategories/:id", getSubcategoryById);

// Products Routes
router.get("/products", getProducts);
router.get("/products/:id", getProductById);
router.get("/products/:id/frequently-bought-together", getFrequentlyBoughtTogether);

// Homepage Products Route - Get products by homepage badge
router.get("/homepage-products", getHomepageProducts);

// 🆕 Combo Homepage Route
router.get("/combo-homepage", getComboHomepageProducts);

module.exports = router;
