const { prisma } = require("../../config/database");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { sendEmailWithEnv } = require("../../config/connectSMTP");
const {
  getApprovedEmailTemplate,
  getRejectedEmailTemplate,
  getSuspendedEmailTemplate,
} = require("../../utils/email/templates/delivery-partner");
const {
  uploadProfilePhotoToS3,
  uploadAadharToS3,
  uploadLicenseToS3,
  uploadVehicleRCToS3,
  uploadInsuranceToS3,
  uploadPollutionCertToS3,
  uploadIdProofToS3,
  deleteFromS3,
  getPresignedUrl,
} = require("../../utils/delivery/uploadS3");

async function generatePartnerId() {
  try {
    const lastPartner = await prisma.deliveryPartner.findFirst({
      where: { partnerId: { not: null } },
      orderBy: { partnerId: 'desc' },
      select: { partnerId: true }
    });

    if (!lastPartner || !lastPartner.partnerId) {
      return 'DP001';
    }

    const lastNumber = parseInt(lastPartner.partnerId.replace('DP', ''));
    const newNumber = lastNumber + 1;
    return `DP${String(newNumber).padStart(3, '0')}`;
  } catch (error) {
    console.error('Error generating partner ID:', error);
    throw new Error('Failed to generate partner ID');
  }
}

