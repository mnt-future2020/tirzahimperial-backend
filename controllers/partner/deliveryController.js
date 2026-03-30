const { prisma } = require("../../config/database");

/**
 * Get all assigned deliveries for a partner
 */
const getAssignedDeliveries = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      deliveryPartnerId: partnerId,
    };

    if (status && status !== 'all') {
      where.orderStatus = status;
    }

    const totalCount = await prisma.onlineOrder.count({ where });

    const orders = await prisma.onlineOrder.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        orderType: true,
        scheduledDate: true,
        scheduledSlot: true,
        isScheduled: true,
        customerName: true,
        customerPhone: true,
        deliveryAddress: true,
        items: true,
        total: true,
        orderStatus: true,
        paymentMethod: true,
        paymentStatus: true,
        createdAt: true,
        deliveryAssignAt: true,
        deliveryPickedAt: true,
        estimatedDeliveryTime: true,
        deliveryNotes: true,
      },
    });

    res.json({
      success: true,
      data: orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
      },
    });
  } catch (error) {
    console.error("Error fetching deliveries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deliveries",
      error: error.message,
    });
  }
};

/**
 * Get single delivery details
 */
const getDeliveryDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const partnerId = req.user.id;

    const order = await prisma.onlineOrder.findFirst({
      where: {
        id,
        deliveryPartnerId: partnerId,
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Error fetching delivery details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch delivery details",
      error: error.message,
    });
  }
};

/**
 * Update delivery status
 */
const updateDeliveryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, latitude, longitude, paymentMethod, paymentStatus } = req.body;
    const partnerId = req.user.id;

    const validStatuses = ['confirmed', 'packing', 'shipped', 'delivered', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const order = await prisma.onlineOrder.findFirst({
      where: {
        id,
        deliveryPartnerId: partnerId,
      },
      include: {
        deliveryPartner: {
          select: {
            name: true,
            phone: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const updateData = {
      orderStatus: status,
    };

    // Update payment method and status if provided (for COD deliveries)
    if (paymentMethod) {
      updateData.paymentMethod = paymentMethod;
    }
    if (paymentStatus) {
      updateData.paymentStatus = paymentStatus;
    }

    // Track timestamps for each status change
    switch (status) {
      case 'packing':
        updateData.deliveryAcceptedAt = new Date(); // Partner accepted
        break;
      case 'shipped':
        updateData.deliveryPickedAt = new Date(); // Partner picked up
        updateData.shippedAt = new Date();
        break;
      case 'delivered':
        updateData.deliveredAt = new Date();
        
        // Update partner stats
        await prisma.deliveryPartner.update({
          where: { id: partnerId },
          data: {
            totalDeliveries: { increment: 1 },
            todayDeliveries: { increment: 1 },
            weeklyDeliveries: { increment: 1 },
            monthlyDeliveries: { increment: 1 },
          },
        });
        break;
    }

    const updatedOrder = await prisma.onlineOrder.update({
      where: { id },
      data: updateData,
    });

    // Create tracking record
    await prisma.deliveryTracking.create({
      data: {
        orderId: id,
        status: status,
        latitude: latitude || null,
        longitude: longitude || null,
        notes: notes || null,
      },
    });

    // TODO: Enable real-time socket events in future
    // // Emit socket events for real-time updates
    // try {
    //   const { sendToOrder, sendToAdmin, sendToCustomer } = require('../../utils/socket/socketHandler');
    //   
    //   // Broadcast to order room for real-time tracking
    //   sendToOrder(id, 'delivery:update', {
    //     orderId: id,
    //     status: status,
    //     timestamp: new Date(),
    //     latitude,
    //     longitude,
    //   });

    //   // Notify admin dashboard
    //   sendToAdmin('delivery_update', {
    //     orderId: id,
    //     orderNumber: order.orderNumber,
    //     status: status,
    //     partnerId: partnerId,
    //     timestamp: new Date(),
    //   });

    //   // Notify customer
    //   if (order.userId) {
    //     sendToCustomer(order.userId, {
    //       type: 'order_update',
    //       orderId: id,
    //       orderNumber: order.orderNumber,
    //       status: status,
    //     });
    //   }

    //   // If location is provided, broadcast partner location to order room
    //   if (latitude && longitude) {
    //     sendToOrder(id, 'partner:location', {
    //       partnerId: partnerId,
    //       latitude: parseFloat(latitude),
    //       longitude: parseFloat(longitude),
    //       orderId: id,
    //       timestamp: new Date(),
    //     });

    //     // Also broadcast to admin
    //     sendToAdmin('admin:partner-location', {
    //       partnerId: partnerId,
    //       latitude: parseFloat(latitude),
    //       longitude: parseFloat(longitude),
    //       timestamp: new Date(),
    //     });
    //   }
    // } catch (socketError) {
    //   console.error('Socket emission error:', socketError);
    // }

    // Send notifications to admin and customer
    try {
      const { sendToAllAdmins, sendToUser } = require('../../utils/notification/sendNotification');
      
      // Notification messages based on status
      const statusMessages = {
        confirmed: {
          title: 'Order Confirmed',
          body: `Order #${order.orderNumber} has been confirmed by delivery partner`,
          customerBody: `Your order #${order.orderNumber} has been confirmed and will be delivered soon`,
        },
        packing: {
          title: 'Order Being Packed',
          body: `Order #${order.orderNumber} is being packed`,
          customerBody: `Your order #${order.orderNumber} is being prepared for delivery`,
        },
        shipped: {
          title: 'Order Shipped',
          body: `Order #${order.orderNumber} is out for delivery`,
          customerBody: `Your order #${order.orderNumber} is on the way! Delivered by ${order.deliveryPartner?.name}`,
        },
        delivered: {
          title: 'Order Delivered',
          body: `Order #${order.orderNumber} has been delivered successfully${paymentMethod ? ` - Payment: ${paymentMethod.toUpperCase()}` : ''}`,
          customerBody: `Your order #${order.orderNumber} has been delivered. Thank you for shopping with us!`,
        },
        cancelled: {
          title: 'Order Cancelled',
          body: `Order #${order.orderNumber} has been cancelled by delivery partner`,
          customerBody: `Your order #${order.orderNumber} has been cancelled. Please contact support for more details.`,
        },
      };

      const message = statusMessages[status];
      
      if (message) {
        // Send notification to all admins
        await sendToAllAdmins(
          {
            title: message.title,
            body: message.body,
          },
          {
            type: 'ORDER_STATUS_UPDATE',
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: status,
            partnerId: partnerId,
            partnerName: order.deliveryPartner?.name || 'Unknown',
            paymentMethod: paymentMethod || order.paymentMethod,
          }
        );

        // Send notification to customer (if customer has FCM token)
        if (order.userId) {
          await sendToUser(
            order.userId,
            {
              title: message.title,
              body: message.customerBody,
            },
            {
              type: 'ORDER_STATUS_UPDATE',
              orderId: order.id,
              orderNumber: order.orderNumber,
              status: status,
            }
          );
        }

        // Send email notification to customer
        const { sendOrderStatusEmail } = require('../../utils/email/orderEmails');
        await sendOrderStatusEmail(order.customerEmail, {
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          status: status,
          partnerName: order.deliveryPartner?.name,
          partnerPhone: order.deliveryPartner?.phone,
        });
      }
    } catch (notificationError) {
      console.error('Error sending notifications:', notificationError);
      // Don't fail the request if notification fails
    }

    res.json({
      success: true,
      message: `Delivery status updated to ${status}${paymentMethod ? ` with payment method: ${paymentMethod}` : ''}`,
      data: updatedOrder,
    });
  } catch (error) {
    console.error("Error updating delivery status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update delivery status",
      error: error.message,
    });
  }
};

/**
 * Update partner location
 */
const updatePartnerLocation = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { latitude, longitude, orderId } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const partner = await prisma.deliveryPartner.update({
      where: { id: partnerId },
      data: {
        currentLatitude: parseFloat(latitude),
        currentLongitude: parseFloat(longitude),
        lastLocationUpdate: new Date(),
        isOnline: true,
      },
    });

    // TODO: Enable real-time socket events for location updates in future
    // // Emit socket events for real-time location updates
    // try {
    //   const { sendToAdmin } = require('../../utils/socket/socketHandler');
    //   
    //   // Broadcast to admin dashboard
    //   sendToAdmin('admin:partner-location', {
    //     partnerId: partnerId,
    //     latitude: parseFloat(latitude),
    //     longitude: parseFloat(longitude),
    //     timestamp: new Date(),
    //   });

    //   // If orderId is provided, broadcast to specific order room for customer tracking
    //   if (orderId) {
    //     const { sendToOrder } = require('../../utils/socket/socketHandler');
    //     sendToOrder(orderId, 'partner:location', {
    //       partnerId: partnerId,
    //       latitude: parseFloat(latitude),
    //       longitude: parseFloat(longitude),
    //       orderId: orderId,
    //       timestamp: new Date(),
    //     });
    //   }
    // } catch (socketError) {
    //   console.error('Socket emission error:', socketError);
    // }

    res.json({
      success: true,
      message: "Location updated",
      data: {
        latitude: partner.currentLatitude,
        longitude: partner.currentLongitude,
      },
    });
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update location",
      error: error.message,
    });
  }
};

