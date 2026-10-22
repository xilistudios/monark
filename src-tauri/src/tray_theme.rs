//! Theme-aware system-tray icon.
//!
//! On Linux desktop (StatusNotifierItem / KDE Plasma) the tray PNG is painted
//! as-is, so a white monochrome icon is invisible on a light panel. This module
//! resolves the *system* color scheme through the FreeDesktop settings portal
//! (`org.freedesktop.portal.Settings`) and recolors the existing white asset:
//!
//! * system prefers **dark**  → icon stays **white** (RGB 255,255,255)
//! * system prefers **light** → icon becomes **dark grey** (`0x3C3C3C`)
//! * anything else / any error → fallback **white** (the historical behavior)
//!
//! The portal is also watched so the tray updates live when the user switches
//! theme in Plasma, without restarting the app.
//!
//! Pure logic ([`icon_tone_for_color_scheme`], [`recolor_monochrome`],
//! [`image_for_tone`], [`is_appearance_color_scheme_change`]) is separated from
//! the D-Bus I/O (Linux-only: `read_system_color_scheme`,
//! `spawn_scheme_watcher`) so it can be unit-tested without a session bus — and
//! so the module compiles wherever the tray does.
//!
//! # Platform split (cross-compilation contract)
//!
//! The `zbus` crate is a **Linux-only** dependency (see `Cargo.toml`
//! `[target.'cfg(target_os = "linux")'.dependencies]`), while this module is
//! declared with `#[cfg(desktop)]` in `lib.rs` and therefore also compiles on
//! macOS/Windows. To keep those release targets building, everything that
//! mentions `zbus` (types, functions, constants, imports and tests) lives in
//! the [`portal`] submodule, which is gated with `#[cfg(target_os = "linux")]`
//! and re-exports the two Linux-only entry points (`read_system_color_scheme`,
//! `spawn_scheme_watcher`). `lib.rs` already calls those two functions behind
//! `#[cfg(target_os = "linux")]`, so on macOS/Windows the module surface is
//! purely the zbus-free helpers above.

use tauri::image::Image;

/// Icon RGB used when the system prefers a **light** color scheme.
///
/// Dark grey `0x3C3C3C` so the monochrome glyph stays readable on a light
/// panel (KDE Plasma light status area).
pub const LIGHT_PANEL_ICON_RGB: [u8; 3] = [0x3C, 0x3C, 0x3C];

/// Icon RGB used when the system prefers a **dark** color scheme (or for the
/// safe fallback): the original white asset, unchanged.
pub const DARK_PANEL_ICON_RGB: [u8; 3] = [0xFF, 0xFF, 0xFF];

/// Namespace/key watched on the portal (see the FreeDesktop `color-scheme`
/// spec: <https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html>).
const APPEARANCE_NAMESPACE: &str = "org.freedesktop.appearance";
const COLOR_SCHEME_KEY: &str = "color-scheme";

/// Which color the tray icon should have, given the system color scheme.
///
/// Variants are named after the **icon** color, not the panel: `Light` means
/// "draw the icon light-colored white" (system prefers a dark panel), `Dark`
/// means "draw the icon dark grey" (system prefers a light panel).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconTone {
    /// White icon (RGB 255,255,255) — used on dark panels.
    Light,
    /// Dark-grey icon (RGB `0x3C3C3C`) — used on light panels.
    Dark,
}

impl IconTone {
    /// The RGB triple used to recolor the monochrome source asset.
    pub fn rgb(self) -> [u8; 3] {
        match self {
            IconTone::Light => DARK_PANEL_ICON_RGB,
            IconTone::Dark => LIGHT_PANEL_ICON_RGB,
        }
    }
}

/// Map an `org.freedesktop.appearance` `color-scheme` value to the icon tone.
///
/// * `1` (prefer-dark) → `Some(IconTone::Light)` (white icon)
/// * `2` (prefer-light) → `Some(IconTone::Dark)` (dark-grey icon)
/// * `0` (no-preference) or anything else → `None` (caller falls back to white)
pub fn icon_tone_for_color_scheme(value: u32) -> Option<IconTone> {
    match value {
        1 => Some(IconTone::Light),
        2 => Some(IconTone::Dark),
        _ => None,
    }
}

