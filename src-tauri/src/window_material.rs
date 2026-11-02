use objc2_app_kit::NSView;
use tauri::window::{Effect, EffectsBuilder};

// Tauri 2.11/window-vibrancy 0.6 appends this view on every set_effects call;
// set_effects(None) does not clear it on macOS. Keep one, or remove all when disabled.
pub(crate) fn retain_material(view: &NSView, enabled: bool) -> bool {
    let mut retained = false;
    for child in view.subviews().to_vec() {
        if child.class().name().to_bytes() != b"NSVisualEffectViewTagged" {
            continue;
        }
        if enabled && !retained {
            retained = true;
        } else {
            child.removeFromSuperview();
        }
    }
    retained
}

pub async fn set_material(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let pointer = target.ns_view().map_err(|error| error.to_string())?;
                // SAFETY: Tauri owns this content view; all AppKit work runs on its main thread.
                let view = unsafe { &*pointer.cast::<NSView>() };
                if !retain_material(view, enabled) && enabled {
                    target
                        .set_effects(EffectsBuilder::new().effect(Effect::Sidebar).build())
                        .map_err(|error| error.to_string())?;
                }
                Ok(())
            })();
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.recv().await.ok_or("窗口材质任务已取消")?
}
