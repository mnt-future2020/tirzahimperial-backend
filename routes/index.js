const express = require('express');

// Common routes
const imageProxyRoutes = require('./common/imageProxyRoutes');

// Auth routes
const authRoutes = require('./auth/authRoutes');

// Dashboard routes
const dashboardRoutes = require('./dashboard/dashboardRoutes');

// Email routes
const emailConfigRoutes = require('./email/emailConfigRoutes');

// Web settings routes
const webSettingsRoutes = require('./web/webSettingsRoutes');
const bannerRoutes = require('./web/bannerRoutes');
const companyRoutes = require('./web/companyRoutes');
const seoRoutes = require('./web/seoRoutes');
const policyRoutes = require('./web/policyRoutes');
const contactRoutes = require('./web/contactRoutes');
const faqRoutes = require('./web/faqRoutes');
const affiliateRoutes = require('./affiliate/affiliateRoutes');

// Finance routes
const gstRateRoutes = require('./finance/gstRateRoutes');
const invoiceSettingsRoutes = require('./finance/invoiceSettingsRoutes');
const salesRoutes = require('./finance/salesRoutes');
const transactionRoutes = require('./finance/transactionRoutes');
const salesReportRoutes = require('./finance/salesReportRoutes');

// Payment Gateway routes
const paymentGatewayRoutes = require('./payment-gateway/paymentGatewayRoutes');

// Customer routes
const customerRoutes = require('./customer/customerRoutes');

// Delivery routes (disabled for cosmetics ecommerce scope)
// const deliveryPartnerRoutes = require('./delivery/deliveryPartnerRoutes');

// Partner routes (Delivery Partner App) (disabled for cosmetics ecommerce scope)
// const partnerRoutes = require('./partner/partnerRoutes');

// Debug routes (for development/testing)
const notificationDebugRoutes = require('./debug/notificationDebug');

// Inventory routes
const categoryRoutes = require('./inventory/categoryRoutes');
const itemRoutes = require('./inventory/itemRoutes');
const warehouseRoutes = require('./inventory/warehouseRoutes');
const stockAdjustmentRoutes = require('./inventory/stockAdjustmentRoutes');
const inventoryReportRoutes = require('./inventory/reportRoutes');
// Processing routes (disabled for cosmetics ecommerce scope)
// const processingRoutes = require('./inventory/processingRoutes');

// Online service routes
const categorySubcategoryRoutes = require('./online/categorySubcategoryRoutes');
const frontendRoutes = require('./online/frontendRoutes');
const onlineProductRoutes = require('./online/onlineProductRoutes');
const productRoutes = require('./online/productRoutes');
const brandRoutes = require('./online/brandRoutes');
const badgeRoutes = require('./online/badgeRoutes');
const cuttingStyleRoutes = require('./online/cuttingStyleRoutes');
const barcodeRoutes = require('./online/barcodeRoutes');
const couponRoutes = require('./online/couponRoutes');
const cartRoutes = require('./online/cartRoutes');
const wishlistRoutes = require('./online/wishlistRoutes');
const addressRoutes = require('./online/addressRoutes');
const productReviewRoutes = require('./online/productReviewRoutes');
const productReviewAdminRoutes = require('./online/productReviewAdminRoutes');
const rewardRoutes = require('./rewards/rewardRoutes');

// Order routes
const orderRoutes = require('./order/orderRoutes');
const myOrdersRoutes = require('./order/myOrdersRoutes');
const adminOrderRoutes = require('./order/adminOrderRoutes');

// Courier routes
const courierRoutes = require('./courier/courierRoutes');

// POS routes (disabled for cosmetics ecommerce scope)
// const posProductRoutes = require('./pos/posProductRoutes');
// const posBarcodeRoutes = require('./pos/posBarcodeRoutes');
// const posOrderRoutes = require('./pos/posOrderRoutes');
// const posInvoiceRoutes = require('./pos/posInvoiceRoutes');

// Purchase routes (disabled for cosmetics ecommerce scope)
// const supplierRoutes = require('./purchase/supplierRoutes');
// const purchaseOrderRoutes = require('./purchase/purchaseOrderRoutes');
// const billRoutes = require('./purchase/billRoutes');
// const expenseCategoryRoutes = require('./purchase/expenseCategoryRoutes');
// const expenseRoutes = require('./purchase/expenseRoutes');
// const purchaseReportRoutes = require('./purchase/reportRoutes');

// Init routes (for manual admin initialization)
const initRoutes = require('./init');

// Delivery Zone routes
const deliveryZoneRoutes = require('./deliveryZoneRoutes');

// Delivery Charge routes
const deliveryChargeRoutes = require('./settings/deliveryChargeRoutes');

// Order Schedule routes (disabled for cosmetics ecommerce scope)
// const orderScheduleRoutes = require('./settings/orderScheduleRoutes');

// Enquiry routes (disabled for cosmetics ecommerce scope)
// const bulkOrderEnquiryRoutes = require('./enquiry/bulkOrderEnquiryRoutes');
// const cateringServiceEnquiryRoutes = require('./enquiry/cateringServiceEnquiryRoutes');

const router = express.Router();

