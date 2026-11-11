// Sample data: a made-up computer that behaves like the real backend.
// Used for screenshots, for the browser preview and when the app is started
// with ROOMY_DEMO=1. Nothing here touches the real disk.

import type {
  AppInfo,
  AppMeta,
  BloatReport,
  CleanGroup,
  CleanItem,
  DeleteOutcome,
  DeleteRequest,
  Entry,
  Health,
  Kind,
  MalwareEngine,
  MalwareStatus,
  Overview,
  Platform,
  RelatedItem,
  ScanScope,
  ScanStatus,
  Threat,
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

/** Processor load of the last minutes on the sample computer, oldest first. */
export const SAMPLE_CPU = [9, 11, 10, 14, 22, 31, 27, 18, 13, 12, 15, 13, 11, 12, 19, 24, 21, 16, 12, 10, 11, 13, 17, 15, 12, 11, 14, 26, 35, 29, 20, 15, 13, 12, 11, 13, 16, 14, 12, 13];

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

  // A second disk, to show that Roomy looks at every one of them.
  const extRoot = win ? "D:\\" : "/Volumes/Backup SSD";
  const extDisk = { name: win ? "Data (D:)" : "Backup SSD", total: 1000.2 * GB };
  const ext = d("", [
    d("Photo archive", [f("2019.zip", 61.2 * GB, 900), f("2020.zip", 74.8 * GB, 800), f("2021.zip", 88.1 * GB, 700), f("2022 raw.zip", 96.4 * GB, 500)]),
    d("Video projects", [f("Documentary master.mov", 118.3 * GB, 420), f("Interviews.zip", 64.9 * GB, 430), f("Drone footage.mov", 41.7 * GB, 380)]),
    d("Old laptop backup", [f("Users.zip", 96.2 * GB, 1100), f("Applications.zip", 22.4 * GB, 1100)]),
    d("Games", [f("Library.bin", 71.5 * GB, 60)]),
    d("Music production", [f("Samples.zip", 38.6 * GB, 300), f("Sessions.zip", 17.2 * GB, 200)]),
    f("disk-image-2021.dmg", 12.8 * GB, 1000),
  ]);
  total(ext);
  const appsSize = () => apps.reduce((s, a) => s + a.size, 0);
  const used = () => home.size + appsSize() + systemSize + trashSize;

  const onExt = (path: string) => path === extRoot || path.startsWith(join(extRoot, ""));

  function find(path: string): { node: Node; parent: Node | null } | null {
    const [base, tree] = onExt(path) ? [extRoot, ext] : [homePath, home];
    if (path === base) return { node: tree, parent: null };
    const prefix = join(base, "");
    if (!path.startsWith(prefix)) return null;
    let node = tree;
    let parent: Node | null = null;
    for (const part of path.slice(prefix.length).split(sep)) {
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
      protected: !onExt(path) && (PROTECTED.has(path) || (isAppData(parent) && parent === join(homePath, win ? "AppData" : "Library"))),
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

  function allFiles(diskRoot: string = root): Entry[] {
    const out: Entry[] = [];
    const walk = (node: Node, parent: string) => {
      for (const c of node.children ?? []) {
        if (c.children && !c.pkg) walk(c, join(parent, c.name));
        else if (c.size >= 10 * MB && !c.name.startsWith("(")) out.push(entry(c, parent));
      }
    };
    if (diskRoot === extRoot) walk(ext, extRoot);
    else walk(home, homePath);
    return out.sort((a, b) => b.size - a.size);
  }

  const diskInfos = () => {
    const u = used();
    return [
      { root, name: disk.name, total: disk.total, used: u, free: disk.total - u, system: true, removable: false },
      { root: extRoot, name: extDisk.name, total: extDisk.total, used: ext.size + 2.1 * GB, free: extDisk.total - ext.size - 2.1 * GB, system: false, removable: !win },
    ];
  };

  function overviewExt(): Overview {
    const top = listDir(extRoot);
    const dirs = top.filter((e) => e.isDir);
    const info = diskInfos()[1];
    const shown = dirs.slice(0, 6);
    const big = allFiles(extRoot).filter((e) => e.size >= 100 * MB);
    return {
      disk: info,
      scanned: ext.size,
      files: 48_210,
      durationMs: 2100,
      finished: now,
      categories: [
        ...shown.map((e) => ({ id: "folder" as const, name: e.name, size: e.size, path: e.path })),
        { id: "otherHome" as const, name: null, size: info.used - shown.reduce((s, e) => s + e.size, 0), path: extRoot },
      ],
      topFolders: dirs.slice(0, 8),
      bigFileCount: big.length,
      bigFileSize: big.reduce((s, e) => s + e.size, 0),
    };
  }

  function overview(diskRoot: string = root): Overview {
    if (diskRoot === extRoot) return overviewExt();
    const sizeOf = (name: string) => home.children!.find((c) => c.name === name)?.size ?? 0;
    const media = sizeOf(win ? "Videos" : "Movies") + sizeOf("Pictures") + sizeOf("Music");
    const documents = sizeOf("Documents") + sizeOf("Desktop");
    const developer = sizeOf(win ? "source" : "Developer");
    const appData = sizeOf(win ? "AppData" : "Library");
    const downloads = sizeOf("Downloads");
    const big = allFiles().filter((e) => e.size >= 100 * MB && !e.appData);
    const u = used();
    return {
      disk: { root, name: disk.name, total: disk.total, used: u, free: disk.total - u, system: true, removable: false },
      scanned: home.size + appsSize() + 22 * GB,
      files: 1_284_366,
      durationMs: 6400,
      finished: now,
      categories: [
        { id: "apps", name: null, size: appsSize(), path: win ? "C:\\Program Files" : "/Applications" },
        { id: "documents", name: null, size: documents, path: join(homePath, "Documents") },
        { id: "downloads", name: null, size: downloads, path: join(homePath, "Downloads") },
        { id: "media", name: null, size: media, path: join(homePath, win ? "Videos" : "Movies") },
        { id: "developer", name: null, size: developer, path: join(homePath, win ? "source" : "Developer") },
        { id: "appData", name: null, size: appData, path: join(homePath, win ? "AppData" : "Library") },
        { id: "otherHome", name: null, size: Math.max(0, home.size - media - documents - developer - appData - downloads), path: homePath },
        { id: "otherUsers", name: null, size: 0, path: users },
        { id: "system", name: null, size: systemSize + trashSize, path: null },
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
    const unwanted = bloat.unwanted.find((u) => u.target === req.path);
    if (unwanted) {
      freed = freed || unwanted.size;
      bloat = { ...bloat, unwanted: bloat.unwanted.filter((u) => u !== unwanted) };
    }
    const threat = threats.find((x) => (x.container ?? x.path) === req.path);
    if (threat) {
      freed = freed || threat.size;
      threats = threats.filter((x) => x !== threat);
    }
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
  const scanStarted: Record<string, number> = {};
  const scanMs = opts.shotsDir || new URLSearchParams(location.search).has("fast") ? 250 : 2600;
  function status(diskRoot: string = root): ScanStatus {
    const started = scanStarted[diskRoot];
    if (!started) return { state: "idle", files: 0, bytes: 0, current: "" };
    const external = diskRoot === extRoot;
    const t = Math.min(1, (Date.now() - started) / (external ? scanMs / 2 : scanMs));
    const eased = 1 - (1 - t) ** 2;
    const stops = external
      ? ["Photo archive", "Video projects", "Old laptop backup"]
      : ["Applications", "Library", "Users/alex/Library", "Users/alex/Movies", "Users/alex/Pictures", "Users/alex/Documents"];
    return {
      state: t >= 1 ? "done" : "scanning",
      files: Math.round((external ? 48_210 : 1_284_366) * eased),
      bytes: Math.round((external ? ext.size : home.size + appsSize() + 22 * GB) * eased),
      current: join(diskRoot, stops[Math.min(stops.length - 1, Math.floor(t * stops.length))].split("/").join(sep)),
    };
  }

  // What the Bloat Scanner finds on the sample computer.
  let bloat: BloatReport = win
    ? {
        unwanted: [
          { id: "HKLM64\\wt", name: "WildTangent Games", reason: "bundled", path: "C:\\Program Files (x86)\\WildTangent Games", icon: "", size: 412 * MB, running: true, pids: [4312], removal: "uninstaller", target: "HKLM64\\wt" },
          { id: "package:king.com.CandyCrushSaga_1.2_x64__kgqvnymyfvs32", name: "Candy Crush", reason: "promo", path: "", icon: "", size: 286 * MB, running: false, pids: [], removal: "package", target: "king.com.CandyCrushSaga_1.2_x64__kgqvnymyfvs32" },
          { id: "HKLM64\\pcopt", name: "PC Optimizer Pro", reason: "pup", path: "C:\\Program Files\\PC Optimizer Pro", icon: "", size: 94 * MB, running: true, pids: [7120, 7124], removal: "uninstaller", target: "HKLM64\\pcopt" },
        ],
        startup: [
          { id: "run:HKCU:PCOptimizerPro", name: "PC Optimizer Pro", label: "PCOptimizerPro", program: "C:\\Program Files\\PC Optimizer Pro\\pcopt.exe", source: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", scope: "user", kind: "runKey", vendor: null, running: true, enabled: true, flags: ["unwanted"], canDisable: true, icon: "" },
          { id: "run:HKCU:OldVpn", name: "Old VPN Helper", label: "OldVpn", program: "C:\\Program Files\\OldVPN\\helper.exe", source: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", scope: "user", kind: "runKey", vendor: null, running: false, enabled: true, flags: ["leftover"], canDisable: true, icon: "" },
          { id: "run:HKCU:Spotify", name: "Spotify", label: "Spotify", program: "C:\\Users\\alex\\AppData\\Roaming\\Spotify\\Spotify.exe", source: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", scope: "user", kind: "runKey", vendor: null, running: true, enabled: true, flags: [], canDisable: true, icon: "" },
          { id: "run:HKCU:Discord", name: "Discord", label: "Discord", program: "C:\\Users\\alex\\AppData\\Local\\Discord\\Update.exe", source: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", scope: "user", kind: "runKey", vendor: null, running: true, enabled: true, flags: [], canDisable: true, icon: "" },
          { id: "run:HKLM:SecurityHealth", name: "Windows Security notification icon", label: "SecurityHealth", program: "C:\\Windows\\System32\\SecurityHealthSystray.exe", source: "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", scope: "system", kind: "runKey", vendor: null, running: true, enabled: true, flags: [], canDisable: false, icon: "" },
          { id: "run:HKCU:Steam", name: "Steam", label: "Steam", program: "C:\\Program Files (x86)\\Steam\\steam.exe", source: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", scope: "user", kind: "runKey", vendor: null, running: false, enabled: false, flags: [], canDisable: true, icon: "" },
        ],
        security: [
          { id: "antivirus", status: "ok", detail: "1" },
          { id: "firewall", status: "ok", detail: null },
          { id: "diskEncryption", status: "warn", detail: null },
          { id: "uac", status: "ok", detail: null },
          { id: "updates", status: "warn", detail: "63" },
          { id: "smartScreen", status: "ok", detail: null },
          { id: "remoteDesktop", status: "ok", detail: null },
        ],
        processes: 214,
        durationMs: 1900,
      }
    : {
        unwanted: [
          { id: "/Applications/Mac Speedup Pro.app", name: "Mac Speedup Pro", reason: "pup", path: "/Applications/Mac Speedup Pro.app", icon: "", size: 212 * MB, running: true, pids: [812], removal: "trash", target: "/Applications/Mac Speedup Pro.app" },
          { id: "process:SearchMine", name: "SearchMine", reason: "adware", path: `${homePath}/Library/Application Support/SearchMine/SearchMine`, icon: "", size: 0, running: true, pids: [640], removal: "none", target: "" },
        ],
        startup: [
          { id: `${homePath}/Library/LaunchAgents/com.searchmine.agent.plist`, name: "com.searchmine.agent", label: "com.searchmine.agent", program: `${homePath}/Library/Application Support/SearchMine/SearchMine`, source: `${homePath}/Library/LaunchAgents/com.searchmine.agent.plist`, scope: "user", kind: "launchAgent", vendor: null, running: true, enabled: true, flags: ["unwanted", "unsigned"], canDisable: true, icon: "" },
          { id: `${homePath}/Library/LaunchAgents/com.oldvpn.helper.plist`, name: "com.oldvpn.helper", label: "com.oldvpn.helper", program: "/Applications/OldVPN.app/Contents/MacOS/helper", source: `${homePath}/Library/LaunchAgents/com.oldvpn.helper.plist`, scope: "user", kind: "launchAgent", vendor: null, running: false, enabled: true, flags: ["leftover"], canDisable: true, icon: "" },
          { id: "label:com.anthropic.claudefordesktop.helper", name: "Claude", label: "com.anthropic.claudefordesktop.helper", program: "/Applications/Claude.app/Contents/MacOS/Claude", source: "/Applications/Claude.app", scope: "user", kind: "backgroundItem", vendor: "Anthropic PBC", running: true, enabled: true, flags: [], canDisable: false, icon: "/Applications/Claude.app" },
          { id: `${homePath}/Library/LaunchAgents/dev.orbstack.helper.plist`, name: "OrbStack", label: "dev.orbstack.helper", program: "/Applications/OrbStack.app/Contents/MacOS/OrbStack Helper", source: `${homePath}/Library/LaunchAgents/dev.orbstack.helper.plist`, scope: "user", kind: "launchAgent", vendor: "Orbital Labs, LLC", running: true, enabled: true, flags: [], canDisable: true, icon: "/Applications/OrbStack.app" },
          { id: "label:io.tailscale.ipn.macsys.login-item-helper", name: "Tailscale", label: "io.tailscale.ipn.macsys.login-item-helper", program: "/Applications/Tailscale.app/Contents/MacOS/Tailscale", source: "/Applications/Tailscale.app", scope: "user", kind: "backgroundItem", vendor: "Tailscale Inc.", running: true, enabled: true, flags: [], canDisable: false, icon: "/Applications/Tailscale.app" },
          { id: `${homePath}/Library/LaunchAgents/homebrew.mxcl.postgresql.plist`, name: "homebrew.mxcl.postgresql", label: "homebrew.mxcl.postgresql", program: "/opt/homebrew/opt/postgresql/bin/postgres", source: `${homePath}/Library/LaunchAgents/homebrew.mxcl.postgresql.plist`, scope: "user", kind: "launchAgent", vendor: null, running: true, enabled: true, flags: ["unsigned"], canDisable: true, icon: "" },
          { id: "/Library/LaunchDaemons/com.docker.vmnetd.plist", name: "com.docker.vmnetd", label: "com.docker.vmnetd", program: "/Library/PrivilegedHelperTools/com.docker.vmnetd", source: "/Library/LaunchDaemons/com.docker.vmnetd.plist", scope: "system", kind: "launchDaemon", vendor: "Docker Inc", running: false, enabled: true, flags: [], canDisable: false, icon: "" },
        ],
        security: [
          { id: "diskEncryption", status: "ok", detail: null },
          { id: "firewall", status: "info", detail: null },
          { id: "gatekeeper", status: "ok", detail: null },
          { id: "sip", status: "ok", detail: null },
          { id: "updates", status: "warn", detail: "63" },
          { id: "autoLogin", status: "ok", detail: null },
          { id: "remoteLogin", status: "info", detail: null },
        ],
        processes: 487,
        durationMs: 1600,
      };

  // The sample computer itself: a laptop that is doing a little something.
  const GIB = 1024 ** 3;
  const booted = Date.now();
  const still = !!opts.shotsDir || new URLSearchParams(location.search).has("still");
  let consumers: Health["top"] = (
    win
      ? ([
          ["Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", 3.1, 7.4],
          ["Vmmem", "", 2.4, 3.1],
          ["Discord", "C:\\Users\\alex\\AppData\\Local\\Discord\\Discord.exe", 0.92, 1.2],
          ["Steam", "C:\\Program Files (x86)\\Steam\\steam.exe", 0.61, 0.6],
          ["Spotify", "C:\\Users\\alex\\AppData\\Roaming\\Spotify\\Spotify.exe", 0.48, 0.9],
          ["explorer", "C:\\Windows\\explorer.exe", 0.31, 0.4],
        ] as const)
      : ([
          ["Safari", "/Applications/Safari.app", 2.9, 6.4],
          ["Xcode", "/Applications/Xcode.app", 2.4, 11.8],
          ["Claude", "/Applications/Claude.app", 1.3, 2.1],
          ["OrbStack", "/Applications/OrbStack.app", 1.1, 3.4],
          ["Obsidian", "/Applications/Obsidian.app", 0.64, 0.3],
          ["WindowServer", "/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer", 0.51, 4.2],
          ["node", "/opt/homebrew/bin/node", 0.42, 1.4],
          ["mds_stores", "/System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Support/mds_stores", 0.21, 0.2],
        ] as const)
  ).map(([name, path, gb, cpu], i) => ({
    name,
    path,
    memory: Math.round(gb * GIB),
    cpu,
    pids: [900 + i],
    canQuit: !win && path.startsWith("/Applications"),
    app: win ? !!path && !path.startsWith("C:\\Windows") : path.endsWith(".app"),
  }));

  const startedWith = consumers.length;

  function health(): Health {
    const s = still ? 0 : (Date.now() - booted) / 1000;
    const wobble = Math.sin(s * 0.9) * 5 + Math.sin(s * 2.7 + 1) * 3 + Math.sin(s * 0.23 + 2) * 4;
    const total = (win ? 16 : 18) * GIB;
    const used = Math.round((win ? 10.9 : 11.6) * GIB + Math.sin(s * 0.4) * 0.15 * GIB - (startedWith - consumers.length) * 0.9 * GIB);
    return {
      os: win ? "Windows 11 (26100)" : "macOS 15.4",
      host: win ? "ALEX-LAPTOP" : "Alex's MacBook Pro",
      cpuBrand: win ? "AMD Ryzen 7 7840U" : "Apple M3 Pro",
      cores: win ? 16 : 12,
      cpu: Math.max(2, Math.min(97, SAMPLE_CPU[SAMPLE_CPU.length - 1] + wobble)),
      memoryTotal: total,
      memoryUsed: used,
      memoryAvailable: total - used,
      swapUsed: 0,
      pressure: "normal",
      uptime: 3 * DAY + 5 * 3600 + Math.round(s),
      battery: win
        ? { percent: 64, charging: true, plugged: true, cycles: null, maxCapacity: 88, condition: "good" }
        : { percent: 82, charging: false, plugged: false, cycles: 214, maxCapacity: 91, condition: "good" },
      diskHealth: "ok",
      top: consumers.map((c) => ({ ...c, cpu: Math.max(0.1, c.cpu + (still ? 0 : Math.sin(s * 1.3 + c.pids[0]) * c.cpu * 0.3)) })),
    };
  }

  // The malware scan of the sample computer: the quick one finds nothing, the
  // full one finds the scanner's test file and the adware the Bloat Scanner knows.
  const engine: MalwareEngine = win
    ? { engine: "defender", available: true, version: "1.421.118.0", rules: 0, updated: now - DAY }
    : { engine: "xprotect", available: true, version: "5372", rules: 586, updated: now - 9 * DAY };
  let threats: Threat[] = win
    ? [{ path: `${dl}\\free-video-converter-setup.exe`, name: "free-video-converter-setup.exe", signature: "PUA:Win32/InstallCore", size: 0, modified: 0, container: null, handled: true, test: false }]
    : [
        { path: `${homePath}/Library/Application Support/SearchMine/SearchMine.app/Contents/MacOS/SearchMine`, name: "SearchMine", signature: "MACOS.ADLOAD", size: Math.round(3.1 * MB), modified: now - 41 * DAY, container: `${homePath}/Library/Application Support/SearchMine/SearchMine.app`, handled: false, test: false },
        { path: `${dl}/eicar.com`, name: "eicar.com", signature: "EICAR test file", size: 68, modified: now - 2 * DAY, container: null, handled: false, test: true },
      ];
  let malware: { started: number; scope: ScanScope; stopped: number | null } | null = null;
  const fast = !!opts.shotsDir || new URLSearchParams(location.search).has("fast");
  function malwareStatus(): MalwareStatus {
    if (!malware) return { state: "idle", scope: "quick", files: 0, bytes: 0, current: "", skipped: 0, threats: [], started: 0, durationMs: 0, cancelled: false, error: null, engine };
    const full = malware.scope === "full";
    const length = fast ? 500 : full ? 9000 : 2400;
    const elapsed = (malware.stopped ?? Date.now()) - malware.started;
    const t = Math.min(1, elapsed / length);
    const done = t >= 1 || malware.stopped !== null;
    const stops = full
      ? ["Library/Application Support", "Movies", "Pictures", "Documents/Projects", "Developer/webshop/node_modules", "Downloads"]
      : ["Applications/Xcode.app/Contents/MacOS", "Applications/Safari.app/Contents/MacOS", "Library/LaunchAgents", "Downloads", "Desktop"];
    const where = stops[Math.min(stops.length - 1, Math.floor(t * stops.length))];
    return {
      state: done ? "done" : "scanning",
      scope: malware.scope,
      // Microsoft Defender does not say how far it is.
      files: win ? 0 : Math.round((full ? 412_806 : 5_214) * t),
      bytes: win ? 0 : Math.round((full ? 61.3 * GB : 742 * MB) * t),
      current: win || done ? "" : where.startsWith("Applications") ? `/${where}` : `${homePath}/${where}`,
      skipped: full && done && !win ? 14 : 0,
      threats: done && malware.stopped === null && full ? threats : [],
      started: Math.floor(malware.started / 1000),
      // Microsoft Defender takes minutes where Roomy's own scan takes seconds.
      durationMs: win ? 84_000 : fast ? (full ? 71_400 : 1_900) : Math.round(elapsed * (full ? 8 : 0.8)),
      cancelled: malware.stopped !== null,
      error: null,
      engine,
    };
  }

  const meta: AppMeta = {
    platform: opts.platform,
    version: "0.3.0",
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
    list_disks: () => diskInfos(),
    start_scan: (a) => {
      scanStarted[a.root ?? root] = Date.now();
      return null;
    },
    scan_status: (a) => status(a.root ?? root),
    get_overview: (a) => (status(a.root ?? root).state === "done" ? overview(a.root ?? root) : null),
    list_dir: (a) => listDir(a.path),
    large_files: (a) => allFiles(a.root ?? root).filter((e) => e.size >= (a.minSize ?? 0)).slice(0, a.limit ?? 500),
    bloat_scan: () => bloat,
    bloat_disable_startup: (a) => {
      bloat = { ...bloat, startup: bloat.startup.map((i) => (i.id === a.id ? { ...i, enabled: false, running: false } : i)).filter((i) => !(i.id === a.id && !win)) };
      return null;
    },
    bloat_quit: (a) => {
      const pids = a.pids as number[];
      bloat = { ...bloat, unwanted: bloat.unwanted.map((u) => (u.pids.some((p) => pids.includes(p)) ? { ...u, running: false, pids: [] } : u)).filter((u) => u.removal !== "none" || u.running) };
      return pids.length;
    },
    bloat_remove_package: (a) => {
      bloat = { ...bloat, unwanted: bloat.unwanted.filter((u) => u.target !== a.id) };
      return null;
    },
    open_settings: () => null,
    health: () => health(),
    health_quit: (a) => {
      const pids = a.pids as number[];
      const before = consumers.length;
      consumers = consumers.filter((c) => !(c.canQuit && c.pids.some((p) => pids.includes(p))));
      return before - consumers.length;
    },
    malware_start: (a) => {
      if (!malware || malwareStatus().state !== "scanning") malware = { started: Date.now(), scope: a.scope === "full" ? "full" : "quick", stopped: null };
      return null;
    },
    malware_status: () => malwareStatus(),
    malware_cancel: () => {
      if (malware && malwareStatus().state === "scanning") malware.stopped = Date.now();
      return null;
    },
    list_apps: () => [...apps].sort((a, b) => b.size - a.size),
    app_related: (a) => (win ? [] : related(a.path)),
    uninstall_app: (a) => {
      apps = apps.filter((x) => x.id !== a.id);
      bloat = { ...bloat, unwanted: bloat.unwanted.filter((u) => u.target !== a.id) };
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
