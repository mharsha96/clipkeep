import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

const port = 44000 + Math.floor(Math.random() * 1000);
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
      const mac = output.match(/ClipKeep Mac: (http:\/\/\S+)/)?.[1];
      const phone = output.match(/ClipKeep iPhone: (http:\/\/\S+)/)?.[1];
      if (mac && phone) {
        clearTimeout(timeout);
        resolve({ child, macUrl: mac, phoneUrl: phone });
      }
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
  });
}

test("paired clients encrypt, transfer, and recover queued sends", async (t) => {
  const { child, macUrl, phoneUrl } = await launchServer();
  t.after(() => child.kill());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const mobile = await browser.newContext({
    viewport: { width: 320, height: 780 },
    isMobile: true,
    hasTouch: true,
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const mac = await desktop.newPage();
  const phone = await mobile.newPage();
  const errors = [];
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class TrackedSocket extends NativeSocket {
      constructor(...arguments_) {
        super(...arguments_);
        window.__clipKeepSocket = this;
        if (window.localStorage.getItem("__clipkeepHoldSocket")) {
          this.close(1000, "held for reconnect test");
        }
      }
    };
  });

  await mac.goto(macUrl);
  await mac.getByText("Synced").waitFor();
  const contentKeyFragment = new URL(mac.url()).hash;
  assert.match(contentKeyFragment, /^#key=/, "Mac creates an encryption key in its URL fragment");

  await phone.goto(`${phoneUrl}${contentKeyFragment}`);
  await phone.getByText("Synced").waitFor();
  await phone.getByRole("button", { name: "Send" }).first().click();
  assert.equal(await phone.getByText("Encrypted clips; HTTPS required for private text.").isVisible(), true);

  async function sendFromPhone(text) {
    await phone.getByRole("button", { name: "Send" }).first().click();
    await phone.locator("textarea").fill(text);
    await phone.getByRole("button", { name: "Send" }).last().click();
  }

  async function sendFromMac(text) {
    await mac.locator("textarea").fill(text);
    await mac.getByRole("button", { name: "Send" }).click();
  }

  await mac.evaluate(() => navigator.clipboard.writeText("Captured from the Mac clipboard."));
  await mac.getByRole("button", { name: "Current clipboard" }).click();
  await mac.waitForFunction(() => document.querySelector("textarea").value === "Captured from the Mac clipboard.");
  await mac.getByRole("button", { name: "Send" }).click();
  await phone.getByRole("button", { name: "Inbox" }).click();
  await phone.getByText("Captured from the Mac clipboard.").waitFor();
  await mac.getByText("Captured from the Mac clipboard.").locator("xpath=ancestor::article").getByTitle("Delete").click();
  await mac.getByText("Captured from the Mac clipboard.").waitFor({ state: "detached" });

  const snippet = "  function preserve() {\n    return true;\n  }  ";
  await sendFromPhone(snippet);
  await mac.getByText("function preserve").waitFor();
  assert.equal(await mac.locator(".clip-item.snippet p").innerText(), snippet);

  await mac.getByRole("button", { name: "1 hour" }).click();
  await mac.getByRole("button", { name: "10 min" }).click();
  await sendFromMac(`http://localhost:${port}/?opened=true`);
  await phone.getByRole("button", { name: "Inbox" }).click();
  await phone.getByText("localhost").waitFor();
  await phone.getByRole("button", { name: "Links" }).click();
  assert.match(await phone.locator(".clip-item.link").innerText(), /10m left/);
  const popupPromise = phone.waitForEvent("popup");
  await phone.getByRole("button", { name: "Open" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  assert.equal(await popup.evaluate(() => window.opener === null), true);
  await popup.close();
  await phone.getByTitle("Keep").click();
  await phone.getByText("Kept").waitFor();
  await mac.getByRole("button", { name: "Links" }).click();
  await mac.getByRole("button", { name: "Copy" }).click();
  assert.equal(await mac.evaluate(() => navigator.clipboard.readText()), `http://localhost:${port}/?opened=true`);
  await mac.getByRole("button", { name: "All" }).click();

  const filter = await phone.getByRole("button", { name: "Short codes" }).boundingBox();
  assert.ok(filter.x + filter.width <= 320, "phone filter controls fit at narrow width");

  await sendFromPhone("www.apple.com/support");
  await sendFromPhone("openai.com/research");
  await sendFromPhone("424242");
  await sendFromPhone("Please review https://example.com before tonight.");
  await sendFromPhone("Meet at (5pm).\nBring the notes.");
  await mac.getByText("apple.com").waitFor();
  await mac.getByText("openai.com").waitFor();
  await mac.getByText("424242").waitFor();
  await mac.getByText("Please review https://example.com").waitFor();
  await mac.getByText("Meet at (5pm).").waitFor();

  await mac.getByRole("button", { name: "Links" }).click();
  assert.equal(await mac.locator(".clip-item").count(), 3, "only standalone URLs should be in Links");
  assert.equal(await mac.getByText("Please review https://example.com").count(), 0);
  assert.equal(await mac.getByText("apple.com").count(), 1);
  assert.equal(await mac.getByText("openai.com").count(), 1);

  await mac.getByRole("button", { name: "Short codes" }).click();
  assert.equal(await mac.locator(".clip-item").count(), 1, "only standalone numeric codes should be short codes");
  await mac.getByText("424242").waitFor();

  await mac.getByRole("button", { name: "Text" }).click();
  assert.equal(await mac.getByText("Please review https://example.com").count(), 1);
  assert.equal(await mac.getByText("Meet at (5pm).").count(), 1);
  assert.equal(await mac.getByText("424242").count(), 0);

  await mac.getByRole("button", { name: "Snippets" }).click();
  assert.equal(await mac.locator(".clip-item").count(), 1);
  await mac.getByText("function preserve").waitFor();
  await mac.getByRole("button", { name: "All" }).click();

  await phone.getByRole("button", { name: "Send" }).first().click();
  await phone.evaluate(() => {
    window.localStorage.setItem("__clipkeepHoldSocket", "1");
    window.__clipKeepSocket.close(1000, "test outage");
  });
  await phone.locator("textarea").fill("queued through interruption");
  await phone.getByRole("button", { name: "Send" }).last().click();
  await phone.getByText("Queued until reconnected").waitFor();
  const pendingStorage = await phone.evaluate(() => JSON.stringify(window.localStorage));
  assert.equal(pendingStorage.includes("queued through interruption"), false, "pending storage is ciphertext only");
  await phone.reload();
  await phone.getByText("1 queued").waitFor({ timeout: 3000 });
  await phone.evaluate(() => {
    window.localStorage.removeItem("__clipkeepHoldSocket");
    window.dispatchEvent(new Event("online"));
  });
  await phone.getByText("Synced").waitFor({ timeout: 7000 });
  await mac.getByText("queued through interruption").waitFor();
  assert.equal(await mac.getByText("queued through interruption").count(), 1);
  await mac.getByLabel("Search clips").fill("queued through");
  assert.equal(await mac.locator(".clip-item").count(), 1);
  await mac.getByLabel("Search clips").fill("");
  await mac.getByText("function preserve").locator("xpath=ancestor::article").getByTitle("Delete").click();
  await mac.getByText("function preserve").waitFor({ state: "detached" });

  const wrongKey = `${phoneUrl}#key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const unpaired = await mobile.newPage();
  await unpaired.goto(wrongKey);
  await unpaired.getByText("A clip could not be decrypted for this paired device.").waitFor();
  assert.equal(await unpaired.getByText("queued through interruption").count(), 0);

  mac.once("dialog", (dialog) => dialog.accept());
  await mac.getByTitle("Clear inbox").click();
  await mac.getByText("No clips in this view").waitFor();
  assert.deepEqual(errors, []);
});
