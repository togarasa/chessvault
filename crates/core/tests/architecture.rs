//! Architecture tests: the dependency rules in `docs/ARCHITECTURE.md`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The direct dependencies of each workspace package, from `cargo metadata`.
fn package_dependencies() -> Vec<(String, Vec<String>)> {
    let output = Command::new(env!("CARGO"))
        .args(["metadata", "--format-version", "1", "--no-deps", "--offline"])
        .current_dir(workspace_root())
        .output()
        .expect("cargo metadata runs");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let metadata: Value = serde_json::from_slice(&output.stdout).expect("cargo metadata prints JSON");
    metadata["packages"]
        .as_array()
        .expect("packages")
        .iter()
        .map(|package| {
            let deps = package["dependencies"]
                .as_array()
                .expect("dependencies")
                .iter()
                .filter(|d| d["kind"].is_null())
                .map(|d| d["name"].as_str().expect("name").to_string())
                .collect();
            (package["name"].as_str().expect("name").to_string(), deps)
        })
        .collect()
}

fn dependencies_of(name: &str) -> Vec<String> {
    package_dependencies()
        .into_iter()
        .find(|(package, _)| package == name)
        .unwrap_or_else(|| panic!("no workspace package {name}"))
        .1
}

#[test]
fn core_depends_on_no_user_interface() {
    for dep in dependencies_of("chessvault-core") {
        assert!(
            !dep.starts_with("tauri") && dep != "clap" && dep != "app" && dep != "chessvault-cli",
            "chessvault-core must not depend on {dep}"
        );
    }
}

#[test]
fn the_cli_and_the_app_are_adapters_over_core() {
    let cli = dependencies_of("chessvault-cli");
    assert!(cli.contains(&"chessvault-core".to_string()));
    assert!(cli.iter().all(|d| !d.starts_with("tauri") && d != "app"), "the CLI must not depend on the app: {cli:?}");

    let app = dependencies_of("app");
    assert!(app.contains(&"chessvault-core".to_string()));
    assert!(!app.contains(&"chessvault-cli".to_string()), "the app must not depend on the CLI");
}

/// The source of a core module without its unit tests, with the paths it uses spelled out.
fn module_source(file: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(file);
    let source = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let code = match source.find("#[cfg(test)]") {
        Some(tests) => &source[..tests],
        None => &source,
    };
    spell_out_paths(code)
}

/// `code` with `super::` read as `crate::`, and grouped imports like `use std::{fs, process}`
/// added as `std::fs` and `std::process`, so the rules can't be passed by writing a path differently.
fn spell_out_paths(code: &str) -> String {
    let mut spelled = code.replace("super::", "crate::");
    for (start, _) in code.match_indices("::{") {
        let is_path = |c: char| c.is_alphanumeric() || c == '_' || c == ':';
        let prefix_start = code[..start].rfind(|c: char| !is_path(c)).map_or(0, |i| i + 1);
        let prefix = code[prefix_start..start].replace("super", "crate");
        let Some(end) = code[start..].find('}') else { continue };
        for item in code[start + 3..start + end].split(',') {
            let first = item.trim().split("::").next().unwrap_or("").trim();
            if !first.is_empty() {
                spelled.push('\n');
                spelled.push_str(&format!("{prefix}::{first}"));
            }
        }
    }
    spelled
}

#[test]
fn grouped_imports_and_super_paths_are_spelled_out() {
    let spelled = spell_out_paths("use std::{fs, process::Command};\nuse super::db;\nuse super::{engine};\n");
    for path in ["std::fs", "std::process", "crate::db", "crate::engine"] {
        assert!(spelled.contains(path), "{path} in {spelled}");
    }
}

/// Asserts that a module's code (without its tests) mentions none of `forbidden`.
fn assert_module_avoids(file: &str, forbidden: &[&str]) {
    let source = module_source(file);
    for name in forbidden {
        assert!(!source.contains(name), "{file} must not use `{name}` (see docs/ARCHITECTURE.md)");
    }
}

#[test]
fn the_domain_does_no_input_or_output() {
    assert_module_avoids(
        "validate.rs",
        &["crate::", "rusqlite", "reqwest", "cbvault", "std::fs", "std::process", "std::net"],
    );
}

#[test]
fn adapters_do_not_use_each_other() {
    assert_module_avoids("db.rs", &["crate::engine", "crate::online", "crate::convert", "reqwest", "cbvault"]);
    assert_module_avoids("engine.rs", &["crate::", "rusqlite", "reqwest", "cbvault"]);
    assert_module_avoids("online/lichess.rs", &["crate::", "rusqlite", "cbvault", "std::process"]);
    assert_module_avoids("convert.rs", &["crate::", "rusqlite", "reqwest", "std::process"]);
}

#[test]
fn the_library_only_combines_the_store_and_the_reader() {
    assert_module_avoids("library.rs", &["crate::engine", "crate::online", "rusqlite", "reqwest", "cbvault", "std::process"]);
}

#[test]
fn every_core_module_is_covered_by_these_rules() {
    // A new module needs a rule above; this test fails until it has one.
    let mut modules: Vec<String> = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
        .expect("lib.rs")
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            l.strip_prefix("pub mod ").or_else(|| l.strip_prefix("mod "))?.strip_suffix(';').map(str::to_string)
        })
        .collect();
    modules.sort();
    assert_eq!(modules, ["convert", "db", "engine", "library", "online", "validate"]);
    assert_eq!(module_source("online/mod.rs").trim_start().lines().filter(|l| l.starts_with("pub mod")).count(), 1);
}
