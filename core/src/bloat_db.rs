//! What the Bloat Scanner recognises by name.
//!
//! Short and conservative on purpose: only software that is widely reported
//! as unwanted (adware, fake "optimizers"), or that typically arrives without
//! being asked for (trial security suites, promotional store apps). Whether
//! something goes is always the user's decision; Roomy only points at it.

/// Why an entry is on the list.
/// "adware": changes the browser, shows ads. "pup": potentially unwanted
/// program, typically a fake cleaner or driver updater. "bundled": came with
/// the computer or with another installer. "promo": a preinstalled
/// advertisement for a service.
pub struct Known {
    /// Lower-case text that has to occur in the name, identifier or publisher.
    pub pattern: &'static str,
    pub reason: &'static str,
}

const fn k(pattern: &'static str, reason: &'static str) -> Known {
    Known { pattern, reason }
}

/// macOS apps, launch items and processes.
pub const MAC: &[Known] = &[
    k("mackeeper", "pup"),
    k("advanced mac cleaner", "pup"),
    k("advancedmaccleaner", "pup"),
    k("mac auto fixer", "pup"),
    k("mac tonic", "pup"),
    k("mac mechanic", "pup"),
    k("smart mac booster", "pup"),
    k("mac cleanup pro", "pup"),
    k("easy mac care", "pup"),
    k("mac optimizer pro", "pup"),
    k("mac speedup pro", "pup"),
    k("mac space reviver", "pup"),
    k("mac adware cleaner", "pup"),
    k("similar photo cleaner", "pup"),
    k("macbooster", "pup"),
    k("genieo", "adware"),
    k("installmac", "adware"),
    k("vsearch", "adware"),
    k("searchmine", "adware"),
    k("search marquis", "adware"),
    k("searchmarquis", "adware"),
    k("searchbaron", "adware"),
    k("safefinder", "adware"),
    k("chill tab", "adware"),
    k("chilltab", "adware"),
    k("weknow", "adware"),
    k("mybrowserhelper", "adware"),
    k("pirrit", "adware"),
    k("bundlore", "adware"),
    k("crossrider", "adware"),
    k("shopper helper", "adware"),
    k("mughthesec", "adware"),
    k("tapufind", "adware"),
    k("any search manager", "adware"),
    k("anysearchmanager", "adware"),
    k("smartsignalsearch", "adware"),
    k("spigot", "adware"),
    k("trovi", "adware"),
];

/// Windows programs from "Apps & features" (display name or publisher).
pub const WINDOWS: &[Known] = &[
    k("mcafee", "bundled"),
    k("norton security scan", "bundled"),
    k("wildtangent", "bundled"),
    k("booking.com", "promo"),
    k("dropbox promotion", "promo"),
    k("amazon assistant", "adware"),
    k("ask toolbar", "adware"),
    k("bing bar", "adware"),
    k("yahoo! toolbar", "adware"),
    k("babylon toolbar", "adware"),
    k("webdiscover", "adware"),
    k("web companion", "adware"),
    k("conduit", "adware"),
    k("segurazo", "pup"),
    k("bytefence", "pup"),
    k("onesafe pc cleaner", "pup"),
    k("mycleanpc", "pup"),
    k("pc accelerate", "pup"),
    k("pc optimizer pro", "pup"),
    k("advanced systemcare", "pup"),
    k("driver booster", "pup"),
    k("driverpack", "pup"),
    k("driver updater", "pup"),
    k("reimage repair", "pup"),
    k("restoro", "pup"),
    k("slimcleaner", "pup"),
];

/// Windows Store packages (package name starts with the pattern,
/// compared in lower case), with the name people know them by.
pub const PACKAGES: &[(&str, &str, &str)] = &[
    ("king.com.candycrush", "Candy Crush", "promo"),
    ("king.com.", "King game", "promo"),
    ("microsoft.bingnews", "Microsoft News", "bundled"),
    ("microsoft.microsoftsolitairecollection", "Solitaire Collection", "bundled"),
    ("clipchamp.clipchamp", "Clipchamp", "bundled"),
    ("disney.", "Disney+", "promo"),
    ("spotifyab.spotifymusic", "Spotify", "promo"),
    ("bytedancepte.ltd.tiktok", "TikTok", "promo"),
    ("facebook.", "Facebook / Instagram", "promo"),
    ("amazonvideo.primevideo", "Prime Video", "promo"),
    ("4df9e0f8.netflix", "Netflix", "promo"),
    ("microsoft.gethelp", "Get Help", "bundled"),
    ("microsoft.getstarted", "Tips", "bundled"),
    ("microsoft.microsoftofficehub", "Microsoft 365 (Office hub)", "bundled"),
    ("microsoft.people", "People", "bundled"),
    ("microsoft.windowsfeedbackhub", "Feedback Hub", "bundled"),
    ("microsoft.mixedreality.portal", "Mixed Reality Portal", "bundled"),
    ("microsoft.microsoft3dviewer", "3D Viewer", "bundled"),
    ("microsoft.skypeapp", "Skype", "bundled"),
    ("microsoft.549981c3f5f10", "Cortana", "bundled"),
    ("microsoftteams", "Microsoft Teams (personal)", "bundled"),
    ("microsoft.powerautomatedesktop", "Power Automate", "bundled"),
    ("7ee7776c.linkedinforwindows", "LinkedIn", "promo"),
    ("mcafee", "McAfee", "bundled"),
];

/// The entry whose pattern occurs in any of `texts`.
pub fn find(list: &'static [Known], texts: &[&str]) -> Option<&'static Known> {
    let hay: Vec<String> = texts.iter().map(|t| t.to_lowercase()).collect();
    list.iter().find(|k| hay.iter().any(|h| h.contains(k.pattern)))
}

/// (display name, reason) for a Windows Store package name.
pub fn find_package(name: &str) -> Option<(&'static str, &'static str)> {
    let lower = name.to_lowercase();
    PACKAGES
        .iter()
        .find(|(prefix, _, _)| lower.starts_with(prefix))
        .map(|(_, display, reason)| (*display, *reason))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_known_names_only() {
        assert_eq!(find(MAC, &["MacKeeper", "com.mackeeper.MacKeeper"]).map(|k| k.reason), Some("pup"));
        assert_eq!(find(MAC, &["Search Marquis Helper"]).map(|k| k.reason), Some("adware"));
        assert!(find(MAC, &["Xcode", "com.apple.dt.Xcode"]).is_none());
        assert!(find(MAC, &["CleanMyMac", "com.macpaw.CleanMyMac5"]).is_none());
        assert_eq!(find(WINDOWS, &["McAfee LiveSafe", "McAfee, LLC"]).map(|k| k.reason), Some("bundled"));
        assert!(find(WINDOWS, &["Mozilla Firefox", "Mozilla"]).is_none());
        assert_eq!(find_package("king.com.CandyCrushSaga"), Some(("Candy Crush", "promo")));
        assert_eq!(find_package("Microsoft.BingNews"), Some(("Microsoft News", "bundled")));
        assert!(find_package("Microsoft.WindowsCalculator").is_none());
    }
}
