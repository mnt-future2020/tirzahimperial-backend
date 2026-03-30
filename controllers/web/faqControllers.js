const dbModule = require("../../config/database");
const prisma = dbModule?.prisma || dbModule;

if (!prisma) {
  console.error("Prisma client is not initialized in config/database. Check database.js export.");
}

// Get all FAQs
const getFaqs = async (req, res) => {
  try {
    const faqs = await prisma.faq.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
    res.status(200).json({ success: true, data: faqs });
  } catch (error) {
    console.error("Error fetching faqs:", error);
    res.status(500).json({ success: false, error: "Failed to fetch faqs", message: error.message });
  }
};

// Get only active FAQs
const getActiveFaqs = async (req, res) => {
  try {
    const faqs = await prisma.faq.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
    res.status(200).json({ success: true, data: faqs });
  } catch (error) {
    console.error("Error fetching active faqs:", error);
    res.status(500).json({ success: false, error: "Failed to fetch active faqs", message: error.message });
  }
};

// Get single FAQ
const getFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const faq = await prisma.faq.findUnique({ where: { id } });
    if (!faq) return res.status(404).json({ success: false, error: "FAQ not found" });
    res.status(200).json({ success: true, data: faq });
  } catch (error) {
    console.error("Error fetching faq:", error);
    res.status(500).json({ success: false, error: "Failed to fetch faq" });
  }
};

// Create FAQ
const createFaq = async (req, res) => {
  try {
    const { title, contents, sortOrder } = req.body;
    const force = req.query?.force === 'true';

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: "Title is required" });
    }

    // If sortOrder provided, check for conflicts
    if (sortOrder !== undefined && sortOrder !== null) {
      const conflict = await prisma.faq.findFirst({ where: { sortOrder: Number(sortOrder) } });
      if (conflict) {
        if (!force) {
          return res.status(409).json({ success: false, error: 'Sort order conflict', conflict: { id: conflict.id, title: conflict.title, sortOrder: conflict.sortOrder } });
        }
        // force replace: clear existing sortOrder
        await prisma.faq.update({ where: { id: conflict.id }, data: { sortOrder: null } });
      }
    }

    const faq = await prisma.faq.create({ data: { title: title.trim(), contents: contents || [], sortOrder: sortOrder !== undefined ? Number(sortOrder) : null } });
    res.status(201).json({ success: true, message: "FAQ created", data: faq });
  } catch (error) {
    console.error("Error creating faq:", error);
    res.status(500).json({ success: false, error: "Failed to create faq", message: error.message });
  }
};

// Update FAQ
const updateFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, contents, isActive, sortOrder } = req.body;
    const force = req.query?.force === 'true';

    const existing = await prisma.faq.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "FAQ not found" });

    // Handle sortOrder conflict
    if (sortOrder !== undefined && sortOrder !== null) {
      const conflict = await prisma.faq.findFirst({ where: { sortOrder: Number(sortOrder) } });
      if (conflict && conflict.id !== id) {
        if (!force) {
          return res.status(409).json({ success: false, error: 'Sort order conflict', conflict: { id: conflict.id, title: conflict.title, sortOrder: conflict.sortOrder } });
        }
        // force: swap sort orders between existing and conflict (preserve previous order)
        const prevOrder = existing.sortOrder !== undefined ? existing.sortOrder : null;
        try {
          if (prisma.$transaction) {
            await prisma.$transaction([
              prisma.faq.update({ where: { id: conflict.id }, data: { sortOrder: prevOrder } }),
              prisma.faq.update({ where: { id }, data: { sortOrder: Number(sortOrder) } }),
            ]);
          } else {
            // fallback: sequential updates
            await prisma.faq.update({ where: { id: conflict.id }, data: { sortOrder: prevOrder } });
            await prisma.faq.update({ where: { id }, data: { sortOrder: Number(sortOrder) } });
          }
        } catch (txErr) {
          console.error('Failed to swap sort orders:', txErr);
          return res.status(500).json({ success: false, error: 'Failed to swap sort orders', message: txErr.message });
        }
        // update other fields below via normal update
      }
    }

    const data = {};
    if (title !== undefined) data.title = title;
    if (contents !== undefined) data.contents = contents;
    if (isActive !== undefined) data.isActive = isActive;
    if (sortOrder !== undefined) data.sortOrder = sortOrder !== null ? Number(sortOrder) : null;

    const updated = await prisma.faq.update({ where: { id }, data });
    res.status(200).json({ success: true, message: "FAQ updated", data: updated });
  } catch (error) {
    console.error("Error updating faq:", error);
    res.status(500).json({ success: false, error: "Failed to update faq", message: error.message });
  }
};

// Delete FAQ
const deleteFaq = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.faq.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "FAQ not found" });

    await prisma.faq.delete({ where: { id } });
    res.status(200).json({ success: true, message: "FAQ deleted" });
  } catch (error) {
    console.error("Error deleting faq:", error);
    res.status(500).json({ success: false, error: "Failed to delete faq", message: error.message });
  }
};

module.exports = { getFaqs, getFaq, createFaq, updateFaq, deleteFaq ,getActiveFaqs};