// Generate random password
function generatePassword(length = 12) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// Send approval email with credentials
async function sendApprovalEmail(partner, password) {
  try {
    const emailTemplate = await getApprovedEmailTemplate({
      name: partner.name,
      email: partner.email,
      partnerId: partner.partnerId,
      password: password,
      verificationToken: partner.emailVerificationToken,
    });

    const result = await sendEmailWithEnv({
      to: partner.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    if (result.success) {
      console.log(`✅ Approval email sent to: ${partner.email}`);
    } else {
      console.error(`❌ Failed to send approval email: ${result.message}`);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error("❌ Error sending approval email:", error);
    throw error;
  }
}

// Send rejection email
async function sendRejectionEmail(partner, reason, note) {
  try {
    const emailTemplate = await getRejectedEmailTemplate({
      name: partner.name,
      email: partner.email,
      reason: reason || "Not specified",
      note: note || "",
    });

    const result = await sendEmailWithEnv({
      to: partner.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    if (result.success) {
      console.log(`✅ Rejection email sent to: ${partner.email}`);
    } else {
      console.error(`❌ Failed to send rejection email: ${result.message}`);
    }
  } catch (error) {
    console.error("❌ Error sending rejection email:", error);
  }
}

// Send suspension email
async function sendSuspensionEmail(partner, reason, note) {
  try {
    const emailTemplate = await getSuspendedEmailTemplate({
      name: partner.name,
      email: partner.email,
      partnerId: partner.partnerId,
      reason: reason,
      note: note,
    });

    const result = await sendEmailWithEnv({
      to: partner.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    if (result.success) {
      console.log(`✅ Suspension email sent to: ${partner.email}`);
    } else {
      console.error(`❌ Failed to send suspension email: ${result.message}`);
    }
  } catch (error) {
    console.error("❌ Error sending suspension email:", error);
  }
}

// ============================================
// CRUD OPERATIONS
// ============================================

/**
 * Create a new delivery partner
 */
const createDeliveryPartner = async (req, res) => {
  let uploadedFiles = {};
  
  try {
    const {
      name,
      email,
      phone,
      dateOfBirth,
      gender,
      alternateMobileNumber,
      vehicleType,
      vehicleModel,
      vehicleNumber,
      licenseNumber,
      aadharNumber,
      address,
      city,
      state,
      pincode,
      country,
      insuranceValidityDate,
      pollutionCertificateValidity,
      emergencyContactName,
      emergencyRelationship,
      emergencyContactNumber,
      applicationStatus,
      password: adminProvidedPassword, // Admin can provide custom password
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !vehicleType || !vehicleNumber || !licenseNumber) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    // Check if email already exists
    const existingEmail = await prisma.deliveryPartner.findUnique({
      where: { email },
    });

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    // Check if phone already exists
    const existingPhone = await prisma.deliveryPartner.findFirst({
      where: { phone },
    });

    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number already registered",
      });
    }

    // Check if vehicle number already exists
    const existingVehicle = await prisma.deliveryPartner.findUnique({
      where: { vehicleNumber },
    });

    if (existingVehicle) {
      return res.status(400).json({
        success: false,
        message: "Vehicle number already registered",
      });
    }

    // Check if license number already exists
    const existingLicense = await prisma.deliveryPartner.findUnique({
      where: { licenseNumber },
    });

    if (existingLicense) {
      return res.status(400).json({
        success: false,
        message: "License number already registered",
      });
    }

    const initialStatus = applicationStatus || "pending";
    
    if (!["pending", "verified", "approved", "rejected"].includes(initialStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be pending, verified, approved, or rejected",
      });
    }

    const tempId = `temp-${Date.now()}`;
    
    // Handle file uploads if present
    if (req.files) {
      console.log("📤 Uploading documents to S3...");
      
      if (req.files.profilePhoto) {
        uploadedFiles.profilePhoto = await uploadProfilePhotoToS3(req.files.profilePhoto[0], tempId);
      }
      if (req.files.aadharDocument) {
        uploadedFiles.aadharDocument = await uploadAadharToS3(req.files.aadharDocument[0], tempId);
      }
      if (req.files.licenseDocument) {
        uploadedFiles.licenseDocument = await uploadLicenseToS3(req.files.licenseDocument[0], tempId);
      }
      if (req.files.vehicleRCDocument) {
        uploadedFiles.vehicleRCDocument = await uploadVehicleRCToS3(req.files.vehicleRCDocument[0], tempId);
      }
      if (req.files.insuranceDocument) {
        uploadedFiles.insuranceDocument = await uploadInsuranceToS3(req.files.insuranceDocument[0], tempId);
      }
      if (req.files.pollutionCertDocument) {
        uploadedFiles.pollutionCertDocument = await uploadPollutionCertToS3(req.files.pollutionCertDocument[0], tempId);
      }
      if (req.files.idProofDocument) {
        uploadedFiles.idProofDocument = await uploadIdProofToS3(req.files.idProofDocument[0], tempId);
      }
    }

    const partnerData = {
      name,
      email,
      phone,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      gender: gender || undefined,
      alternateMobileNumber: alternateMobileNumber || undefined,
      vehicleType,
      vehicleModel: vehicleModel || undefined,
      vehicleNumber,
      licenseNumber,
      aadharNumber: aadharNumber || undefined,
      address: address || "",
      city: city || "",
      state: state || "",
      pincode: pincode || "",
      country: country || "India",
      insuranceValidityDate: insuranceValidityDate ? new Date(insuranceValidityDate) : undefined,
      pollutionCertificateValidity: pollutionCertificateValidity ? new Date(pollutionCertificateValidity) : undefined,
      emergencyContactName: emergencyContactName || undefined,
      emergencyRelationship: emergencyRelationship || undefined,
      emergencyContactNumber: emergencyContactNumber || undefined,
      applicationStatus: initialStatus,
      ...uploadedFiles,
    };

    // If status is approved, create credentials
    if (initialStatus === "approved") {
      const partnerId = await generatePartnerId();
      
      // Use admin-provided password if available, otherwise auto-generate
      const password = adminProvidedPassword && adminProvidedPassword.trim() 
        ? adminProvidedPassword.trim() 
        : generatePassword();
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const emailVerificationToken = crypto.randomBytes(32).toString("hex");

      partnerData.partnerId = partnerId;
      partnerData.partnerStatus = "active";
      partnerData.approvedAt = new Date();
      partnerData.password = hashedPassword;
      partnerData.emailVerificationToken = emailVerificationToken;
      partnerData.isEmailVerified = false;
      partnerData.statusHistory = [{
        fromStatus: null,
        toStatus: initialStatus,
        reason: null,
        note: "Partner created with approved status",
        changedAt: new Date().toISOString(),
      }];

      const deliveryPartner = await prisma.deliveryPartner.create({
        data: partnerData,
      });

      // Send approval email with credentials and verification link
      await sendApprovalEmail(deliveryPartner, password);

      return res.status(201).json({
        success: true,
        message: "Delivery partner created and approved. Verification email sent.",
        data: { ...deliveryPartner, password: undefined },
      });
    }

    const deliveryPartner = await prisma.deliveryPartner.create({
      data: {
        ...partnerData,
        statusHistory: [{
          fromStatus: null,
          toStatus: initialStatus,
          reason: null,
          note: `Partner created with ${initialStatus} status`,
          changedAt: new Date().toISOString(),
        }],
      },
    });

    res.status(201).json({
      success: true,
      message: "Delivery partner created successfully",
      data: deliveryPartner,
    });
  } catch (error) {
    console.error("Error creating delivery partner:", error);
    
    if (Object.keys(uploadedFiles).length > 0) {
      console.log("🧹 Cleaning up uploaded files due to error...");
      for (const fileKey of Object.values(uploadedFiles)) {
        try {
          await deleteFromS3(fileKey);
        } catch (deleteError) {
          console.error("Error deleting file:", deleteError);
        }
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Failed to create delivery partner",
      error: error.message,
    });
  }
};

/**
 * Get all delivery partners with filters
 */
const getAllDeliveryPartners = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      vehicleType = "",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { vehicleNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status) {
      where.applicationStatus = status;
    }

    if (vehicleType) {
      where.vehicleType = vehicleType;
    }

    const totalCount = await prisma.deliveryPartner.count({ where });

    const deliveryPartners = await prisma.deliveryPartner.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { [sortBy]: sortOrder },
    });

    const partnersWithUrls = await Promise.all(
      deliveryPartners.map(async (partner) => ({
        ...partner,
        password: undefined,
        profilePhotoUrl: partner.profilePhoto 
          ? await getPresignedUrl(partner.profilePhoto, 3600) 
          : null,
        aadharDocumentUrl: partner.aadharDocument 
          ? await getPresignedUrl(partner.aadharDocument, 3600) 
          : null,
        licenseDocumentUrl: partner.licenseDocument 
          ? await getPresignedUrl(partner.licenseDocument, 3600) 
          : null,
        vehicleRCDocumentUrl: partner.vehicleRCDocument 
          ? await getPresignedUrl(partner.vehicleRCDocument, 3600) 
          : null,
        insuranceDocumentUrl: partner.insuranceDocument 
          ? await getPresignedUrl(partner.insuranceDocument, 3600) 
          : null,
        pollutionCertDocumentUrl: partner.pollutionCertDocument 
          ? await getPresignedUrl(partner.pollutionCertDocument, 3600) 
          : null,
        idProofDocumentUrl: partner.idProofDocument 
          ? await getPresignedUrl(partner.idProofDocument, 3600) 
          : null,
      }))
    );

    res.json({
      success: true,
      data: partnersWithUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + deliveryPartners.length < totalCount,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching delivery partners:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch delivery partners",
      error: error.message,
    });
  }
};

