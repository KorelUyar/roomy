// Sample data: a made-up computer that behaves like the real backend.
// Used for screenshots, for the browser preview and when the app is started
// with ROOMY_DEMO=1. Nothing here touches the real disk.

import type {
  AppInfo,
  AppMeta,
  CleanGroup,
  CleanItem,
  DeleteOutcome,
  DeleteRequest,
  Entry,
  Kind,
  Overview,
  Platform,
  RelatedItem,
  ScanStatus,
  Transport,
} from "./api";

export interface MockOptions {
  platform: Platform;
  locale: string;
  /** Base URL of an icon service (`?p=<path>&s=<size>` is appended). */
  iconBase: string | null;
  iconUrl?: (path: string, size: number) => string | null;
  shotsDir?: string | null;
}

const GB = 1000 ** 3;
const MB = 1000 ** 2;
const DAY = 86400;

interface Node {
  name: string;
  size: number;
  children?: Node[];
  pkg?: boolean;
  /** Days since the last change. */
  age?: number;
}

const f = (name: string, size: number, age = 30): Node => ({ name, size, age });
const d = (name: string, children: Node[], age = 20): Node => ({ name, size: 0, children, age });
const pkg = (name: string, size: number, age = 10): Node => ({ name, size, pkg: true, children: [], age });

function total(node: Node): number {
  if (node.children && !node.pkg) node.size = node.children.reduce((sum, c) => sum + total(c), 0);
  return node.size;
}

function count(node: Node): number {
  if (!node.children || node.pkg) return node.pkg ? 1200 : 1;
  return node.children.reduce((sum, c) => sum + count(c), 0);
}

const EXT_KIND: Record<string, Kind> = {
  mov: "video", mp4: "video", mkv: "video", m4v: "video",
  jpg: "image", png: "image", heic: "image", psd: "image", raw: "image",
  mp3: "audio", wav: "audio", m4a: "audio", flac: "audio",
  zip: "archive", rar: "archive", "7z": "archive", gz: "archive",
  dmg: "diskimage", iso: "diskimage", img: "diskimage", vhdx: "diskimage",
  pkg: "installer", exe: "installer", msi: "installer", xip: "installer",
  pdf: "document", docx: "document", key: "document", pptx: "document", xlsx: "document", pages: "document",
  json: "data", db: "data", sqlite: "data", log: "data", bin: "data",
};

function kindOf(node: Node): Kind {
  const ext = node.name.includes(".") ? node.name.split(".").pop()!.toLowerCase() : "";
  if (node.children) return ext === "app" ? "app" : node.pkg ? "package" : "folder";
  return EXT_KIND[ext] ?? "other";
}

