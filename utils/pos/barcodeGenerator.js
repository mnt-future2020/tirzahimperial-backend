/**
 * Generate EAN-13 barcode
 * Format: [Prefix 3 digits][Company 4 digits][Product 5 digits][Check digit]
 */

// Company prefix (you can customize this)
const COMPANY_PREFIX = "590"; // Country code (e.g., 590 for Poland)
const COMPANY_CODE = "1234"; // Your company identifier

/**
 * Calculate EAN-13 check digit
 */
function calculateEAN13CheckDigit(barcode12) {
  const digits = barcode12.split('').map(Number);
  
  // Sum odd positions (1st, 3rd, 5th, etc.) - multiply by 1
  const oddSum = digits.filter((_, index) => index % 2 === 0).reduce((sum, digit) => sum + digit, 0);
  
  // Sum even positions (2nd, 4th, 6th, etc.) - multiply by 3
  const evenSum = digits.filter((_, index) => index % 2 === 1).reduce((sum, digit) => sum + digit, 0);
  
  const total = oddSum + (evenSum * 3);
  const checkDigit = (10 - (total % 10)) % 10;
  
  return checkDigit;
}

/**
 * Generate unique EAN-13 barcode
 */
function generateEAN13(productNumber) {
  // Ensure product number is 5 digits
  const paddedProductNumber = String(productNumber).padStart(5, '0');
  
  // Construct 12-digit barcode (without check digit)
  const barcode12 = `${COMPANY_PREFIX}${COMPANY_CODE}${paddedProductNumber}`;
  
  // Calculate check digit
  const checkDigit = calculateEAN13CheckDigit(barcode12);
  
  // Return complete 13-digit EAN-13 barcode
  return `${barcode12}${checkDigit}`;
}

/**
 * Validate EAN-13 barcode format
 */
function validateEAN13(barcode) {
  // Check if it's 13 digits
  if (!/^\d{13}$/.test(barcode)) {
    return { valid: false, message: "Barcode must be exactly 13 digits" };
  }
  
  // Extract check digit
  const barcode12 = barcode.substring(0, 12);
  const providedCheckDigit = parseInt(barcode.charAt(12));
  
  // Calculate expected check digit
  const calculatedCheckDigit = calculateEAN13CheckDigit(barcode12);
  
  // Validate
  if (providedCheckDigit !== calculatedCheckDigit) {
    return { valid: false, message: "Invalid EAN-13 check digit" };
  }
  
  return { valid: true, message: "Valid EAN-13 barcode" };
}

/**
 * Generate random product number for barcode
 */
function generateRandomProductNumber() {
  return Math.floor(Math.random() * 99999) + 1;
}

module.exports = {
  generateEAN13,
  validateEAN13,
  generateRandomProductNumber,
  calculateEAN13CheckDigit,
};
