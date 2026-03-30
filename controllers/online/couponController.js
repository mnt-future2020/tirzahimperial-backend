const { prisma } = require('../../config/database');

// Create a new coupon
exports.createCoupon = async (req, res) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      usageType,
      maxUsageCount,
      maxUsagePerUser,
      validFrom,
      validUntil,
      minOrderValue,
      maxDiscountAmount,
      applicableCategories,
      isActive
    } = req.body;

    // Validate required fields
    if (!code || !discountType || !discountValue || !validFrom || !validUntil) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: code, discountType, discountValue, validFrom, validUntil"
      });
    }

    // Validate discount type
    if (!["percentage", "flat"].includes(discountType)) {
      return res.status(400).json({
        success: false,
        message: "discountType must be 'percentage' or 'flat'"
      });
    }

    // Validate usage type
    if (usageType && !["single-use", "multi-use", "first-time-user-only"].includes(usageType)) {
      return res.status(400).json({
        success: false,
        message: "usageType must be 'single-use', 'multi-use', or 'first-time-user-only'"
      });
    }

    // Check if coupon code already exists
    const existingCoupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() }
    });

    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: "Coupon code already exists"
      });
    }

    // Create coupon
    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase(),
        description,
        discountType,
        discountValue: parseFloat(discountValue),
        usageType: usageType || "multi-use",
        maxUsageCount: maxUsageCount ? parseInt(maxUsageCount) : null,
        maxUsagePerUser: maxUsagePerUser ? parseInt(maxUsagePerUser) : null,
        validFrom: new Date(validFrom),
        validUntil: new Date(validUntil),
        minOrderValue: minOrderValue ? parseFloat(minOrderValue) : null,
        maxDiscountAmount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : null,
        applicableCategories: applicableCategories || [],
        isActive: isActive !== undefined ? isActive : true
      }
    });

    res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      data: coupon
    });
  } catch (error) {
    console.error("Error creating coupon:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create coupon",
      error: error.message
    });
  }
};

// Get all coupons
exports.getAllCoupons = async (req, res) => {
  try {
    const { isActive, search } = req.query;

    const where = { isAffiliateCoupon: { not: true } };
    
    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } }
      ];
    }

    const coupons = await prisma.coupon.findMany({
      where,
      orderBy: { createdAt: "desc" }
    });

    res.status(200).json({
      success: true,
      data: coupons,
      count: coupons.length
    });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch coupons",
      error: error.message
    });
  }
};

// Get coupon by ID
exports.getCouponById = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await prisma.coupon.findUnique({
      where: { id }
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found"
      });
    }

    res.status(200).json({
      success: true,
      data: coupon
    });
  } catch (error) {
    console.error("Error fetching coupon:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch coupon",
      error: error.message
    });
  }
};

// Update coupon
exports.updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Convert code to uppercase if provided
    if (updateData.code) {
      updateData.code = updateData.code.toUpperCase();
    }

    // Convert date strings to Date objects
    if (updateData.validFrom) {
      updateData.validFrom = new Date(updateData.validFrom);
    }
    if (updateData.validUntil) {
      updateData.validUntil = new Date(updateData.validUntil);
    }

    // Convert numeric fields
    if (updateData.discountValue) {
      updateData.discountValue = parseFloat(updateData.discountValue);
    }
    if (updateData.maxUsageCount) {
      updateData.maxUsageCount = parseInt(updateData.maxUsageCount);
    }
    if (updateData.maxUsagePerUser) {
      updateData.maxUsagePerUser = parseInt(updateData.maxUsagePerUser);
    }
    if (updateData.minOrderValue) {
      updateData.minOrderValue = parseFloat(updateData.minOrderValue);
    }
    if (updateData.maxDiscountAmount) {
      updateData.maxDiscountAmount = parseFloat(updateData.maxDiscountAmount);
    }

    const coupon = await prisma.coupon.update({
      where: { id },
      data: updateData
    });

    res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      data: coupon
    });
  } catch (error) {
    console.error("Error updating coupon:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update coupon",
      error: error.message
    });
  }
};

