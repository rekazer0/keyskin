#[cfg(target_os = "macos")]
#[path = "../src/window_controls.rs"]
mod window_controls;

#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::NSView;
    use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};
    let _ = window_controls::compact_traffic_lights;
    let main = MainThreadMarker::new().expect("AppKit uses the main thread");
    for index in 0..3 {
        let view = NSView::new(main);
        view.setFrame(NSRect::new(
            NSPoint::new(12.0 + index as f64 * 20.0, 8.0),
            NSSize::new(14.0, 14.0),
        ));
        for _ in 0..3 {
            window_controls::compact_button(&view, index);
            assert_eq!(view.frame().size, NSSize::new(10.0, 10.0));
            assert_eq!(view.bounds().size, NSSize::new(14.0, 14.0));
            assert_eq!(
                view.frame().origin,
                NSPoint::new(10.0 + index as f64 * 18.0, 10.0)
            );
            assert!(view.frame().origin.x + view.frame().size.width <= 64.0);
        }
    }
    println!(
        "macOS window buttons: 10pt, preserved drawing bounds, stable reapply, fit 64pt navigation"
    );
}

#[cfg(not(target_os = "macos"))]
fn main() {}
