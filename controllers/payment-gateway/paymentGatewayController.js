const { connectPaymentGateway } = require("../../config/paymentGatewayValidator");
const { prisma } = require("../../config/database");

// Get all payment gateways
const getGateways = async (req, res) => {
  try {
    let gateways = await prisma.paymentGateway.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        apiKey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Initialize default gateways if they don't exist
    const defaultGateways = ["razorpay", "stripe", "cod"];
    const existingGatewayNames = gateways.map((g) => g.name);

    for (const gatewayName of defaultGateways) {
      if (!existingGatewayNames.includes(gatewayName)) {
        const newGateway = await prisma.paymentGateway.create({
          data: {
            name: gatewayName,
            isActive: false,
          },
        });
        gateways.push(newGateway);
      }
    }

    // Transform response to include boolean flags for security
    const transformedGateways = gateways.map((gateway) => ({
      id: gateway.id,
      name: gateway.name,
      isActive: gateway.isActive,
      hasApiKey: !!gateway.apiKey,
      hasSecretKey: false, // We'll check this from the actual record
      hasWebhookSecret: false,
      apiKey: gateway.name === "razorpay" || gateway.name === "stripe" 
        ? gateway.apiKey 
        : undefined,
    }));

    // Get full records to check for secret keys (without exposing them)
    const fullGateways = await prisma.paymentGateway.findMany({
      where: {
        name: {
          in: gateways.map((g) => g.name),
        },
      },
    });

    // Update the flags
    transformedGateways.forEach((tg) => {
      const fullGateway = fullGateways.find((fg) => fg.name === tg.name);
      if (fullGateway) {
        tg.hasSecretKey = !!fullGateway.secretKey;
        tg.hasWebhookSecret = !!fullGateway.webhookSecret;
      }
    });

    res.json({
      success: true,
      data: transformedGateways,
    });
  } catch (error) {
    console.error("Error fetching payment gateways:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment gateways",
      error: error.message,
    });
  }
};

// Update payment gateway configuration with validation
const updateGateway = async (req, res) => {
  try {
    const { gatewayName } = req.params;
    const { apiKey, secretKey, webhookSecret, isActive } = req.body;

    // Validate gateway name
    const validGateways = ["razorpay", "stripe", "cod"];
    if (!validGateways.includes(gatewayName)) {
      return res.status(400).json({
        success: false,
        message: "Invalid gateway name. Must be one of: razorpay, stripe, cod",
      });
    }

    // Find or create gateway
    let gateway = await prisma.paymentGateway.findUnique({
      where: { name: gatewayName },
    });

    if (!gateway) {
      gateway = await prisma.paymentGateway.create({
        data: {
          name: gatewayName,
          isActive: false,
        },
      });
    }

    // Prepare credentials for validation
    const credentials = {
      apiKey: apiKey !== undefined ? apiKey : gateway.apiKey,
      secretKey: secretKey !== undefined ? secretKey : gateway.secretKey,
      webhookSecret: webhookSecret !== undefined ? webhookSecret : gateway.webhookSecret,
    };

    // Validate credentials with payment gateway provider
    // Only validate if new credentials are provided
    if (apiKey !== undefined || secretKey !== undefined || webhookSecret !== undefined) {
      console.log(`🔍 Validating ${gatewayName} credentials...`);
      
      const validationResult = await connectPaymentGateway(gatewayName, credentials);
      
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          message: validationResult.message,
          error: "Credential validation failed",
        });
      }

      console.log(`✅ ${gatewayName} credentials validated successfully`);
    }

    // Prepare update data - only update fields that are provided
    const updateData = {};

    if (apiKey !== undefined) {
      updateData.apiKey = apiKey;
    }

    if (secretKey !== undefined) {
      updateData.secretKey = secretKey;
    }

    if (webhookSecret !== undefined) {
      updateData.webhookSecret = webhookSecret;
    }

    if (isActive !== undefined) {
      // Auto-enable if API key is provided and gateway is being activated
      if (isActive && !credentials.apiKey && gatewayName !== "cod") {
        return res.status(400).json({
          success: false,
          message: "API Key is required to enable the payment gateway",
        });
      }
      updateData.isActive = isActive;
    }

    // Save to database only after successful validation
    const updatedGateway = await prisma.paymentGateway.update({
      where: { name: gatewayName },
      data: updateData,
    });

    console.log(`💾 ${gatewayName} configuration saved to database`);

    res.json({
      success: true,
      message: "Payment gateway updated and validated successfully",
      data: {
        id: updatedGateway.id,
        name: updatedGateway.name,
        isActive: updatedGateway.isActive,
        hasApiKey: !!updatedGateway.apiKey,
        hasSecretKey: !!updatedGateway.secretKey,
        hasWebhookSecret: !!updatedGateway.webhookSecret,
      },
    });
  } catch (error) {
    console.error("Error updating payment gateway:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update payment gateway",
      error: error.message,
    });
  }
};

// Toggle payment gateway active status
const toggleGateway = async (req, res) => {
  try {
    const { gatewayName } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean value",
      });
    }

    // Find gateway
    let gateway = await prisma.paymentGateway.findUnique({
      where: { name: gatewayName },
    });

    if (!gateway) {
      // For COD, allow creation without API key
      if (gatewayName === "cod") {
        gateway = await prisma.paymentGateway.create({
          data: {
            name: gatewayName,
            isActive: isActive,
          },
        });
      } else {
        return res.status(400).json({
          success: false,
          message: "Payment gateway not configured. Please add API key first.",
        });
      }
    } else {
      // Validate that API key exists for online payment gateways when enabling
      if (isActive && gatewayName !== "cod" && !gateway.apiKey) {
        return res.status(400).json({
          success: false,
          message: "API Key is required to enable the payment gateway",
        });
      }

      // Update existing
      gateway = await prisma.paymentGateway.update({
        where: { name: gatewayName },
        data: { isActive },
      });
    }

    res.json({
      success: true,
      message: `Payment gateway ${isActive ? "enabled" : "disabled"} successfully`,
      data: {
        id: gateway.id,
        name: gateway.name,
        isActive: gateway.isActive,
      },
    });
  } catch (error) {
    console.error("Error toggling payment gateway:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle payment gateway",
      error: error.message,
    });
  }
};

// Get active payment gateways (for checkout)
const getActiveGateways = async (req, res) => {
  try {
    const activeGateways = await prisma.paymentGateway.findMany({
      where: {
        isActive: true,
      },
      select: {
        name: true,
        apiKey: true,
      },
    });

    res.json({
      success: true,
      data: activeGateways,
    });
  } catch (error) {
    console.error("Error fetching active payment gateways:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch active payment gateways",
      error: error.message,
    });
  }
};

module.exports = {
  getGateways,
  updateGateway,
  toggleGateway,
  getActiveGateways,
};