// Delete coupon
exports.deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.coupon.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: "Coupon deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete coupon",
      error: error.message
    });
  }
};

// Validate and apply coupon
exports.validateCoupon = async (req, res) => {
  try {
    const { code, userId, orderValue, categories } = req.body;

    // Log the request for debugging
    console.log('📋 Coupon validation request:', {
      code,
      userId,
      orderValue,
      categories,
      body: req.body
    });

    if (!code || !userId || !orderValue) {
      console.log('❌ Missing required fields:', { code: !!code, userId: !!userId, orderValue: !!orderValue });
      return res.status(400).json({
        success: false,
        message: "Missing required fields: code, userId, orderValue"
      });
    }

    // Find coupon
    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() }
    });

    console.log('🔍 Coupon lookup result:', coupon ? `Found: ${coupon.code}` : 'Not found');

    if (!coupon) {
      console.log('❌ Coupon not found in database');
      return res.status(404).json({
        success: false,
        message: "Invalid coupon code"
      });
    }

    if (coupon.isAffiliateCoupon) {
      const companySettings = await prisma.companySettings.findFirst();
      if (companySettings && companySettings.affiliateEnabled === false) {
        return res.status(400).json({
          success: false,
          message: "Affiliate program is disabled"
        });
      }
      const { getAffiliateCodeStatus } = require("../../utils/affiliate/affiliateResolver");
      const status = await getAffiliateCodeStatus(coupon.code);
      if (status.status === "inactive") {
        return res.status(400).json({ success: false, message: "Affiliate code disabled" });
      }
    }

    if (!coupon.isActive) {
      console.log('❌ Coupon is not active');
      return res.status(400).json({
        success: false,
        message: coupon.isAffiliateCoupon ? "Affiliate code expired" : "This coupon is no longer active"
      });
    }
    

    // Check validity dates
    const now = new Date();
    if (now < coupon.validFrom) {
      console.log('❌ Coupon not yet valid. Valid from:', coupon.validFrom);
      return res.status(400).json({
        success: false,
        message: "This coupon is not yet valid"
      });
    }
    if (now > coupon.validUntil) {
      console.log('❌ Coupon expired. Valid until:', coupon.validUntil);
      return res.status(400).json({
        success: false,
        message: coupon.isAffiliateCoupon ? "Affiliate code expired" : "This coupon has expired"
      });
    }

    // Check max usage count
    if (coupon.maxUsageCount && coupon.currentUsageCount >= coupon.maxUsageCount) {
      console.log('❌ Max usage count reached:', coupon.currentUsageCount, '/', coupon.maxUsageCount);
      return res.status(400).json({
        success: false,
        message: coupon.isAffiliateCoupon ? "Affiliate code usage limit reached" : "This coupon has reached its maximum usage limit"
      });
    }

    // Check user-specific usage
    if (coupon.maxUsagePerUser) {
      const userUsageCount = await prisma.couponUsage.count({
        where: {
          couponId: coupon.id,
          userId
        }
      });

      console.log('👤 User usage check:', userUsageCount, '/', coupon.maxUsagePerUser);

      if (userUsageCount >= coupon.maxUsagePerUser) {
        console.log('❌ User exceeded max usage per user');
        return res.status(400).json({
          success: false,
          message: "You have already used this coupon the maximum number of times"
        });
      }
    }

    // Check first-time user only
    if (coupon.usageType === "first-time-user-only") {
      const userOrderCount = await prisma.onlineOrder.count({
        where: { userId }
      });

      console.log('🆕 First-time user check. Order count:', userOrderCount);

      if (userOrderCount > 0) {
        console.log('❌ Not a first-time user');
        return res.status(400).json({
          success: false,
          message: "This coupon is only valid for first-time users"
        });
      }
    }

    // Check minimum order value
    if (coupon.minOrderValue && orderValue < coupon.minOrderValue) {
      console.log('❌ Order value too low:', orderValue, '< minimum:', coupon.minOrderValue);
      return res.status(400).json({
        success: false,
        message: `Minimum order value of ${coupon.minOrderValue} required to use this coupon`
      });
    }

    // Check applicable categories
    if (coupon.applicableCategories.length > 0 && categories) {
      let validationCategories = categories;

      // If categories are missing or empty, fetch from cart
      if (!validationCategories || validationCategories.length === 0) {
        console.log('⚠️ Categories missing in request, fetching from cart for user:', userId);
        
        // Find customer first (userId in request is auth user id)
        const customer = await prisma.customer.findUnique({
          where: { userId }
        });

        if (customer) {
          const cartItems = await prisma.cart.findMany({
            where: { customerId: customer.id }
          });
          
          if (cartItems.length > 0) {
            validationCategories = [...new Set(cartItems.map(item => item.categoryId))];
            console.log('✅ Fetched categories from cart:', validationCategories);
          }
        }
      }

      const hasApplicableCategory = validationCategories?.some(cat => 
        coupon.applicableCategories.includes(cat)
      );

      console.log('📂 Category check:', { 
        couponCategories: coupon.applicableCategories, 
        orderCategories: validationCategories || [],
        hasMatch: hasApplicableCategory 
      });

      if (!hasApplicableCategory) {
        console.log('❌ No matching categories');
        return res.status(400).json({
          success: false,
          message: "This coupon is not applicable to the selected products"
        });
      }
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === "percentage") {
      discountAmount = (orderValue * coupon.discountValue) / 100;
      
      // Apply max discount cap if set
      if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
        discountAmount = coupon.maxDiscountAmount;
      }
    } else {
      discountAmount = coupon.discountValue;
    }

    // Ensure discount doesn't exceed order value
    if (discountAmount > orderValue) {
      discountAmount = orderValue;
    }

    res.status(200).json({
      success: true,
      message: "Coupon is valid",
      data: {
        couponId: coupon.id,
        code: coupon.code,
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        finalAmount: parseFloat((orderValue - discountAmount).toFixed(2))
      }
    });
  } catch (error) {
    console.error("Error validating coupon:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate coupon",
      error: error.message
    });
  }
};

