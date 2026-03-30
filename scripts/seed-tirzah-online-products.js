/* eslint-disable no-console */
const path = require("path");
const dotenv = require("dotenv");
const { prisma } = require("../config/database");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const BRAND_NAME = "Tirzah Imperial";
const DEFAULT_HSN = "3304";
const DEFAULT_GST = 18;
const DEFAULT_BADGES = [
  { name: "New Arrival", sortOrder: 0 },
  { name: "Bestseller", sortOrder: 1 },
  { name: "Trending", sortOrder: 2 },
  { name: "Hot Deal", sortOrder: 3 },
  { name: "Limited Stock", sortOrder: 4 },
  { name: "Sale", sortOrder: 5 },
];

const SUBCATEGORY_BY_CATEGORY = {
  "Hair Oil": "Hair Care",
  Shampoo: "Hair Care",
  Gel: "Hair Care",
  "Hair Serum": "Hair Care",
  "Hair Spray": "Hair Care",
  "Hair Dye": "Hair Care",
  "Face Serum": "Face Care",
  "Face Pack": "Face Care",
  Cream: "Face Care",
  "Face Cleanser": "Face Care",
  Lotion: "Body Care",
  Soap: "Body Care",
  "Lip Serum": "Lip Care",
};

function parseVariantFromItemName(itemName) {
  const match = itemName.match(/^(.*)\s+(\d+(?:\.\d+)?)\s*(ml|g)$/i);
  if (!match) {
    return {
      baseName: itemName.trim(),
      sizeLabel: "Standard",
      sizeValue: 1,
      sizeUnit: "pcs",
    };
  }

  const baseName = match[1].trim();
  const sizeValue = Number(match[2]);
  const sizeUnit = match[3].toLowerCase();
  const sizeLabel = `${sizeValue}${sizeUnit}`;

  return {
    baseName,
    sizeLabel,
    sizeValue,
    sizeUnit,
  };
}

