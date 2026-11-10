//! The real system icon of any file, folder or app, as PNG bytes.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

fn cache() -> &'static Mutex<HashMap<String, Option<Arc<Vec<u8>>>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<Arc<Vec<u8>>>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Plain documents of the same type share an icon; apps and folders have their own.
fn cache_key(path: &Path, size: u32) -> String {
    let own_icon = path.is_dir()
        || path
            .extension()
            .map(|e| {
                let e = e.to_string_lossy().to_ascii_lowercase();
                matches!(e.as_str(), "exe" | "ico" | "lnk" | "app" | "icns")
            })
            .unwrap_or(true);
    if own_icon {
        format!("{size}|{}", path.to_string_lossy())
    } else {
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        format!("{size}|*.{ext}")
    }
}

/// PNG of the icon the OS shows for `path`, about `size` pixels wide.
pub fn icon_png(path: &Path, size: u32) -> Option<Arc<Vec<u8>>> {
    let size = size.clamp(16, 512);
    let key = cache_key(path, size);
    if let Some(hit) = cache().lock().unwrap().get(&key) {
        return hit.clone();
    }
    let png = render(path, size).map(Arc::new);
    let mut cache = cache().lock().unwrap();
    if cache.len() > 4000 {
        cache.clear();
    }
    cache.insert(key, png.clone());
    png
}

#[cfg(target_os = "macos")]
fn render(path: &Path, size: u32) -> Option<Vec<u8>> {
    use objc2::rc::autoreleasepool;
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    autoreleasepool(|_| {
        let ws = NSWorkspace::sharedWorkspace();
        let image = if path.symlink_metadata().is_ok() {
            ws.iconForFile(&NSString::from_str(&path.to_string_lossy()))
        } else {
            // The file is gone (or this is sample data): fall back to the
            // generic icon of its type, or a plain folder.
            let file_type = match path.extension() {
                Some(ext) => ext.to_string_lossy().into_owned(),
                None => "public.folder".to_string(),
            };
            #[allow(deprecated)]
            ws.iconForFileType(&NSString::from_str(&file_type))
        };
        let side = size as f64;
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(side, side));
        // Picks the representation that fits `rect` best (icons carry many sizes).
        let cg = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
        let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
        let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        Some(data.to_vec())
    })
}

#[cfg(windows)]
fn render(path: &Path, size: u32) -> Option<Vec<u8>> {
    use std::ffi::c_void;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
        DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_ICONONLY};

    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> Option<Vec<u8>> {
            let factory: IShellItemImageFactory =
                SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None).ok()?;
            let hbmp = factory
                .GetImage(
                    SIZE {
                        cx: size as i32,
                        cy: size as i32,
                    },
                    SIIGBF_ICONONLY,
                )
                .ok()?;

            let mut bm = BITMAP::default();
            let got = GetObjectW(
                hbmp.into(),
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut bm as *mut BITMAP as *mut c_void),
            );
            if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
                let _ = DeleteObject(hbmp.into());
                return None;
            }
            let (w, h) = (bm.bmWidth, bm.bmHeight);
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: 0, // BI_RGB
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bgra = vec![0u8; (w as usize) * (h as usize) * 4];
            let dc = CreateCompatibleDC(None);
            let lines = GetDIBits(
                dc,
                hbmp,
                0,
                h as u32,
                Some(bgra.as_mut_ptr() as *mut c_void),
                &mut info,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(dc);
            let _ = DeleteObject(hbmp.into());
            if lines == 0 {
                return None;
            }

            // The shell hands out premultiplied BGRA. PNG wants straight RGBA.
            let has_alpha = bgra.chunks_exact(4).any(|px| px[3] != 0);
            let mut rgba = Vec::with_capacity(bgra.len());
            for px in bgra.chunks_exact(4) {
                let (b, g, r, a) = (px[0] as u32, px[1] as u32, px[2] as u32, px[3] as u32);
                if !has_alpha {
                    rgba.extend_from_slice(&[r as u8, g as u8, b as u8, 255]);
                } else if a == 0 {
                    rgba.extend_from_slice(&[0, 0, 0, 0]);
                } else {
                    let un = |c: u32| ((c * 255 + a / 2) / a).min(255) as u8;
                    rgba.extend_from_slice(&[un(r), un(g), un(b), a as u8]);
                }
            }

            let mut out = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut out, w as u32, h as u32);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                let mut writer = encoder.write_header().ok()?;
                writer.write_image_data(&rgba).ok()?;
            }
            Some(out)
        })();
        if com.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn render(_path: &Path, _size: u32) -> Option<Vec<u8>> {
    None
}
