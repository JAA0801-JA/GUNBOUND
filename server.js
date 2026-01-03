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

app.get("/", (req, res) => {
  res.send("Gunbound Real-Time Game Server Running!");
});

// -----------------------------
// SOCKET.IO SETUP
// -----------------------------
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// -----------------------------
// GAME STATE
// -----------------------------
const rooms = {}; // roomId -> room object
const TICK_RATE = 30;

// -----------------------------
// SOCKET.IO CONNECTIONS
// -----------------------------
io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  // -----------------------------
  // CREATE ROOM (HOST)
  // -----------------------------
  socket.on("createRoom", ({ roomName, playerName, maxPlayers = 4 }) => {
    const roomId = "room_" + Date.now();

    rooms[roomId] = {
      id: roomId,
      name: roomName,
      hostId: socket.id,
      maxPlayers,
      status: "waiting",
      players: [],
      projectiles: [],
      turnIndex: 0,
      wind: Math.random() * 10 - 5,
      createdAt: Date.now()
    };

    socket.join(roomId);

    rooms[roomId].players.push({
      id: socket.id,
      name: playerName,
      x: 100,
      y: 100,
      hp: 100,
      ready: false
    });

    socket.emit("roomCreated", rooms[roomId]);
    io.emit("roomsUpdate", Object.values(rooms));
  });

  // -----------------------------
  // GET AVAILABLE ROOMS (LOBBY)
  // -----------------------------
  socket.on("getRooms", () => {
    socket.emit("roomsUpdate", Object.values(rooms));
  });

  // -----------------------------
  // JOIN ROOM
  // -----------------------------
  socket.on("joinRoom", ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players.length >= room.maxPlayers) return;

    socket.join(roomId);

    room.players.push({
      id: socket.id,
      name: playerName,
      x: 100,
      y: 100,
      hp: 100,
      ready: false
    });

    io.to(roomId).emit("roomUpdate", room);
    io.emit("roomsUpdate", Object.values(rooms));
  });

  // -----------------------------
  // READY SYSTEM
  // -----------------------------
  socket.on("toggleReady", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.ready = !player.ready;
    io.to(roomId).emit("roomUpdate", room);
  });

  // -----------------------------
  // START GAME (HOST ONLY)
  // -----------------------------
  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (!room.players.every(p => p.ready)) return;

    room.status = "playing";
    room.turnIndex = 0;
    room.wind = Math.random() * 10 - 5;

    io.to(roomId).emit("gameStarted", room);
    io.emit("roomsUpdate", Object.values(rooms));
  });

  // -----------------------------
  // PLAYER ACTIONS
  // -----------------------------
  socket.on("playerAction", ({ roomId, action }) => {
    const room = rooms[roomId];
    if (!room || room.status !== "playing") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // MOVEMENT
    if (action.type === "move") {
      player.x = Math.max(0, Math.min(action.x, 800));
      player.y = Math.max(0, Math.min(action.y, 600));
    }

    // SHOOTING (TURN-BASED)
    if (action.type === "shoot") {
      if (room.players[room.turnIndex].id !== socket.id) return;

      room.projectiles.push({
        id: Date.now() + "_" + socket.id,
        x: player.x,
        y: player.y,
        ownerId: socket.id,
        vx: action.power * Math.cos(action.angle * Math.PI / 180),
        vy: action.power * Math.sin(action.angle * Math.PI / 180),
        gravity: 9.8
      });

      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    }

    io.to(roomId).emit("roomUpdate", room);
  });

  // -----------------------------
  // DISCONNECT
  // -----------------------------
  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomId];
      } else {
        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
        }
        io.to(roomId).emit("roomUpdate", room);
      }
    }

    io.emit("roomsUpdate", Object.values(rooms));
  });
});

// -----------------------------
// SERVER TICK LOOP (PROJECTILES)
// -----------------------------
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    room.projectiles.forEach((proj) => {
      proj.vy += proj.gravity / TICK_RATE;
      proj.x += proj.vx / TICK_RATE;
      proj.y += proj.vy / TICK_RATE;

      room.players.forEach(player => {
        if (player.id !== proj.ownerId) {
          const dx = proj.x - player.x;
          const dy = proj.y - player.y;
          if (Math.sqrt(dx * dx + dy * dy) < 30) {
            player.hp -= 20;
            proj.hit = true;
          }
        }
      });

      if (proj.y > 600 || proj.x < 0 || proj.x > 800 || proj.hit) {
        proj.remove = true;
      }
    });

    room.projectiles = room.projectiles.filter(p => !p.remove);
    io.to(roomId).emit("roomUpdate", room);
  }
}, 1000 / TICK_RATE);

// -----------------------------
// START SERVER
// -----------------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Gunbound Server running on port ${PORT}`);
});
