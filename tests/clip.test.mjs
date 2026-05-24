import assert from "node:assert/strict";
import test from "node:test";
import { createClipPayload, displayText, openableUrl } from "../src/clip.js";

test("classifies standalone browser links and keeps them safely openable", () => {
  for (const text of [
    "https://example.com/docs?tab=sync#setup",
    "  http://localhost:4173/?test=true  ",
    "www.apple.com/support",
    "openai.com/research"
  ]) {
    const clip = createClipPayload(text, "iPhone");
    assert.equal(clip.kind, "link", text);
    assert.match(openableUrl(clip), /^https?:\/\//u);
  }
  const bare = createClipPayload("openai.com/research", "Mac");
  assert.equal(openableUrl(bare), "https://openai.com/research");
  assert.equal(displayText(bare), "openai.com");
});

test("does not make unsafe or mixed prose openable", () => {
  for (const text of [
    "javascript:alert(1)",
    "Please review https://example.com before tonight.",
    "Contact me at yesh@example.com",
    "Meet at (5pm).\nBring the notes."
  ]) {
    const clip = createClipPayload(text, "iPhone");
    assert.equal(clip.kind, "text", text);
    assert.equal(openableUrl(clip), null);
  }
});

test("distinguishes short codes, snippets, and paragraphs", () => {
  assert.equal(createClipPayload(" 424242 ", "Mac").kind, "code");
  assert.equal(createClipPayload("Call me at 424242", "Mac").kind, "text");
  assert.equal(createClipPayload("const ready = true;\nconsole.log(ready);", "Mac").kind, "snippet");
  assert.equal(createClipPayload("SELECT id\nFROM clips;", "Mac").kind, "snippet");
  assert.equal(createClipPayload("First paragraph.\nSecond paragraph (continued).", "Mac").kind, "text");
});
