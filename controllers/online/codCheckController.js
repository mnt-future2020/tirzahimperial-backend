const { prisma } = require("../../config/database");

/**
 * Check if COD is available for cart items
 * GET /api/online/orders/check-cod-availability
 */
const checkCODAvailability = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: "User ID is required" 
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { userId },
      include: { cartItems: true },
    });

    if (!customer || !customer.cartItems || customer.cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Cart is empty",
      });
    }

    // Check each product in cart for COD availability
    const unavailableProducts = [];
    for (const cartItem of customer.cartItems) {
      const product = await prisma.onlineProduct.findUnique({
        where: { id: cartItem.productId },
        select: { id: true, shortDescription: true, isCODAvailable: true },
      });

      if (product && !product.isCODAvailable) {
        unavailableProducts.push(product.shortDescription);
      }
    }

    if (unavailableProducts.length > 0) {
      return res.json({
        success: true,
        isCODAvailable: false,
        unavailableProducts,
        message: `COD is not available for: ${unavailableProducts.join(", ")}`,
      });
    }

    res.json({
      success: true,
      isCODAvailable: true,
      message: "COD is available for all items in cart",
    });
  } catch (error) {
    console.error("Error checking COD availability:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check COD availability",
      message: error.message,
    });
  }
};

module.exports = {
  checkCODAvailability,
};
