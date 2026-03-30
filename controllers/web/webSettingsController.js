const { prisma } = require("../../config/database");
const { uploadToS3, getPresignedUrl, deleteFromS3, getS3Object } = require("../../utils/web/uploadsS3");

// Get current web settings
const getWebSettings = async (req, res) => {
  try {
    let settings = await prisma.webSettings.findFirst();
    
    // If no settings exist, create default
    if (!settings) {
      settings = await prisma.webSettings.create({
        data: {},
      });
    }

    // Use proxy endpoints instead of presigned URLs to avoid CORS issues
    // Check for forwarded protocol (for proxies like Vercel, Heroku, etc.)
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    
    // Add version parameter based on updatedAt to bust cache when logo changes
    const version = settings.updatedAt ? new Date(settings.updatedAt).getTime() : Date.now();
    
    const logoUrl = settings.logoUrl
      ? `${baseUrl}/api/web/web-settings/logo?v=${version}`
      : null;
    const faviconUrl = settings.faviconUrl
      ? `${baseUrl}/api/web/web-settings/favicon?v=${version}`
      : null;

    const response = {
      id: settings.id,
      logoUrl, // Proxy URL with version parameter
      faviconUrl, // Proxy URL with version parameter
      logoKey: settings.logoUrl, // Original S3 key
      faviconKey: settings.faviconUrl, // Original S3 key
      updatedAt: settings.updatedAt,
      createdAt: settings.createdAt,
    };

    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error("Error fetching web settings:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch web settings",
      message: error.message,
    });
  }
};

// Upload logo
const uploadLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    // Get current settings
    let settings = await prisma.webSettings.findFirst();
    
    // Delete old logo from S3 if exists
    if (settings?.logoUrl) {
      await deleteFromS3(settings.logoUrl);
    }

    // Upload new logo to S3 - returns only the key/path
    const logoKey = await uploadToS3(req.file, "web-settings/logos");

    // Update or create settings - store only the key
    if (settings) {
      settings = await prisma.webSettings.update({
        where: { id: settings.id },
        data: { logoUrl: logoKey },
      });
    } else {
      settings = await prisma.webSettings.create({
        data: { logoUrl: logoKey },
      });
    }

    // Generate proxy URL for response
    const logoProxyUrl = getPresignedUrl(logoKey);

    res.json({
      success: true,
      message: "Logo uploaded successfully",
      data: {
        logoUrl: logoProxyUrl, // Proxy URL for immediate use
        logoKey: logoKey, // S3 key stored in database
      },
    });
  } catch (error) {
    console.error("Error uploading logo:", error);
    res.status(500).json({
      success: false,
      error: "Failed to upload logo",
      message: error.message,
    });
  }
};

// Upload favicon
const uploadFavicon = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    // Get current settings
    let settings = await prisma.webSettings.findFirst();
    
    // Delete old favicon from S3 if exists
    if (settings?.faviconUrl) {
      await deleteFromS3(settings.faviconUrl);
    }

    // Upload new favicon to S3 - returns only the key/path
    const faviconKey = await uploadToS3(req.file, "web-settings/favicons");

    // Update or create settings - store only the key
    if (settings) {
      settings = await prisma.webSettings.update({
        where: { id: settings.id },
        data: { faviconUrl: faviconKey },
      });
    } else {
      settings = await prisma.webSettings.create({
        data: { faviconUrl: faviconKey },
      });
    }

    // Generate proxy URL for response
    const faviconProxyUrl = getPresignedUrl(faviconKey);

    res.json({
      success: true,
      message: "Favicon uploaded successfully",
      data: {
        faviconUrl: faviconProxyUrl, // Proxy URL for immediate use
        faviconKey: faviconKey, // S3 key stored in database
      },
    });
  } catch (error) {
    console.error("Error uploading favicon:", error);
    res.status(500).json({
      success: false,
      error: "Failed to upload favicon",
      message: error.message,
    });
  }
};

// Delete logo
const deleteLogo = async (req, res) => {
  try {
    const settings = await prisma.webSettings.findFirst();
    
    if (!settings || !settings.logoUrl) {
      return res.status(404).json({
        success: false,
        error: "No logo found",
      });
    }

    // Delete from S3
    await deleteFromS3(settings.logoUrl);

    // Update settings
    await prisma.webSettings.update({
      where: { id: settings.id },
      data: { logoUrl: null },
    });

    res.json({
      success: true,
      message: "Logo deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting logo:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete logo",
      message: error.message,
    });
  }
};

// Delete favicon
const deleteFavicon = async (req, res) => {
  try {
    const settings = await prisma.webSettings.findFirst();
    
    if (!settings || !settings.faviconUrl) {
      return res.status(404).json({
        success: false,
        error: "No favicon found",
      });
    }

    // Delete from S3
    await deleteFromS3(settings.faviconUrl);

    // Update settings
    await prisma.webSettings.update({
      where: { id: settings.id },
      data: { faviconUrl: null },
    });

    res.json({
      success: true,
      message: "Favicon deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting favicon:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete favicon",
      message: error.message,
    });
  }
};

/**
 * Proxy logo image from S3 (avoids CORS issues)
 */
const proxyLogo = async (req, res) => {
  try {
    const settings = await prisma.webSettings.findFirst();

    if (!settings || !settings.logoUrl) {
      return res.status(404).json({
        success: false,
        error: "Logo not found",
      });
    }

    // Get the S3 object
    const s3Object = await getS3Object(settings.logoUrl);

    // Set appropriate headers - NO CACHE to ensure fresh logo
    res.setHeader("Content-Type", s3Object.ContentType || "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*"); // Allow CORS

    // Stream the image
    s3Object.Body.pipe(res);
  } catch (error) {
    console.error("Error proxying logo:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch logo",
    });
  }
};

/**
 * Proxy favicon image from S3 (avoids CORS issues)
 */
const proxyFavicon = async (req, res) => {
  try {
    const settings = await prisma.webSettings.findFirst();

    if (!settings || !settings.faviconUrl) {
      return res.status(404).json({
        success: false,
        error: "Favicon not found",
      });
    }

    // Get the S3 object
    const s3Object = await getS3Object(settings.faviconUrl);

    // Set appropriate headers - NO CACHE to ensure fresh favicon
    res.setHeader("Content-Type", s3Object.ContentType || "image/x-icon");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*"); // Allow CORS

    // Stream the image
    s3Object.Body.pipe(res);
  } catch (error) {
    console.error("Error proxying favicon:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch favicon",
    });
  }
};

module.exports = {
  getWebSettings,
  uploadLogo,
  uploadFavicon,
  deleteLogo,
  deleteFavicon,
  proxyLogo,
  proxyFavicon,
};
