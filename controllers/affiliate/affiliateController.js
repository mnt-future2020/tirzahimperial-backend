const crypto = require("crypto");
const { prisma } = require("../../config/database");
const { sendAffiliateApprovalEmail, sendAffiliateRejectionEmail } = require("../../utils/email/affiliateEmailSender");
const { sendToAllAdmins, sendToUser } = require("../../utils/notification/sendNotification");

const generateAffiliateCode = async () => {
  for (let i = 0; i < 5; i += 1) {
    const code = `AFF${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const exists = await prisma.affiliate.findUnique({ where: { affiliateCode: code } });
    if (!exists) return code;
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
};

const resolveAffiliateUserId = async (affiliateOrEmail) => {
  if (!affiliateOrEmail) return null;
  if (typeof affiliateOrEmail === "string") {
    const user = await prisma.user.findUnique({ where: { email: affiliateOrEmail.toLowerCase() } });
    return user?.id || null;
  }
  if (affiliateOrEmail.userId) return affiliateOrEmail.userId;
  if (!affiliateOrEmail.email) return null;
  const user = await prisma.user.findUnique({ where: { email: affiliateOrEmail.email.toLowerCase() } });
  return user?.id || null;
};

const applyAffiliate = async (req, res) => {
  try {
    const companySettings = await prisma.companySettings.findFirst();
    if (companySettings && !companySettings.affiliateEnabled) {
      return res.status(403).json({ success: false, error: "Affiliate program is currently disabled" });
    }

    const {
      email,
      fullName,
      phone,
      city,
      state,
      country,
      zipCode,
      socialHandle,
      websiteUrl,
      socialLinks,
      audienceSize,
      primaryChannel,
      message,
    } = req.body;

    if (!email || !fullName) {
      return res.status(400).json({ success: false, error: "Full name and email are required" });
    }

    const cleanedSocialLinks = Array.isArray(socialLinks)
      ? socialLinks
          .map((entry) => ({
            channel: typeof entry?.channel === "string" ? entry.channel.trim() : "",
            link: typeof entry?.link === "string" ? entry.link.trim() : "",
          }))
          .filter((entry) => entry.channel && entry.link)
      : [];

    const application = await prisma.affiliateApplication.create({
      data: {
        email: email.toLowerCase(),
        fullName,
        phone: phone || null,
        city: city || null,
        state: state || null,
        country: country || null,
        zipCode: zipCode || null,
        socialHandle: socialHandle || null,
        websiteUrl: websiteUrl || null,
        socialLinks: cleanedSocialLinks,
        audienceSize: audienceSize ? parseInt(audienceSize, 10) : null,
        primaryChannel: primaryChannel || null,
        message: message || null,
        status: "pending",
      },
    });

    try {
      const notification = {
        title: "New Affiliate Application",
        body: `${application.fullName} applied for the affiliate program.\n\nEmail: ${application.email}`,
      };
      const data = {
        type: "AFFILIATE_APPLICATION",
        applicationId: application.id,
        link: "/dashboard/affiliates?tab=applications",
        urgency: "normal",
        vibrate: [200, 100, 200],
        requireInteraction: false,
        color: "#c49a3c",
        backgroundColor: "#faf7f4",
        actions: [
          { action: "view", title: "Review Application" },
          { action: "dismiss", title: "Dismiss" },
        ],
      };
      await sendToAllAdmins(notification, data);
    } catch (notificationError) {
      console.error("Affiliate apply notification error:", notificationError);
    }

    return res.status(201).json({ success: true, data: application });
  } catch (error) {
    console.error("Affiliate apply error:", error);
    return res.status(500).json({ success: false, error: "Failed to submit application" });
  }
};

const listApplications = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 12 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);
    const where = {};
    if (status && status !== "all") where.status = status;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const [applications, total] = await Promise.all([
      prisma.affiliateApplication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.affiliateApplication.count({ where }),
    ]);

    res.json({
      success: true,
      data: applications,
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error("Affiliate list error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch applications" });
  }
};

const approveApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote, discountType, discountValue, commissionRate, maxUsageCount, validFrom, validUntil, minWithdrawalAmount } = req.body || {}

    const application = await prisma.affiliateApplication.findUnique({ where: { id } });
    if (!application) {
      return res.status(404).json({ success: false, error: "Application not found" });
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

    if (application.status === "approved") {
      return res.json({ success: true, data: application });
    }

    let affiliate = await prisma.affiliate.findUnique({ where: { email: application.email.toLowerCase() } });

    if (!affiliate) {
      const affiliateCode = await generateAffiliateCode();
      affiliate = await prisma.affiliate.create({
        data: {
          email: application.email.toLowerCase(),
          fullName: application.fullName,
          phone: application.phone || null,
          status: "active",
          affiliateCode,
          minWithdrawalAmount: normalizedMinWithdrawal.minWithdrawalAmount,
          commissionRate: normalizedCommission.commissionRate,
          discountType: normalizedDiscount.discountType,
          discountValue: normalizedDiscount.discountValue,
        },
      });
    } else {
      affiliate = await prisma.affiliate.update({
        where: { id: affiliate.id },
        data: {
          minWithdrawalAmount: normalizedMinWithdrawal.minWithdrawalAmount,
          commissionRate: normalizedCommission.commissionRate,
          discountType: normalizedDiscount.discountType,
          discountValue: normalizedDiscount.discountValue,
        },
      });
    }

    const now = new Date();
    const parsedValidFrom = parseOptionalDate(validFrom);
    const parsedValidUntil = parseOptionalDate(validUntil);
    const requestedValidFrom = parsedValidFrom || now;
    const requestedValidUntil = parsedValidUntil;
    if (requestedValidUntil && requestedValidUntil < requestedValidFrom) {
      return res.status(400).json({ success: false, error: "Valid until must be after valid from" });
    }
    const oneYearFromNow = new Date(requestedValidFrom);
    oneYearFromNow.setFullYear(requestedValidFrom.getFullYear() + 1);
    const finalValidUntil = requestedValidUntil || oneYearFromNow;
    const finalValidFrom = requestedValidFrom;
    const couponCode = affiliate.affiliateCode.toUpperCase();
    const existingCoupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
    const coupon = existingCoupon
      ? await prisma.coupon.update({
          where: { id: existingCoupon.id },
          data: {
            discountType: normalizedDiscount.discountType,
            discountValue: normalizedDiscount.discountValue,
            validFrom: finalValidFrom,
            validUntil: finalValidUntil,
            maxUsageCount: normalizedUsage.maxUsageCount,
            isActive: true,
            isAffiliateCoupon: true,
          },
        })
      : await prisma.coupon.create({
          data: {
            code: couponCode,
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

    if (!affiliate.couponId || affiliate.couponId !== coupon.id) {
      affiliate = await prisma.affiliate.update({
        where: { id: affiliate.id },
        data: { couponId: coupon.id },
      });
    }

    const existingHistory = await prisma.affiliateCodeHistory.findUnique({
      where: { code: affiliate.affiliateCode },
    });
    if (existingHistory) {
      await prisma.affiliateCodeHistory.update({
        where: { id: existingHistory.id },
        data: {
          status: "active",
          commissionRate: normalizedCommission.commissionRate,
          discountType: normalizedDiscount.discountType,
          discountValue: normalizedDiscount.discountValue,
          maxUsageCount: normalizedUsage.maxUsageCount,
            validFrom: finalValidFrom,
            validUntil: finalValidUntil,
          couponId: coupon.id,
          activatedAt: existingHistory.activatedAt || new Date(),
          expiredAt: null,
        },
      });
    } else {
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
          couponId: coupon.id,
          activatedAt: new Date(),
        },
      });
    }

    const updated = await prisma.affiliateApplication.update({
      where: { id },
      data: {
        status: "approved",
        affiliateId: affiliate.id,
        affiliateCode: affiliate.affiliateCode,
          commissionRate: normalizedCommission.commissionRate,
        discountType: normalizedDiscount.discountType,
        discountValue: normalizedDiscount.discountValue,
        couponId: coupon.id,
        reviewNote: reviewNote || null,
        reviewedByAdminId: req.userId || null,
        reviewedAt: new Date(),
      },
    });

    const admin = await prisma.admin.findFirst({ where: { isActive: true, isVerified: true } });
    const frontendBase = process.env.FRONTEND_URL || "";
    const loginUrl = `${frontendBase}/signin`;

    await sendAffiliateApprovalEmail({
      to: affiliate.email,
      name: affiliate.fullName,
      affiliateCode: affiliate.affiliateCode,
      discountType: normalizedDiscount.discountType,
      discountValue: normalizedDiscount.discountValue,
      commissionRate: normalizedCommission.commissionRate,
      maxUsageCount: normalizedUsage.maxUsageCount,
      validFrom: parsedValidFrom ? finalValidFrom : null,
      validUntil: parsedValidUntil ? finalValidUntil : null,
      loginUrl,
      supportEmail: admin?.email,
      companyName: admin?.companyName,
    });

    try {
      let affiliateUserId = await resolveAffiliateUserId(affiliate);
      if (!affiliate.userId && affiliateUserId) {
        await prisma.affiliate.update({
          where: { id: affiliate.id },
          data: { userId: affiliateUserId },
        });
      }
      if (affiliateUserId) {
        const notification = {
          title: "Affiliate Application Approved",
          body: `Your affiliate application is approved.\n\nCode: ${affiliate.affiliateCode}\nDiscount: ${normalizedDiscount.discountValue}${normalizedDiscount.discountType === "percentage" ? "%" : ""}`,
        };
        const data = {
          type: "AFFILIATE_APPROVED",
          affiliateCode: affiliate.affiliateCode,
          link: "/affiliate/portal",
          urgency: "high",
          vibrate: [200, 100, 200, 100, 200],
          requireInteraction: true,
          color: "#c49a3c",
          backgroundColor: "#faf7f4",
          actions: [
            { action: "view", title: "Open Portal" },
            { action: "dismiss", title: "Close" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate approval notification error:", notificationError);
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Affiliate approve error:", error);
    return res.status(500).json({ success: false, error: "Failed to approve application" });
  }
};

const rejectApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body || {};

    const application = await prisma.affiliateApplication.findUnique({ where: { id } });
    if (!application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }

    const updated = await prisma.affiliateApplication.update({
      where: { id },
      data: {
        status: "rejected",
        reviewNote: reviewNote || null,
        reviewedByAdminId: req.userId || null,
        reviewedAt: new Date(),
      },
    });

    const admin = await prisma.admin.findFirst({ where: { isActive: true, isVerified: true } });
    await sendAffiliateRejectionEmail({
      to: application.email,
      name: application.fullName,
      reason: reviewNote || "",
      supportEmail: admin?.email,
      companyName: admin?.companyName,
    });

    try {
      const affiliateUserId = await resolveAffiliateUserId(application.email);
      if (affiliateUserId) {
        const notification = {
          title: "Affiliate Application Rejected",
          body: `Your affiliate application was not approved.\n${reviewNote ? `Reason: ${reviewNote}` : ""}`,
        };
        const data = {
          type: "AFFILIATE_REJECTED",
          link: "/affiliate/join",
          urgency: "normal",
          vibrate: [200, 100, 200],
          requireInteraction: false,
          color: "#6b5040",
          backgroundColor: "#f6f3ee",
          actions: [
            { action: "view", title: "View Details" },
            { action: "dismiss", title: "Dismiss" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate rejection notification error:", notificationError);
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Affiliate reject error:", error);
    return res.status(500).json({ success: false, error: "Failed to reject application" });
  }
};

const getAffiliateMe = async (req, res) => {
  try {
    const user = req.user;
    if (!user?.email) {
      return res.status(400).json({ success: false, error: "User email missing" });
    }

    let affiliate = await prisma.affiliate.findUnique({ where: { userId: req.userId } });
    if (!affiliate) {
      affiliate = await prisma.affiliate.findUnique({ where: { email: user.email.toLowerCase() } });
      if (affiliate && !affiliate.userId) {
        affiliate = await prisma.affiliate.update({
          where: { id: affiliate.id },
          data: { userId: req.userId },
        });
      }
    }

    if (!affiliate) {
      return res.json({ success: true, data: null });
    }

    const codeHistory = await prisma.affiliateCodeHistory.findMany({
      where: { affiliateId: affiliate.id },
      select: { code: true },
    });
    const codes = Array.from(new Set([affiliate.affiliateCode, ...codeHistory.map((entry) => entry.code)]));

    const orders = await prisma.onlineOrder.findMany({
      where: {
        affiliateCode: { in: codes },
        orderStatus: { not: "cancelled" },
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        orderStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const deliveredOrders = orders.filter((o) => o.orderStatus === "delivered").length;

    const earningsAll = await prisma.affiliateEarning.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: "desc" },
    });

    const dedupedMap = new Map();
    earningsAll.forEach((earning) => {
      if (!dedupedMap.has(earning.orderId)) {
        dedupedMap.set(earning.orderId, earning);
      }
    });
    const earnings = Array.from(dedupedMap.values());
    const recentEarnings = earnings.slice(0, 20);

    let coupon = null;
    if (affiliate.couponId) {
      coupon = await prisma.coupon.findUnique({ where: { id: affiliate.couponId } });
    } else if (affiliate.affiliateCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: affiliate.affiliateCode } });
    }

    const earningSummary = earnings.reduce((acc, earning) => {
      const existing = acc.find((item) => item.status === earning.status);
      if (existing) {
        existing.amount += earning.commissionAmount || 0;
      } else {
        acc.push({ status: earning.status, amount: earning.commissionAmount || 0 });
      }
      return acc;
    }, []);

    const withdrawals = await prisma.affiliateWithdrawalRequest.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { requestedAt: "desc" },
      take: 10,
    });

    const withdrawnSum = await prisma.affiliateWithdrawalRequest.aggregate({
      where: { affiliateId: affiliate.id, status: { in: ["approved", "paid"] } },
      _sum: { amount: true },
    });

    const totalAvailable = earningSummary.find((e) => e.status === "available")?.amount || 0;
    const totalPending = earningSummary.find((e) => e.status === "pending")?.amount || 0;
    const totalPaid = earningSummary.find((e) => e.status === "paid")?.amount || 0;
    const withdrawn = withdrawnSum._sum.amount || 0;
    const availableBalance = Math.max(totalAvailable - withdrawn, 0);

    return res.json({
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
        stats: {
          totalOrders,
          deliveredOrders,
          totalRevenue,
          recentOrders: orders.slice(0, 10),
        },
        earnings: {
          availableBalance,
          totalAvailable,
          totalPending,
          totalPaid,
          withdrawn,
          recent: recentEarnings,
        },
        withdrawals,
      },
    });
  } catch (error) {
    console.error("Affiliate me error:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch affiliate info" });
  }
};

const requestWithdrawal = async (req, res) => {
  try {
    const { amount, note } = req.body || {};
    const user = req.user;
    if (!user?.email) {
      return res.status(400).json({ success: false, error: "User email missing" });
    }

    const affiliate = await prisma.affiliate.findUnique({ where: { userId: req.userId } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: "Affiliate not found" });
    }

    const totalAvailable = await prisma.affiliateEarning.aggregate({
      where: { affiliateId: affiliate.id, status: "available" },
      _sum: { commissionAmount: true },
    });

    const withdrawnSum = await prisma.affiliateWithdrawalRequest.aggregate({
      where: { affiliateId: affiliate.id, status: { in: ["approved", "paid"] } },
      _sum: { amount: true },
    });

    const availableBalance = Math.max((totalAvailable._sum.commissionAmount || 0) - (withdrawnSum._sum.amount || 0), 0);
    const requestedAmount = Number(amount);
    if (Number.isNaN(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ success: false, error: "Enter a valid amount" });
    }
    if (requestedAmount > availableBalance) {
      return res.status(400).json({ success: false, error: "Amount exceeds available balance" });
    }
    const minWithdrawal = Number(affiliate.minWithdrawalAmount || 0);
    if (minWithdrawal > 0 && requestedAmount < minWithdrawal) {
      return res.status(400).json({ success: false, error: `Minimum withdrawal amount is Rs. ${minWithdrawal.toFixed(2)}` });
    }

    const request = await prisma.affiliateWithdrawalRequest.create({
      data: {
        affiliateId: affiliate.id,
        amount: requestedAmount,
        note: note || null,
        status: "pending",
      },
    });

    try {
      const adminNotification = {
        title: "Affiliate Withdrawal Requested",
        body: `${affiliate.fullName} requested ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹${requestedAmount.toFixed(2)} withdrawal.`,
      };
      const adminData = {
        type: "AFFILIATE_WITHDRAWAL_REQUEST",
        affiliateId: affiliate.id,
        amount: requestedAmount.toString(),
        link: "/dashboard/affiliates?tab=withdrawals",
        urgency: "high",
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,
        color: "#c49a3c",
        backgroundColor: "#faf7f4",
        actions: [
          { action: "view", title: "Review Request" },
          { action: "dismiss", title: "Dismiss" },
        ],
      };
      await sendToAllAdmins(adminNotification, adminData);
    } catch (notificationError) {
      console.error("Affiliate withdrawal admin notification error:", notificationError);
    }

    try {
      const affiliateUserId = await resolveAffiliateUserId(affiliate);
      if (affiliateUserId) {
        const notification = {
          title: "Withdrawal Request Submitted",
          body: `Your withdrawal request for ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹${requestedAmount.toFixed(2)} has been submitted.`,
        };
        const data = {
          type: "AFFILIATE_WITHDRAWAL_SUBMITTED",
          amount: requestedAmount.toString(),
          link: "/affiliate/portal",
          urgency: "normal",
          vibrate: [200, 100, 200],
          requireInteraction: false,
          color: "#c49a3c",
          backgroundColor: "#faf7f4",
          actions: [
            { action: "view", title: "View Status" },
            { action: "dismiss", title: "Dismiss" },
          ],
        };
        await sendToUser(affiliateUserId, notification, data);
      }
    } catch (notificationError) {
      console.error("Affiliate withdrawal user notification error:", notificationError);
    }

    return res.status(201).json({ success: true, data: request });
  } catch (error) {
    console.error("Affiliate withdrawal error:", error);
    return res.status(500).json({ success: false, error: "Failed to create withdrawal request" });
  }
};

module.exports = {
  applyAffiliate,
  listApplications,
  approveApplication,
  rejectApplication,
  getAffiliateMe,
  requestWithdrawal,
};














