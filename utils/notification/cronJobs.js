const cron = require('node-cron');
const { checkAndSendStockAlerts, sendDailyStockSummary } = require('./stockAlertScheduler');
const { checkAndSendExpiryAlerts, sendDailyExpiryReport, sendExpiringTodayAlert } = require('./expiryAlertScheduler');
const { checkWishlistPriceDrops } = require('./wishlistAlertScheduler');
const { checkAbandonedCarts } = require('./cartAlertScheduler');

/**
 * Initialize all cron jobs for notifications
 */
const initializeCronJobs = () => {
  console.log('⏰ [Cron Jobs] Initializing scheduled tasks...');

  // ============================================
  // STOCK ALERTS
  // ============================================

  // Daily stock alert summary - runs every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ [Cron] Running daily stock summary (9:00 AM)...');
    try {
      await sendDailyStockSummary();
    } catch (error) {
      console.error('❌ [Cron] Error in daily stock summary:', error);
    }
  }, {
    timezone: 'Asia/Kolkata', // Indian Standard Time
  });

  // Daily stock alert summary - runs every day at 5:00 PM (evening reminder)
  cron.schedule('0 17 * * *', async () => {
    console.log('⏰ [Cron] Running evening stock summary (5:00 PM)...');
    try {
      await sendDailyStockSummary();
    } catch (error) {
      console.error('❌ [Cron] Error in evening stock summary:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // Critical alerts every 6 hours for out-of-stock items
  cron.schedule('0 */6 * * *', async () => {
    console.log('⏰ [Cron] Running 6-hourly critical stock check...');
    try {
      await checkAndSendStockAlerts();
    } catch (error) {
      console.error('❌ [Cron] Error in 6-hourly stock check:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // ============================================
  // EXPIRY ALERTS
  // ============================================

  // Daily expiry report - runs every day at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ [Cron] Running daily expiry report (8:00 AM)...');
    try {
      await sendDailyExpiryReport();
    } catch (error) {
      console.error('❌ [Cron] Error in daily expiry report:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // Check expiring items - runs every day at 10:00 AM
  cron.schedule('0 10 * * *', async () => {
    console.log('⏰ [Cron] Running expiry check (10:00 AM)...');
    try {
      await checkAndSendExpiryAlerts();
    } catch (error) {
      console.error('❌ [Cron] Error in expiry check:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // Critical expiry check - runs every day at 6:00 PM
  cron.schedule('0 18 * * *', async () => {
    console.log('⏰ [Cron] Running evening expiry check (6:00 PM)...');
    try {
      await checkAndSendExpiryAlerts();
    } catch (error) {
      console.error('❌ [Cron] Error in evening expiry check:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // Items expiring TODAY - runs every day at 7:00 AM (early warning)
  cron.schedule('0 7 * * *', async () => {
    console.log('⏰ [Cron] Checking items expiring TODAY (7:00 AM)...');
    try {
      await sendExpiringTodayAlert();
    } catch (error) {
      console.error('❌ [Cron] Error in expiring today check:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // ============================================
  // WISHLIST ALERTS
  // ============================================

  // Daily wishlist price drop check - runs every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ [Cron] Running daily wishlist price drop check (9:00 AM)...');
    try {
      await checkWishlistPriceDrops();
    } catch (error) {
      console.error('❌ [Cron] Error in wishlist price drop check:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // ============================================
  // CART ALERTS
  // ============================================

  // Abandoned cart check - runs every hour
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ [Cron] Running abandoned cart check (hourly)...');
    try {
      await checkAbandonedCarts();
    } catch (error) {
      console.error('❌ [Cron] Error in abandoned cart check:', error);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  console.log('✅ [Cron Jobs] Scheduled tasks initialized:');
  console.log('   📦 STOCK ALERTS:');
  console.log('      - Daily Summary: 9:00 AM & 5:00 PM IST');
  console.log('      - Critical Alerts: Every 6 hours');
  console.log('   📅 EXPIRY ALERTS:');
  console.log('      - Daily Report: 8:00 AM IST');
  console.log('      - Expiry Check: 10:00 AM & 6:00 PM IST');
  console.log('      - Expiring Today: 7:00 AM IST');
  console.log('   💝 WISHLIST ALERTS:');
  console.log('      - Price Drop Check: 9:00 AM IST');
  console.log('   🛒 CART ALERTS:');
  console.log('      - Abandoned Cart Check: Every hour');
  console.log('   🌍 Timezone: Asia/Kolkata (IST)');
};

module.exports = {
  initializeCronJobs,
};
