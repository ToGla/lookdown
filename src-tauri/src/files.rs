//! File I/O for the frontend. Rust only moves bytes: decoding, line endings
//! and byte-exact saving all live in the frontend.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Response;

/// Paths waiting for the frontend to open them: the startup arguments, then
/// anything a second instance or the OS hands us while the app runs.
#[derive(Default)]
pub struct PathQueue(Mutex<Vec<String>>);

impl PathQueue {
    pub fn new(paths: Vec<PathBuf>) -> Self {
        let q = Self::default();
        q.push(paths);
        q
    }

    pub fn push(&self, paths: Vec<PathBuf>) {
        let mut queue = self.0.lock().unwrap_or_else(|e| e.into_inner());
        queue.extend(paths.into_iter().map(|p| p.to_string_lossy().into_owned()));
    }

    pub fn drain(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

/// Every argument after the program name that is not a flag, in order,
/// resolved against `cwd` when relative.
pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|arg| {
            let path = Path::new(arg);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            }
        })
        .collect()
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn write_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| format!("{}: {e}", path.display()))
}

/// Drains the queue of paths to open.
#[tauri::command]
pub fn take_paths(queue: tauri::State<'_, PathQueue>) -> Vec<String> {
    queue.drain()
}

// File commands are `async` so Tauri runs them off the main thread: a slow
// or network disk must not freeze the window.

/// Returns the raw bytes (an ArrayBuffer on the JavaScript side).
/// Also opens the user's documents, which may live on a network share, so it
/// does not refuse UNC paths; image reads are gated by `file_size`, which the
/// frontend's image loader always calls first.
#[tauri::command(async)]
pub fn read_file(path: String) -> Result<Response, String> {
    read_bytes(Path::new(&path)).map(Response::new)
}

#[tauri::command(async)]
pub fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_bytes(Path::new(&path), &contents)
}

/// Refuses UNC and device paths for `file_size` (and so image loads; not for
/// `file_stamp`, see there): on Windows
/// merely touching one opens an SMB connection that sends the user's
/// credentials. Rejects paths starting with two separators (any mix of `/`
/// and `\`: `//host`, `\\?\`, `\\.\`) and paths containing `?` or `*` (the NT
/// prefix `\??\UNC\host\...`; both are invalid in Windows file names). A pure
/// string check, so it behaves the same on every platform.
fn check_local(path: &str) -> Result<(), String> {
    let mut chars = path.chars();
    let mut sep = || matches!(chars.next(), Some('/' | '\\'));
    if (sep() && sep()) || path.contains(['?', '*']) {
        return Err(format!("{path}: UNC, device and wildcard paths are not allowed"));
    }
    Ok(())
}

/// Size in bytes, so the frontend can refuse huge images before reading them.
#[tauri::command(async)]
pub fn file_size(path: String) -> Result<u64, String> {
    check_local(&path)?;
    let path = Path::new(&path);
    std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Modification time and size, to detect external changes cheaply.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub modified_ms: u64,
    pub size: u64,
}