function buildHome(win: boolean): Node {
  const movies = d(win ? "Videos" : "Movies", [
    d("Final Cut Projects", [
      pkg(win ? "Wedding 2024" : "Wedding 2024.fcpbundle", 31.4 * GB, 210),
      pkg(win ? "Iceland Trip" : "Iceland Trip.fcpbundle", 16.8 * GB, 420),
    ]),
    d("Exports", [
      f("Wedding film – final.mov", 12.4 * GB, 200),
      f("Wedding film – draft 2.mov", 9.2 * GB, 214),
      f("Iceland teaser 4K.mp4", 3.1 * GB, 400),
    ]),
    d("Screen Recordings", [
      f("Screen Recording 2025-03-02.mov", 4.6 * GB, 95),
      f("Screen Recording 2025-01-17.mov", 2.9 * GB, 140),
      f("Onboarding walkthrough.mov", 1.6 * GB, 320),
    ]),
    d("GoPro", [
      f("GX010482.MP4", 3.9 * GB, 500),
      f("GX010483.MP4", 3.6 * GB, 500),
      f("GX010490.MP4", 1.2 * GB, 498),
    ]),
  ]);
  const pictures = d("Pictures", [
    win ? d("Camera Roll", [f("2024 archive.zip", 38.3 * GB, 300), f("IMG_2291.raw", 62 * MB, 30)]) : pkg("Photos Library.photoslibrary", 58.3 * GB, 2),
    d("Lightroom", [f("Catalog Previews.bin", 3.8 * GB, 60), f("Catalog.db", 1.1 * GB, 12)]),
    d("Screenshots", [f("Screenshot 2025-04-11.png", 14 * MB, 12), f("Older screenshots.zip", 1.5 * GB, 380)]),
  ]);
  const documents = d("Documents", [
    d("Virtual Machines", [win ? f("Ubuntu 24.04.vhdx", 15.2 * GB, 260) : pkg("Windows 11.pvm", 15.2 * GB, 260)]),
    d("Projects", [
      d("Client – Northwind", [f("Brand assets.zip", 4.2 * GB, 150), f("Pitch deck v7.key", 890 * MB, 120), f("Footage selects.mov", 6.1 * GB, 155)]),
      d("Studio rebrand", [f("Mockups.psd", 2.7 * GB, 70), f("Exports.zip", 1.9 * GB, 64)]),
      d("Archive 2022", [f("Everything.zip", 2.8 * GB, 900)]),
    ]),
    d("University", [f("Thesis – final.pdf", 48 * MB, 700), f("Lecture recordings.zip", 4.0 * GB, 760)]),
    d("Scans", [f("Tax documents 2023.pdf", 210 * MB, 480), f("Receipts.pdf", 96 * MB, 300)]),
    f("Budget 2025.xlsx", 3 * MB, 9),
  ]);
  const downloads = d("Downloads", [
    f(win ? "ubuntu-24.04-desktop-amd64.iso" : "ubuntu-24.04-desktop-arm64.iso", 5.9 * GB, 190),
    f("holiday-2023-raw.zip", 4.8 * GB, 510),
    f("zoom-recording-0312.mp4", 2.7 * GB, 240),
    f(win ? "VisualStudioSetup.exe" : "Xcode_16.2.xip", 3.2 * GB, 130),
    f("presentation-final-v3.key", 1.1 * GB, 160),
    f(win ? "Figma-Setup.exe" : "Figma.dmg", 210 * MB, 44),
    f(win ? "Docker Desktop Installer.exe" : "Docker.dmg", 620 * MB, 71),
    f(win ? "node-v22.3.0-x64.msi" : "node-v22.3.0.pkg", 82 * MB, 25),
    f("Invoice-4471.pdf", 2 * MB, 6),
    d("sample-footage", [f("A001_C014.mov", 3.4 * GB, 330), f("A001_C015.mov", 1.7 * GB, 330)], 330),
  ]);
  const music = d("Music", [
    win ? d("Library", [f("Lossless collection.zip", 7.9 * GB, 600)]) : pkg("Music Library.musiclibrary", 7.9 * GB, 4),
    d("GarageBand", [pkg(win ? "Demo session" : "Demo session.band", 2.6 * GB, 280), pkg(win ? "Podcast intro" : "Podcast intro.band", 1.7 * GB, 350)]),
  ]);
  const desktop = d("Desktop", [f("Keynote backup.zip", 2.1 * GB, 85), f("Screen Recording 2025-04-02.mov", 1.3 * GB, 20), f("notes.txt", 4 * 1000, 3)]);
  const developer = d(win ? "source" : "Developer", [
    d("webshop", [d("node_modules", [f("(42,118 files)", 1.9 * GB, 30)]), d(".next", [f("cache.bin", 2.4 * GB, 8)]), f("db-dump.sql", 3.3 * GB, 50)]),
    d("ios-app", [d("build", [f("Intermediates.bin", 6.2 * GB, 40)]), d("Pods", [f("(8,402 files)", 1.4 * GB, 90)])]),
    d("ml-experiments", [f("checkpoint-epoch-40.bin", 7.8 * GB, 230), f("dataset.tar.gz", 5.4 * GB, 260)]),
  ]);
  const library = d(win ? "AppData" : "Library", [
    d(win ? "Local" : "Application Support", [
      d("Steam", [f("shared assets.bin", 11.6 * GB, 20)]),
      d("Docker", [f(win ? "ext4.vhdx" : "Docker.raw", 9.8 * GB, 2)]),
      d("Spotify", [f("offline.bin", 4.4 * GB, 5)]),
      d("Slack", [f("storage.db", 1.9 * GB, 1)]),
      d("Figma", [f("cache.db", 1.5 * GB, 3)]),
    ]),
    d(win ? "Roaming" : "Containers", [d("Mail", [f("Mail data.db", 7.2 * GB, 1)]), d("Messages", [f("Attachments.db", 5.6 * GB, 1)])]),
    d(win ? "LocalLow" : "Caches", [d("Google", [f("Chrome cache.bin", 3.1 * GB, 1)]), d("com.spotify.client", [f("cache.bin", 2.2 * GB, 2)])]),
  ]);
  return d(win ? "alex" : "alex", [movies, pictures, library, documents, developer, downloads, music, desktop]);
}

