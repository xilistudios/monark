# Plan: Biometric Vault Unlock con tauri-plugin-biometry

## 1. Resumen

Integrar `tauri-plugin-biometry` (v0.2.6, Tauri v2) en Monark para permitir desbloquear vaults con autenticación biométrica (Touch ID, Face ID, fingerprint, Windows Hello) en lugar de escribir la master password cada vez.

**Plugin**: https://github.com/Choochmeque/tauri-plugin-biometry
**Compatibilidad**: Android, iOS, macOS, Windows, Linux (parcial — Linux usa keyring sin biometric prompt nativo)

---

## 2. Cómo funciona el plugin

El plugin expone estos métodos (guest-js):

| Método | Descripción |
|---|---|
| `checkAvailability()` | Devuelve si hay biometría disponible y enrolada |
| `authenticate(prompt, fallback)` | Prompt biométrico al usuario. Resuelve true/false |
| `storeData(key, data)` | Guarda datos cifrados con clave biométrica (requiere auth) |
| `retrieveData(key)` | Recupera datos (requiere auth biométrica) |
| `deleteData(key)` | Elimina datos almacenados |
| `hasData(key)` | Verifica si existe data para esa clave |

**Flujo de uso**: `storeData` cifra los datos con una clave derivada del hardware biométrico. `retrieveData` pide autenticación biométrica y descifra. Los datos NUNCA se guardan en plano — están protegidos por el Secure Enclave (macOS), Keystore (Android), Keychain (iOS), o TPM (Windows).

---

## 3. Arquitectura del feature

### Flujo de ENABLE biometric (opt-in por vault)

```
Usuario tiene vault desbloqueado (password en memoria)
→ Va a Settings → "Enable Biometric Unlock"
→ checkAvailability() → si no disponible, mostrar error
→ authenticate("Enable biometric unlock for {vaultName}")
→ storeData("monark_vault_{vaultId}", password)
→ Marcar vault.biometricEnabled = true en estado persistido
→ Mostrar confirmación
```

### Flujo de UNLOCK con biometric

```
Usuario abre app → vault está locked
→ LockedVaultView detecta biometricEnabled === true
→ checkAvailability() → si disponible, auto-prompt biometric
→ authenticate("Unlock {vaultName}")
→ retrieveData("monark_vault_{vaultId}") → password
→ VaultInstance.unlock(password) (flujo existente)
→ Si falla biometric → fallback a input de password manual
```

### Flujo de DISABLE biometric

```
→ deleteData("monark_vault_{vaultId}")
→ vault.biometricEnabled = false
→ Limpiar flag en estado persistido
```

---

## 4. Consideraciones de seguridad

| Aspecto | Decisión |
|---|---|
| **Qué se guarda** | La master password del vault (necesaria para descifrar Argon2id + XChaCha20Poly1305) |
| **Dónde se guarda** | Cifrado por el plugin (Secure Enclave/Keystore/TPM), NO en disco plano |
| **Per-vault** | Cada vault tiene su propia entrada: key = `monark_vault_{vaultId}` |
| **Multi-vault** | N entradas independientes, una por vault con biometric habilitado |
| **Cloud vaults** | Igual que local — la password es la misma para descifrar el vault file |
| **Si user remueve biometría del OS** | `retrieveData` fallará → fallback automático a password input |
| **Si user cambia master password** | Hay que re-guardar la nueva password con `storeData` (re-enable) |
| **Auto-lock** | Fuera de scope de este plan (feature separado). Pero el diseño es compatible |
| **Plataformas sin biometría** | `checkAvailability()` devuelve false → UI oculta la opción |

---

## 5. Tareas de implementación

### FASE 1: Setup del plugin (backend + frontend deps)

**Tarea 1.1 — Añadir dependencia Rust**
- Editar `src-tauri/Cargo.toml`: añadir `tauri-plugin-biometry = "0.2"`
- Verificar compatibilidad con Tauri ~2.8

**Tarea 1.2 — Añadir dependencia JS**
- Ejecutar `npm install tauri-plugin-biometry-api` (o el nombre del package npm guest-js)
- Si no hay package npm publicado, copiar `guest-js/index.ts` a `src/services/biometric.ts` con bindings manuales via `@tauri-apps/api/core invoke`

**Tarea 1.3 — Registrar plugin en Tauri**
- Editar `src-tauri/src/lib.rs`: añadir `.plugin(tauri_plugin_biometry::init())` al builder
- Verificar permisos en `src-tauri/capabilities/` (añadir plugin a capabilities JSON)

**Tarea 1.4 — Configuración por plataforma**
- **Android**: `src-tauri/gen/android/app/src/main/AndroidManifest.xml` — permisos `USE_BIOMETRIC` / `USE_FINGERPRINT`
- **iOS**: Info.plist — `NSFaceIDUsageDescription`
- **macOS/Windows**: sin config adicional (entitlements del SO)
- **Linux**: el plugin usa keyring como fallback (sin prompt biométrico nativo)

