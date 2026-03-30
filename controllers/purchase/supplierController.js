const { prisma } = require("../../config/database");
const { uploadToS3, getPresignedUrl, deleteFromS3 } = require("../../utils/purchase/uploadsS3");

// Get all suppliers
const getAllSuppliers = async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Convert attachment keys to pre-signed URLs (expires in 1 hour)
    const suppliersWithUrls = await Promise.all(
      suppliers.map(async (supplier) => ({
        ...supplier,
        attachments: supplier.attachments
          ? getPresignedUrl(supplier.attachments, 3600)
          : null,
      }))
    );

    res.status(200).json({
      success: true,
      count: suppliersWithUrls.length,
      data: suppliersWithUrls,
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch suppliers",
      message: error.message,
    });
  }
};

// Get supplier by ID
const getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;

    const supplier = await prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: "Supplier not found",
      });
    }

    // Convert attachment key to pre-signed URL (expires in 1 hour)
    const supplierWithUrl = {
      ...supplier,
      attachments: supplier.attachments
        ? getPresignedUrl(supplier.attachments, 3600)
        : null,
    };

    res.status(200).json({
      success: true,
      data: supplierWithUrl,
    });
  } catch (error) {
    console.error("Error fetching supplier:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch supplier",
      message: error.message,
    });
  }
};

// Create supplier
const createSupplier = async (req, res) => {
  try {
    const {
      name,
      supplierType,
      contactPersonName,
      phone,
      alternatePhone,
      email,
      billingAddressLine1,
      billingAddressLine2,
      city,
      state,
      postalCode,
      country,
      shippingAddressSameAsBilling,
      shippingAddressLine1,
      shippingAddressLine2,
      shippingCity,
      shippingState,
      shippingPostalCode,
      shippingCountry,
      taxId,
      remarks,
      status,
    } = req.body;

    // Validation - only check truly required fields
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        required: ["name", "email", "phone"],
      });
    }

    // Handle file upload to S3
    let attachmentUrl = null;
    if (req.file) {
      attachmentUrl = await uploadToS3(req.file, "supplier-attachments");
    }

    // Parse boolean from string (FormData sends everything as strings)
    const isSameAddress =
      shippingAddressSameAsBilling === "true" ||
      shippingAddressSameAsBilling === true;

    const supplier = await prisma.supplier.create({
      data: {
        name,
        supplierType,
        contactPersonName,
        phone,
        alternatePhone: alternatePhone || null,
        email,
        billingAddressLine1,
        billingAddressLine2: billingAddressLine2 || null,
        city,
        state,
        postalCode,
        country,
        shippingAddressSameAsBilling: isSameAddress,
        shippingAddressLine1: shippingAddressLine1 || null,
        shippingAddressLine2: shippingAddressLine2 || null,
        shippingCity: shippingCity || null,
        shippingState: shippingState || null,
        shippingPostalCode: shippingPostalCode || null,
        shippingCountry: shippingCountry || null,
        taxId: taxId || null,
        remarks: remarks || null,
        attachments: attachmentUrl,
        status: status || "active",
      },
    });

    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Error creating supplier:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create supplier",
      message: error.message,
    });
  }
};

// Update supplier
const updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      id: _, 
      createdAt, 
      updatedAt, 
      removeAttachment,
      keepExistingAttachment,
      ...updateData 
    } = req.body;

    // Check if supplier exists
    const existingSupplier = await prisma.supplier.findUnique({
      where: { id },
    });

    if (!existingSupplier) {
      return res.status(404).json({
        success: false,
        error: "Supplier not found",
      });
    }

    // Handle file attachment logic
    if (req.file) {
      // New file uploaded - delete old and upload new
      if (existingSupplier.attachments) {
        try {
          await deleteFromS3(existingSupplier.attachments);
        } catch (error) {
          console.error("Error deleting old attachment:", error);
        }
      }
      updateData.attachments = await uploadToS3(req.file, "supplier-attachments");
    } else if (removeAttachment === "true") {
      // User explicitly removed the attachment
      if (existingSupplier.attachments) {
        try {
          await deleteFromS3(existingSupplier.attachments);
        } catch (error) {
          console.error("Error deleting attachment:", error);
        }
      }
      updateData.attachments = null;
    } else if (keepExistingAttachment === "true") {
      // Keep existing attachment - don't modify it
      delete updateData.attachments;
    }

    // Parse boolean from string (FormData sends everything as strings)
    if (updateData.shippingAddressSameAsBilling !== undefined) {
      updateData.shippingAddressSameAsBilling =
        updateData.shippingAddressSameAsBilling === "true" ||
        updateData.shippingAddressSameAsBilling === true;
    }

    // Convert empty strings to null for optional fields
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === "" && key !== "attachments") {
        updateData[key] = null;
      }
    });

    const supplier = await prisma.supplier.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Supplier updated successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Error updating supplier:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update supplier",
      message: error.message,
    });
  }
};

// Delete supplier
const deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.supplier.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Supplier deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete supplier",
      message: error.message,
    });
  }
};

module.exports = {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};
