const express = require("express");
const router = express.Router();
const {
  getAllItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  upload,
} = require("../../controllers/inventory/itemController");
const {
  checkItemUsage,
  checkBulkItemUsage,
} = require("../../controllers/inventory/itemUsageController");

// Item routes
router.get("/", getAllItems);
router.get("/:id", getItemById);
router.post("/", upload.single("itemImage"), createItem);
router.put("/:id", upload.single("itemImage"), updateItem);
router.delete("/:id", deleteItem);

// Item usage check routes
router.get("/:id/usage", checkItemUsage);
router.post("/usage/bulk", checkBulkItemUsage);

module.exports = router;
