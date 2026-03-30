const { prisma } = require("../../config/database");
const { uploadToS3 } = require("../../utils/online/uploadS3");
const { getProxyImageUrl } = require("../../utils/common/imageProxy");

const MAX_IMAGES = 5;
const MAX_COMMENT_LENGTH = 1200;
const MAX_TITLE_LENGTH = 120;

const normalizeRating = (rating) => {
  const value = Number(rating);
  if (Number.isNaN(value) || value < 1 || value > 5) return null;
  return Math.round(value);
};

const mapReviewImages = (images = []) =>
  images.map((img) => getProxyImageUrl(img));

const mapReviewAvatar = (imageKey) => (imageKey ? getProxyImageUrl(imageKey) : null);

const getEligibleOrder = async (userId, productId) => {
  const orders = await prisma.onlineOrder.findMany({
    where: {
      userId,
      orderStatus: "delivered",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderNumber: true,
      items: true,
      createdAt: true,
    },
  });

  const eligibleOrders = orders.filter((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    return items.some((item) => String(item.productId) === String(productId));
  });

  if (eligibleOrders.length === 0) return null;

  const reviewedOrders = await prisma.productReview.findMany({
    where: {
      userId,
      productId,
      orderId: { in: eligibleOrders.map((order) => order.id) },
    },
    select: { orderId: true },
  });

  const reviewedOrderIds = new Set(reviewedOrders.map((review) => String(review.orderId)));
  const availableOrder = eligibleOrders.find(
    (order) => !reviewedOrderIds.has(String(order.id))
  );

  return availableOrder || null;
};

const listProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    if (!productId) {
      return res.status(400).json({ success: false, error: "Product ID is required" });
    }

    const where = {
      productId,
      status: "approved",
      isVerifiedPurchase: true,
    };

    const [reviews, total, ratingRows] = await Promise.all([
      prisma.productReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.productReview.count({ where }),
      prisma.productReview.findMany({
        where,
        select: { rating: true },
      }),
    ]);

    const ratingBreakdown = [1, 2, 3, 4, 5].reduce((acc, rating) => {
      acc[rating] = 0;
      return acc;
    }, {});
    ratingRows.forEach((row) => {
      const rate = Number(row.rating || 0);
      if (ratingBreakdown[rate] !== undefined) ratingBreakdown[rate] += 1;
    });
    const totalRatings = ratingRows.length;
    const avgRating =
      totalRatings > 0
        ? ratingRows.reduce((sum, row) => sum + (row.rating || 0), 0) / totalRatings
        : 0;

    let myReview = null;
    let canReview = false;
    if (req.userId && req.user?.role === "user") {
      myReview = await prisma.productReview.findFirst({
        where: {
          productId,
          userId: req.userId,
        },
        orderBy: { createdAt: "desc" },
      });
      const eligibleOrder = await getEligibleOrder(req.userId, productId);
      canReview = !!eligibleOrder;
    }

    res.json({
      success: true,
      data: reviews.map((review) => ({
        ...review,
        images: mapReviewImages(review.images || []),
        userImage: mapReviewAvatar(review.userImage),
      })),
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
      summary: {
        totalReviews: totalRatings,
        averageRating: Number(avgRating.toFixed(2)),
        ratingBreakdown,
      },
      myReview: myReview
        ? {
            ...myReview,
            images: mapReviewImages(myReview.images || []),
            userImage: mapReviewAvatar(myReview.userImage),
          }
        : null,
      canReview,
    });
  } catch (error) {
    console.error("Product review list error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reviews" });
  }
};

const createProductReview = async (req, res) => {
  try {
    if (!req.userId || req.user?.role !== "user") {
      return res.status(403).json({ success: false, error: "User authentication required" });
    }

    const { productId, rating, title, comment } = req.body || {};
    if (!productId) {
      return res.status(400).json({ success: false, error: "Product ID is required" });
    }

    const normalizedRating = normalizeRating(rating);
    if (!normalizedRating) {
      return res.status(400).json({ success: false, error: "Rating must be between 1 and 5" });
    }

    const trimmedTitle = title ? String(title).trim() : "";
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ success: false, error: `Title must be under ${MAX_TITLE_LENGTH} characters` });
    }

    const trimmedComment = comment ? String(comment).trim() : "";
    if (trimmedComment.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ success: false, error: `Comment must be under ${MAX_COMMENT_LENGTH} characters` });
    }

    if (!trimmedComment) {
      return res.status(400).json({ success: false, error: "Review comment is required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, image: true, isVerified: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(403).json({ success: false, error: "User account not active" });
    }

    if (!user.isVerified) {
      return res.status(403).json({ success: false, error: "Verify your account before submitting a review" });
    }

    const product = await prisma.onlineProduct.findUnique({
      where: { id: productId },
      select: { id: true, shortDescription: true },
    });
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const eligibleOrder = await getEligibleOrder(req.userId, productId);
    if (!eligibleOrder) {
      return res.status(403).json({ success: false, error: "Only verified purchases can be reviewed" });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length > MAX_IMAGES) {
      return res.status(400).json({ success: false, error: `You can upload up to ${MAX_IMAGES} images` });
    }

    const uploadedImages = [];
    for (const file of files) {
      const key = await uploadToS3(file.buffer, file.originalname, file.mimetype);
      uploadedImages.push(key);
    }

    const review = await prisma.productReview.create({
      data: {
        productId,
        productName: product.shortDescription,
        userId: user.id,
        userName: user.name || "User",
        userEmail: user.email,
        userImage: user.image || null,
        orderId: eligibleOrder.id,
        orderNumber: eligibleOrder.orderNumber,
        rating: normalizedRating,
        title: trimmedTitle || null,
        comment: trimmedComment,
        images: uploadedImages,
        status: "approved",
        isVerifiedPurchase: true,
      },
    });

    res.status(201).json({
      success: true,
      data: { ...review, images: mapReviewImages(review.images || []) },
    });
  } catch (error) {
    console.error("Product review create error:", error);
    res.status(500).json({ success: false, error: "Failed to submit review" });
  }
};

module.exports = {
  listProductReviews,
  createProductReview,
};
