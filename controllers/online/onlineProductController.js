const { prisma } = require("../../config/database");
const {  uploadToS3 } = require("../../utils/online/uploadS3");
const { getProxyImageUrl } = require("../../utils/common/imageProxy");
const { lockItemUOM } = require("../inventory/itemController");
const { syncOnlineProductStock } = require("../../utils/inventory/stockUpdateService");
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Helper function to extract S3 key from a presigned URL or return the key as-is
 * This handles both presigned URLs and raw S3 keys
 */
const extractS3Key = (urlOrKey) => {
  if (!urlOrKey || typeof urlOrKey !== 'string') return null;
  
  // If it's already just a key (no http), return as-is
  if (!urlOrKey.startsWith('http://') && !urlOrKey.startsWith('https://')) {
    return urlOrKey;
  }
  
  // Extract key from S3 URL (handles both presigned and regular S3 URLs)
  // Pattern: https://bucket.s3.region.amazonaws.com/key?query-params
  const s3Pattern = /https?:\/\/[^\/]+\.s3\.[^\/]+\.amazonaws\.com\/([^?]+)/;
  const match = urlOrKey.match(s3Pattern);
  
  if (match && match[1]) {
    return decodeURIComponent(match[1]); // Decode URL-encoded characters
  }
  
  // If not an S3 URL, return as-is (might be external URL)
  return urlOrKey;
};

/**
 * Helper function to process variant images before saving
 * Converts presigned URLs to S3 keys for storage
 */
const processVariantImagesForStorage = (variants) => {
  return variants.map((variant) => {
    if (variant.variantImages && Array.isArray(variant.variantImages)) {
      const processedImages = variant.variantImages
        .map((img) => {
          // Skip File objects (they're handled separately via upload)
          if (typeof img !== 'string') return null;
          // Skip empty strings
          if (!img || img.trim() === '') return null;
          // Extract S3 key from presigned URL
          return extractS3Key(img);
        })
        .filter(Boolean); // Remove nulls
      
      return { ...variant, variantImages: processedImages };
    }
    return variant;
  });
};

/**
 * Helper function to convert image keys to proxy URLs in variants
 */
const convertVariantImagesToUrls = (variants) => {
  return variants.map((variant) => {
    if (variant.variantImages && Array.isArray(variant.variantImages)) {
      const imageUrls = variant.variantImages
        .map((img) => getProxyImageUrl(img))
        .filter(Boolean); // Remove nulls
      return { ...variant, variantImages: imageUrls };
    }
    return variant;
  });
};

/**
 * Helper function to sync combo product stock based on component availability
 * Uses productId from comboItems to get online product variant stock
 * @param {Object} comboProduct - Combo product object
 * @returns {Object} Updated combo product
 */
const syncComboProductStock = async (comboProduct) => {
  if (!comboProduct.comboItems || comboProduct.comboItems.length === 0) {
    return comboProduct;
  }

  let minComboUnits = Infinity;

  // Check each component using online product stock
  for (const comboItem of comboProduct.comboItems) {
    // Use productId to get online product stock
    if (!comboItem.productId) {
      console.warn(`⚠️ No productId for component: ${comboItem.productName || 'Unknown'}`);
      minComboUnits = 0;
      continue;
    }

    // Get online product and its variant stock
    const componentProduct = await prisma.onlineProduct.findUnique({
      where: { id: comboItem.productId },
      select: { 
        id: true,
        shortDescription: true,
        variants: true
      }
    });

    if (!componentProduct) {
      console.warn(`⚠️ Online product not found: ${comboItem.productId}`);
      minComboUnits = 0;
      continue;
    }

    const variantIndex = comboItem.variantIndex || 0;
    const variant = componentProduct.variants[variantIndex];

    if (!variant) {
      console.warn(`⚠️ Variant ${variantIndex} not found for product: ${componentProduct.shortDescription}`);
      minComboUnits = 0;
      continue;
    }

    // Get available stock from online product variant
    const availableStock = variant.variantStockQuantity || 0;

    // Calculate how many combos can be made with this component
    // For items with UOM (e.g., 500g), we need quantity × variantUomValue
    const baseQuantity = comboItem.quantity || 1;
    const uomValue = comboItem.variantUomValue || 1;
    const requiredPerCombo = baseQuantity * uomValue;

    // Calculate possible combos
    // If variant has UOM, availableStock is already in that UOM
    const possibleCombos = Math.floor(availableStock / requiredPerCombo);
    
    minComboUnits = Math.min(minComboUnits, possibleCombos);
    
    console.log(`   📊 ${variant.displayName || variant.variantName}: ${availableStock}${comboItem.variantUom || ''} available, ${requiredPerCombo}${comboItem.variantUom || ''} required → ${possibleCombos} combos possible`);
  }

  const finalStock = minComboUnits === Infinity ? 0 : minComboUnits;

  // Calculate stock status
  let stockStatus;
  if (finalStock === 0) {
    stockStatus = "out-of-stock";
  } else if (finalStock <= 10) {
    stockStatus = "low-stock";
  } else {
    stockStatus = "in-stock";
  }

  // Update the combo product variant
  const updatedVariants = comboProduct.variants.map((variant, index) => {
    if (index === 0) {
      return {
        ...variant,
        variantStockQuantity: finalStock,
        variantStockStatus: stockStatus
      };
    }
    return variant;
  });

  // Update in database
  const updatedProduct = await prisma.onlineProduct.update({
    where: { id: comboProduct.id },
    data: {
      variants: updatedVariants
    }
  });

  console.log(`✅ Combo product "${comboProduct.shortDescription}" stock updated: ${finalStock} (${stockStatus})`);

  return updatedProduct;
};

/**
 * Get all online products
 * GET /api/online/online-products
 */
const getAllOnlineProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      subCategory,
      status,
      type,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build where clause
    const where = {};
    const conditions = [];

    // Search condition
    if (search && search.trim() !== "") {
      conditions.push({
        OR: [
          { brand: { contains: search.trim(), mode: "insensitive" } },
          { shortDescription: { contains: search.trim(), mode: "insensitive" } },
        ]
      });
    }

    // Type filtering with backward compatibility
    if (type === 'regular') {
      // Show everything that is NOT a combo (including nulls/missing fields)
      conditions.push({
        OR: [
          { type: 'regular' }, // Explicit regular
          { type: null },      // Missing/Null (Legacy)
          { type: { not: 'combo' } } // Any other type that isn't combo
        ]
      });
    } else if (type) {
      // Specific type (e.g., 'combo')
      where.type = type;
    }

    // Apply combined complex conditions
    if (conditions.length > 0) {
      where.AND = conditions;
    }

    // Standard filters
    if (category) where.category = category;
    if (subCategory) where.subCategory = subCategory;
    if (status) where.productStatus = status;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Fetch products with pagination
    const [products, totalCount] = await Promise.all([
      prisma.onlineProduct.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.onlineProduct.count({ where }),
    ]);

    // Convert variant images to proxy URLs and format default image
    const productsWithUrls = products.map((product) => ({
      ...product,
      variants: convertVariantImagesToUrls(product.variants),
      // 🆕 Convert thumbnail S3 key to proxy URL for combo products
      thumbnail: product.thumbnail ? getProxyImageUrl(product.thumbnail) : null,
    }));

    // Get all unique badge IDs
    const badgeIds = [...new Set(productsWithUrls.flatMap(p => [p.homepageBadgeId, p.productsPageBadgeId]).filter(Boolean))];
    
    // Fetch badge names
    let badgesMap = {};
    if (badgeIds.length > 0) {
      const badges = await prisma.badge.findMany({
        where: { id: { in: badgeIds } },
        select: { id: true, name: true }
      });
      badgesMap = Object.fromEntries(badges.map(b => [b.id, b.name]));
    }

    // Add badge names to products
    const productsWithBadges = productsWithUrls.map(product => ({
      ...product,
      homepageBadge: product.homepageBadgeId ? badgesMap[product.homepageBadgeId] : null,
      productsPageBadge: product.productsPageBadgeId ? badgesMap[product.productsPageBadgeId] : null,
    }));

    const totalPages = Math.ceil(totalCount / take);

    res.json({
      success: true,
      data: productsWithBadges,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching online products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch online products",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get online product by ID
 * GET /api/online/online-products/:id
 */
const getOnlineProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.onlineProduct.findUnique({
      where: { id },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Convert variant images to proxy URLs and format default image
    const productWithUrls = {
      ...product,
      variants: convertVariantImagesToUrls(product.variants),
      // 🆕 Convert thumbnail S3 key to proxy URL for combo products
      thumbnail: product.thumbnail ? getProxyImageUrl(product.thumbnail) : null,
    };

    // Fetch badge names if IDs exist
    if (productWithUrls.homepageBadgeId || productWithUrls.productsPageBadgeId) {
      const badgeIds = [productWithUrls.homepageBadgeId, productWithUrls.productsPageBadgeId].filter(Boolean);
      const badges = await prisma.badge.findMany({
        where: { id: { in: badgeIds } },
        select: { id: true, name: true }
      });
      const badgesMap = Object.fromEntries(badges.map(b => [b.id, b.name]));
      
      productWithUrls.homepageBadge = productWithUrls.homepageBadgeId ? badgesMap[productWithUrls.homepageBadgeId] : null;
      productWithUrls.productsPageBadge = productWithUrls.productsPageBadgeId ? badgesMap[productWithUrls.productsPageBadgeId] : null;
    } else {
      productWithUrls.homepageBadge = null;
      productWithUrls.productsPageBadge = null;
    }

    res.json({
      success: true,
      data: productWithUrls,
    });
  } catch (error) {
    console.error("Error fetching online product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch online product",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Create online product
 * POST /api/online/online-products
 */
const createOnlineProduct = async (req, res) => {
  try {
    console.log("📦 Creating online product...");
    console.log("Request body keys:", Object.keys(req.body));
    console.log("Files received:", req.files ? req.files.length : 0);
    
    // Parse product data from FormData
    let productData;
    if (req.body.productData) {
      // Data sent as FormData with productData field
      productData = typeof req.body.productData === 'string' 
        ? JSON.parse(req.body.productData) 
        : req.body.productData;
    } else {
      // Data sent as regular JSON
      productData = req.body;
    }

    // 🆕 Parse JSON strings if they were sent via FormData (common in multipart requests)
    if (typeof productData.variants === 'string') {
      try {
        productData.variants = JSON.parse(productData.variants);
      } catch (e) {
        console.warn("⚠️ Failed to parse variants as JSON, keeping as is");
      }
    }
    
    if (typeof productData.frequentlyBoughtTogether === 'string') {
      try {
        productData.frequentlyBoughtTogether = JSON.parse(productData.frequentlyBoughtTogether);
      } catch (e) {
        console.warn("⚠️ Failed to parse frequentlyBoughtTogether as JSON, keeping as is");
      }
    }

    if (typeof productData.cuttingStyles === 'string') {
      try {
        productData.cuttingStyles = JSON.parse(productData.cuttingStyles);
      } catch (e) {
        console.warn("⚠️ Failed to parse cuttingStyles as JSON, keeping as is");
      }
    }

    // 🆕 Parse comboItems JSON string (sent via FormData for combo products)
    if (typeof productData.comboItems === 'string') {
      try {
        productData.comboItems = JSON.parse(productData.comboItems);
      } catch (e) {
        console.warn("⚠️ Failed to parse comboItems as JSON, keeping as is");
      }
    }

    // 🆕 Enrich comboItems with inventoryProductId for better performance
    if (Array.isArray(productData.comboItems) && productData.comboItems.length > 0) {
      console.log("🔍 Enriching combo items with inventoryProductId and category...");
      
      for (const comboItem of productData.comboItems) {
        if (!comboItem.inventoryProductId && comboItem.productId && comboItem.variantIndex !== undefined) {
          try {
            const componentProduct = await prisma.onlineProduct.findUnique({
              where: { id: comboItem.productId }
            });
            
            if (componentProduct && componentProduct.variants && componentProduct.variants[comboItem.variantIndex]) {
              comboItem.inventoryProductId = componentProduct.variants[comboItem.variantIndex].inventoryProductId;
              console.log(`✅ Enriched combo item with inventoryProductId: ${comboItem.inventoryProductId}`);
              
              // 🆕 Save category in comboItem for easy filtering
              if (componentProduct.category) {
                comboItem.category = componentProduct.category;
                console.log(`✅ Saved category "${componentProduct.category}" in combo item`);
              }
            } else {
              console.warn(`⚠️ Could not find variant for combo item: ${comboItem.productName}`);
            }
          } catch (error) {
            console.error(`❌ Error enriching combo item:`, error);
          }
        } else if (comboItem.productId) {
          // If inventoryProductId already exists, still fetch and save category
          try {
            const componentProduct = await prisma.onlineProduct.findUnique({
              where: { id: comboItem.productId },
              select: { category: true }
            });
            if (componentProduct && componentProduct.category) {
              comboItem.category = componentProduct.category;
              console.log(`✅ Saved category "${componentProduct.category}" in combo item`);
            }
          } catch (error) {
            console.error(`❌ Error fetching component category:`, error);
          }
        }
      }
      
      // 🆕 Set combo product category to "Combo Category" (fixed)
      if (productData.type === 'combo') {
        productData.category = 'Combo Category';
        console.log(`✅ Set combo product category to "Combo Category"`);
      }
    }

    // Validation
    if (!productData.category) {
      console.log("❌ Validation failed: Missing category");
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    if (!productData.variants || productData.variants.length === 0) {
      console.log("❌ Validation failed: No variants provided");
      return res.status(400).json({
        success: false,
        message: "At least one variant is required",
      });
    }

    // 🔒 CRITICAL: Check for duplicate SKUs within variants
    // 🆕 EXCEPTION: Allow duplicate SKUs if they're from the same inventory item
    const skuSet = new Map(); // Map SKU to inventoryProductId
    const duplicateSKUs = [];
    
    productData.variants.forEach((variant, index) => {
      const sku = variant.variantSKU;
      const inventoryProductId = variant.inventoryProductId;
      
      if (sku && sku.trim() !== "") {
        if (skuSet.has(sku)) {
          // Check if it's the same inventory item
          const existingInventoryId = skuSet.get(sku);
          if (existingInventoryId !== inventoryProductId) {
            // Different inventory items with same SKU - NOT ALLOWED
            duplicateSKUs.push({ sku, variantIndex: index + 1 });
          }
          // Same inventory item with same SKU - ALLOWED (multiple variants of same item)
        } else {
          skuSet.set(sku, inventoryProductId);
        }
      }
    });

    if (duplicateSKUs.length > 0) {
      console.log("❌ Validation failed: Duplicate SKUs detected:", duplicateSKUs);
      return res.status(400).json({
        success: false,
        message: "Duplicate SKUs detected in variants",
        details: `The following SKUs are used multiple times: ${duplicateSKUs.map(d => `${d.sku} (Variant ${d.variantIndex})`).join(", ")}. Each variant must have a unique SKU unless they're from the same inventory item.`,
        duplicates: duplicateSKUs,
      });
    }

    // 🔒 SECURITY: Verify stock quantities don't exceed inventory limits
    for (const variant of productData.variants) {
      if (variant.variantStockQuantity && variant.variantStockQuantity > 1000000) {
        console.log("❌ Validation failed: Unrealistic stock quantity");
        return res.status(400).json({
          success: false,
          message: "Stock quantity exceeds maximum allowed limit (1,000,000 units)",
        });
      }
    }

    console.log("✅ Validation passed, uploading images to S3...");

    // Upload all images to S3
    let thumbnailKey = null; // 🆕 Declared outside for combo thumbnail access in preparedData
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} images to S3...`);
      const uploadedImageKeys = await Promise.all(
        req.files.map((file) => uploadToS3(file.buffer, file.originalname, file.mimetype))
      );
      console.log("✅ Images uploaded to S3:", uploadedImageKeys);
      
      // Map uploaded images back to variants based on fieldname
      // Fieldname format: "variant_0_image_0", "variant_0_image_1", etc.
      // OR "thumbnail" for combo product main image
      req.files.forEach((file, index) => {
        const key = uploadedImageKeys[index];
        
        // 🆕 Handle combo product thumbnail
        if (file.fieldname === 'thumbnail') {
          thumbnailKey = key;
          console.log(`📸 Combo thumbnail uploaded: ${key}`);
        }
        // Handle variant images
        else if (file.fieldname && file.fieldname.startsWith('variant_')) {
          const parts = file.fieldname.split('_');
          const variantIndex = parseInt(parts[1]);
          const imageIndex = parseInt(parts[3]);
          
          if (productData.variants[variantIndex]) {
            if (!productData.variants[variantIndex].variantImages) {
              productData.variants[variantIndex].variantImages = [];
            }
            productData.variants[variantIndex].variantImages[imageIndex] = key;
          }
        }
      });
    }

    console.log("✅ Preparing data for database...");
    
    // 🆕 Validate variant UOMs and lock inventory item UOMs
    const inventoryItemsToLock = new Set();
    
    for (const variant of productData.variants) {
      if (variant.inventoryProductId) {
        // Fetch inventory item to validate UOM
        const inventoryItem = await prisma.item.findUnique({
          where: { id: variant.inventoryProductId }
        });
        
        // 🚫 Prevent processing items from being used in online products
        if (inventoryItem && inventoryItem.itemType === 'processing') {
          console.log("❌ Validation failed: Processing item cannot be used in online product");
          return res.status(400).json({
            success: false,
            message: `Cannot use processing item "${inventoryItem.itemName}" in online products. Processing items are for internal use only.`,
          });
        }
        
        if (!inventoryItem) {
          console.log(`❌ Validation failed: Inventory item not found: ${variant.inventoryProductId}`);
          return res.status(400).json({
            success: false,
            message: `Inventory item not found for variant`,
            variantSKU: variant.variantSKU,
          });
        }
        
        // Validate variant UOM if provided
        if (variant.variantUom) {
          const uomExists = inventoryItem.availableUoms?.some(u => u.uom === variant.variantUom);
          if (!uomExists) {
            console.log(`❌ Validation failed: UOM ${variant.variantUom} not available for item ${inventoryItem.itemName}`);
            return res.status(400).json({
              success: false,
              message: `UOM "${variant.variantUom}" is not available for inventory item "${inventoryItem.itemName}"`,
              availableUoms: inventoryItem.availableUoms?.map(u => u.uom) || [inventoryItem.baseUom],
              variantSKU: variant.variantSKU,
            });
          }
        }
        
        // Mark item for UOM locking
        inventoryItemsToLock.add(variant.inventoryProductId);
      }
    }
    
    // Process variants: add stock status and ensure low stock alert is set
    const processedVariants = processVariantImagesForStorage(productData.variants).map((variant) => {
      const variantLowStockAlert = variant.variantLowStockAlert || 10;
      const variantStockQuantity = variant.variantStockQuantity || 0;
      
      // Calculate variant-level stock status
      let variantStockStatus;
      if (variantStockQuantity === 0) {
        variantStockStatus = "out-of-stock";
      } else if (variantStockQuantity <= variantLowStockAlert) {
        variantStockStatus = "low-stock";
      } else {
        variantStockStatus = "in-stock";
      }
      
      return {
        ...variant,
        variantLowStockAlert,
        variantStockStatus,
        // 🆕 Include UOM fields
        variantUom: variant.variantUom || null,
        variantUomValue: variant.variantUomValue || null,
      };
    });
    
    // Prepare data with proper types and defaults
    const preparedData = {
      // Basic Details
      category: productData.category,
      subCategory: productData.subCategory || "",
      brand: productData.brand || "",
      shortDescription: productData.comboDescription || productData.shortDescription || "",

      // Variants
      enableVariants: Boolean(productData.enableVariants),
      variants: processedVariants,

      // Pricing & Tax
      hsnCode: productData.hsnCode || "",
      gstPercentage: parseFloat(productData.gstPercentage) || 0,
      defaultMRP: parseFloat(productData.defaultMRP) || 0,
      defaultSellingPrice: parseFloat(productData.defaultSellingPrice) || 0,
      defaultPurchasePrice: parseFloat(productData.defaultPurchasePrice) || 0,
      discountType: productData.discountType || "Percent",
      defaultDiscountValue: parseFloat(productData.defaultDiscountValue) || 0,
      isCODAvailable: Boolean(productData.isCODAvailable ?? true),
      shippingCharge: parseFloat(productData.shippingCharge) || 0,
      freeShipping: Boolean(productData.freeShipping ?? false),

      // Visibility & SEO
      productStatus: productData.productStatus || "draft",
      showOnHomepage: Boolean(productData.showOnHomepage ?? false),
      showInProductsPage: Boolean(productData.showInProductsPage ?? true),
      metaTitle: productData.metaTitle || null,
      metaDescription: productData.metaDescription || null,
      metaKeywords: productData.metaKeywords || null,

      // Compliance
      expiryDate: productData.expiryDate ? new Date(productData.expiryDate) : null,
      mfgDate: productData.mfgDate ? new Date(productData.mfgDate) : null,
      batchNo: productData.batchNo || null,
      safetyInformation: productData.safetyInformation || null,

      // Additional Fields
      returnPolicyApplicable: Boolean(productData.returnPolicyApplicable ?? true),
      returnWindowDays: parseInt(productData.returnWindowDays) || 7,
      warrantyDetails: productData.warrantyDetails || null,
      countryOfOrigin: productData.countryOfOrigin || "India",

      // Cutting Styles
      cuttingStyles: Array.isArray(productData.cuttingStyles) ? productData.cuttingStyles : [],

      // Frequently Bought Together
      frequentlyBoughtTogether: Array.isArray(productData.frequentlyBoughtTogether) 
        ? productData.frequentlyBoughtTogether 
        : [],

      // 🆕 Combo Product Fields
      type: productData.type || "regular",
      comboItems: Array.isArray(productData.comboItems) ? productData.comboItems : [],
      thumbnail: thumbnailKey || (productData.thumbnail ? extractS3Key(productData.thumbnail) : null),
      isComboHomePageEnabled: Boolean(productData.isComboHomePageEnabled ?? false),
    };

    // Convert badge names to IDs
    if (productData.homepageBadge && productData.homepageBadge !== "none") {
      const homepageBadge = await prisma.badge.findFirst({
        where: {
          name: {
            equals: productData.homepageBadge,
            mode: "insensitive"
          }
        },
        select: { id: true }
      });
      if (homepageBadge) {
        preparedData.homepageBadgeId = homepageBadge.id;
      }
    }

    if (productData.productsPageBadge && productData.productsPageBadge !== "none") {
      const productsPageBadge = await prisma.badge.findFirst({
        where: {
          name: {
            equals: productData.productsPageBadge,
            mode: "insensitive"
          }
        },
        select: { id: true }
      });
      if (productsPageBadge) {
        preparedData.productsPageBadgeId = productsPageBadge.id;
      }
    }

    console.log("✅ Data prepared, creating product in database...");
    
    // Create product
    const product = await prisma.onlineProduct.create({
      data: preparedData,
    });

    console.log("✅ Product created successfully with ID:", product.id);

    // 🆕 Lock inventory item UOMs
    for (const itemId of inventoryItemsToLock) {
      await lockItemUOM(itemId);
    }
    console.log(`✅ Locked UOM for ${inventoryItemsToLock.size} inventory items`);

    // 🆕 Sync stock for all inventory items used in variants (convert to variant UOM)
    for (const itemId of inventoryItemsToLock) {
      try {
        await syncOnlineProductStock(itemId);
        console.log(`✅ Synced stock for inventory item: ${itemId}`);
      } catch (syncError) {
        console.error(`⚠️ Failed to sync stock for item ${itemId}:`, syncError.message);
      }
    }

    // Re-fetch product to get updated stock quantities
    const updatedProduct = await prisma.onlineProduct.findUnique({
      where: { id: product.id }
    });

    // 🆕 If it's a combo product, sync stock based on component availability
    let finalProduct = updatedProduct || product;
    if (finalProduct.type === 'combo' && finalProduct.comboItems && finalProduct.comboItems.length > 0) {
      try {
        console.log('🔄 Syncing combo product stock...');
        finalProduct = await syncComboProductStock(finalProduct);
        console.log('✅ Combo stock synced successfully');
      } catch (comboSyncError) {
        console.error('⚠️ Failed to sync combo stock:', comboSyncError.message);
      }
    }

    // Format response with proxy image URLs
    const productResponse = {
      ...finalProduct,
      variants: convertVariantImagesToUrls(finalProduct.variants),
      // 🆕 Convert thumbnail S3 key to proxy URL
      thumbnail: finalProduct.thumbnail ? getProxyImageUrl(finalProduct.thumbnail) : null,
    };

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: productResponse,
    });
  } catch (error) {
    console.error("❌ Error creating online product:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      code: error.code,
      meta: error.meta,
    });
    res.status(500).json({
      success: false,
      message: "Failed to create online product",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Update online product
 * PUT /api/online/online-products/:id
 */
const updateOnlineProduct = async (req, res) => {
  try {
    console.log("📝 Updating online product...");
    console.log("Product ID:", req.params.id);
    console.log("Files received:", req.files ? req.files.length : 0);
    
    const { id } = req.params;
    
    // Parse product data from FormData
    let updateData;
    if (req.body.productData) {
      updateData = typeof req.body.productData === 'string' 
        ? JSON.parse(req.body.productData) 
        : req.body.productData;
    } else {
      updateData = req.body;
    }

    // 🆕 Parse JSON strings if they were sent via FormData (common in multipart requests)
    if (typeof updateData.variants === 'string') {
      try {
        updateData.variants = JSON.parse(updateData.variants);
      } catch (e) {
        console.warn("⚠️ Failed to parse variants as JSON, keeping as is");
      }
    }
    
    if (typeof updateData.frequentlyBoughtTogether === 'string') {
      try {
        updateData.frequentlyBoughtTogether = JSON.parse(updateData.frequentlyBoughtTogether);
      } catch (e) {
        console.warn("⚠️ Failed to parse frequentlyBoughtTogether as JSON, keeping as is");
      }
    }

    if (typeof updateData.cuttingStyles === 'string') {
      try {
        updateData.cuttingStyles = JSON.parse(updateData.cuttingStyles);
      } catch (e) {
        console.warn("⚠️ Failed to parse cuttingStyles as JSON, keeping as is");
      }
    }

    // 🆕 Parse comboItems JSON string (sent via FormData for combo products)
    if (typeof updateData.comboItems === 'string') {
      try {
        updateData.comboItems = JSON.parse(updateData.comboItems);
      } catch (e) {
        console.warn("⚠️ Failed to parse comboItems as JSON, keeping as is");
      }
    }

    // 🔒 CRITICAL: Check for duplicate SKUs within variants
    // 🆕 EXCEPTION: Allow duplicate SKUs if they're from the same inventory item
    if (updateData.variants && Array.isArray(updateData.variants)) {
      const skuSet = new Map(); // Map SKU to inventoryProductId
      const duplicateSKUs = [];
      
      updateData.variants.forEach((variant, index) => {
        const sku = variant.variantSKU;
        const inventoryProductId = variant.inventoryProductId;
        
        if (sku && sku.trim() !== "") {
          if (skuSet.has(sku)) {
            // Check if it's the same inventory item
            const existingInventoryId = skuSet.get(sku);
            if (existingInventoryId !== inventoryProductId) {
              // Different inventory items with same SKU - NOT ALLOWED
              duplicateSKUs.push({ sku, variantIndex: index + 1 });
            }
            // Same inventory item with same SKU - ALLOWED (multiple variants of same item)
          } else {
            skuSet.set(sku, inventoryProductId);
          }
        }
      });

      if (duplicateSKUs.length > 0) {
        console.log("❌ Validation failed: Duplicate SKUs detected:", duplicateSKUs);
        return res.status(400).json({
          success: false,
          message: "Duplicate SKUs detected in variants",
          details: `The following SKUs are used multiple times: ${duplicateSKUs.map(d => `${d.sku} (Variant ${d.variantIndex})`).join(", ")}. Each variant must have a unique SKU unless they're from the same inventory item.`,
          duplicates: duplicateSKUs,
        });
      }

      // 🔒 SECURITY: Verify stock quantities don't exceed inventory limits
      for (const variant of updateData.variants) {
        if (variant.variantStockQuantity && variant.variantStockQuantity > 1000000) {
          console.log("❌ Validation failed: Unrealistic stock quantity");
          return res.status(400).json({
            success: false,
            message: "Stock quantity exceeds maximum allowed limit (1,000,000 units)",
          });
        }
      }
    }

    console.log("✅ Validation passed, uploading new images to S3...");

    // Upload new images to S3 if any
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} new images to S3...`);
      const uploadedImageKeys = await Promise.all(
        req.files.map((file) => uploadToS3(file.buffer, file.originalname, file.mimetype))
      );
      console.log("✅ New images uploaded to S3:", uploadedImageKeys);
      
      // Map uploaded images back to variants based on fieldname
      // OR handle thumbnail for combo products
      req.files.forEach((file, index) => {
        const key = uploadedImageKeys[index];
        
        // 🆕 Handle combo product thumbnail
        if (file.fieldname === 'thumbnail') {
          updateData.thumbnail = key;
          console.log(`📸 Combo thumbnail updated: ${key}`);
        }
        // Handle variant images
        else if (file.fieldname && file.fieldname.startsWith('variant_')) {
          const parts = file.fieldname.split('_');
          const variantIndex = parseInt(parts[1]);
          const imageIndex = parseInt(parts[3]);
          
          if (updateData.variants[variantIndex]) {
            if (!updateData.variants[variantIndex].variantImages) {
              updateData.variants[variantIndex].variantImages = [];
            }
            updateData.variants[variantIndex].variantImages[imageIndex] = key;
          }
        }
      });
    }

    // Map comboDescription -> shortDescription (Description)
    if (updateData.comboDescription) {
      updateData.shortDescription = updateData.comboDescription;
    }
    
    // Map itemName -> variant displayName (Name)
    // Only if variants array exists and has at least one item
    if (updateData.itemName && updateData.variants && updateData.variants.length > 0) {
      updateData.variants[0].displayName = updateData.itemName;
    }

    // Remove fields that shouldn't be updated
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.itemName; 
    delete updateData.comboDescription;
    delete updateData.productName; // 🆕 Added for safety
    
    // Remove non-existent schema fields
    delete updateData.totalStockQuantity;
    delete updateData.lowStockAlertLevel;
    delete updateData.stockStatus;

    // Process variants: clean images and calculate stock status
    if (updateData.variants && Array.isArray(updateData.variants)) {
      updateData.variants = processVariantImagesForStorage(updateData.variants).map((variant) => {
        const variantLowStockAlert = variant.variantLowStockAlert || 10;
        const variantStockQuantity = variant.variantStockQuantity || 0;
        
        // Calculate variant-level stock status
        let variantStockStatus;
        if (variantStockQuantity === 0) {
          variantStockStatus = "out-of-stock";
        } else if (variantStockQuantity <= variantLowStockAlert) {
          variantStockStatus = "low-stock";
        } else {
          variantStockStatus = "in-stock";
        }
        
        return {
          ...variant,
          variantLowStockAlert,
          variantStockStatus,
          // 🆕 Include UOM fields
          variantUom: variant.variantUom || null,
          variantUomValue: variant.variantUomValue || null,
        };
      });
    }

    // 🆕 Ensure combo product fields are correctly handled
    if (updateData.type) {
      updateData.type = updateData.type;
    }
    
    if (updateData.isComboHomePageEnabled !== undefined) {
      updateData.isComboHomePageEnabled = Boolean(updateData.isComboHomePageEnabled);
    }

    // Ensure comboItems is a proper array
    if (updateData.comboItems !== undefined) {
      updateData.comboItems = Array.isArray(updateData.comboItems) ? updateData.comboItems : [];
    }

    // 🆕 Enrich comboItems with inventoryProductId for better performance
    if (Array.isArray(updateData.comboItems) && updateData.comboItems.length > 0) {
      console.log("🔍 Enriching combo items with inventoryProductId and category...");
      
      for (const comboItem of updateData.comboItems) {
        if (!comboItem.inventoryProductId && comboItem.productId && comboItem.variantIndex !== undefined) {
          try {
            const componentProduct = await prisma.onlineProduct.findUnique({
              where: { id: comboItem.productId }
            });
            
            if (componentProduct && componentProduct.variants && componentProduct.variants[comboItem.variantIndex]) {
              comboItem.inventoryProductId = componentProduct.variants[comboItem.variantIndex].inventoryProductId;
              console.log(`✅ Enriched combo item with inventoryProductId: ${comboItem.inventoryProductId}`);
              
              // 🆕 Save category in comboItem for easy filtering
              if (componentProduct.category) {
                comboItem.category = componentProduct.category;
                console.log(`✅ Saved category "${componentProduct.category}" in combo item`);
              }
            } else {
              console.warn(`⚠️ Could not find variant for combo item: ${comboItem.productName}`);
            }
          } catch (error) {
            console.error(`❌ Error enriching combo item:`, error);
          }
        } else if (comboItem.productId) {
          // If inventoryProductId already exists, still fetch and save category
          try {
            const componentProduct = await prisma.onlineProduct.findUnique({
              where: { id: comboItem.productId },
              select: { category: true }
            });
            if (componentProduct && componentProduct.category) {
              comboItem.category = componentProduct.category;
              console.log(`✅ Saved category "${componentProduct.category}" in combo item`);
            }
          } catch (error) {
            console.error(`❌ Error fetching component category:`, error);
          }
        }
      }
      
      // 🆕 Set combo product category to "Combo Category" (fixed)
      if (updateData.type === 'combo') {
        updateData.category = 'Combo Category';
        console.log(`✅ Set combo product category to "Combo Category"`);
      }
    }

    // Handle thumbnail from existing URL (convert to S3 key if it's a proxy URL)
    if (updateData.thumbnail && typeof updateData.thumbnail === 'string') {
      updateData.thumbnail = extractS3Key(updateData.thumbnail);
    }

    // Handle arrays - ensure they're arrays
    if (updateData.cuttingStyles !== undefined) {
      updateData.cuttingStyles = Array.isArray(updateData.cuttingStyles) ? updateData.cuttingStyles : [];
    }

    if (updateData.frequentlyBoughtTogether !== undefined) {
      updateData.frequentlyBoughtTogether = Array.isArray(updateData.frequentlyBoughtTogether) 
        ? updateData.frequentlyBoughtTogether 
        : [];
    }
    
    // Ensure countryOfOrigin has a default value if empty
    if (updateData.countryOfOrigin === "") {
      updateData.countryOfOrigin = "India";
    }

    if (updateData.gstPercentage !== undefined) {
      updateData.gstPercentage = updateData.gstPercentage === "" ? 0 : (parseFloat(updateData.gstPercentage) || 0);
    }

    // Convert badge names to IDs
    if (updateData.homepageBadge !== undefined) {
      if (updateData.homepageBadge && updateData.homepageBadge !== "none") {
        const homepageBadge = await prisma.badge.findFirst({
          where: {
            name: {
              equals: updateData.homepageBadge,
              mode: "insensitive"
            }
          },
          select: { id: true }
        });
        if (homepageBadge) {
          updateData.homepageBadgeId = homepageBadge.id;
        }
      } else {
        updateData.homepageBadgeId = null;
      }
      delete updateData.homepageBadge;
    }

    if (updateData.productsPageBadge !== undefined) {
      if (updateData.productsPageBadge && updateData.productsPageBadge !== "none") {
        const productsPageBadge = await prisma.badge.findFirst({
          where: {
            name: {
              equals: updateData.productsPageBadge,
              mode: "insensitive"
            }
          },
          select: { id: true }
        });
        if (productsPageBadge) {
          updateData.productsPageBadgeId = productsPageBadge.id;
        }
      } else {
        updateData.productsPageBadgeId = null;
      }
      delete updateData.productsPageBadge;
    }

    console.log("✅ Updating product in database...");

    const product = await prisma.onlineProduct.update({
      where: { id },
      data: updateData,
    });

    console.log("✅ Product updated successfully");

    // 🔄 Auto-sync stock if variant UOM changed
    // This ensures stock quantities are converted to the correct UOM
    const hasUOMChanges = updateData.variants?.some(v => 
      v.variantUom !== undefined || v.variantUomValue !== undefined
    );
    
    if (hasUOMChanges) {
      console.log("🔄 Variant UOM detected, syncing stock from inventory...");
      // Find all inventory product IDs used in variants
      const inventoryIds = product.variants
        .map(v => v.inventoryProductId)
        .filter(Boolean);
      
      // Sync each unique inventory item
      const uniqueIds = [...new Set(inventoryIds)];
      for (const inventoryId of uniqueIds) {
        try {
          await syncOnlineProductStock(inventoryId);
          console.log(`✅ Stock synced for inventory item: ${inventoryId}`);
        } catch (syncError) {
          console.error(`⚠️ Stock sync failed for ${inventoryId}:`, syncError.message);
          // Don't fail the update if sync fails
        }
      }
    }

    // 🆕 If it's a combo product, sync stock based on component availability
    let finalProduct = product;
    if (product.type === 'combo' && product.comboItems && product.comboItems.length > 0) {
      try {
        console.log('🔄 Syncing combo product stock...');
        finalProduct = await syncComboProductStock(product);
        console.log('✅ Combo stock synced successfully');
      } catch (comboSyncError) {
        console.error('⚠️ Failed to sync combo stock:', comboSyncError.message);
      }
    }

    // Format response with proxy image URLs
    const productResponse = {
      ...finalProduct,
      variants: convertVariantImagesToUrls(finalProduct.variants),
      // 🆕 Convert thumbnail S3 key to proxy URL
      thumbnail: finalProduct.thumbnail ? getProxyImageUrl(finalProduct.thumbnail) : null,
    };

    res.json({
      success: true,
      message: "Product updated successfully",
      data: productResponse,
    });
  } catch (error) {
    console.error("❌ Error updating online product:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      code: error.code,
      meta: error.meta,
    });
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update online product",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Delete online product
 * DELETE /api/online/online-products/:id
 */
const deleteOnlineProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // First, delete all cart items that reference this product
    const deletedCartItems = await prisma.cart.deleteMany({
      where: { productId: id },
    });

    if (deletedCartItems.count > 0) {
      console.log(`🛒 Removed ${deletedCartItems.count} cart items for deleted product ${id}`);
    }

    // 🆕 Handle combo products that use this product
    // Find all combo products that contain this product in their comboItems
    const comboProducts = await prisma.onlineProduct.findMany({
      where: { type: "combo" }
    });

    let combosUpdated = 0;
    let combosInactivated = 0;

    for (const combo of comboProducts) {
      if (!combo.comboItems || !Array.isArray(combo.comboItems)) continue;

      // Check if this combo uses the deleted product
      const usesDeletedProduct = combo.comboItems.some(item => item.productId === id);

      if (usesDeletedProduct) {
        // Remove the deleted product from comboItems
        const updatedComboItems = combo.comboItems.filter(item => item.productId !== id);

        // Check if combo still has at least 2 products
        const shouldInactivate = updatedComboItems.length < 2;

        await prisma.onlineProduct.update({
          where: { id: combo.id },
          data: {
            comboItems: updatedComboItems,
            productStatus: shouldInactivate ? "inactive" : combo.productStatus,
          }
        });

        combosUpdated++;
        if (shouldInactivate) {
          combosInactivated++;
          console.log(`⚠️ Combo product "${combo.shortDescription}" inactivated (less than 2 items remaining)`);
        } else {
          console.log(`✅ Removed deleted product from combo "${combo.shortDescription}" (${updatedComboItems.length} items remaining)`);
        }
      }
    }

    // Then delete the product
    await prisma.onlineProduct.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Product deleted successfully",
      cartItemsRemoved: deletedCartItems.count,
      combosUpdated,
      combosInactivated,
    });
  } catch (error) {
    console.error("Error deleting online product:", error);
    
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to delete online product",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get frequently bought together products for a specific product
 * GET /api/online/online-products/:id/frequently-bought-together
 */
const getFrequentlyBoughtTogether = async (req, res) => {
  try {
    const { id } = req.params;

    // Get the main product
    const product = await prisma.onlineProduct.findUnique({
      where: { id },
      select: {
        id: true,
        frequentlyBoughtTogether: true,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!product.frequentlyBoughtTogether || product.frequentlyBoughtTogether.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // Extract product IDs from frequently bought together
    const addonProductIds = product.frequentlyBoughtTogether.map(item => item.productId);

    // Fetch all add-on products
    const addonProducts = await prisma.onlineProduct.findMany({
      where: {
        id: { in: addonProductIds },
        productStatus: "active", // Only show active products
      },
    });

    // Map add-on products with their configuration
    const addonsWithDetails = await Promise.all(
      product.frequentlyBoughtTogether.map(async (addon) => {
        const addonProduct = addonProducts.find(p => p.id === addon.productId);
        
        if (!addonProduct) return null;

        // Get the specific variant
        const variant = addonProduct.variants[addon.variantIndex];
        
        if (!variant) return null;

        // Convert variant images to proxy URLs
        const variantWithUrls = convertVariantImagesToUrls([variant]);

        return {
          productId: addonProduct.id,
          variantIndex: addon.variantIndex,
          isDefaultSelected: addon.isDefaultSelected || false,
          product: {
            id: addonProduct.id,
            shortDescription: addonProduct.shortDescription,
            brand: addonProduct.brand,
            category: addonProduct.category,
            subCategory: addonProduct.subCategory,
          },
          variant: variantWithUrls[0],
        };
      })
    );

    // Filter out null values (products that don't exist or are inactive)
    const validAddons = addonsWithDetails.filter(Boolean);

    res.json({
      success: true,
      data: validAddons,
    });
  } catch (error) {
    console.error("Error fetching frequently bought together:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch frequently bought together products",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Manually sync stock for a product's inventory items
 * POST /api/online/online-products/:id/sync-stock
 */
const syncProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🔄 Manual stock sync requested for product: ${id}`);
    
    // Get the product
    const product = await prisma.onlineProduct.findUnique({
      where: { id }
    });
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    // Find all inventory product IDs used in variants
    const inventoryIds = product.variants
      .map(v => v.inventoryProductId)
      .filter(Boolean);
    
    if (inventoryIds.length === 0) {
      return res.json({
        success: true,
        message: 'No inventory items to sync (no variants linked to inventory)',
        synced: 0
      });
    }
    
    // Sync each unique inventory item
    const uniqueIds = [...new Set(inventoryIds)];
    const syncResults = [];
    
    for (const inventoryId of uniqueIds) {
      try {
        await syncOnlineProductStock(inventoryId);
        syncResults.push({ inventoryId, status: 'success' });
        console.log(`✅ Stock synced for inventory item: ${inventoryId}`);
      } catch (syncError) {
        syncResults.push({ 
          inventoryId, 
          status: 'failed', 
          error: syncError.message 
        });
        console.error(`⚠️ Stock sync failed for ${inventoryId}:`, syncError.message);
      }
    }
    
    const successCount = syncResults.filter(r => r.status === 'success').length;
    
    res.json({
      success: true,
      message: `Stock sync completed for ${successCount}/${uniqueIds.length} inventory items`,
      synced: successCount,
      total: uniqueIds.length,
      results: syncResults
    });
  } catch (error) {
    console.error('❌ Error syncing product stock:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync product stock',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Generate SEO content using GROQ API for a product
 * POST /api/online/online-products/generate-seo
 */
const generateProductSEO = async (req, res) => {
  try {
    const { productName, category, subCategory, shortDescription } = req.body;

    if (!productName) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    // Detect company name from existing categories/subcategories
    const detectCompanyName = async () => {
      try {
        // Try to find existing categories with SEO titles that contain company names
        const existingCategory = await prisma.category.findFirst({
          where: {
            metaTitle: {
              contains: "|",
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
        });

        if (existingCategory && existingCategory.metaTitle) {
          const titleParts = existingCategory.metaTitle.split("|");
          if (titleParts.length > 1) {
            const detectedName = titleParts[titleParts.length - 1].trim();
            if (detectedName && detectedName !== "Your Company" && detectedName !== "ECommerce") {
              return detectedName;
            }
          }
        }

        // Also check subcategories
        const existingSubcategory = await prisma.subcategory.findFirst({
          where: {
            metaTitle: {
              contains: "|",
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
        });

        if (existingSubcategory && existingSubcategory.metaTitle) {
          const titleParts = existingSubcategory.metaTitle.split("|");
          if (titleParts.length > 1) {
            const detectedName = titleParts[titleParts.length - 1].trim();
            if (detectedName && detectedName !== "Your Company" && detectedName !== "ECommerce") {
              return detectedName;
            }
          }
        }

        return "Your Store"; // Default fallback
      } catch (error) {
        console.error("Error detecting company name:", error);
        return "Your Store";
      }
    };

    // Get company name
    const companyName = await detectCompanyName();

    const prompt = `Generate high-quality, professional SEO content for an e-commerce product.
       
       Product Details:
       - Name: ${productName}
       - Category: ${category || "N/A"}
       - Sub-category: ${subCategory || "N/A"}
       - Description: ${shortDescription || "N/A"}
       
       Requirements:
       1. Meta title: Create an engaging, keyword-rich title (max 60 characters) that ends with " | ${companyName}"
       2. Meta description: Write a compelling description (140-160 characters) that includes benefits and key features
       3. Meta keywords: Provide 8-12 highly relevant tags (comma-separated)
       
       Format the response as JSON with keys: metaTitle, metaDescription, metaKeywords`;

    const modelsToTry = [
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile", 
      "mixtral-8x7b-32768",
    ];

    let seoContent = null;

    for (const model of modelsToTry) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: model,
          temperature: 0.7,
          max_tokens: 500,
        });

        const response = completion.choices[0]?.message?.content;
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          seoContent = JSON.parse(jsonMatch[0]);
          break;
        }
      } catch (error) {
        console.warn(`Model ${model} failed for product SEO:`, error.message);
        continue;
      }
    }

    if (!seoContent) {
      // Fallback if all models fail
      seoContent = {
        metaTitle: `${productName} - Premium ${category || ""} Products | ${companyName}`,
        metaDescription: `Buy ${productName} online at the best price. Quality ${category || ""} products with fast delivery. Shop now!`,
        metaKeywords: `${productName}, ${category || ""}, buy ${productName}, online shopping`,
      };
    }

    res.json({
      success: true,
      data: seoContent,
    });
  } catch (error) {
    console.error("Error generating product SEO:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate SEO content",
      error: error.message,
    });
  }
};

/**
 * Sync all combo products stock
 * Recalculates stock for all combo products based on component availability
 */
const syncAllComboStock = async (req, res) => {
  try {
    console.log('🔄 Manual sync all combo products stock triggered');
    
    const { syncAllComboProductsStock } = require('../../utils/inventory/stockUpdateService');
    const result = await syncAllComboProductsStock();
    
    res.status(200).json({
      success: true,
      message: 'All combo products stock synced successfully',
      data: result,
    });
  } catch (error) {
    console.error('❌ Error syncing all combo stock:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync combo products stock',
      error: error.message,
    });
  }
};

module.exports = {
  getAllOnlineProducts,
  getOnlineProductById,
  createOnlineProduct,
  updateOnlineProduct,
  deleteOnlineProduct,
  getFrequentlyBoughtTogether,
  syncProductStock,
  generateProductSEO,
  syncAllComboStock,
};