/**
 * Get delivery partner by ID
 */
const getDeliveryPartnerById = async (req, res) => {
  try {
    const { id } = req.params;

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({
        success: false,
        message: "Delivery partner not found",
      });
    }

    // Get completed orders count
    const completedOrdersCount = await prisma.onlineOrder.count({
      where: {
        deliveryPartnerId: id,
        orderStatus: 'delivered',
      },
    });

    // Get recent completed orders
    const recentCompletedOrders = await prisma.onlineOrder.findMany({
      where: {
        deliveryPartnerId: id,
        orderStatus: 'delivered',
      },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        total: true,
        deliveredAt: true,
      },
      orderBy: {
        deliveredAt: 'desc',
      },
      take: 10,
    });

    const partnerWithUrls = {
      ...deliveryPartner,
      password: undefined,
      completedOrdersCount,
      recentCompletedOrders,
      profilePhotoUrl: deliveryPartner.profilePhoto 
        ? await getPresignedUrl(deliveryPartner.profilePhoto, 3600) 
        : null,
      aadharDocumentUrl: deliveryPartner.aadharDocument 
        ? await getPresignedUrl(deliveryPartner.aadharDocument, 3600) 
        : null,
      licenseDocumentUrl: deliveryPartner.licenseDocument 
        ? await getPresignedUrl(deliveryPartner.licenseDocument, 3600) 
        : null,
      vehicleRCDocumentUrl: deliveryPartner.vehicleRCDocument 
        ? await getPresignedUrl(deliveryPartner.vehicleRCDocument, 3600) 
        : null,
      insuranceDocumentUrl: deliveryPartner.insuranceDocument 
        ? await getPresignedUrl(deliveryPartner.insuranceDocument, 3600) 
        : null,
      pollutionCertDocumentUrl: deliveryPartner.pollutionCertDocument 
        ? await getPresignedUrl(deliveryPartner.pollutionCertDocument, 3600) 
        : null,
      idProofDocumentUrl: deliveryPartner.idProofDocument 
        ? await getPresignedUrl(deliveryPartner.idProofDocument, 3600) 
        : null,
    };

    res.json({
      success: true,
      data: partnerWithUrls,
    });
  } catch (error) {
    console.error("Error fetching delivery partner:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch delivery partner",
      error: error.message,
    });
  }
};

