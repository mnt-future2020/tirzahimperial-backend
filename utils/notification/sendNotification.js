const { getMessaging, getDeliveryMessaging } = require('../firebase/firebaseAdmin');
const { prisma } = require('../../config/database');
const { formatSmartUOMDisplay } = require('../inventory/uomConverter');

/**
 * Get company logo from WebSettings
 */
const getCompanyLogo = async () => {
  try {
    const webSettings = await prisma.webSettings.findFirst({
      select: { logoUrl: true },
    });
    
    if (webSettings?.logoUrl) {
      // logoUrl field contains the S3 key, use the proxy endpoint
      const backendUrl = process.env.BACKEND_URL || 'https://api.tirzahimperial.com';
      return `${backendUrl}/api/web/web-settings/logo`;
    }
    
    // Fallback to default logo from frontend
    const frontendUrl = process.env.FRONTEND_URL || 'https://tirzahimperial.com';
    return `${frontendUrl}/logo.jpeg`;
  } catch (error) {
    console.error('❌ Error fetching company logo:', error);
    // Fallback to default logo
    const frontendUrl = process.env.FRONTEND_URL || 'https://tirzahimperial.com';
    return `${frontendUrl}/logo.jpeg`;
  }
};

/**
 * Send notification to a single user/admin
 * @param {string} fcmToken - FCM device token
 * @param {object} notification - Notification payload
 * @param {object} data - Additional data payload
 */
const sendToDevice = async (fcmToken, notification, data = {}) => {
  try {
    if (!fcmToken) {
      console.log('⚠️ No FCM token provided');
      return { success: false, error: 'No FCM token' };
    }

    const messaging = getMessaging();
    
    if (!messaging) {
      console.log('⚠️ Firebase messaging not initialized');
      return { success: false, error: 'Firebase messaging not initialized' };
    }
    
    // Get company logo
    const logoUrl = await getCompanyLogo();
    console.log('📷 Using logo URL for notification:', logoUrl);
    
    // Convert all data values to strings (FCM requirement)
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object') {
        stringifiedData[key] = JSON.stringify(value);
      } else {
        stringifiedData[key] = String(value);
      }
    }
    
    // Add title, body, and image to data payload (Data-Only Message)
    // This suppresses the automatic browser notification
    // ✅ Renamed to notifTitle/notifBody to avoid potential reserved key conflicts in 'data'
    stringifiedData.notifTitle = notification.title;
    stringifiedData.notifBody = notification.body;
    // ✅ Redundant keys to ensure delivery (in case SDK treats custom keys differently)
    stringifiedData.title = notification.title;
    stringifiedData.body = notification.body;
    if (notification.image) {
      stringifiedData.notifImage = notification.image;
      stringifiedData.image = notification.image;
    }
    
    // Add logo URL to data
    stringifiedData.logoUrl = logoUrl;
    stringifiedData.notificationType = data.type || 'general';
    
    const message = {
      token: fcmToken,
      // ✅ Include notification field for mobile apps (Android/iOS)
      // This ensures Firebase displays system notifications automatically
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.image && { image: notification.image }),
      },
      data: stringifiedData,
      // Android-specific configuration
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high',
          sound: 'default',
          ...(notification.image && { imageUrl: notification.image }),
        },
      },
      // iOS-specific configuration
      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
      webpush: {
        // For web, we control display via service worker
        fcmOptions: {
          link: data.link || '/',
        },
        headers: {
          Urgency: data.urgency || 'high',
          TTL: '86400', // 24 hours
        },
      },
    };

    console.log(`📤 Sending notification: "${notification.title}" to token: ${fcmToken.substring(0, 20)}...`);
    console.log('📦 Data Payload:', JSON.stringify(stringifiedData, null, 2));
    
    const response = await messaging.send(message);
    console.log('✅ Notification sent successfully:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Error sending notification:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', error.errorInfo);
    return { success: false, error: error.message, code: error.code };
  }
};

/**
 * Send notification to user by userId (Multi-device support)
 */
