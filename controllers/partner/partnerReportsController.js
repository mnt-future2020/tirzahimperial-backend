const { prisma } = require('../../config/database');

/**
 * Get partner reports/analytics
 * GET /api/partner/reports
 */
const getPartnerReports = async (req, res) => {
  try {
    const partnerId = req.user.id;
    const { period = 'daily' } = req.query; // daily, weekly, monthly

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: partnerId },
      select: {
        id: true,
        name: true,
        averageRating: true,
        totalRatings: true,
        totalDeliveries: true,
        todayDeliveries: true,
        weeklyDeliveries: true,
        monthlyDeliveries: true,
      },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found',
      });
    }

    // Calculate date ranges
    const now = new Date();
    let startDate, labels, groupBy;

    switch (period) {
      case 'daily':
        // Last 7 days
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        groupBy = 'day';
        break;
      case 'weekly':
        // Last 4 weeks
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 27);
        startDate.setHours(0, 0, 0, 0);
        labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
        groupBy = 'week';
        break;
      case 'monthly':
        // Last 6 months
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 5);
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
        groupBy = 'month';
        break;
      default:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 6);
        labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        groupBy = 'day';
    }

    // Get all orders for the partner in the date range
    const orders = await prisma.onlineOrder.findMany({
      where: {
        deliveryPartnerId: partnerId,
        createdAt: { gte: startDate },
      },
      select: {
        id: true,
        orderStatus: true,
        createdAt: true,
        deliveredAt: true,
        deliveryAssignAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group orders by period
    const deliveriesData = [];
    const statusBreakdown = {
      delivered: 0,
      pending: 0,
      cancelled: 0,
    };

    // Initialize data array based on period
    if (period === 'daily') {
      // Last 7 days
      for (let i = 0; i < 7; i++) {
        deliveriesData.push(0);
      }
      
      orders.forEach(order => {
        const orderDate = new Date(order.createdAt);
        const daysDiff = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));
        const index = 6 - daysDiff;
        if (index >= 0 && index < 7) {
          deliveriesData[index]++;
        }
        
        // Count status
        if (order.orderStatus === 'delivered') statusBreakdown.delivered++;
        else if (order.orderStatus === 'cancelled') statusBreakdown.cancelled++;
        else statusBreakdown.pending++;
      });
    } else if (period === 'weekly') {
      // Last 4 weeks
      for (let i = 0; i < 4; i++) {
        deliveriesData.push(0);
      }
      
      orders.forEach(order => {
        const orderDate = new Date(order.createdAt);
        const weeksDiff = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24 * 7));
        const index = 3 - weeksDiff;
        if (index >= 0 && index < 4) {
          deliveriesData[index]++;
        }
        
        // Count status
        if (order.orderStatus === 'delivered') statusBreakdown.delivered++;
        else if (order.orderStatus === 'cancelled') statusBreakdown.cancelled++;
        else statusBreakdown.pending++;
      });
    } else if (period === 'monthly') {
      // Last 6 months
      for (let i = 0; i < 6; i++) {
        deliveriesData.push(0);
      }
      
      orders.forEach(order => {
        const orderDate = new Date(order.createdAt);
        const monthsDiff = (now.getFullYear() - orderDate.getFullYear()) * 12 + 
                          (now.getMonth() - orderDate.getMonth());
        const index = 5 - monthsDiff;
        if (index >= 0 && index < 6) {
          deliveriesData[index]++;
        }
        
        // Count status
        if (order.orderStatus === 'delivered') statusBreakdown.delivered++;
        else if (order.orderStatus === 'cancelled') statusBreakdown.cancelled++;
        else statusBreakdown.pending++;
      });
    }

    // Count delivered orders for success rate calculation
    const deliveredOrders = orders.filter(o => o.orderStatus === 'delivered');

    // Calculate success rate
    const totalOrders = orders.length;
    const successRate = totalOrders > 0 
      ? Math.round((statusBreakdown.delivered / totalOrders) * 100) 
      : 0;

    // Calculate peak hours (for all orders)
    const hourCounts = new Array(24).fill(0);
    orders.forEach(order => {
      const hour = new Date(order.createdAt).getHours();
      hourCounts[hour]++;
    });
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const peakHours = `${peakHour}:00 - ${peakHour + 1}:00`;

    // Calculate average orders per day
    const daysSinceStart = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));
    const avgOrdersPerDay = daysSinceStart > 0 
      ? Math.round(totalOrders / daysSinceStart) 
      : 0;

    res.json({
      success: true,
      data: {
        period,
        deliveriesChart: {
          labels,
          deliveries: deliveriesData,
        },
        statusBreakdown: [
          {
            name: 'Delivered',
            count: statusBreakdown.delivered,
            color: '#10b981',
            legendFontColor: '#1f2937',
          },
          {
            name: 'Pending',
            count: statusBreakdown.pending,
            color: '#f59e0b',
            legendFontColor: '#1f2937',
          },
          {
            name: 'Cancelled',
            count: statusBreakdown.cancelled,
            color: '#ef4444',
            legendFontColor: '#1f2937',
          },
        ],
        performanceMetrics: {
          totalDeliveries: statusBreakdown.delivered,
          customerRating: partner.averageRating.toFixed(1),
        },
        summaryStats: {
          totalDeliveries: totalOrders,
          successRate: `${successRate}%`,
          peakHours,
          avgOrdersPerDay,
        },
        partnerInfo: {
          name: partner.name,
          totalDeliveries: partner.totalDeliveries,
          todayDeliveries: partner.todayDeliveries,
          weeklyDeliveries: partner.weeklyDeliveries,
          monthlyDeliveries: partner.monthlyDeliveries,
          averageRating: partner.averageRating,
          totalRatings: partner.totalRatings,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching partner reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports',
      error: error.message,
    });
  }
};

