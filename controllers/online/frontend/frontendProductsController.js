const { prisma } = require("../../../config/database");
const { getPresignedUrl } = require("../../../utils/online/uploadS3");
const { transliterateToTamil, fuzzyTamilMatch } = require("../../../utils/online/tamilTransliteration");

/**
 * Helper function to convert image keys to pre-signed URLs in variants
 */
const convertVariantImagesToUrls = async (variants) => {
  return Promise.all(
    variants.map(async (variant) => {
      if (variant.variantImages && Array.isArray(variant.variantImages)) {
        const imageUrls = variant.variantImages.map((img) => getPresignedUrl(img, 3600));
        return { ...variant, variantImages: imageUrls };
      }
      return variant;
    })
  );
};

/**
 * Check if any variant of a product falls within the price range
 */
const hasVariantInPriceRange = (product, minPrice, maxPrice) => {
  if (!product.variants || product.variants.length === 0) {
    // No variants, check default price
    const price = product.defaultSellingPrice;
    if (minPrice && price < minPrice) return false;
    if (maxPrice && price > maxPrice) return false;
    return true;
  }

  // Check if ANY variant falls within the price range
  return product.variants.some((variant) => {
    const price = variant.variantSellingPrice;
    if (minPrice && price < minPrice) return false;
    if (maxPrice && price > maxPrice) return false;
    return true;
  });
};

/**
 * Filter variants to only include those within price range
 */
const filterVariantsByPrice = (variants, minPrice, maxPrice) => {
  if (!minPrice && !maxPrice) return variants;
  
  return variants.filter((variant) => {
    const price = variant.variantSellingPrice;
    if (minPrice && price < minPrice) return false;
    if (maxPrice && price > maxPrice) return false;
    return true;
  });
};

/**
 * Get all products for frontend display
 * GET /api/online/frontend/products
 */
