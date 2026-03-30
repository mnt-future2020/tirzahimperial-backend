const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const sessionManager = require('../utils/auth/sessionManager');

// Verify JWT token middleware
const authenticateToken = async (req, res, next) => {
  try {
    // Try to get token from Authorization header first
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // If not in header, try to get from httpOnly cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token is required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if session is valid in MongoDB
    const isValidSession = await sessionManager.isSessionValid(decoded.userId, token);
    if (!isValidSession) {
      return res.status(401).json({
        success: false,
        error: 'Session expired or invalid. Please login again.'
      });
    }
    
    // Check if user exists and is active in all collections
    let user = await prisma.user.findUnique({
      where: { id: decoded.userId || decoded.id },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        isVerified: true
      }
    });
    let userType = 'user';

    if (!user) {
      user = await prisma.admin.findUnique({
        where: { id: decoded.userId || decoded.id },
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
          isVerified: true
        }
      });
      userType = 'admin';
    }

    // Check for delivery partner
    if (!user) {
      const partner = await prisma.deliveryPartner.findUnique({
        where: { id: decoded.userId || decoded.id },
        select: {
          id: true,
          email: true,
          name: true,
          partnerStatus: true,
          isEmailVerified: true
        }
      });
      
      if (partner) {
        user = {
          id: partner.id,
          email: partner.email,
          name: partner.name,
          isActive: partner.partnerStatus === 'active',
          isVerified: partner.isEmailVerified
        };
        userType = 'delivery_partner';
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Add user info to request
    req.userId = user.id;
    req.user = {
      ...user,
      role: userType
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Check if user has required role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      let user = await prisma.user.findUnique({
        where: { id: decoded.userId || decoded.id },
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
          isVerified: true
        }
      });
      let userType = 'user';

      if (!user) {
        user = await prisma.admin.findUnique({
          where: { id: decoded.userId || decoded.id },
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
            isVerified: true
          }
        });
        userType = 'admin';
      }

      // Check for delivery partner
      if (!user) {
        const partner = await prisma.deliveryPartner.findUnique({
          where: { id: decoded.userId || decoded.id },
          select: {
            id: true,
            email: true,
            name: true,
            partnerStatus: true,
            isEmailVerified: true
          }
        });
        
        if (partner) {
          user = {
            id: partner.id,
            email: partner.email,
            name: partner.name,
            isActive: partner.partnerStatus === 'active',
            isVerified: partner.isEmailVerified
          };
          userType = 'delivery_partner';
        }
      }

      if (user && user.isActive) {
        req.userId = user.id;
        req.user = {
          ...user,
          role: userType
        };
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  optionalAuth
};