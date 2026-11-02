#[cfg(target_os = "macos")]
#[path = "../src/window_material.rs"]
mod window_material;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{msg_send, rc::Retained, runtime::ClassBuilder, ClassType};
    use objc2_app_kit::NSView;
    use objc2_foundation::MainThreadMarker;

    let _ = window_material::set_material;
    let main = MainThreadMarker::new().expect("AppKit test runs on the main thread");
    let root = NSView::new(main);
    let content = NSView::new(main);
    root.addSubview(&content);
    let class = ClassBuilder::new(c"NSVisualEffectViewTagged", NSView::class())
        .expect("register test material class")
        .register();
    for _ in 0..50 {
        let layer: Retained<NSView> = unsafe { msg_send![class, new] };
        root.addSubview(&layer);
    }
    assert_eq!(root.subviews().len(), 51);
    for _ in 0..100 {
        assert!(window_material::retain_material(&root, true));
        assert_eq!(
            root.subviews().len(),
            2,
            "one material plus original content"
        );
    }
    assert!(!window_material::retain_material(&root, false));
    assert_eq!(
        root.subviews().len(),
        1,
        "disable removes every material layer"
    );
    assert_eq!(&*root.subviews().to_vec()[0], &*content);
    assert!(
        !window_material::retain_material(&root, true),
        "request a new layer when none exists"
    );
    println!("macOS material lifetime: 50 layers -> 1; 100 reapplies stable; disable -> 0; content preserved");
}

#[cfg(not(target_os = "macos"))]
fn main() {}