const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      subCategory,
      brand,
      minPrice,
      maxPrice,
      sortBy = "createdAt",
      sortOrder = "desc",
      badge,
      type,
      includeVariantPriceFilter = "true",
    } = req.query;

    console.log("[Frontend Products] Fetching products with filters:", {
      page,
      limit,
      search,
      category,
      subCategory,
      brand,
      minPrice,
      maxPrice,
      sortBy,
      sortOrder,
      badge,
      includeVariantPriceFilter,
    });

    // Convert badge name to badge ID if provided
    let badgeId = null;
    if (badge && badge !== "all") {
      const badgeRecord = await prisma.badge.findFirst({
        where: {
          name: {
            equals: badge,
            mode: "insensitive"
          }
        },
        select: { id: true }
      });
      if (badgeRecord) {
        badgeId = badgeRecord.id;
      }
    }

    // Build where clause - only show active products
    const where = {
      productStatus: "active",
      showInProductsPage: true,
    };

    // Build OR conditions array
    const orConditions = [];
    
    // Store search terms separately (not in where clause)
    let searchTerm = null;
    let searchWords = [];
    let tamilSearchVariations = [];

    // Search in multiple fields with fuzzy matching
    if (search && search.trim() !== "") {
      searchTerm = search.trim();
      
      // Transliterate to Tamil for better search results (get multiple variations)
      try {
        tamilSearchVariations = await transliterateToTamil(searchTerm);
        console.log(`[Frontend Products] Search transliteration: "${searchTerm}" -> [${tamilSearchVariations.join(', ')}]`);
      } catch (error) {
        console.error('[Frontend Products] Transliteration error:', error);
        tamilSearchVariations = [searchTerm];
      }
      
      // Split search term into words for better matching
      searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
      
      // Create OR conditions for each word
      const wordConditions = searchWords.flatMap(word => [
        { brand: { contains: word, mode: "insensitive" } },
        { shortDescription: { contains: word, mode: "insensitive" } },
        { category: { contains: word, mode: "insensitive" } },
        { subCategory: { contains: word, mode: "insensitive" } },
      ]);
      
      // Also search for the full search term (both English and Tamil variations)
      orConditions.push(
        { brand: { contains: searchTerm, mode: "insensitive" } },
        { shortDescription: { contains: searchTerm, mode: "insensitive" } },
        { category: { contains: searchTerm, mode: "insensitive" } },
        { subCategory: { contains: searchTerm, mode: "insensitive" } },
        ...wordConditions
      );
      
      // Add Tamil transliteration search conditions for each variation
      tamilSearchVariations.forEach(tamilVariation => {
        if (tamilVariation && tamilVariation !== searchTerm) {
          orConditions.push(
            { brand: { contains: tamilVariation, mode: "insensitive" } },
            { shortDescription: { contains: tamilVariation, mode: "insensitive" } },
            { category: { contains: tamilVariation, mode: "insensitive" } },
            { subCategory: { contains: tamilVariation, mode: "insensitive" } }
          );
        }
      });
      
      // Note: We'll also search variants in memory after fetching
      // So we don't add strict OR conditions that would exclude variant-only matches
    }

    // Filter by badge ID (check both productsPageBadgeId AND homepageBadgeId)
    // This allows products to show on products page even if only homepageBadgeId is set
    if (badgeId) {
      // If we already have OR conditions (from search), we need to combine them
      if (orConditions.length > 0) {
        // Wrap existing OR conditions with badge filter using AND
        where.AND = [
          { OR: orConditions },
          { OR: [
            { productsPageBadgeId: badgeId },
            { homepageBadgeId: badgeId },
          ]},
        ];
      } else {
        // No existing OR conditions, just add badge filter
        orConditions.push(
          { productsPageBadgeId: badgeId },
          { homepageBadgeId: badgeId }
        );
      }
    }

    // Apply OR conditions if any (and no AND was created)
    if (orConditions.length > 0 && !where.AND) {
      // If searching, make OR conditions optional so we can also find variant-only matches
      // We'll filter by variants in memory later
      if (searchTerm) {
        // Don't apply OR conditions - fetch all products and filter by variants in memory
        // This allows finding products by variant names, display names, dropdown options
      } else {
        where.OR = orConditions;
      }
    }

    // Filter by category and subcategory
    // For combo products: show if ANY comboItem has the filtered category
    // For regular products: filter by main category field
    if (category) {
      // Don't filter at DB level for category - we'll filter in memory to handle combo products
      // Store category for later filtering
    }
    
    if (subCategory) where.subCategory = subCategory;
    if (brand) where.brand = brand;

    // Filter by type (regular, combo)
    if (type) {
      where.type = type;
    }

    // Parse price values
    const parsedMinPrice = minPrice ? parseFloat(minPrice) : null;
    const parsedMaxPrice = maxPrice ? parseFloat(maxPrice) : null;

    // For variant-level price filtering, we need to fetch more products and filter in memory
    const useVariantPriceFilter = includeVariantPriceFilter === "true" && (parsedMinPrice || parsedMaxPrice);

    // If not using variant price filter, use default price filter at DB level
    if (!useVariantPriceFilter && (parsedMinPrice || parsedMaxPrice)) {
      where.defaultSellingPrice = {};
      if (parsedMinPrice) where.defaultSellingPrice.gte = parsedMinPrice;
      if (parsedMaxPrice) where.defaultSellingPrice.lte = parsedMaxPrice;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // If searching, fetch more products to account for variant filtering
    // If using variant price filter, fetch more products to account for filtering
    const isSearching = searchTerm && searchTerm.length > 0;
    const fetchLimit = (useVariantPriceFilter || isSearching) ? take * 3 : take;
    const fetchSkip = (useVariantPriceFilter || isSearching) ? 0 : skip;

    // Fetch products
    let products = await prisma.onlineProduct.findMany({
      where,
      skip: fetchSkip,
      take: useVariantPriceFilter ? undefined : fetchLimit,
      orderBy: { [sortBy]: sortOrder },
      select: {
        id: true,
        type: true, // ✅ Added for combo product detection
        thumbnail: true, // ✅ Added for combo product images
        category: true,
        subCategory: true,
        brand: true,
        shortDescription: true,
        enableVariants: true,
        variants: true,
        cuttingStyles: true,
        comboItems: true, // ✅ Added for combo product components
        hsnCode: true,
        gstPercentage: true,
        defaultMRP: true,
        defaultSellingPrice: true,
        defaultPurchasePrice: true,
        discountType: true,
        defaultDiscountValue: true,
        isCODAvailable: true,
        shippingCharge: true,
        freeShipping: true,
        showOnHomepage: true,
        homepageBadgeId: true, // ✅ Changed from homepageBadge
        showInProductsPage: true,
        productsPageBadgeId: true, // ✅ Changed from productsPageBadge
        returnPolicyApplicable: true,
        returnWindowDays: true,
        warrantyDetails: true,
        countryOfOrigin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Filter out products where ALL variants are inactive
    products = products.filter(product => {
      if (!product.variants || product.variants.length === 0) return true;
      // Check if at least one variant is active
      return product.variants.some(variant => variant.variantStatus === "active");
    });

    // ✅ Filter by search term in variant fields (variantName, displayName, dropdown options)
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      
      products = products.filter(product => {
        // Already matched in main fields (brand, description, category)
        const matchedInMainFields = 
          product.brand?.toLowerCase().includes(lowerSearchTerm) ||
          product.shortDescription?.toLowerCase().includes(lowerSearchTerm) ||
          product.category?.toLowerCase().includes(lowerSearchTerm) ||
          product.subCategory?.toLowerCase().includes(lowerSearchTerm);
        
        // Also check Tamil transliteration variations in main fields using fuzzy match
        const matchedInMainFieldsTamil = 
          fuzzyTamilMatch(product.brand, tamilSearchVariations) ||
          fuzzyTamilMatch(product.shortDescription, tamilSearchVariations) ||
          fuzzyTamilMatch(product.category, tamilSearchVariations) ||
          fuzzyTamilMatch(product.subCategory, tamilSearchVariations);
        
        if (matchedInMainFields || matchedInMainFieldsTamil) return true;
        
        // Check variants
        if (product.variants && product.variants.length > 0) {
          return product.variants.some(variant => {
            // Check variant name (English)
            if (variant.variantName?.toLowerCase().includes(lowerSearchTerm)) return true;
            if (variant.displayName?.toLowerCase().includes(lowerSearchTerm)) return true;
            
            // Check variant name (Tamil transliteration with fuzzy match)
            if (fuzzyTamilMatch(variant.variantName, tamilSearchVariations)) return true;
            if (fuzzyTamilMatch(variant.displayName, tamilSearchVariations)) return true;
            
            // Check dropdown options (e.g., "500g", "1kg", "Red", "Blue")
            if (variant.dropdownOptions && Array.isArray(variant.dropdownOptions)) {
              const optionsMatch = variant.dropdownOptions.some(option => {
                if (typeof option === 'string') {
                  return option.toLowerCase().includes(lowerSearchTerm) ||
                         fuzzyTamilMatch(option, tamilSearchVariations);
                }
                if (option && typeof option === 'object') {
                  return Object.values(option).some(val => {
                    const strVal = String(val);
                    return strVal.toLowerCase().includes(lowerSearchTerm) ||
                           fuzzyTamilMatch(strVal, tamilSearchVariations);
                  });
                }
                return false;
              });
              if (optionsMatch) return true;
            }
            
            // Check individual search words
            return searchWords.some(word => {
              const lowerWord = word.toLowerCase();
              return (
                variant.variantName?.toLowerCase().includes(lowerWord) ||
                variant.displayName?.toLowerCase().includes(lowerWord)
              );
            });
          });
        }
        
        return false;
      });
    }

    // ✅ Filter by category (handle combo products by checking comboItems)
    if (category) {
      products = products.filter(product => {
        // For regular products, check main category
        if (product.type !== 'combo') {
          return product.category === category;
        }
        
        // For combo products, check if ANY comboItem has the filtered category
        if (product.comboItems && product.comboItems.length > 0) {
          return product.comboItems.some(item => item.category === category);
        }
        
        // If no comboItems, don't show
        return false;
      });
    }

    let totalCount;

    // Apply variant-level price filtering if enabled
    if (useVariantPriceFilter) {
      products = products.filter((product) => 
        hasVariantInPriceRange(product, parsedMinPrice, parsedMaxPrice)
      );

      products = products.map((product) => ({
        ...product,
        variants: filterVariantsByPrice(product.variants, parsedMinPrice, parsedMaxPrice),
      }));

      totalCount = products.length;
      products = products.slice(skip, skip + take);
    } else {
      // If we filtered by category in memory, count filtered products
      if (category) {
        totalCount = products.length;
        products = products.slice(skip, skip + take);
      } else {
        totalCount = await prisma.onlineProduct.count({ where });
      }
    }

    console.log(`[Frontend Products] Found ${products.length} products out of ${totalCount} total`);

    // Get all unique badge IDs from products
    const badgeIds = [...new Set(products.flatMap(p => [p.homepageBadgeId, p.productsPageBadgeId]).filter(Boolean))];
    
    // Fetch badge names
    let badgesMap = {};
    if (badgeIds.length > 0) {
      const badges = await prisma.badge.findMany({
        where: { id: { in: badgeIds } },
        select: { id: true, name: true }
      });
      badgesMap = Object.fromEntries(badges.map(b => [b.id, b.name]));
    }

    // Get all unique cutting style IDs from products
    const allCuttingStyleIds = [...new Set(products.flatMap(p => p.cuttingStyles || []))];
    
    // Fetch cutting style details if any exist
    let cuttingStylesMap = {};
    if (allCuttingStyleIds.length > 0) {
      const cuttingStyles = await prisma.cuttingStyle.findMany({
        where: { 
          id: { in: allCuttingStyleIds },
          isActive: true 
        },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' }
      });
      cuttingStylesMap = Object.fromEntries(cuttingStyles.map(cs => [cs.id, cs]));
    }

    // Convert variant images to pre-signed URLs, populate cutting styles, and add badge names
    const productsWithUrls = await Promise.all(
      products.map(async (product) => ({
        ...product,
        variants: await convertVariantImagesToUrls(product.variants),
        thumbnail: product.thumbnail ? getPresignedUrl(product.thumbnail, 3600) : null, // ✅ Convert thumbnail to proxy URL
        cuttingStyles: (product.cuttingStyles || [])
          .map(id => cuttingStylesMap[id])
          .filter(Boolean),
        homepageBadge: product.homepageBadgeId ? badgesMap[product.homepageBadgeId] : null,
        productsPageBadge: product.productsPageBadgeId ? badgesMap[product.productsPageBadgeId] : null,
      }))
    );

    const totalPages = Math.ceil(totalCount / take);

    res.json({
      success: true,
      data: productsWithUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("[Frontend Products] Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get single product by ID for frontend
 * GET /api/online/frontend/products/:id
 */
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[Frontend Products] Fetching product with ID: ${id}`);

    const product = await prisma.onlineProduct.findUnique({
      where: { id },
      select: {
        id: true,
        type: true, // ✅ Added for combo product detection
        thumbnail: true, // ✅ Added for combo product images
        category: true,
        subCategory: true,
        brand: true,
        shortDescription: true,
        enableVariants: true,
        variants: true,
        cuttingStyles: true,
        comboItems: true, // ✅ Added for combo product components
        hsnCode: true,
        gstPercentage: true,
        defaultMRP: true,
        defaultSellingPrice: true,
        defaultPurchasePrice: true,
        discountType: true,
        defaultDiscountValue: true,
        isCODAvailable: true,
        shippingCharge: true,
        freeShipping: true,
        productStatus: true,
        showOnHomepage: true,
        homepageBadgeId: true, // ✅ Changed from homepageBadge
        showInProductsPage: true,
        productsPageBadgeId: true, // ✅ Changed from productsPageBadge
        metaTitle: true,
        metaDescription: true,
        metaKeywords: true,
        expiryDate: true,
        mfgDate: true,
        batchNo: true,
        safetyInformation: true,
        returnPolicyApplicable: true,
        returnWindowDays: true,
        warrantyDetails: true,
        countryOfOrigin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!product) {
      console.log(`[Frontend Products] Product not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Only show active products to frontend users
    if (product.productStatus !== "active") {
      console.log(`[Frontend Products] Product is not active: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Product not available",
      });
    }

    // Check if product has at least one active variant
    if (product.variants && product.variants.length > 0) {
      const hasActiveVariant = product.variants.some(variant => variant.variantStatus === "active");
      if (!hasActiveVariant) {
        console.log(`[Frontend Products] All variants are inactive: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Product not available",
        });
      }
    }

    // Fetch cutting style details if any exist
    let cuttingStylesData = [];
    if (product.cuttingStyles && product.cuttingStyles.length > 0) {
      const cuttingStyles = await prisma.cuttingStyle.findMany({
        where: { 
          id: { in: product.cuttingStyles },
          isActive: true 
        },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' }
      });
      cuttingStylesData = cuttingStyles;
    }

    // Fetch badge names if IDs exist
    let homepageBadgeName = null;
    let productsPageBadgeName = null;
    
    if (product.homepageBadgeId || product.productsPageBadgeId) {
      const badgeIds = [product.homepageBadgeId, product.productsPageBadgeId].filter(Boolean);
      const badges = await prisma.badge.findMany({
        where: { id: { in: badgeIds } },
        select: { id: true, name: true }
      });
      const badgesMap = Object.fromEntries(badges.map(b => [b.id, b.name]));
      
      homepageBadgeName = product.homepageBadgeId ? badgesMap[product.homepageBadgeId] : null;
      productsPageBadgeName = product.productsPageBadgeId ? badgesMap[product.productsPageBadgeId] : null;
    }

    // Convert variant images to pre-signed URLs
    const productWithUrls = {
      ...product,
      variants: await convertVariantImagesToUrls(product.variants),
      thumbnail: product.thumbnail ? getPresignedUrl(product.thumbnail, 3600) : null, // ✅ Convert thumbnail to proxy URL
      cuttingStyles: cuttingStylesData,
      homepageBadge: homepageBadgeName,
      productsPageBadge: productsPageBadgeName,
    };

    console.log(`[Frontend Products] Product fetched successfully: ${id}`);

    res.json({
      success: true,
      data: productWithUrls,
    });
  } catch (error) {
    console.error("[Frontend Products] Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get homepage products filtered by badge
 * GET /api/online/frontend/homepage-products
 */
const getHomepageProducts = async (req, res) => {
  try {
    const {
      badge, // This can be badge name or badge ID
      category,
      limit = 10,
    } = req.query;

    console.log("[Frontend Products] Fetching homepage products:", {
      badge,
      category,
      limit,
    });

    // Build where clause - only show active products marked for homepage
    const where = {
      productStatus: "active",
      showOnHomepage: true,
    };

    // Filter by homepage badge (support both ID and name for backward compatibility)
    if (badge && badge !== "all") {
      // First, try to find badge by name to get its ID
      const badgeRecord = await prisma.badge.findFirst({
        where: {
          name: {
            equals: badge,
            mode: "insensitive"
          }
        },
        select: { id: true }
      });

      if (badgeRecord) {
        where.homepageBadgeId = badgeRecord.id;
      } else {
        // If not found by name, try as ID directly
        where.homepageBadgeId = badge;
      }
    }

    // Filter by category
    if (category && category !== "") {
      where.category = category;
    }

    // Fetch products
    let products = await prisma.onlineProduct.findMany({
      where,
      take: parseInt(limit),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        thumbnail: true,
        category: true,
        subCategory: true,
        brand: true,
        shortDescription: true,
        enableVariants: true,
        variants: true,
        cuttingStyles: true,
        comboItems: true,
        hsnCode: true,
        gstPercentage: true,
        defaultMRP: true,
        defaultSellingPrice: true,
        defaultPurchasePrice: true,
        discountType: true,
        defaultDiscountValue: true,
        isCODAvailable: true,
        shippingCharge: true,
        freeShipping: true,
        showOnHomepage: true,
        homepageBadgeId: true,
        showInProductsPage: true,
        productsPageBadgeId: true,
        returnPolicyApplicable: true,
        returnWindowDays: true,
        warrantyDetails: true,
        countryOfOrigin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Filter out products where ALL variants are inactive
    products = products.filter(product => {
      if (!product.variants || product.variants.length === 0) return true;
      // Check if at least one variant is active
      return product.variants.some(variant => variant.variantStatus === "active");
    });

    console.log(`[Frontend Products] Found ${products.length} homepage products for badge: ${badge || 'all'}, category: ${category || 'all'}`);

    // Get all unique badge IDs from products
    const badgeIds = [...new Set(products.map(p => p.homepageBadgeId).filter(Boolean))];
    
    // Fetch badge details
    let badgesMap = {};
    if (badgeIds.length > 0) {
      const badges = await prisma.badge.findMany({
        where: { id: { in: badgeIds } },
        select: { id: true, name: true }
      });
      badgesMap = Object.fromEntries(badges.map(b => [b.id, b.name]));
    }

    // Get all unique cutting style IDs from products
    const allCuttingStyleIds = [...new Set(products.flatMap(p => p.cuttingStyles || []))];
    
    // Fetch cutting style details if any exist
    let cuttingStylesMap = {};
    if (allCuttingStyleIds.length > 0) {
      const cuttingStyles = await prisma.cuttingStyle.findMany({
        where: { 
          id: { in: allCuttingStyleIds},
          isActive: true 
        },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' }
      });
      cuttingStylesMap = Object.fromEntries(cuttingStyles.map(cs => [cs.id, cs]));
    }

    // Convert variant images to pre-signed URLs and populate cutting styles and badge names
    const productsWithUrls = await Promise.all(
      products.map(async (product) => ({
        ...product,
        variants: await convertVariantImagesToUrls(product.variants),
        thumbnail: product.thumbnail ? getPresignedUrl(product.thumbnail, 3600) : null,
        cuttingStyles: (product.cuttingStyles || [])
          .map(id => cuttingStylesMap[id])
          .filter(Boolean),
        homepageBadge: product.homepageBadgeId ? badgesMap[product.homepageBadgeId] : null,
        productsPageBadge: product.productsPageBadgeId ? badgesMap[product.productsPageBadgeId] : null,
      }))
    );

    res.json({
      success: true,
      data: productsWithUrls,
      count: productsWithUrls.length,
    });
  } catch (error) {
    console.error("[Frontend Products] Error fetching homepage products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch homepage products",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

/**
 * Get frequently bought together products for frontend
 * GET /api/online/frontend/products/:id/frequently-bought-together
 */
const getFrequentlyBoughtTogether = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[Frontend Products] Fetching frequently bought together for product: ${id}`);

    // Get the main product
    const product = await prisma.onlineProduct.findUnique({
      where: { id },
      select: {
        id: true,
        productStatus: true,
        frequentlyBoughtTogether: true,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Only show for active products
    if (product.productStatus !== "active") {
      return res.status(404).json({
        success: false,
        message: "Product not available",
      });
    }

    if (!product.frequentlyBoughtTogether || product.frequentlyBoughtTogether.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // Extract product IDs
    const addonProductIds = product.frequentlyBoughtTogether.map(item => item.productId);

    // Fetch all add-on products (only active ones)
    const addonProducts = await prisma.onlineProduct.findMany({
      where: {
        id: { in: addonProductIds },
        productStatus: "active",
      },
      select: {
        id: true,
        category: true,
        subCategory: true,
        brand: true,
        shortDescription: true,
        variants: true,
        defaultMRP: true,
        defaultSellingPrice: true,
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

        // Check stock availability
        if (variant.variantStockQuantity <= 0) return null;

        // Convert variant images to presigned URLs
        const variantWithUrls = await convertVariantImagesToUrls([variant]);

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

    // Filter out null values
    const validAddons = addonsWithDetails.filter(Boolean);

    console.log(`[Frontend Products] Found ${validAddons.length} valid add-ons`);

    res.json({
      success: true,
      data: validAddons,
    });
  } catch (error) {
    console.error("[Frontend Products] Error fetching frequently bought together:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch frequently bought together products",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};


/**
 * Get combo products for homepage - NEW FUNCTION
 * GET /api/online/frontend/combo-homepage
 */
const getComboHomepageProducts = async (req, res) => {
  try {
    const { limit = 6 } = req.query;

    console.log("[Frontend Products] Fetching combo homepage products, limit:", limit);

    // Fetch active combo products enabled for homepage
    const comboProducts = await prisma.onlineProduct.findMany({
      where: {
        productStatus: "active",
        type: "combo",
        isComboHomePageEnabled: true,
      },
      take: parseInt(limit),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        category: true,
        subCategory: true,
        brand: true,
        shortDescription: true,
        variants: true,
        defaultMRP: true,
        defaultSellingPrice: true,
        defaultDiscountValue: true,
        discountType: true,
        thumbnail: true, // Fetch thumbnail
        type: true,
        cuttingStyles: true,
        isCODAvailable: true,
        shippingCharge: true,
        freeShipping: true,
      },
    });

    console.log(`[Frontend Products] Found ${comboProducts.length} combo products`);
    
    // Get all unique cutting style IDs from products
    const allCuttingStyleIds = [...new Set(comboProducts.flatMap(p => p.cuttingStyles || []))];
    
    // Fetch cutting style details if any exist
    let cuttingStylesMap = {};
    if (allCuttingStyleIds.length > 0) {
      const cuttingStyles = await prisma.cuttingStyle.findMany({
        where: { 
          id: { in: allCuttingStyleIds },
          isActive: true 
        },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' }
      });
      cuttingStylesMap = Object.fromEntries(cuttingStyles.map(cs => [cs.id, cs]));
    }

    // Process images and prepare response
    const productsWithUrls = await Promise.all(
      comboProducts.map(async (product) => {
        // Convert variant images (if any)
        const variantsWithUrls = await convertVariantImagesToUrls(product.variants);

        // Handle thumbnail: if variants have no images, use thumbnail as variant image
        if (product.thumbnail) {
          const thumbnailUrl = getPresignedUrl(product.thumbnail, 3600);
          
          if (variantsWithUrls.length > 0) {
            // Ensure variantImages array exists
            if (!variantsWithUrls[0].variantImages) {
               variantsWithUrls[0].variantImages = [];
            }
            // If empty, add thumbnail
            if (variantsWithUrls[0].variantImages.length === 0) {
              variantsWithUrls[0].variantImages.push(thumbnailUrl);
            }
          }
        }

        return {
          ...product,
          variants: variantsWithUrls,
          cuttingStyles: (product.cuttingStyles || [])
            .map(id => cuttingStylesMap[id])
            .filter(Boolean)
        };
      })
    );

    res.json({
      success: true,
      data: productsWithUrls,
    });
  } catch (error) {
    console.error("[Frontend Products] Error fetching combo homepage products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch combo homepage products",
      error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
  getHomepageProducts,
  getFrequentlyBoughtTogether,
  getComboHomepageProducts,
};
