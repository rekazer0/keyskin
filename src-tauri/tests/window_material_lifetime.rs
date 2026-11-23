#[cfg(target_os = "macos")]
#[path = "../src/window_material.rs"]
mod window_material;

#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::{
        NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState,
        NSVisualEffectView,
    };
    use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};

    let _ = window_material::set_material;
    let main = MainThreadMarker::new().expect("AppKit test runs on the main thread");
    let rect = |x, width, height| NSRect::new(NSPoint::new(x, 0.0), NSSize::new(width, height));
    let root = NSView::initWithFrame(main.alloc(), rect(0.0, 1440.0, 900.0));
    let content = NSView::new(main);
    root.addSubview(&content);
    let effects = || {
        root.subviews()
            .to_vec()
            .into_iter()
            .filter_map(|child| child.downcast::<NSVisualEffectView>().ok())
            .collect::<Vec<_>>()
    };

    window_material::sync_material(&root, Some(80));
    let layers = effects();
    assert_eq!(layers.len(), 2);
    let [body, sidebar] = layers.as_slice() else {
        unreachable!()
    };
    assert_eq!(sidebar.material(), NSVisualEffectMaterial::Sidebar);
    assert_eq!(body.material(), NSVisualEffectMaterial::HUDWindow);
    assert_eq!(sidebar.frame(), rect(0.0, 80.0, 900.0));
    assert_eq!(body.frame(), rect(80.0, 1360.0, 900.0));
    for effect in &layers {
        assert_eq!(
            effect.blendingMode(),
            NSVisualEffectBlendingMode::BehindWindow
        );
    }
    assert_eq!(sidebar.state(), NSVisualEffectState::Active);
    assert_eq!(body.state(), NSVisualEffectState::FollowsWindowActiveState);
    assert_eq!(
        &*root.subviews().to_vec()[2],
        &*content,
        "effects stay behind content"
    );
    for _ in 0..100 {
        window_material::sync_material(&root, Some(80));
        assert_eq!(
            effects(),
            layers,
            "reapplying does not stack or replace views"
        );
    }

    root.setFrame(rect(0.0, 1280.0, 720.0));
    assert_eq!(sidebar.frame(), rect(0.0, 80.0, 720.0));
    assert_eq!(body.frame(), rect(80.0, 1200.0, 720.0));
    window_material::sync_material(&root, Some(0));
    let compact = effects();
    assert_eq!(compact.len(), 1);
    assert_eq!(compact[0], *body);
    assert_eq!(
        body.frame(),
        root.bounds(),
        "compact layout has no sidebar material"
    );
    window_material::sync_material(&root, Some(80));
    assert_eq!(effects().len(), 2);
    window_material::sync_material(&root, None);
    assert_eq!(root.subviews().len(), 1);
    assert_eq!(&*root.subviews().to_vec()[0], &*content);
    println!("macOS material: sidebar and HUD geometry, autoresizing, repeated application and removal passed");
}

#[cfg(not(target_os = "macos"))]
fn main() {}
