use objc2::{msg_send, runtime::AnyObject};
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRect, NSSize};

pub(crate) fn compact_button(button: &NSView, index: usize) {
    let frame = button.frame();
    let bounds = button.bounds();
    button.setFrame(NSRect::new(
        NSPoint::new(
            10.0 + index as f64 * 18.0,
            frame.origin.y + (frame.size.height - 10.0) / 2.0,
        ),
        NSSize::new(10.0, 10.0),
    ));
    // 保留绘制坐标，将原生图案等比缩小，而非裁剪按钮。
    button.setBoundsSize(bounds.size);
}

pub(crate) fn compact_traffic_lights(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: Tauri owns the window and its standard buttons; AppKit runs on the main thread.
        unsafe {
            let native = &*pointer.cast::<AnyObject>();
            for index in 0..3usize {
                let button: *mut NSView = msg_send![native, standardWindowButton: index];
                if let Some(button) = button.as_ref() {
                    compact_button(button, index);
                }
            }
        }
    })
}
