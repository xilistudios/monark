//! System update installation for Linux package-manager installs (.deb/.rpm)
//! plus a binary-replacement fallback.
//!
//! `tauri-plugin-updater` picks the install method from the bundle type chosen
//! at compile time. On Linux non-AppImage system installs that can make it take
//! the AppImage path and try to rewrite the system binary without root, which
//! fails. We therefore bypass the plugin's install step and perform it
//! ourselves via `pkexec`, while still using the plugin for check + download
//! (the minisign signature is verified inside `Update::download`).
//!
//! On Linux installs without dpkg/rpm and outside AppImage, the updater falls
//! back to replacing the current executable in-place with the signed AppImage
//! artifact (no root required): the standalone `.AppImage` file is a regular
//! ELF executable, so the downloaded bytes are written to a temp file next to
//! the current binary and atomically renamed over it.

use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use super::errors::{CommandError, CommandResult};

/// Updater target keys available in the release `latest.json` manifest.
const TARGET_APPIMAGE: &str = "linux-x86_64-appimage";
const TARGET_DEB: &str = "linux-x86_64-deb";
const TARGET_RPM: &str = "linux-x86_64-rpm";

/// Describes the update environment of the current installation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateContext {
    pub os: &'static str,
    pub is_appimage: bool,
    pub package_manager: Option<&'static str>,
    /// Informational: the latest.json target key matching this install
    /// (e.g. `linux-x86_64-deb`). The backend re-detects it internally when
    /// installing; exposed for UI display and future use.
    pub preferred_target: Option<&'static str>,
}

/// Result of a system update installation attempt.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUpdateResult {
    pub updated: bool,
    pub version: Option<String>,
}

/// Returns true when running from an AppImage.
///
/// The AppImage runtime sets `APPIMAGE` (path to the image) and `APPDIR`
/// (path to the mounted bundle) when the app is launched that way.
fn is_appimage() -> bool {
    let appimage = std::env::var("APPIMAGE").unwrap_or_default();
    let appdir = std::env::var("APPDIR").unwrap_or_default();
    !appimage.is_empty() || !appdir.is_empty()
}

/// Returns true when `cmd` resolves to an existing file inside a `PATH` dir.
fn which_exists(cmd: &str) -> bool {
    match std::env::var("PATH") {
        Ok(path_var) => std::env::split_paths(&path_var)
            .map(|dir| dir.join(cmd))
            .any(|candidate| candidate.exists()),
        Err(_) => false,
    }
}

/// Detects the system package manager, preferring dpkg (Debian/Ubuntu).
fn detect_package_manager() -> Option<&'static str> {
    // dpkg: accept the binary or its state directory (covers minimal images
    // where dpkg exists but is not on PATH).
    if which_exists("dpkg") || Path::new("/var/lib/dpkg").exists() {
        Some("dpkg")
    } else if which_exists("rpm") {
        Some("rpm")
    } else {
        None
    }
}

/// Resolves the current executable and replaces it in-place with `new_bytes`.
///
/// See [`replace_binary_at_with`] for the replacement mechanics.
#[cfg(target_os = "linux")]
fn replace_binary_at(new_bytes: &[u8]) -> CommandResult<()> {
    let exe = std::env::current_exe()
        .map_err(|e| CommandError::Io(format!("Failed to locate current executable: {e}")))?;
    let exe = std::fs::canonicalize(&exe)
        .map_err(|e| CommandError::Io(format!("Failed to resolve executable path: {e}")))?;
    replace_binary_at_with(&exe, new_bytes)
}

