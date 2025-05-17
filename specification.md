**Especificación Técnica Actualizada – Gestor de Contraseñas Híbrido (v1.2)**

**1. Objetivo**

Desarrollar un gestor de contraseñas multiplataforma (desktop y mobile, con Tauri) que:

* Use una clave maestra aleatoria (256-bit) generada criptográficamente.
* Proteja la clave maestra cifrándola con una clave derivada de la contraseña del usuario mediante Argon2id.
* Cifre cada entrada de la bóveda de forma individual con una subclave única derivada mediante HKDF, utilizando un salt por entrada.
* Cifre el archivo completo del vault en disco (protegiendo metadatos y estructura) con la clave maestra usando XChaCha20Poly1305.
* Permita búsqueda **segura y eficiente** por campos específicos y organización por grupos sin exponer los datos sensibles en reposo.
* Asegure la integridad y autenticidad de los datos cifrados mediante AEAD (XChaCha20Poly1305).

**2. Estructura del Archivo en Disco (Vault File)**

```json
{
  "version": "1.2", // Versión actualizada
  "argon2_params": {
    "salt": "base64_salt_unico_para_usuario",
    "m_cost": 19456, // Ejemplo: 19 MiB
    "t_cost": 3,     // Ejemplo: número de pasadas
    "p_cost": 4      // Ejemplo: grado de paralelismo
  },
  "credential": {
    "nonce": "base64_nonce_unico_XChaCha20",
    "ciphertext": "base64_clave_maestra_cifrada_con_kdf_key",
  },
  "vault": {
    "nonce": "base64_nonce_unico_XChaCha20_para_vault",
    "ciphertext": "base64_json_del_vault_cifrado_con_master_key" // Contiene el índice y las entradas
  }
}
```

* **`version`**: Indica la versión de la estructura del archivo.
* **`argon2_params`**: Contiene el salt único del usuario y los parámetros (coste de memoria, iteraciones, paralelismo) necesarios para Argon2id. Estos parámetros deben ser elegidos cuidadosamente para ofrecer buena resistencia en el hardware actual.
* **`credential`**: La clave maestra cifrada con la clave derivada (`kdf_key`) de la contraseña del usuario.
* **`vault`**: El contenido completo del vault (la estructura JSON descrita en la sección 4, incluyendo el índice de búsqueda), cifrado con la clave maestra.

**3. Flujo del Sistema**

* **Inicio / Creación del Vault:**
    * El sistema genera una clave maestra aleatoria de 32 bytes (`[u8; 32]`) usando un CSPRNG.
    * El usuario crea una contraseña maestra.
    * Se genera un `salt` aleatorio para el usuario (p.ej., 16 bytes).
    * Se seleccionan los parámetros para Argon2id (`m_cost`, `t_cost`, `p_cost`).
    * Se deriva la `kdf_key` (32 bytes) a partir de la contraseña, el `salt` y los parámetros usando Argon2id.
    * La clave maestra se cifra usando XChaCha20Poly1305 con la `kdf_key` y un `nonce` aleatorio único (24 bytes).
    * Se crea una estructura de vault vacía (ver sección 4), incluyendo un `search_index` vacío.
    * Esta estructura se serializa a JSON y se cifra usando XChaCha20Poly1305 con la `clave maestra` y un `nonce` aleatorio único (24 bytes).
    * Se guarda el archivo en disco con la estructura definida en la sección 2.

* **Desbloqueo del Vault:**
    * El usuario ingresa su contraseña maestra.
    * Se leen los `argon2_params` del archivo.
    * Se deriva la `kdf_key` usando Argon2id con la contraseña ingresada, el `salt` y los parámetros leídos.
    * Se usa la `kdf_key` para descifrar `master_key_encrypted.ciphertext` (usando `master_key_encrypted.nonce`) y recuperar la `clave maestra`.
    * Se usa la `clave maestra` para descifrar `vault.ciphertext` (usando `vault.nonce`) y recuperar el JSON completo del vault (incluyendo `search_index` y `groups`) en memoria RAM.
    * Se deriva una clave de sesión temporal (`session_key`) a partir de la `clave maestra` usando HKDF-SHA512 (o SHA256) con `info=b"vault-session-key"` (longitud 32 bytes).
    * **Se deriva una clave de indexación (`index_key`) a partir de la `session_key` usando HKDF-SHA256 con `info=b"vault-index-key"` (longitud 32 bytes).**
    * `session_key` y `index_key` se mantienen en memoria solo mientras el vault está desbloqueado y deben ser borradas (`zeroize`) de forma segura al bloquear el vault o cerrar la aplicación.