/**
 * Update delivery partner
 */
const updateDeliveryPartner = async (req, res) => {
  let uploadedFiles = {};
  let oldFiles = {};
  
  try {
    const { id } = req.params;
    const updateData = req.body;

    const existingPartner = await prisma.deliveryPartner.findUnique({
      where: { id },
    });

    if (!existingPartner) {
      return res.status(404).json({
        success: false,
        message: "Delivery partner not found",
      });
    }

    // Check for unique field conflicts
    if (updateData.email && updateData.email !== existingPartner.email) {
      const emailExists = await prisma.deliveryPartner.findUnique({
        where: { email: updateData.email },
      });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already registered",
        });
      }
    }

    if (updateData.phone && updateData.phone !== existingPartner.phone) {
      const phoneExists = await prisma.deliveryPartner.findFirst({
        where: { phone: updateData.phone },
      });
      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: "Phone number already registered",
        });
      }
    }

    if (updateData.vehicleNumber && updateData.vehicleNumber !== existingPartner.vehicleNumber) {
      const vehicleExists = await prisma.deliveryPartner.findUnique({
        where: { vehicleNumber: updateData.vehicleNumber },
      });
      if (vehicleExists) {
        return res.status(400).json({
          success: false,
          message: "Vehicle number already registered",
        });
      }
    }

    if (updateData.licenseNumber && updateData.licenseNumber !== existingPartner.licenseNumber) {
      const licenseExists = await prisma.deliveryPartner.findUnique({
        where: { licenseNumber: updateData.licenseNumber },
      });
      if (licenseExists) {
        return res.status(400).json({
          success: false,
          message: "License number already registered",
        });
      }
    }

    const uploadId = existingPartner.partnerId || id;

    // Handle file uploads if present
    if (req.files) {
      console.log("📤 Uploading new documents to S3...");
      
      if (req.files.profilePhoto) {
        oldFiles.profilePhoto = existingPartner.profilePhoto;
        uploadedFiles.profilePhoto = await uploadProfilePhotoToS3(req.files.profilePhoto[0], uploadId);
      }
      if (req.files.aadharDocument) {
        oldFiles.aadharDocument = existingPartner.aadharDocument;
        uploadedFiles.aadharDocument = await uploadAadharToS3(req.files.aadharDocument[0], uploadId);
      }
      if (req.files.licenseDocument) {
        oldFiles.licenseDocument = existingPartner.licenseDocument;
        uploadedFiles.licenseDocument = await uploadLicenseToS3(req.files.licenseDocument[0], uploadId);
      }
      if (req.files.vehicleRCDocument) {
        oldFiles.vehicleRCDocument = existingPartner.vehicleRCDocument;
        uploadedFiles.vehicleRCDocument = await uploadVehicleRCToS3(req.files.vehicleRCDocument[0], uploadId);
      }
      if (req.files.insuranceDocument) {
        oldFiles.insuranceDocument = existingPartner.insuranceDocument;
        uploadedFiles.insuranceDocument = await uploadInsuranceToS3(req.files.insuranceDocument[0], uploadId);
      }
      if (req.files.pollutionCertDocument) {
        oldFiles.pollutionCertDocument = existingPartner.pollutionCertDocument;
        uploadedFiles.pollutionCertDocument = await uploadPollutionCertToS3(req.files.pollutionCertDocument[0], uploadId);
      }
      if (req.files.idProofDocument) {
        oldFiles.idProofDocument = existingPartner.idProofDocument;
        uploadedFiles.idProofDocument = await uploadIdProofToS3(req.files.idProofDocument[0], uploadId);
      }
    }

    // Process date fields if present
    if (updateData.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateData.dateOfBirth);
    }
    if (updateData.insuranceValidityDate) {
      updateData.insuranceValidityDate = new Date(updateData.insuranceValidityDate);
    }
    if (updateData.pollutionCertificateValidity) {
      updateData.pollutionCertificateValidity = new Date(updateData.pollutionCertificateValidity);
    }

    const finalUpdateData = {
      ...updateData,
      ...uploadedFiles,
    };

    const updatedPartner = await prisma.deliveryPartner.update({
      where: { id },
      data: finalUpdateData,
    });

    // Delete old files from S3
    if (Object.keys(oldFiles).length > 0) {
      console.log("🧹 Deleting old files from S3...");
      for (const [key, fileKey] of Object.entries(oldFiles)) {
        if (fileKey) {
          try {
            await deleteFromS3(fileKey);
          } catch (deleteError) {
            console.error(`Error deleting old ${key}:`, deleteError);
          }
        }
      }
    }

    res.json({
      success: true,
      message: "Delivery partner updated successfully",
      data: { ...updatedPartner, password: undefined },
    });
  } catch (error) {
    console.error("Error updating delivery partner:", error);
    
    if (Object.keys(uploadedFiles).length > 0) {
      console.log("🧹 Cleaning up newly uploaded files due to error...");
      for (const fileKey of Object.values(uploadedFiles)) {
        try {
          await deleteFromS3(fileKey);
        } catch (deleteError) {
          console.error("Error deleting file:", deleteError);
        }
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Failed to update delivery partner",
      error: error.message,
    });
  }
};

