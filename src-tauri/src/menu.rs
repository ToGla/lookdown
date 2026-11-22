//! macOS menu bar. Items only emit `menu-command` events (or close the
//! window for Quit); all behaviour lives in the frontend.

/// Item ids are the frontend's command names (`Command` in `src/app.ts`).
const COMMANDS: [&str; 7] = ["open", "save", "close", "undo", "redo", "next", "previous"];

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum MenuAction {
    /// Emit `menu-command` with this command name.
    Emit(&'static str),
    /// Ask the window to close: the same prompt as its close button.
    Quit,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn action_for(id: &str) -> Option<MenuAction> {
    if id == "quit" {
        return Some(MenuAction::Quit);
    }
    COMMANDS
        .iter()
        .find(|c| **c == id)
        .map(|c| MenuAction::Emit(c))
}

/// Close request on the main window; the frontend decides (unsaved prompt).
#[cfg(target_os = "macos")]
pub fn close_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

#[cfg(target_os = "macos")]
pub fn handle(app: &tauri::AppHandle, id: &str) {
    use tauri::Emitter;
    match action_for(id) {
        Some(MenuAction::Emit(command)) => {
            let _ = app.emit("menu-command", command);
        }
        Some(MenuAction::Quit) => close_main(app),
        None => {}
    }
}

#[cfg(target_os = "macos")]
pub fn build(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let item = |id: &str, text: &str, key: &str| MenuItem::with_id(app, id, text, true, Some(key));
    let sep = || PredefinedMenuItem::separator(app);
    let info = app.package_info();
    let about = AboutMetadataBuilder::new()
        .name(Some(info.name.clone()))
        .version(Some(info.version.to_string()))
        .icon(app.default_window_icon().cloned())
        .build();

    let app_menu = Submenu::with_items(
        app,
        "lookdown",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About lookdown"), Some(about))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some("Hide lookdown"))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &item("quit", "Quit lookdown", "CmdOrCtrl+Q")?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("open", "Open…", "CmdOrCtrl+O")?,
            &item("save", "Save", "CmdOrCtrl+S")?,
            &item("close", "Close Tab", "CmdOrCtrl+W")?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item("undo", "Undo", "CmdOrCtrl+Z")?,
            &item("redo", "Redo", "CmdOrCtrl+Shift+Z")?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep()?,
            &item("next", "Next Tab", "Ctrl+Tab")?,
            &item("previous", "Previous Tab", "Ctrl+Shift+Tab")?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &window])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_map_to_events() {
        for id in ["open", "save", "close", "undo", "redo", "next", "previous"] {
            assert!(
                matches!(action_for(id), Some(MenuAction::Emit(c)) if c == id),
                "{id}"
            );
        }
    }

    #[test]
    fn quit_closes_the_window() {
        assert!(matches!(action_for("quit"), Some(MenuAction::Quit)));
    }

    #[test]
    fn unknown_ids_do_nothing() {
        assert!(action_for("about").is_none());
        assert!(action_for("").is_none());
    }
}
