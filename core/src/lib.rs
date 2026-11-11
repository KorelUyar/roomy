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
pub mod health;
pub mod icons;
pub mod malware;
pub mod platform;
pub mod quit;
pub mod safety;
pub mod scan;
pub mod tools;