/**
 * Get admin view of all partners reports
 * GET /api/delivery-partners/reports
 */
const getAllPartnersReports = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;

    // Get all active partners
    const partners = await prisma.deliveryPartner.findMany({
      where: {
        applicationStatus: 'approved',
        partnerStatus: 'active',
      },
      select: {
        id: true,
        partnerId: true,
        name: true,
        email: true,
        phone: true,
        profilePhoto: true,
        totalDeliveries: true,
        todayDeliveries: true,
        weeklyDeliveries: true,
        monthlyDeliveries: true,
        averageRating: true,
        totalRatings: true,
        isAvailable: true,
        isOnline: true,
      },
      orderBy: { totalDeliveries: 'desc' },
    });

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (period) {
      case 'today':
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
    }

    // Get orders for all partners in the period
    const orders = await prisma.onlineOrder.findMany({
      where: {
        deliveryPartnerId: { in: partners.map(p => p.id) },
        createdAt: { gte: startDate },
      },
      select: {
        id: true,
        deliveryPartnerId: true,
        orderStatus: true,
        createdAt: true,
      },
    });

    // Calculate stats for each partner
    const partnersWithStats = partners.map(partner => {
      const partnerOrders = orders.filter(o => o.deliveryPartnerId === partner.id);
      const delivered = partnerOrders.filter(o => o.orderStatus === 'delivered').length;
      const pending = partnerOrders.filter(o => 
        ['confirmed', 'packing', 'shipped'].includes(o.orderStatus)
      ).length;
      const cancelled = partnerOrders.filter(o => o.orderStatus === 'cancelled').length;

      return {
        ...partner,
        periodStats: {
          total: partnerOrders.length,
          delivered,
          pending,
          cancelled,
          successRate: partnerOrders.length > 0 
            ? Math.round((delivered / partnerOrders.length) * 100) 
            : 0,
        },
      };
    });

    // Overall statistics
    const totalOrders = orders.length;
    const totalDelivered = orders.filter(o => o.orderStatus === 'delivered').length;
    const totalPending = orders.filter(o => 
      ['confirmed', 'packing', 'shipped'].includes(o.orderStatus)
    ).length;
    const totalCancelled = orders.filter(o => o.orderStatus === 'cancelled').length;

    res.json({
      success: true,
      data: {
        period,
        partners: partnersWithStats,
        overallStats: {
          totalPartners: partners.length,
          activePartners: partners.filter(p => p.isAvailable).length,
          onlinePartners: partners.filter(p => p.isOnline).length,
          totalOrders,
          totalDelivered,
          totalPending,
          totalCancelled,
          overallSuccessRate: totalOrders > 0 
            ? Math.round((totalDelivered / totalOrders) * 100) 
            : 0,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching all partners reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports',
      error: error.message,
    });
  }
};

module.exports = {
  getPartnerReports,
  getAllPartnersReports,
};
