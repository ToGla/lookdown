//! File I/O for the frontend. Rust only moves bytes: decoding, line endings
//! and byte-exact saving all live in the frontend.

use std::path::{Path, PathBuf};
use tauri::ipc::Response;

/// The file named on the command line at startup, if any.
pub struct StartupPath(pub Option<PathBuf>);

/// First argument after the program name that is not a flag, resolved
/// against `cwd` when relative.
pub fn path_from_args(args: &[String], cwd: &Path) -> Option<PathBuf> {
    let arg = args.iter().skip(1).find(|a| !a.starts_with('-'))?;
    let path = Path::new(arg);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    })
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn write_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn initial_path(startup: tauri::State<'_, StartupPath>) -> Option<String> {
    startup.0.as_ref().map(|p| p.to_string_lossy().into_owned())
}

/// Returns the raw bytes (an ArrayBuffer on the JavaScript side).
#[tauri::command]
pub fn read_file(path: String) -> Result<Response, String> {
    read_bytes(Path::new(&path)).map(Response::new)
}

#[tauri::command]
pub fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_bytes(Path::new(&path), &contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_argument_means_no_path() {
        let cwd = std::env::temp_dir();
        assert_eq!(path_from_args(&args(&["lookdown"]), &cwd), None);
    }

    #[test]
    fn relative_path_resolves_against_cwd() {
        let cwd = std::env::temp_dir();
        assert_eq!(
            path_from_args(&args(&["lookdown", "notes.md"]), &cwd),
            Some(cwd.join("notes.md"))
        );
    }

    #[test]
    fn absolute_path_is_kept() {
        let abs = std::env::temp_dir().join("notes.md");
        let cwd = std::env::temp_dir().join("elsewhere");
        let given = abs.to_string_lossy().into_owned();
        assert_eq!(path_from_args(&args(&["lookdown", &given]), &cwd), Some(abs));
    }

    #[test]
    fn flags_are_skipped() {
        let cwd = std::env::temp_dir();
        assert_eq!(
            path_from_args(&args(&["lookdown", "--flag", "notes.md"]), &cwd),
            Some(cwd.join("notes.md"))
        );
    }

    #[test]
    fn written_bytes_read_back_identical() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        let bytes = b"\xef\xbb\xbf# t\r\nlf\nlone\rend".to_vec();
        write_bytes(&path, &bytes).unwrap();
        assert_eq!(read_bytes(&path).unwrap(), bytes);
    }

    #[test]
    fn reading_a_missing_file_names_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.md");
        let err = read_bytes(&path).unwrap_err();
        assert!(err.contains("missing.md"), "{err}");
    }
}
