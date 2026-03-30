const express = require("express");
const router = express.Router();
const {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
} = require("../../controllers/inventory/warehouseController");

// Warehouse routes
router.get("/", getAllWarehouses);
router.get("/:id", getWarehouseById);
router.post("/", createWarehouse);
router.put("/:id", updateWarehouse);

module.exports = router;