**4. Estructura del Vault (JSON Descifrado en RAM)**

```json
{
  "updated_at": "timestamp_iso8601",
  "search_index": {
    // Clave: HMAC-SHA256(index_key, token) codificado en Base64
    // Valor: Array de entry_id (UUID v4 strings)
    "hmac_base64_token1": ["uuid_entry_1", "uuid_entry_5"],
    "hmac_base64_token2": ["uuid_entry_1"],
    "hmac_base64_token_titulo_comun": ["uuid_entry_2", "uuid_entry_5", "uuid_entry_8"]
    // ... más hmacs
  },
  "entries": [
    {
      "id": "uuid_v4_para_grupo",
      "type": "group",
      "name": "Nombre del Grupo",
      "entries": [
        {
          "id": "uuid_v4_para_entrada", // Identificador único y estable
          "data_type": "website | note | card | etc.",
          "encryption": {
            "entry_salt": "base64_salt_unico_para_esta_entrada", // Salt para HKDF (clave de entrada)
            "nonce": "base64_nonce_unico_XChaCha20_para_entrada" // Nonce para cifrado de entrada
          },
          "ciphertext": "base64_datos_de_la_entrada_cifrados"
        }
        // ... más entradas
      ]
    }, 
    {
      "id": "uuid_v4_para_entry",
      "type": "entry",
      "name": "Nombre del Entry",
      "data_type": "website | note | card | etc.",
      "encryption": {
        "entry_salt": "base64_salt_unico_para_esta_entrada", // Salt para HKDF (clave de entrada)
        "nonce": "base64_nonce_unico_XChaCha20_para_entrada" // Nonce para cifrado de entrada
      },
      "ciphertext": "base64_datos_de_la_entrada_cifrados"
    }
    // ... más grupos
  ]
}
```

* **`search_index`**: Un mapa que almacena los índices ciegos para la búsqueda. Cada clave es el resultado HMAC-SHA256 (codificado en Base64 URL-safe) de un token extraído de un campo indexable de una entrada, calculado con la `index_key`. El valor es una lista de los `entry_id` (UUIDs v4) que contienen dicho token.
* **`entry.id`**: Se usará un UUID v4 para garantizar unicidad y evitar predictibilidad.
* **`entry.encryption.entry_salt`**: Un salt aleatorio (p.ej., 16 bytes) único para cada entrada, usado en la derivación de la clave específica de esa entrada (`entry_key`). Es obligatorio.

**5. Estructura de una Entrada Individual (JSON Descifrado)**

Este es el contenido que se obtiene al descifrar `entry.ciphertext`:

```json
{
  "title": "Título descriptivo (e.g., 'Gmail')", // Indexable
  "created_at": "timestamp_iso8601",
  "updated_at": "timestamp_iso8601",
  "fields": [
    {
      "title": "Etiqueta del Campo (e.g., 'Username')",
      "property": "username", // Indexable
      "value": "usuario_ejemplo",
      "secret": false
    },
    {
      "title": "Etiqueta del Campo (e.g., 'Password')",
      "property": "password", // NO Indexar
      "value": "contraseña_muy_segura",
      "secret": true
    },
    {
      "title": "Etiqueta del Campo (e.g., 'URL')",
      "property": "url", // Indexar (p.ej., hostname)
      "value": "https://mail.google.com/mail/",
      "secret": false
    },
    {
      "title": "Etiqueta del Campo (e.g., 'Notes')",
      "property": "note", // Indexar con precaución (quizás opcional)
      "value": "Notas importantes sobre la cuenta",
      "secret": false
    }
    // ... más campos
  ],
  "tags": ["trabajo", "email", "importante"] // Indexable
  // ... otros metadatos relevantes para la entrada
}
```

