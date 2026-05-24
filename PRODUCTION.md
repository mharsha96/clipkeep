# ClipKeep Production Architecture

## Product Boundary

The browser prototype validates intentional clip transfer. A production
iPhone-and-Mac product should be native SwiftUI applications:

- macOS menu bar app with keyboard shortcut and optional local clipboard capture
- iOS app with Share Extension for explicit sending
- local encrypted database on each device
- CloudKit private-database synchronization through `CKSyncEngine`

An iPhone web page should not be responsible for an always-live background
connection. iOS may suspend it; a native app can participate in supported sync
and notification flows.

## Sync And Connection Model

1. Write every outgoing clip to the local database first.
2. Mark the local encrypted record as pending upload.
3. Use `CKSyncEngine` to push and fetch record-zone changes in the user's
   private CloudKit database.
4. On foreground/open/paste actions, explicitly fetch changes when freshness
   matters.
5. Use remote notifications only as a refresh hint; do not promise immediate
   delivery while iOS is backgrounded.
6. Preserve idempotent operation identifiers so retries cannot duplicate clips
   or toggle state twice.

This is an offline-first system: the inbox remains usable when either device is
sleeping or disconnected, and sync resumes from persisted state.

## Encryption Model

### Prototype

The browser build uses a random 256-bit content key transferred in the QR URL
fragment. The relay receives encrypted envelopes generated with
XChaCha20-Poly1305 and fresh 192-bit nonces. It can see expiry and pin metadata
but cannot read clip content. Any pending browser sends are persisted only as
encrypted envelopes so they can resume after a page reload.

### Native Release

- Generate a Curve25519 key-agreement keypair per device with CryptoKit.
- Store private key material in Keychain, backed by the strongest appropriate
  device protection and access policy.
- Pair by QR code containing the new device public key and a one-time
  authenticated invitation.
- Derive per-device wrapping keys through Curve25519 key agreement and HKDF.
- Generate a random content-encryption key per clip and seal its payload with
  CryptoKit authenticated encryption.
- Wrap the content key separately for each authorized device.
- Revoke a device by removing it from future key wrapping; offer rotation for
  retained pinned content.
- Never include plaintext clipboard bodies in CloudKit records, logs,
  notifications, analytics, crash reports, or previews.

## Privacy Defaults

- Explicit save/share only on iPhone.
- Temporary clips expire by default.
- Do not capture likely credentials automatically.
- Hide text in notifications by default.
- Provide device list, revoke device, clear all, export/delete data, and pause
  syncing controls.

## Release Gates

- Real-device iPhone and macOS tests for foreground, background, offline,
  reconnect, expiry, and conflict behavior.
- Threat-model review of pairing, key storage, CloudKit records, and revocation.
- Cryptography review before accepting secrets or authentication codes.
- Accessibility, VoiceOver, keyboard navigation, and Dynamic Type checks.
- App Store privacy disclosures and a plain-language privacy policy.
- Crash recovery, migration, data-deletion, and update testing.

Until these gates pass, ClipKeep should be treated as an encrypted product
prototype, not a secure vault.