/// Should a `SettingChanged(namespace, key, _)` signal trigger a tray update?
///
/// Pure predicate so it can be tested without a bus: we react only to
/// `org.freedesktop.appearance` / `color-scheme` and ignore every other
/// portal setting. Takes plain `&str` (no zbus types in the signature) so it
/// also compiles and tests on macOS/Windows.
pub fn is_appearance_color_scheme_change(namespace: &str, key: &str) -> bool {
    namespace == APPEARANCE_NAMESPACE && key == COLOR_SCHEME_KEY
}

/// Replace the RGB channels of an RGBA buffer, preserving every alpha byte.
///
/// The input is treated as tightly packed RGBA8 pixels (row-major); the output
/// has the same length, byte-for-byte alpha preserved. If `rgba.len()` is not
/// a multiple of 4, the trailing `len % 4` bytes are copied through untouched
/// (never panics; real RGBA8 buffers never hit this).
pub fn recolor_monochrome(rgba: &[u8], rgb: [u8; 3]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for px in out.chunks_exact_mut(4) {
        px[0] = rgb[0];
        px[1] = rgb[1];
        px[2] = rgb[2];
    }
    out
}

/// The shared white monochrome source asset (never duplicated or edited).
pub fn tray_icon_bytes() -> &'static [u8] {
    include_bytes!("../icons/systray_32.png")
}

/// Build the tray image for a tone, decoding the shared PNG source.
///
/// `Light` keeps the decoded pixels as-is (white asset); `Dark` rebuilds the
/// image from recolored pixels with alpha preserved.
pub fn image_for_tone(tone: IconTone) -> Image<'static> {
    let base = Image::from_bytes(tray_icon_bytes()).expect("failed to load tray icon");
    match tone {
        IconTone::Light => base,
        IconTone::Dark => {
            let rgba = recolor_monochrome(base.rgba(), tone.rgb());
            Image::new_owned(rgba, base.width(), base.height())
        }
    }
}

/// Linux-only D-Bus I/O through the FreeDesktop settings portal.
///
/// Everything in this module — the `zbus` imports, the constants only the
/// portal client needs, the blocking read/watch implementations and their
/// tests — is compiled **only** on Linux, matching the Linux-only `zbus`
/// dependency. See the module-level docs for the cross-platform contract.
#[cfg(target_os = "linux")]
mod portal {
    use super::is_appearance_color_scheme_change;
    use std::time::Duration;
    use zbus::zvariant::OwnedValue;

    /// D-Bus coordinates of the FreeDesktop settings portal.
    const PORTAL_DESTINATION: &str = "org.freedesktop.portal.Desktop";
    const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
    const PORTAL_SETTINGS_IFACE: &str = "org.freedesktop.portal.Settings";

    /// Namespace/key watched on the portal (aliases of the parent module
    /// constants, kept here so the zbus filter call-sites stay readable).
    const APPEARANCE_NAMESPACE: &str = super::APPEARANCE_NAMESPACE;
    const COLOR_SCHEME_KEY: &str = super::COLOR_SCHEME_KEY;

    /// `org.freedesktop.portal.Settings::SettingChanged` emits
    /// `(namespace, key, value)`; this is the value payload of `color-scheme`.
    type SettingChangedArgs = (String, String, OwnedValue);

    /// Short timeout for the startup portal read so a missing/hung portal never
    /// delays app boot (falls back to the white icon).
    const READ_TIMEOUT: Duration = Duration::from_millis(500);

    /// Unwrap a `zvariant::Value` down to its innermost scalar, peeling off any
    /// `variant` nesting the portal may (or may not) add.
    ///
    /// The settings-portal `Read`/`SettingChanged` payload is specified as a
    /// `variant` holding a `u32`, but zvariant's `TryFrom<Value>` does **not**
    /// auto-unwrap `Value::Value(...)` (the outer D-Bus `v` and any inner
    /// variant-of-variant must be stripped explicitly). This helper peels the
    /// nesting layers in a bounded loop (no recursion), then delegates to
    /// `u32::try_from`.
    ///
    /// Returns `None` if the innermost value is not a `u32` (caller falls back
    /// to the white icon).
    fn extract_u32(value: zbus::zvariant::Value<'_>) -> Option<u32> {
        let mut v = value;
        while let zbus::zvariant::Value::Value(inner) = v {
            v = *inner;
        }
        u32::try_from(v).ok()
    }

