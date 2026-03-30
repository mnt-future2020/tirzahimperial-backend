const express = require("express");
const router = express.Router();
const {
  createDeliveryPartner,
  getAllDeliveryPartners,
  getDeliveryPartnerById,
  updateDeliveryPartner,
  updateStatus,
  updateApplicationStatus,
  updatePartnerStatus,
  getApprovedPartners,
  getStatusHistory,
} = require("../../controllers/delivery/deliveryPartnerController");
const {
  getAllPartnersReports,
} = require("../../controllers/partner/partnerReportsController");
const {
  validateDeliveryPartner,
  validateUpdateDeliveryPartner,
  validateObjectId,
} = require("../../middleware/delivery/validation");
const { uploadDocument } = require("../../utils/delivery/uploadS3");
const { authenticateToken } = require("../../middleware/auth");

// Get approved partners (for manage profile)
router.get("/approved", authenticateToken, getApprovedPartners);

// Get all partners reports (admin view)
router.get("/reports", authenticateToken, getAllPartnersReports);

// Get all delivery partners
router.get("/", authenticateToken, getAllDeliveryPartners);

// Get delivery partner by ID
router.get("/:id", authenticateToken, validateObjectId, getDeliveryPartnerById);

// Get status history
router.get("/:id/status-history", authenticateToken, validateObjectId, getStatusHistory);

// Public partner registration (no auth required)
router.post("/register", uploadDocument.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'aadharDocument', maxCount: 1 },
  { name: 'licenseDocument', maxCount: 1 },
  { name: 'vehicleRCDocument', maxCount: 1 },
  { name: 'insuranceDocument', maxCount: 1 },
  { name: 'pollutionCertDocument', maxCount: 1 },
  { name: 'idProofDocument', maxCount: 1 }
]), validateDeliveryPartner, createDeliveryPartner);

// Create new delivery partner with file uploads (admin only)
router.post("/", authenticateToken, uploadDocument.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'aadharDocument', maxCount: 1 },
  { name: 'licenseDocument', maxCount: 1 },
  { name: 'vehicleRCDocument', maxCount: 1 },
  { name: 'insuranceDocument', maxCount: 1 },
  { name: 'pollutionCertDocument', maxCount: 1 },
  { name: 'idProofDocument', maxCount: 1 }
]), validateDeliveryPartner, createDeliveryPartner);

// Update delivery partner with file uploads
router.put(
  "/:id",
  authenticateToken,
  validateObjectId,
  uploadDocument.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'aadharDocument', maxCount: 1 },
    { name: 'licenseDocument', maxCount: 1 },
    { name: 'vehicleRCDocument', maxCount: 1 },
    { name: 'insuranceDocument', maxCount: 1 },
    { name: 'pollutionCertDocument', maxCount: 1 },
    { name: 'idProofDocument', maxCount: 1 }
  ]),
  validateUpdateDeliveryPartner,
  updateDeliveryPartner
);

// Update application status (pending -> verified -> approved/rejected)
router.put(
  "/:id/application-status",
  authenticateToken,
  validateObjectId,
  updateApplicationStatus
);

// Update partner status (active/inactive/suspended) - Only for approved partners
router.put("/:id/partner-status", authenticateToken, validateObjectId, updatePartnerStatus);

// Update status (legacy - keeping for backward compatibility)
router.put("/:id/status", authenticateToken, validateObjectId, updateStatus);

module.exports = router;
