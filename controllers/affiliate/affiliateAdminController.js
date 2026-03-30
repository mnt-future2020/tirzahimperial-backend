const crypto = require("crypto");
const { prisma } = require("../../config/database");
const { sendAffiliateApprovalEmail, sendAffiliateStatusEmail } = require("../../utils/email/affiliateEmailSender");
const { sendToUser } = require("../../utils/notification/sendNotification");

const generateAffiliateCode = async () => {
  for (let i = 0; i < 5; i += 1) {
    const code = `AFF${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const exists = await prisma.affiliate.findUnique({ where: { affiliateCode: code } });
    const historyExists = await prisma.affiliateCodeHistory.findUnique({ where: { code } });
    if (!exists && !historyExists) return code;
  }
  return `AFF${Date.now().toString().slice(-6)}`;
};

const normalizeDiscountInput = (discountType, discountValue) => {
  if (!discountType || discountValue === undefined || discountValue === null) {
    return { error: "Discount type and value are required" };
  }

  const normalizedType = String(discountType).toLowerCase();
  if (!["percentage", "flat"].includes(normalizedType)) {
    return { error: "Discount type must be percentage or flat" };
  }

  const value = Number(discountValue);
  if (Number.isNaN(value) || value <= 0) {
    return { error: "Discount value must be greater than 0" };
  }

  if (normalizedType === "percentage" && value > 100) {
    return { error: "Percentage discount cannot exceed 100" };
  }

  return { discountType: normalizedType, discountValue: value };
};

const normalizeCommissionRate = (commissionRate) => {
  if (commissionRate === undefined || commissionRate === null || commissionRate === "") {
    return { error: "Commission rate is required" };
  }
  const rate = Number(commissionRate);
  if (Number.isNaN(rate) || rate < 0) {
    return { error: "Commission rate must be 0 or higher" };
  }
  if (rate > 100) {
    return { error: "Commission rate cannot exceed 100" };
  }
  return { commissionRate: rate };
};

const normalizeMinWithdrawalAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    return { minWithdrawalAmount: 0 };
  }
  const value = Number(amount);
  if (Number.isNaN(value) || value < 0) {
    return { error: "Minimum withdrawal amount must be 0 or higher" };
  }
  return { minWithdrawalAmount: value };
};

const normalizeOptionalUsageLimit = (maxUsageCount) => {
  if (maxUsageCount === undefined || maxUsageCount === null || maxUsageCount === "") {
    return { maxUsageCount: null };
  }
  const value = Number(maxUsageCount);
  if (Number.isNaN(value) || value <= 0 || !Number.isInteger(value)) {
    return { error: "Usage limit must be a whole number greater than 0" };
  }
  return { maxUsageCount: value };
};

const parseOptionalDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const resolveAffiliateUserId = async (affiliate) => {
  if (!affiliate) return null;
  if (affiliate.userId) return affiliate.userId;
  if (!affiliate.email) return null;
  const user = await prisma.user.findUnique({ where: { email: affiliate.email.toLowerCase() } });
  return user?.id || null;
};

const listAffiliates = async (req, res) => {
  try {
    const { search, page = 1, limit = 12 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = {};
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { affiliateCode: { contains: search, mode: "insensitive" } },
      ];
    }

    const [affiliates, total] = await Promise.all([
      prisma.affiliate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.affiliate.count({ where }),
    ]);

    const affiliateIds = affiliates.map((affiliate) => affiliate.id);
    const codeHistories = await prisma.affiliateCodeHistory.findMany({
      where: { affiliateId: { in: affiliateIds } },
    });

    const codeMap = affiliateIds.reduce((acc, id) => {
      acc[id] = [];
      return acc;
    }, {});
    for (const entry of codeHistories) {
      if (!codeMap[entry.affiliateId]) codeMap[entry.affiliateId] = [];
      codeMap[entry.affiliateId].push(entry.code);
    }
    affiliates.forEach((affiliate) => {
      if (!codeMap[affiliate.id] || codeMap[affiliate.id].length === 0) {
        codeMap[affiliate.id] = [affiliate.affiliateCode];
      }
    });

    const allCodes = [...new Set(Object.values(codeMap).flat())];
    const orders = await prisma.onlineOrder.findMany({
      where: {
        affiliateCode: { in: allCodes },
        orderStatus: { not: "cancelled" },
      },
      select: { affiliateCode: true, total: true, orderStatus: true, createdAt: true },
    });

    const codeToAffiliate = {};
    affiliates.forEach((affiliate) => {
      (codeMap[affiliate.id] || []).forEach((code) => {
        codeToAffiliate[code] = affiliate.id;
      });
    });

    const statsMap = affiliateIds.reduce((acc, id) => {
      acc[id] = { totalOrders: 0, deliveredOrders: 0, totalRevenue: 0, lastOrderDate: null };
      return acc;
    }, {});

    orders.forEach((order) => {
      const affiliateId = codeToAffiliate[order.affiliateCode];
      if (!affiliateId) return;
      const stats = statsMap[affiliateId];
      stats.totalOrders += 1;
      if (order.orderStatus === "delivered") stats.deliveredOrders += 1;
      stats.totalRevenue += order.total || 0;
      if (!stats.lastOrderDate || new Date(order.createdAt) > new Date(stats.lastOrderDate)) {
        stats.lastOrderDate = order.createdAt;
      }
    });

    const commissionGroups = await prisma.affiliateEarning.groupBy({
      by: ["affiliateId"],
      where: { affiliateId: { in: affiliateIds } },
      _sum: { commissionAmount: true },
    });
    const commissionMap = Object.fromEntries(
      commissionGroups.map((entry) => [entry.affiliateId, entry._sum.commissionAmount || 0])
    );

    const data = affiliates.map((affiliate) => ({
      ...affiliate,
      stats: statsMap[affiliate.id] || {
        totalOrders: 0,
        deliveredOrders: 0,
        totalRevenue: 0,
        lastOrderDate: null,
      },
      totalCommission: commissionMap[affiliate.id] || 0,
    }));

    res.json({
      success: true,
      data,
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error("Affiliate list error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch affiliates" });
  }
};

const getAffiliateDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const affiliate = await prisma.affiliate.findUnique({ where: { id } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: "Affiliate not found" });
    }

    const codeHistory = await prisma.affiliateCodeHistory.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { activatedAt: "desc" },
    });
    if (!codeHistory.find((entry) => entry.code === affiliate.affiliateCode)) {
      codeHistory.unshift({
        id: "current",
        affiliateId: affiliate.id,
        code: affiliate.affiliateCode,
        status: "active",
        commissionRate: affiliate.commissionRate,
        discountType: affiliate.discountType,
        discountValue: affiliate.discountValue,
        maxUsageCount: null,
        validFrom: affiliate.approvedAt || affiliate.createdAt,
        validUntil: null,
        couponId: affiliate.couponId || null,
        activatedAt: affiliate.approvedAt || affiliate.createdAt,
        expiredAt: null,
        createdAt: affiliate.createdAt,
        updatedAt: affiliate.updatedAt,
      });
    }

    const codes = codeHistory.map((entry) => entry.code);

    const orders = await prisma.onlineOrder.findMany({
      where: {
        affiliateCode: { in: codes },
        orderStatus: { not: "cancelled" },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        orderStatus: true,
        createdAt: true,
        customerName: true,
        customerPhone: true,
        affiliateCode: true,
      },
    });

    const totalOrders = orders.length;
    const deliveredOrders = orders.filter((o) => o.orderStatus === "delivered").length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

    const codeStatsMap = codes.reduce((acc, code) => {
      acc[code] = { totalOrders: 0, deliveredOrders: 0, totalRevenue: 0, lastOrderDate: null };
      return acc;
    }, {});

    orders.forEach((order) => {
      const stats = codeStatsMap[order.affiliateCode] || null;
      if (!stats) return;
      stats.totalOrders += 1;
      if (order.orderStatus === "delivered") stats.deliveredOrders += 1;
      stats.totalRevenue += order.total || 0;
      if (!stats.lastOrderDate || new Date(order.createdAt) > new Date(stats.lastOrderDate)) {
        stats.lastOrderDate = order.createdAt;
      }
    });

    const earningSummary = await prisma.affiliateEarning.groupBy({
      by: ["status"],
      where: { affiliateId: affiliate.id },
      _sum: { commissionAmount: true },
    });
    const totals = earningSummary.reduce(
      (acc, entry) => {
        acc.totalCommission += entry._sum.commissionAmount || 0;
        if (entry.status === "available") acc.totalAvailable = entry._sum.commissionAmount || 0;
        if (entry.status === "pending") acc.totalPending = entry._sum.commissionAmount || 0;
        if (entry.status === "paid") acc.totalPaid = entry._sum.commissionAmount || 0;
        return acc;
      },
      { totalCommission: 0, totalAvailable: 0, totalPending: 0, totalPaid: 0 }
    );

    let coupon = null;
    if (affiliate.couponId) {
      coupon = await prisma.coupon.findUnique({ where: { id: affiliate.couponId } });
    } else if (affiliate.affiliateCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: affiliate.affiliateCode } });
    }

    res.json({
      success: true,
      data: {
        affiliate,
        coupon: coupon
          ? {
              code: coupon.code,
              validFrom: coupon.validFrom,
              validUntil: coupon.validUntil,
              maxUsageCount: coupon.maxUsageCount,
              currentUsageCount: coupon.currentUsageCount,
            }
          : null,
        stats: { totalOrders, deliveredOrders, totalRevenue },
        totals,
        codeHistory: codeHistory.map((entry) => ({
          code: entry.code,
          status: entry.status,
          commissionRate: entry.commissionRate,
          discountType: entry.discountType,
          discountValue: entry.discountValue,
          maxUsageCount: entry.maxUsageCount,
          validFrom: entry.validFrom,
          validUntil: entry.validUntil,
          activatedAt: entry.activatedAt,
          expiredAt: entry.expiredAt,
          stats: codeStatsMap[entry.code] || {
            totalOrders: 0,
            deliveredOrders: 0,
            totalRevenue: 0,
            lastOrderDate: null,
          },
        })),
        orders,
      },
    });
  } catch (error) {
    console.error("Affiliate detail error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch affiliate detail" });
  }
};

const updateAffiliate = async (req, res) => {
  try {
    const { id } = req.params;
    const {   discountType,     discountValue,    commissionRate,     rotateCode,      expireOldCode,     maxUsageCount,    validFrom,     validUntil,     minWithdrawalAmount    } = req.body || {}

    const affiliate = await prisma.affiliate.findUnique({ where: { id } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: "Affiliate not found" });
    }

    const normalizedDiscount = normalizeDiscountInput(discountType, discountValue);
    if (normalizedDiscount.error) {
      return res.status(400).json({ success: false, error: normalizedDiscount.error });
    }

    const normalizedCommission = normalizeCommissionRate(commissionRate);
    if (normalizedCommission.error) {
      return res.status(400).json({ success: false, error: normalizedCommission.error });
    }

    const normalizedMinWithdrawal = normalizeMinWithdrawalAmount(minWithdrawalAmount);
    if (normalizedMinWithdrawal.error) {
      return res.status(400).json({ success: false, error: normalizedMinWithdrawal.error });
    }

    const normalizedUsage = normalizeOptionalUsageLimit(maxUsageCount);
    if (normalizedUsage.error) {
      return res.status(400).json({ success: false, error: normalizedUsage.error });
    }

    const requestedValidFrom = parseOptionalDate(validFrom);
    const requestedValidUntil = parseOptionalDate(validUntil);
    if (requestedValidFrom && requestedValidUntil && requestedValidUntil < requestedValidFrom) {
      return res.status(400).json({ success: false, error: "Valid until must be after valid from" });
    }

    let updatedAffiliate = affiliate;
    let newCode = affiliate.affiliateCode;
    let couponId = affiliate.couponId;

    const shouldExpireOldCode = expireOldCode !== false;

    if (rotateCode) {
      const oldCode = affiliate.affiliateCode;
      newCode = await generateAffiliateCode();

      let oldCouponId = affiliate.couponId;
      if (!oldCouponId) {
        const oldCoupon = await prisma.coupon.findUnique({ where: { code: oldCode } });
        oldCouponId = oldCoupon?.id || null;
      }

      if (oldCouponId) {
        if (shouldExpireOldCode) {
          await prisma.coupon.update({
            where: { id: oldCouponId },
            data: { isActive: false, validUntil: new Date() },
          });
        } else {
          await prisma.coupon.update({
            where: { id: oldCouponId },
            data: {
              discountType: normalizedDiscount.discountType,
              discountValue: normalizedDiscount.discountValue,
              validFrom: requestedValidFrom || new Date(),
              validUntil: requestedValidUntil || undefined,
              maxUsageCount: normalizedUsage.maxUsageCount,
              isActive: true,
            },
          });
        }
      }

      const oldHistory = await prisma.affiliateCodeHistory.findUnique({ where: { code: oldCode } });
      if (oldHistory) {
        await prisma.affiliateCodeHistory.update({
          where: { id: oldHistory.id },
          data: shouldExpireOldCode
            ? { status: "expired", expiredAt: new Date() }
            : {
                status: "active",
                commissionRate: normalizedCommission.commissionRate,
                discountType: normalizedDiscount.discountType,
                discountValue: normalizedDiscount.discountValue,
                maxUsageCount: normalizedUsage.maxUsageCount,
                validFrom: requestedValidFrom || oldHistory.validFrom || new Date(),
                validUntil: requestedValidUntil || oldHistory.validUntil || null,
                expiredAt: null,
              },
        });
      }

      const now = new Date();
      const finalValidFrom = requestedValidFrom || now;
      const oneYearFromNow = new Date(finalValidFrom);
      oneYearFromNow.setFullYear(finalValidFrom.getFullYear() + 1);
      const finalValidUntil = requestedValidUntil || oneYearFromNow;

      const newCoupon = await prisma.coupon.create({
        data: {
          code: newCode,
          description: `Affiliate discount for ${affiliate.fullName}`,
          discountType: normalizedDiscount.discountType,
          discountValue: normalizedDiscount.discountValue,
          usageType: "multi-use",
          validFrom: finalValidFrom,
          validUntil: finalValidUntil,
          maxUsageCount: normalizedUsage.maxUsageCount,
          applicableCategories: [],
          isActive: true,
          isAffiliateCoupon: true,
        },
      });
      couponId = newCoupon.id;

      updatedAffiliate = await prisma.affiliate.update({
        where: { id: affiliate.id },
        data: {
          affiliateCode: newCode,
          minWithdrawalAmount: normalizedMinWithdrawal.minWithdrawalAmount,
          commissionRate: normalizedCommission.commissionRate,
          discountType: normalizedDiscount.discountType,
          discountValue: normalizedDiscount.discountValue,
          couponId: couponId,
        },
      });

      await prisma.affiliateCodeHistory.create({
        data: {
          affiliateId: affiliate.id,
          code: newCode,
          status: "active",
          commissionRate: normalizedCommission.commissionRate,
          discountType: normalizedDiscount.discountType,
          discountValue: normalizedDiscount.discountValue,
          maxUsageCount: normalizedUsage.maxUsageCount,
          validFrom: finalValidFrom,
          validUntil: finalValidUntil,
          couponId: couponId,
          activatedAt: now,
        },
      });
    } else {
      let currentCouponId = affiliate.couponId;
      if (!currentCouponId) {
        const coupon = await prisma.coupon.findUnique({ where: { code: affiliate.affiliateCode } });
        currentCouponId = coupon?.id || null;
      }

      if (currentCouponId) {
        const currentCoupon = await prisma.coupon.findUnique({ where: { id: currentCouponId } });
        const now = new Date();
        const finalValidFrom = requestedValidFrom || currentCoupon?.validFrom || now;
        const oneYearFromNow = new Date(finalValidFrom);
        oneYearFromNow.setFullYear(finalValidFrom.getFullYear() + 1);
        const finalValidUntil = requestedValidUntil || currentCoupon?.validUntil || oneYearFromNow;

        await prisma.coupon.update({
          where: { id: currentCouponId },
          data: {
            discountType: normalizedDiscount.discountType,
            discountValue: normalizedDiscount.discountValue,
            isActive: true,
            validFrom: finalValidFrom,
            validUntil: finalValidUntil,
            maxUsageCount:
              normalizedUsage.maxUsageCount !== null
                ? normalizedUsage.maxUsageCount
                : currentCoupon?.maxUsageCount || null,
          },
        });
      }

      updatedAffiliate = await prisma.affiliate.update({
        where: { id: affiliate.id },
        data: {
          minWithdrawalAmount: normalizedMinWithdrawal.minWithdrawalAmount,
          commissionRate: normalizedCommission.commissionRate,
          discountType: normalizedDiscount.discountType,
          discountValue: normalizedDiscount.discountValue,
        },
      });

      const history = await prisma.affiliateCodeHistory.findUnique({
        where: { code: affiliate.affiliateCode },
      });
      if (history) {
        const now = new Date();
        const finalValidFrom = requestedValidFrom || history.validFrom || now;
        const oneYearFromNow = new Date(finalValidFrom);
        oneYearFromNow.setFullYear(finalValidFrom.getFullYear() + 1);
        const finalValidUntil = requestedValidUntil || history.validUntil || oneYearFromNow;

        await prisma.affiliateCodeHistory.update({
          where: { id: history.id },
          data: {
            status: "active",
            commissionRate: normalizedCommission.commissionRate,
            discountType: normalizedDiscount.discountType,
            discountValue: normalizedDiscount.discountValue,
            maxUsageCount:
              normalizedUsage.maxUsageCount !== null
                ? normalizedUsage.maxUsageCount
                : history.maxUsageCount || null,
            validFrom: finalValidFrom,
            validUntil: finalValidUntil,
            couponId: currentCouponId || affiliate.couponId || history.couponId || null,
            expiredAt: null,
          },
        });
      } else {
        const now = new Date();
        const finalValidFrom = requestedValidFrom || affiliate.approvedAt || now;
        const oneYearFromNow = new Date(finalValidFrom);
        oneYearFromNow.setFullYear(finalValidFrom.getFullYear() + 1);
        const finalValidUntil = requestedValidUntil || oneYearFromNow;
        await prisma.affiliateCodeHistory.create({
          data: {
            affiliateId: affiliate.id,
            code: affiliate.affiliateCode,
            status: "active",
            commissionRate: normalizedCommission.commissionRate,
            discountType: normalizedDiscount.discountType,
            discountValue: normalizedDiscount.discountValue,
            maxUsageCount: normalizedUsage.maxUsageCount,
            validFrom: finalValidFrom,
            validUntil: finalValidUntil,
            couponId: affiliate.couponId || null,
            activatedAt: affiliate.approvedAt || new Date(),
          },
        });
      }
    }

    const admin = await prisma.admin.findFirst({ where: { isActive: true, isVerified: true } });
    const frontendBase = process.env.FRONTEND_URL || "";
    const loginUrl = `${frontendBase}/signin`;

    let coupon = null;
    if (couponId) {
      coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    } else if (newCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: newCode } });
    }

    await sendAffiliateApprovalEmail({
      to: updatedAffiliate.email,
      name: updatedAffiliate.fullName,
      affiliateCode: newCode,
      discountType: normalizedDiscount.discountType,
      discountValue: normalizedDiscount.discountValue,
      commissionRate: normalizedCommission.commissionRate,
      maxUsageCount: coupon?.maxUsageCount ?? normalizedUsage.maxUsageCount,
      validFrom: coupon?.validFrom || undefined,
      validUntil: coupon?.validUntil || undefined,
      loginUrl,
      supportEmail: admin?.email,
      companyName: admin?.companyName,
    });

    try {
      const affiliateUserId = await resolveAffiliateUserId(updatedAffiliate);
      if (affiliateUserId) {
        const notification = {
          title: "Affiliate Code Updated",
          body: `Your affiliate settings have been updated.${rotateCode ? `\nNew code: ${newCode}` : ""}`,
        };
        const data = {
          type: "AFFILIATE_CODE_UPDATED",
          affiliateCode: newCode,
          link: "/affiliate/portal",
          urgency: "normal",
          vibrate: [200, 100, 200],
          requireInteraction: false,
          color: "#c49a3c",
          backgroundColor: "#faf7f4",
          actions: [
            { action: "view", title: "View Portal" },
            { action: "dismiss", title: "Dismiss" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate update notification error:", notificationError);
    }

    res.json({ success: true, data: updatedAffiliate });
  } catch (error) {
    console.error("Affiliate update error:", error);
    res.status(500).json({ success: false, error: "Failed to update affiliate" });
  }
};

const setAffiliateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body || {};

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }

    const affiliate = await prisma.affiliate.findUnique({ where: { id } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: "Affiliate not found" });
    }

    const updated = await prisma.affiliate.update({
      where: { id },
      data: {
        status,
        deactivatedReason: status === "inactive" ? reason || null : null,
        deactivatedAt: status === "inactive" ? new Date() : null,
      },
    });

    const admin = await prisma.admin.findFirst({ where: { isActive: true, isVerified: true } });
    await sendAffiliateStatusEmail({
      to: updated.email,
      name: updated.fullName,
      status,
      reason: status === "inactive" ? reason : null,
      supportEmail: admin?.email,
      companyName: admin?.companyName,
    });

    try {
      const affiliateUserId = await resolveAffiliateUserId(updated);
      if (affiliateUserId) {
        const notification = {
          title: status === "inactive" ? "Affiliate Account Disabled" : "Affiliate Account Enabled",
          body: status === "inactive"
            ? `Your affiliate account has been disabled.${reason ? `\nReason: ${reason}` : ""}`
            : "Your affiliate account is active again.",
        };
        const data = {
          type: status === "inactive" ? "AFFILIATE_DISABLED" : "AFFILIATE_ENABLED",
          link: "/affiliate/portal",
          urgency: status === "inactive" ? "high" : "normal",
          vibrate: status === "inactive" ? [200, 100, 200, 100, 200] : [200, 100, 200],
          requireInteraction: status === "inactive",
          color: status === "inactive" ? "#6b5040" : "#c49a3c",
          backgroundColor: status === "inactive" ? "#f6f3ee" : "#faf7f4",
          actions: [
            { action: "view", title: "Contact Admin" },
            { action: "dismiss", title: "Dismiss" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate status notification error:", notificationError);
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Affiliate status update error:", error);
    res.status(500).json({ success: false, error: "Failed to update affiliate status" });
  }
};

const expireAffiliateCode = async (req, res) => {
  try {
    const { id } = req.params;
    const affiliate = await prisma.affiliate.findUnique({ where: { id } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: "Affiliate not found" });
    }

    const currentCode = affiliate.affiliateCode;
    const history = await prisma.affiliateCodeHistory.findUnique({ where: { code: currentCode } });
    if (history && history.status === "expired") {
      return res.json({ success: true, data: history });
    }

    let couponId = affiliate.couponId;
    if (!couponId) {
      const coupon = await prisma.coupon.findUnique({ where: { code: currentCode } });
      couponId = coupon?.id || null;
    }

    if (couponId) {
      await prisma.coupon.update({
        where: { id: couponId },
        data: { isActive: false, validUntil: new Date() },
      });
    }

    if (history) {
      await prisma.affiliateCodeHistory.update({
        where: { id: history.id },
        data: { status: "expired", expiredAt: new Date() },
      });
    } else {
      await prisma.affiliateCodeHistory.create({
        data: {
          affiliateId: affiliate.id,
          code: currentCode,
          status: "expired",
          commissionRate: affiliate.commissionRate,
          discountType: affiliate.discountType,
          discountValue: affiliate.discountValue,
          maxUsageCount: null,
          validFrom: affiliate.approvedAt || affiliate.createdAt,
          validUntil: new Date(),
          couponId: couponId,
          activatedAt: affiliate.approvedAt || affiliate.createdAt,
          expiredAt: new Date(),
        },
      });
    }

    try {
      const affiliateUserId = await resolveAffiliateUserId(affiliate);
      if (affiliateUserId) {
        const notification = {
          title: "Affiliate Code Expired",
          body: `Your affiliate code ${currentCode} has been expired by admin.`,
        };
        const data = {
          type: "AFFILIATE_CODE_EXPIRED",
          affiliateCode: currentCode,
          link: "/affiliate/portal",
          urgency: "normal",
          vibrate: [200, 100, 200],
          requireInteraction: false,
          color: "#6b5040",
          backgroundColor: "#f6f3ee",
          actions: [
            { action: "view", title: "View Portal" },
            { action: "dismiss", title: "Dismiss" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate code expired notification error:", notificationError);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Affiliate code expire error:", error);
    res.status(500).json({ success: false, error: "Failed to expire affiliate code" });
  }
};

const listWithdrawalRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status && status !== "all") where.status = status;

    const requests = await prisma.affiliateWithdrawalRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
    });

    const affiliateIds = [...new Set(requests.map((r) => r.affiliateId))];
    const affiliates = await prisma.affiliate.findMany({
      where: { id: { in: affiliateIds } },
      select: { id: true, fullName: true, email: true, affiliateCode: true },
    });
    const affiliateMap = Object.fromEntries(affiliates.map((a) => [a.id, a]));

    res.json({
      success: true,
      data: requests.map((r) => ({
        ...r,
        affiliate: affiliateMap[r.affiliateId] || null,
      })),
    });
  } catch (error) {
    console.error("Affiliate withdrawal list error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch withdrawal requests" });
  }
};

const approveWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await prisma.affiliateWithdrawalRequest.findUnique({ where: { id } });
    if (!request) {
      return res.status(404).json({ success: false, error: "Withdrawal request not found" });
    }

    const updated = await prisma.affiliateWithdrawalRequest.update({
      where: { id },
      data: { status: "approved", processedAt: new Date() },
    });

    try {
      const affiliate = await prisma.affiliate.findUnique({ where: { id: request.affiliateId } });
      const affiliateUserId = await resolveAffiliateUserId(affiliate);
      if (affiliateUserId) {
        const notification = {
          title: "Withdrawal Approved",
          body: `Your withdrawal request of ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹${request.amount.toFixed(2)} has been approved.`,
        };
        const data = {
          type: "AFFILIATE_WITHDRAWAL_APPROVED",
          amount: request.amount.toString(),
          link: "/affiliate/portal",
          urgency: "high",
          vibrate: [200, 100, 200, 100, 200],
          requireInteraction: true,
          color: "#c49a3c",
          backgroundColor: "#faf7f4",
          actions: [
            { action: "view", title: "View Portal" },
            { action: "dismiss", title: "Dismiss" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate withdrawal approve notification error:", notificationError);
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Affiliate withdrawal approve error:", error);
    res.status(500).json({ success: false, error: "Failed to approve withdrawal" });
  }
};

const rejectWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body || {};
    const request = await prisma.affiliateWithdrawalRequest.findUnique({ where: { id } });
    if (!request) {
      return res.status(404).json({ success: false, error: "Withdrawal request not found" });
    }

    const updated = await prisma.affiliateWithdrawalRequest.update({
      where: { id },
      data: { status: "rejected", note: note || null, processedAt: new Date() },
    });

    try {
      const affiliate = await prisma.affiliate.findUnique({ where: { id: request.affiliateId } });
      const affiliateUserId = await resolveAffiliateUserId(affiliate);
      if (affiliateUserId) {
        const notification = {
          title: "Withdrawal Rejected",
          body: `Your withdrawal request of ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¹${request.amount.toFixed(2)} was rejected.${note ? `\nReason: ${note}` : ""}`,
        };
        const data = {
          type: "AFFILIATE_WITHDRAWAL_REJECTED",
          amount: request.amount.toString(),
          link: "/affiliate/portal",
          urgency: "normal",
          vibrate: [200, 100, 200],
          requireInteraction: false,
          color: "#6b5040",
          backgroundColor: "#f6f3ee",
          actions: [
            { action: "view", title: "View Portal" },
            { action: "dismiss", title: "Dismiss" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate withdrawal reject notification error:", notificationError);
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Affiliate withdrawal reject error:", error);
    res.status(500).json({ success: false, error: "Failed to reject withdrawal" });
  }
};

module.exports = {
  listAffiliates,
  getAffiliateDetail,
  updateAffiliate,
  setAffiliateStatus,
  expireAffiliateCode,
  listWithdrawalRequests,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
};

