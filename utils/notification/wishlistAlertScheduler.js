const { prisma } = require('../../config/database');
const { sendPriceDropAlert, sendBackInStockAlert } = require('./sendNotification');

/**
 * Check wishlist items for price drops and send alerts
 * This should run daily via cron job
 */
const checkWishlistPriceDrops = async () => {
  try {
    console.log('🔍 [Wishlist Alert Scheduler] Checking for price drops...');

    // Get all wishlist items with product data
    const wishlistItems = await prisma.wishlistItem.findMany({
      include: {
        customer: {
          select: {
            userId: true,
            name: true,
          },
        },
      },
    });

    if (wishlistItems.length === 0) {
      console.log('✅ [Wishlist Alert Scheduler] No wishlist items found');
      return { success: true, alertsSent: 0, message: 'No wishlist items' };
    }

    console.log(`📊 [Wishlist Alert Scheduler] Found ${wishlistItems.length} wishlist items`);

    let alertsSent = 0;
    const alertResults = [];

    for (const item of wishlistItems) {
      try {
        const { productId, productData, customer } = item;

        if (!productData || !customer) continue;

        // Get current product data from OnlineProduct
        const currentProduct = await prisma.onlineProduct.findUnique({
          where: { id: productId },
        });

        if (!currentProduct) {
          console.log(`⚠️ Product not found: ${productId}`);
          continue;
        }

        // Extract stored price from wishlist productData
        const storedPrice = productData.variantSellingPrice || productData.price;
        
        // Get current price from product variants
        // Assuming productData stores the variant information
        const variantIndex = productData.variantIndex || 0;
        const currentVariant = currentProduct.variants?.[variantIndex];

        if (!currentVariant) {
          console.log(`⚠️ Variant not found for product: ${productId}`);
          continue;
        }

        const currentPrice = currentVariant.variantSellingPrice;

        // Check if price has dropped
        if (currentPrice < storedPrice) {
          const priceDrop = storedPrice - currentPrice;
          const dropPercentage = ((priceDrop / storedPrice) * 100).toFixed(0);

          console.log(`💰 Price drop detected: ${productData.productName || currentProduct.productName}`);
          console.log(`   Old: ₹${storedPrice} → New: ₹${currentPrice} (${dropPercentage}% off)`);

          // Send notification
          const result = await sendPriceDropAlert(
            customer.userId,
            productData.productName || currentProduct.productName,
            storedPrice,
            currentPrice,
            productId
          );

          if (result.success) {
            alertsSent++;
            console.log(`   ✅ Alert sent to ${customer.name}`);

            // Update wishlist item with new price
            await prisma.wishlistItem.update({
              where: { id: item.id },
              data: {
                productData: {
                  ...productData,
                  variantSellingPrice: currentPrice,
                  price: currentPrice,
                },
              },
            });
          } else {
            console.log(`   ❌ Failed to send alert: ${result.error}`);
          }

          alertResults.push({
            success: result.success,
            productName: productData.productName || currentProduct.productName,
            customer: customer.name,
          });
        }
      } catch (error) {
        console.error(`❌ Error processing wishlist item ${item.id}:`, error.message);
      }
    }

    console.log(`✅ [Wishlist Alert Scheduler] Completed: ${alertsSent} price drop alerts sent`);

    return {
      success: true,
      alertsSent,
      totalChecked: wishlistItems.length,
      results: alertResults,
    };
  } catch (error) {
    console.error('❌ [Wishlist Alert Scheduler] Error checking price drops:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Check wishlist items for back in stock and send alerts
 * This should be called when stock is updated
 */
const checkWishlistBackInStock = async (productId, variantIndex, newStockQuantity) => {
  try {
    console.log(`🔍 [Wishlist Alert Scheduler] Checking back in stock for product: ${productId}, variant: ${variantIndex}, stock: ${newStockQuantity}`);

    // Find all wishlist items for this product
    const wishlistItems = await prisma.wishlistItem.findMany({
      where: {
        productId,
      },
      include: {
        customer: {
          select: {
            userId: true,
            name: true,
          },
        },
      },
    });

    console.log(`📊 Found ${wishlistItems.length} wishlist item(s) for this product`);

    if (wishlistItems.length === 0) {
      console.log('✅ No wishlist items for this product');
      return { success: true, alertsSent: 0 };
    }

    let alertsSent = 0;

    for (const item of wishlistItems) {
      try {
        const { productData, customer } = item;

        if (!productData) {
          console.log(`⚠️ No productData for wishlist item ${item.id}`);
          continue;
        }
        
        if (!customer) {
          console.log(`⚠️ No customer for wishlist item ${item.id}`);
          continue;
        }

        console.log(`👤 Checking wishlist for user: ${customer.name} (${customer.userId})`);
        console.log(`   Product data:`, {
          variantIndex: productData.variantIndex,
          variantName: productData.variantName,
          previousStock: productData.variantStockQuantity
        });

        // Check if this is the variant they wishlisted
        const itemVariantIndex = productData.variantIndex || 0;
        
        console.log(`   Comparing variant indices: wishlist=${itemVariantIndex}, updated=${variantIndex}`);
        
        if (itemVariantIndex !== variantIndex) {
          console.log(`   ⏭️ Different variant, skipping`);
          continue; // Different variant
        }

        // Check if it was previously out of stock
        const previousStock = productData.variantStockQuantity || 0;
        
        console.log(`   Stock comparison: previous=${previousStock}, new=${newStockQuantity}`);
        
        if (previousStock === 0 && newStockQuantity > 0) {
          console.log(`   📦 ✅ BACK IN STOCK! Sending notification to ${customer.name}`);

          // Extract UOM
          const variant = productData.variants?.[itemVariantIndex] || {};
          const uom = variant.variantUom || productData.uom || 'units';

          // Send notification
          const result = await sendBackInStockAlert(
            customer.userId,
            productData.productName || productData.variantName || 'Product',
            newStockQuantity,
            productId,
            uom
          );

          console.log(`   Notification result:`, result);

          if (result.success) {
            alertsSent++;
            console.log(`   ✅ Alert sent successfully to ${customer.name}`);

            // Update wishlist item with new stock
            await prisma.wishlistItem.update({
              where: { id: item.id },
              data: {
                productData: {
                  ...productData,
                  variantStockQuantity: newStockQuantity,
                },
              },
            });
            console.log(`   ✅ Wishlist item updated with new stock`);
          } else {
            console.log(`   ❌ Failed to send alert: ${result.error}`);
          }
        } else {
          console.log(`   ⏭️ Not a back-in-stock scenario (prev: ${previousStock}, new: ${newStockQuantity})`);
        }
      } catch (error) {
        console.error(`❌ Error processing wishlist item ${item.id}:`, error.message);
        console.error('Stack:', error.stack);
      }
    }

    console.log(`✅ [Wishlist Alert Scheduler] Sent ${alertsSent} back in stock alert(s)`);

    return {
      success: true,
      alertsSent,
      totalChecked: wishlistItems.length,
    };
  } catch (error) {
    console.error('❌ [Wishlist Alert Scheduler] Error checking back in stock:', error);
    console.error('Stack:', error.stack);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  checkWishlistPriceDrops,
  checkWishlistBackInStock,
};
