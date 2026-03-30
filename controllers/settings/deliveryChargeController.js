const { prisma } = require("../../config/database");


/**
 * Get all delivery charge settings
 * Multiple rules can exist
 */
const getDeliveryCharge = async (req, res) => {
  try {
    // Get all delivery charge rules ordered by minOrderValue ascending
    const deliveryCharges = await prisma.deliveryCharge.findMany({
      orderBy: { minOrderValue: 'asc' }
    });

    return res.status(200).json({
      success: true,
      data: deliveryCharges,
    });
  } catch (error) {
    console.error("Error fetching delivery charges:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch delivery charge settings",
      error: error.message,
    });
  }
};

/**
 * Create delivery charge settings
 * Multiple rules allowed
 */
const createDeliveryCharge = async (req, res) => {
  try {
    const { minOrderValue, chargeAmount, isActive } = req.body;

    // Validation
    if (minOrderValue === undefined || minOrderValue < 0) {
      return res.status(400).json({
        success: false,
        message: "Minimum order value must be 0 or greater",
      });
    }

    if (chargeAmount === undefined || chargeAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "Charge amount must be 0 or greater",
      });
    }

    // Create new delivery charge rule
    const deliveryCharge = await prisma.deliveryCharge.create({
      data: {
        minOrderValue: parseFloat(minOrderValue),
        chargeAmount: parseFloat(chargeAmount),
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Delivery charge rule created successfully",
      data: deliveryCharge,
    });
  } catch (error) {
    console.error("Error creating delivery charge:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create delivery charge rule",
      error: error.message,
    });
  }
};

/**
 * Update delivery charge settings
 */
const updateDeliveryCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const { minOrderValue, chargeAmount, isActive } = req.body;

    // Validation
    if (minOrderValue !== undefined && minOrderValue < 0) {
      return res.status(400).json({
        success: false,
        message: "Minimum order value must be 0 or greater",
      });
    }

    if (chargeAmount !== undefined && chargeAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "Charge amount must be 0 or greater",
      });
    }

    // Check if rule exists
    const existingRule = await prisma.deliveryCharge.findUnique({
      where: { id },
    });

    if (!existingRule) {
      return res.status(404).json({
        success: false,
        message: "Delivery charge rule not found",
      });
    }

    // Update delivery charge rule
    const updateData = {};
    if (minOrderValue !== undefined) updateData.minOrderValue = parseFloat(minOrderValue);
    if (chargeAmount !== undefined) updateData.chargeAmount = parseFloat(chargeAmount);
    if (isActive !== undefined) updateData.isActive = isActive;

    const deliveryCharge = await prisma.deliveryCharge.update({
      where: { id },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: "Delivery charge rule updated successfully",
      data: deliveryCharge,
    });
  } catch (error) {
    console.error("Error updating delivery charge:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update delivery charge rule",
      error: error.message,
    });
  }
};

/**
 * Delete delivery charge settings
 */
const deleteDeliveryCharge = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if rule exists
    const existingRule = await prisma.deliveryCharge.findUnique({
      where: { id },
    });

    if (!existingRule) {
      return res.status(404).json({
        success: false,
        message: "Delivery charge rule not found",
      });
    }

    // Delete delivery charge rule
    await prisma.deliveryCharge.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: "Delivery charge rule deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting delivery charge:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete delivery charge rule",
      error: error.message,
    });
  }
};

/**
 * Get active delivery charges for frontend (public endpoint)
 * Used by cart/checkout to calculate delivery fees
 * Returns all active rules ordered by minOrderValue descending
 * Frontend should apply the first matching rule (highest threshold that cart meets)
 */
const getActiveDeliveryCharge = async (req, res) => {
  try {
    const deliveryCharges = await prisma.deliveryCharge.findMany({
      where: { isActive: true },
      orderBy: { minOrderValue: 'desc' } // Highest threshold first
    });

    return res.status(200).json({
      success: true,
      data: deliveryCharges,
    });
  } catch (error) {
    console.error("Error fetching active delivery charges:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch active delivery charges",
      error: error.message,
    });
  }
};

module.exports = {
  getDeliveryCharge,
  createDeliveryCharge,
  updateDeliveryCharge,
  deleteDeliveryCharge,
  getActiveDeliveryCharge,
};
