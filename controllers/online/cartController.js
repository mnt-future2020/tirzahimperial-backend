const { prisma } = require('../../config/database');
const { getPresignedUrl } = require('../../utils/online/uploadS3');
const { getProxyImageUrl } = require('../../utils/common/imageProxy');
const { convertUOMValue } = require('../../utils/inventory/uomConverter');

/**
 * Helper function to convert image key to proxy URL
 */
const getImageUrl = (imageKey) => {
  if (!imageKey) return null;
  try {
    return getProxyImageUrl(imageKey); 
  } catch (error) {
    console.error('Error getting proxy URL:', error);
    return null;
  }
};

/**
 * Helper function to find product by inventory product ID
 */
const findProductByInventoryId = async (inventoryProductId, allProducts = null) => {
  let products = allProducts;
  
  if (!products) {
    products = await prisma.onlineProduct.findMany();
  }
  
  const product = products.find(p => 
    p.variants && Array.isArray(p.variants) && (
      p.variants.some(v => v.inventoryProductId === inventoryProductId) ||
      (p.type === 'combo' && p.id === inventoryProductId)
    )
  );
  
  if (!product) return null;
  
  let variantIndex = product.variants.findIndex(
    v => v.inventoryProductId === inventoryProductId
  );
  
  // If not found by inventoryProductId but it's a combo matched by ID, default to first variant
  if (variantIndex === -1 && product.type === 'combo' && product.id === inventoryProductId) {
    variantIndex = 0;
  }
  
  return {
    product,
    variant: product.variants[variantIndex],
    variantIndex
  };
};

/**
 * Get user's cart
 * GET /api/online/cart
 */
