const { prisma } = require('../../config/database');
const { sendAbandonedCartReminder } = require('./sendNotification');

/**
 * Check for abandoned carts and send reminders
 * This should run hourly via cron job
 */
const checkAbandonedCarts = async () => {
  try {
    console.log('🔍 [Cart Alert Scheduler] Checking for abandoned carts...');

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    // Get all customers with cart items
    const customersWithCarts = await prisma.customer.findMany({
      where: {
        cartItems: {
          some: {},
        },
      },
      include: {
        cartItems: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (customersWithCarts.length === 0) {
      console.log('✅ [Cart Alert Scheduler] No carts found');
      return { success: true, alertsSent: 0, message: 'No carts' };
    }

    console.log(`📊 [Cart Alert Scheduler] Found ${customersWithCarts.length} customers with carts`);

    let alertsSent = 0;
    const results = {
      oneHour: 0,
      twentyFourHours: 0,
      threeDays: 0,
    };

    for (const customer of customersWithCarts) {
      try {
        const { userId, cartItems } = customer;

        if (!cartItems || cartItems.length === 0) continue;

        // Get the most recent cart activity
        const lastCartActivity = cartItems[0].createdAt;

        // Check if user has placed any orders recently
        const recentOrders = await prisma.onlineOrder.findMany({
          where: {
            userId,
            createdAt: {
              gte: lastCartActivity,
            },
          },
        });

        // Skip if user has placed an order after adding to cart
        if (recentOrders.length > 0) {
          continue;
        }

        // Calculate cart totals
        const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
        const cartValue = cartItems.reduce(
          (sum, item) => sum + item.variantSellingPrice * item.quantity,
          0
        );
        const savings = cartItems.reduce(
          (sum, item) => sum + (item.variantMRP - item.variantSellingPrice) * item.quantity,
          0
        );

        // Check if we should send a reminder
        let reminderType = null;
        let shouldSend = false;

        // 1 hour reminder (with 10-minute tolerance)
        const oneHourWindow = new Date(oneHourAgo.getTime() - 10 * 60 * 1000);
        const oneHourWindowEnd = new Date(oneHourAgo.getTime() + 10 * 60 * 1000);
        
        if (lastCartActivity >= oneHourWindow && lastCartActivity <= oneHourWindowEnd) {
          reminderType = '1hour';
          shouldSend = true;
        }

        // 24 hours reminder (with 1-hour tolerance)
        const twentyFourHourWindow = new Date(twentyFourHoursAgo.getTime() - 60 * 60 * 1000);
        const twentyFourHourWindowEnd = new Date(twentyFourHoursAgo.getTime() + 60 * 60 * 1000);
        
        if (lastCartActivity >= twentyFourHourWindow && lastCartActivity <= twentyFourHourWindowEnd) {
          reminderType = '24hours';
          shouldSend = true;
        }

        // 3 days reminder (with 2-hour tolerance)
        const threeDaysWindow = new Date(threeDaysAgo.getTime() - 2 * 60 * 60 * 1000);
        const threeDaysWindowEnd = new Date(threeDaysAgo.getTime() + 2 * 60 * 60 * 1000);
        
        if (lastCartActivity >= threeDaysWindow && lastCartActivity <= threeDaysWindowEnd) {
          reminderType = '3days';
          shouldSend = true;
        }

        if (shouldSend && reminderType) {
          console.log(`🛒 Abandoned cart detected: ${customer.name} (${reminderType})`);
          console.log(`   Items: ${itemCount}, Value: ₹${cartValue.toFixed(2)}, Last activity: ${lastCartActivity}`);

          // Send notification
          const result = await sendAbandonedCartReminder(
            userId,
            itemCount,
            cartValue,
            savings,
            reminderType
          );

          if (result.success) {
            alertsSent++;
            results[reminderType === '1hour' ? 'oneHour' : reminderType === '24hours' ? 'twentyFourHours' : 'threeDays']++;
            console.log(`   ✅ ${reminderType} reminder sent to ${customer.name}`);
          } else {
            console.log(`   ❌ Failed to send reminder: ${result.error}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing cart for customer ${customer.id}:`, error.message);
      }
    }

    console.log(`✅ [Cart Alert Scheduler] Completed: ${alertsSent} reminders sent`);
    console.log(`   - 1 hour: ${results.oneHour}`);
    console.log(`   - 24 hours: ${results.twentyFourHours}`);
    console.log(`   - 3 days: ${results.threeDays}`);

    return {
      success: true,
      alertsSent,
      totalChecked: customersWithCarts.length,
      breakdown: results,
    };
  } catch (error) {
    console.error('❌ [Cart Alert Scheduler] Error checking abandoned carts:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  checkAbandonedCarts,
};