* **Campos Indexables (Ejemplos):** `title`, `fields` con `property` "username", el nombre de host extraído de `fields` con `property` "url", `tags`.
* **Campos NO Indexables:** `fields` con `property` "password", contenido potencialmente muy sensible de `fields` con `property` "note". La estrategia exacta de qué indexar puede ser configurable.

**6. Cifrado, Descifrado y Gestión de Entradas**

* **Cifrado de Entradas Individuales:** Se usa XChaCha20Poly1305.
* **Clave por Entrada (`entry_key`):** Se deriva usando HKDF-SHA512 (o SHA256):
    * `entry_key = HKDF(salt=entry_salt, input_key_material=session_key, info=entry_id.bytes, output_length=32)`
    * Utiliza el `entry_salt` específico de la entrada y el `entry_id` (bytes) como `info`.
* **Nonce:** Se genera un `nonce` aleatorio (24 bytes) para cada operación de cifrado de la entrada y se almacena en `entry.encryption.nonce`.

* **Agregar/Editar una Entrada:**
    1.  Se genera un nuevo `entry_id` (UUID v4) si es una entrada nueva. Se obtiene el `entry_id` existente si es una edición.
    2.  Se estructura/actualiza el contenido de la entrada en formato JSON (ver sección 5).
    3.  **Actualizar Índice (Si es Edición):**
        * Se necesita la versión *anterior* del contenido de la entrada (puede requerir descifrarla si no está ya en caché).
        * Extraer los tokens indexables *antiguos*.
        * Para cada token antiguo, calcular su `hmac_b64` usando la `index_key` actual.
        * Eliminar el `entry_id` de la lista asociada a cada `hmac_b64` en `search_index`. Si una lista queda vacía, se puede eliminar la clave HMAC del índice.
    4.  **Actualizar Índice (Añadir/Re-añadir):**
        * Extraer los tokens indexables del contenido *nuevo* o *actualizado* de la entrada.
        * Normalizar los tokens (ej. minúsculas, separar por espacios/puntuación, extraer hostname de URL).
        * Para cada `token` normalizado:
            * Calcular `hmac = HMAC-SHA256(key=index_key, data=token.encode('utf-8'))`.
            * Codificar `hmac_b64 = base64.urlsafe_b64encode(hmac).decode('ascii')`.
            * En `search_index`: Si `hmac_b64` no existe, crearlo: `search_index[hmac_b64] = []`.
            * Si el `entry_id` no está en `search_index[hmac_b64]`, añadirlo.
    5.  **Cifrar Entrada:**
        * Se genera un `entry_salt` aleatorio (16 bytes) *si es una entrada nueva o si se decide rotar el salt en la edición*.
        * Se deriva la `entry_key` usando HKDF (con `session_key`, `entry_salt`, `entry_id.bytes`).
        * Se genera un `nonce` aleatorio (24 bytes).
        * Se cifra el JSON de la entrada con `entry_key` y `nonce` usando XChaCha20Poly1305, obteniendo el `ciphertext`.
    6.  El objeto `entry` resultante (con `id`, `data_type`, `encryption: {entry_salt, nonce}`, `ciphertext`) se agrega/actualiza en la estructura `groups` en memoria.
    7.  Se actualiza el `updated_at` del vault.
    8.  **Guardar Vault:** Antes de guardar en disco, la estructura completa del vault (JSON en RAM, incluyendo el `search_index` actualizado) se serializa. Se genera un nuevo `nonce` para el cifrado del vault completo. El JSON serializado se cifra con la `clave maestra` y este nuevo `nonce` usando XChaCha20Poly1305. Se sobrescribe el archivo en disco.

* **Lectura de una Entrada (Individual):**
    1.  Se obtiene el objeto `entry` cifrado del vault en memoria.
    2.  Se extraen `entry.id`, `entry.encryption.entry_salt` y `entry.encryption.nonce`.
    3.  Se deriva la `entry_key` usando HKDF (con `session_key`, `entry_salt` y `entry_id.bytes`).
    4.  Se descifra `entry.ciphertext` usando `entry_key` y `entry.encryption.nonce`.
    5.  Se parsea el JSON resultante para obtener los datos detallados de la entrada.

