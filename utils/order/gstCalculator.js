/**
 * GST Calculation Utilities for Online Orders
 * Based on admin state and customer delivery state
 */

const { prisma } = require("../../config/database");

/**
 * Determine GST type based on admin and customer states
 * @param {string} adminState - Admin/Company state
 * @param {string} customerState - Customer delivery state
 * @returns {"cgst_sgst" | "igst"} GST type
 */
const determineGSTType = (adminState, customerState) => {
  if (!adminState || !customerState) return "cgst_sgst";

  // Normalize state names (remove spaces, lowercase)
  const normalizeState = (state) =>
    state.toLowerCase().trim().replace(/\s+/g, "");

  const admin = normalizeState(adminState);
  const customer = normalizeState(customerState);

  // Same state → CGST + SGST
  // Different state → IGST
  return admin === customer ? "cgst_sgst" : "igst";
};

/**
 * Calculate GST breakdown for order items
 * @param {Array} items - Order items with GST percentages
 * @param {string} gstType - "cgst_sgst" or "igst"
 * @returns {Object} GST breakdown
 */
const calculateGSTBreakdown = (items, gstType) => {
  console.log("🔍 calculateGSTBreakdown - Input:", {
    itemsCount: items.length,
    gstType,
  });

  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  const itemsWithGST = items.map((item) => {
    // Treat unitPrice as Tax Inclusive
    const finalLinePrice = item.quantity * item.unitPrice;
    const gstRate = item.gstPercentage || 0;

    // Back-calculate Base Price and Tax
    // Final = Base * (1 + Rate/100)
    // Base = Final / (1 + Rate/100)
    const baseLinePrice = finalLinePrice / (1 + gstRate / 100);
    const totalItemGstAmount = finalLinePrice - baseLinePrice;

    console.log("🔍 calculateGSTBreakdown - Item (Inclusive):", {
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      finalLinePrice,
      baseLinePrice,
      totalItemGstAmount,
      gstRate,
      gstType,
    });

    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (gstType === "cgst_sgst") {
      // Split GST amount in half for CGST and SGST
      cgstAmount = totalItemGstAmount / 2;
      sgstAmount = totalItemGstAmount / 2;
    } else {
      // Full amount for IGST
      igstAmount = totalItemGstAmount;
    }

    totalCGST += cgstAmount;
    totalSGST += sgstAmount;
    totalIGST += igstAmount;

    return {
      ...item,
      itemTotal: baseLinePrice, // Used for subtotal (Tax Exclusive)
      gstType,
      cgstPercentage: gstType === "cgst_sgst" ? gstRate / 2 : 0,
      sgstPercentage: gstType === "cgst_sgst" ? gstRate / 2 : 0,
      igstPercentage: gstType === "igst" ? gstRate : 0,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalGstAmount: totalItemGstAmount,
      totalPrice: finalLinePrice, // Inclusive Total
    };
  });

  const result = {
    items: itemsWithGST,
    gstBreakdown: {
      gstType,
      totalCGST,
      totalSGST,
      totalIGST,
      totalGST: totalCGST + totalSGST + totalIGST,
    },
  };

  console.log("🔍 calculateGSTBreakdown - Final:", result.gstBreakdown);

  return result;
};

/**
 * Get admin state from Admin profile
 * @returns {Promise<string>} Admin state
 */
const getAdminState = async () => {
  try {
    // Get the first active admin (assuming single admin or primary admin)
    const admin = await prisma.admin.findFirst({
      where: {
        isActive: true,
      },
      select: {
        state: true,
        name: true,
        email: true,
      },
    });

    console.log('🔍 getAdminState - Admin Profile:', {
      found: !!admin,
      state: admin?.state,
      name: admin?.name,
      email: admin?.email
    });

    if (admin && admin.state) {
      console.log('✅ Admin state found:', admin.state);
      return admin.state;
    }

    console.warn('⚠️ Admin state not found in admin profile');
    return "";
  } catch (error) {
    console.error("❌ Error fetching admin state from admin profile:", error.message);
    return "";
  }
};

/**
 * Extract customer state from delivery address
 * @param {Object} deliveryAddress - Customer delivery address
 * @returns {string} Customer state
 */
const extractCustomerState = (deliveryAddress) => {
  if (!deliveryAddress) return "";

  // Handle different address formats
  if (typeof deliveryAddress === "string") {
    // If address is a string, try to extract state (this is basic)
    return "";
  }

  if (typeof deliveryAddress === "object") {
    return deliveryAddress.state || deliveryAddress.State || "";
  }

  return "";
};

/**
 * Calculate complete order totals with GST
 * @param {Object} orderData - Order data with items and addresses
 * @returns {Promise<Object>} Complete order calculation
 */
const calculateOrderTotals = async (orderData) => {
  const {
    items,
    deliveryAddress,
    discount = 0,
    couponDiscount = 0,
    rewardDiscount = 0,
    shippingCharge = 0,
  } = orderData;

  console.log("🔍 GST Calculator Debug - Input:", {
    itemsCount: items.length,
    deliveryAddress: deliveryAddress,
    discount,
    couponDiscount,
    rewardDiscount,
    rewardDiscount,
    shippingCharge,
  });

  // Get admin and customer states
  const adminState = await getAdminState();
  const customerState = extractCustomerState(deliveryAddress);

  console.log("🔍 GST Calculator Debug - States:", {
    adminState,
    customerState,
  });

  // Determine GST type
  const gstType = determineGSTType(adminState, customerState);

  console.log("🔍 GST Calculator Debug - GST Type:", gstType);

  // Debug items before GST calculation
  console.log(
    "🔍 GST Calculator Debug - Items:",
    items.map((item) => ({
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      gstPercentage: item.gstPercentage,
    }))
  );

  // Calculate GST breakdown
  const { items: itemsWithGST, gstBreakdown } = calculateGSTBreakdown(
    items,
    gstType
  );

  console.log("🔍 GST Calculator Debug - GST Breakdown:", gstBreakdown);

  // Calculate subtotal
  const subtotal = itemsWithGST.reduce((sum, item) => sum + item.itemTotal, 0);

  // Calculate total after discounts and charges
  const totalAfterDiscount = subtotal - discount - couponDiscount - rewardDiscount;
  const totalWithShipping = totalAfterDiscount + shippingCharge;
  const grandTotal = totalWithShipping + gstBreakdown.totalGST;

  const result = {
    items: itemsWithGST,
    subtotal,
    gstType,
    adminState,
    customerState,
    cgstAmount: gstBreakdown.totalCGST,
    sgstAmount: gstBreakdown.totalSGST,
    igstAmount: gstBreakdown.totalIGST,
    totalGstAmount: gstBreakdown.totalGST,
    tax: gstBreakdown.totalGST, // For backward compatibility
    taxRate: 0, // This would need to be calculated as weighted average if needed
    discount,
    couponDiscount,
    shippingCharge,
    total: grandTotal,
    gstBreakdown: {
      type: gstType,
      cgst: gstBreakdown.totalCGST,
      sgst: gstBreakdown.totalSGST,
      igst: gstBreakdown.totalIGST,
      total: gstBreakdown.totalGST,
    },
  };

  console.log("🔍 GST Calculator Debug - Final Result:", {
    subtotal: result.subtotal,
    cgstAmount: result.cgstAmount,
    sgstAmount: result.sgstAmount,
    igstAmount: result.igstAmount,
    totalGstAmount: result.totalGstAmount,
    total: result.total,
  });

  return result;
};

module.exports = {
  determineGSTType,
  calculateGSTBreakdown,
  getAdminState,
  extractCustomerState,
  calculateOrderTotals,
};