---

### FASE 2: Servicio biométrico (frontend)

**Tarea 2.1 — Crear `src/services/biometric.ts`**

Wrapper del plugin con API de alto nivel:

```typescript
// Tipos
type BiometricAvailability = 
  | { available: true; biometryType: string }
  | { available: false; reason: string }

// Funciones
async function checkBiometricAvailability(): Promise<BiometricAvailability>
async function authenticate(prompt: string): Promise<boolean>
async function storeVaultPassword(vaultId: string, password: string): Promise<void>
async function retrieveVaultPassword(vaultId: string): Promise<string | null>
async function deleteVaultPassword(vaultId: string): Promise<void>
async function hasBiometricData(vaultId: string): Promise<boolean>
```

Key format: `monark_vault_${vaultId}`

**Tarea 2.2 — Tests del servicio**
- Mock de `invoke` para validar llamadas correctas
- Test de fallback cuando biometría no disponible

---

### FASE 3: Estado Redux + persistencia

**Tarea 3.1 — Extender interfaz Vault en Redux**

En `src/redux/actions/vault.ts`:

```typescript
interface Vault {
  // ... campos existentes ...
  biometricEnabled: boolean;  // NUEVO: si el user opt-in a biometric unlock
}
```

Default: `false` para vaults existentes (migración transparente).

**Tarea 3.2 — Persistir flag biometricEnabled en backend**

En `src-tauri/src/state.rs`:
- Añadir `biometric_enabled: bool` al struct `VaultPersisted` (o equivalente)
- Serializar/deserializar con default `false` (`#[serde(default)]`)
- Esto se persiste en `vault_state.json` (no contiene secrets, solo el flag)

**Tarea 3.3 — Actions de Redux para biometric**

En `src/redux/actions/vault.ts`:

```typescript
setVaultBiometricEnabled({ vaultId, enabled: boolean })
```

Actualiza `vault.biometricEnabled` en el estado.

---

### FASE 4: UI — Habilitar/deshabilitar biometric

**Tarea 4.1 — Componente BiometricSettings**

Crear `src/components/Settings/BiometricSettings.tsx`:

- Se muestra dentro de la sección de Settings del vault (o en UnlockedVaultView)
- Checkbox/toggle "Enable biometric unlock"
- Al activar:
  1. `checkBiometricAvailability()` → si false, mostrar mensaje "Biometrics not available on this device"
  2. `authenticate("Enable biometric unlock for {vaultName}")` → si cancela, no activar
  3. `storeVaultPassword(vaultId, currentPassword)` → guardar
  4. `dispatch(setVaultBiometricEnabled({vaultId, enabled: true}))`
  5. Mostrar confirmación
- Al desactivar:
  1. `deleteVaultPassword(vaultId)`
  2. `dispatch(setVaultBiometricEnabled({vaultId, enabled: false}))`

**Tarea 4.2 — Integrar en UnlockedVaultView**

En `src/components/Vault/UnlockedVaultView.tsx` (o su menú de settings):
- Añadir acceso a BiometricSettings (botón en toolbar o sección de settings)

**Tarea 4.3 — i18n**

En `src/i18n/locales/en.json` y `es.json`:
```json
{
  "biometric": {
    "title": "Biometric Unlock",
    "enable": "Enable biometric unlock",
    "disable": "Disable biometric unlock",
    "notAvailable": "Biometrics are not available on this device",
    "promptEnable": "Enable biometric unlock for {{vaultName}}",
    "promptUnlock": "Unlock {{vaultName}}",
    "enabled": "Biometric unlock is enabled",
    "disabled": "Biometric unlock is disabled",
    "unlockFailed": "Biometric authentication failed. Please enter your password.",
    "fallbackPrompt": "Use password instead"
  }
}
```

---

### FASE 5: UI — Unlock con biometric

**Tarea 5.1 — Modificar LockedVaultView**

En `src/components/Vault/LockedVaultView.tsx`:

**Comportamiento actual**: Solo input de password + botón Unlock.

**Comportamiento nuevo**:

```
useEffect on mount:
  if vault.biometricEnabled:
    availability = checkBiometricAvailability()
    if availability.available:
      showBiometricPrompt = true
      success = authenticate("Unlock {vaultName}")
      if success:
        password = retrieveVaultPassword(vaultId)
        if password:
          VaultInstance.unlock(password)
          return  // no mostrar form de password
    // si falla o no disponible → mostrar form de password normal

Render:
  if showBiometricPrompt:
    <BiometricPromptOverlay> (spinner + "Use fingerprint/Face ID")
    + botón "Use password instead" (fallback)
  else:
    <PasswordForm> (igual que ahora)
```

**Tarea 5.2 — Componente BiometricPromptOverlay** (opcional, puede ser inline)

Overlay visual mientras se espera la autenticación biométrica:
- Icono de fingerprint/face
- Texto "Authenticate to unlock"
- Botón "Cancel" / "Use password instead"
- Si el SO ya muestra su propio prompt (macOS Touch ID dialog), este overlay es solo un backdrop

