const express = require("express");
const router = express.Router();
const { proxyImage } = require("../../controllers/common/imageProxyController");

// Proxy image route - serves S3 images through backend
// Handles all paths after /api/image/
router.use("/", proxyImage);

module.exports = router;
