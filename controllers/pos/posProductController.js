const { prisma } = require('../../config/database');
const { uploadToS3, getPresignedUrl } = require('../../utils/pos/uploadS3');

/**
 * Get all POS products
 * GET /api/pos/products
 */
const getAllPOSProducts = async (req, res) => {
  try {
    const { category, status, display } = req.query;

    // Build filter object
    const filter = {};
    if (category) {
      filter.category = category;
    }
    if (status) {
      filter.status = status;
    }
    if (display) {
      filter.display = display;
    }

    const products = await prisma.pOSProduct.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
    });

    // Convert S3 keys to presigned URLs
    const productsWithUrls = await Promise.all(
      products.map(async (product) => {
        let imageUrl = null;

        if (product.itemImage) {
          if (product.itemImage.startsWith('/uploads/')) {
            imageUrl = product.itemImage;
          } else if (product.itemImage.startsWith('http')) {
            imageUrl = getPresignedUrl(product.itemImage, 86400);
            if (!imageUrl) imageUrl = product.itemImage;
          } else {
            imageUrl = getPresignedUrl(product.itemImage, 86400);
          }
        }

        // Calculate display price with discount
        let basePrice = product.sellingPrice || product.mrp || product.purchasePrice;
        let discountAmount = 0;

        if (product.discountType && product.discountValue) {
          if (product.discountType === 'percentage') {
            discountAmount = (basePrice * product.discountValue) / 100;
          } else if (product.discountType === 'flat') {
            discountAmount = product.discountValue;
          }
        }

        const displayPrice = basePrice - discountAmount;

        return {
          ...product,
          itemImage: imageUrl,
          displayPrice: parseFloat(displayPrice.toFixed(2)),
          originalPrice: basePrice,
          discountAmount: parseFloat(discountAmount.toFixed(2)),
        };
      })
    );

    res.status(200).json({
      success: true,
      data: productsWithUrls,
      count: productsWithUrls.length,
    });
  } catch (error) {
    console.error('Error fetching POS products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch POS products',
      message: error.message,
    });
  }
};

/**
 * Get POS product by ID
 * GET /api/pos/products/:id
 */
const getPOSProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.pOSProduct.findUnique({
      where: { id },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      });
    }

    // Convert S3 key to presigned URL
    let imageUrl = null;
    if (product.itemImage) {
      if (product.itemImage.startsWith('/uploads/')) {
        imageUrl = product.itemImage;
      } else if (product.itemImage.startsWith('http')) {
        imageUrl = getPresignedUrl(product.itemImage, 86400);
        if (!imageUrl) imageUrl = product.itemImage;
      } else {
        imageUrl = getPresignedUrl(product.itemImage, 86400);
      }
    }

    // Calculate display price
    let basePrice = product.sellingPrice || product.mrp || product.purchasePrice;
    let discountAmount = 0;

    if (product.discountType && product.discountValue) {
      if (product.discountType === 'percentage') {
        discountAmount = (basePrice * product.discountValue) / 100;
      } else if (product.discountType === 'flat') {
        discountAmount = product.discountValue;
      }
    }

    const displayPrice = basePrice - discountAmount;

    const productWithUrl = {
      ...product,
      itemImage: imageUrl,
      displayPrice: parseFloat(displayPrice.toFixed(2)),
      originalPrice: basePrice,
      discountAmount: parseFloat(discountAmount.toFixed(2)),
    };

    res.status(200).json({
      success: true,
      data: productWithUrl,
    });
  } catch (error) {
    console.error('Error fetching POS product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch POS product',
      message: error.message,
    });
  }
};

/**
 * Create POS product from inventory item
 * POST /api/pos/products
 */