/**
 * Update delivery partner status (legacy)
 */
const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["pending", "verified", "approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be pending, verified, approved, or rejected",
      });
    }

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({
        success: false,
        message: "Delivery partner not found",
      });
    }

    const updatedPartner = await prisma.deliveryPartner.update({
      where: { id },
      data: { applicationStatus: status },
    });

    res.json({
      success: true,
      message: `Delivery partner status updated to ${status}`,
      data: { ...updatedPartner, password: undefined },
    });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
      error: error.message,
    });
  }
};

// ============================================
// PARTNER STATUS MANAGEMENT
// ============================================

/**
 * Update application status (pending -> verified -> approved/rejected)
 */
const updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason, note } = req.body;

    if (!["verified", "approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be verified, approved, or rejected",
      });
    }

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Delivery partner not found",
      });
    }

    const currentStatus = partner.applicationStatus;
    
    if (currentStatus === "verified" && status === "pending") {
      return res.status(400).json({
        success: false,
        message: "Cannot change status back to pending from verified",
      });
    }

    if (currentStatus === "approved" || currentStatus === "rejected") {
      return res.status(400).json({
        success: false,
        message: `Cannot change status. Partner is already ${currentStatus}`,
      });
    }

    if (currentStatus === "pending" && status === "approved") {
      return res.status(400).json({
        success: false,
        message: "Partner must be verified before approval",
      });
    }

    let updateData = { applicationStatus: status };

    if (status === "approved") {
      const partnerId = await generatePartnerId();
      
      // Always auto-generate password when approving from status change
      // (Admin can only set custom password during initial creation)
      const password = generatePassword();
      const hashedPassword = await bcrypt.hash(password, 10);
      const emailVerificationToken = crypto.randomBytes(32).toString("hex");

      updateData = {
        ...updateData,
        partnerId,
        partnerStatus: "active",
        approvedAt: new Date(),
        password: hashedPassword,
        emailVerificationToken: emailVerificationToken,
        isEmailVerified: false,
      };

      const updatedPartner = await prisma.deliveryPartner.update({
        where: { id },
        data: {
          ...updateData,
          statusHistory: {
            push: {
              fromStatus: currentStatus,
              toStatus: status,
              reason: reason || null,
              note: note || null,
              changedAt: new Date().toISOString(),
            },
          },
        },
      });

      // Send approval email with credentials and verification link
      await sendApprovalEmail(updatedPartner, password);

      return res.json({
        success: true,
        message: `Partner approved successfully. Verification email sent to ${updatedPartner.email}`,
        data: { ...updatedPartner, password: undefined },
      });
    }

    if (status === "rejected") {
      updateData = {
        ...updateData,
        rejectedAt: new Date(),
        rejectionReason: reason || "Not specified",
      };

      const updatedPartner = await prisma.deliveryPartner.update({
        where: { id },
        data: {
          ...updateData,
          statusHistory: {
            push: {
              fromStatus: currentStatus,
              toStatus: status,
              reason: reason || null,
              note: note || null,
              changedAt: new Date().toISOString(),
            },
          },
        },
      });

      // Send rejection email
      await sendRejectionEmail(updatedPartner, reason, note);

      return res.json({
        success: true,
        message: `Partner rejected. Notification sent to ${updatedPartner.email}`,
        data: { ...updatedPartner, password: undefined },
      });
    }

    // For verified status
    const updatedPartner = await prisma.deliveryPartner.update({
      where: { id },
      data: {
        ...updateData,
        statusHistory: {
          push: {
            fromStatus: currentStatus,
            toStatus: status,
            reason: reason || null,
            note: note || null,
            changedAt: new Date().toISOString(),
          },
        },
      },
    });

    res.json({
      success: true,
      message: `Partner ${status} successfully`,
      data: { ...updatedPartner, password: undefined },
    });
  } catch (error) {
    console.error("Error updating application status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update application status",
      error: error.message,
    });
  }
};

