# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in InTandem, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **sourabh.khot65@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

The following are in scope:

- E2E encryption implementation (AES-256-GCM, HKDF key derivation)
- Message signing and verification (HMAC-SHA256)
- Authentication flow (tokens, invite tickets)
- WebSocket hub (message routing, peer management)
- Content sanitization (prompt injection prevention)
- File path validation (`intandem_share`)

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |
