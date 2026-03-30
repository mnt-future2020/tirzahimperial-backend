const express = require('express');
const { upload } = require('../../utils/online/uploadS3');
const {
  getAllCategories,
  getCategoryById,
  getCategoryByName,
  createCategory,
  createCategoryOnly,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  getCategoryNames,
  getSubcategoriesByCategory,
  getSubcategoriesWithIdsByCategory,
  getUniqueCategories,
  generateEnhancedSEO,
} = require('../../controllers/online/categorySubcategoryController');

const router = express.Router();

// Category CRUD routes
router.get('/', getAllCategories);
router.get('/names', getCategoryNames);
router.get('/subcategories/:categoryName', getSubcategoriesByCategory);
router.get('/subcategories-with-ids/:categoryName', getSubcategoriesWithIdsByCategory);
router.get('/by-name/:categoryName', getCategoryByName);
router.get('/unique', getUniqueCategories);
router.get('/:id', getCategoryById);
router.post('/category-only', createCategoryOnly);
router.post('/', upload.fields([
  { name: 'categoryImage', maxCount: 1 },
  { name: 'subcategoryImage', maxCount: 1 }
]), createCategory);
router.put('/:id', upload.fields([
  { name: 'categoryImage', maxCount: 1 },
  { name: 'subcategoryImage', maxCount: 1 }
]), updateCategory);
router.delete('/:id', deleteCategory);

// Status management
router.put('/:id/toggle-status', toggleCategoryStatus);

// SEO generation route
router.post('/generate-enhanced-seo', generateEnhancedSEO);

module.exports = router;
