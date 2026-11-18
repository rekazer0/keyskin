use std::cell::{Cell, RefCell};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
    NSDraggingSource, NSEventType, NSView, NSWorkspace,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSObject, NSObjectProtocol, NSPoint, NSRect, NSString, NSURL,
};

thread_local! {
    // AppKit does not retain the source: keep it alive through the end callback.
    static SOURCES: RefCell<Vec<Retained<ResourceDragSource>>> = const { RefCell::new(Vec::new()) };
}

#[derive(Debug)]
struct DragFiles {
    directory: PathBuf,
    cleanup: Cell<bool>,
}

impl Drop for DragFiles {
    fn drop(&mut self) {
        if self.cleanup.get() {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
}

define_class!(
    // SAFETY: NSObject has no subclass requirements; AppKit callbacks stay on the main thread.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = DragFiles]
    struct ResourceDragSource;

    unsafe impl NSObjectProtocol for ResourceDragSource {}

    unsafe impl NSDraggingSource for ResourceDragSource {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn operation(
            &self,
            _session: &NSDraggingSession,
            context: NSDraggingContext,
        ) -> NSDragOperation {
            if context == NSDraggingContext::OutsideApplication {
                NSDragOperation::Copy
            } else {
                NSDragOperation::None
            }
        }

        #[unsafe(method(draggingSession:endedAtPoint:operation:))]
        fn ended(&self, _session: &NSDraggingSession, _point: NSPoint, operation: NSDragOperation) {
            if operation != NSDragOperation::None {
                // Finder may finish reading the accepted URL after the drag session ends.
                let files = self.ivars();
                files.cleanup.set(false);
                let directory = files.directory.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    let _ = std::fs::remove_dir_all(directory);
                });
            }
            SOURCES.with(|sources| {
                sources
                    .borrow_mut()
                    .retain(|source| !std::ptr::eq(&**source, self))
            });
        }
    }
);

fn drag_file(name: &str, bytes: &[u8]) -> Result<(DragFiles, PathBuf), String> {
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || name.contains(['/', '\\', '\0'])
    {
        return Err("无效的资源文件名".into());
    }
    if bytes.len() > super::MAX_SOURCE_BYTES {
        return Err("资源文件过大，请使用下载按钮".into());
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let directory = std::env::temp_dir().join(format!(
        "keyskin-drag-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed),
    ));
    std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let files = DragFiles {
        directory,
        cleanup: Cell::new(true),
    };
    let path = files.directory.join(name);
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok((files, path))
}

#[tauri::command]
pub async fn start_resource_drag(
    window: tauri::WebviewWindow,
    name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let (files, path) = drag_file(&name, &bytes)?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let mtm = MainThreadMarker::new().ok_or("文件拖拽需要主线程")?;
                let event = NSApplication::sharedApplication(mtm)
                    .currentEvent()
                    .ok_or("拖拽事件已结束")?;
                if !matches!(
                    event.r#type(),
                    NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged
                ) {
                    return Err("拖拽事件已结束".into());
                }
                let pointer = target.ns_view().map_err(|error| error.to_string())?;
                // SAFETY: Tauri owns this view and the closure runs on AppKit's main thread.
                let view = unsafe { &*pointer.cast::<NSView>() };
                let path = NSString::from_str(&path.to_string_lossy());
                let url = NSURL::fileURLWithPath(&path);
                let item = NSDraggingItem::initWithPasteboardWriter(
                    NSDraggingItem::alloc(),
                    ProtocolObject::from_ref(&*url),
                );
                let icon = NSWorkspace::sharedWorkspace().iconForFile(&path);
                let point = view.convertPoint_fromView(event.locationInWindow(), None);
                // SAFETY: NSImage is a valid AppKit dragging image.
                unsafe {
                    item.setDraggingFrame_contents(NSRect::new(point, icon.size()), Some(&icon))
                };
                let source = ResourceDragSource::alloc(mtm).set_ivars(files);
                // SAFETY: NSObject's init returns an initialized instance of this class.
                let source: Retained<ResourceDragSource> =
                    unsafe { msg_send![super(source), init] };
                SOURCES.with(|sources| sources.borrow_mut().push(source.clone()));
                view.beginDraggingSessionWithItems_event_source(
                    &NSArray::from_retained_slice(&[item]),
                    &event,
                    ProtocolObject::from_ref(&*source),
                );
                Ok(())
            })();
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.recv().await.ok_or("文件拖拽任务已取消")?
}

#[cfg(test)]
mod tests {
    use super::drag_file;

    #[test]
    fn drag_files_are_isolated_and_cleaned_up() {
        for name in [
            "",
            ".",
            "..",
            "../outside.png",
            "/outside.png",
            "dir/file.png",
            "dir\\file.png",
        ] {
            assert!(drag_file(name, &[1]).is_err(), "{name}");
        }
        let (files, path) = drag_file("图片.png", &[1, 2, 3]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), [1, 2, 3]);
        drop(files);
        assert!(!path.exists());
    }
}
