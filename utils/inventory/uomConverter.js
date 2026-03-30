const convert = require('convert-units');

/**
 * Normalize UOM string to lowercase and trim
 * @param {string} uom - Raw UOM string
 * @returns {string} Normalized UOM
 */
function normalizeUom(uom) {
  if (!uom) return '';
  return uom.toLowerCase().trim();
}

/**
 * Convert quantity from one UOM to another using convert-units package
 * Dynamically handles all UOM conversions without hardcoding
 * @param {number} value - Value to convert
 * @param {string} fromUomRaw - Source UOM
 * @param {string} toUomRaw - Target UOM
 * @returns {number|null} Converted value or null if conversion not possible
 */
function convertUOMValue(value, fromUomRaw, toUomRaw) {
  try {
    const fromUom = normalizeUom(fromUomRaw);
    const toUom = normalizeUom(toUomRaw);

    // Same UOM, no conversion needed
    if (fromUom === toUom) return value;

    // Handle discrete quantity units (not in convert-units)
    const QUANTITY_UNITS = ['pcs', 'unit', 'dozen', 'pair', 'pack', 'bag', 'bottle', 'jar', 'box', 'carton', 'bundle', 'roll', 'set', 'can'];
    
    if (QUANTITY_UNITS.includes(fromUom) && QUANTITY_UNITS.includes(toUom)) {
      // Quantity conversion factors
      const factors = { dozen: 12, pair: 2 };
      const fromFactor = factors[fromUom] || 1;
      const toFactor = factors[toUom] || 1;
      return (value * fromFactor) / toFactor;
    }

    // Use convert-units package for all other conversions (mass, volume, etc.)
    // This dynamically handles: kg, g, mg, lb, oz, l, ml, and many more
    return convert(value).from(fromUom).to(toUom);
  } catch (error) {
    console.error(`❌ UOM conversion error: ${fromUomRaw} → ${toUomRaw}`, error.message);
    return null;
  }
}

/**
 * Convert variant quantity to base UOM for stock deduction
 * Uses availableUoms conversion factors for accurate conversion
 * @param {number} variantQuantity - Quantity in variant UOM
 * @param {string} variantUomRaw - Variant's UOM
 * @param {string} baseUomRaw - Item's base UOM
 * @param {Array} availableUoms - Available UOMs with conversion factors [{uom, conversionFactor}]
 * @returns {number} Quantity in base UOM
 */
function convertToBaseUOM(variantQuantity, variantUomRaw, baseUomRaw, availableUoms) {
  const variantUom = normalizeUom(variantUomRaw);
  const baseUom = normalizeUom(baseUomRaw);
  
  // Find conversion factor from availableUoms
  const uomConfig = availableUoms.find(u => normalizeUom(u.uom) === variantUom);
  
  if (!uomConfig) {
    console.error(`❌ UOM ${variantUomRaw} not found in availableUoms:`, availableUoms.map(u => u.uom));
    // Fallback: try direct conversion
    const converted = convertUOMValue(variantQuantity, variantUom, baseUom);
    return converted !== null ? converted : variantQuantity;
  }
  
  // Convert using conversion factor
  // Example: 500g variant, baseUom = kg, conversionFactor = 1000
  // Result: 500 / 1000 = 0.5 kg
  return variantQuantity / uomConfig.conversionFactor;
}

/**
 * Build availableUoms array with conversion factors
 * Dynamically calculates conversion factors using convert-units
 * @param {string} baseUom - Base UOM
 * @param {string[]} selectedUoms - Selected UOMs
 * @returns {Array} Array of {uom, conversionFactor}
 */
function buildAvailableUomsArray(baseUom, selectedUoms) {
  return selectedUoms.map(uom => {
    if (uom === baseUom) {
      return { uom, conversionFactor: 1 };
    }
    
    // Calculate conversion factor: how many of this UOM = 1 base UOM
    // Example: baseUom = kg, uom = g → 1 kg = 1000 g → factor = 1000
    const factor = convertUOMValue(1, baseUom, uom);
    
    return {
      uom,
      conversionFactor: factor || 1
    };
  });
}

/**
 * Get UOM symbol/abbreviation dynamically from convert-units
 * @param {string} uom - Raw UOM
 * @returns {string} Symbol
 */
function getUOMSymbol(uom) {
  try {
    const normalized = normalizeUom(uom);
    const description = convert().describe(normalized);
    return description.abbr;
  } catch (error) {
    // Fallback for quantity units
    const symbols = {
      pcs: 'pcs', unit: 'unit', dozen: 'doz', pair: 'pair',
      pack: 'pk', bag: 'bg', box: 'bx', bottle: 'btl',
      jar: 'jar', carton: 'ctn', bundle: 'bdl', roll: 'roll',
      set: 'set', can: 'can'
    };
    return symbols[normalizeUom(uom)] || uom;
  }
}

/**
 * Format quantity with UOM
 * @param {number} value - Quantity
 * @param {string} uom - UOM
 * @returns {string} Formatted string (e.g., "5.5kg")
 */
function formatUOMDisplay(value, uom) {
  const symbol = getUOMSymbol(uom);
  const roundedValue = Math.round(value * 100) / 100;
  const formattedValue = roundedValue % 1 === 0 ? Math.floor(roundedValue).toString() : roundedValue.toFixed(2);
  
  if (value === 0 && uom) return `0${symbol}`;
  if (!value) return `0${symbol}`;
  
  return `${formattedValue}${symbol}`;
}

/**
 * Smart formatting that adjusts units dynamically using convert-units
 * Automatically converts to user-friendly units (e.g., 1000g → 1kg)
 * Works for ALL UOMs without hardcoding
 * @param {number} value - Quantity
 * @param {string} baseUom - Base UOM
 * @returns {string} Formatted string
 */
function formatSmartUOMDisplay(value, baseUom) {
  if (!baseUom || value === 0) {
    return formatUOMDisplay(value, baseUom);
  }

  try {
    const normalized = normalizeUom(baseUom);
    
    // Skip quantity units (not supported by convert-units)
    const quantityUnits = ['pcs', 'unit', 'dozen', 'pair', 'pack', 'bag', 'bottle', 'jar', 'box', 'carton', 'bundle', 'roll', 'set', 'can'];
    if (quantityUnits.includes(normalized)) {
      return formatUOMDisplay(value, baseUom);
    }

    // Get UOM description and measure type (mass, volume, etc.)
    const description = convert().describe(normalized);
    const measure = description.measure;
    const possibilities = convert().possibilities(measure);
    
    let bestUom = normalized;
    let bestValue = value;
    
    // If value < 1, find smaller unit
    if (value < 1 && value > 0) {
      for (const possibleUom of possibilities) {
        const converted = convertUOMValue(value, normalized, possibleUom);
        if (converted !== null && converted >= 1 && converted < 1000) {
          bestUom = possibleUom;
          bestValue = converted;
          break;
        }
      }
    }
    // If value >= 1000, find larger unit
    else if (value >= 1000) {
      for (const possibleUom of possibilities) {
        const converted = convertUOMValue(value, normalized, possibleUom);
        if (converted !== null && converted >= 1 && converted < 1000) {
          bestUom = possibleUom;
          bestValue = converted;
          break;
        }
      }
    }
    
    return formatUOMDisplay(bestValue, bestUom);
  } catch (error) {
    return formatUOMDisplay(value, baseUom);
  }
}

module.exports = {
  normalizeUom,
  convertUOMValue,
  convertToBaseUOM,
  buildAvailableUomsArray,
  getUOMSymbol,
  formatUOMDisplay,
  formatSmartUOMDisplay,
};