/**
 * Get partner stats
 */
const getPartnerStats = async (req, res) => {
  try {
    const partnerId = req.user.id;

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: partnerId },
      select: {
        todayDeliveries: true,
        weeklyDeliveries: true,
        monthlyDeliveries: true,
        totalDeliveries: true,
        averageRating: true,
        totalRatings: true,
        isAvailable: true,
        isOnline: true,
      },
    });

    // Get assigned orders count (confirmed, packing, shipped)
    const assignedCount = await prisma.onlineOrder.count({
      where: {
        deliveryPartnerId: partnerId,
        orderStatus: { in: ['confirmed', 'packing', 'shipped'] },
      },
    });

    // Get completed orders count (delivered)
    const completedCount = await prisma.onlineOrder.count({
      where: {
        deliveryPartnerId: partnerId,
        orderStatus: 'delivered',
      },
    });

    // Get new orders count (orders assigned but not yet accepted)
    const newOrdersCount = await prisma.onlineOrder.count({
      where: {
        deliveryPartnerId: partnerId,
        orderStatus: 'confirmed', // Orders waiting to be accepted
      },
    });

    res.json({
      success: true,
      data: {
        ...partner,
        assignedOrders: assignedCount,
        completedOrders: completedCount,
        newOrders: newOrdersCount,
        pendingDeliveries: assignedCount, // Backward compatibility
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error: error.message,
    });
  }
};

/**
 * Get partner notifications
 */
const getPartnerNotifications = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { partnerId };
    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const totalCount = await prisma.partnerNotification.count({ where });
    const unreadCount = await prisma.partnerNotification.count({
      where: { partnerId, isRead: false },
    });

    const notifications = await prisma.partnerNotification.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
      },
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};

/**
 * Mark notification as read
 */
const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const partnerId = req.user.id;

    await prisma.partnerNotification.updateMany({
      where: {
        id,
        partnerId,
      },
      data: {
        isRead: true,
      },
    });

    res.json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error.message,
    });
  }
};

/**
 * Toggle partner availability
 */
const toggleAvailability = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { isAvailable } = req.body;

    const partner = await prisma.deliveryPartner.update({
      where: { id: partnerId },
      data: {
        isAvailable: isAvailable !== undefined ? isAvailable : undefined,
      },
      select: {
        isAvailable: true,
        isOnline: true,
      },
    });

    res.json({
      success: true,
      message: `Availability updated to ${partner.isAvailable ? 'available' : 'unavailable'}`,
      data: partner,
    });
  } catch (error) {
    console.error("Error toggling availability:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle availability",
      error: error.message,
    });
  }
};

/**
 * Get available partners (Admin only)
 */
const getAvailablePartners = async (req, res) => {
  try {
    const { city, vehicleType, includeAll } = req.query;

    // Default: get all active partners for tracking (not just available ones)
    const includeAvailableOnly = includeAll !== 'true';

    const where = {
      applicationStatus: 'approved',
      partnerStatus: 'active',
    };

    // Only filter by availability if explicitly requested
    if (includeAvailableOnly) {
      where.isAvailable = true;
    }

    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }
    if (vehicleType) {
      where.vehicleType = vehicleType;
    }

    const partners = await prisma.deliveryPartner.findMany({
      where,
      select: {
        id: true,
        partnerId: true,
        name: true,
        phone: true,
        profilePhoto: true,
        vehicleType: true,
        vehicleNumber: true,
        currentLatitude: true,
        currentLongitude: true,
        isOnline: true,
        lastLocationUpdate: true,
        todayDeliveries: true,
        averageRating: true,
        totalDeliveries: true,
        city: true,
      },
      orderBy: { todayDeliveries: 'asc' },
    });

    res.json({
      success: true,
      data: partners,
    });
  } catch (error) {
    console.error("Error fetching available partners:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch available partners",
      error: error.message,
    });
  }
};

/**
 * Assign delivery partner to order (Admin)
 */
