import type { Category } from "../api";
import { formatBytes, shortPath } from "../format";
import { formatCount, t, tn } from "../i18n";
import { Icon } from "../icons";
import { dismissFda, navigate, openFolder, rescan, setState, useStore } from "../store";
import { api } from "../api";
import { CATEGORY_COLOR, FOLDER_COLORS } from "../theme";
import { FileIcon, Header, SizeBar } from "../ui";

const HALF_YEAR = 182 * 86400;

function ScanHero() {
  const scan = useStore((s) => s.scan);
  const disk = useStore((s) => s.disk);
  const progress = disk && disk.used > 0 ? Math.min(0.98, scan.bytes / disk.used) : 0;
  return (
    <div className="scan">
      <div className="scan-pulse">
        <Icon name="disk" size={26} stroke={1.6} />
      </div>
      <h2>{t("scan.title")}</h2>
      <div className="scan-number">{formatBytes(scan.bytes)}</div>
      <div className="scan-track">
        <i style={{ width: `${Math.max(2, progress * 100)}%` }} />
      </div>
      <div className="scan-meta">
        <span>{t("scan.files", { count: formatCount(scan.files) })}</span>
        <span className="scan-path">{scan.current ? shortPath(scan.current) : " "}</span>
      </div>
    </div>
  );
}