// Apply coupon (record usage)
exports.applyCoupon = async (req, res) => {
  try {
    const { couponId, userId, orderId, discountAmount, orderValue } = req.body;

    if (!couponId || !userId || !discountAmount || !orderValue) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Get coupon
    const coupon = await prisma.coupon.findUnique({
      where: { id: couponId }
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found"
      });
    }

    // Record usage
    const usage = await prisma.couponUsage.create({
      data: {
        couponId,
        couponCode: coupon.code,
        userId,
        orderId,
        discountAmount: parseFloat(discountAmount),
        orderValue: parseFloat(orderValue)
      }
    });

    // Update coupon usage count
    await prisma.coupon.update({
      where: { id: couponId },
      data: {
        currentUsageCount: { increment: 1 }
      }
    });

    res.status(200).json({
      success: true,
      message: "Coupon applied successfully",
      data: usage
    });
  } catch (error) {
    console.error("Error applying coupon:", error);
    res.status(500).json({
      success: false,
      message: "Failed to apply coupon",
      error: error.message
    });
  }
};

// Get coupon usage statistics
exports.getCouponStats = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await prisma.coupon.findUnique({
      where: { id }
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found"
      });
    }

    const usageRecords = await prisma.couponUsage.findMany({
      where: { couponId: id },
      orderBy: { usedAt: "desc" }
    });

    const totalDiscount = usageRecords.reduce((sum, record) => sum + record.discountAmount, 0);
    const totalOrderValue = usageRecords.reduce((sum, record) => sum + record.orderValue, 0);

    res.status(200).json({
      success: true,
      data: {
        coupon,
        stats: {
          totalUsage: usageRecords.length,
          totalDiscount: parseFloat(totalDiscount.toFixed(2)),
          totalOrderValue: parseFloat(totalOrderValue.toFixed(2)),
          averageDiscount: usageRecords.length > 0 ? parseFloat((totalDiscount / usageRecords.length).toFixed(2)) : 0
        },
        recentUsage: usageRecords.slice(0, 10)
      }
    });
  } catch (error) {
    console.error("Error fetching coupon stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch coupon statistics",
      error: error.message
    });
  }
};