/**
 * Update partner status (active/inactive/suspended)
 */
const updatePartnerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, suspensionReason, suspensionNote } = req.body;

    if (!["active", "inactive", "suspended"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be active, inactive, or suspended",
      });
    }

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Delivery partner not found",
      });
    }

    if (partner.applicationStatus !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Partner status can only be updated for approved partners",
      });
    }

    if (status === "suspended") {
      if (!suspensionReason || !suspensionNote) {
        return res.status(400).json({
          success: false,
          message: "Suspension reason and note are required",
        });
      }

      if (suspensionNote.length < 20) {
        return res.status(400).json({
          success: false,
          message: "Suspension note must be at least 20 characters",
        });
      }
    }

    let updateData = { partnerStatus: status };

    if (status === "suspended") {
      updateData = {
        ...updateData,
        suspensionReason,
        suspensionNote,
        suspendedAt: new Date(),
      };
    } else {
      updateData = {
        ...updateData,
        suspensionReason: null,
        suspensionNote: null,
        suspendedAt: null,
      };
    }

    const updatedPartner = await prisma.deliveryPartner.update({
      where: { id },
      data: updateData,
    });

    // Send suspension email if suspended
    if (status === "suspended") {
      await sendSuspensionEmail(updatedPartner, suspensionReason, suspensionNote);
    }

    res.json({
      success: true,
      message: `Partner status updated to ${status}`,
      data: { ...updatedPartner, password: undefined },
    });
  } catch (error) {
    console.error("Error updating partner status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update partner status",
      error: error.message,
    });
  }
};

/**
 * Get approved partners (for manage profile)
 */
const getApprovedPartners = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      partnerStatus = "",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { applicationStatus: "approved" };

    if (search) {
      where.OR = [
        { partnerId: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    if (partnerStatus) {
      where.partnerStatus = partnerStatus;
    }

    const totalCount = await prisma.deliveryPartner.count({ where });

    const partners = await prisma.deliveryPartner.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { [sortBy]: sortOrder },
      select: {
        id: true,
        partnerId: true,
        name: true,
        email: true,
        phone: true,
        profilePhoto: true,
        vehicleType: true,
        vehicleNumber: true,
        licenseNumber: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        applicationStatus: true,
        partnerStatus: true,
        suspensionReason: true,
        suspensionNote: true,
        suspendedAt: true,
        isAvailable: true,
        rating: true,
        totalDeliveries: true,
        joiningDate: true,
        approvedAt: true,
        rejectedAt: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const partnersWithUrls = await Promise.all(
      partners.map(async (partner) => ({
        ...partner,
        profilePhotoUrl: partner.profilePhoto 
          ? await getPresignedUrl(partner.profilePhoto, 3600) 
          : null,
      }))
    );

    res.json({
      success: true,
      data: partnersWithUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + partners.length < totalCount,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching approved partners:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch approved partners",
      error: error.message,
    });
  }
};

/**
 * Get application status history
 */
const getStatusHistory = async (req, res) => {
  try {
    const { id } = req.params;

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id },
      select: { statusHistory: true },
    });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Delivery partner not found",
      });
    }

    res.json({
      success: true,
      data: partner.statusHistory || [],
    });
  } catch (error) {
    console.error("Error fetching status history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch status history",
      error: error.message,
    });
  }
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  createDeliveryPartner,
  getAllDeliveryPartners,
  getDeliveryPartnerById,
  updateDeliveryPartner,
  updateStatus,
  updateApplicationStatus,
  updatePartnerStatus,
  getApprovedPartners,
  getStatusHistory,
};
