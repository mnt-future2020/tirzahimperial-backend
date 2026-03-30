const { getS3Object } = require("../../utils/common/imageProxy");

/**
 * Proxy S3 images through backend
 * GET /api/image/*
 */
const proxyImage = async (req, res) => {
  try {
    // Get the full path after /api/image/
    let key = req.path.substring(1); // Remove leading slash
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: "Image key is required",
      });
    }

    // Decode URL-encoded key
    key = decodeURIComponent(key);

    console.log(`📸 Proxying image: ${key}`);

    // Get S3 object
    const s3Object = await getS3Object(key);
    
    // Set response headers - NO CACHE to ensure fresh images
    res.setHeader('Content-Type', s3Object.ContentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS
    
    // Stream the image
    s3Object.Body.pipe(res);
  } catch (error) {
    console.error("Error proxying image:", error);
    res.status(404).json({
      success: false,
      message: "Image not found",
      error: error.message,
    });
  }
};

module.exports = { proxyImage };