// Apps that exist on the machine the screenshots are taken on, so the real
// icons can be shown: [name, icon path, GB, days since last use, version, running]
const MAC_APPS: [string, string, number, number | null, string, boolean][] = [
  ["iMovie", "/Applications/iMovie.app", 3.9, 412, "10.4.3", false],
  ["Roblox Studio", "/Applications/RobloxStudio.app", 2.3, 38, "0.661", false],
  ["GarageBand", "/Applications/GarageBand.app", 1.1, null, "10.4.12", false],
  ["OrbStack", "/Applications/OrbStack.app", 0.74, 1, "1.10.3", true],
  ["Claude", "/Applications/Claude.app", 0.68, 0, "1.2.4", true],
  ["Keynote", "/Applications/Keynote Creator Studio.app", 0.65, 96, "14.4", false],
  ["Pages", "/Applications/Pages Creator Studio.app", 0.61, 230, "14.4", false],
  ["Obsidian", "/Applications/Obsidian.app", 0.56, 2, "1.8.9", false],
  ["Numbers", "/Applications/Numbers Creator Studio.app", 0.49, 301, "14.4", false],
  ["Tailscale", "/Applications/Tailscale.app", 0.079, 0, "1.82.0", true],
  ["Tailbolt", "/Applications/Tailbolt.app", 0.017, 5, "2.3", false],
];

const WIN_APPS: [string, string, number, number, string][] = [
  ["Microsoft Visual Studio 2022", "Microsoft Corporation", 28.4, 420, "17.12.3"],
  ["Adobe Premiere Pro 2025", "Adobe Inc.", 9.6, 610, "25.1"],
  ["Steam", "Valve Corporation", 4.8, 900, "2.10.91"],
  ["Docker Desktop", "Docker Inc.", 3.9, 300, "4.38.0"],
  ["Blender", "Blender Foundation", 1.4, 160, "4.3.2"],
  ["Microsoft Office Home 2024", "Microsoft Corporation", 3.2, 700, "16.0"],
  ["Google Chrome", "Google LLC", 0.71, 1100, "134.0"],
  ["Discord", "Discord Inc.", 0.52, 340, "1.0.9183"],
  ["Spotify", "Spotify AB", 0.41, 520, "1.2.58"],
  ["Node.js", "Node.js Foundation", 0.094, 25, "22.3.0"],
  ["7-Zip 24.09 (x64)", "Igor Pavlov", 0.006, 800, "24.09"],
];

