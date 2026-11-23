//! macOS: quitting from the Dock or at logout asks the app first
//! (`applicationShouldTerminate:`). Tauri's app delegate lacks that method, so
//! it is added at startup. With unsaved tabs the answer is "not now" and the
//! window gets a close request, which runs the unsaved-changes prompt; with
//! none, lookdown quits right away (so logout is not interrupted).

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether some tab is unsaved, as last reported by the frontend.
#[derive(Default)]
pub struct Unsaved(AtomicBool);

impl Unsaved {
    pub fn get(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
    pub fn set(&self, unsaved: bool) {
        self.0.store(unsaved, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn set_unsaved(state: tauri::State<'_, Unsaved>, unsaved: bool) {
    state.set(unsaved);
}

/// `NSApplicationTerminateReply` values.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const TERMINATE_CANCEL: usize = 0;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const TERMINATE_NOW: usize = 1;

/// Wait (and ask) only when an open window has unsaved tabs.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn terminate_reply(window_open: bool, unsaved: bool) -> usize {
    if window_open && unsaved {
        TERMINATE_CANCEL
    } else {
        TERMINATE_NOW
    }
}

#[cfg(target_os = "macos")]
pub use mac::install;

#[cfg(target_os = "macos")]
mod mac {
    use super::{TERMINATE_CANCEL, TERMINATE_NOW, Unsaved, terminate_reply};
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{ffi, sel};
    use std::ffi::CStr;
    use std::sync::OnceLock;
    use tauri::Manager;

    /// tao's `NSApplicationDelegate` class (tao 0.37, `app_delegate.rs`).
    pub const DELEGATE_CLASS: &CStr = c"TaoAppDelegateParent";

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    extern "C-unwind" fn should_terminate(
        _this: *mut AnyObject,
        _cmd: Sel,
        _sender: *mut AnyObject,
    ) -> usize {
        let Some(app) = APP.get() else {
            return TERMINATE_NOW;
        };
        let open = app.get_webview_window("main").is_some();
        let reply = terminate_reply(open, app.state::<Unsaved>().get());
        if reply == TERMINATE_CANCEL {
            // Safe inside AppKit's terminate: `close` only posts a message to
            // the event loop; the prompt runs after this returns.
            crate::menu::close_main(app);
        }
        reply
    }

    /// Adds `applicationShouldTerminate:` to the delegate class; false when the
    /// class is missing or already has the method (a tao change to look at).
    pub fn install_hook() -> bool {
        let Some(class) = AnyClass::get(DELEGATE_CLASS) else {
            return false;
        };
        type Handler = extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize;
        // SAFETY: the type encoding below ("Q@:@": NSUInteger, self, _cmd,
        // id) matches `Handler`; objc_msgSend calls it with that signature.
        let imp: Imp = unsafe { std::mem::transmute::<Handler, Imp>(should_terminate) };
        unsafe {
            ffi::class_addMethod(
                class as *const AnyClass as *mut AnyClass,
                sel!(applicationShouldTerminate:),
                imp,
                c"Q@:@".as_ptr(),
            )
            .as_bool()
        }
    }

    pub fn install(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        let added = install_hook();
        debug_assert!(
            added,
            "could not add applicationShouldTerminate: to {DELEGATE_CLASS:?}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_waits_only_for_unsaved_tabs_in_an_open_window() {
        assert_eq!(terminate_reply(true, true), TERMINATE_CANCEL);
        assert_eq!(terminate_reply(true, false), TERMINATE_NOW);
        assert_eq!(terminate_reply(false, true), TERMINATE_NOW);
        assert_eq!(terminate_reply(false, false), TERMINATE_NOW);
    }

    #[test]
    fn unsaved_flag_starts_clear_and_follows_the_frontend() {
        let flag = Unsaved::default();
        assert!(!flag.get());
        flag.set(true);
        assert!(flag.get());
        flag.set(false);
        assert!(!flag.get());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hook_is_added_to_the_delegate_class() {
        use super::mac::{DELEGATE_CLASS, install_hook};
        use objc2::runtime::{AnyClass, ClassBuilder, NSObject};
        use objc2::{ClassType, sel};
        // Stand-in for tao's delegate class, which is not registered in tests.
        if AnyClass::get(DELEGATE_CLASS).is_none() {
            ClassBuilder::new(DELEGATE_CLASS, NSObject::class())
                .unwrap()
                .register();
        }
        assert!(install_hook());
        let class = AnyClass::get(DELEGATE_CLASS).unwrap();
        assert!(
            class
                .instance_method(sel!(applicationShouldTerminate:))
                .is_some()
        );
    }
}
