// All user-facing text, in English and German. German uses the informal "du"
// and Swiss spelling ("ss" instead of "ß").

const en = {
  "nav.overview": "Overview",
  "nav.apps": "Apps",
  "nav.files": "Large Files",
  "nav.folders": "Folders",
  "nav.cleanup": "Cleanup",

  "disk.free": "{size} free",
  "disk.freeWord": "free",
  "disk.usedOf": "{used} of {total} used",
  "disk.freeOf": "{free} free of {total}",
  "disk.rescan": "Scan again",

  "scan.title": "Looking through your disk…",
  "scan.found": "{size} found so far",
  "scan.files": "{count} files",
  "scan.waiting": "This list appears as soon as the scan is done.",
  "scan.scanning": "Scanning…",

  "cat.apps": "Apps",
  "cat.documents": "Documents",
  "cat.downloads": "Downloads",
  "cat.media": "Photos, music & video",
  "cat.developer": "Developer",
  "cat.appData": "App data",
  "cat.otherHome": "Other files",
  "cat.otherUsers": "Other users",
  "cat.system": "System",
  "cat.free": "Free",

  "overview.quick": "Where to start",
  "overview.cleanup.title": "Cleanup",
  "overview.cleanup.hint": "Caches, logs and leftovers nobody misses",
  "overview.files.title": "Large files",
  "overview.files.hint": "{count} files over 100 MB",
  "overview.apps.title": "Unused apps",
  "overview.apps.hint": "{count} apps not opened in 6 months",
  "overview.apps.hintAll": "{count} apps installed",
  "overview.downloads.title": "Downloads",
  "overview.downloads.hint": "Usually full of things you needed once",
  "overview.folders": "Biggest folders",
  "overview.foldersHint": "in your home folder",
  "overview.scanned": "{count} files scanned in {seconds} s",
  "overview.fda.title": "Roomy can't see everything yet",
  "overview.fda.body": "macOS hides Mail, Messages and the Trash from apps. Allow Full Disk Access to include them.",
  "overview.fda.button": "Open Settings",
  "overview.demo": "Sample data",

  "apps.subtitle": "{count} apps · {size}",
  "apps.search": "Search apps",
  "apps.sort.size": "Size",
  "apps.sort.used": "Last used",
  "apps.sort.installed": "Installed",
  "apps.sort.name": "Name",
  "apps.version": "Version {version}",
  "apps.lastUsed": "Opened {when}",
  "apps.neverUsed": "Never opened",
  "apps.installed": "Installed {when}",
  "apps.running": "Running",
  "apps.runningHint": "Quit the app before removing it",
  "apps.uninstall": "Uninstall",
  "apps.uninstallStarted": "The uninstaller of {name} is open",
  "apps.empty": "No apps found",

  "files.subtitle": "{count} files · {size}",
  "files.kind.all": "All",
  "files.kind.video": "Video",
  "files.kind.image": "Images",
  "files.kind.audio": "Audio",
  "files.kind.archive": "Archives",
  "files.kind.diskimage": "Disk images & installers",
  "files.kind.document": "Documents",
  "files.kind.other": "Other",
  "files.min": "At least",
  "files.appData": "Include app data",
  "files.appDataHint": "Files that apps keep in the Library. Only delete what you recognise.",
  "files.empty": "No files this large",
  "files.more": "Show more",

  "folders.home": "Home",
  "folders.disk": "Whole disk",
  "folders.items": "{count} items",
  "folders.files": "{count} files",
  "folders.empty": "This folder is empty",
  "folders.protected": "Needed by the system",
  "folders.denied": "No access",
  "folders.showAll": "Show all {count}",
  "folders.back": "Back",

  "cleanup.subtitle": "Things you can remove without missing them.",
  "cleanup.total": "{size} to clean up",
  "cleanup.selectSafe": "Select everything safe",
  "cleanup.safe": "Safe",
  "cleanup.review": "Check first",
  "cleanup.items": "{count} items",
  "cleanup.empty.title": "Nothing to clean up",
  "cleanup.empty.body": "No caches, leftovers or old installers worth mentioning.",
  "cleanup.trash.title": "Trash",
  "cleanup.trash.titleWin": "Recycle Bin",
  "cleanup.trash.desc": "Deleted files that still take up space",
  "cleanup.trash.unknown": "Size unknown without Full Disk Access",
  "cleanup.trash.empty": "Empty",
  "cleanup.caches.title": "App caches",
  "cleanup.caches.desc": "Temporary data. Apps rebuild it when they need it",
  "cleanup.logs.title": "Logs & crash reports",
  "cleanup.logs.desc": "Diagnostic files apps wrote in the background",
  "cleanup.temp.title": "Temporary files",
  "cleanup.temp.desc": "Leftovers from installers and apps",
  "cleanup.developer.title": "Developer leftovers",
  "cleanup.developer.desc": "Build output and package caches. Recreated on the next build",
  "cleanup.installers.title": "Installers",
  "cleanup.installers.desc": "Disk images and setup files you probably used already",
  "cleanup.oldDownloads.title": "Old downloads",
  "cleanup.oldDownloads.desc": "In Downloads for more than 3 months",
  "cleanup.backups.title": "iPhone & iPad backups",
  "cleanup.backups.desc": "Local device backups. Keep the ones you still need",

  "sel.count.one": "1 item selected",
  "sel.count.other": "{count} items selected",
  "sel.clear": "Deselect",
  "sel.delete": "Delete…",

  "confirm.title.one": "Delete 1 item?",
  "confirm.title.other": "Delete {count} items?",
  "confirm.toTrash": "{size} will be moved to the Trash.",
  "confirm.toBin": "{size} will be moved to the Recycle Bin.",
  "confirm.forGood": "{size} will be deleted for good.",
  "confirm.mixed": "{trash} go to the Trash, {permanent} are deleted for good.",
  "confirm.mixedBin": "{trash} go to the Recycle Bin, {permanent} are deleted for good.",
  "confirm.skipTrash": "Delete immediately",
  "confirm.skipTrashHint": "Frees the space right away. Can't be undone.",
  "confirm.related": "Also remove app data",
  "confirm.relatedHint": "{count} items · {size}",
  "confirm.cancel": "Cancel",
  "confirm.trash": "Move to Trash",
  "confirm.bin": "Move to Recycle Bin",
  "confirm.delete": "Delete",
  "confirm.working": "Deleting {done} of {total}…",
  "confirm.permanentTag": "for good",

  "toast.trashed": "{size} moved to the Trash",
  "toast.binned": "{size} moved to the Recycle Bin",
  "toast.freed": "{size} freed",
  "toast.emptyTrash": "Empty Trash",
  "toast.emptyBin": "Empty Recycle Bin",
  "toast.trashEmptied": "Trash emptied",
  "toast.binEmptied": "Recycle Bin emptied",
  "toast.failed.one": "1 item could not be deleted",
  "toast.failed.other": "{count} items could not be deleted",
  "toast.skipped": "Some files are in use and were kept",
  "toast.error": "Something went wrong: {error}",

  "action.reveal.mac": "Show in Finder",
  "action.reveal.win": "Show in Explorer",
  "action.dismiss": "Dismiss",

  "time.never": "never",
  "time.today": "today",
};

