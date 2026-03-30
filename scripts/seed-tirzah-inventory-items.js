/* eslint-disable no-console */
const path = require("path");
const dotenv = require("dotenv");
const { prisma } = require("../config/database");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const CATEGORY_ITEMS = {
  "Hair Oil": ["Hair Oil - Anti Hair Fall", "Premature Hair Oil"],
  Shampoo: ["Hair Fall Control Shampoo", "Premature Shampoo"],
  Gel: ["Hair Regrowth Gel", "Root Boosting Hair Gel", "Rosemary Hair Gel"],
  Lotion: ["Body Whitening Lotion", "Kumkumaadi Body Lotion"],
  "Hair Serum": [
    "Hair Regrowth Serum",
    "Hair Serum Roll On",
    "Root Boosting Hair Serum",
  ],
  "Face Serum": [
    "Anti Aging Serum",
    "Skin Brightening Serum",
    "Anti Acne Face Serum",
    "Hyper Pigmentation Serum",
    "Kojic and Manjista Face Serum",
  ],
  "Hair Spray": ["Rosemary Hair Spray"],
  "Lip Serum": ["Dark Lip Lightening Serum"],
  "Face Pack": [
    "Brightening Face Pack",
    "Acne and Pimple Face Pack",
    "Anti Aging and Pigmentation Face Pack",
  ],
  Cream: [
    "Anti Aging Cream",
    "Skin Brightening Cream",
    "Anti Acne and Pimple Face Cream",
    "Goat Milk Face Cream",
    "Rash Combo",
  ],
  "Hair Dye": ["Hair Dye (1 Brush + Reusable Gloves + Spoon)"],
  Soap: [
    "Anti Aging and Hyper Pigmentation Soap",
    "Acne and Pimple Clear Soap",
    "Glutathione Soap",
    "Kumkumaadi Soap",
  ],
  "Face Cleanser": [
    "Kumkumaadi Face Cleanser",
    "Manjista Brightening Face Cleanser",
  ],
};

const CODE_PREFIX = {
  "Hair Oil": "HO",
  Shampoo: "SH",
  Gel: "GL",
  Lotion: "LT",
  "Hair Serum": "HS",
  "Face Serum": "FS",
  "Hair Spray": "HSP",
  "Lip Serum": "LS",
  "Face Pack": "FP",
  Cream: "CR",
  "Hair Dye": "HD",
  Soap: "SP",
  "Face Cleanser": "FC",
};

const SIZE_VARIANTS = [
  { label: "50ml", code: "50", priceMultiplier: 1 },
  { label: "100ml", code: "100", priceMultiplier: 1.75 },
  { label: "250ml", code: "250", priceMultiplier: 3.8 },
];

const PURCHASE_PRICE_BY_CATEGORY = {
  "Hair Oil": 220,
  Shampoo: 180,
  Gel: 160,
  Lotion: 190,
  "Hair Serum": 240,
  "Face Serum": 260,
  "Hair Spray": 200,
  "Lip Serum": 170,
  "Face Pack": 150,
  Cream: 210,
  "Hair Dye": 120,
  Soap: 90,
  "Face Cleanser": 175,
};

const DEFAULT_OPENING_STOCK = 50;
const DEFAULT_UOM = "pcs";
const DEFAULT_AVAILABLE_UOMS = [{ uom: "pcs", conversionFactor: 1 }];

const normalizeKey = (v) => v.trim().toLowerCase();

async function main() {
  const warehouseName = process.argv[2];

  const warehouse = warehouseName
    ? await prisma.warehouse.findFirst({ where: { name: warehouseName } })
    : await prisma.warehouse.findFirst({ orderBy: { createdAt: "asc" } });

  if (!warehouse) {
    throw new Error(
      warehouseName
        ? `Warehouse '${warehouseName}' not found.`
        : "No warehouse found. Create at least one warehouse first."
    );
  }

  const existingCategories = await prisma.inventoryCategory.findMany({
    select: { name: true, isActive: true },
  });
  const categoryMap = new Map(
    existingCategories.map((c) => [normalizeKey(c.name), c])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const missingCategories = [];

  for (const [category, items] of Object.entries(CATEGORY_ITEMS)) {
    const categoryExists = categoryMap.has(normalizeKey(category));
    if (!categoryExists) {
      missingCategories.push(category);
    }

    for (let i = 0; i < items.length; i += 1) {
      const baseItemName = items[i];
      const baseCode = `${CODE_PREFIX[category] || "ITM"}${String(i + 1).padStart(3, "0")}`;
      const basePurchasePrice = PURCHASE_PRICE_BY_CATEGORY[category] || 100;

      for (const size of SIZE_VARIANTS) {
        const itemName = `${baseItemName} ${size.label}`;
        const itemCode = `${baseCode}-${size.code}`;
        const purchasePrice = Number(
          (basePurchasePrice * size.priceMultiplier).toFixed(2)
        );
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        const existingItem = await prisma.item.findFirst({
          where: {
            itemName,
            category,
            warehouseId: warehouse.id,
          },
        });

        if (existingItem) {
          await prisma.item.update({
            where: { id: existingItem.id },
            data: {
              itemCode: existingItem.itemCode || itemCode,
              uom: DEFAULT_UOM,
              baseUom: DEFAULT_UOM,
              availableUoms: DEFAULT_AVAILABLE_UOMS,
              openingStock: DEFAULT_OPENING_STOCK,
              quantity: DEFAULT_OPENING_STOCK,
              purchasePrice,
              expiryDate,
              status:
                DEFAULT_OPENING_STOCK <= 0
                  ? "out_of_stock"
                  : DEFAULT_OPENING_STOCK <= (existingItem.lowStockAlertLevel || 5)
                  ? "low_stock"
                  : "in_stock",
              updatedAt: new Date(),
            },
          });
          updated += 1;
        } else {
          await prisma.item.create({
            data: {
              itemName,
              category,
              itemCode,
              warehouseId: warehouse.id,
              purchasePrice,
              sellingPrice: 0,
              mrp: 0,
              openingStock: DEFAULT_OPENING_STOCK,
              quantity: DEFAULT_OPENING_STOCK,
              lowStockAlertLevel: 5,
              status: "in_stock",
              baseUom: DEFAULT_UOM,
              uom: DEFAULT_UOM,
              availableUoms: DEFAULT_AVAILABLE_UOMS,
              display: "inactive",
              itemType: "regular",
              requiresProcessing: false,
              expiryDate,
            },
          });
          created += 1;
        }
      }
    }
  }

  const totalBaseItems = Object.values(CATEGORY_ITEMS).reduce(
    (sum, arr) => sum + arr.length,
    0
  );
  const totalTargetItems = totalBaseItems * SIZE_VARIANTS.length;
  skipped = totalTargetItems - created - updated;

  console.log("=== Tirzah Inventory Seed Summary ===");
  console.log(`Warehouse: ${warehouse.name}`);
  console.log(`Target items: ${totalTargetItems}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);

  if (missingCategories.length > 0) {
    console.log(
      `Warning: These inventory categories are missing (items still inserted using category text): ${missingCategories.join(
        ", "
      )}`
    );
  } else {
    console.log("All categories are present in inventory_categories.");
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
