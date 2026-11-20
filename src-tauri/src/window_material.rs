use objc2::MainThreadOnly;
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
    NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};

pub(crate) fn sync_material(view: &NSView, navigation_width: Option<u16>) {
    let bounds = view.bounds();
    let width = f64::from(navigation_width.unwrap_or(0)).min(bounds.size.width);
    // Keep the two behind-window regions disjoint; AppKit applies only one material per point.
    for (material, offset, width, resizes) in [
        (NSVisualEffectMaterial::Sidebar, 0.0, width, false),
        (
            NSVisualEffectMaterial::HUDWindow,
            width,
            bounds.size.width - width,
            true,
        ),
    ] {
        let existing = view.subviews().to_vec().into_iter().find_map(|child| {
            let effect = child.downcast::<NSVisualEffectView>().ok()?;
            (effect.material() == material).then_some(effect)
        });
        if navigation_width.is_none() || width <= 0.0 {
            if let Some(effect) = existing {
                effect.removeFromSuperview();
            }
            continue;
        }
        let frame = NSRect::new(
            NSPoint::new(bounds.origin.x + offset, bounds.origin.y),
            NSSize::new(width, bounds.size.height),
        );
        if let Some(effect) = existing {
            effect.setFrame(frame);
        } else {
            let effect = NSVisualEffectView::initWithFrame(view.mtm().alloc(), frame);
            effect.setMaterial(material);
            effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            effect.setState(if material == NSVisualEffectMaterial::Sidebar {
                NSVisualEffectState::Active
            } else {
                NSVisualEffectState::FollowsWindowActiveState
            });
            let mut mask = NSAutoresizingMaskOptions::ViewHeightSizable;
            if resizes {
                mask |= NSAutoresizingMaskOptions::ViewWidthSizable;
            }
            effect.setAutoresizingMask(mask);
            view.addSubview_positioned_relativeTo(&effect, NSWindowOrderingMode::Below, None);
        }
    }
}

pub async fn set_material(
    window: tauri::WebviewWindow,
    navigation_width: Option<u16>,
) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = target
                .ns_view()
                .map_err(|error| error.to_string())
                .map(|pointer| {
                    // SAFETY: Tauri owns this content view; all AppKit work runs on its main thread.
                    sync_material(unsafe { &*pointer.cast::<NSView>() }, navigation_width);
                });
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.recv().await.ok_or("窗口材质任务已取消")?
}