/// Replaces the executable at `exe` in-place with `new_bytes`.
///
/// The replacement is atomic (temp file in the same directory + rename), so
/// it works even while the binary is running: the running process keeps the
/// old inode and the new file takes effect on next launch. Original
/// permission bits (including the executable bit) are preserved.
#[cfg(unix)]
fn replace_binary_at_with(exe: &Path, new_bytes: &[u8]) -> CommandResult<()> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let dir = exe.parent().ok_or_else(|| {
        CommandError::Io("Current executable has no parent directory".to_string())
    })?;
    let mode = std::fs::metadata(exe)
        .map_err(|e| CommandError::Io(format!("Failed to stat current executable: {e}")))?
        .permissions()
        .mode();

    let mut tmp = tempfile::Builder::new()
        .prefix("monark-update-")
        .tempfile_in(dir)
        .map_err(|e| {
            CommandError::Io(format!(
                "Failed to create temp file next to executable: {e}"
            ))
        })?;
    tmp.write_all(new_bytes)
        .map_err(|e| CommandError::Io(format!("Failed to write update binary: {e}")))?;
    tmp.as_file()
        .set_permissions(PermissionsExt::from_mode(mode))
        .map_err(|e| CommandError::Io(format!("Failed to set executable permissions: {e}")))?;
    // Atomic replace via rename(2); safe while the binary is running.
    tmp.persist(exe).map_err(|e| {
        CommandError::Io(format!(
            "Failed to replace current executable (permission denied?): {e}"
        ))
    })?;
    Ok(())
}

/// Reports the update environment so the frontend can pick the right flow.
#[tauri::command]
pub fn get_update_context() -> UpdateContext {
    let os = std::env::consts::OS;
    let appimage = is_appimage();
    let package_manager = if os == "linux" {
        detect_package_manager()
    } else {
        None
    };

    let preferred_target = if os == "linux" {
        if appimage {
            Some(TARGET_APPIMAGE)
        } else {
            match package_manager {
                Some("dpkg") => Some(TARGET_DEB),
                Some("rpm") => Some(TARGET_RPM),
                // No package manager: binary-replacement fallback uses the
                // AppImage artifact.
                _ => Some(TARGET_APPIMAGE),
            }
        }
    } else {
        None
    };

    UpdateContext {
        os,
        is_appimage: appimage,
        package_manager,
        preferred_target,
    }
}