const getCart = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId },
      include: {
        cartItems: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!customer) {
      return res.json({
        success: true,
        data: [],
        totalItems: 0,
        totalPrice: 0,
        totalSavings: 0
      });
    }

    // Convert image keys to proxy URLs and update stock data
    const cartItemsWithUrls = await Promise.all(
      customer.cartItems.map(async (item) => {
        // Fetch fresh stock data from the product
        let currentMaxStock = item.maxStock; // fallback to cached value
        let productExists = true;
        let productResult = null; // ✅ FIX: Declare result variable outside try-catch
        
        try {
          productResult = await findProductByInventoryId(item.inventoryProductId);
          if (productResult && productResult.product) {
            // ✅ Use the stored variantIndex to get the correct variant details
            // distinct variants (500g vs 1kg) might have different maxStock values
            const variant = productResult.product.variants[item.variantIndex] || productResult.variant;
            
            if (variant) {
              currentMaxStock = variant.variantStockQuantity || 0;
              
              // Update the cart item in database if stock has changed
              if (currentMaxStock !== item.maxStock) {
                await prisma.cart.update({
                  where: { id: item.id },
                  data: { maxStock: currentMaxStock }
                });
              }
            } else {
               // Should not happen if data is consistent
               currentMaxStock = 0;
               productExists = false;
            }
          } else {
            // Product or variant no longer exists
            productExists = false;
            currentMaxStock = 0;
            console.warn(`Product variant not found for cart item: ${item.inventoryProductId}`);
          }
        } catch (error) {
          console.error(`Error fetching fresh stock for ${item.inventoryProductId}:`, error);
          // If there's an error fetching the product, assume it might be out of stock
          currentMaxStock = 0;
          productExists = false;
        }
        
        // ✅ FIX: Get the correct image for combo products
        // For combo products, use product.thumbnail instead of variant image
        let imageKey = item.variantImage;
        if (productResult?.product?.type === 'combo' && productResult.product.thumbnail) {
          imageKey = productResult.product.thumbnail;
        } else if (!imageKey && productResult?.variant?.variantImages?.[0]) {
          // Fallback to variant image if cart item has no image
          imageKey = productResult.variant.variantImages[0];
        }
        
        const imageUrl = getImageUrl(imageKey);
        
        // ✅ FIX: For combo products, calculate max stock based on component availability
        let finalMaxStock = currentMaxStock;
        
        if (productResult?.product?.type === 'combo' && productResult.product.comboItems && Array.isArray(productResult.product.comboItems)) {
          console.log(`\n🔍 [getCart] ========== COMBO STOCK CALCULATION START ==========`);
          console.log(`🔍 [getCart] Combo Product: ${item.displayName}`);
          console.log(`🔍 [getCart] Number of components: ${productResult.product.comboItems.length}`);
          
          // Calculate how many combo packs can be made with available component stock
          let minComboUnits = Infinity;
          
          for (const comboItem of productResult.product.comboItems) {
            console.log(`\n🔍 [getCart] --- Checking Component: ${comboItem.productName || comboItem.variantName} ---`);
            console.log(`🔍 [getCart] Component data:`, JSON.stringify({
              productId: comboItem.productId,
              variantIndex: comboItem.variantIndex,
              quantity: comboItem.quantity,
              variantUom: comboItem.variantUom,
              variantUomValue: comboItem.variantUomValue,
              inventoryProductId: comboItem.inventoryProductId
            }, null, 2));
            
            let componentInventoryId = comboItem.inventoryProductId;
            
            // ✅ If inventoryProductId is missing, look it up from the online product
            if (!componentInventoryId && comboItem.productId) {
              try {
                const componentProduct = await prisma.onlineProduct.findUnique({
                  where: { id: comboItem.productId }
                });
                
                if (componentProduct && componentProduct.variants && componentProduct.variants[comboItem.variantIndex]) {
                  componentInventoryId = componentProduct.variants[comboItem.variantIndex].inventoryProductId;
                  console.log(`🔍 [getCart] Resolved inventoryProductId from online product: ${componentInventoryId}`);
                }
              } catch (error) {
                console.error(`Error resolving inventoryProductId:`, error);
              }
            }
            
            if (!componentInventoryId) continue;
            
            try {
              const componentInventory = await prisma.item.findUnique({
                where: { id: componentInventoryId }
              });
              
              if (componentInventory) {
                const componentQuantityPerCombo = comboItem.quantity || 1;
                const componentUomValue = comboItem.variantUomValue || 1;
                const componentUom = comboItem.variantUom || componentInventory.baseUom;
                const baseUom = componentInventory.baseUom;
                
                // 🆕 Calculate how much of this component is already consumed by OTHER cart items
                // This includes BOTH regular products AND other combo products that use this inventory
                let consumedByOtherCartItems = 0;
                
                console.log(`🔍 [getCart] Calculating consumption for component: ${componentInventoryId}`);
                console.log(`🔍 [getCart] Total cart items to check: ${customer.cartItems.length}`);
                
                for (const otherCartItem of customer.cartItems) {
                  // Skip the current combo item we're calculating for
                  if (otherCartItem.id === item.id) {
                    console.log(`  ⏭️ Skipping current combo item: ${otherCartItem.displayName}`);
                    continue;
                  }
                  
                  // ✅ FIX: Check if this cart item uses the same inventory
                  // Regular products: check inventoryProductId directly
                  // Combo products: check if any component uses this inventory
                  let usesThisInventory = false;
                  let consumptionAmount = 0;
                  
                  if (otherCartItem.inventoryProductId === componentInventoryId) {
                    // Regular product or combo component matches directly
                    usesThisInventory = true;
                    const otherUom = otherCartItem.variantUom || baseUom;
                    const otherUomValue = otherCartItem.variantUomValue || 1;
                    const otherQty = otherCartItem.quantity;
                    consumptionAmount = otherQty * otherUomValue;
                    
                    const converted = convertUOMValue(consumptionAmount, otherUom, baseUom);
                    const finalConsumption = (converted !== null ? converted : consumptionAmount);
                    consumedByOtherCartItems += finalConsumption;
                    
                    console.log(`  ✅ Regular product match: ${otherCartItem.displayName}`);
                    console.log(`     - Quantity: ${otherQty}, UOM: ${otherUom}, Value: ${otherUomValue}`);
                    console.log(`     - Raw consumption: ${consumptionAmount}${otherUom}`);
                    console.log(`     - Converted: ${converted}${baseUom}`);
                    console.log(`     - Added to total: ${finalConsumption}${baseUom}`);
                  } else {
                    // ✅ Check if this is a combo product by fetching its product data
                    try {
                      const otherProduct = await prisma.onlineProduct.findUnique({
                        where: { id: otherCartItem.productId }
                      });
                      
                      if (otherProduct && otherProduct.type === 'combo' && otherProduct.comboItems) {
                        console.log(`  🔍 Checking combo product: ${otherCartItem.displayName}`);
                        console.log(`     - Has ${otherProduct.comboItems.length} components`);
                        
                        for (const otherComboItem of otherProduct.comboItems) {
                          let otherComponentInventoryId = otherComboItem.inventoryProductId;
                          
                          // Resolve inventoryProductId if missing
                          if (!otherComponentInventoryId && otherComboItem.productId) {
                            const otherComponentProduct = await prisma.onlineProduct.findUnique({
                              where: { id: otherComboItem.productId }
                            });
                            if (otherComponentProduct && otherComponentProduct.variants && otherComponentProduct.variants[otherComboItem.variantIndex]) {
                              otherComponentInventoryId = otherComponentProduct.variants[otherComboItem.variantIndex].inventoryProductId;
                            }
                          }
                          
                          if (otherComponentInventoryId === componentInventoryId) {
                            usesThisInventory = true;
                            const comboQty = otherCartItem.quantity;
                            const componentQtyPerCombo = otherComboItem.quantity || 1;
                            const componentUomVal = otherComboItem.variantUomValue || 1;
                            const componentUomStr = otherComboItem.variantUom || baseUom;
                            
                            consumptionAmount = comboQty * componentQtyPerCombo * componentUomVal;
                            const converted = convertUOMValue(consumptionAmount, componentUomStr, baseUom);
                            const finalConsumption = (converted !== null ? converted : consumptionAmount);
                            consumedByOtherCartItems += finalConsumption;
                            
                            console.log(`  ✅ Combo component match: ${otherComboItem.productName || otherComboItem.variantName}`);
                            console.log(`     - Combo qty: ${comboQty}, Component qty per combo: ${componentQtyPerCombo}`);
                            console.log(`     - Component UOM: ${componentUomStr}, Value: ${componentUomVal}`);
                            console.log(`     - Raw consumption: ${consumptionAmount}${componentUomStr}`);
                            console.log(`     - Converted: ${converted}${baseUom}`);
                            console.log(`     - Added to total: ${finalConsumption}${baseUom}`);
                            break; // Found the component, no need to check others
                          }
                        }
                      } else {
                        console.log(`  ⏭️ Skipping unrelated item: ${otherCartItem.displayName}`);
                      }
                    } catch (error) {
                      console.error(`Error checking other cart item product:`, error);
                    }
                  }
                }
                
                console.log(`🔍 [getCart] Total consumption from other cart items: ${consumedByOtherCartItems}${baseUom}`);
                
                // Calculate available stock after subtracting cart consumption
                const availableStock = componentInventory.quantity - consumedByOtherCartItems;
                
                // ✅ Calculate total required in component UOM
                const totalRequiredInComponentUom = componentQuantityPerCombo * componentUomValue;
                
                console.log(`🔍 [getCart] DEBUG conversion:
                  - Input: ${totalRequiredInComponentUom} ${componentUom}
                  - Target: ${baseUom}
                  - Component UOM raw: "${comboItem.variantUom}"
                  - Base UOM raw: "${componentInventory.baseUom}"
                `);
                
                // ✅ Convert to base UOM for comparison
                const totalRequiredInBaseUom = convertUOMValue(totalRequiredInComponentUom, componentUom, baseUom);
                
                console.log(`🔍 [getCart] DEBUG conversion result:
                  - Converted value: ${totalRequiredInBaseUom}
                  - Conversion ${totalRequiredInBaseUom !== null ? 'SUCCESS' : 'FAILED'}
                `);
                
                // ✅ If conversion failed and UOMs don't match, assume incompatible - set to 0 combos
                let finalRequired;
                if (totalRequiredInBaseUom !== null) {
                  finalRequired = totalRequiredInBaseUom;
                } else if (componentUom === baseUom) {
                  // Same UOM, no conversion needed
                  finalRequired = totalRequiredInComponentUom;
                } else {
                  // Conversion failed and UOMs are different - incompatible units
                  console.warn(`⚠️ [getCart] UOM conversion failed: ${componentUom} → ${baseUom}. Setting combo stock to 0.`);
                  minComboUnits = 0;
                  continue;
                }
                
                // Calculate how many combos can be made from this component (using AVAILABLE stock, not total)
                const possibleCombos = finalRequired > 0 ? Math.floor(availableStock / finalRequired) : 0;
                minComboUnits = Math.min(minComboUnits, possibleCombos);
                
                console.log(`🔍 [getCart] Combo component check: ${comboItem.productName || comboItem.variantName}
                  - Total inventory: ${componentInventory.quantity} ${baseUom}
                  - Consumed by other cart items: ${consumedByOtherCartItems} ${baseUom}
                  - Available: ${availableStock} ${baseUom}
                  - Required per combo: ${componentQuantityPerCombo} × ${componentUomValue}${componentUom} = ${totalRequiredInComponentUom}${componentUom}
                  - Converted to base: ${finalRequired}${baseUom}
                  - Possible combos from this component: ${possibleCombos}
                  - Min combos so far: ${minComboUnits}
                `);
              }
            } catch (error) {
              console.error(`Error checking combo component stock:`, error);
            }
          }
          
          finalMaxStock = minComboUnits === Infinity ? 0 : minComboUnits;
          console.log(`\n✅ [getCart] ========== COMBO STOCK CALCULATION END ==========`);
          console.log(`✅ [getCart] Final combo max stock: ${finalMaxStock} units`);
          console.log(`✅ [getCart] Reason: ${minComboUnits === Infinity ? 'No valid components found' : `Minimum from all components`}\n`);
        }
        
        return {
          ...item,
          variantImage: imageUrl || item.variantImage,
          maxStock: finalMaxStock, // ✅ Use calculated max stock for combos
          isComboProduct: productResult?.product?.type === 'combo',
          comboItems: productResult?.product?.type === 'combo' ? productResult.product.comboItems : undefined
        };
      })
    );

    // Calculate totals
    const totalItems = cartItemsWithUrls.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = cartItemsWithUrls.reduce(
      (sum, item) => sum + (item.variantSellingPrice * item.quantity),
      0
    );
    const totalSavings = cartItemsWithUrls.reduce(
      (sum, item) => sum + ((item.variantMRP - item.variantSellingPrice) * item.quantity),
      0
    );

    res.json({
      success: true,
      data: cartItemsWithUrls,
      totalItems,
      totalPrice,
      totalSavings
    });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cart',
      message: error.message
    });
  }
};

