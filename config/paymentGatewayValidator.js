const axios = require("axios");

/**
 * Validate Razorpay credentials by making a test API call
 * @param {string} apiKey - Razorpay API Key
 * @param {string} secretKey - Razorpay Secret Key
 * @returns {Promise<{valid: boolean, message: string}>}
 */
const validateRazorpayCredentials = async (apiKey, secretKey) => {
  try {
    if (!apiKey || !secretKey) {
      return {
        valid: false,
        message: "API Key and Secret Key are required for Razorpay",
      };
    }

    // Test Razorpay credentials by fetching account details
    const auth = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
    
    const response = await axios.get("https://api.razorpay.com/v1/payments", {
      headers: {
        Authorization: `Basic ${auth}`,
      },
      params: {
        count: 1, // Fetch only 1 payment to test credentials
      },
      timeout: 10000,
    });

    if (response.status === 200) {
      return {
        valid: true,
        message: "Razorpay credentials validated successfully",
      };
    }

    return {
      valid: false,
      message: "Invalid Razorpay credentials",
    };
  } catch (error) {
    console.error("Razorpay validation error:", error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      return {
        valid: false,
        message: "Invalid Razorpay API Key or Secret Key",
      };
    }
 
    if (error.response?.status === 400) {
      return {
        valid: false,
        message: "Bad request to Razorpay API. Please check your credentials",
      };
    }

    return {
      valid: false,
      message: error.response?.data?.error?.description || "Failed to validate Razorpay credentials",
    };
  }
};

/**
 * Validate Stripe credentials by making a test API call
 * @param {string} secretKey - Stripe Secret Key
 * @returns {Promise<{valid: boolean, message: string}>}
 */
const validateStripeCredentials = async (secretKey) => {
  try {
    if (!secretKey) {
      return {
        valid: false,
        message: "Secret Key is required for Stripe",
      };
    }

    // Validate that the key starts with sk_ (secret key format)
    if (!secretKey.startsWith("sk_")) {
      return {
        valid: false,
        message: "Invalid Stripe Secret Key format. Must start with 'sk_'",
      };
    }

    // Test Stripe credentials by fetching account balance
    const response = await axios.get("https://api.stripe.com/v1/balance", {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
      timeout: 10000,
    });

    if (response.status === 200) {
      return {
        valid: true,
        message: "Stripe credentials validated successfully",
      };
    }

    return {
      valid: false,
      message: "Invalid Stripe credentials",
    };
  } catch (error) {
    console.error("Stripe validation error:", error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      return {
        valid: false,
        message: "Invalid Stripe Secret Key",
      };
    }

    return {
      valid: false,
      message: error.response?.data?.error?.message || "Failed to validate Stripe credentials",
    };
  }
};

/**
 * Validate webhook secret format
 * @param {string} webhookSecret - Webhook secret
 * @param {string} gatewayName - Gateway name (razorpay/stripe)
 * @returns {Promise<{valid: boolean, message: string}>}
 */
const validateWebhookSecret = async (webhookSecret, gatewayName) => {
  try {
    if (!webhookSecret) {
      return {
        valid: true, // Webhook secret is optional
        message: "Webhook secret not provided (optional)",
      };
    }

    // Validate format based on gateway
    if (gatewayName === "razorpay") {
      // Razorpay webhook secrets are typically alphanumeric
      if (webhookSecret.length < 10) {
        return {
          valid: false,
          message: "Razorpay webhook secret is too short (minimum 10 characters)",
        };
      }
    } else if (gatewayName === "stripe") {
      // Stripe webhook secrets start with whsec_
      if (!webhookSecret.startsWith("whsec_")) {
        return {
          valid: false,
          message: "Invalid Stripe webhook secret format. Must start with 'whsec_'",
        };
      }
    }

    return {
      valid: true,
      message: "Webhook secret format is valid",
    };
  } catch (error) {
    return {
      valid: false,
      message: "Failed to validate webhook secret",
    };
  }
};

/**
 * Main function to connect and validate payment gateway
 * @param {string} gatewayName - Gateway name (razorpay/stripe/cod)
 * @param {Object} credentials - Gateway credentials
 * @returns {Promise<{success: boolean, message: string, data?: Object}>}
 */
const connectPaymentGateway = async (gatewayName, credentials) => {
  try {
    const { apiKey, secretKey, webhookSecret } = credentials;

    // COD doesn't require validation
    if (gatewayName === "cod") {
      return {
        success: true,
        message: "Cash on Delivery enabled successfully",
        data: {
          gatewayName,
          requiresValidation: false,
        },
      };
    }

    // Validate Razorpay
    if (gatewayName === "razorpay") {
      const validation = await validateRazorpayCredentials(apiKey, secretKey);
      
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message,
        };
      }

      // Validate webhook secret if provided
      if (webhookSecret) {
        const webhookValidation = await validateWebhookSecret(webhookSecret, gatewayName);
        if (!webhookValidation.valid) {
          return {
            success: false,
            message: webhookValidation.message,
          };
        }
      }

      return {
        success: true,
        message: "Razorpay connected successfully",
        data: {
          gatewayName,
          hasWebhookSecret: !!webhookSecret,
        },
      };
    }

    // Validate Stripe
    if (gatewayName === "stripe") {
      const validation = await validateStripeCredentials(secretKey);
      
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message,
        };
      }

      // Validate webhook secret if provided
      if (webhookSecret) {
        const webhookValidation = await validateWebhookSecret(webhookSecret, gatewayName);
        if (!webhookValidation.valid) {
          return {
            success: false,
            message: webhookValidation.message,
          };
        }
      }

      return {
        success: true,
        message: "Stripe connected successfully",
        data: {
          gatewayName,
          hasWebhookSecret: !!webhookSecret,
        },
      };
    }

    return {
      success: false,
      message: `Unsupported payment gateway: ${gatewayName}`,
    };
  } catch (error) {
    console.error("Payment gateway connection error:", error);
    return {
      success: false,
      message: "Failed to connect payment gateway",
      error: error.message,
    };
  }
};

module.exports = {
  connectPaymentGateway,
  validateRazorpayCredentials,
  validateStripeCredentials,
  validateWebhookSecret,
};
