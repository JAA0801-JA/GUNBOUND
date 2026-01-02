// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// -----------------------------
// EXPRESS SETUP
// -----------------------------
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Health check for Render
app.get("/", (req, res) => {
  res.send("Gunbound Real-Time Game Server Running!");
});

// -----------------------------
// SOCKET.IO SETUP
// -----------------------------
const io = new Server(server, {
  cors: {
    origin: "*", // Later restrict to Base44 frontend URL
    methods: ["GET", "POST"]
  }
});

// -----------------------------
// GAME STATE
// -----------------------------
const rooms = {}; // roomId -> { players, projectiles, turnIndex, wind, createdAt }
const TICK_RATE = 30; // 30 updates per second

// -----------------------------
// SOCKET.IO CONNECTIONS
// -----------------------------
io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  // Player joins a room
  socket.on("joinRoom", ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        projectiles: [],
        turnIndex: 0,
        wind: Math.random() * 10 - 5, // random wind -5 to 5
        createdAt: Date.now()
      };
    }

    // Add player to the room
    rooms[roomId].players.push({
      id: socket.id,
      name: playerName,
      x: 100,   // starting X position
      y: 100,   // starting Y position
      hp: 100,
      ready: false
    });

    // Send updated room state to all players
    io.to(roomId).emit("roomUpdate", rooms[roomId]);
  });

  // Player actions: movement or shooting
  socket.on("playerAction", ({ roomId, action }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // -----------------------------
    // MOVEMENT
    // -----------------------------
    if (action.type === "move") {
      // Limit movement within bounds
      const newX = Math.max(0, Math.min(action.x, 800));
      const newY = Math.max(0, Math.min(action.y, 600));
      player.x = newX;
      player.y = newY;
    }

    // -----------------------------
    // SHOOTING
    // -----------------------------
    if (action.type === "shoot") {
      // Only current turn can shoot
      if (room.players[room.turnIndex].id !== socket.id) return;

      room.projectiles.push({
        id: Date.now() + "_" + socket.id,
        x: player.x,
        y: player.y,
        angle: action.angle,
        power: action.power,
        ownerId: socket.id,
        vx: action.power * Math.cos(action.angle * Math.PI / 180),
        vy: action.power * Math.sin(action.angle * Math.PI / 180),
        gravity: 9.8
      });

      // Advance turn
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    }

    io.to(roomId).emit("roomUpdate", room);
  });

  // Player disconnects
  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit("roomUpdate", room);

      // Clean up empty rooms
      if (room.players.length === 0) delete rooms[roomId];
    }
  });
});

// -----------------------------
// SERVER TICK LOOP (PROJECTILE PHYSICS)
// -----------------------------
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    room.projectiles.forEach((proj) => {
      // Apply gravity
      proj.vy += proj.gravity / TICK_RATE;
      proj.x += proj.vx / TICK_RATE;
      proj.y += proj.vy / TICK_RATE;

      // Collision detection with players
      room.players.forEach(player => {
        if (player.id !== proj.ownerId) {
          const dx = proj.x - player.x;
          const dy = proj.y - player.y;
          const distance = Math.sqrt(dx*dx + dy*dy);

          if (distance < 30) { // hit radius
            player.hp -= 20; // damage
            proj.hit = true;
          }
        }
      });

      // Remove projectile if hit or out of bounds
      if (proj.y > 600 || proj.x < 0 || proj.x > 800 || proj.hit) {
        proj.remove = true;
      }
    });

    room.projectiles = room.projectiles.filter(p => !p.remove);

    // Broadcast updated room state
    io.to(roomId).emit("roomUpdate", room);
  }
}, 1000 / TICK_RATE);

// -----------------------------
// START SERVER
// -----------------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Gunbound Server running on port ${PORT}`));
