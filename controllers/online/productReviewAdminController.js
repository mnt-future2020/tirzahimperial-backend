const { prisma } = require("../../config/database");
const { getProxyImageUrl } = require("../../utils/common/imageProxy");

const mapReviewImages = (images = []) =>
  images.map((img) => getProxyImageUrl(img));

const listAdminReviews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = "all",
      rating,
      productId,
      search,
    } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = {};
    if (status && status !== "all") where.status = status;
    if (rating) where.rating = parseInt(rating, 10);
    if (productId) where.productId = productId;
    if (search) {
      where.OR = [
        { productName: { contains: search, mode: "insensitive" } },
        { userName: { contains: search, mode: "insensitive" } },
        { userEmail: { contains: search, mode: "insensitive" } },
        { orderNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    const [reviews, total] = await Promise.all([
      prisma.productReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.productReview.count({ where }),
    ]);

    res.json({
      success: true,
      data: reviews.map((review) => ({
        ...review,
        images: mapReviewImages(review.images || []),
      })),
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error("Admin review list error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch reviews" });
  }
};

const updateReviewStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body || {};

    if (!["approved", "pending", "rejected", "hidden"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }

    const review = await prisma.productReview.findUnique({ where: { id } });
    if (!review) {
      return res.status(404).json({ success: false, error: "Review not found" });
    }

    const updated = await prisma.productReview.update({
      where: { id },
      data: {
        status,
        adminNote: adminNote ? String(adminNote).trim() : null,
      },
    });

    res.json({
      success: true,
      data: { ...updated, images: mapReviewImages(updated.images || []) },
    });
  } catch (error) {
    console.error("Admin review update error:", error);
    res.status(500).json({ success: false, error: "Failed to update review" });
  }
};

module.exports = {
  listAdminReviews,
  updateReviewStatus,
};
