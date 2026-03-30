const { prisma } = require('../../config/database');
const { sendExpiringProductAlert, sendDailyExpirySummary } = require('./sendNotification');

/**
 * Check all inventory items for expiring products and send alerts
 * ✅ FIXED: Only send alerts for items expiring within 7 days (not 30 days)
 * Categories:
 * - Critical: Expiring in 3 days or less
 * - Urgent: Expiring in 4-7 days
 */
const checkAndSendExpiryAlerts = async () => {
  try {
    console.log('🔍 [Expiry Alert Scheduler] Starting expiry check...');

    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(now.getDate() + 7); // ✅ Changed from 30 to 7 days

    // ✅ Fetch only items expiring within next 7 days (not 30)
    const expiringItems = await prisma.item.findMany({
      where: {
        expiryDate: {
          gte: now,
          lte: sevenDaysFromNow, // ✅ Changed from thirtyDaysFromNow
        },
      },
      include: {
        warehouse: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        expiryDate: 'asc', // Earliest expiry first
      },
    });

    if (expiringItems.length === 0) {
      console.log('✅ [Expiry Alert Scheduler] No items expiring in next 7 days');
      return { success: true, alertsSent: 0, message: 'No expiring items' };
    }

    console.log(`⚠️ [Expiry Alert Scheduler] Found ${expiringItems.length} items expiring in next 7 days`);

    // Categorize items by urgency
    const categorizedItems = {
      critical: [], // ≤3 days
      urgent: [],   // 4-7 days
    };

    expiringItems.forEach((item) => {
      const daysUntilExpiry = Math.ceil((new Date(item.expiryDate) - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry <= 3) {
        categorizedItems.critical.push({ ...item, daysUntilExpiry });
      } else if (daysUntilExpiry <= 7) {
        categorizedItems.urgent.push({ ...item, daysUntilExpiry });
      }
    });

    console.log(`   - Critical (≤3 days): ${categorizedItems.critical.length} items`);
    console.log(`   - Urgent (4-7 days): ${categorizedItems.urgent.length} items`);

    // ✅ Send individual alerts for critical and urgent items (all items within 7 days)
    const alertsToSend = [
      ...categorizedItems.critical,
      ...categorizedItems.urgent,
    ];

    const alertResults = await Promise.allSettled(
      alertsToSend.map(async (item) => {
        const warehouseName = item.warehouse?.name || 'Unknown Warehouse';
        
        try {
          await sendExpiringProductAlert(
            item.itemName,
            item.expiryDate,
            item.daysUntilExpiry,
            warehouseName,
            item.id
          );
          
          console.log(`   ✅ Alert sent: ${item.itemName} (expires in ${item.daysUntilExpiry} days)`);
          return { success: true, itemName: item.itemName };
        } catch (error) {
          console.error(`   ❌ Failed to send alert for ${item.itemName}:`, error.message);
          return { success: false, itemName: item.itemName, error: error.message };
        }
      })
    );

    const successCount = alertResults.filter(
      r => r.status === 'fulfilled' && r.value.success
    ).length;

    console.log(`✅ [Expiry Alert Scheduler] Completed: ${successCount}/${alertsToSend.length} alerts sent successfully`);

    return {
      success: true,
      alertsSent: successCount,
      totalItems: expiringItems.length,
      criticalCount: categorizedItems.critical.length,
      urgentCount: categorizedItems.urgent.length,
    };
  } catch (error) {
    console.error('❌ [Expiry Alert Scheduler] Error during expiry check:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send a daily summary notification to admins about expiring products
 * ✅ FIXED: Only report items expiring within 7 days (not 30 days)
 * This provides a comprehensive overview instead of individual alerts
 */
const sendDailyExpiryReport = async () => {
  try {
    console.log('📊 [Expiry Alert Scheduler] Generating daily expiry report...');

    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(now.getDate() + 7); // ✅ Changed from 30 to 7 days

    // ✅ Get only items expiring within 7 days
    const expiringItems = await prisma.item.findMany({
      where: {
        expiryDate: {
          gte: now,
          lte: sevenDaysFromNow, // ✅ Changed from thirtyDaysFromNow
        },
      },
      include: {
        warehouse: {
          select: { name: true },
        },
      },
      orderBy: {
        expiryDate: 'asc',
      },
    });

    // ✅ Only send summary if there are items expiring within 7 days
    if (expiringItems.length === 0) {
      console.log('✅ [Expiry Alert Scheduler] No items expiring in next 7 days - no summary needed');
      return { success: true, message: 'No items expiring soon' };
    }

    // Categorize by urgency
    const summary = {
      critical: 0,
      urgent: 0,
      total: expiringItems.length,
    };

    expiringItems.forEach((item) => {
      const daysUntilExpiry = Math.ceil((new Date(item.expiryDate) - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry <= 3) {
        summary.critical++;
      } else if (daysUntilExpiry <= 7) {
        summary.urgent++;
      }
    });

    // Send summary notification
    await sendDailyExpirySummary(summary);
    
    console.log('✅ [Expiry Alert Scheduler] Daily expiry report sent to admins');
    
    return {
      success: true,
      ...summary,
    };
  } catch (error) {
    console.error('❌ [Expiry Alert Scheduler] Error sending daily expiry report:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Check for items expiring today and send final warning
 */
const sendExpiringTodayAlert = async () => {
  try {
    console.log('🚨 [Expiry Alert Scheduler] Checking items expiring today...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get items expiring today
    const itemsExpiringToday = await prisma.item.findMany({
      where: {
        expiryDate: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        warehouse: {
          select: { name: true },
        },
      },
    });

    if (itemsExpiringToday.length === 0) {
      console.log('✅ [Expiry Alert Scheduler] No items expiring today');
      return { success: true, message: 'No items expiring today' };
    }

    console.log(`🚨 [Expiry Alert Scheduler] ${itemsExpiringToday.length} item(s) expiring TODAY!`);

    // Send individual critical alerts for each item
    const results = await Promise.allSettled(
      itemsExpiringToday.map(async (item) => {
        const warehouseName = item.warehouse?.name || 'Unknown Warehouse';
        
        try {
          await sendExpiringProductAlert(
            item.itemName,
            item.expiryDate,
            0, // 0 days = expiring today
            warehouseName,
            item.id
          );
          
          console.log(`   🚨 CRITICAL alert sent: ${item.itemName} (EXPIRES TODAY)`);
          return { success: true, itemName: item.itemName };
        } catch (error) {
          console.error(`   ❌ Failed to send alert for ${item.itemName}:`, error.message);
          return { success: false, itemName: item.itemName, error: error.message };
        }
      })
    );

    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value.success
    ).length;

    console.log(`✅ [Expiry Alert Scheduler] ${successCount}/${itemsExpiringToday.length} critical alerts sent`);

    return {
      success: true,
      alertsSent: successCount,
      totalItems: itemsExpiringToday.length,
    };
  } catch (error) {
    console.error('❌ [Expiry Alert Scheduler] Error checking items expiring today:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  checkAndSendExpiryAlerts,
  sendDailyExpiryReport,
  sendExpiringTodayAlert,
};
