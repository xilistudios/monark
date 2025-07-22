# System Architecture Patterns

## Crypto Module
- Layered encryption architecture
- Hybrid cryptosystem (Argon + ChaCha20-Poly1305)
- Secure key derivation using Argon2id
- HMAC-SHA256 for data integrity

## State Management
- Redux Toolkit with persistence layer
- Encrypted store for sensitive data
- Async actions for crypto operations
- Normalized vault entity structure

## Cross-Platform Sync
- Conflict-free Replicated Data Types (CRDTs)
- Merkle tree for version tracking
- Local-first architecture