const { prisma } = require('../../config/database');

class SessionManager {
  constructor() {
    this.sessionPrefix = 'session:';
    this.userSessionsPrefix = 'user_sessions:';
  }

  // Add session to tracking (MongoDB)
  async addSession(userId, token) {
    try {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      // Store session in MongoDB
      await prisma.session.create({
        data: {
          userId,
          token,
          expiresAt,
        },
      });
      
      console.log(`✅ Session added for user ${userId}`);
    } catch (error) {
      console.error('❌ Error adding session:', error);
    }
  }

  // Remove session from tracking
  async removeSession(userId, token) {
    try {
      // Remove session from MongoDB
      await prisma.session.deleteMany({
        where: {
          userId,
          token,
        },
      });
      
      console.log(`✅ Session removed for user ${userId}`);
    } catch (error) {
      console.error('❌ Error removing session:', error);
    }
  }

  // Check if session is valid
  async isSessionValid(userId, token) {
    try {
      console.log(`🔍 Checking session validity for user ${userId}`);
      
      // Find session in MongoDB
      const session = await prisma.session.findFirst({
        where: {
          userId,
          token,
          expiresAt: {
            gt: new Date(), // Not expired
          },
        },
      });
      
      const isValid = !!session;
      console.log(`📝 Session found: ${isValid ? 'Yes' : 'No'}`);
      console.log(`✅ Session valid: ${isValid}`);
      
      return isValid;
    } catch (error) {
      console.error('❌ Error checking session validity:', error);
      return false;
    }
  }

  // Invalidate all sessions for a user
  async invalidateAllUserSessions(userId) {
    try {
      // Delete all sessions for user from MongoDB
      await prisma.session.deleteMany({
        where: { userId },
      });
      
      console.log(`✅ All sessions invalidated for user ${userId}`);
    } catch (error) {
      console.error('❌ Error invalidating user sessions:', error);
    }
  }

  // Get active session count for user
  async getSessionCount(userId) {
    try {
      const count = await prisma.session.count({
        where: {
          userId,
          expiresAt: {
            gt: new Date(),
          },
        },
      });
      return count;
    } catch (error) {
      console.error('❌ Error getting session count:', error);
      return 0;
    }
  }

  // Clean expired sessions (utility method)
  async cleanExpiredSessions() {
    try {
      const result = await prisma.session.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      console.log(`✅ Cleaned ${result.count} expired sessions`);
    } catch (error) {
      console.error('❌ Error cleaning expired sessions:', error);
    }
  }
}

// Create singleton instance
const sessionManager = new SessionManager();

module.exports = sessionManager;