const express = require("express");
const router = express.Router();
const {
  getAllPolicies,
  getPolicyByType,
  getPublishedPolicyBySlug,
  savePolicy,
  deletePolicy,
  togglePublishPolicy,
} = require("../../controllers/web/policyController");

// Get all policies
router.get("/", getAllPolicies);

// Get single policy by type
router.get("/type/:type", getPolicyByType);

// Get published policy by slug (public endpoint)
router.get("/public/:slug", getPublishedPolicyBySlug);

// Create or update policy
router.post("/", savePolicy);

// Toggle publish status
router.patch("/:id/publish", togglePublishPolicy);

// Delete policy
router.delete("/:id", deletePolicy);

module.exports = router;
