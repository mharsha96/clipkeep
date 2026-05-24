import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const roomToken = crypto.randomBytes(16).toString("base64url");
const hostToken = crypto.randomBytes(16).toString("base64url");
const clips = [];
const maxTemporaryClips = 20;
const maxKeptClips = 20;
const maxTextLength = 12000;
const maxProcessedOperations = 500;
const processedOperations = new Set();

function hasToken(candidate, expected) {
  if (typeof candidate !== "string") return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isLoopback(request) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
}

function activeClips() {
  const now = Date.now();
  for (let index = clips.length - 1; index >= 0; index -= 1) {
    if (clips[index].expiresAt && clips[index].expiresAt <= now) {
      clips.splice(index, 1);
    }
  }
  return clips;
}

function trimClips() {
  for (const [pinned, maximum] of [
    [false, maxTemporaryClips],
    [true, maxKeptClips]
  ]) {
    let count = 0;
    for (let index = 0; index < clips.length; index += 1) {
      if (clips[index].pinned === pinned) {
        count += 1;
        if (count > maximum) {
          clips.splice(index, 1);
          index -= 1;
        }
      }
    }
  }
}

function acknowledge(socket, operationId) {
  if (typeof operationId === "string" && operationId.length <= 80) {
    socket.send(JSON.stringify({ type: "ack", operationId }));
  }
}

function isDuplicateOperation(operationId) {
  return typeof operationId === "string" && processedOperations.has(operationId);
}

function rememberOperation(operationId) {
  if (typeof operationId !== "string" || operationId.length > 80) return;
  processedOperations.add(operationId);
  if (processedOperations.size > maxProcessedOperations) {
    processedOperations.delete(processedOperations.values().next().value);
  }
}

function expiryFor(duration) {
  const now = Date.now();
  if (duration === "keep") return null;
  if (duration === "10m") return now + 10 * 60 * 1000;
  if (duration === "today") {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end.getTime();
  }
  return now + 60 * 60 * 1000;
}

function isEncryptedEnvelope(envelope) {
  return (
    envelope?.version === 1 &&
    typeof envelope.nonce === "string" &&
    envelope.nonce.length >= 30 &&
    envelope.nonce.length <= 40 &&
    typeof envelope.ciphertext === "string" &&
    envelope.ciphertext.length > 20 &&
    envelope.ciphertext.length <= maxTextLength * 2
  );
}

function localAddress() {
  const networks = os.networkInterfaces();
  for (const items of Object.values(networks)) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254.")) {
        return item.address;
      }
    }
  }
  return "localhost";
}

const app = express();
app.use((_request, response, next) => {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.static(path.join(dirname, "dist")));

app.get("/api/config", async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (!isLoopback(request) || !hasToken(request.query.host, hostToken)) {
    response.status(403).json({ error: "Open the Mac session URL from the terminal." });
    return;
  }

  const phoneUrl = `http://${localAddress()}:${port}/?device=iphone&room=${roomToken}`;
  response.json({
    room: roomToken,
    phoneUrl
  });
});

app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(dirname, "dist", "index.html"));
});

const server = http.createServer(app);
const sockets = new WebSocketServer({ server, path: "/socket", maxPayload: 64 * 1024 });

function sendState() {
  const message = JSON.stringify({ type: "state", clips: activeClips() });
  for (const client of sockets.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

sockets.on("connection", (socket, request) => {
  const query = new URL(request.url, `http://${request.headers.host}`).searchParams;
  if (!hasToken(query.get("room"), roomToken)) {
    socket.close(1008, "Invalid room");
    return;
  }

  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.send(JSON.stringify({ type: "state", clips: activeClips() }));
  socket.on("error", () => {
    socket.close();
  });
  let messageWindowStarted = Date.now();
  let messageCount = 0;

  socket.on("message", (raw) => {
    const now = Date.now();
    if (now - messageWindowStarted > 10000) {
      messageWindowStarted = now;
      messageCount = 0;
    }
    messageCount += 1;
    if (messageCount > 40) {
      socket.close(1008, "Too many requests");
      return;
    }

    let action;
    try {
      action = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (isDuplicateOperation(action.operationId)) {
      acknowledge(socket, action.operationId);
      return;
    }

    let changed = false;
    let accepted = false;
    if (action.type === "add") {
      if (!isEncryptedEnvelope(action.envelope)) return;
      clips.unshift({
        id: crypto.randomUUID(),
        envelope: action.envelope,
        createdAt: Date.now(),
        expiresAt: expiryFor(action.duration),
        pinned: action.duration === "keep"
      });
      trimClips();
      changed = true;
      accepted = true;
    }

    if (action.type === "delete") {
      const index = clips.findIndex((clip) => clip.id === action.id);
      if (index !== -1) {
        clips.splice(index, 1);
        changed = true;
      }
      accepted = true;
    }

    if (action.type === "pin") {
      const clip = clips.find((item) => item.id === action.id);
      if (clip) {
        clip.pinned = !clip.pinned;
        clip.expiresAt = clip.pinned ? null : expiryFor("1h");
        trimClips();
        changed = true;
      }
      accepted = true;
    }

    if (action.type === "clear") {
      if (clips.length) {
        clips.length = 0;
        changed = true;
      }
      accepted = true;
    }

    if (accepted) {
      rememberOperation(action.operationId);
      acknowledge(socket, action.operationId);
    }
    if (changed) sendState();
  });
});

setInterval(() => {
  for (const socket of sockets.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
  sendState();
}, 15000).unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`ClipKeep Mac: http://localhost:${port}/?device=mac&host=${hostToken}`);
  console.log(`ClipKeep iPhone: http://${localAddress()}:${port}/?device=iphone&room=${roomToken}`);
});
