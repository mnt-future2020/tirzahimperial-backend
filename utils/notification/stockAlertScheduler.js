const { prisma } = require('../../config/database');
const { sendLowStockAlert, sendToAllAdmins } = require('./sendNotification');
const { formatSmartUOMDisplay } = require('../inventory/uomConverter');

/**
 * Check all inventory items and send alerts for low stock / out of stock
 * This function should be called daily by a cron job
 */
const checkAndSendStockAlerts = async () => {
  try {
    console.log('🔍 [Stock Alert Scheduler] Starting daily stock check...');

    // Fetch all items with their warehouse info
    const items = await prisma.item.findMany({
      where: {
        OR: [
          { status: 'low_stock' },
          { status: 'out_of_stock' },
        ],
      },
      include: {
        warehouse: {
          select: {
            name: true,
          },
        },
      },
    });

    if (items.length === 0) {
      console.log('✅ [Stock Alert Scheduler] No low stock or out of stock items found');
      return { success: true, alertsSent: 0, message: 'No alerts needed' };
    }

    console.log(`⚠️ [Stock Alert Scheduler] Found ${items.length} items requiring alerts`);

    // Group items by status for better reporting
    const outOfStockItems = items.filter(item => item.status === 'out_of_stock');
    const lowStockItems = items.filter(item => item.status === 'low_stock');

    console.log(`   - Out of Stock: ${outOfStockItems.length} items`);
    console.log(`   - Low Stock: ${lowStockItems.length} items`);

    // Send individual alerts for each item
    const alertResults = await Promise.allSettled(
      items.map(async (item) => {
        const warehouseName = item.warehouse?.name || 'Unknown Warehouse';
        
        try {
          await sendLowStockAlert(
            item.itemName,
            item.quantity,
            item.lowStockAlertLevel,
            warehouseName,
            item.baseUom
          );
          
          console.log(`   ✅ Alert sent: ${item.itemName} (${item.status})`);
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

    console.log(`✅ [Stock Alert Scheduler] Completed: ${successCount}/${items.length} alerts sent successfully`);

    return {
      success: true,
      alertsSent: successCount,
      totalItems: items.length,
      outOfStockCount: outOfStockItems.length,
      lowStockCount: lowStockItems.length,
    };
  } catch (error) {
    console.error('❌ [Stock Alert Scheduler] Error during stock check:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send a summary notification to admins about stock status
 * This provides a daily overview instead of individual alerts
 */
const sendDailyStockSummary = async () => {
  try {
    console.log('📊 [Stock Alert Scheduler] Generating daily stock summary...');

    // Get counts of items by status
    const [outOfStockCount, lowStockCount, totalItems] = await Promise.all([
      prisma.item.count({ where: { status: 'out_of_stock' } }),
      prisma.item.count({ where: { status: 'low_stock' } }),
      prisma.item.count(),
    ]);

    // Only send summary if there are issues
    if (outOfStockCount === 0 && lowStockCount === 0) {
      console.log('✅ [Stock Alert Scheduler] All items are in stock - no summary needed');
      return { success: true, message: 'No issues to report' };
    }

    // Get top 5 critical items (out of stock or lowest stock)
    const criticalItems = await prisma.item.findMany({
      where: {
        OR: [
          { status: 'out_of_stock' },
          { status: 'low_stock' },
        ],
      },
      include: {
        warehouse: {
          select: { name: true },
        },
      },
      orderBy: [
        { status: 'asc' }, // out_of_stock comes before low_stock
        { quantity: 'asc' }, // lowest quantity first
      ],
      take: 5,
    });

    // Build summary message
    let summaryBody = `📊 Daily Stock Report\n\n`;
    summaryBody += `🚨 Out of Stock: ${outOfStockCount} items\n`;
    summaryBody += `⚠️ Low Stock: ${lowStockCount} items\n`;
    summaryBody += `✅ Total Items: ${totalItems}\n\n`;
    
    if (criticalItems.length > 0) {
      summaryBody += `🔝 Top ${criticalItems.length} Critical Items:\n`;
      criticalItems.forEach((item, index) => {
        const emoji = item.status === 'out_of_stock' ? '🚨' : '⚠️';
        const formattedQty = formatSmartUOMDisplay(item.quantity, item.baseUom);
        summaryBody += `${index + 1}. ${emoji} ${item.itemName} - ${formattedQty} (${item.warehouse?.name || 'N/A'})\n`;
      });
    }


    
    const notification = {
      title: '📊 Daily Stock Alert Summary',
      body: summaryBody,
    };

    const data = {
      type: 'DAILY_STOCK_SUMMARY',
      outOfStockCount: outOfStockCount.toString(),
      lowStockCount: lowStockCount.toString(),
      totalItems: totalItems.toString(),
      link: '/dashboard/inventory-management',
      urgency: outOfStockCount > 0 ? 'high' : 'normal',
      vibrate: [200, 100, 200],
      requireInteraction: true,
      color: outOfStockCount > 0 ? '#F44336' : '#FF9800',
      backgroundColor: outOfStockCount > 0 ? '#FFEBEE' : '#FFF3E0',
      actions: [
        {
          action: 'view',
          title: '👁️ View Inventory',
        },
        {
          action: 'dismiss',
          title: '✖️ Dismiss',
        },
      ],
    };

    await sendToAllAdmins(notification, data);
    
    console.log('✅ [Stock Alert Scheduler] Daily summary sent to admins');
    
    return {
      success: true,
      outOfStockCount,
      lowStockCount,
      totalItems,
    };
  } catch (error) {
    console.error('❌ [Stock Alert Scheduler] Error sending daily summary:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  checkAndSendStockAlerts,
  sendDailyStockSummary,
};