    /// Extract the `color-scheme` `u32` from a portal `OwnedValue` payload.
    ///
    /// Single seam used by both the startup `Read` reply and the live
    /// `SettingChanged` watcher, so any change to the unwrap logic is pinned
    /// by the serde regression tests below.
    fn scheme_value(value: OwnedValue) -> Option<u32> {
        extract_u32(zbus::zvariant::Value::from(value))
    }

    /// Extract the `color-scheme` `u32` from a settings-portal reply message
    /// body (`Read()` = `v(v(u32))` on xdg-desktop-portal 1.22).
    ///
    /// Takes the raw [`zbus::Message`] so the full deserialize-and-peel path
    /// is testable bus-free (see `read_reply_double_variant_is_unwrapped`).
    fn scheme_from_read_reply(msg: &zbus::Message) -> Option<u32> {
        let value: OwnedValue = msg.body().deserialize().ok()?;
        scheme_value(value)
    }

    /// Blocking read of `org.freedesktop.appearance`/`color-scheme` through the
    /// settings portal, with a short timeout.
    ///
    /// Returns `None` on **any** failure (no D-Bus, no portal, timeout,
    /// unexpected payload) so callers can silently fall back to the white icon.
    pub fn read_system_color_scheme() -> Option<u32> {
        // Connection with a short method timeout so a hung portal can never
        // stall startup (session bus address resolution is quick; failures
        // return None).
        let conn = zbus::blocking::connection::Builder::session()
            .ok()?
            .method_timeout(READ_TIMEOUT)
            .build()
            .ok()?;
        let proxy = zbus::blocking::Proxy::new(
            &conn,
            PORTAL_DESTINATION,
            PORTAL_PATH,
            PORTAL_SETTINGS_IFACE,
        )
        .ok()?;
        // `call_method` (not `call`) so the raw reply body flows through the
        // same `scheme_from_read_reply` seam covered by the serde regression
        // test. The portal wraps the u32 in one or more `variant` layers
        // (`v(v(u32))` on xdg-desktop-portal 1.22) — see `extract_u32`.
        let msg = proxy
            .call_method("Read", &(APPEARANCE_NAMESPACE, COLOR_SCHEME_KEY))
            .ok()?;
        scheme_from_read_reply(&msg)
    }

    /// Spawn a dedicated thread that listens for `SettingChanged` and invokes
    /// `on_change` with the raw `color-scheme` value whenever the appearance
    /// theme changes.
    ///
    /// The thread exits quietly (with a log line) if the bus/portal becomes
    /// unavailable; it never panics and never blocks the caller. If the thread
    /// itself cannot be created (e.g. `EAGAIN`), the caller is *not* failed:
    /// a log line is printed and the app continues without a live watcher.
    pub fn spawn_scheme_watcher(on_change: impl Fn(Option<u32>) + Send + 'static) {
        match std::thread::Builder::new()
            .name("tray-theme-watcher".into())
            .spawn(move || {
                if let Err(e) = watch_scheme_loop(&on_change) {
                    println!("[TrayTheme] scheme watcher stopped: {}", e);
                }
            }) {
            Ok(_handle) => {
                // Detached on purpose: the watcher lives for the whole process
                // (lib.rs never joins it).
            }
            Err(e) => {
                println!(
                    "[TrayTheme] failed to spawn tray theme watcher ({}); \
                     continuing without live color-scheme updates",
                    e
                );
            }
        }
    }

    /// Inner loop of [`spawn_scheme_watcher`] (separated for clarity).
    fn watch_scheme_loop(on_change: &dyn Fn(Option<u32>)) -> Result<(), String> {
        let conn = zbus::blocking::Connection::session().map_err(|e| e.to_string())?;
        let proxy = zbus::blocking::Proxy::new(
            &conn,
            PORTAL_DESTINATION,
            PORTAL_PATH,
            PORTAL_SETTINGS_IFACE,
        )
        .map_err(|e| e.to_string())?;

        // Only `SettingChanged` signals from the settings portal; arg filter
        // keeps unrelated portal traffic off our queue (server-side filtering).
        let mut signals = proxy
            .receive_signal_with_args(
                "SettingChanged",
                &[(0, APPEARANCE_NAMESPACE), (1, COLOR_SCHEME_KEY)],
            )
            .map_err(|e| e.to_string())?;

        loop {
            let msg = match signals.next() {
                Some(msg) => msg,
                // Bus/portal went away: log and end the watcher.
                None => return Err("signal stream ended".into()),
            };
            let (namespace, key, value): SettingChangedArgs = match msg.body().deserialize() {
                Ok(args) => args,
                // Ignore malformed payloads instead of dying.
                Err(_) => continue,
            };
            if !is_appearance_color_scheme_change(&namespace, &key) {
                continue;
            }
            on_change(scheme_value(value));
        }
    }