export function createMock(opts: MockOptions): Transport {
  const win = opts.platform === "windows";
  const sep = win ? "\\" : "/";
  const root = win ? "C:\\" : "/";
  const users = win ? "C:\\Users" : "/Users";
  const homePath = `${users}${sep}alex`;
  const now = Math.floor(Date.now() / 1000);
  const join = (a: string, b: string) => (a.endsWith(sep) ? a + b : a + sep + b);

  const home = buildHome(win);
  total(home);

  let apps: AppInfo[] = win
    ? WIN_APPS.map(([name, publisher, gb, days, version], i) => ({
        id: `HKLM64\\app-${i}`,
        name,
        path: `C:\\Program Files\\${name}`,
        icon: "",
        bundleId: null,
        version,
        publisher,
        size: Math.round(gb * GB),
        lastUsed: null,
        installed: now - days * DAY,
        removal: "uninstaller",
        running: false,
        store: false,
      }))
    : MAC_APPS.map(([name, path, gb, days, version, running]) => ({
        id: path,
        name,
        path,
        icon: path,
        bundleId: `com.example.${name.toLowerCase().replace(/\W/g, "")}`,
        version,
        publisher: null,
        size: Math.round(gb * GB),
        lastUsed: days === null ? null : now - days * DAY - 3600,
        installed: null,
        removal: "trash",
        running,
        store: ["iMovie", "GarageBand", "Keynote", "Pages", "Numbers", "Xcode"].includes(name),
      }));

  const item = (path: string, name: string, size: number, days: number, kind: Kind): CleanItem => ({
    path,
    name,
    size: Math.round(size),
    modified: now - days * DAY,
    kind,
  });
  const lib = win ? `${homePath}\\AppData\\Local` : `${homePath}/Library`;
  const dl = join(homePath, "Downloads");
  let trashSize = 3.4 * GB;
  let cleanup: CleanGroup[] = [
    {
      id: "trash",
      safety: "safe",
      mode: win ? "emptyTrash" : "permanent",
      items: win
        ? [item("::trash", "Recycle Bin", trashSize, 0, "folder")]
        : [
            item(`${homePath}/.Trash/Old exports`, "Old exports", 2.1 * GB, 12, "folder"),
            item(`${homePath}/.Trash/IMG_4410.mov`, "IMG_4410.mov", 940 * MB, 20, "video"),
            item(`${homePath}/.Trash/Archive.zip`, "Archive.zip", 360 * MB, 31, "archive"),
          ],
      size: 0,
      unknown: false,
    },
    {
      id: "caches",
      safety: "safe",
      mode: "permanent",
      items: [
        item(join(lib, win ? "Google\\Chrome\\Cache" : "Caches/Google"), win ? "Google Chrome cache" : "Google Chrome", 3.1 * GB, 1, "folder"),
        item(join(lib, win ? "Spotify\\Storage" : "Caches/com.spotify.client"), win ? "Spotify cache" : "Spotify", 2.2 * GB, 2, "folder"),
        item(join(lib, win ? "Slack\\Cache" : "Caches/com.tinyspeck.slackmacgap"), win ? "Slack cache" : "Slack", 810 * MB, 1, "folder"),
        item(join(lib, win ? "D3DSCache" : "Caches/Homebrew"), win ? "Graphics shader cache" : "Homebrew", 640 * MB, 9, "folder"),
        item(join(lib, win ? "Code\\Cache" : "Caches/com.microsoft.VSCode"), win ? "VS Code cache" : "Visual Studio Code", 290 * MB, 3, "folder"),
      ],
      size: 0,
      unknown: false,
    },
    ...(win
      ? [
          {
            id: "temp",
            safety: "safe",
            mode: "permanent",
            items: [
              item(`${lib}\\Temp\\setup-leftovers`, "setup-leftovers", 1.8 * GB, 40, "folder"),
              item(`${lib}\\Temp\\vs-installer`, "vs-installer", 760 * MB, 120, "folder"),
              item(`${lib}\\Temp\\chrome_drag_0412`, "chrome_drag_0412", 96 * MB, 3, "folder"),
            ],
            size: 0,
            unknown: false,
          } as CleanGroup,
        ]
      : [
          {
            id: "logs",
            safety: "safe",
            mode: "permanent",
            items: [
              item(`${lib}/Logs/DiagnosticReports`, "DiagnosticReports", 310 * MB, 2, "folder"),
              item(`${lib}/Logs/Adobe`, "Adobe", 120 * MB, 60, "folder"),
            ],
            size: 0,
            unknown: false,
          } as CleanGroup,
        ]),
    {
      id: "developer",
      safety: "safe",
      mode: "permanent",
      items: [
        item(join(lib, win ? "NuGet" : "Developer/Xcode/DerivedData/ios-app"), win ? "NuGet packages" : "Xcode build data · ios-app", 6.2 * GB, 40, "folder"),
        item(join(lib, win ? "npm-cache" : "npm"), "npm cache", 2.9 * GB, 4, "folder"),
        item(join(lib, win ? "gradle" : "Developer/Xcode/iOS DeviceSupport/17.4"), win ? "Gradle caches" : "iOS device support · 17.4", 2.1 * GB, 300, "folder"),
      ],
      size: 0,
      unknown: false,
    },
    {
      id: "installers",
      safety: "safe",
      mode: "trash",
      items: home.children!
        .find((c) => c.name === "Downloads")!
        .children!.filter((c) => ["diskimage", "installer"].includes(kindOf(c)))
        .map((c) => item(join(dl, c.name), c.name, c.size, c.age ?? 30, kindOf(c))),
      size: 0,
      unknown: false,
    },
    {
      id: "oldDownloads",
      safety: "review",
      mode: "trash",
      items: home.children!
        .find((c) => c.name === "Downloads")!
        .children!.filter((c) => (c.age ?? 0) > 90 && !["diskimage", "installer"].includes(kindOf(c)))
        .map((c) => item(join(dl, c.name), c.name, c.size, c.age ?? 30, kindOf(c))),
      size: 0,
      unknown: false,
    },
  ];
  const resize = () => {
    for (const g of cleanup) {
      g.items.sort((a, b) => b.size - a.size);
      g.size = g.items.reduce((s, i) => s + i.size, 0);
    }
    cleanup = cleanup.filter((g) => g.items.length > 0);
  };
  resize();

  const disk = { name: win ? "Windows (C:)" : "Macintosh HD", total: 494.38 * GB };
  const systemSize = 41.8 * GB;
  const appsSize = () => apps.reduce((s, a) => s + a.size, 0);
  const used = () => home.size + appsSize() + systemSize + trashSize;

  function find(path: string): { node: Node; parent: Node | null } | null {
    if (path === homePath) return { node: home, parent: null };
    if (!path.startsWith(homePath + sep)) return null;
    let node = home;
    let parent: Node | null = null;
    for (const part of path.slice(homePath.length + 1).split(sep)) {
      const next = node.children?.find((c) => c.name === part);
      if (!next) return null;
      parent = node;
      node = next;
    }
    return { node, parent };
  }

  const isAppData = (path: string) => path.startsWith(join(homePath, win ? "AppData" : "Library"));
  const PROTECTED = new Set(
    ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Movies", "Videos", "Library", "AppData"].map((n) => join(homePath, n)),
  );

  function entry(node: Node, parent: string): Entry {
    const path = join(parent, node.name);
    const isDir = !!node.children;
    return {
      name: node.name,
      path,
      parent,
      size: node.size,
      files: isDir ? count(node) : 1,
      isDir,
      package: !!node.pkg,
      kind: kindOf(node),
      modified: now - (node.age ?? 30) * DAY,
      protected: PROTECTED.has(path) || (isAppData(parent) && parent === join(homePath, win ? "AppData" : "Library")),
      denied: false,
      appData: isAppData(path),
    };
  }

  function listDir(path: string): Entry[] {
    const bySize = (a: Entry, b: Entry) => b.size - a.size;
    const folder = (name: string, size: number, parent: string, prot = true): Entry => ({
      name,
      path: join(parent, name),
      parent,
      size,
      files: 1000,
      isDir: true,
      package: false,
      kind: "folder",
      modified: now - 5 * DAY,
      protected: prot,
      denied: false,
      appData: false,
    });
    if (path === root) {
      return (
        win
          ? [folder("Users", home.size, root), folder("Program Files", appsSize(), root), folder("Windows", 31.2 * GB, root), folder("ProgramData", 10.6 * GB, root)]
          : [folder("Users", home.size, root), folder("Applications", appsSize(), root), folder("System", 22.4 * GB, root), folder("Library", 12.1 * GB, root), folder("private", 7.3 * GB, root)]
      ).sort(bySize);
    }
    if (path === users) return [folder("alex", home.size, users)];
    const hit = find(path);
    if (!hit || !hit.node.children) return [];
    return hit.node.children.map((c) => entry(c, path)).sort(bySize);
  }

  function allFiles(): Entry[] {
    const out: Entry[] = [];
    const walk = (node: Node, parent: string) => {
      for (const c of node.children ?? []) {
        if (c.children && !c.pkg) walk(c, join(parent, c.name));
        else if (c.size >= 10 * MB && !c.name.startsWith("(")) out.push(entry(c, parent));
      }
    };
    walk(home, homePath);
    return out.sort((a, b) => b.size - a.size);
  }

  function overview(): Overview {
    const sizeOf = (name: string) => home.children!.find((c) => c.name === name)?.size ?? 0;
    const media = sizeOf(win ? "Videos" : "Movies") + sizeOf("Pictures") + sizeOf("Music");
    const documents = sizeOf("Documents") + sizeOf("Desktop");
    const developer = sizeOf(win ? "source" : "Developer");
    const appData = sizeOf(win ? "AppData" : "Library");
    const downloads = sizeOf("Downloads");
    const big = allFiles().filter((e) => e.size >= 100 * MB && !e.appData);
    const u = used();
    return {
      disk: { name: disk.name, total: disk.total, used: u, free: disk.total - u },
      scanned: home.size + appsSize() + 22 * GB,
      files: 1_284_366,
      durationMs: 6400,
      finished: now,
      categories: [
        { id: "apps", size: appsSize(), path: win ? "C:\\Program Files" : "/Applications" },
        { id: "documents", size: documents, path: join(homePath, "Documents") },
        { id: "downloads", size: downloads, path: join(homePath, "Downloads") },
        { id: "media", size: media, path: join(homePath, win ? "Videos" : "Movies") },
        { id: "developer", size: developer, path: join(homePath, win ? "source" : "Developer") },
        { id: "appData", size: appData, path: join(homePath, win ? "AppData" : "Library") },
        { id: "otherHome", size: Math.max(0, home.size - media - documents - developer - appData - downloads), path: homePath },
        { id: "otherUsers", size: 0, path: users },
        { id: "system", size: systemSize + trashSize, path: null },
      ],
      topFolders: listDir(homePath).filter((e) => e.isDir).slice(0, 8),
      bigFileCount: big.length,
      bigFileSize: big.reduce((s, e) => s + e.size, 0),
    };
  }

  function remove(path: string): number {
    const hit = find(path);
    if (hit?.parent) {
      hit.parent.children = hit.parent.children!.filter((c) => c !== hit.node);
      total(home);
      return hit.node.size;
    }
    const app = apps.find((a) => a.path === path);
    if (app) {
      apps = apps.filter((a) => a !== app);
      return app.size;
    }
    return 0;
  }

  function deleteOne(req: DeleteRequest): DeleteOutcome {
    if (req.path === "::trash" || req.mode === "emptyTrash") {
      const freed = trashSize;
      trashSize = 0;
      cleanup = cleanup.filter((g) => g.id !== "trash");
      return { path: req.path, ok: true, error: null, freed, trashed: false, skipped: 0 };
    }
    let freed = remove(req.path);
    for (const g of cleanup) {
      const it = g.items.find((i) => i.path === req.path);
      if (it) {
        freed = freed || it.size;
        g.items = g.items.filter((i) => i !== it);
        if (g.id === "trash") trashSize = Math.max(0, trashSize - it.size);
      }
    }
    resize();
    const trashed = req.mode === "trash";
    if (trashed) trashSize += freed;
    return { path: req.path, ok: true, error: null, freed, trashed, skipped: 0 };
  }

  // A scan that takes a moment, so the progress screen can be seen.
  let scanStarted = 0;
  const scanMs = opts.shotsDir || new URLSearchParams(location.search).has("fast") ? 250 : 2600;
  function status(): ScanStatus {
    if (!scanStarted) return { state: "idle", files: 0, bytes: 0, current: "" };
    const t = Math.min(1, (Date.now() - scanStarted) / scanMs);
    const eased = 1 - (1 - t) ** 2;
    const stops = ["Applications", "Library", "Users/alex/Library", "Users/alex/Movies", "Users/alex/Pictures", "Users/alex/Documents"];
    return {
      state: t >= 1 ? "done" : "scanning",
      files: Math.round(1_284_366 * eased),
      bytes: Math.round((home.size + appsSize() + 22 * GB) * eased),
      current: root + stops[Math.min(stops.length - 1, Math.floor(t * stops.length))].split("/").join(sep),
    };
  }

  const meta: AppMeta = {
    platform: opts.platform,
    version: "0.1.0",
    home: homePath,
    root,
    locale: opts.locale,
    fullDiskAccess: true,
    demo: true,
    shotsDir: opts.shotsDir ?? null,
  };

  const related = (path: string): RelatedItem[] => {
    const name = path.split(sep).pop()!.replace(/\.app$/, "");
    const id = apps.find((a) => a.path === path)?.bundleId ?? name;
    const size = Math.round(((name.length * 37) % 900) * MB + 40 * MB);
    return [
      { path: `${homePath}/Library/Application Support/${name}`, size, kind: "support" },
      { path: `${homePath}/Library/Caches/${id}`, size: Math.round(size / 6), kind: "cache" },
      { path: `${homePath}/Library/Preferences/${id}.plist`, size: 12_000, kind: "preferences" },
    ];
  };

  const handlers: Record<string, (args: any) => unknown> = {
    app_info: () => meta,
    disk_info: () => overview().disk,
    start_scan: () => {
      scanStarted = Date.now();
      return null;
    },
    scan_status: () => status(),
    get_overview: () => (status().state === "done" ? overview() : null),
    list_dir: (a) => listDir(a.path),
    large_files: (a) => allFiles().filter((e) => e.size >= (a.minSize ?? 0)).slice(0, a.limit ?? 500),
    list_apps: () => [...apps].sort((a, b) => b.size - a.size),
    app_related: (a) => (win ? [] : related(a.path)),
    uninstall_app: (a) => {
      apps = apps.filter((x) => x.id !== a.id);
      return null;
    },
    cleanup_suggestions: () => cleanup.map((g) => ({ ...g, items: [...g.items] })),
    delete_items: (a) => (a.items as DeleteRequest[]).map(deleteOne),
    trash_info: () => ({ size: trashSize, items: trashSize > 0 ? 3 : 0 }),
    empty_trash: () => deleteOne({ path: "::trash", mode: "emptyTrash" }).freed,
    reveal: () => null,
    open_path: () => null,
    open_full_disk_access: () => null,
  };

  return {
    async call<T>(cmd: string, args?: Record<string, unknown>) {
      const handler = handlers[cmd];
      if (!handler) throw new Error(`unknown command: ${cmd}`);
      // A little latency, like a real backend.
      await new Promise((r) => setTimeout(r, cmd === "delete_items" ? 350 : 20));
      return structuredClone(handler(args ?? {})) as T;
    },
    iconUrl(path, size) {
      if (opts.iconUrl) return opts.iconUrl(path, size);
      if (opts.iconBase) return `${opts.iconBase}${opts.iconBase.includes("?") ? "&" : "?"}s=${size}&p=${encodeURIComponent(path)}`;
      return null;
    },
  };
}
