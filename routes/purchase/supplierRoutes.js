const express = require("express");
const router = express.Router();
const {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} = require("../../controllers/purchase/supplierController");
const { upload } = require("../../utils/purchase/uploadsS3");

// Get all suppliers
router.get("/", getAllSuppliers);

// Get supplier by ID
router.get("/:id", getSupplierById);

// Create supplier (with file upload)
router.post("/", upload.single("attachment"), createSupplier);

// Update supplier (with file upload)
router.put("/:id", upload.single("attachment"), updateSupplier);

// Delete supplier
router.delete("/:id", deleteSupplier);

module.exports = router;