---

### FASE 6: Manejo de edge cases

**Tarea 6.1 — Cambio de master password**

En el flujo de `change_cloud_vault_password` (y cualquier futuro change-password local):
- Si `vault.biometricEnabled === true`:
  1. Después de cambiar la password exitosamente
  2. `storeVaultPassword(vaultId, newPassword)` (re-guardar con nueva password)
  3. Si falla → `setVaultBiometricEnabled({vaultId, enabled: false})` + notificar al user

**Tarea 6.2 — Biometría removida del OS**

- `retrieveVaultPassword` falla → catch error → fallback a password input
- Mostrar mensaje: "Biometric data no longer available. Please enter your password."
- Opcional: ofrecer re-enable después de unlock exitoso

**Tarea 6.3 — Eliminar vault**

En el flujo de `removeVault` (Redux action):
- Si `vault.biometricEnabled`: `deleteVaultPassword(vaultId)` (limpiar datos del plugin)

**Tarea 6.4 — Múltiples vaults**

- Cada vault es independiente (key = `monark_vault_{vaultId}`)
- Habilitar biometric en un vault no afecta a otros
- LockedVaultView usa el vaultId del vault actual

---

### FASE 7: Tests y validación

**Tarea 7.1 — Tests unitarios (frontend)**
- `src/services/__tests__/biometric.test.ts`: mock invoke, validar llamadas
- `src/components/Settings/__tests__/BiometricSettings.test.tsx`: toggle enable/disable
- `src/components/Vault/__tests__/LockedVaultView.test.tsx`: flujo biometric + fallback

**Tarea 7.2 — Tests de integración (Rust)**
- Validar que `biometric_enabled` se persiste correctamente en vault_state.json
- Validar default false para vaults existentes (migración)

**Tarea 7.3 — Validación manual por plataforma**
- [ ] macOS: Touch ID (si disponible)
- [ ] Linux: keyring fallback (sin prompt biométrico, pero storeData/retrieveData funcionan)
- [ ] Windows: Windows Hello (si disponible)
- [ ] Dispositivo sin biometría: UI oculta la opción

---

## 6. Archivos a crear/modificar

### NUEVOS
| Archivo | Descripción |
|---|---|
| `src/services/biometric.ts` | Wrapper del plugin biométrico |
| `src/components/Settings/BiometricSettings.tsx` | UI toggle enable/disable |
| `src/services/__tests__/biometric.test.ts` | Tests del servicio |

### MODIFICADOS
| Archivo | Cambio |
|---|---|
| `src-tauri/Cargo.toml` | Añadir `tauri-plugin-biometry` dep |
| `src-tauri/src/lib.rs` | Registrar plugin `.init()` |
| `src-tauri/capabilities/default.json` | Añadir permisos del plugin |
| `src-tauri/src/state.rs` | `biometric_enabled` field en VaultPersisted |
| `package.json` | Añadir dep npm del plugin (si publicada) |
| `src/redux/actions/vault.ts` | `biometricEnabled` field + action `setVaultBiometricEnabled` |
| `src/components/Vault/LockedVaultView.tsx` | Auto-prompt biometric + fallback |
| `src/components/Vault/UnlockedVaultView.tsx` | Acceso a BiometricSettings |
| `src/i18n/locales/en.json` | Keys de traducción biometric |
| `src/i18n/locales/es.json` | Keys de traducción biometric |

### Plataforma (condicional)
| Archivo | Cambio |
|---|---|
| `AndroidManifest.xml` | Permisos biometric (si build Android) |
| `Info.plist` | `NSFaceIDUsageDescription` (si build iOS) |

---

## 7. Orden de ejecución recomendado

```
Fase 1 (Setup)          → sin UI, solo deps y registro
Fase 3 (Estado)         → struct + Redux, sin UI todavía  
Fase 2 (Servicio)       → wrapper frontend del plugin
Fase 4 (UI Enable)      → toggle en settings
Fase 5 (UI Unlock)      → integrar en lock screen
Fase 6 (Edge cases)     → password change, vault delete, fallback
Fase 7 (Tests)          → unit + manual
```

Cada fase es independiente y puede delegarse atómicamente al coder.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Plugin no publicado en npm | Copiar guest-js/index.ts manualmente como `src/services/biometric.ts` |
| Linux sin prompt biométrico nativo | `checkAvailability()` devuelve false en Linux sin biometric → UI oculta opción. Si tiene fingerprint reader (algunos laptops), funciona via keyring |
| Master password en memoria tras biometric unlock | Igual que unlock manual — la password va a Redux volatile (en RAM, cleared on lock). No peor que el flujo actual |
| User cambia biometría del OS (enrola nuevo dedo) | Depende del SO: macOS/iOS invalidan datos → fallback a password. Android los mantiene. Ambos casos cubiertos por el fallback |
| Plugin abandonado/maintenance | Es MIT license,