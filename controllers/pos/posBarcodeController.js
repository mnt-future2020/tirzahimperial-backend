const { prisma } = require("../../config/database");
const { generateEAN13, validateEAN13, generateRandomProductNumber } = require("../../utils/pos/barcodeGenerator");

/**
 * Generate unique barcode for POS products
 * POST /api/pos/barcodes/generate
 */
const generateBarcode = async (req, res) => {
  try {
    let barcode;
    let attempts = 0;
    const maxAttempts = 10;
    
    // Try to generate unique barcode
    while (attempts < maxAttempts) {
      const productNumber = generateRandomProductNumber();
      barcode = generateEAN13(productNumber);
      
      // Check if barcode already exists in any variant in POS products
      // Using MongoDB findRaw for reliable deep array search
      const existing = await prisma.pOSProduct.findRaw({
        filter: {
          "uomVariants.barcode": barcode
        },
        options: { limit: 1 }
      });
      
      // If no duplicate found (findRaw returns array), barcode is unique
      if (!existing || !Array.isArray(existing) || existing.length === 0) {
        break;
      }
      
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate unique barcode. Please try again.",
      });
    }
    
    res.json({
      success: true,
      data: {
        barcode,
        format: "EAN-13",
      },
    });
  } catch (error) {
    console.error("Error generating POS barcode:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate barcode",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Validate barcode for POS products
 * POST /api/pos/barcodes/validate
 */
const validateBarcodeEndpoint = async (req, res) => {
  try {
    const { barcode } = req.body;
    
    if (!barcode) {
      return res.status(400).json({
        success: false,
        message: "Barcode is required",
      });
    }
    
    // Validate format
    const validation = validateEAN13(barcode);
    
    if (!validation.valid) {
      return res.json({
        success: true,
        data: {
          valid: false,
          message: validation.message,
          unique: false,
        },
      });
    }
    
    // Check uniqueness across all variants in MongoDB
    const existing = await prisma.pOSProduct.findRaw({
      filter: {
        "uomVariants.barcode": barcode
      },
      options: { limit: 1 }
    });
    
    const isUnique = !existing || !Array.isArray(existing) || existing.length === 0;
    
    res.json({
      success: true,
      data: {
        valid: true,
        unique: isUnique,
        message: isUnique ? "Valid and unique barcode" : "Barcode already exists in another POS product",
      },
    });
  } catch (error) {
    console.error("Error validating POS barcode:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate barcode",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

module.exports = {
  generateBarcode,
  validateBarcodeEndpoint,
};
