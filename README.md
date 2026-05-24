# ClipKeep

ClipKeep is an intentional temporary inbox for moving useful text between an
iPhone and a Mac. This first prototype validates the transfer experience before
native Apple integration is built.

## Status

This repository currently contains the encrypted browser prototype. The next
milestone is a downloadable macOS menu bar app that reuses this prototype inside
a desktop shell.

## Run The Prototype

```bash
npm install
npm start
```

Open the Mac URL printed in the terminal, then scan the QR code in that view
with the iPhone while both devices are on the same Wi-Fi network.

## Run The Menu Bar App

```bash
npm install
npm run electron:dev
```

ClipKeep appears as `CK` in the macOS menu bar. Click it to open the compact
Mac inbox popover. The app starts the local relay automatically and shows the
same QR pairing flow as the browser prototype.

## Build The macOS App

```bash
npm run electron:build
```

This creates an unsigned local app bundle under `release/`. Public downloads
should be Developer ID signed and notarized before release.

## What's Included

- Mac inbox view with QR pairing, search, filters, copy, open-link, keep, and delete
- iPhone inbox and send views
- Temporary in-memory relay storing encrypted clip envelopes, never text bodies
- Link, numeric-code, text, and code-snippet presentation
- Expiration choices, up to 20 temporary clips, and up to 20 kept clips
- A pairing QR whose room key is not disclosed to unpaired network requests
- Automatic reconnection after routine network interruptions and phone backgrounding
- Encrypted local pending-send queue with acknowledged, de-duplicated retries
  across reconnection or page reload
- End-to-end content encryption using XChaCha20-Poly1305 and a QR-shared content key

## Prototype Limits

- The local HTTP transport is not production-safe against active network tampering;
  deploy behind HTTPS before using non-test content
- Clip metadata such as expiry and pin state remains visible to the relay
- No iCloud, native background delivery, device revocation, or key recovery yet
- History disappears when the relay restarts
- Use ordinary test content, not passwords or real authentication codes
- Browser clipboard support on an iPhone network URL can vary; manual copy remains
  the expected fallback before a native app exists

## Verify

```bash
npm test
```

The automated tests check that the pairing key is not available from an
unpaired request, relay state contains ciphertext rather than clip plaintext,
tampered ciphertext fails authentication, exact snippet whitespace survives a
transfer, temporary history does not evict kept clips, retries do not duplicate
an operation, and clearing synchronizes across clients.

## Native Next Step

See [PRODUCTION.md](./PRODUCTION.md) for the native production architecture and
release gates.

## License

MIT
