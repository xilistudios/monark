fn main() {
    tauri_build::build();

    // Load credentials from a local .env file (gitignored) and/or runtime
    // environment variables, and emit them as compile-time environment variables.
    // These are then accessible in the source code via `option_env!("VAR_NAME")`,
    // baking the values into the binary so they don't need to be set at runtime.
    //
    // Local dev: create a `.env` file (gitignored) with your Google OAuth credentials.
    // CI/CD: set the env vars directly in the build step (e.g. GitHub Secrets).
    load_env_file();
    load_runtime_env_vars();
}

/// Check specific runtime environment variables and emit them as compile-time
/// env vars via `cargo:rustc-env`. This allows CI/CD pipelines to pass
/// credentials as environment variables (e.g. via GitHub Secrets) without
/// needing to create a `.env` file.
fn load_runtime_env_vars() {
    const CREDENTIAL_VARS: &[&str] = &[
        "MONARK_GOOGLE_DRIVE_CLIENT_ID",
        "MONARK_GOOGLE_DRIVE_CLIENT_SECRET",
        "MONARK_GOOGLE_DRIVE_REDIRECT_URI",
    ];

    for var in CREDENTIAL_VARS {
        if let Ok(value) = std::env::var(var) {
            let value = value.trim();
            if !value.is_empty() {
                println!("cargo:rustc-env={}={}", var, value);
            }
        }
    }
}

/// Parse a simple `.env` file and emit `cargo:rustc-env` directives so that
/// `option_env!()` can read the values at compile time.
///
/// Format: `KEY=VALUE` per line, `#` for comments, blank lines ignored.
/// Quotes around values are stripped. Only the first `=` is used as separator.
fn load_env_file() {
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");

    let content = match std::fs::read_to_string(&env_path) {
        Ok(c) => c,
        Err(_) => {
            // No .env file — skip silently. option_env!() will return None
            // for these vars, and the default Monark provider won't be created.
            return;
        }
    };

    for line in content.lines() {
        let line = line.trim();

        // Skip empty lines and comments
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Split on first '='
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        let key = key.trim();
        let value = value.trim();

        // Strip surrounding quotes if present
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or(value);

        if !key.is_empty() && !value.is_empty() {
            println!("cargo:rustc-env={}={}", key, value);
        }
    }
}
