const { prisma } = require("../../config/database");
const { generateEAN13, validateEAN13, generateRandomProductNumber } = require("../../utils/online/barcodeGenerator");

/**
 * Generate unique barcode
 * POST /api/online/barcodes/generate
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
      
      // Check if barcode already exists in any product variant
      const allProducts = await prisma.onlineProduct.findMany({
        select: {
          id: true,
          variants: true,
        },
      });
      
      // Check if barcode exists in any variant
      const isDuplicate = allProducts.some(product => 
        Array.isArray(product.variants) && 
        product.variants.some(variant => variant.variantBarcode === barcode)
      );
      
      // If no duplicate found, barcode is unique
      if (!isDuplicate) {
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
    console.error("Error generating barcode:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate barcode",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Validate barcode
 * POST /api/online/barcodes/validate
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
    
    // Check uniqueness in database
    const allProducts = await prisma.onlineProduct.findMany({
      select: {
        id: true,
        variants: true,
      },
    });
    
    // Check if barcode exists in any variant
    const isDuplicate = allProducts.some(product => 
      Array.isArray(product.variants) && 
      product.variants.some(variant => variant.variantBarcode === barcode)
    );
    
    const isUnique = !isDuplicate;
    
    res.json({
      success: true,
      data: {
        valid: true,
        unique: isUnique,
        message: isUnique ? "Valid and unique barcode" : "Barcode already exists in another product",
      },
    });
  } catch (error) {
    console.error("Error validating barcode:", error);
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