/**
 * Add item to cart
 * POST /api/online/cart
 */
const addToCart = async (req, res) => {
  try {
    const { userId, inventoryProductId, quantity = 1, selectedCuttingStyle, variantIndex: requestedVariantIndex } = req.body;

    console.log('🛒 [addToCart] Request received:', { 
      userId, 
      inventoryProductId, 
      quantity, 
      selectedCuttingStyle,
      requestedVariantIndex
    });

    if (!userId) {
      console.warn('⚠️ [addToCart] 400: User ID is required');
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (!inventoryProductId) {
      console.warn('⚠️ [addToCart] 400: inventoryProductId is required');
      return res.status(400).json({
        success: false,
        error: 'inventoryProductId is required'
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      console.warn(`⚠️ [addToCart] 404: Customer not found for userId: ${userId}`);
      return res.status(404).json({
        success: false,
        error: 'Customer not found. Please ensure user is registered.'
      });
    }

    // Find the product with this variant
    let result = await findProductByInventoryId(inventoryProductId);

    if (!result) {
      console.warn(`⚠️ [addToCart] 404: Product not found for inventoryProductId: ${inventoryProductId}`);
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // ✅ Override with requested variant index if provided and valid
    // This fixes the issue where different variants sharing same inventory ID were being merged
    if (requestedVariantIndex !== undefined && requestedVariantIndex !== null) {
      const idx = parseInt(requestedVariantIndex);
      if (!isNaN(idx) && result.product.variants[idx]) {
        // Verify it matches the inventory ID (safety check)
        const isInventoryMatch = result.product.variants[idx].inventoryProductId === inventoryProductId;
        const isComboMatch = result.product.type === 'combo' && result.product.id === inventoryProductId;
        
        if (isInventoryMatch || isComboMatch) {
          console.log(`✅ [addToCart] Using requested variant index: ${idx} (${isComboMatch ? 'Combo Fallback' : 'Inventory Match'})`);
          result.variant = result.product.variants[idx];
          result.variantIndex = idx;
        } else {
          console.warn(`⚠️ [addToCart] Requested variant index ${idx} has mismatched ID. Ignoring.`);
        }
      }
    }

    const { product, variant, variantIndex } = result;

    // Check stock availability
    if (!variant || variant.variantStockQuantity === undefined) {
      console.warn(`⚠️ [addToCart] 400: Variant stock information not available for ${inventoryProductId}`);
      return res.status(400).json({
        success: false,
        error: 'Variant stock information not available'
      });
    }

    if (variant.variantStockQuantity <= 0) {
      console.warn(`⚠️ [addToCart] 400: Item is out of stock (${variant.variantStockQuantity})`);
      return res.status(400).json({
        success: false,
        error: 'Item is out of stock'
      });
    }

    // ---------------------------------------------------------
    // 🆕 COMBO PRODUCT STOCK VALIDATION
    // ---------------------------------------------------------
    // ✅ FIX: For combo products, validate stock for ALL component items
    if (product.type === 'combo' && product.comboItems && Array.isArray(product.comboItems) && product.comboItems.length > 0) {
      console.log(`🔍 [addToCart] Validating combo product stock for ${product.comboItems.length} items`);
      console.log(`🔍 [addToCart] Combo items structure:`, JSON.stringify(product.comboItems, null, 2));
      
      for (const comboItem of product.comboItems) {
        let componentInventoryId = comboItem.inventoryProductId;
        const componentQuantity = (comboItem.quantity || 1) * quantity; // Multiply by cart quantity
        const componentUom = comboItem.variantUom;
        const componentUomValue = comboItem.variantUomValue || 1;
        
        // ✅ If inventoryProductId is missing, look it up from the online product
        if (!componentInventoryId && comboItem.productId) {
          const componentProduct = await prisma.onlineProduct.findUnique({
            where: { id: comboItem.productId }
          });
          
          if (componentProduct && componentProduct.variants && componentProduct.variants[comboItem.variantIndex]) {
            componentInventoryId = componentProduct.variants[comboItem.variantIndex].inventoryProductId;
            console.log(`🔍 [addToCart] Resolved inventoryProductId from online product: ${componentInventoryId}`);
          }
        }
        
        console.log(`🔍 [addToCart] Checking combo component:`, {
          productName: comboItem.productName || comboItem.variantName,
          inventoryProductId: comboItem.inventoryProductId,
          productId: comboItem.productId,
          resolvedInventoryId: componentInventoryId,
          quantity: componentQuantity,
          uom: componentUom,
          uomValue: componentUomValue
        });
        
        if (!componentInventoryId) {
          console.warn(`⚠️ [addToCart] Combo item missing inventoryProductId and couldn't resolve it:`, comboItem);
          continue;
        }
        
        // Fetch inventory item for this component
        const componentInventoryItem = await prisma.item.findUnique({
          where: { id: componentInventoryId }
        });
        
        if (!componentInventoryItem) {
          console.warn(`⚠️ [addToCart] 400: Component inventory item not found: ${componentInventoryId}`);
          return res.status(400).json({
            success: false,
            error: `Component "${comboItem.productName || comboItem.variantName}" not found in inventory`
          });
        }
        
        const baseUom = componentInventoryItem.baseUom || 'pcs';
        
        // Calculate current consumption from cart for this component
        const allCartItemsForComponent = await prisma.cart.findMany({
          where: {
            customerId: customer.id,
            inventoryProductId: componentInventoryId
          }
        });
        
        console.log(`🔍 [addToCart] Found ${allCartItemsForComponent.length} cart items using inventory ${componentInventoryId}`);
        
        let totalComponentConsumption = 0;
        for (const cartItem of allCartItemsForComponent) {
          const itemUom = cartItem.variantUom || baseUom;
          const itemValue = cartItem.variantUomValue || 1;
          const itemQty = cartItem.quantity;
          
          const rawConsumption = itemQty * itemValue;
          const converted = convertUOMValue(rawConsumption, itemUom, baseUom);
          const finalConsumption = (converted !== null ? converted : rawConsumption);
          totalComponentConsumption += finalConsumption;
          
          console.log(`  - Cart item: ${cartItem.displayName}, qty: ${itemQty}, uom: ${itemUom}, value: ${itemValue}, raw: ${rawConsumption}${itemUom}, converted: ${converted}${baseUom}, final: ${finalConsumption}${baseUom}`);
        }
        
        console.log(`  - Total consumption from cart: ${totalComponentConsumption}${baseUom}`);
        
        // Add new requirement for this component
        const newComponentConsumption = componentQuantity * componentUomValue;
        const convertedNewConsumption = convertUOMValue(newComponentConsumption, componentUom || baseUom, baseUom);
        const addedComponentConsumption = convertedNewConsumption !== null ? convertedNewConsumption : newComponentConsumption;
        
        console.log(`  - New combo requirement: ${componentQuantity} × ${componentUomValue}${componentUom} = ${newComponentConsumption}${componentUom}, converted: ${convertedNewConsumption}${baseUom}`);
        
        const totalRequired = totalComponentConsumption + addedComponentConsumption;
        const roundedRequired = Math.round(totalRequired * 1000) / 1000;
        const roundedAvailable = Math.round(componentInventoryItem.quantity * 1000) / 1000;
        
        console.log(`🔍 [addToCart] Combo Component Check: ${comboItem.productName || comboItem.variantName}
          - Cart consumption: ${totalComponentConsumption} ${baseUom}
          - New requirement: ${addedComponentConsumption} ${baseUom}
          - Total required: ${roundedRequired} ${baseUom}
          - Available: ${roundedAvailable} ${baseUom}
          - Can add: ${roundedRequired <= roundedAvailable ? 'YES ✅' : 'NO ❌'}
        `);
        
        if (roundedRequired > roundedAvailable) {
          console.warn(`⚠️ [addToCart] 400: Insufficient stock for combo component`);
          return res.status(400).json({
            success: false,
            error: `Insufficient stock for "${comboItem.productName || comboItem.variantName}". Only ${roundedAvailable} ${baseUom} available.`
          });
        }
      }
    }
    // ---------------------------------------------------------
    // 🆕 UOM-BASED STOCK VALIDATION (Global Check for Regular Products)
    // ---------------------------------------------------------
    // Fetch real Inventory Item to get Base UOM and Total Stock
    else {
      const inventoryItem = await prisma.item.findUnique({
        where: { id: inventoryProductId }
      });

    if (inventoryItem) {
      const baseUom = inventoryItem.baseUom || 'pcs';
      const currentVariantUom = variant.variantUom || baseUom;
      const currentVariantValue = variant.variantUomValue || 1;

      // 1. Calculate current consumption from CART (for this inventory item)
      // We fetch ALL items sharing this inventory ID (could be different variants)
      const allItemsForVariant = await prisma.cart.findMany({
        where: {
          customerId: customer.id,
          inventoryProductId
        }
      });

      let totalConsumptionInBase = 0;
      
      for (const item of allItemsForVariant) {
        // Use cart item's stored UOM data, fallback to variant's current data if missing
        const iUom = item.variantUom || currentVariantUom; // fallback might be risky if variants differ, but cart usually has it
        const iValue = item.variantUomValue || 1;
        const iQty = item.quantity;

        // Calculate raw consumption (e.g. 2 * 500g = 1000g)
        const rawConsumption = iQty * iValue;
        
        // Convert to Base UOM (e.g. 1000g -> 1kg)
        const converted = convertUOMValue(rawConsumption, iUom, baseUom);
        totalConsumptionInBase += (converted !== null ? converted : rawConsumption);
      }

      // 2. Add NEW requirement
      const newRawConsumption = quantity * currentVariantValue;
      const newConsumptionInBase = convertUOMValue(newRawConsumption, currentVariantUom, baseUom);
      const addedConsumption = newConsumptionInBase !== null ? newConsumptionInBase : newRawConsumption;
      
      const distinctTotalRequired = totalConsumptionInBase + addedConsumption;
      
      // Precision rounding (avoid float errors like 1.800000004)
      const roundedTotalRequired = Math.round(distinctTotalRequired * 1000) / 1000;
      const roundedStock = Math.round(inventoryItem.quantity * 1000) / 1000;

      console.log(`🔍 [addToCart] Stock Check:
        - Base UOM: ${baseUom}
        - Cart Consumption: ${totalConsumptionInBase}
        - New Request: ${quantity} x ${currentVariantValue}${currentVariantUom} = ${addedConsumption} ${baseUom}
        - Total Required: ${roundedTotalRequired}
        - Available Stock: ${roundedStock}
      `);

      if (roundedTotalRequired > roundedStock) {
         console.warn(`⚠️ [addToCart] 400: Insufficient stock. Required: ${roundedTotalRequired} ${baseUom}, Available: ${roundedStock} ${baseUom}`);
         return res.status(400).json({
           success: false, 
           error: `Insufficient stock. Only ${roundedStock} ${baseUom} available.`
         });
      }
    }
    }
    // ---------------------------------------------------------

    // Check if item already exists in cart with SAME cutting style AND SAME variant
    // Different variants (500g vs 1kg) should be separate cart items
    const existingItem = await prisma.cart.findFirst({
      where: {
        customerId: customer.id,
        inventoryProductId,
        variantIndex, // ✅ Also check variant index to differentiate 500g vs 1kg
        selectedCuttingStyle: selectedCuttingStyle || null
      }
    });

    let cartItem;

    if (existingItem) {
      console.log(`ℹ️ [addToCart] Updating existing cart item: ${existingItem.id}`);
      // Update quantity for same variant + same cutting style
      const newQuantity = existingItem.quantity + quantity;
      
  
      
      // ✅ Stock validation already done above via Global Check

      const imageKey = variant.variantImages?.[0] || (product.type === 'combo' ? product.thumbnail : null) || null;

      cartItem = await prisma.cart.update({
        where: { id: existingItem.id },
        data: {
          quantity: newQuantity,
          customer: { connect: { id: customer.id } },
          maxStock: variant.variantStockQuantity,
          variantSellingPrice: variant.variantSellingPrice,
          variantMRP: variant.variantMRP,
          variantImage: imageKey,
          // 🆕 Update UOM fields
          variantUom: variant.variantUom || null,
          variantUomValue: variant.variantUomValue || null,
          // 🆕 Update shipping fields
          freeShipping: product.freeShipping || false,
          shippingCharge: product.shippingCharge || 0,
          // 🆕 Update combo fields
          isComboProduct: product.type === 'combo',
          comboItems: product.type === 'combo' ? (product.comboItems || []) : [],
        }
      });
    } else {
      console.log(`ℹ️ [addToCart] Creating new cart item for variant: ${inventoryProductId}`);
      // ✅ Stock validation already done above via Global Check

      const imageKey = variant.variantImages?.[0] || (product.type === 'combo' ? product.thumbnail : null) || null;

      // Get category info - lookup by name
      // Use findFirst with insensitive mode for better robustness
      let category = await prisma.category.findFirst({
        where: { name: { equals: product.category, mode: 'insensitive' } }
      });

      // Fallback: If category not found, try to find ANY category to associate with
      // (This prevents the 400 error while we fix the underlying data inconsistency)
      if (!category) {
        console.warn(`⚠️ [addToCart] Category not found: "${product.category}". Falling back to first available category.`);
        category = await prisma.category.findFirst();
        
        if (!category) {
          console.error(`❌ [addToCart] 400: NO Categories found in database!`);
          return res.status(400).json({
            success: false,
            error: 'Database configuration issue: No categories found',
            message: `Please create at least one category in the dashboard.`
          });
        }
      }

      // Create new cart item
      cartItem = await prisma.cart.create({
        data: {
          userId,
          customer: { connect: { id: customer.id } },
          inventoryProductId,
          productId: product.id,
          variantIndex,
          quantity,
          maxStock: variant.variantStockQuantity,
          shortDescription: product.shortDescription,
          brand: product.brand,
          category: product.category,
          categoryId: category.id, // Use category ID
          variantName: variant.variantName,
          displayName: variant.displayName || variant.variantName,
          variantSellingPrice: variant.variantSellingPrice,
          variantMRP: variant.variantMRP,
          variantImage: imageKey,
          selectedCuttingStyle,
          // 🆕 Include UOM fields for frontend display
          variantUom: variant.variantUom || null,
          variantUomValue: variant.variantUomValue || null,
          // 🆕 Include shipping fields for delivery cost calculation
          freeShipping: product.freeShipping || false,
          shippingCharge: product.shippingCharge || 0,
          // 🆕 Include combo fields
          isComboProduct: product.type === 'combo',
          comboItems: product.type === 'combo' ? (product.comboItems || []) : [],
        }
      });
    }

    console.log('✅ [addToCart] Item successfully added to cart:', cartItem.id);
    res.json({
      success: true,
      data: cartItem,
      message: 'Item added to cart'
    });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add item to cart',
      message: error.message
    });
  }
};

/**
 * Update cart item quantity
 * PUT /api/online/cart/:inventoryProductId
 */
const updateCartItem = async (req, res) => {
  try {
    const { userId, selectedCuttingStyle, variantIndex } = req.body;
    const { inventoryProductId } = req.params;
    const { quantity } = req.body;

    console.log('[updateCartItem] Request:', {
      userId,
      inventoryProductId,
      variantIndex,
      quantity,
      selectedCuttingStyle,
      body: req.body
    });

    if (!userId) {
      console.warn('[updateCartItem] Missing userId');
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (variantIndex === undefined || variantIndex === null) {
      console.warn('[updateCartItem] Missing variantIndex', { variantIndex });
      return res.status(400).json({
        success: false,
        error: 'Variant Index is required'
      });
    }

    if (quantity === undefined || quantity < 0) {
      console.warn('[updateCartItem] Invalid quantity', { quantity });
      return res.status(400).json({
        success: false,
        error: 'Valid quantity is required'
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    console.log('[updateCartItem] Customer found:', customer?.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // If quantity is 0, remove the item
    if (quantity === 0) {
      await prisma.cart.deleteMany({
        where: {
          customerId: customer.id,
          inventoryProductId,
          variantIndex,
          selectedCuttingStyle: selectedCuttingStyle || null
        }
      });

      return res.json({
        success: true,
        message: 'Item removed from cart'
      });
    }

    // Find the cart item - must match inventoryProductId + variantIndex + cuttingStyle
    const candidates = await prisma.cart.findMany({
      where: {
        customerId: customer.id,
        inventoryProductId,
        variantIndex
      }
    });

    // Try finding match treating null/undefined/"" as equivalent for cutting style
    const targetStyle = selectedCuttingStyle || null;
    
    const existingItem = candidates.find(item => {
      const itemStyle = item.selectedCuttingStyle || null;
      return itemStyle === targetStyle;
    });

      console.log('[updateCartItem] Existing item found:', existingItem?.id);

    if (!existingItem) {
      console.log('[updateCartItem] Cart item not found in candidates. Debugging...');
      console.log('[updateCartItem] Query params:', {
          customerId: customer.id,
          inventoryProductId,
          selectedCuttingStyle: selectedCuttingStyle || null
      });
      
      console.log('[updateCartItem] Candidates found:', candidates.map(item => ({
        id: item.id,
        inventoryProductId: item.inventoryProductId,
        selectedCuttingStyle: item.selectedCuttingStyle || '(falsy)',
        matchesTarget: (item.selectedCuttingStyle || null) === (selectedCuttingStyle || null)
      })));
      
      // Fallback search to see what else is there (if candidates was empty)
      if (candidates.length === 0) {
          const allCartItems = await prisma.cart.findMany({
            where: { customerId: customer.id }
          });
          console.log('[updateCartItem] All cart items for user:', allCartItems.length);
      }
      
      return res.status(404).json({
        success: false,
        error: 'Cart item not found',
        debug: {
            message: 'Item not found in candidates',
            searchedFor: { inventoryProductId, selectedCuttingStyle: selectedCuttingStyle || null },
            candidatesCount: candidates.length,
            candidates: candidates.map(item => ({
              id: item.id,
              selectedCuttingStyle: item.selectedCuttingStyle
            }))
        }
      });
    }

    // Get current stock from product
    const product = await prisma.onlineProduct.findUnique({
      where: { id: existingItem.productId }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    if (!product.variants || !Array.isArray(product.variants)) {
      return res.status(400).json({
        success: false,
        error: 'Product variants not found'
      });
    }

    const variant = product.variants[existingItem.variantIndex];
    
    if (!variant) {
      return res.status(404).json({
        success: false,
        error: 'Product variant not found'
      });
    }
    
    const availableStock = variant.variantStockQuantity || 0;

    // ---------------------------------------------------------
    // 🆕 COMBO PRODUCT STOCK VALIDATION FOR UPDATE
    // ---------------------------------------------------------
    if (product.type === 'combo' && product.comboItems && Array.isArray(product.comboItems) && product.comboItems.length > 0) {
      console.log(`🔍 [updateCartItem] Validating combo product stock for ${product.comboItems.length} items`);
      
      for (const comboItem of product.comboItems) {
        let componentInventoryId = comboItem.inventoryProductId;
        const componentQuantity = (comboItem.quantity || 1) * quantity;
        const componentUom = comboItem.variantUom;
        const componentUomValue = comboItem.variantUomValue || 1;
        
        // ✅ If inventoryProductId is missing, look it up from the online product
        if (!componentInventoryId && comboItem.productId) {
          const componentProduct = await prisma.onlineProduct.findUnique({
            where: { id: comboItem.productId }
          });
          
          if (componentProduct && componentProduct.variants && componentProduct.variants[comboItem.variantIndex]) {
            componentInventoryId = componentProduct.variants[comboItem.variantIndex].inventoryProductId;
            console.log(`🔍 [updateCartItem] Resolved inventoryProductId from online product: ${componentInventoryId}`);
          }
        }
        
        if (!componentInventoryId) continue;
        
        const componentInventoryItem = await prisma.item.findUnique({
          where: { id: componentInventoryId }
        });
        
        if (!componentInventoryItem) {
          return res.status(400).json({
            success: false,
            error: `Component "${comboItem.productName || comboItem.variantName}" not found in inventory`
          });
        }
        
        const baseUom = componentInventoryItem.baseUom || 'pcs';
        
        // Calculate current consumption EXCLUDING this cart item
        const allCartItemsForComponent = await prisma.cart.findMany({
          where: {
            customerId: customer.id,
            inventoryProductId: componentInventoryId
          }
        });
        
        let totalComponentConsumption = 0;
        for (const cartItem of allCartItemsForComponent) {
          if (cartItem.id === existingItem.id) continue; // Skip current item
          
          const itemUom = cartItem.variantUom || baseUom;
          const itemValue = cartItem.variantUomValue || 1;
          const itemQty = cartItem.quantity;
          
          const rawConsumption = itemQty * itemValue;
          const converted = convertUOMValue(rawConsumption, itemUom, baseUom);
          totalComponentConsumption += (converted !== null ? converted : rawConsumption);
        }
        
        // Add new requirement
        const newComponentConsumption = componentQuantity * componentUomValue;
        const convertedNewConsumption = convertUOMValue(newComponentConsumption, componentUom || baseUom, baseUom);
        const addedComponentConsumption = convertedNewConsumption !== null ? convertedNewConsumption : newComponentConsumption;
        
        const totalRequired = totalComponentConsumption + addedComponentConsumption;
        const roundedRequired = Math.round(totalRequired * 1000) / 1000;
        const roundedAvailable = Math.round(componentInventoryItem.quantity * 1000) / 1000;
        
        console.log(`🔍 [updateCartItem] Combo Component: ${comboItem.productName || comboItem.variantName}
          - Required: ${roundedRequired} ${baseUom}
          - Available: ${roundedAvailable} ${baseUom}
        `);
        
        if (roundedRequired > roundedAvailable) {
          return res.status(400).json({
            success: false,
            error: `Insufficient stock for "${comboItem.productName || comboItem.variantName}". Only ${roundedAvailable} ${baseUom} available.`
          });
        }
      }
    }
    // ---------------------------------------------------------
    // 🆕 UOM-BASED STOCK VALIDATION (Global Check for Update - Regular Products)
    // ---------------------------------------------------------
    else {
      const inventoryItem = await prisma.item.findUnique({
        where: { id: inventoryProductId }
      });

      if (inventoryItem) {
        const baseUom = inventoryItem.baseUom || 'pcs';
        const currentVariantUom = variant.variantUom || baseUom;
        const currentVariantValue = variant.variantUomValue || 1;

        // 1. Calculate current consumption of OTHER items in cart (excluding this one)
        const allItemsForVariant = await prisma.cart.findMany({
          where: {
            customerId: customer.id,
            inventoryProductId
          }
        });

        let totalConsumedInBase = 0;
        
        for (const item of allItemsForVariant) {
          if (item.id === existingItem.id) continue; // Skip the item we are updating

          // Use cart item's stored UOM data, fallback to variant's current data if missing
          const iUom = item.variantUom || currentVariantUom; 
          const iValue = item.variantUomValue || 1;
          const iQty = item.quantity;

          const rawConsumption = iQty * iValue;
          const converted = convertUOMValue(rawConsumption, iUom, baseUom);
          totalConsumedInBase += (converted !== null ? converted : rawConsumption);
        }

        // 2. Add NEW requirement (New Quantity * Value)
        const newRawConsumption = quantity * currentVariantValue;
        const newConsumptionInBase = convertUOMValue(newRawConsumption, currentVariantUom, baseUom);
        const addedConsumption = newConsumptionInBase !== null ? newConsumptionInBase : newRawConsumption;
        
        const distinctTotalRequired = totalConsumedInBase + addedConsumption;
        
        const roundedTotalRequired = Math.round(distinctTotalRequired * 1000) / 1000;
        const roundedStock = Math.round(inventoryItem.quantity * 1000) / 1000;

        console.log(`🔍 [updateCartItem] Stock Check:
          - Base UOM: ${baseUom}
          - Other Consumption: ${totalConsumedInBase}
          - Update Request: ${quantity} x ${currentVariantValue}${currentVariantUom} = ${addedConsumption} ${baseUom}
          - Total Required: ${roundedTotalRequired}
          - Available Stock: ${roundedStock}
        `);

        if (roundedTotalRequired > roundedStock) {
          return res.status(400).json({
            success: false, 
            error: `Insufficient stock. Only ${roundedStock} ${baseUom} available.`
          });
        }
      } else {
        // Fallback: Default simplified check
        if ((availableStock - quantity) < 0) {
          const allItems = await prisma.cart.findMany({ where: { customerId: customer.id, inventoryProductId } });
          const totalExcluding = allItems.reduce((acc, i) => i.id !== existingItem.id ? acc + i.quantity : acc, 0);
          if (totalExcluding + quantity > availableStock) {
            return res.status(400).json({
              success: false,
              error: `Only ${availableStock} items available in stock`
            });
          }
        }
      }
    }
    // ---------------------------------------------------------

    const imageKey = variant?.variantImages?.[0] || null;

    // Update cart item
    const cartItem = await prisma.cart.update({
      where: { id: existingItem.id },
      data: {
        quantity,
        maxStock: availableStock,
        variantSellingPrice: variant.variantSellingPrice,
        variantMRP: variant.variantMRP,
        variantImage: imageKey,
        // 🆕 Update UOM fields
        variantUom: variant.variantUom || null,
        variantUomValue: variant.variantUomValue || null,
        // 🆕 Update shipping fields
        freeShipping: product.freeShipping || false,
        shippingCharge: product.shippingCharge || 0,
      }
    });

    console.log('[updateCartItem] Cart item updated successfully');

    res.json({
      success: true,
      data: cartItem,
      message: 'Cart item updated'
    });
  } catch (error) {
    console.error('Error updating cart item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update cart item',
      message: error.message
    });
  }
};

/**
 * Remove item from cart
 * DELETE /api/online/cart/:inventoryProductId
 */
const removeFromCart = async (req, res) => {
  try {
    const userId = req.query.userId || req.body?.userId;
    const selectedCuttingStyle = req.query.selectedCuttingStyle || req.body?.selectedCuttingStyle || null;
    const variantIndex = parseInt(req.query.variantIndex || req.body?.variantIndex);
    const { inventoryProductId } = req.params;

    console.log('Remove from cart request:', { userId, inventoryProductId, variantIndex, selectedCuttingStyle });

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (!inventoryProductId) {
      return res.status(400).json({
        success: false,
        error: 'Inventory Product ID is required'
      });
    }

    if (isNaN(variantIndex)) {
      return res.status(400).json({
        success: false,
        error: 'Variant Index is required'
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    console.log('Customer found:', customer?.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Build where clause - must match inventoryProductId + variantIndex + cuttingStyle
    const whereClause = {
      customerId: customer.id,
      inventoryProductId: inventoryProductId,
      variantIndex: variantIndex
    };

    // Only add selectedCuttingStyle to where clause if it's provided
    if (selectedCuttingStyle) {
      whereClause.selectedCuttingStyle = selectedCuttingStyle;
    }

    console.log('Delete where clause:', whereClause);

    const deleteResult = await prisma.cart.deleteMany({
      where: whereClause
    });

    console.log('Delete result:', deleteResult);

    res.json({
      success: true,
      message: 'Item removed from cart',
      deletedCount: deleteResult.count
    });
  } catch (error) {
    console.error('Error removing from cart - Full error:', error);
    console.error('Error stack:', error.stack);
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Cart item not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to remove item from cart',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Clear entire cart
 * DELETE /api/online/cart
 */
const clearCart = async (req, res) => {
  try {
    const userId = req.query.userId || req.body.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const result = await prisma.cart.deleteMany({
      where: { userId }
    });

    res.json({
      success: true,
      message: 'Cart cleared successfully',
      data: {
        removedCount: result.count
      }
    });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cart',
      message: error.message
    });
  }
};

/**
 * Sync local cart to database (on login)
 * POST /api/online/cart/sync
 */
const syncCart = async (req, res) => {
  try {
    const { userId, items } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required'
      });
    }

    // Find customer
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found. Please ensure user is registered.'
      });
    }

    // Fetch all products once for efficiency
    const allProducts = await prisma.onlineProduct.findMany();

    // Process each item from local cart
    for (const item of items) {
      const { inventoryProductId, quantity, selectedCuttingStyle } = item;

      if (!inventoryProductId || !quantity) continue;

      // Find the product with this variant
      const result = await findProductByInventoryId(inventoryProductId, allProducts);

      if (!result) continue;

      const { product, variant, variantIndex } = result;

      // Check stock availability
      const availableStock = variant.variantStockQuantity || 0;
      if (availableStock <= 0) continue;

      // Check if item already exists in cart with SAME variant
      const existingItem = await prisma.cart.findFirst({
        where: {
          customerId: customer.id,
          inventoryProductId,
          variantIndex, // ✅ Also check variant index
          selectedCuttingStyle: selectedCuttingStyle || null
        }
      });

      if (existingItem) {
        // Merge quantities
        const allItemsForVariant = await prisma.cart.findMany({
          where: {
            customerId: customer.id,
            inventoryProductId
          }
        });
        const otherItemsQuantity = allItemsForVariant.reduce((sum, item) => 
          item.id !== existingItem.id ? sum + item.quantity : sum, 0
        );
        const maxAllowedForThis = availableStock - otherItemsQuantity;
        
        const mergedQuantity = Math.min(
          Math.max(existingItem.quantity, quantity),
          maxAllowedForThis
        );

        const imageKey = variant.variantImages?.[0] || null;

        await prisma.cart.update({
          where: { id: existingItem.id },
          data: {
            quantity: mergedQuantity,
            maxStock: availableStock,
            variantSellingPrice: variant.variantSellingPrice,
            variantMRP: variant.variantMRP,
            variantImage: imageKey,
            customerId: customer.id,
            // 🆕 Update UOM fields
            variantUom: variant.variantUom || null,
            variantUomValue: variant.variantUomValue || null,
            // 🆕 Update shipping fields
            freeShipping: product.freeShipping || false,
            shippingCharge: product.shippingCharge || 0,
          }
        });
      } else {
        // Check total stock
        const allItemsForVariant = await prisma.cart.findMany({
          where: {
            customerId: customer.id,
            inventoryProductId
          }
        });
        const totalQuantityForVariant = allItemsForVariant.reduce((sum, item) => sum + item.quantity, 0);
        const maxAllowedForNew = availableStock - totalQuantityForVariant;
        
        if (maxAllowedForNew <= 0) continue;
        
        const validQuantity = Math.min(quantity, maxAllowedForNew);
        const imageKey = variant.variantImages?.[0] || null;

        await prisma.cart.create({
          data: {
            userId,
            customerId: customer.id,
            inventoryProductId,
            productId: product.id,
            variantIndex,
            quantity: validQuantity,
            maxStock: availableStock,
            shortDescription: product.shortDescription,
            brand: product.brand,
            variantName: variant.variantName,
            displayName: variant.displayName || variant.variantName,
            variantSellingPrice: variant.variantSellingPrice,
            variantMRP: variant.variantMRP,
            variantImage: imageKey,
            selectedCuttingStyle,
            // 🆕 Include UOM fields
            variantUom: variant.variantUom || null,
            variantUomValue: variant.variantUomValue || null,
            // 🆕 Include shipping fields
            freeShipping: product.freeShipping || false,
            shippingCharge: product.shippingCharge || 0,
          }
        });
      }
    }

    // Return updated cart
    const cartItems = await prisma.cart.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    // Convert image keys to presigned URLs
    const cartItemsWithUrls = await Promise.all(
      cartItems.map(async (item) => {
        const imageUrl = await getImageUrl(item.variantImage);
        return {
          ...item,
          variantImage: imageUrl || item.variantImage
        };
      })
    );

    const totalItems = cartItemsWithUrls.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = cartItemsWithUrls.reduce(
      (sum, item) => sum + (item.variantSellingPrice * item.quantity),
      0
    );
    const totalSavings = cartItemsWithUrls.reduce(
      (sum, item) => sum + ((item.variantMRP - item.variantSellingPrice) * item.quantity),
      0
    );

    res.json({
      success: true,
      data: cartItemsWithUrls,
      totalItems,
      totalPrice,
      totalSavings,
      message: 'Cart synced successfully'
    });
  } catch (error) {
    console.error('Error syncing cart:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync cart',
      message: error.message
    });
  }
};



module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  syncCart,

};
