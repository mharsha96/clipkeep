import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { WebSocket } from "ws";
import { createContentKey, openClip, sealClip } from "../src/crypto.js";

const port = 43000 + Math.floor(Math.random() * 1000);
const root = new URL("../", import.meta.url);

function launchServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 5000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/ClipKeep Mac: (http:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ child, macUrl: match[1] });
      }
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code && !output.includes("ClipKeep Mac:")) {
        reject(new Error(`Server exited with ${code}:\n${output}`));
      }
    });
  });
}

function connect(room) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}/socket?room=${room}`);
    const timeout = setTimeout(() => reject(new Error("WebSocket connection timed out")), 2000);
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      resolve({ socket, initial: JSON.parse(String(raw)) });
    });
    socket.once("error", reject);
  });
}

function nextState(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Expected state was not received"));
    }, 2000);
    function onMessage(raw) {
      const message = JSON.parse(String(raw));
      if (message.type === "state" && predicate(message.clips)) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(message.clips);
      }
    }
    socket.on("message", onMessage);
  });
}

function nextAck(socket, operationId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Acknowledgement for ${operationId} was not received`));
    }, 2000);
    function onMessage(raw) {
      const message = JSON.parse(String(raw));
      if (message.type === "ack" && message.operationId === operationId) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve();
      }
    }
    socket.on("message", onMessage);
  });
}

test("encrypts content, protects pairing, and preserves clips through relay actions", async (t) => {
  const { child, macUrl } = await launchServer();
  t.after(() => child.kill());

  const forbidden = await fetch(`http://localhost:${port}/api/config`);
  assert.equal(forbidden.status, 403, "room configuration must not be public");
  assert.equal(forbidden.headers.get("cache-control"), "no-store");
  assert.match(forbidden.headers.get("content-security-policy"), /frame-ancestors 'none'/);

  const host = new URL(macUrl).searchParams.get("host");
  const configResponse = await fetch(`http://localhost:${port}/api/config?host=${host}`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.ok(config.room);
  assert.match(config.phoneUrl, /device=iphone&room=/);

  const invalid = new WebSocket(`ws://localhost:${port}/socket?room=wrong-room`);
  const invalidClose = new Promise((resolve) => invalid.once("close", resolve));
  assert.equal(await invalidClose, 1008);

  const { socket: oversized } = await connect(config.room);
  const oversizedClose = new Promise((resolve) => oversized.once("close", resolve));
  oversized.send("x".repeat(70 * 1024));
  await oversizedClose;
  const stillRunning = await fetch(`http://localhost:${port}/api/config?host=${host}`);
  assert.equal(stillRunning.status, 200, "oversized payloads must not crash the relay");

  const { socket: sender } = await connect(config.room);
  const { socket: receiver } = await connect(config.room);
  t.after(() => sender.close());
  t.after(() => receiver.close());

  const key = createContentKey();
  const exactSnippet = "  function sendClip(text) {\n    return text;\n  }  ";
  let update;
  const exactOperation = {
    type: "add",
    operationId: "exact-snippet",
    envelope: sealClip(key, { text: exactSnippet, kind: "snippet", source: "Mac" }),
    duration: "keep",
  };
  update = nextState(receiver, (items) =>
    items.some((item) => openClip(key, item.envelope).text === exactSnippet)
  );
  sender.send(JSON.stringify(exactOperation));
  let clips = await update;
  const kept = clips.find((item) => openClip(key, item.envelope).text === exactSnippet);
  assert.equal(JSON.stringify(kept).includes(exactSnippet), false, "relay state must not contain plaintext");
  assert.equal(openClip(key, kept.envelope).kind, "snippet");
  assert.equal(kept.pinned, true);
  let acknowledgement = nextAck(sender, exactOperation.operationId);
  sender.send(JSON.stringify(exactOperation));
  await acknowledgement;
  const { socket: verifier, initial: afterDuplicate } = await connect(config.room);
  t.after(() => verifier.close());
  assert.equal(
    afterDuplicate.clips.filter((item) => openClip(key, item.envelope).text === exactSnippet).length,
    1,
    "retrying an acknowledged add must not duplicate a clip"
  );

  update = nextState(receiver, (items) =>
    items.some((item) => openClip(key, item.envelope).text === "pin-once")
  );
  sender.send(
    JSON.stringify({
      type: "add",
      operationId: "pin-target",
      envelope: sealClip(key, { text: "pin-once", kind: "text", source: "Mac" }),
      duration: "1h"
    })
  );
  clips = await update;
  const pinTarget = clips.find((item) => openClip(key, item.envelope).text === "pin-once");
  const pinOperation = { type: "pin", operationId: "pin-retry", id: pinTarget.id };
  update = nextState(receiver, (items) => items.find((item) => item.id === pinTarget.id)?.pinned === true);
  sender.send(JSON.stringify(pinOperation));
  await update;
  acknowledgement = nextAck(sender, pinOperation.operationId);
  sender.send(JSON.stringify(pinOperation));
  await acknowledgement;
  const { socket: pinVerifier, initial: afterPinRetry } = await connect(config.room);
  t.after(() => pinVerifier.close());
  assert.equal(
    afterPinRetry.clips.find((item) => item.id === pinTarget.id)?.pinned,
    true,
    "retrying a pin action must not toggle the clip back off"
  );

  update = nextState(receiver, (items) =>
    items.some((item) => openClip(key, item.envelope).text === "temporary-21")
  );
  for (let number = 1; number <= 21; number += 1) {
    sender.send(
      JSON.stringify({
        type: "add",
        operationId: `temporary-${number}`,
        envelope: sealClip(key, { text: `temporary-${number}`, kind: "text", source: "iPhone" }),
        duration: "1h"
      })
    );
  }
  clips = await update;
  assert.ok(clips.some((item) => item.id === kept.id), "kept clips survive temporary history overflow");
  assert.equal(clips.filter((item) => !item.pinned).length, 20);

  update = nextState(receiver, (items) => items.length === 0);
  sender.send(JSON.stringify({ type: "clear" }));
  await update;
});

test("rejects tampered encrypted content", () => {
  const key = createContentKey();
  const envelope = sealClip(key, { text: "hidden clip", kind: "text", source: "Mac" });
  const replacement = envelope.ciphertext.startsWith("A") ? "B" : "A";
  const tampered = { ...envelope, ciphertext: `${replacement}${envelope.ciphertext.slice(1)}` };
  assert.throws(() => openClip(key, tampered));
});
