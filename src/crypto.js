import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils";
import { randomBytes } from "@noble/ciphers/webcrypto";

const keyBytes = 32;
const nonceBytes = 24;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createContentKey() {
  return randomBytes(keyBytes);
}

export function encodeContentKey(key) {
  if (!(key instanceof Uint8Array) || key.length !== keyBytes) {
    throw new Error("Invalid content key");
  }
  return bytesToBase64Url(key);
}

export function readContentKey(hash) {
  const encoded = new URLSearchParams(hash.replace(/^#/u, "")).get("key");
  if (!encoded) return null;
  try {
    const key = base64UrlToBytes(encoded);
    return key.length === keyBytes ? key : null;
  } catch {
    return null;
  }
}

export function sealClip(key, clip) {
  const nonce = randomBytes(nonceBytes);
  const plaintext = utf8ToBytes(JSON.stringify(clip));
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return {
    version: 1,
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(ciphertext)
  };
}

export function openClip(key, envelope) {
  if (!envelope || envelope.version !== 1) throw new Error("Unsupported encrypted clip");
  const nonce = base64UrlToBytes(envelope.nonce);
  if (nonce.length !== nonceBytes) throw new Error("Invalid encrypted clip nonce");
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  return JSON.parse(bytesToUtf8(xchacha20poly1305(key, nonce).decrypt(ciphertext)));
}