const createPOSProduct = async (req, res) => {
  try {
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: 'Item ID is required',
      });
    }

    // Check if POS product already exists for this item
    const existingPOSProduct = await prisma.pOSProduct.findFirst({
      where: { itemId },
    });

    if (existingPOSProduct) {
      return res.status(400).json({
        success: false,
        error: 'POS product already exists for this item',
        data: existingPOSProduct,
      });
    }

    // Get item from inventory
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: { warehouse: true },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found',
      });
    }
    
    // 🚫 Prevent processing items from being used in POS products
    if (item.itemType === 'processing') {
      return res.status(400).json({
        success: false,
        error: `Cannot use processing item "${item.itemName}" in POS products. Processing items are for internal use only.`,
      });
    }

    // Create POS product from item data
    // Convert availableUoms from objects to strings
    const availableUomsArray = Array.isArray(item.availableUoms) 
      ? item.availableUoms.map(uom => {
          // Convert {uom: "kg", conversionFactor: 1} to just "kg"
          if (typeof uom === 'object' && uom !== null && uom.uom) {
            return uom.uom;
          }
          return uom;
        })
      : [];
    
    console.log('📦 Creating POS Product with availableUoms:', availableUomsArray);
    
    const posProduct = await prisma.pOSProduct.create({
      data: {
        itemId: item.id,
        itemName: item.itemName,
        category: item.category,
        itemCode: item.itemCode,
        brand: item.brand,
        uom: item.uom,
        purchasePrice: item.purchasePrice,
        sellingPrice: item.sellingPrice,
        mrp: item.mrp,
        gstRateId: item.gstRateId,
        gstPercentage: item.gstPercentage,
        hsnCode: item.hsnCode,
        discountType: item.discountType,
        discountValue: item.discountValue,
        warehouse: item.warehouse.name,
        quantity: item.quantity,
        openingStock: item.openingStock,
        lowStockAlertLevel: item.lowStockAlertLevel,
        status: item.status,
        display: item.display || 'inactive',
        expiryDate: item.expiryDate,
        mfgDate: item.mfgDate,
        batchNo: item.batchNo,
        safetyInformation: item.safetyInformation,
        description: item.description,
        itemImage: item.itemImage,
        lastSyncedFromItem: new Date(),
        baseUom: item.baseUom,
        availableUoms: availableUomsArray,
        uomLocked: item.uomLocked || false,
      },
    });

    res.status(201).json({
      success: true,
      message: 'POS product created successfully',
      data: posProduct,
    });
  } catch (error) {
    console.error('Error creating POS product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create POS product',
      message: error.message,
    });
  }
};

/**
 * Update POS product
 * PUT /api/pos/products/:id
 */
const updatePOSProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      itemName,
      category,
      itemCode,
      brand,
      uom,
      purchasePrice,
      sellingPrice,
      mrp,
      gstPercentage,
      hsnCode,
      discountType,
      discountValue,
      lowStockAlertLevel,
      status,
      display,
      expiryDate,
      mfgDate,
      batchNo,
      safetyInformation,
      description,
      baseUom,
      availableUoms,
      uomLocked,
      variantUomValue,
      uomVariants
    } = req.body;

    // Check if product exists
    const existingProduct = await prisma.pOSProduct.findUnique({
      where: { id },
    });

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        error: 'POS product not found',
      });
    }

    // Handle image upload
    let itemImage = existingProduct.itemImage;
    if (req.file) {
      try {
        itemImage = await uploadToS3(req.file, 'pos-product-images');
        console.log('Image uploaded to S3:', itemImage);
      } catch (uploadError) {
        console.error('Error uploading image to S3:', uploadError);
        return res.status(500).json({
          success: false,
          error: 'Failed to upload image',
          message: uploadError.message,
        });
      }
    }

    // Build update data - only update fields that are provided
    const updateData = {};

    // Required fields (if provided)
    if (itemName !== undefined) updateData.itemName = itemName;
    if (category !== undefined) updateData.category = category;
    if (uom !== undefined) updateData.uom = uom;
    if (purchasePrice !== undefined) updateData.purchasePrice = parseFloat(purchasePrice) || 0;
    if (gstPercentage !== undefined) updateData.gstPercentage = parseFloat(gstPercentage) || 0;
    if (lowStockAlertLevel !== undefined) updateData.lowStockAlertLevel = parseInt(lowStockAlertLevel) || 0;
    if (status !== undefined) updateData.status = status;
    if (display !== undefined) updateData.display = display;

    // Optional fields
    if (itemCode !== undefined) updateData.itemCode = itemCode || null;
    if (brand !== undefined) updateData.brand = brand || null;
    if (hsnCode !== undefined) updateData.hsnCode = hsnCode || null;
    if (description !== undefined) updateData.description = description || null;
    if (sellingPrice !== undefined && sellingPrice !== '')
      updateData.sellingPrice = parseFloat(sellingPrice) || null;
    if (mrp !== undefined && mrp !== '') updateData.mrp = parseFloat(mrp) || null;
    if (discountType !== undefined)
      updateData.discountType = discountType === 'none' ? null : discountType;
    if (discountValue !== undefined && discountValue !== '')
      updateData.discountValue = parseFloat(discountValue) || null;
    if (expiryDate !== undefined)
      updateData.expiryDate = expiryDate ? new Date(expiryDate) : null;
    if (mfgDate !== undefined) updateData.mfgDate = mfgDate ? new Date(mfgDate) : null;
    if (batchNo !== undefined) updateData.batchNo = batchNo || null;
    if (safetyInformation !== undefined)
      updateData.safetyInformation = safetyInformation || null;
    
    // Multi-UOM fields
    if (baseUom !== undefined) updateData.baseUom = baseUom || null;
    if (availableUoms !== undefined) {
      try {
        updateData.availableUoms = typeof availableUoms === 'string' 
          ? JSON.parse(availableUoms) 
          : availableUoms;
      } catch (e) {
        console.error('Error parsing availableUoms:', e);
        updateData.availableUoms = [];
      }
    }
    if (uomLocked !== undefined) updateData.uomLocked = uomLocked === true;
    if (variantUomValue !== undefined) updateData.variantUomValue = parseFloat(variantUomValue) || null;

    // UOM Variants
    if (uomVariants !== undefined) {
      try {
        updateData.uomVariants = typeof uomVariants === 'string'
          ? JSON.parse(uomVariants)
          : uomVariants;
      } catch (e) {
        console.error('Error parsing uomVariants:', e);
        updateData.uomVariants = [];
      }
    }

    if (itemImage) {
      updateData.itemImage = itemImage;
    }

    // Update product
    const product = await prisma.pOSProduct.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: 'POS product updated successfully',
      data: product,
    });
  } catch (error) {
    console.error('Error updating POS product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update POS product',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * Toggle POS product display status
 * PATCH /api/pos/products/:id/display
 */
const togglePOSProductDisplay = async (req, res) => {
  try {
    const { id } = req.params;
    const { display } = req.body;

    if (!display || !['active', 'inactive'].includes(display)) {
      return res.status(400).json({
        success: false,
        error: "Invalid display value. Must be 'active' or 'inactive'",
      });
    }

    const existingProduct = await prisma.pOSProduct.findUnique({
      where: { id },
    });

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        error: 'POS product not found',
      });
    }

    const product = await prisma.pOSProduct.update({
      where: { id },
      data: { display },
    });

    res.status(200).json({
      success: true,
      message: 'POS product display status updated successfully',
      data: product,
    });
  } catch (error) {
    console.error('Error updating POS product display status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update POS product display status',
      message: error.message,
    });
  }
};