export function OverviewView() {
  const meta = useStore((s) => s.meta);
  const scan = useStore((s) => s.scan);
  const overview = useStore((s) => s.overview);
  const apps = useStore((s) => s.apps);
  const cleanup = useStore((s) => s.cleanup);
  const fdaDismissed = useStore((s) => s.fdaDismissed);

  if (!meta) return null;
  if (!overview) {
    return (
      <>
        <Header title={t("nav.overview")} />
        <div className="content center">
          <ScanHero />
        </div>
      </>
    );
  }

  const { disk } = overview;
  // Slivers below a tenth of a percent only add noise.
  const cats = overview.categories.filter((c) => c.size / disk.total > 0.001);
  const visible = cats.filter((c) => c.size / disk.total > 0.003);
  const scanning = scan.state === "scanning";
  // On the system disk the bar shows kinds of content; on any other disk its biggest folders.
  const folders = cats.filter((c) => c.id === "folder");
  const colorOf = (c: Category) => (c.id === "folder" ? FOLDER_COLORS[folders.indexOf(c) % FOLDER_COLORS.length] : CATEGORY_COLOR[c.id]);
  const labelOf = (c: Category) => (c.id === "folder" ? (c.name ?? "") : t(`cat.${c.id}`));

  const openCategory = (c: Category) => {
    if (c.id === "apps") navigate("apps");
    else if (c.path) openFolder(c.path);
  };

  const cleanupSize = (cleanup ?? []).reduce((s, g) => s + g.size, 0);
  const now = Date.now() / 1000;
  const hasUsage = (apps ?? []).some((a) => a.lastUsed !== null);
  const unused = (apps ?? []).filter((a) => !a.running && (a.lastUsed === null || now - a.lastUsed > HALF_YEAR));
  const appsForCard = hasUsage ? unused : (apps ?? []);
  const downloads = overview.categories.find((c) => c.id === "downloads");
  const maxFolder = overview.topFolders[0]?.size ?? 0;

  const systemCards = [
    {
      key: "cleanup",
      icon: "cleanup",
      title: t("overview.cleanup.title"),
      size: cleanupSize,
      hint: t("overview.cleanup.hint"),
      go: () => navigate("cleanup"),
    },
    {
      key: "files",
      icon: "file",
      title: t("overview.files.title"),
      size: overview.bigFileSize,
      hint: tn("overview.files.hint", overview.bigFileCount),
      go: () => navigate("files"),
    },
    {
      key: "apps",
      icon: "apps",
      title: hasUsage ? t("overview.apps.title") : t("nav.apps"),
      size: appsForCard.reduce((s, a) => s + a.size, 0),
      hint: tn(hasUsage ? "overview.apps.hint" : "overview.apps.hintAll", appsForCard.length),
      go: () => {
        if (hasUsage) setState({ appsSort: "used" });
        navigate("apps");
      },
    },
    {
      key: "downloads",
      icon: "download",
      title: t("overview.downloads.title"),
      size: downloads?.size ?? 0,
      hint: t("overview.downloads.hint"),
      go: () => downloads?.path && openFolder(downloads.path),
    },
  ];
  // Apps, caches and downloads live on the system disk. Another disk has files and folders.
  const cards = disk.system
    ? systemCards
    : [
        systemCards[1],
        {
          key: "downloads",
          icon: "folder",
          title: t("overview.browse.title"),
          size: overview.scanned,
          hint: t("overview.browse.hint"),
          go: () => openFolder(disk.root),
        },
      ];

  return (
    <>
      <Header title={t("nav.overview")}>
        {meta.demo && <span className="pill">{t("overview.demo")}</span>}
        <button type="button" className="btn" onClick={() => void rescan()} disabled={scanning}>
          <Icon name="refresh" size={14} className={scanning ? "spin" : ""} />
          {scanning ? t("scan.scanning") : t("disk.rescan")}
        </button>
      </Header>

      <div className="content">
        {meta.platform === "macos" && disk.system && !meta.fullDiskAccess && !fdaDismissed && (
          <div className="banner">
            <Icon name="info" size={18} />
            <div className="banner-text">
              <b>{t("overview.fda.title")}</b>
              <span>{t("overview.fda.body")}</span>
            </div>
            <button type="button" className="btn" onClick={() => void api.openFullDiskAccess()}>
              {t("overview.fda.button")}
            </button>
            <button type="button" className="icon-btn" title={t("action.dismiss")} onClick={dismissFda}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <section className="hero">
          <div className="hero-top">
            <div>
              <div className="hero-disk">
                <Icon name="disk" size={14} />
                {disk.name}
              </div>
              <div className="hero-free">
                {formatBytes(disk.free)} <span>{t("disk.freeWord")}</span>
              </div>
            </div>
            <div className="hero-used">{t("disk.usedOf", { used: formatBytes(disk.used), total: formatBytes(disk.total) })}</div>
          </div>

          <div className="stack">
            {visible.map((c) => (
              <button
                key={c.id}
                type="button"
                className="seg"
                style={{ flexGrow: c.size, background: colorOf(c) }}
                title={`${labelOf(c)} · ${formatBytes(c.size)}`}
                onClick={() => openCategory(c)}
              />
            ))}
            <span className="seg free" style={{ flexGrow: disk.free }} title={`${t("cat.free")} · ${formatBytes(disk.free)}`} />
          </div>

          <div className="legend">
            {cats.map((c) => {
              const clickable = c.id === "apps" || !!c.path;
              return (
                <button key={c.id} type="button" className="legend-item" disabled={!clickable} onClick={() => openCategory(c)}>
                  <i style={{ background: colorOf(c) }} />
                  <span>{labelOf(c)}</span>
                  <b>{formatBytes(c.size)}</b>
                </button>
              );
            })}
          </div>
        </section>

        <h2 className="section">{t("overview.quick")}</h2>
        <div className={`cards${cards.length < 4 ? " few" : ""}`}>
          {cards.map((card) => (
            <button key={card.key} type="button" className="card" onClick={card.go}>
              <span className={`card-icon card-${card.key}`}>
                <Icon name={card.icon} size={18} />
              </span>
              <span className="card-title">{card.title}</span>
              <span className="card-size">{formatBytes(card.size)}</span>
              <span className="card-hint">{card.hint}</span>
              <Icon name="chevronRight" size={16} className="card-arrow" />
            </button>
          ))}
        </div>

        <h2 className="section">
          {t("overview.folders")} <span>{t(disk.system ? "overview.foldersHint" : "overview.onDisk")}</span>
        </h2>
        <div className="list flush">
          {overview.topFolders.slice(0, 6).map((e) => (
            <button key={e.path} type="button" className="row clickable" onClick={() => openFolder(e.path)}>
              <FileIcon path={e.path} kind={e.kind} size={28} />
              <span className="row-main">
                <span className="row-title">{e.name}</span>
              </span>
              <SizeBar value={e.size} max={maxFolder} />
              <span className="row-size">{formatBytes(e.size)}</span>
              <Icon name="chevronRight" size={15} className="row-arrow" />
            </button>
          ))}
        </div>

        <p className="footnote">
          {t("overview.scanned", {
            count: formatCount(overview.files),
            seconds: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(overview.durationMs / 1000),
          })}
        </p>
      </div>
    </>
  );
}