function stockStatus(quantity, lowStockAlertLevel) {
  if (quantity <= 0) return "out-of-stock";
  if (quantity <= lowStockAlertLevel) return "low-stock";
  return "in-stock";
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function buildVariant(item, parsed, isDefault) {
  const purchasePrice = Number(item.purchasePrice || 0);
  const gst = Number(item.gstPercentage || 0) > 0
    ? Number(item.gstPercentage)
    : DEFAULT_GST;
  const mrp = roundMoney(purchasePrice * 1.35);
  const sellingPrice = roundMoney(purchasePrice * 1.2);
  const quantity = Number(item.quantity || 0);
  const lowStock = Number(item.lowStockAlertLevel || 5);

  return {
    variantName: parsed.sizeLabel,
    displayName: `${parsed.baseName} ${parsed.sizeLabel}`,
    dropdownName: parsed.sizeLabel,
    variantSKU: item.itemCode || "",
    inventoryProductId: item.id,
    variantHSN: item.hsnCode || DEFAULT_HSN,
    variantBarcode: item.itemCode || "",
    variantColour: "",
    variantSize: parsed.sizeLabel,
    variantMaterial: "",
    customAttributes: [],
    variantUom: "pcs",
    variantUomValue: 1,
    variantGST: gst,
    discountType: "percent",
    variantDiscount: 0,
    variantMRP: mrp,
    variantSellingPrice: sellingPrice,
    variantPurchasePrice: purchasePrice,
    variantStockQuantity: quantity,
    variantLowStockAlert: lowStock,
    variantStockStatus: stockStatus(quantity, lowStock),
    variantWeight: parsed.sizeValue || 1,
    variantLength: 0,
    variantWidth: 0,
    variantHeight: 0,
    detailedDescription: `${parsed.baseName} - ${parsed.sizeLabel}`,
    variantStatus: "active",
    variantImages: item.itemImage ? [item.itemImage] : [],
    isDefault,
  };
}

function sortVariants(a, b) {
  if (a._sort.sizeUnit === b._sort.sizeUnit) {
    return a._sort.sizeValue - b._sort.sizeValue;
  }
  return a._sort.sizeUnit.localeCompare(b._sort.sizeUnit);
}

function getBadgeNameForCategory(category) {
  if (["Face Serum", "Cream", "Face Cleanser"].includes(category)) {
    return "Bestseller";
  }
  if (["Hair Oil", "Shampoo", "Hair Serum"].includes(category)) {
    return "Trending";
  }
  if (["Soap", "Lotion", "Lip Serum"].includes(category)) {
    return "Hot Deal";
  }
  return "New Arrival";
}

async function ensureBadges() {
  const badgeMap = new Map();

  for (const badge of DEFAULT_BADGES) {
    let badgeRecord = await prisma.badge.findFirst({
      where: { name: { equals: badge.name, mode: "insensitive" } },
    });

    if (!badgeRecord) {
      badgeRecord = await prisma.badge.create({
        data: {
          name: badge.name,
          isStatic: true,
          sortOrder: badge.sortOrder,
          enabledForHomepage: true,
        },
      });
    } else if (!badgeRecord.enabledForHomepage) {
      badgeRecord = await prisma.badge.update({
        where: { id: badgeRecord.id },
        data: { enabledForHomepage: true },
      });
    }

    badgeMap.set(badgeRecord.name.toLowerCase(), badgeRecord.id);
  }

  return badgeMap;
}

function buildFrequentlyBoughtTogether(products) {
  const entries = [];
  for (const product of products) {
    if (!Array.isArray(product.variants) || product.variants.length === 0) continue;
    entries.push(product);
  }

  // Configure add-ons only for a subset (some products), not all.
  const target = entries.slice(0, 14);

  return target.map((product) => {
    const sameSub = entries.filter(
      (p) => p.id !== product.id && p.subCategory === product.subCategory
    );
    const sameCategory = entries.filter(
      (p) => p.id !== product.id && p.category === product.category
    );
    const fallback = entries.filter((p) => p.id !== product.id);

    const source = sameSub.length >= 2
      ? sameSub
      : sameCategory.length >= 2
      ? sameCategory
      : fallback;

    const picked = source.slice(0, 2);
    const addons = picked.map((p, idx) => ({
      productId: p.id,
      variantIndex: 0,
      isDefaultSelected: idx === 0,
    }));

    return {
      productId: product.id,
      addons,
    };
  });
}

async function ensureCategoryAndSubcategory(categoryName, subCategoryName) {
  let category = await prisma.category.findFirst({
    where: {
      name: { equals: categoryName, mode: "insensitive" },
    },
  });

  if (!category) {
    category = await prisma.category.create({
      data: {
        name: categoryName,
        image: null,
        metaTitle: `${categoryName} | ${BRAND_NAME}`,
        metaDescription: `Buy premium ${categoryName.toLowerCase()} products from ${BRAND_NAME}.`,
        metaKeywords: `${categoryName}, ${BRAND_NAME}, cosmetics`,
        isActive: true,
      },
    });
  }

  let subcategory = await prisma.subcategory.findFirst({
    where: {
      categoryId: category.id,
      name: { equals: subCategoryName, mode: "insensitive" },
    },
  });

  if (!subcategory) {
    subcategory = await prisma.subcategory.create({
      data: {
        categoryId: category.id,
        name: subCategoryName,
        image: null,
        metaTitle: `${subCategoryName} | ${categoryName} | ${BRAND_NAME}`,
        metaDescription: `Explore ${subCategoryName.toLowerCase()} in ${categoryName.toLowerCase()} from ${BRAND_NAME}.`,
        metaKeywords: `${subCategoryName}, ${categoryName}, ${BRAND_NAME}`,
        isActive: true,
      },
    });
  }

  return { category, subcategory };
}

async function main() {
  const warehouseName = process.argv[2] || "Main Warehouse";

  const warehouse = await prisma.warehouse.findFirst({
    where: { name: warehouseName },
  });

  if (!warehouse) {
    throw new Error(`Warehouse '${warehouseName}' not found.`);
  }

  const inventoryItems = await prisma.item.findMany({
    where: {
      warehouseId: warehouse.id,
      itemType: { not: "processing" },
      status: { not: "out_of_stock" },
    },
    orderBy: { itemName: "asc" },
  });

  if (inventoryItems.length === 0) {
    throw new Error("No inventory items found to create online products.");
  }

  const groups = new Map();

  for (const item of inventoryItems) {
    const parsed = parseVariantFromItemName(item.itemName);
    const groupKey = `${item.category}::${parsed.baseName}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        category: item.category,
        subCategory: SUBCATEGORY_BY_CATEGORY[item.category] || "General",
        baseName: parsed.baseName,
        variants: [],
      });
    }

    groups.get(groupKey).variants.push({
      item,
      parsed,
      _sort: {
        sizeValue: parsed.sizeValue,
        sizeUnit: parsed.sizeUnit,
      },
    });
  }

  let createdCategories = 0;
  let createdSubcategories = 0;
  let createdProducts = 0;
  let updatedProducts = 0;
  let homepageBadgeAssigned = 0;
  let productsPageBadgeAssigned = 0;
  let fbtUpdated = 0;

  const badgeMap = await ensureBadges();

  const categorySubcategoryCache = new Set();

  for (const group of groups.values()) {
    const cacheKey = `${group.category}::${group.subCategory}`;
    if (!categorySubcategoryCache.has(cacheKey)) {
      const preCat = await prisma.category.findFirst({
        where: { name: { equals: group.category, mode: "insensitive" } },
      });
      const preSub = preCat
        ? await prisma.subcategory.findFirst({
            where: {
              categoryId: preCat.id,
              name: { equals: group.subCategory, mode: "insensitive" },
            },
          })
        : null;

      await ensureCategoryAndSubcategory(group.category, group.subCategory);
      if (!preCat) createdCategories += 1;
      if (!preSub) createdSubcategories += 1;
      categorySubcategoryCache.add(cacheKey);
    }

    const sorted = group.variants.sort(sortVariants);
    const variantObjects = sorted.map((entry, index) =>
      buildVariant(entry.item, entry.parsed, index === 0)
    );
    const defaultVariant = variantObjects[0];
    const badgeName = getBadgeNameForCategory(group.category);
    const badgeId =
      badgeMap.get(badgeName.toLowerCase()) ||
      badgeMap.get("new arrival");

    const payload = {
      category: group.category,
      subCategory: group.subCategory,
      brand: BRAND_NAME,
      shortDescription: group.baseName,
      enableVariants: variantObjects.length > 1,
      variants: variantObjects,
      cuttingStyles: [],
      hsnCode: defaultVariant.variantHSN || DEFAULT_HSN,
      gstPercentage: Number(defaultVariant.variantGST || DEFAULT_GST),
      defaultMRP: Number(defaultVariant.variantMRP || 0),
      defaultSellingPrice: Number(defaultVariant.variantSellingPrice || 0),
      defaultPurchasePrice: Number(defaultVariant.variantPurchasePrice || 0),
      discountType: "Percent",
      defaultDiscountValue: 0,
      isCODAvailable: true,
      shippingCharge: 0,
      freeShipping: false,
      productStatus: "active",
      showOnHomepage: true,
      homepageBadgeId: badgeId || null,
      showInProductsPage: true,
      productsPageBadgeId: badgeId || null,
      metaTitle: `${group.baseName} | ${BRAND_NAME}`,
      metaDescription: `Shop ${group.baseName} from ${BRAND_NAME}.`,
      metaKeywords: `${group.baseName}, ${group.category}, ${BRAND_NAME}`,
      expiryDate: sorted[0].item.expiryDate || null,
      mfgDate: sorted[0].item.mfgDate || null,
      batchNo: sorted[0].item.batchNo || null,
      safetyInformation: sorted[0].item.safetyInformation || null,
      returnPolicyApplicable: true,
      returnWindowDays: 7,
      warrantyDetails: "",
      countryOfOrigin: "India",
      frequentlyBoughtTogether: [],
      type: "regular",
      comboItems: [],
      thumbnail: sorted[0].item.itemImage || null,
      isComboHomePageEnabled: false,
    };

    const existing = await prisma.onlineProduct.findFirst({
      where: {
        category: group.category,
        shortDescription: group.baseName,
        OR: [{ type: "regular" }, { type: null }],
      },
    });

    if (existing) {
      await prisma.onlineProduct.update({
        where: { id: existing.id },
        data: payload,
      });
      updatedProducts += 1;
      if (badgeId) {
        homepageBadgeAssigned += 1;
        productsPageBadgeAssigned += 1;
      }
    } else {
      await prisma.onlineProduct.create({
        data: payload,
      });
      createdProducts += 1;
      if (badgeId) {
        homepageBadgeAssigned += 1;
        productsPageBadgeAssigned += 1;
      }
    }
  }

  // Configure "Frequently Bought Together" for some products.
  const regularProducts = await prisma.onlineProduct.findMany({
    where: {
      brand: BRAND_NAME,
      OR: [{ type: "regular" }, { type: null }],
    },
    select: {
      id: true,
      category: true,
      subCategory: true,
      variants: true,
      shortDescription: true,
    },
    orderBy: { shortDescription: "asc" },
  });

  const fbtPlan = buildFrequentlyBoughtTogether(regularProducts);
  for (const entry of fbtPlan) {
    await prisma.onlineProduct.update({
      where: { id: entry.productId },
      data: { frequentlyBoughtTogether: entry.addons },
    });
    fbtUpdated += 1;
  }

  const totalGroups = groups.size;
  const totalOnlineProducts = await prisma.onlineProduct.count({
    where: { OR: [{ type: "regular" }, { type: null }] },
  });

  console.log("=== Tirzah Online Product Seed Summary ===");
  console.log(`Warehouse: ${warehouse.name}`);
  console.log(`Inventory items considered: ${inventoryItems.length}`);
  console.log(`Product groups: ${totalGroups}`);
  console.log(`Categories created: ${createdCategories}`);
  console.log(`Subcategories created: ${createdSubcategories}`);
  console.log(`Online products created: ${createdProducts}`);
  console.log(`Online products updated: ${updatedProducts}`);
  console.log(`Homepage badge assigned: ${homepageBadgeAssigned}`);
  console.log(`Products page badge assigned: ${productsPageBadgeAssigned}`);
  console.log(`Products with add-ons (FBT) updated: ${fbtUpdated}`);
  console.log(`Total regular online products now: ${totalOnlineProducts}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