* **Búsqueda de Entradas (usando el Índice):**
    1.  Asegurarse de que el vault está desbloqueado y que `index_key` y `search_index` están disponibles en memoria.
    2.  El usuario introduce un `search_query`.
    3.  Normalizar y extraer `search_tokens` de `search_query` usando la *misma* lógica de normalización/extracción que se usó para indexar.
    4.  Inicializar un conjunto de `entry_id`s resultado (p.ej., `result_ids = null`).
    5.  Para cada `token` en `search_tokens`:
        * Calcular `hmac = HMAC-SHA256(key=index_key, data=token.encode('utf-8'))`.
        * Codificar `hmac_b64 = base64.urlsafe_b64encode(hmac).decode('ascii')`.
        * Buscar `hmac_b64` en `search_index`.
        * Si se encuentra, obtener la lista `ids_for_token = search_index[hmac_b64]`.
        * Si es el primer token (`result_ids` es `null`), establecer `result_ids = set(ids_for_token)`.
        * Si no es el primer token, actualizar `result_ids` mediante intersección: `result_ids = result_ids.intersection(set(ids_for_token))`. Si en algún punto `result_ids` queda vacío, se puede detener la búsqueda.
        * Si `hmac_b64` no se encuentra para algún token, el resultado de la intersección será vacío, por lo que ninguna entrada coincide con *todos* los tokens. (Se podría implementar lógica OR si se desea).
    6.  Si `result_ids` no es `null` y no está vacío, usar los `entry_id`s para localizar las entradas correspondientes en la estructura `groups` en memoria.
    7.  Mostrar información resumida (p.ej., título, username) de las entradas encontradas.

* **Eliminar una Entrada:**
    1.  Se identifica el `entry_id` a eliminar.
    2.  **Actualizar Índice:** Se debe descifrar la entrada una última vez para obtener sus tokens indexables. Para cada token, calcular su `hmac_b64` y eliminar el `entry_id` de la lista correspondiente en `search_index`. Si una lista queda vacía, eliminar la clave HMAC.
    3.  Eliminar el objeto `entry` de la lista `entries` dentro de su `group`.
    4.  Actualizar `updated_at` del vault.
    5.  Guardar el vault cifrado en disco como se describió anteriormente.

**7. Consideraciones de Implementación**

* **Generación Segura de Aleatoriedad:** Usar siempre un CSPRNG del sistema operativo para `clave maestra`, `salt`s y `nonce`s.
* **Seguridad en Memoria:**
    * Minimizar el tiempo que `kdf_key`, `clave maestra`, `session_key`, `index_key` y datos descifrados permanecen en RAM.
    * Usar técnicas para prevenir paginación a disco (swap) de memoria sensible.
    * Sobrescribir (poner a cero) claves y datos sensibles en memoria tan pronto como no sean necesarios (ej., `zeroize` en Rust).
* **Manejo de Errores:** Implementar manejo robusto de errores para corrupción de archivos, contraseñas incorrectas, fallos de descifrado/autenticación (AEAD), etc.
* **Actualizaciones de Parámetros:** Considerar un mecanismo para actualizar parámetros de Argon2id (requiere re-cifrado de `master_key_encrypted`).
* **Tokenización y Normalización:** Definir una estrategia clara y consistente para extraer y normalizar tokens (minúsculas, manejo de diacríticos, separación de palabras, extracción de hostname). La misma estrategia debe usarse al indexar y al buscar.
* **Campos Indexables:** Definir cuidadosamente qué campos indexar, balanceando utilidad y seguridad (evitar contraseñas, quizás hacer opcional la indexación de notas).
* **Coherencia del Índice:** Asegurar que el índice se actualice correctamente en todas las operaciones CRUD (Crear, Leer, Actualizar, Eliminar) sobre las entradas. Considerar mecanismos de verificación o reindexación completa si se detectan inconsistencias.
* **Rendimiento del Índice:** Para vaults muy grandes, la estructura del `search_index` en memoria y la eficiencia de las búsquedas HMAC y operaciones de conjunto (intersección) pueden ser importantes.

---
