const { prisma } = require('../../config/database');

/**
 * Rate delivery partner for an order
 * POST /api/online/my-orders/:orderId/rate-partner
 */
const rateDeliveryPartner = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user?.id;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5',
      });
    }

    // Get order
    const order = await prisma.onlineOrder.findUnique({
      where: { id: orderId },
      include: {
        deliveryPartner: {
          select: {
            id: true,
            name: true,
            rating: true,
            totalRatings: true,
            averageRating: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Verify order belongs to user
    if (order.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    // Check if order is delivered
    if (order.orderStatus !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate delivered orders',
      });
    }

    // Check if already rated
    if (order.partnerRating) {
      return res.status(400).json({
        success: false,
        message: 'Order already rated',
      });
    }

    // Check if delivery partner exists
    if (!order.deliveryPartnerId || !order.deliveryPartner) {
      return res.status(400).json({
        success: false,
        message: 'No delivery partner assigned to this order',
      });
    }

    // Update order with rating
    const updatedOrder = await prisma.onlineOrder.update({
      where: { id: orderId },
      data: {
        partnerRating: rating,
        partnerRatingComment: comment || null,
        ratedAt: new Date(),
      },
    });

    // Calculate new average rating for partner
    const partner = order.deliveryPartner;
    const currentTotalRating = partner.rating * partner.totalRatings;
    const newTotalRatings = partner.totalRatings + 1;
    const newAverageRating = (currentTotalRating + rating) / newTotalRatings;

    // Update partner rating
    await prisma.deliveryPartner.update({
      where: { id: order.deliveryPartnerId },
      data: {
        rating: newAverageRating,
        averageRating: newAverageRating,
        totalRatings: newTotalRatings,
      },
    });

    // Send notification to partner
    try {
      await prisma.partnerNotification.create({
        data: {
          partnerId: order.deliveryPartnerId,
          type: 'rating_received',
          title: 'New Rating Received',
          message: `You received ${rating} stars for order ${order.orderNumber}`,
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            rating: rating,
            comment: comment || null,
          },
        },
      });

      // Send push notification
      const { sendToPartner } = require('../../utils/notification/sendNotification');
      await sendToPartner(
        order.deliveryPartnerId,
        {
          title: 'New Rating Received',
          body: `You received ${rating} stars for order #${order.orderNumber}`,
        },
        {
          type: 'RATING_RECEIVED',
          orderId: order.id,
          orderNumber: order.orderNumber,
          rating: rating.toString(),
        }
      );
    } catch (notificationError) {
      console.error('Error sending rating notification:', notificationError);
      // Don't fail the request if notification fails
    }

    res.json({
      success: true,
      message: 'Rating submitted successfully',
      data: {
        orderId: updatedOrder.id,
        rating: updatedOrder.partnerRating,
        comment: updatedOrder.partnerRatingComment,
        ratedAt: updatedOrder.ratedAt,
      },
    });
  } catch (error) {
    console.error('Error rating delivery partner:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit rating',
      error: error.message,
    });
  }
};

module.exports = {
  rateDeliveryPartner,
};