const assignDeliveryPartner = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { deliveryPartnerId, estimatedDeliveryTime, notes } = req.body;

    // Verify order exists
    const order = await prisma.onlineOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // If unassigning (empty deliveryPartnerId)
    if (!deliveryPartnerId || deliveryPartnerId === "") {
      const updatedOrder = await prisma.onlineOrder.update({
        where: { id: orderId },
        data: {
          deliveryPartnerId: null,
          deliveryAssignAt: null,
          estimatedDeliveryTime: null,
          deliveryNotes: null,
        },
        include: {
          deliveryPartner: {
            select: {
              id: true,
              partnerId: true,
              name: true,
              phone: true,
              vehicleType: true,
              vehicleNumber: true,
            }
          }
        }
      });

      return res.json({
        success: true,
        message: "Delivery partner removed successfully",
        data: updatedOrder,
      });
    }

    // Verify partner exists and is available
    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: deliveryPartnerId },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Delivery partner not found",
      });
    }

    if (partner.applicationStatus !== 'approved' || partner.partnerStatus !== 'active') {
      return res.status(400).json({
        success: false,
        message: "Partner is not active",
      });
    }

    const updateData = {
      deliveryPartnerId: deliveryPartnerId,
      deliveryAssignAt: new Date(),
      estimatedDeliveryTime: estimatedDeliveryTime ? new Date(estimatedDeliveryTime) : null,
      deliveryNotes: notes || null,
    };

    const updatedOrder = await prisma.onlineOrder.update({
      where: { id: orderId },
      data: updateData,
      include: {
        deliveryPartner: {
          select: {
            id: true,
            partnerId: true,
            name: true,
            phone: true,
            vehicleType: true,
            vehicleNumber: true,
          }
        }
      }
    });

    // Create notification for partner
    await prisma.partnerNotification.create({
      data: {
        partnerId: deliveryPartnerId,
        type: 'new_delivery',
        title: 'New Delivery Assigned',
        message: `You have been assigned order ${order.orderNumber}`,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          total: order.total,
        },
      },
    });

    // Send push notification
    console.log('\n🔔 [NOTIFICATION] Attempting to send notification to partner');
    console.log(`   Partner ID: ${deliveryPartnerId}`);
    console.log(`   Partner Name: ${partner.name}`);
    console.log(`   Order Number: ${order.orderNumber}`);
    
    const { sendToPartner } = require('../../utils/notification/sendNotification');
    const notificationResult = await sendToPartner(
      deliveryPartnerId,
      {
        title: 'New Delivery Assigned',
        body: `You have been assigned order #${order.orderNumber}`,
      },
      {
        type: 'NEW_DELIVERY',
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        total: order.total.toString(),
      }
    );
    
    console.log('📊 [NOTIFICATION] Result:', JSON.stringify(notificationResult, null, 2));
    
    if (!notificationResult.success) {
      console.error('❌ [NOTIFICATION] Failed to send notification:', notificationResult.error);
    } else {
      console.log(`✅ [NOTIFICATION] Sent to ${notificationResult.sent}/${notificationResult.total} device(s)`);
    }

    res.json({
      success: true,
      message: "Delivery partner assigned successfully",
      data: updatedOrder,
    });
  } catch (error) {
    console.error("Error assigning delivery partner:", error);
    res.status(500).json({
      success: false,
      message: "Failed to assign delivery partner",
      error: error.message,
    });
  }
};

/**
 * Get new delivery requests (orders assigned but not yet accepted)
 */
const getNewRequests = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { limit = 20 } = req.query;

    // Get orders that are assigned to partner but not yet accepted (status = confirmed)
    const requests = await prisma.onlineOrder.findMany({
      where: {
        deliveryPartnerId: partnerId,
        orderStatus: 'confirmed', // Only confirmed orders (not yet accepted)
      },
      take: parseInt(limit),
      orderBy: { deliveryAssignAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        deliveryAddress: true,
        items: true,
        total: true,
        orderStatus: true,
        paymentMethod: true,
        createdAt: true,
        deliveryAssignAt: true,
        estimatedDeliveryTime: true,
        deliveryNotes: true,
      },
    });

    res.json({
      success: true,
      data: requests,
    });
  } catch (error) {
    console.error("Error fetching new requests:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch new requests",
      error: error.message,
    });
  }
};

module.exports = {
  getAssignedDeliveries,
  getDeliveryDetails,
  updateDeliveryStatus,
  updatePartnerLocation,
  getPartnerStats,
  getNewRequests,
  getPartnerNotifications,
  markNotificationRead,
  toggleAvailability,
  getAvailablePartners,
  assignDeliveryPartner,
};
