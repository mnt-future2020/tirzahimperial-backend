const { prisma } = require("../../config/database");

// Define available policy types
const POLICY_TYPES = [
  {
    type: "privacy",
    title: "Privacy Policy",
    slug: "privacy-policy",
    description: "How we collect, use, and protect user data",
  },
  {
    type: "terms",
    title: "Terms & Conditions",
    slug: "terms-conditions",
    description: "Terms of service and user agreements",
  },
  {
    type: "returns",
    title: "Returns & Refunds Policy",
    slug: "returns-refunds",
    description: "Product return and refund guidelines",
  },
  {
    type: "shipping",
    title: "Shipping Policy",
    slug: "shipping-policy",
    description: "Shipping methods, costs, and delivery times",
  },
  {
    type: "cookie",
    title: "Cookie Policy",
    slug: "cookie-policy",
    description: "How we use cookies and tracking technologies",
  },
];

// Get all policies
const getAllPolicies = async (req, res) => {
  try {
    console.log("Fetching all policies...");

    const policies = await prisma.policy.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(`Found ${policies.length} policies`);

    // Merge with POLICY_TYPES to ensure all types are represented
    const allPolicies = POLICY_TYPES.map((policyType) => {
      const existingPolicy = policies.find((p) => p.policyType === policyType.type);
      if (existingPolicy) {
        return existingPolicy;
      }
      // Return default values for policies without data
      return {
        id: null,
        policyType: policyType.type,
        title: policyType.title,
        slug: policyType.slug,
        content: "",
        isActive: true,
        isPublished: false,
        version: 1,
        lastUpdated: null,
        createdAt: null,
        updatedAt: null,
      };
    });

    res.status(200).json({
      success: true,
      data: allPolicies,
    });
  } catch (error) {
    console.error("Error fetching policies:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch policies",
      message: error.message,
    });
  }
};

// Get single policy by type
const getPolicyByType = async (req, res) => {
  try {
    const { type } = req.params;

    console.log(`Fetching policy: ${type}`);

    // Validate policy type
    const policyTypeInfo = POLICY_TYPES.find((pt) => pt.type === type);
    if (!policyTypeInfo) {
      return res.status(400).json({
        success: false,
        error: "Invalid policy type",
      });
    }

    const policy = await prisma.policy.findUnique({
      where: { policyType: type },
    });

    if (!policy) {
      // Return default values if not found
      return res.status(200).json({
        success: true,
        data: {
          policyType: policyTypeInfo.type,
          title: policyTypeInfo.title,
          slug: policyTypeInfo.slug,
          content: "",
          isActive: true,
          isPublished: false,
          version: 1,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: policy,
    });
  } catch (error) {
    console.error("Error fetching policy:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch policy",
      message: error.message,
    });
  }
};

// Get published policy by slug (for public access)
const getPublishedPolicyBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    console.log(`Fetching published policy: ${slug}`);

    const policy = await prisma.policy.findFirst({
      where: {
        slug: slug,
        isPublished: true,
        isActive: true,
      },
    });

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: "Policy not found or not published",
      });
    }

    res.status(200).json({
      success: true,
      data: policy,
    });
  } catch (error) {
    console.error("Error fetching published policy:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch policy",
      message: error.message,
    });
  }
};

// Create or update policy
const savePolicy = async (req, res) => {
  try {
    const { policyType, title, content, isActive, isPublished } = req.body;

    // Validation
    if (!policyType || !policyType.trim()) {
      return res.status(400).json({
        success: false,
        error: "Policy type is required",
      });
    }

    // Validate policy type
    const policyTypeInfo = POLICY_TYPES.find((pt) => pt.type === policyType);
    if (!policyTypeInfo) {
      return res.status(400).json({
        success: false,
        error: "Invalid policy type",
      });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: "Title is required",
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: "Content is required",
      });
    }

    console.log(`Saving policy: ${policyType}`);

    // Check if policy already exists
    const existingPolicy = await prisma.policy.findUnique({
      where: { policyType: policyType.trim() },
    });

    const policyData = {
      policyType: policyType.trim(),
      title: title.trim(),
      slug: policyTypeInfo.slug,
      content: content.trim(),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      isPublished: isPublished !== undefined ? Boolean(isPublished) : false,
      lastUpdated: new Date(),
    };

    let policy;

    if (existingPolicy) {
      // Update existing policy and increment version
      policy = await prisma.policy.update({
        where: { id: existingPolicy.id },
        data: {
          ...policyData,
          version: existingPolicy.version + 1,
        },
      });
      console.log(`Policy updated: ${policyType} (v${policy.version})`);
    } else {
      // Create new policy
      policy = await prisma.policy.create({
        data: policyData,
      });
      console.log(`Policy created: ${policyType}`);
    }

    res.status(200).json({
      success: true,
      message: "Policy saved successfully",
      data: policy,
    });
  } catch (error) {
    console.error("Error saving policy:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save policy",
      message: error.message,
    });
  }
};

// Delete policy
const deletePolicy = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Deleting policy: ${id}`);

    // Check if policy exists
    const policy = await prisma.policy.findUnique({
      where: { id },
    });

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: "Policy not found",
      });
    }

    // Delete policy from database
    await prisma.policy.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Policy deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting policy:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete policy",
      message: error.message,
    });
  }
};

// Toggle policy publish status
const togglePublishPolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { isPublished } = req.body;

    console.log(`Toggling publish status for policy: ${id}`);

    // Check if policy exists
    const policy = await prisma.policy.findUnique({
      where: { id },
    });

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: "Policy not found",
      });
    }

    // Update publish status
    const updatedPolicy = await prisma.policy.update({
      where: { id },
      data: {
        isPublished: Boolean(isPublished),
        lastUpdated: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      message: `Policy ${isPublished ? "published" : "unpublished"} successfully`,
      data: updatedPolicy,
    });
  } catch (error) {
    console.error("Error toggling policy publish status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update policy status",
      message: error.message,
    });
  }
};

module.exports = {
  getAllPolicies,
  getPolicyByType,
  getPublishedPolicyBySlug,
  savePolicy,
  deletePolicy,
  togglePublishPolicy,
};