/**
 * Sync POS product from inventory item
 * POST /api/pos/products/:id/sync
 */
const syncPOSProductFromItem = async (req, res) => {
  try {
    const { id } = req.params;

    const posProduct = await prisma.pOSProduct.findUnique({
      where: { id },
    });

    if (!posProduct) {
      return res.status(404).json({
        success: false,
        error: 'POS product not found',
      });
    }

    // Get latest item data
    const item = await prisma.item.findUnique({
      where: { id: posProduct.itemId },
      include: { warehouse: true },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found',
      });
    }

    // Update POS product with latest item data (preserve POS-specific edits)
    // Convert availableUoms from objects to strings
    const availableUomsArray = Array.isArray(item.availableUoms) 
      ? item.availableUoms.map(uom => {
          if (typeof uom === 'object' && uom !== null && uom.uom) {
            return uom.uom;
          }
          return uom;
        })
      : [];

    const updatedProduct = await prisma.pOSProduct.update({
      where: { id },
      data: {
        quantity: item.quantity, // Always sync stock
        status: item.status, // Always sync status
        warehouse: item.warehouse.name,
        baseUom: item.baseUom,
        availableUoms: availableUomsArray,
        uomLocked: item.uomLocked || false,
        lastSyncedFromItem: new Date(),
        syncedAt: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      message: 'POS product synced successfully',
      data: updatedProduct,
    });
  } catch (error) {
    console.error('Error syncing POS product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync POS product',
      message: error.message,
    });
  }
};

/**
 * Delete POS product
 * DELETE /api/pos/products/:id
 */
const deletePOSProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const existingProduct = await prisma.pOSProduct.findUnique({
      where: { id },
    });

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        error: 'POS product not found',
      });
    }

    await prisma.pOSProduct.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: 'POS product deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting POS product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete POS product',
      message: error.message,
    });
  }
};

module.exports = {
  getAllPOSProducts,
  getPOSProductById,
  createPOSProduct,
  updatePOSProduct,
  togglePOSProductDisplay,
  syncPOSProductFromItem,
  deletePOSProduct,
};
