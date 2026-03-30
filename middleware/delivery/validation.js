/**
 * Validation middleware for delivery partner operations
 */

const validateDeliveryPartner = (req, res, next) => {
  const {
    name,
    email,
    phone,
    vehicleType,
    vehicleNumber,
    licenseNumber,
  } = req.body;

  const errors = [];

  // Name validation
  if (!name || name.trim().length < 2) {
    errors.push("Name must be at least 2 characters long");
  }

  // Email validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Valid email is required");
  }

  // Phone validation (Indian format - allow with or without country code)
  const cleanPhone = phone ? phone.replace(/\D/g, "") : "";
  if (!cleanPhone || (cleanPhone.length !== 10 && cleanPhone.length !== 12)) {
    errors.push("Valid 10-digit phone number is required");
  }

  // Vehicle type validation
  const validVehicleTypes = ["bike", "scooter", "car", "van"];
  if (!vehicleType || !validVehicleTypes.includes(vehicleType.toLowerCase())) {
    errors.push("Vehicle type must be one of: bike, scooter, car, van");
  }

  // Vehicle number validation (Indian format - more flexible)
  const cleanVehicleNumber = vehicleNumber ? vehicleNumber.replace(/\s/g, "").toUpperCase() : "";
  if (!cleanVehicleNumber || cleanVehicleNumber.length < 8) {
    errors.push("Valid vehicle number is required (e.g., MH12AB1234)");
  }

  // License number validation
  if (!licenseNumber || licenseNumber.trim().length < 5) {
    errors.push("Valid license number is required");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors,
    });
  }

  // Normalize data
  req.body.email = email.toLowerCase().trim();
  req.body.phone = phone.replace(/\D/g, "").slice(-10); // Keep last 10 digits
  req.body.vehicleType = vehicleType.toLowerCase();
  req.body.vehicleNumber = vehicleNumber.replace(/\s/g, "").toUpperCase().trim();
  req.body.licenseNumber = licenseNumber.toUpperCase().trim();
  req.body.name = name.trim();

  next();
};

const validateUpdateDeliveryPartner = (req, res, next) => {
  const errors = [];

  // Only validate fields that are being updated
  if (req.body.name !== undefined && req.body.name.trim().length < 2) {
    errors.push("Name must be at least 2 characters long");
  }

  if (req.body.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)) {
    errors.push("Valid email is required");
  }

  if (req.body.phone !== undefined) {
    const cleanPhone = req.body.phone.replace(/\D/g, "");
    if (cleanPhone.length !== 10 && cleanPhone.length !== 12) {
      errors.push("Valid 10-digit phone number is required");
    }
  }

  const validVehicleTypes = ["bike", "scooter", "car", "van"];
  if (req.body.vehicleType !== undefined && !validVehicleTypes.includes(req.body.vehicleType.toLowerCase())) {
    errors.push("Vehicle type must be one of: bike, scooter, car, van");
  }

  if (req.body.vehicleNumber !== undefined) {
    const cleanVehicleNumber = req.body.vehicleNumber.replace(/\s/g, "").toUpperCase();
    if (cleanVehicleNumber.length < 8) {
      errors.push("Valid vehicle number is required (e.g., MH12AB1234)");
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors,
    });
  }

  // Normalize data
  if (req.body.email) req.body.email = req.body.email.toLowerCase().trim();
  if (req.body.phone) req.body.phone = req.body.phone.replace(/\D/g, "").slice(-10);
  if (req.body.vehicleType) req.body.vehicleType = req.body.vehicleType.toLowerCase();
  if (req.body.vehicleNumber) req.body.vehicleNumber = req.body.vehicleNumber.replace(/\s/g, "").toUpperCase().trim();
  if (req.body.licenseNumber) req.body.licenseNumber = req.body.licenseNumber.toUpperCase().trim();
  if (req.body.name) req.body.name = req.body.name.trim();

  next();
};

const validateObjectId = (req, res, next) => {
  const { id } = req.params;

  // MongoDB ObjectId validation (24 hex characters)
  if (!/^[a-f\d]{24}$/i.test(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID format",
    });
  }

  next();
};

module.exports = {
  validateDeliveryPartner,
  validateUpdateDeliveryPartner,
  validateObjectId,
};
