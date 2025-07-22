# Redux State Management Architecture

```mermaid
stateDiagram-v2
    direction LR
    [*] --> VaultUI
    VaultUI --> VaultCore : Dispatches Actions
    VaultCore --> TauriBackend : API Calls
    TauriBackend --> VaultCore : Responses
    VaultCore --> VaultUI : State Updates
    
    state VaultUI {
        Component --> ActionCreators
        ActionCreators --> Middleware
    }
    
    state VaultCore {
        state "Vault State" as vs {
            savedVaults: Vault[]
            currentVault: Vault|null
            loading: boolean
            error: string|null
            vaultState: {
                isLocked: boolean
                entries: Entry[]
                groups: Group[]
            }
        }
        Middleware --> Reducers
        Reducers --> vs
    }
```

## State Structure
```typescript
interface VaultState {
  savedVaults: Vault[]          // List of known vaults
  currentVault: Vault | null    // Currently opened vault
  loading: boolean              // Async operation status
  error: string | null          // Error messages
  vaultState: {
    isLocked: boolean           // Encryption lock status
    encryptedData?: string      // Transient encrypted payload
    entries: Entry[]            // Decrypted credentials
    groups: Group[]             // Entry categorization
  }
}
```

## Key Actions
| Action Type | Purpose | Async | Payload |
|-------------|---------|-------|---------|
| `vault/addVault` | Register new vault | No | `Vault` object |
| `vault/setVaultState` | Update vault contents | No | Partial state |
| `vault/saveVault` | Persist changes | Yes | `{filePath, password}` |
| `vault/loadVault` | Decrypt and load | Yes | `{filePath, password}` |

## Persistence Flow
1. UI triggers save action
2. Redux thunk collects current entries
3. Serialize and encrypt via Tauri command
4. Update state with save result
5. Persist metadata to settings store (excluding sensitive data)

```mermaid
sequenceDiagram
    participant UI as React Component
    participant Redux
    participant Tauri
    participant FS as File System
    
    UI->>Redux: dispatch(saveVault({path, pwd}))
    Redux->>Tauri: write_vault(path, pwd, content)
    Tauri->>FS: Encrypt and write
    FS-->>Tauri: Write confirmation
    Tauri-->>Redux: Operation result
    Redux->>UI: Update state
```

## Testing Practices
- State shape validation
- Action type consistency checks
- Reducer pure function tests
- Async action success/failure cases
- Mutation prevention verification

## Security Controls
- No sensitive data in persisted store
- Encrypted data cleared on vault lock
- HMAC validation before decryption
- Password never stored in Redux state