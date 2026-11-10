//! Everything Roomy knows about the disk, without any UI.
//!
//! The desktop app (`src-tauri`) is a thin layer of commands on top of this
//! crate. `roomy-cli` exposes the same functions on the command line, which
//! is also what the CI smoke test runs on macOS and Windows.

pub mod apps;
pub mod bloat;
pub mod bloat_db;
pub mod browse;
pub mod cleanup;
pub mod delete;
pub mod engine;
pub mod icons;
pub mod platform;
pub mod safety;
pub mod scan;