    /// Linux-only tests for the portal payload and process-global environment.
    ///
    /// The zbus-free helper tests live in the crate-level `tray_theme::tests`
    /// module below; they run on every desktop platform, while the tests here
    /// compile only when `zbus` and the portal implementation are available.
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::sync::{Mutex, MutexGuard, OnceLock};

        #[test]
        fn extract_u32_from_plain_value() {
            use zbus::zvariant::Value;
            assert_eq!(extract_u32(Value::U32(2)), Some(2));
        }

        #[test]
        fn extract_u32_from_single_variant_wrap() {
            use zbus::zvariant::Value;
            // The portal's real payload: one `variant` holding a `u32`.
            let wrapped = Value::Value(Box::new(Value::U32(2)));
            assert_eq!(extract_u32(wrapped), Some(2));
        }

        #[test]
        fn extract_u32_from_double_variant_wrap() {
            use zbus::zvariant::Value;
            // Defensive: tolerate a variant-of-variant payload.
            let wrapped = Value::Value(Box::new(Value::Value(Box::new(Value::U32(2)))));
            assert_eq!(extract_u32(wrapped), Some(2));
        }

        #[test]
        fn extract_u32_rejects_non_u32_payload() {
            use zbus::zvariant::Value;
            assert_eq!(extract_u32(Value::Str("nope".into())), None);
            assert_eq!(extract_u32(Value::Bool(true)), None);
            let wrapped_not_u32 = Value::Value(Box::new(Value::Str("nope".into())));
            assert_eq!(extract_u32(wrapped_not_u32), None);
        }

        /// Regression for the serde layer: the portal `Read()` reply body is
        /// `v(v(u32))`, i.e. the *structure* wraps a *variant* that wraps
        /// another *variant* holding the `u32`. This pins that
        /// `msg.body().deserialize::<OwnedValue>()` really produces the
        /// `Value(Value(U32))` shape that `extract_u32` then peels — without
        /// it a change in the serde layer would silently turn `None` into a
        /// fallback-white icon (or vice versa) even though the `extract_u32`
        /// unit tests stayed green. Bus-free: builds the message in memory.
        #[test]
        fn read_reply_double_variant_is_unwrapped() {
            // Read() = v(v(u32)); SettingChanged = (ssv) con un solo nivel
            let body = (zbus::zvariant::Value::Value(Box::new(
                zbus::zvariant::Value::U32(2),
            )),);
            let msg = zbus::Message::signal("/x", "org.example.I", "S")
                .unwrap()
                .build(&body)
                .unwrap();
            assert_eq!(scheme_from_read_reply(&msg), Some(2));
        }

        /// Serializes access to `DBUS_SESSION_BUS_ADDRESS` for tests that
        /// mutate it (process-global env var ⇒ tests run in parallel by
        /// default). Follows the repo's `OnceLock<Mutex<()>>` convention.
        fn env_lock() -> MutexGuard<'static, ()> {
            static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
            match LOCK.get_or_init(|| Mutex::new(())).lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            }
        }

        /// Save/restore a single env var around a test body (Drop restores the
        /// previous value, or removes the var if it was unset).
        struct EnvVarGuard {
            key: &'static str,
            prev: Option<String>,
        }

        impl EnvVarGuard {
            fn set(key: &'static str, value: &str) -> Self {
                let prev = std::env::var(key).ok();
                std::env::set_var(key, value);
                Self { key, prev }
            }
        }

        impl Drop for EnvVarGuard {
            fn drop(&mut self) {
                match &self.prev {
                    Some(prev) => std::env::set_var(self.key, prev),
                    None => std::env::remove_var(self.key),
                }
            }
        }

        /// With a session-bus address that cannot possibly exist, the client
        /// must return `None` (never panic, never hang): the app then falls
        /// back to the white icon. The env var is process-global, so this test
        /// holds the shared lock for its whole body and restores the previous
        /// value on drop.
        #[test]
        fn read_system_color_scheme_never_panics_without_bus() {
            let _lock = env_lock();
            let _guard = EnvVarGuard::set("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent");
            assert_eq!(read_system_color_scheme(), None);
        }
    }
}