const sendToUser = async (userId, notification, data = {}) => {
  try {
    console.log('🔔 sendToUser called with userId:', userId);
    console.log('📋 Notification:', { title: notification.title, body: notification.body?.substring(0, 50) + '...' });
    
    // Check if Firebase is initialized
    const messaging = getMessaging();
    if (!messaging) {
      console.log('⚠️ Firebase messaging not available, skipping user notification');
      return { success: false, error: 'Firebase messaging not initialized' };
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmTokens: true, name: true, email: true },
    });

    if (!user) {
      console.log(`❌ User ${userId} not found`);
      return { success: false, error: 'User not found' };
    }

    console.log(`✅ User found: ${user.name} (${user.email})`);

    const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
    console.log(`📱 User has ${tokens.length} FCM token(s)`);

    if (tokens.length === 0) {
      console.log(`⚠️ User ${user.name} has no FCM tokens`);
      return { success: false, error: 'User has no FCM tokens' };
    }

    console.log(`📤 Sending notification to user: ${user.name} (${user.email}) - ${tokens.length} device(s)`);
    console.log('📱 Devices:', tokens.map(t => ({ device: t.device, lastUsed: t.lastUsed })));

    // Send to all devices
    const results = await Promise.allSettled(
      tokens.map((tokenObj, index) => {
        console.log(`📤 Sending to device ${index + 1}/${tokens.length}: ${tokenObj.device}`);
        return sendToDevice(tokenObj.token, notification, data);
      })
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failedTokens = [];

    // Collect failed tokens for cleanup
    results.forEach((result, index) => {
      if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
        failedTokens.push(tokens[index].token);
        console.log(`❌ Failed to send to device ${index + 1}: ${tokens[index].device}`);
        if (result.status === 'rejected') {
          console.error('Rejection reason:', result.reason);
        } else if (result.value) {
          console.error('Failure reason:', result.value.error);
        }
      } else {
        console.log(`✅ Successfully sent to device ${index + 1}: ${tokens[index].device}`);
      }
    });

    // Remove invalid tokens from database
    if (failedTokens.length > 0) {
      const validTokens = tokens.filter(t => !failedTokens.includes(t.token));
      await prisma.user.update({
        where: { id: userId },
        data: { fcmTokens: validTokens },
      });
      console.log(`🧹 Cleaned up ${failedTokens.length} invalid token(s) for user ${user.name}`);
    }

    console.log(`✅ Sent to ${successCount}/${tokens.length} device(s) for user ${user.name}`);

    return { success: true, sent: successCount, total: tokens.length };
  } catch (error) {
    console.error('❌ Error sending notification to user:', error.message);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
};

/**
 * Send notification to admin by adminId (Multi-device support)
 */
