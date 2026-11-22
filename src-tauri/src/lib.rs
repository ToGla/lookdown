mod files;

use std::path::Path;
use tauri::{Emitter, Manager};

fn queue_paths(app: &tauri::AppHandle, paths: Vec<std::path::PathBuf>) {
    app.state::<files::PathQueue>().push(paths);
    let _ = app.emit("paths-queued", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let startup = std::env::current_dir()
        .map(|cwd| files::paths_from_args(&args, &cwd))
        .unwrap_or_default();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_paths(app, files::paths_from_args(&args, Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(files::PathQueue::new(startup))
        .invoke_handler(tauri::generate_handler![
            files::take_paths,
            files::read_file,
            files::write_file,
            files::file_size,
            files::file_stamp
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths = urls
                .iter()
                .filter(|u| u.scheme() == "file")
                .filter_map(|u| u.to_file_path().ok())
                .collect();
            queue_paths(app, paths);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    fn conf() -> Value {
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap()
    }

    #[test]
    fn app_identity_matches_spec() {
        let c = conf();
        assert_eq!(c["productName"], "lookdown");
        assert_eq!(c["identifier"], "io.github.togla.lookdown");
        let windows = c["app"]["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0]["title"], "lookdown");
    }

    #[test]
    fn version_comes_from_package_json() {
        assert_eq!(conf()["version"], "../package.json");
    }

    #[test]
    fn cargo_version_matches_package_json() {
        let pkg: Value = serde_json::from_str(include_str!("../../package.json")).unwrap();
        let m: toml::Table = include_str!("../Cargo.toml").parse().unwrap();
        assert_eq!(m["package"]["version"].as_str(), pkg["version"].as_str());
    }

    #[test]
    fn release_profile_is_size_optimized() {
        let m: toml::Table = include_str!("../Cargo.toml").parse().unwrap();
        let r = &m["profile"]["release"];
        assert_eq!(r["opt-level"].as_str(), Some("s"));
        assert_eq!(r["lto"].as_bool(), Some(true));
        assert_eq!(r["codegen-units"].as_integer(), Some(1));
        assert_eq!(r["strip"].as_bool(), Some(true));
        assert_eq!(r["panic"].as_str(), Some("abort"));
    }

    #[test]
    fn webview_is_locked_down() {
        let c = conf();
        assert_eq!(c["app"]["withGlobalTauri"], false);
        let csp = c["app"]["security"]["csp"].as_str().unwrap_or("");
        assert!(csp.contains("default-src 'self'"), "csp: {csp:?}");
    }

    #[test]
    fn window_may_set_its_title() {
        let cap: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let perms = cap["permissions"].as_array().unwrap();
        assert!(perms.contains(&Value::from("core:window:allow-set-title")));
    }

    #[test]
    fn capabilities_are_pinned() {
        let cap: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let ids: Vec<&str> = cap["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().or_else(|| p["identifier"].as_str()).unwrap())
            .collect();
        assert_eq!(
            ids,
            [
                "core:default",
                "core:window:allow-set-title",
                "core:window:allow-destroy",
                "dialog:allow-open",
                "dialog:allow-message",
                "opener:allow-open-url",
            ]
        );
    }

    #[test]
    fn links_may_open_only_web_and_mail() {
        let cap: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let entry = cap["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["identifier"] == "opener:allow-open-url")
            .expect("opener:allow-open-url entry");
        let urls: Vec<&str> = entry["allow"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["url"].as_str().unwrap())
            .collect();
        assert_eq!(urls, ["http://*", "https://*", "mailto:*"]);
    }

    #[test]
    fn bundle_icon_files_exist() {
        let c = conf();
        let icons = c["bundle"]["icon"].as_array().unwrap();
        assert!(!icons.is_empty());
        for icon in icons {
            let rel = icon.as_str().unwrap();
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
            assert!(path.is_file(), "missing bundle icon {rel}");
        }
    }

    #[test]
    fn bundle_builds_only_the_nsis_setup() {
        assert_eq!(conf()["bundle"]["targets"], serde_json::json!(["nsis"]));
    }

    #[test]
    fn publisher_is_pinned() {
        assert_eq!(conf()["bundle"]["publisher"], "ToGla");
    }

    #[test]
    fn setup_installs_per_user() {
        let nsis = &conf()["bundle"]["windows"]["nsis"];
        assert_eq!(nsis["installMode"], "currentUser");
        assert_eq!(nsis["displayLanguageSelector"], false);
    }

    #[test]
    fn markdown_extensions_are_associated() {
        let c = conf();
        let assoc = c["bundle"]["fileAssociations"].as_array().unwrap();
        assert_eq!(assoc.len(), 1);
        assert_eq!(assoc[0]["ext"], serde_json::json!(["md", "markdown"]));
        assert_eq!(assoc[0]["name"], "lookdown.markdown");
        assert_eq!(assoc[0]["description"], "Markdown document");
        assert_eq!(assoc[0]["role"], "Editor");
        assert_eq!(assoc[0]["mimeType"], "text/markdown");
    }
}