/// `Ok(None)` when the file does not exist. `modified_ms` is 0 when the
/// platform cannot report a modification time (the size still differs).
///
/// Unlike `file_size`, not gated by `check_local`: it only ever receives the
/// paths of documents the user opened (arguments, drop, open dialog), never
/// paths taken from document content, and `read_file` already reads those.
/// Refusing UNC paths here would break change detection and save checks for
/// documents on a network share. `file_size` stays guarded because image
/// paths come from the Markdown text.
#[tauri::command(async)]
pub fn file_stamp(path: String) -> Result<Option<Stamp>, String> {
    let path = Path::new(&path);
    match std::fs::metadata(path) {
        Ok(m) => {
            let modified_ms = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            Ok(Some(Stamp { modified_ms, size: m.len() }))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
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
        assert!(paths_from_args(&args(&["lookdown"]), &cwd).is_empty());
    }

    #[test]
    fn relative_path_resolves_against_cwd() {
        let cwd = std::env::temp_dir();
        assert_eq!(
            paths_from_args(&args(&["lookdown", "notes.md"]), &cwd),
            vec![cwd.join("notes.md")]
        );
    }

    #[test]
    fn absolute_path_is_kept() {
        let abs = std::env::temp_dir().join("notes.md");
        let cwd = std::env::temp_dir().join("elsewhere");
        let given = abs.to_string_lossy().into_owned();
        assert_eq!(paths_from_args(&args(&["lookdown", &given]), &cwd), vec![abs]);
    }

    #[test]
    fn flags_are_skipped() {
        let cwd = std::env::temp_dir();
        assert_eq!(
            paths_from_args(&args(&["lookdown", "--flag", "notes.md"]), &cwd),
            vec![cwd.join("notes.md")]
        );
    }

    #[test]
    fn every_path_is_returned_in_order() {
        let cwd = std::env::temp_dir();
        let abs = std::env::temp_dir().join("c.md");
        let given = abs.to_string_lossy().into_owned();
        assert_eq!(
            paths_from_args(&args(&["lookdown", "a.md", "-x", "b.md", &given]), &cwd),
            vec![cwd.join("a.md"), cwd.join("b.md"), abs]
        );
    }

    #[test]
    fn queue_drain_returns_everything_and_empties_it() {
        let q = PathQueue::default();
        q.push(vec![PathBuf::from("/a.md"), PathBuf::from("/b.md")]);
        q.push(vec![PathBuf::from("/c.md")]);
        assert_eq!(q.drain().len(), 3);
        assert!(q.drain().is_empty());
    }

    #[test]
    fn queue_can_be_seeded() {
        let q = PathQueue::new(vec![PathBuf::from("/a.md")]);
        assert_eq!(q.drain(), vec![PathBuf::from("/a.md").to_string_lossy().into_owned()]);
    }

    #[test]
    fn file_stamp_reports_size_and_time() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.md");
        write_bytes(&path, b"abcd").unwrap();
        let stamp = file_stamp(path.to_string_lossy().into_owned()).unwrap().unwrap();
        assert_eq!(stamp.size, 4);
        assert!(stamp.modified_ms > 0);
    }

    #[test]
    fn file_stamp_of_a_missing_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.md");
        assert!(file_stamp(path.to_string_lossy().into_owned()).unwrap().is_none());
    }

    /// `file_stamp` takes the paths of documents the user opened, which may sit
    /// on a share: a path starting with two separators is stamped, not refused.
    /// A local temp file reached that way (`\\?\` verbatim on Windows, `//` on
    /// Unix) shows it without touching the network.
    #[test]
    fn file_stamp_accepts_paths_starting_with_two_separators() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.md");
        write_bytes(&path, b"abcd").unwrap();
        let plain = path.to_string_lossy().into_owned();
        let doubled = if cfg!(windows) { format!(r"\\?\{plain}") } else { format!("/{plain}") };
        let stamp = file_stamp(doubled).unwrap().unwrap();
        assert_eq!(stamp.size, 4);
    }

    #[test]
    fn stamp_serializes_camel_case() {
        let json = serde_json::to_string(&Stamp { modified_ms: 5, size: 7 }).unwrap();
        assert_eq!(json, r#"{"modifiedMs":5,"size":7}"#);
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
    fn file_size_reports_byte_length() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("three.bin");
        write_bytes(&path, b"abc").unwrap();
        assert_eq!(file_size(path.to_string_lossy().into_owned()), Ok(3));
    }

    #[test]
    fn file_size_of_a_missing_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.png");
        let err = file_size(path.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("missing.png"), "{err}");
    }

    #[test]
    fn file_size_refuses_unc_and_device_paths() {
        for path in [
            "//host/share/x.png",
            r"\\host\share\x.png",
            r"\/host/share/x.png",
            r"/\host/share/x.png",
            r"\\?\C:\x.png",
            r"\\.\x",
            "//?/C:/x.png",
        ] {
            let err = file_size(path.to_string()).unwrap_err();
            assert!(err.contains("UNC"), "{path}: {err}");
        }
    }

    #[test]
    fn file_size_refuses_nt_prefix_and_wildcard_paths() {
        for path in [r"\??\UNC\h\s\x", r"\??\C:\x", "//h/s", r"C:\a*.png", "/tmp/a?.png"] {
            let err = file_size(path.to_string()).unwrap_err();
            assert!(err.contains("not allowed"), "{path}: {err}");
        }
    }

    #[test]
    fn image_commands_accept_a_normal_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ok.png");
        write_bytes(&path, b"abcd").unwrap();
        let given = path.to_string_lossy().into_owned();
        assert_eq!(file_size(given.clone()), Ok(4));
        assert!(read_file(given).is_ok());
    }

    #[test]
    fn reading_a_missing_file_names_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.md");
        let err = read_bytes(&path).unwrap_err();
        assert!(err.contains("missing.md"), "{err}");
    }
}
