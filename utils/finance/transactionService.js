/**
 * Transaction Service
 * Create and manage financial transactions for orders
 */

const { prisma } = require("../../config/database");
const { getFinancialPeriod } = require("./financialPeriod");

/**
 * Generate unique transaction ID
 * @returns {string} Transaction ID (e.g., TXN-1234567890-123)
 */
const generateTransactionId = () => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `TXN-${timestamp}-${random}`;
};

/**
 * Create transaction for POS order
 * @param {Object} order - POS order object
 * @returns {Promise<Object>} Created transaction
 */
const createPOSTransaction = async (order) => {
  try {
    const transactionId = generateTransactionId();
    const { financialYear, accountingPeriod } = await getFinancialPeriod(
      order.saleDate || new Date()
    );

    const transaction = await prisma.transaction.create({
      data: {
        transactionId,
        transactionType: "sale",
        referenceType: "pos_order",
        referenceId: order.id,
        referenceNumber: order.orderNumber,
        amount: order.total,
        currency: "INR",
        taxAmount: order.tax || 0,
        discountAmount: order.discount || 0,
        shippingAmount: 0,
        netAmount: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paymentId: null,
        paymentGateway: null,
        customerId: order.customerId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        userId: null,
        accountingPeriod,
        financialYear,
        transactionDate: order.saleDate || new Date(),
        revenueAmount: order.paymentStatus === "completed" ? order.total : 0,
        revenueRecognitionDate:
          order.paymentStatus === "completed" ? new Date() : null,
        revenueRecognitionReason:
          order.paymentStatus === "completed" ? "payment_completed" : null,
        description: `POS Sale - ${order.orderNumber}`,
        notes: order.invoiceNumber ? `Invoice: ${order.invoiceNumber}` : null,
        source: "pos",
        createdBy: order.createdBy,
        completedAt: order.paymentStatus === "completed" ? new Date() : null,
      },
    });

    console.log(`💰 Transaction created: ${transaction.transactionId} for POS order ${order.orderNumber}`);
    return transaction;
  } catch (error) {
    console.error("Error creating POS transaction:", error);
    throw error;
  }
};

/**
 * Create transaction for Online order
 * @param {Object} order - Online order object
 * @returns {Promise<Object>} Created transaction
 */
const createOnlineTransaction = async (order) => {
  try {
    const transactionId = generateTransactionId();
    const { financialYear, accountingPeriod } = await getFinancialPeriod(
      order.saleDate || new Date()
    );

    const transaction = await prisma.transaction.create({
      data: {
        transactionId,
        transactionType: "sale",
        referenceType: "online_order",
        referenceId: order.id,
        referenceNumber: order.orderNumber,
        amount: order.total,
        currency: "INR",
        taxAmount: order.tax || 0,
        discountAmount: (order.discount || 0) + (order.couponDiscount || 0),
        shippingAmount: order.shippingCharge || 0,
        netAmount: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paymentId: order.paymentId,
        paymentGateway:
          order.paymentMethod === "razorpay" || order.paymentMethod === "stripe"
            ? order.paymentMethod
            : null,
        gatewayTransactionId: order.paymentId,
        customerId: order.customerId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        userId: order.userId,
        accountingPeriod,
        financialYear,
        transactionDate: order.saleDate || new Date(),
        revenueAmount: order.paymentStatus === "completed" ? order.total : 0,
        revenueRecognitionDate:
          order.paymentStatus === "completed" ? new Date() : null,
        revenueRecognitionReason:
          order.paymentStatus === "completed"
            ? "payment_completed"
            : order.paymentMethod === "cod"
            ? "cod_pending"
            : null,
        description: `Online Sale - ${order.orderNumber}`,
        notes: order.invoiceNumber ? `Invoice: ${order.invoiceNumber}` : null,
        source: "online",
        createdBy: null,
        completedAt: order.paymentStatus === "completed" ? new Date() : null,
      },
    });

    console.log(
      `💰 Transaction created: ${transaction.transactionId} for online order ${order.orderNumber}`
    );
    return transaction;
  } catch (error) {
    console.error("Error creating online transaction:", error);
    throw error;
  }
};

/**
 * Update transaction status (e.g., when payment is completed)
 * @param {string} referenceNumber - Order number
 * @param {string} paymentStatus - New payment status
 * @param {Object} additionalData - Additional data to update
 * @returns {Promise<Object>} Updated transaction
 */
const updateTransactionStatus = async (
  referenceNumber,
  paymentStatus,
  additionalData = {}
) => {
  try {
    const updateData = {
      paymentStatus,
      updatedAt: new Date(),
    };

    // If payment is completed, update revenue recognition
    if (paymentStatus === "completed") {
      updateData.revenueAmount = additionalData.amount || 0;
      updateData.revenueRecognitionDate = new Date();
      updateData.revenueRecognitionReason = "payment_completed";
      updateData.completedAt = new Date();
    }

    // Add any additional data
    Object.assign(updateData, additionalData);

    const transaction = await prisma.transaction.updateMany({
      where: { referenceNumber },
      data: updateData,
    });

    console.log(`💰 Transaction updated for order ${referenceNumber}`);
    return transaction;
  } catch (error) {
    console.error("Error updating transaction:", error);
    throw error;
  }
};

module.exports = {
  generateTransactionId,
  createPOSTransaction,
  createOnlineTransaction,
  updateTransactionStatus,
};
