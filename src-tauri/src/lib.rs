#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
        assert_eq!(c["identifier"], "com.lookdown.app");
        let windows = c["app"]["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0]["title"], "lookdown");
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
}
