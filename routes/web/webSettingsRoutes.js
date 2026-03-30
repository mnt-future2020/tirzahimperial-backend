const express = require("express");
const router = express.Router();
const { upload } = require("../../utils/web/uploadsS3");
const {
  getWebSettings,
  uploadLogo,
  uploadFavicon,
  deleteLogo,
  deleteFavicon,
  proxyLogo,
  proxyFavicon,
} = require("../../controllers/web/webSettingsController");

// Get web settings
router.get("/", getWebSettings);

// Proxy logo (serve image directly - avoids CORS)
router.get("/logo", proxyLogo);

// Proxy favicon (serve image directly - avoids CORS)
router.get("/favicon", proxyFavicon);

// Upload logo
router.post("/logo", upload.single("logo"), uploadLogo);

// Upload favicon
router.post("/favicon", upload.single("favicon"), uploadFavicon);

// Delete logo
router.delete("/logo", deleteLogo);

// Delete favicon
router.delete("/favicon", deleteFavicon);

module.exports = router;
