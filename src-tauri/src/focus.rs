//! Do Not Disturb: whether something is running full screen, usually a game.

use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId};

/// The desktop itself fills the screen too, but nobody is playing it.
const SHELL_CLASSES: [&str; 3] = ["Progman", "WorkerW", "Shell_TrayWnd"];

/// Whether a window covers its whole screen, taskbar included.
fn covers(window: RECT, monitor: RECT) -> bool {
    window.left <= monitor.left && window.top <= monitor.top && window.right >= monitor.right && window.bottom >= monitor.bottom
}

/// Windows' own answer catches exclusive full screen. Borderless games only show
/// up by comparing the foreground window with its screen.
pub fn game_running() -> bool {
    // SAFETY: plain queries with no pointers kept; bad handles just return errors.
    unsafe {
        if let Ok(state) = SHQueryUserNotificationState() {
            if state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_BUSY || state == QUNS_PRESENTATION_MODE {
                return true;
            }
        }
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return false;
        }
        let mut class = [0u16; 64];
        let len = GetClassNameW(hwnd, &mut class) as usize;
        let name = String::from_utf16_lossy(&class[..len.min(class.len())]);
        if SHELL_CLASSES.contains(&name.as_str()) {
            return false;
        }
        let mut window = RECT::default();
        if GetWindowRect(hwnd, &mut window).is_err() {
            return false;
        }
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info).as_bool() {
            return false;
        }
        covers(window, info.rcMonitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT { left, top, right, bottom }
    }

    #[test]
    fn only_a_window_covering_the_whole_screen_counts() {
        let screen = r(0, 0, 1920, 1080);
        assert!(covers(r(0, 0, 1920, 1080), screen));
        assert!(covers(r(-8, -8, 1928, 1088), screen), "borders hanging over the edge");
        assert!(!covers(r(0, 0, 1920, 1040), screen), "a maximized window leaves the taskbar");
        assert!(!covers(r(100, 100, 900, 700), screen));
    }

    #[test]
    fn the_check_runs_without_failing() {
        let _ = game_running();
    }
}