/// Checks for an update, downloads it (signature verified by the plugin) and
/// installs it system-wide via `pkexec` and the detected package manager.
///
/// Intended only for Linux non-AppImage installs; AppImage and other platforms
/// use the standard updater flow. When no dpkg/rpm is available, falls back to
/// replacing the current executable in-place with the signed AppImage artifact
/// (no root required).
#[tauri::command]
pub async fn install_system_update(app: AppHandle) -> CommandResult<SystemUpdateResult> {
    if std::env::consts::OS != "linux" {
        return Err(CommandError::Validation(
            "install_system_update is only supported on Linux".to_string(),
        ));
    }

    if is_appimage() {
        return Err(CommandError::Validation(
            "AppImage installs use the standard updater flow".to_string(),
        ));
    }

    let target = match detect_package_manager() {
        Some("dpkg") => TARGET_DEB,
        Some("rpm") => TARGET_RPM,
        // No system package manager: fall back to replacing the current
        // executable in-place using the standalone (signed) AppImage artifact.
        _ => TARGET_APPIMAGE,
    };
    // Linux-only: on other platforms the fallback branch below is compiled
    // out, so the flag would be unused.
    #[cfg(target_os = "linux")]
    let is_binary_fallback = target == TARGET_APPIMAGE;

    // Override the plugin's compile-time target so `latest.json` is looked up
    // with the key matching the actual runtime install method.
    let updater = app
        .updater_builder()
        .target(target)
        .build()
        .map_err(|e| CommandError::Internal(format!("Failed to build updater: {e}")))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|e| CommandError::Internal(format!("Failed to check for updates: {e}")))?
    else {
        // No update available; already running the latest version.
        return Ok(SystemUpdateResult {
            updated: false,
            version: None,
        });
    };

    let version = update.version.clone();

    // Download the package; the plugin verifies the minisign signature before
    // returning the bytes.
    let bytes = update
        .download(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| CommandError::Internal(format!("Failed to download update: {e}")))?;

    // Binary-replacement fallback: swap the current executable in-place with
    // the downloaded (signature-verified) standalone AppImage artifact. No
    // root required; takes effect on next launch.
    #[cfg(target_os = "linux")]
    if is_binary_fallback {
        tauri::async_runtime::spawn_blocking(move || replace_binary_at(&bytes))
            .await
            .map_err(|e| CommandError::Internal(format!("Binary update task failed: {e}")))??;
        return Ok(SystemUpdateResult {
            updated: true,
            version: Some(version),
        });
    }

    // Persist the package to a temp file for the package manager to consume.
    let suffix = match target {
        t if t.ends_with("deb") => ".deb",
        _ => ".rpm",
    };
    let tmp = tempfile::Builder::new()
        .prefix("monark-update-")
        .suffix(suffix)
        .tempfile()
        .map_err(|e| CommandError::Io(format!("Failed to create temp file for update: {e}")))?;
    std::fs::write(tmp.path(), &bytes)
        .map_err(|e| CommandError::Io(format!("Failed to write update package: {e}")))?;

    // Run the privileged install off the async runtime. `pkexec` prompts for
    // authentication through polkit; dismissing the prompt yields a
    // non-success exit status.
    let is_deb = target.ends_with("deb");
    let (status, tmp) = tauri::async_runtime::spawn_blocking(move || {
        let mut command = std::process::Command::new("pkexec");
        command.arg(if is_deb { "dpkg" } else { "rpm" });
        command.arg(if is_deb { "-i" } else { "-U" });
        command.arg(tmp.path());
        let status = command.status();
        (status, tmp)
    })
    .await
    .map_err(|e| CommandError::Internal(format!("Update installer task failed: {e}")))?;

    // Always clean up the temp package before evaluating the outcome.
    let _ = tmp.close();

    let status = status.map_err(|e| CommandError::Io(format!("Failed to run pkexec: {e}")))?;
    if !status.success() {
        return Err(CommandError::Internal(
            "Update installation failed or was cancelled (pkexec)".to_string(),
        ));
    }

    Ok(SystemUpdateResult {
        updated: true,
        version: Some(version),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_exists_detects_system_shell() {
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        assert!(which_exists(shell), "expected {shell} to be found in PATH");
    }

    #[test]
    fn which_exists_rejects_missing_binary() {
        assert!(!which_exists("monark-no-such-binary-xyz"));
    }

    #[cfg(unix)]
    mod unix_tests {
        use super::*;

        #[test]
        fn replace_binary_at_replaces_content_and_preserves_mode() {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::tempdir().expect("tempdir");
            let exe = dir.path().join("monark");
            std::fs::write(&exe, b"old-binary").expect("write old");
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).expect("chmod");

            replace_binary_at_with(&exe, b"new-binary").expect("replace");

            let content = std::fs::read(&exe).expect("read new");
            assert_eq!(content, b"new-binary");
            let mode = std::fs::metadata(&exe).expect("stat").permissions().mode();
            assert_eq!(mode & 0o777, 0o755);
        }

        #[test]
        fn replace_binary_at_rejects_missing_target() {
            let dir = tempfile::tempdir().expect("tempdir");
            let exe = dir.path().join("does-not-exist");
            assert!(replace_binary_at_with(&exe, b"x").is_err());
        }

        #[test]
        fn replace_binary_at_preserves_non_exec_mode() {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::tempdir().expect("tempdir");
            let exe = dir.path().join("monark");
            std::fs::write(&exe, b"old").expect("write");
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o644)).expect("chmod");

            replace_binary_at_with(&exe, b"new").expect("replace");

            let mode = std::fs::metadata(&exe).expect("stat").permissions().mode();
            assert_eq!(mode & 0o777, 0o644);
        }
    }
}