// Root route - API information
router.get('/', (req, res) => {
  res.json({
    message: 'Monolith E-Commerce API is running',
    version: '1.0.0',
    architecture: 'monolith',
    database: 'monolith-ecommerce',
    timestamp: new Date().toISOString(),
  });
});

// Health check route
router.get('/health', async (req, res) => {
  try {
    const { prisma } = require('../config/database');
    
    // Check admin count
    const adminCount = await prisma.admin.count();
    
    res.json({
      status: 'OK',
      service: 'Monolith E-Commerce Backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected',
      adminInitialized: adminCount > 0,
      adminCount,
    });
  } catch (error) {
    res.json({
      status: 'OK',
      service: 'Monolith E-Commerce Backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'error',
      adminInitialized: false,
      error: error.message,
    });
  }
});

// Image proxy route (must be before auth to allow public access)
router.use('/image', imageProxyRoutes);

// Auth routes
router.use('/auth', authRoutes);

// Init routes (manual admin initialization)
router.use('/init', initRoutes);

// Dashboard routes
router.use('/dashboard', dashboardRoutes);

// Email routes
router.use('/email/dashboard/settings/email-configuration', emailConfigRoutes);

// Web settings routes
router.use('/web/web-settings', webSettingsRoutes);
router.use('/web/banners', bannerRoutes);
router.use('/web/company', companyRoutes);
router.use('/web/seo', seoRoutes);
router.use('/web/policies', policyRoutes);
router.use('/web/contact', contactRoutes);
router.use('/web/faqs', faqRoutes);
router.use('/affiliate', affiliateRoutes);

// Finance routes
router.use('/finance/gst-rates', gstRateRoutes);
router.use('/finance/invoice-settings', invoiceSettingsRoutes);
router.use('/finance/sales', salesRoutes);
router.use('/finance/transactions', transactionRoutes);
router.use('/finance/reports', salesReportRoutes);

// Payment Gateway routes
router.use('/payment-gateway', paymentGatewayRoutes);

// Customer routes
router.use('/customer', customerRoutes);

// Delivery routes (disabled for cosmetics ecommerce scope)
// router.use('/delivery-partners', deliveryPartnerRoutes);

// Partner routes (Delivery Partner App APIs) (disabled for cosmetics ecommerce scope)
// router.use('/partner', partnerRoutes);

// Debug routes (for development/testing)
if (process.env.NODE_ENV !== 'production') {
  router.use('/debug/notifications', notificationDebugRoutes);
  console.log('🐛 Debug routes enabled: /api/debug/notifications');
}

// Delivery Zone routes
router.use('/delivery-zones', deliveryZoneRoutes);

// Delivery Charge routes
router.use('/settings/delivery-charges', deliveryChargeRoutes);

// Order Schedule routes (disabled for cosmetics ecommerce scope)
// router.use('/online/order-schedule', orderScheduleRoutes);

// Inventory routes
router.use('/inventory/categories', categoryRoutes);
router.use('/inventory/items', itemRoutes);
router.use('/inventory/warehouses', warehouseRoutes);
router.use('/inventory/stock-adjustments', stockAdjustmentRoutes);
router.use('/inventory/reports', inventoryReportRoutes);
// router.use('/inventory', processingRoutes); // disabled for cosmetics ecommerce scope

// Online service routes
router.use('/online/category-subcategory', categorySubcategoryRoutes);
router.use('/online/frontend', frontendRoutes);
router.use('/online/online-products', onlineProductRoutes);
router.use('/online/products', productRoutes); // Inventory products synced for online use
router.use('/online/brands', brandRoutes);
router.use('/online/badges', badgeRoutes);
router.use('/online/cutting-styles', cuttingStyleRoutes);
router.use('/online/barcodes', barcodeRoutes);
router.use('/online/coupons', couponRoutes);
router.use('/online/cart', cartRoutes);
router.use('/online/wishlist', wishlistRoutes);
router.use('/online/addresses', addressRoutes);
router.use('/online/reviews', productReviewRoutes);
router.use('/online/admin/reviews', productReviewAdminRoutes);
router.use('/rewards', rewardRoutes);
router.use('/online/orders', orderRoutes); // Order creation and management
router.use('/online/my-orders', myOrdersRoutes); // Customer order history
router.use('/online/admin/orders', adminOrderRoutes); // Admin order management

// Courier routes
router.use('/courier', courierRoutes);

// POS routes (disabled for cosmetics ecommerce scope)
// router.use('/pos/products', posProductRoutes);
// router.use('/pos/barcodes', posBarcodeRoutes);
// router.use('/pos/orders', posOrderRoutes);
// router.use('/pos/invoices', posInvoiceRoutes);

// Purchase routes (disabled for cosmetics ecommerce scope)
// router.use('/purchase/suppliers', supplierRoutes);
// router.use('/purchase/purchase-orders', purchaseOrderRoutes);
// router.use('/purchase/bills', billRoutes);
// router.use('/purchase/expense-categories', expenseCategoryRoutes);
// router.use('/purchase/expenses', expenseRoutes);
// router.use('/purchase/reports', purchaseReportRoutes);

// Enquiry routes (disabled for cosmetics ecommerce scope)
// router.use('/enquiry/bulk-order', bulkOrderEnquiryRoutes);
// router.use('/enquiry/catering-service', cateringServiceEnquiryRoutes);

module.exports = router;