const sendToAdmin = async (adminId, notification, data = {}) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { fcmTokens: true, name: true, email: true },
    });

    if (!admin) {
      console.log(`⚠️ Admin ${adminId} not found`);
      return { success: false, error: 'Admin not found' };
    }

    const tokens = Array.isArray(admin.fcmTokens) ? admin.fcmTokens : [];

    if (tokens.length === 0) {
      console.log(`⚠️ Admin ${admin.name} has no FCM tokens`);
      return { success: false, error: 'Admin has no FCM tokens' };
    }

    console.log(`📤 Sending notification to admin: ${admin.name} (${admin.email}) - ${tokens.length} device(s)`);

    // Send to all devices
    const results = await Promise.allSettled(
      tokens.map((tokenObj) => sendToDevice(tokenObj.token, notification, data))
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failedTokens = [];

    // Collect failed tokens for cleanup
    results.forEach((result, index) => {
      if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
        failedTokens.push(tokens[index].token);
      }
    });

    // Remove invalid tokens from database
    if (failedTokens.length > 0) {
      const validTokens = tokens.filter(t => !failedTokens.includes(t.token));
      await prisma.admin.update({
        where: { id: adminId },
        data: { fcmTokens: validTokens },
      });
      console.log(`🧹 Cleaned up ${failedTokens.length} invalid token(s) for admin ${admin.name}`);
    }

    console.log(`✅ Sent to ${successCount}/${tokens.length} device(s) for admin ${admin.name}`);

    return { success: true, sent: successCount, total: tokens.length };
  } catch (error) {
    console.error('❌ Error sending notification to admin:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send notification to all admins (Multi-device support)
 * ✅ FIXED: Deduplicate tokens to prevent sending same notification multiple times
 */
const sendToAllAdmins = async (notification, data = {}) => {
  try {
    console.log('🔔 sendToAllAdmins called with:', { title: notification.title, dataType: data.type });
    
    // Check if Firebase is initialized
    const messaging = getMessaging();
    if (!messaging) {
      console.log('⚠️ Firebase messaging not available, skipping admin notifications');
      return { success: false, error: 'Firebase messaging not initialized' };
    }
    
    const admins = await prisma.admin.findMany({
      where: {
        isActive: true,
      },
      select: { id: true, fcmTokens: true, name: true, email: true },
    });

    console.log(`📊 Found ${admins.length} active admin(s)`);

    if (admins.length === 0) {
      console.log('⚠️ No active admins found');
      return { success: false, error: 'No active admins' };
    }

    // ✅ FIX: Collect all tokens and DEDUPLICATE to prevent sending to same device multiple times
    const allTokens = [];
    const seenTokens = new Set(); // Track tokens we've already added
    
    admins.forEach(admin => {
      const tokens = Array.isArray(admin.fcmTokens) ? admin.fcmTokens : [];
      console.log(`👤 Admin: ${admin.name} (${admin.email}) has ${tokens.length} device(s)`);
      tokens.forEach(tokenObj => {
        // ✅ Only add token if we haven't seen it before
        if (!seenTokens.has(tokenObj.token)) {
          seenTokens.add(tokenObj.token);
          allTokens.push({
            adminId: admin.id,
            adminName: admin.name,
            token: tokenObj.token,
            device: tokenObj.device,
          });
        } else {
          console.log(`⚠️ Skipping duplicate token for ${admin.name} - ${tokenObj.device}`);
        }
      });
    });

    if (allTokens.length === 0) {
      console.log('⚠️ No admins with FCM tokens found');
      return { success: false, error: 'No admins with FCM tokens' };
    }

    console.log(`📤 Sending notification to ${admins.length} admin(s) across ${allTokens.length} unique device(s)`);
    console.log(`📱 Devices:`, allTokens.map(t => `${t.adminName} - ${t.device}`));

    const results = await Promise.allSettled(
      allTokens.map((item) => sendToDevice(item.token, notification, data))
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = results.length - successCount;
    
    console.log(`📊 Notification results: ${successCount} success, ${failedCount} failed`);
    
    // Cleanup invalid tokens per admin
    const failedTokensByAdmin = {};
    results.forEach((result, index) => {
      if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
        const adminId = allTokens[index].adminId;
        if (!failedTokensByAdmin[adminId]) {
          failedTokensByAdmin[adminId] = [];
        }
        failedTokensByAdmin[adminId].push(allTokens[index].token);
        console.log(`❌ Failed to send to ${allTokens[index].adminName} - ${allTokens[index].device}`);
      } else {
        console.log(`✅ Sent to ${allTokens[index].adminName} - ${allTokens[index].device}`);
      }
    });

    // Remove invalid tokens from each admin
    for (const [adminId, failedTokens] of Object.entries(failedTokensByAdmin)) {
      const admin = admins.find(a => a.id === adminId);
      if (admin) {
        const tokens = Array.isArray(admin.fcmTokens) ? admin.fcmTokens : [];
        const validTokens = tokens.filter(t => !failedTokens.includes(t.token));
        await prisma.admin.update({
          where: { id: adminId },
          data: { fcmTokens: validTokens },
        });
        console.log(`🧹 Cleaned up ${failedTokens.length} invalid token(s) for admin ${admin.name}`);
      }
    }

    console.log(`✅ Sent to ${successCount}/${allTokens.length} device(s) across ${admins.length} admin(s)`);

    return { success: true, sent: successCount, total: allTokens.length, admins: admins.length };
  } catch (error) {
    console.error('❌ Error sending notification to admins:', error.message);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
};

/**
 * Send low stock or out of stock alert to all admins
 */
const sendLowStockAlert = async (itemName, currentStock, alertLevel, warehouseName, uom) => {
  // Determine if it's out of stock or low stock
  const isOutOfStock = currentStock === 0;
  
  const formattedStock = formatSmartUOMDisplay(currentStock, uom);
  const formattedAlertLevel = formatSmartUOMDisplay(alertLevel, uom);

  const notification = {
    title: isOutOfStock ? 'Product Out of Stock' : 'Low Stock Alert',
    body: isOutOfStock 
      ? `${itemName} is currently out of stock.\n\nCurrent Stock: ${formattedStock}\nAlert Level: ${formattedAlertLevel}\nWarehouse: ${warehouseName}\n\nImmediate restocking required for your cosmetics inventory.`
      : `${itemName} stock is running low.\n\nCurrent Stock: ${formattedStock}\nAlert Level: ${formattedAlertLevel}\nWarehouse: ${warehouseName}\n\nPlease restock your luxury beauty collection.`,
  };

  const data = {
    type: isOutOfStock ? 'OUT_OF_STOCK' : 'LOW_STOCK',
    itemName,
    currentStock: currentStock.toString(),
    formattedStock,
    alertLevel: alertLevel.toString(),
    formattedAlertLevel,
    warehouse: warehouseName,
    warehouseRaw: warehouseName.replace(/\s+/g, '-'),
    link: '/dashboard/inventory-management',
    urgency: 'high',
    vibrate: isOutOfStock ? [400, 100, 400, 100, 400, 100, 400] : [300, 100, 300, 100, 300],
    requireInteraction: true,
    color: isOutOfStock ? '#c49a3c' : '#d4af47',
    backgroundColor: isOutOfStock ? '#faf7f4' : '#f8f5f0',
    actions: [
      {
        action: 'view',
        title: 'View Inventory',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToAllAdmins(notification, data);
};

/**
 * Send order status update to user
 */
const sendOrderStatusUpdate = async (userId, orderNumber, status, statusMessage) => {
  console.log('🔔 sendOrderStatusUpdate called with:', { userId, orderNumber, status });
  
  const statusColors = {
    pending: '#d4af47',
    confirmed: '#c49a3c',
    packing: '#b8903a',
    shipped: '#9C27B0',
    delivered: '#c49a3c',
    cancelled: '#6b5040',
  };

  const statusBackgrounds = {
    pending: '#faf7f4',
    confirmed: '#f8f5f0',
    packing: '#f6f3ee',
    shipped: '#F3E5F5',
    delivered: '#faf7f4',
    cancelled: '#f0ebe6',
  };

  const notification = {
    title: `Order ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    body: statusMessage || `Your luxury cosmetics order ${orderNumber} is now ${status}.\n\nTrack your beauty essentials for real-time updates.`,
  };

  const data = {
    type: 'ORDER_UPDATE',
    orderNumber,
    status,
    color: statusColors[status],
    backgroundColor: statusBackgrounds[status],
    link: `/my-orders/${orderNumber}`,
    urgency: status === 'delivered' ? 'high' : 'normal',
    vibrate: status === 'delivered' ? [200, 100, 200, 100, 200] : [200, 100, 200],
    requireInteraction: status === 'delivered' || status === 'cancelled',
    actions: [
      {
        action: 'view',
        title: 'Track Order',
      },
      {
        action: 'dismiss',
        title: 'Close',
      },
    ],
  };

  console.log('📤 Calling sendToUser with userId:', userId);
  const result = await sendToUser(userId, notification, data);
  console.log('📊 sendToUser result:', result);
  
  return result;
};

/**
 * Send order placed confirmation to user
 */
const sendOrderPlacedNotification = async (userId, orderNumber, total) => {
  const notification = {
    title: 'Order Placed Successfully',
    body: `Thank you for choosing our luxury cosmetics collection.\n\nOrder Amount: ₹${total.toFixed(2)}\nOrder Number: ${orderNumber}\n\nWe will notify you once your beauty essentials are confirmed.`,
  };

  const data = {
    type: 'ORDER_PLACED',
    orderNumber,
    total: total.toString(),
    link: `/my-orders/${orderNumber}`,
    urgency: 'high',
    vibrate: [200, 100, 200, 100, 200, 100, 200],
    requireInteraction: true,
    color: '#c49a3c',
    backgroundColor: '#faf7f4',
    actions: [
      {
        action: 'view',
        title: 'View Order',
      },
      {
        action: 'share',
        title: 'Share',
      },
    ],
  };

  return await sendToUser(userId, notification, data);
};

/**
 * Send new user registration notification to all admins
 */
const sendNewUserRegistrationAlert = async (userName, userEmail, customerId) => {
  const notification = {
    title: 'New Customer Registration',
    body: `${userName} has joined your luxury cosmetics platform.\n\nEmail: ${userEmail}\n\nA new customer has discovered your premium beauty collection. Review their profile for personalized service.`,
  };

  const data = {
    type: 'NEW_USER_REGISTRATION',
    userName,
    userEmail,
    customerId: customerId || '',
    link: customerId 
      ? `/dashboard/customer-management/view/${customerId}` 
      : '/dashboard/customer-management',
    urgency: 'normal',
    vibrate: [200, 100, 200],
    requireInteraction: false,
    color: '#c49a3c',
    backgroundColor: '#faf7f4',
    actions: [
      {
        action: 'view',
        title: 'View Profile',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToAllAdmins(notification, data);
};

/**
 * Send welcome notification to newly registered user
 */
const sendWelcomeNotification = async (userId, userName) => {
  const notification = {
    title: 'Welcome to Luxury Cosmetics',
    body: `Hello ${userName},\n\nThank you for joining our exclusive beauty community. We are delighted to have you with us.\n\nDiscover premium cosmetics\nExplore exclusive beauty collections\nTrack your orders seamlessly\n\nYour luxury beauty journey begins now.`,
  };

  const data = {
    type: 'WELCOME',
    userName,
    link: '/',
    urgency: 'normal',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    color: '#c49a3c',
    backgroundColor: '#faf7f4',
    actions: [
      {
        action: 'view',
        title: 'Start Shopping',
      },
      {
        action: 'dismiss',
        title: 'Close',
      },
    ],
  };

  return await sendToUser(userId, notification, data);
};

/**
 * Send expiring product alert to all admins
 */
const sendExpiringProductAlert = async (itemName, expiryDate, daysUntilExpiry, warehouseName, itemId) => {
  // Determine urgency based on days until expiry
  const isUrgent = daysUntilExpiry <= 7;
  const isCritical = daysUntilExpiry <= 3;
  
  // Format expiry date
  const formattedDate = new Date(expiryDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  
  const notification = {
    title: isCritical ? 'Critical Product Expiry' : isUrgent ? 'Urgent Product Expiry' : 'Product Expiry Alert',
    body: isCritical 
      ? `${itemName} expires in ${daysUntilExpiry} day(s).\n\nExpiry Date: ${formattedDate}\nWarehouse: ${warehouseName}\n\nImmediate action required for your cosmetics inventory.`
      : `${itemName} expires in ${daysUntilExpiry} day(s).\n\nExpiry Date: ${formattedDate}\nWarehouse: ${warehouseName}\n\nPlease take action to preserve your luxury cosmetics.`,
  };

  const data = {
    type: isCritical ? 'CRITICAL_EXPIRY' : isUrgent ? 'URGENT_EXPIRY' : 'EXPIRY_WARNING',
    itemName,
    itemId: itemId || '',
    expiryDate: formattedDate,
    expiryDateRaw: new Date(expiryDate).toISOString().split('T')[0],
    daysUntilExpiry: daysUntilExpiry.toString(),
    warehouse: warehouseName,
    link: '/dashboard/inventory-management',
    urgency: isCritical ? 'high' : 'normal',
    vibrate: isCritical ? [400, 100, 400, 100, 400, 100, 400] : [300, 100, 300, 100, 300],
    requireInteraction: isCritical || isUrgent,
    color: isCritical ? '#c49a3c' : isUrgent ? '#d4af47' : '#e8ddd0',
    backgroundColor: isCritical ? '#faf7f4' : isUrgent ? '#f8f5f0' : '#f6f3ee',
    actions: [
      {
        action: 'view',
        title: 'View Item',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToAllAdmins(notification, data);
};

/**
 * Send daily expiry summary to all admins
 */
const sendDailyExpirySummary = async (expirySummary) => {
  const { critical, urgent, total } = expirySummary;
  
  if (total === 0) {
    console.log('No expiring cosmetics products - no summary needed');
    return { success: true, message: 'No expiring cosmetics products' };
  }

  let summaryBody = `Daily Cosmetics Expiry Report (Next 7 Days)\n\n`;
  summaryBody += `Critical (≤3 days): ${critical} cosmetics items\n`;
  summaryBody += `Urgent (4-7 days): ${urgent} cosmetics items\n`;
  summaryBody += `Total Expiring: ${total} cosmetics items\n\n`;
  
  if (critical > 0) {
    summaryBody += `Immediate action required for ${critical} luxury cosmetic item(s).`;
  } else if (urgent > 0) {
    summaryBody += `Please review ${urgent} urgent cosmetics item(s).`;
  } else {
    summaryBody += `All cosmetics products under control.`;
  }

  const notification = {
    title: critical > 0 ? 'Critical Cosmetics Expiry Alert' : 'Daily Cosmetics Expiry Summary',
    body: summaryBody,
  };

  const data = {
    type: 'DAILY_EXPIRY_SUMMARY',
    criticalCount: critical.toString(),
    urgentCount: urgent.toString(),
    totalCount: total.toString(),
    link: '/dashboard/inventory-management',
    urgency: critical > 0 ? 'high' : 'normal',
    vibrate: [200, 100, 200],
    requireInteraction: critical > 0,
    color: critical > 0 ? '#c49a3c' : urgent > 0 ? '#d4af47' : '#e8ddd0',
    backgroundColor: critical > 0 ? '#faf7f4' : urgent > 0 ? '#f8f5f0' : '#f6f3ee',
    actions: [
      {
        action: 'view',
        title: 'View Inventory',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToAllAdmins(notification, data);
};

/**
 * Send notification to all devices of a specific user or admin
 * @param {string} userId - User or Admin ID
 * @param {string} userType - 'user' or 'admin'
 * @param {object} notification - Notification payload
 * @param {object} data - Additional data payload
 */
const sendToAllDevices = async (userId, userType, notification, data = {}) => {
  try {
    console.log(`🔔 sendToAllDevices called for ${userType}:`, userId);
    console.log('📋 Notification:', { title: notification.title, body: notification.body?.substring(0, 50) + '...' });

    if (!['user', 'admin'].includes(userType)) {
      console.error('❌ Invalid userType. Must be "user" or "admin"');
      return { success: false, error: 'Invalid userType' };
    }

    // Fetch user or admin based on type
    const entity = userType === 'user'
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { fcmTokens: true, name: true, email: true },
        })
      : await prisma.admin.findUnique({
          where: { id: userId },
          select: { fcmTokens: true, name: true, email: true },
        });

    if (!entity) {
      console.log(`❌ ${userType} ${userId} not found`);
      return { success: false, error: `${userType} not found` };
    }

    console.log(`✅ ${userType} found: ${entity.name} (${entity.email})`);

    const tokens = Array.isArray(entity.fcmTokens) ? entity.fcmTokens : [];
    console.log(`📱 ${userType} has ${tokens.length} FCM token(s)`);

    if (tokens.length === 0) {
      console.log(`⚠️ ${userType} ${entity.name} has no FCM tokens`);
      return { success: false, error: `${userType} has no FCM tokens` };
    }

    console.log(`📤 Sending notification to ${userType}: ${entity.name} (${entity.email}) - ${tokens.length} device(s)`);
    console.log('📱 Devices:', tokens.map(t => ({ device: t.device, lastUsed: t.lastUsed })));

    // Send to all devices
    const results = await Promise.allSettled(
      tokens.map((tokenObj, index) => {
        console.log(`📤 Sending to device ${index + 1}/${tokens.length}: ${tokenObj.device}`);
        return sendToDevice(tokenObj.token, notification, data);
      })
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failedTokens = [];

    // Collect failed tokens for cleanup
    results.forEach((result, index) => {
      if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
        failedTokens.push(tokens[index].token);
        console.log(`❌ Failed to send to device ${index + 1}: ${tokens[index].device}`);
        if (result.status === 'rejected') {
          console.error('Rejection reason:', result.reason);
        } else if (result.value) {
          console.error('Failure reason:', result.value.error);
        }
      } else {
        console.log(`✅ Successfully sent to device ${index + 1}: ${tokens[index].device}`);
      }
    });

    // Remove invalid tokens from database
    if (failedTokens.length > 0) {
      const validTokens = tokens.filter(t => !failedTokens.includes(t.token));
      
      if (userType === 'user') {
        await prisma.user.update({
          where: { id: userId },
          data: { fcmTokens: validTokens },
        });
      } else {
        await prisma.admin.update({
          where: { id: userId },
          data: { fcmTokens: validTokens },
        });
      }
      
      console.log(`🧹 Cleaned up ${failedTokens.length} invalid token(s) for ${userType} ${entity.name}`);
    }

    console.log(`✅ Sent to ${successCount}/${tokens.length} device(s) for ${userType} ${entity.name}`);

    return { success: true, sent: successCount, total: tokens.length };
  } catch (error) {
    console.error(`❌ Error sending notification to all devices of ${userType}:`, error.message);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
};

/**
 * Send notification to all users (Multi-device support)
 * Sends to ALL active users across ALL their devices
 */
const sendToAllUsers = async (notification, data = {}) => {
  try {
    console.log('🔔 sendToAllUsers called with:', { title: notification.title, dataType: data.type });
    
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
      },
      select: { id: true, fcmTokens: true, name: true, email: true },
    });

    console.log(`📊 Found ${users.length} active user(s)`);

    if (users.length === 0) {
      console.log('⚠️ No active users found');
      return { success: false, error: 'No active users' };
    }

    // Collect all tokens from all users
    const allTokens = [];
    users.forEach(user => {
      const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
      console.log(`👤 User: ${user.name} (${user.email}) has ${tokens.length} device(s)`);
      tokens.forEach(tokenObj => {
        allTokens.push({
          userId: user.id,
          userName: user.name,
          token: tokenObj.token,
          device: tokenObj.device,
        });
      });
    });

    if (allTokens.length === 0) {
      console.log('⚠️ No users with FCM tokens found');
      return { success: false, error: 'No users with FCM tokens' };
    }

    console.log(`📤 Sending notification to ${users.length} user(s) across ${allTokens.length} device(s)`);
    console.log(`📱 Devices:`, allTokens.map(t => `${t.userName} - ${t.device}`));

    const results = await Promise.allSettled(
      allTokens.map((item) => sendToDevice(item.token, notification, data))
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = results.length - successCount;
    
    console.log(`📊 Notification results: ${successCount} success, ${failedCount} failed`);
    
    // Cleanup invalid tokens per user
    const failedTokensByUser = {};
    results.forEach((result, index) => {
      if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
        const userId = allTokens[index].userId;
        if (!failedTokensByUser[userId]) {
          failedTokensByUser[userId] = [];
        }
        failedTokensByUser[userId].push(allTokens[index].token);
        console.log(`❌ Failed to send to ${allTokens[index].userName} - ${allTokens[index].device}`);
      } else {
        console.log(`✅ Sent to ${allTokens[index].userName} - ${allTokens[index].device}`);
      }
    });

    // Remove invalid tokens from each user
    for (const [userId, failedTokens] of Object.entries(failedTokensByUser)) {
      const user = users.find(u => u.id === userId);
      if (user) {
        const tokens = Array.isArray(user.fcmTokens) ? user.fcmTokens : [];
        const validTokens = tokens.filter(t => !failedTokens.includes(t.token));
        await prisma.user.update({
          where: { id: userId },
          data: { fcmTokens: validTokens },
        });
        console.log(`🧹 Cleaned up ${failedTokens.length} invalid token(s) for user ${user.name}`);
      }
    }

    console.log(`✅ Sent to ${successCount}/${allTokens.length} device(s) across ${users.length} user(s)`);

    return { success: true, sent: successCount, total: allTokens.length, users: users.length };
  } catch (error) {
    console.error('❌ Error sending notification to all users:', error.message);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
};

/**
 * Send wishlist price drop alert to user
 */
const sendPriceDropAlert = async (userId, productName, oldPrice, newPrice, productId) => {
  const savings = oldPrice - newPrice;
  
  const notification = {
    title: 'Price Drop Alert',
    body: `${productName} is now ₹${newPrice.toFixed(2)} (was ₹${oldPrice.toFixed(2)})\n\nSave ₹${savings.toFixed(2)} on your favorite cosmetics product.`,
  };

  const data = {
    type: 'PRICE_DROP',
    productName,
    oldPrice: oldPrice.toString(),
    newPrice: newPrice.toString(),
    savings: savings.toString(),
    productId: productId || '',
    link: `/products/${productId}`,
    urgency: 'normal',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    color: '#c49a3c',
    backgroundColor: '#faf7f4',
    actions: [
      {
        action: 'view',
        title: 'View Product',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToUser(userId, notification, data);
};

/**
 * Send back in stock alert to user
 */
const sendBackInStockAlert = async (userId, productName, stockQuantity, productId, uom) => {
  const formattedStock = formatSmartUOMDisplay(stockQuantity, uom);

  const notification = {
    title: 'Product Back in Stock',
    body: `${productName} is available again.\n\nOnly ${formattedStock} left in our luxury collection.`,
  };

  const data = {
    type: 'BACK_IN_STOCK',
    productName,
    stockQuantity: stockQuantity.toString(),
    productId: productId || '',
    link: `/products/${productId}`,
    urgency: 'high',
    vibrate: [200, 100, 200, 100, 200, 100, 200],
    requireInteraction: true,
    color: '#c49a3c',
    backgroundColor: '#faf7f4',
    actions: [
      {
        action: 'view',
        title: 'View Product',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToUser(userId, notification, data);
};

/**
 * Send abandoned cart reminder to user
 */
const sendAbandonedCartReminder = async (userId, itemCount, cartValue, savings, reminderType = '1hour') => {
  let title, body;
  
  switch (reminderType) {
    case '1hour':
      title = 'Cart Reminder';
      body = `You have ${itemCount} luxury cosmetics items waiting in your cart. Complete your order now.`;
      break;
    case '24hours':
      title = 'Your Cart is Waiting';
      body = `${itemCount} premium cosmetics items in cart worth ₹${cartValue.toFixed(2)}. Some luxury products may go out of stock.`;
      break;
    case '3days':
      title = 'Complete Your Purchase';
      body = `Your cart has ${itemCount} cosmetics essentials. Complete checkout and save ₹${savings.toFixed(2)} on luxury cosmetics.`;
      break;
    default:
      title = 'Cart Reminder';
      body = `You have ${itemCount} luxury cosmetics items in your cart worth ₹${cartValue.toFixed(2)}.`;
  }

  const notification = {
    title,
    body,
  };

  const data = {
    type: 'ABANDONED_CART',
    reminderType,
    itemCount: itemCount.toString(),
    cartValue: cartValue.toString(),
    savings: savings.toString(),
    link: '/cart',
    urgency: reminderType === '3days' ? 'high' : 'normal',
    vibrate: [200, 100, 200],
    requireInteraction: reminderType === '3days',
    color: reminderType === '3days' ? '#c49a3c' : '#d4af47',
    backgroundColor: reminderType === '3days' ? '#faf7f4' : '#f8f5f0',
    actions: [
      {
        action: 'view',
        title: 'View Cart',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToUser(userId, notification, data);
};

/**
 * Send order out for delivery notification
 */
const sendOutForDeliveryNotification = async (userId, orderNumber, partnerName, partnerPhone, estimatedTime) => {
  const notification = {
    title: 'Order Out for Delivery',
    body: `${partnerName} is delivering your luxury cosmetics order ${orderNumber}.\n\nTrack your cosmetics essentials in real-time.`,
  };

  const data = {
    type: 'OUT_FOR_DELIVERY',
    orderNumber,
    partnerName,
    partnerPhone: partnerPhone || '',
    estimatedTime: estimatedTime || '',
    link: `/my-orders/${orderNumber}`,
    urgency: 'high',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    color: '#c49a3c',
    backgroundColor: '#faf7f4',
    actions: [
      {
        action: 'view',
        title: 'Track Order',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  return await sendToUser(userId, notification, data);
};

/**
 * Send notification to a single device (for delivery partners)
 * Uses delivery Firebase project
 */
const sendToDeliveryDevice = async (fcmToken, notification, data = {}) => {
  try {
    if (!fcmToken) {
      console.log('⚠️ No FCM token provided');
      return { success: false, error: 'No FCM token' };
    }

    const messaging = getDeliveryMessaging();
    
    if (!messaging) {
      console.log('⚠️ Delivery Firebase messaging not initialized');
      return { success: false, error: 'Delivery Firebase messaging not initialized' };
    }
    
    // Get company logo
    const logoUrl = await getCompanyLogo();
    console.log('📷 Using logo URL for notification:', logoUrl);
    
    // Convert all data values to strings (FCM requirement)
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object') {
        stringifiedData[key] = JSON.stringify(value);
      } else {
        stringifiedData[key] = String(value);
      }
    }
    
    // Add title, body, and image to data payload
    stringifiedData.notifTitle = notification.title;
    stringifiedData.notifBody = notification.body;
    stringifiedData.title = notification.title;
    stringifiedData.body = notification.body;
    if (notification.image) {
      stringifiedData.notifImage = notification.image;
      stringifiedData.image = notification.image;
    }
    
    // Add logo URL to data
    stringifiedData.logoUrl = logoUrl;
    stringifiedData.notificationType = data.type || 'general';
    
    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.image && { image: notification.image }),
      },
      data: stringifiedData,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high',
          sound: 'default',
          ...(notification.image && { imageUrl: notification.image }),
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    console.log(`📤 Sending notification: "${notification.title}" to token: ${fcmToken.substring(0, 20)}...`);
    console.log('📦 Data Payload:', JSON.stringify(stringifiedData, null, 2));
    
    const response = await messaging.send(message);
    console.log('✅ Notification sent successfully:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Error sending notification:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', error.errorInfo);
    return { success: false, error: error.message, code: error.code };
  }
};

/**
 * Send notification to delivery partner
 * @param {string} partnerId - Partner ID
 * @param {object} notification - Notification payload
 * @param {object} data - Additional data payload
 */
const sendToPartner = async (partnerId, notification, data = {}) => {
  try {
    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: partnerId },
      select: { fcmTokens: true, name: true, email: true },
    });

    if (!partner) {
      console.log(`⚠️ Partner ${partnerId} not found`);
      return { success: false, error: 'Partner not found' };
    }

    const tokens = Array.isArray(partner.fcmTokens) ? partner.fcmTokens : [];

    if (tokens.length === 0) {
      console.log(`⚠️ Partner ${partner.name} has no FCM tokens`);
      return { success: false, error: 'Partner has no FCM tokens' };
    }

    console.log(`📤 Sending notification to partner: ${partner.name} (${partner.email}) - ${tokens.length} device(s)`);

    // Send to all devices using delivery Firebase
    const results = await Promise.allSettled(
      tokens.map((tokenObj) => sendToDeliveryDevice(tokenObj.token, notification, data))
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failedTokens = [];

    // Collect failed tokens for cleanup
    results.forEach((result, index) => {
      if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
        failedTokens.push(tokens[index].token);
      }
    });

    // Remove invalid tokens from database
    if (failedTokens.length > 0) {
      const validTokens = tokens.filter(t => !failedTokens.includes(t.token));
      await prisma.deliveryPartner.update({
        where: { id: partnerId },
        data: { fcmTokens: validTokens },
      });
      console.log(`🧹 Cleaned up ${failedTokens.length} invalid token(s) for partner ${partner.name}`);
    }

    console.log(`✅ Sent to ${successCount}/${tokens.length} device(s) for partner ${partner.name}`);

    return { success: true, sent: successCount, total: tokens.length };
  } catch (error) {
    console.error('❌ Error sending notification to partner:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendToDevice,
  sendToUser,
  sendToAdmin,
  sendToPartner,
  sendToAllAdmins,
  sendToAllUsers,
  sendToAllDevices,
  sendLowStockAlert,
  sendOrderStatusUpdate,
  sendOrderPlacedNotification,
  sendNewUserRegistrationAlert,
  sendWelcomeNotification,
  sendExpiringProductAlert,
  sendDailyExpirySummary,
  // New notifications
  sendPriceDropAlert,
  sendBackInStockAlert,
  sendAbandonedCartReminder,
  sendOutForDeliveryNotification,
};