type Key = keyof typeof en;

const de: Record<Key, string> = {
  "nav.overview": "Übersicht",
  "nav.apps": "Apps",
  "nav.files": "Grosse Dateien",
  "nav.folders": "Ordner",
  "nav.cleanup": "Aufräumen",

  "disk.free": "{size} frei",
  "disk.freeWord": "frei",
  "disk.usedOf": "{used} von {total} belegt",
  "disk.freeOf": "{free} frei von {total}",
  "disk.rescan": "Neu scannen",

  "scan.title": "Deine Festplatte wird durchsucht…",
  "scan.found": "Bisher {size} gefunden",
  "scan.files": "{count} Dateien",
  "scan.waiting": "Die Liste erscheint, sobald der Scan fertig ist.",
  "scan.scanning": "Scan läuft…",

  "cat.apps": "Apps",
  "cat.documents": "Dokumente",
  "cat.downloads": "Downloads",
  "cat.media": "Fotos, Musik & Videos",
  "cat.developer": "Entwicklung",
  "cat.appData": "App-Daten",
  "cat.otherHome": "Andere Dateien",
  "cat.otherUsers": "Andere Benutzer",
  "cat.system": "System",
  "cat.free": "Frei",

  "overview.quick": "Hier anfangen",
  "overview.cleanup.title": "Aufräumen",
  "overview.cleanup.hint": "Caches, Logs und Reste, die niemand vermisst",
  "overview.files.title": "Grosse Dateien",
  "overview.files.hint": "{count} Dateien über 100 MB",
  "overview.apps.title": "Ungenutzte Apps",
  "overview.apps.hint": "{count} Apps seit 6 Monaten nicht geöffnet",
  "overview.apps.hintAll": "{count} Apps installiert",
  "overview.downloads.title": "Downloads",
  "overview.downloads.hint": "Meist voll mit Dingen, die du einmal gebraucht hast",
  "overview.folders": "Grösste Ordner",
  "overview.foldersHint": "in deinem Benutzerordner",
  "overview.scanned": "{count} Dateien in {seconds} s gescannt",
  "overview.fda.title": "Roomy sieht noch nicht alles",
  "overview.fda.body": "macOS versteckt Mail, Nachrichten und den Papierkorb vor Apps. Erlaube Festplattenvollzugriff, um sie einzubeziehen.",
  "overview.fda.button": "Einstellungen öffnen",
  "overview.demo": "Beispieldaten",

  "apps.subtitle": "{count} Apps · {size}",
  "apps.search": "Apps durchsuchen",
  "apps.sort.size": "Grösse",
  "apps.sort.used": "Zuletzt benutzt",
  "apps.sort.installed": "Installiert",
  "apps.sort.name": "Name",
  "apps.version": "Version {version}",
  "apps.lastUsed": "Geöffnet {when}",
  "apps.neverUsed": "Nie geöffnet",
  "apps.installed": "Installiert {when}",
  "apps.running": "Läuft",
  "apps.runningHint": "Beende die App, bevor du sie entfernst",
  "apps.uninstall": "Deinstallieren",
  "apps.uninstallStarted": "Das Deinstallationsprogramm von {name} ist geöffnet",
  "apps.empty": "Keine Apps gefunden",

  "files.subtitle": "{count} Dateien · {size}",
  "files.kind.all": "Alle",
  "files.kind.video": "Videos",
  "files.kind.image": "Bilder",
  "files.kind.audio": "Audio",
  "files.kind.archive": "Archive",
  "files.kind.diskimage": "Images & Installer",
  "files.kind.document": "Dokumente",
  "files.kind.other": "Andere",
  "files.min": "Mindestens",
  "files.appData": "App-Daten einbeziehen",
  "files.appDataHint": "Dateien, die Apps in der Library ablegen. Lösche nur, was du kennst.",
  "files.empty": "Keine so grossen Dateien",
  "files.more": "Mehr anzeigen",

  "folders.home": "Benutzerordner",
  "folders.disk": "Ganze Festplatte",
  "folders.items": "{count} Objekte",
  "folders.files": "{count} Dateien",
  "folders.empty": "Dieser Ordner ist leer",
  "folders.protected": "Vom System benötigt",
  "folders.denied": "Kein Zugriff",
  "folders.showAll": "Alle {count} anzeigen",
  "folders.back": "Zurück",

  "cleanup.subtitle": "Dinge, die du entfernen kannst, ohne sie zu vermissen.",
  "cleanup.total": "{size} zum Aufräumen",
  "cleanup.selectSafe": "Alles Sichere auswählen",
  "cleanup.safe": "Sicher",
  "cleanup.review": "Erst prüfen",
  "cleanup.items": "{count} Objekte",
  "cleanup.empty.title": "Nichts aufzuräumen",
  "cleanup.empty.body": "Keine nennenswerten Caches, Reste oder alten Installer.",
  "cleanup.trash.title": "Papierkorb",
  "cleanup.trash.titleWin": "Papierkorb",
  "cleanup.trash.desc": "Gelöschte Dateien, die noch Platz belegen",
  "cleanup.trash.unknown": "Grösse ohne Festplattenvollzugriff unbekannt",
  "cleanup.trash.empty": "Leeren",
  "cleanup.caches.title": "App-Caches",
  "cleanup.caches.desc": "Temporäre Daten. Apps legen sie bei Bedarf neu an",
  "cleanup.logs.title": "Logs & Absturzberichte",
  "cleanup.logs.desc": "Diagnosedateien, die Apps im Hintergrund geschrieben haben",
  "cleanup.temp.title": "Temporäre Dateien",
  "cleanup.temp.desc": "Überbleibsel von Installern und Apps",
  "cleanup.developer.title": "Entwickler-Reste",
  "cleanup.developer.desc": "Build-Ausgaben und Paket-Caches. Entstehen beim nächsten Build neu",
  "cleanup.installers.title": "Installer",
  "cleanup.installers.desc": "Disk-Images und Setup-Dateien, die du vermutlich schon benutzt hast",
  "cleanup.oldDownloads.title": "Alte Downloads",
  "cleanup.oldDownloads.desc": "Seit über 3 Monaten in Downloads",
  "cleanup.backups.title": "iPhone- & iPad-Backups",
  "cleanup.backups.desc": "Lokale Geräte-Backups. Behalte, was du noch brauchst",

  "sel.count.one": "1 Objekt ausgewählt",
  "sel.count.other": "{count} Objekte ausgewählt",
  "sel.clear": "Abwählen",
  "sel.delete": "Löschen…",

  "confirm.title.one": "1 Objekt löschen?",
  "confirm.title.other": "{count} Objekte löschen?",
  "confirm.toTrash": "{size} werden in den Papierkorb gelegt.",
  "confirm.toBin": "{size} werden in den Papierkorb gelegt.",
  "confirm.forGood": "{size} werden endgültig gelöscht.",
  "confirm.mixed": "{trash} kommen in den Papierkorb, {permanent} werden endgültig gelöscht.",
  "confirm.mixedBin": "{trash} kommen in den Papierkorb, {permanent} werden endgültig gelöscht.",
  "confirm.skipTrash": "Sofort löschen",
  "confirm.skipTrashHint": "Gibt den Platz sofort frei. Lässt sich nicht rückgängig machen.",
  "confirm.related": "Auch die App-Daten entfernen",
  "confirm.relatedHint": "{count} Objekte · {size}",
  "confirm.cancel": "Abbrechen",
  "confirm.trash": "In den Papierkorb",
  "confirm.bin": "In den Papierkorb",
  "confirm.delete": "Löschen",
  "confirm.working": "Lösche {done} von {total}…",
  "confirm.permanentTag": "endgültig",

  "toast.trashed": "{size} in den Papierkorb gelegt",
  "toast.binned": "{size} in den Papierkorb gelegt",
  "toast.freed": "{size} freigegeben",
  "toast.emptyTrash": "Papierkorb leeren",
  "toast.emptyBin": "Papierkorb leeren",
  "toast.trashEmptied": "Papierkorb geleert",
  "toast.binEmptied": "Papierkorb geleert",
  "toast.failed.one": "1 Objekt konnte nicht gelöscht werden",
  "toast.failed.other": "{count} Objekte konnten nicht gelöscht werden",
  "toast.skipped": "Einige Dateien sind in Benutzung und wurden behalten",
  "toast.error": "Etwas ist schiefgelaufen: {error}",

  "action.reveal.mac": "Im Finder zeigen",
  "action.reveal.win": "Im Explorer zeigen",
  "action.dismiss": "Schliessen",

  "time.never": "nie",
  "time.today": "heute",
};

export type Lang = "en" | "de";
const tables: Record<Lang, Record<Key, string>> = { en, de };

let lang: Lang = "en";
let locale = "en-US";

export function setLocale(systemLocale: string) {
  const override = new URLSearchParams(window.location.search).get("lang");
  const tag = override || systemLocale || "en";
  lang = tag.toLowerCase().startsWith("de") ? "de" : "en";
  // Keep the user's region for number formats (e.g. de-CH), default otherwise.
  locale = tag.toLowerCase().startsWith(lang) && tag.length >= 2 ? tag.replace("_", "-") : lang === "de" ? "de-CH" : "en-US";
  try {
    new Intl.NumberFormat(locale);
  } catch {
    locale = lang === "de" ? "de-CH" : "en-US";
  }
  document.documentElement.lang = lang;
}

export const getLocale = () => locale;
export const getLang = () => lang;

export function t(key: Key, vars?: Record<string, string | number>): string {
  let text = tables[lang][key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** Picks the `.one` / `.other` variant of a key. */
export function tn(base: string, count: number, vars?: Record<string, string | number>): string {
  const key = `${base}.${count === 1 ? "one" : "other"}` as Key;
  return t(key, { count: formatCount(count), ...vars });
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(locale).format(n);
}