// Get available coupons for user
exports.getAvailableCoupons = async (req, res) => {
  try {
    const { userId, orderValue } = req.query;

    if (!userId || !orderValue) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, orderValue"
      });
    }

    const orderVal = parseFloat(orderValue);

    // Check if user is first-time user
    const userOrderCount = await prisma.onlineOrder.count({
      where: { userId }
    });

    const isFirstTimeUser = userOrderCount === 0;

    // Get all active coupons
    const now = new Date();
    const allCoupons = await prisma.coupon.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        validUntil: { gte: now },
        isAffiliateCoupon: false,
        NOT: { code: { startsWith: "AFF" } }
      },
      orderBy: { createdAt: "desc" }
    });

    // Filter coupons based on user eligibility
    const availableCoupons = [];

    for (const coupon of allCoupons) {
      // Check if coupon has reached max usage
      if (coupon.maxUsageCount && coupon.currentUsageCount >= coupon.maxUsageCount) {
        continue;
      }

      // Check first-time user only coupons
      if (coupon.usageType === "first-time-user-only" && !isFirstTimeUser) {
        continue;
      }

      // Check user-specific usage limit
      if (coupon.maxUsagePerUser) {
        const userUsageCount = await prisma.couponUsage.count({
          where: {
            couponId: coupon.id,
            userId
          }
        });

        if (userUsageCount >= coupon.maxUsagePerUser) {
          continue;
        }
      }

      // Check minimum order value
      if (coupon.minOrderValue && orderVal < coupon.minOrderValue) {
        continue;
      }

      // Calculate potential discount
      let discountAmount = 0;
      if (coupon.discountType === "percentage") {
        discountAmount = (orderVal * coupon.discountValue) / 100;
        if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
          discountAmount = coupon.maxDiscountAmount;
        }
      } else {
        discountAmount = coupon.discountValue;
      }

      if (discountAmount > orderVal) {
        discountAmount = orderVal;
      }

      availableCoupons.push({
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        usageType: coupon.usageType,
        minOrderValue: coupon.minOrderValue,
        maxDiscountAmount: coupon.maxDiscountAmount,
        estimatedDiscount: parseFloat(discountAmount.toFixed(2)),
        isFirstTimeUserOnly: coupon.usageType === "first-time-user-only"
      });
    }

    // Sort by estimated discount (highest first)
    availableCoupons.sort((a, b) => b.estimatedDiscount - a.estimatedDiscount);

    res.status(200).json({
      success: true,
      data: {
        isFirstTimeUser,
        coupons: availableCoupons
      }
    });
  } catch (error) {
    console.error("Error fetching available coupons:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch available coupons",
      error: error.message
    });
  }
};

// Get active promotional coupons for header display
exports.getPromotionalCoupons = async (req, res) => {
  try {
    const now = new Date();
    const coupons = await prisma.coupon.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        validUntil: { gte: now },
        isAffiliateCoupon: false,
        NOT: { code: { startsWith: "AFF" } },
        OR: [
          { maxUsageCount: null },
          { 
            AND: [
              { maxUsageCount: { not: null } },
              { currentUsageCount: { lt: prisma.coupon.fields.maxUsageCount } }
            ]
          }
        ]
      },
      select: {
        code: true,
        description: true,
        discountType: true,
        discountValue: true,
        minOrderValue: true,
        maxDiscountAmount: true,
        usageType: true
      },
      orderBy: { discountValue: "desc" },
      take: 10 // Get top 10 offers including first-time user offers
    });

    res.status(200).json({
      success: true,
      data: coupons
    });
  } catch (error) {
    console.error("Error fetching promotional coupons:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch promotional coupons",
      error: error.message
    });
  }
};