/// Tests for the pure, zbus-free surface — these compile and run on **every**
/// desktop platform (macOS/Windows included), pinning the cross-platform part
/// of the module independently of the Linux-only portal code above.
#[cfg(test)]
mod tests {
    use super::*;

    /// 4 synthetic pixels with distinct alphas so alpha preservation is visible.
    fn synthetic_rgba() -> Vec<u8> {
        vec![
            255, 255, 255, 0, // white, fully transparent
            255, 255, 255, 128, // white, half-transparent
            255, 255, 255, 255, // white, opaque
            255, 255, 255, 37, // white, low alpha
        ]
    }

    #[test]
    fn recolor_replaces_rgb_and_preserves_alpha_and_length() {
        let src = synthetic_rgba();
        let out = recolor_monochrome(&src, LIGHT_PANEL_ICON_RGB);
        assert_eq!(out.len(), src.len(), "length must be preserved");
        for (i, px) in out.chunks_exact(4).enumerate() {
            assert_eq!(&px[0..3], &LIGHT_PANEL_ICON_RGB, "pixel {} RGB", i);
            assert_eq!(
                px[3],
                src[i * 4 + 3],
                "pixel {} alpha must be byte-identical",
                i
            );
        }
    }

    #[test]
    fn color_scheme_mapping_table() {
        // Pin the contract colors themselves (the tests below compare against
        // the constants, so without these asserts a changed literal would
        // silently pass every test while changing the shipped icon color).
        assert_eq!(LIGHT_PANEL_ICON_RGB, [0x3C, 0x3C, 0x3C]);
        assert_eq!(DARK_PANEL_ICON_RGB, [0xFF, 0xFF, 0xFF]);
        assert_eq!(icon_tone_for_color_scheme(1), Some(IconTone::Light));
        assert_eq!(icon_tone_for_color_scheme(2), Some(IconTone::Dark));
        assert_eq!(icon_tone_for_color_scheme(0), None);
        assert_eq!(icon_tone_for_color_scheme(3), None);
        assert_eq!(icon_tone_for_color_scheme(u32::MAX), None);
    }

    #[test]
    fn image_for_tone_matches_source_geometry() {
        let base = Image::from_bytes(tray_icon_bytes()).expect("decode source");
        for tone in [IconTone::Light, IconTone::Dark] {
            let img = image_for_tone(tone);
            assert_eq!(img.width(), base.width());
            assert_eq!(img.height(), base.height());
            assert_eq!(img.rgba().len(), base.rgba().len());
        }
    }

    #[test]
    fn image_for_tone_light_is_white_with_alpha_preserved() {
        let base = Image::from_bytes(tray_icon_bytes()).expect("decode source");
        let img = image_for_tone(IconTone::Light);
        for (i, px) in img.rgba().chunks_exact(4).enumerate() {
            let src = &base.rgba()[i * 4..i * 4 + 4];
            assert_eq!(&px[0..3], &DARK_PANEL_ICON_RGB, "pixel {} RGB", i);
            assert_eq!(px[3], src[3], "pixel {} alpha", i);
        }
    }

    #[test]
    fn image_for_tone_dark_is_grey_with_alpha_preserved() {
        let base = Image::from_bytes(tray_icon_bytes()).expect("decode source");
        let img = image_for_tone(IconTone::Dark);
        for (i, px) in img.rgba().chunks_exact(4).enumerate() {
            let src = &base.rgba()[i * 4..i * 4 + 4];
            assert_eq!(&px[0..3], &LIGHT_PANEL_ICON_RGB, "pixel {} RGB", i);
            assert_eq!(px[3], src[3], "pixel {} alpha", i);
        }
    }

    #[test]
    fn setting_changed_filter_table() {
        assert!(is_appearance_color_scheme_change(
            "org.freedesktop.appearance",
            "color-scheme"
        ));
        assert!(!is_appearance_color_scheme_change(
            "org.freedesktop.appearance",
            "accent-color"
        ));
        assert!(!is_appearance_color_scheme_change(
            "org.freedesktop.interface",
            "color-scheme"
        ));
    }
}

// Linux-only re-exports used by `lib.rs` behind `#[cfg(target_os = "linux")]`;
// the cross-platform surface (`IconTone`, `image_for_tone`, …) is defined in
// the parent module and needs no re-export.
#[cfg(target_os = "linux")]
pub use portal::{read_system_color_scheme, spawn_scheme_watcher};
