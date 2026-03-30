const { Server } = require("socket.io");
const { prisma } = require("../../config/database");

let io;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Partner joins with their ID
    socket.on("partner:join", async (data) => {
      const { partnerId } = data;
      if (partnerId) {
        socket.partnerId = partnerId;
        socket.join(`partner:${partnerId}`);
        console.log(`📱 Partner ${partnerId} joined room`);

        // Update partner online status
        try {
          await prisma.deliveryPartner.update({
            where: { id: partnerId },
            data: { isOnline: true },
          });
          console.log(`✅ Partner ${partnerId} marked as online`);
          
          // Notify admin dashboard
          io.emit("admin:partner-online", { partnerId });
        } catch (error) {
          console.error("Error updating partner online status:", error);
        }
      }
    });

    // Partner updates location
    socket.on("partner:location", async (data) => {
      const { partnerId, latitude, longitude, orderId } = data;
      console.log(`📍 Partner location update received:`, { partnerId, latitude, longitude, orderId });
      
      if (partnerId && latitude && longitude) {
        try {
          // Update partner location in database
          await prisma.deliveryPartner.update({
            where: { id: partnerId },
            data: {
              currentLatitude: parseFloat(latitude),
              currentLongitude: parseFloat(longitude),
              lastLocationUpdate: new Date(),
            },
          });

          const locationData = {
            partnerId,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            timestamp: new Date(),
          };

          // Broadcast to all admin clients
          console.log(`📡 Broadcasting admin:partner-location for partner: ${partnerId}`);
          io.emit("admin:partner-location", locationData);

          // If orderId is provided, broadcast to specific order room for customer tracking
          if (orderId) {
            console.log(`📡 Broadcasting to order room: ${orderId}`);
            io.to(`order:${orderId}`).emit("partner:location", {
              ...locationData,
              orderId,
            });
          }
        } catch (error) {
          console.error("Error updating location:", error);
        }
      }
    });

    // Partner updates delivery status
    socket.on("delivery:status", async (data) => {
      const { orderId, status, latitude, longitude, notes } = data;

      try {
        // Create tracking record
        await prisma.deliveryTracking.create({
          data: {
            orderId,
            status,
            latitude: latitude || null,
            longitude: longitude || null,
            notes: notes || null,
          },
        });

        // Get order details
        const order = await prisma.onlineOrder.findUnique({
          where: { id: orderId },
          include: { deliveryPartner: true },
        });

        if (order) {
          // Update order status
          const updateData = { orderStatus: status };
          if (status === 'shipped') updateData.shippedAt = new Date();
          if (status === 'delivered') updateData.deliveredAt = new Date();

          await prisma.onlineOrder.update({
            where: { id: orderId },
            data: updateData,
          });

          // Broadcast to order room
          io.to(`order:${orderId}`).emit("delivery:update", {
            orderId,
            status,
            timestamp: new Date(),
            latitude,
            longitude,
          });

          // Notify customer
          io.emit(`customer:${order.userId}`, {
            type: "order_update",
            orderId,
            orderNumber: order.orderNumber,
            status,
          });
        }
      } catch (error) {
        console.error("Error updating delivery status:", error);
      }
    });

    // Partner goes offline
    socket.on("partner:offline", async (data) => {
      const { partnerId } = data;
      if (partnerId) {
        try {
          await prisma.deliveryPartner.update({
            where: { id: partnerId },
            data: { isOnline: false },
          });
          io.emit("admin:partner-offline", { partnerId });
        } catch (error) {
          console.error("Error updating partner offline status:", error);
        }
      }
    });

    // Customer/Admin joins order room for tracking
    socket.on("order:join", (data) => {
      const { orderId } = data;
      if (orderId) {
        socket.join(`order:${orderId}`);
        console.log(`👤 Client joined order room: ${orderId}`);
      }
    });

    // Admin joins for live tracking
    socket.on("admin:join", () => {
      socket.join("admin:tracking");
      console.log("🖥️ Admin joined tracking room");
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      
      if (socket.partnerId) {
        try {
          await prisma.deliveryPartner.update({
            where: { id: socket.partnerId },
            data: { isOnline: false },
          });
          io.emit("admin:partner-offline", { partnerId: socket.partnerId });
        } catch (error) {
          console.error("Error on disconnect:", error);
        }
      }
    });
  });

  return io;
};

// Export functions to be used by controllers
const sendToPartner = (partnerId, event, data) => {
  if (io) {
    io.to(`partner:${partnerId}`).emit(event, data);
  }
};

const sendToOrder = (orderId, event, data) => {
  if (io) {
    io.to(`order:${orderId}`).emit(event, data);
  }
};

const sendToAdmin = (event, data) => {
  if (io) {
    io.to("admin:tracking").emit(event, data);
  }
};

const sendToCustomer = (userId, event, data) => {
  if (io) {
    io.emit(`customer:${userId}`, data);
  }
};

module.exports = {
  initializeSocket,
  sendToPartner,
  sendToOrder,
  sendToAdmin,
  sendToCustomer,
};
