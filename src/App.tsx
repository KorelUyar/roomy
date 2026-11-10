import { useEffect, useMemo, useState } from "react";
import { api, TRASH_TOKEN, type DeleteRequest, type RelatedItem } from "./api";
import { formatBytes, shortPath } from "./format";
import { formatCount, t, tn } from "./i18n";
import { Icon } from "./icons";
import { runShots } from "./shots";
import {
  clearSelection,
  dismissToast,
  init,
  navigate,
  rescan,
  runDelete,
  selectionSize,
  setState,
  toggleSelect,
  useStore,
  type View,
} from "./store";
import { FileIcon } from "./ui";
import { AppsView } from "./views/Apps";
import { CleanupView } from "./views/Cleanup";
import { FilesView } from "./views/Files";
import { FoldersView } from "./views/Folders";
import { OverviewView } from "./views/Overview";

const NAV: { view: View; icon: string }[] = [
  { view: "overview", icon: "overview" },
  { view: "apps", icon: "apps" },
  { view: "files", icon: "file" },
  { view: "folders", icon: "folder" },
  { view: "cleanup", icon: "cleanup" },
];

function Sidebar() {
  const view = useStore((s) => s.view);
  const disk = useStore((s) => s.disk);
  const apps = useStore((s) => s.apps);
  const cleanup = useStore((s) => s.cleanup);
  const overview = useStore((s) => s.overview);
  const scanning = useStore((s) => s.scan.state === "scanning");

  const hint: Partial<Record<View, number>> = {
    apps: apps?.reduce((s, a) => s + a.size, 0),
    files: overview?.bigFileSize,
    cleanup: cleanup?.reduce((s, g) => s + g.size, 0),
  };
  const usedPct = disk && disk.total > 0 ? (disk.used / disk.total) * 100 : 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-top" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Roomy
        </span>
      </div>
      <nav className="nav">
        {NAV.map((item) => (
          <button key={item.view} type="button" className={`nav-item${view === item.view ? " on" : ""}`} onClick={() => navigate(item.view)}>
            <Icon name={item.icon} size={16} />
            <span>{t(`nav.${item.view}`)}</span>
            {hint[item.view] ? <em>{formatBytes(hint[item.view]!)}</em> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-fill" data-tauri-drag-region />
      {disk && (
        <div className="disk">
          <div className="disk-name">
            <span>{disk.name}</span>
            <button type="button" className="icon-btn" title={t("disk.rescan")} disabled={scanning} onClick={() => void rescan()}>
              <Icon name="refresh" size={13} className={scanning ? "spin" : ""} />
            </button>
          </div>
          <div className="disk-bar">
            <i style={{ width: `${usedPct}%` }} className={usedPct > 90 ? "full" : ""} />
          </div>
          <div className="disk-text">{t("disk.freeOf", { free: formatBytes(disk.free), total: formatBytes(disk.total) })}</div>
        </div>
      )}
    </aside>
  );
}

function SelectionBar() {
  const selection = useStore((s) => s.selection);
  const confirmOpen = useStore((s) => s.confirmOpen);
  const count = confirmOpen ? 0 : selection.size;
  const size = selectionSize(selection);
  const unknown = [...selection.values()].some((i) => i.unknownSize);
  return (
    <div className={`selbar${count > 0 ? " show" : ""}`} aria-hidden={count === 0}>
      <span className="selbar-count">{tn("sel.count", count)}</span>
      {(size > 0 || !unknown) && <span className="selbar-size">{formatBytes(size)}</span>}
      <span className="selbar-space" />
      <button type="button" className="selbar-clear" onClick={clearSelection} tabIndex={count ? 0 : -1}>
        {t("sel.clear")}
      </button>
      <button type="button" className="selbar-delete" onClick={() => setState({ confirmOpen: true })} tabIndex={count ? 0 : -1}>
        <Icon name="trash" size={14} />
        {t("sel.delete")}
      </button>
    </div>
  );
}

function ConfirmDialog() {
  const selection = useStore((s) => s.selection);
  const deleting = useStore((s) => s.deleting);
  const win = useStore((s) => s.meta?.platform === "windows");
  const items = useMemo(() => [...selection.values()].sort((a, b) => b.size - a.size), [selection]);
  const [skipTrash, setSkipTrash] = useState(false);
  const [withData, setWithData] = useState(true);
  const [related, setRelated] = useState<Record<string, RelatedItem[]>>({});

  // What the selected apps left behind in the Library.
  const appPaths = items
    .filter((i) => i.app?.removal === "trash")
    .map((i) => i.path)
    .join("\n");
  useEffect(() => {
    let alive = true;
    for (const path of appPaths ? appPaths.split("\n") : []) {
      void api
        .appRelated(path)
        .then((list) => alive && setRelated((r) => ({ ...r, [path]: list })))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [appPaths]);

  const extras = withData ? items.flatMap((i) => related[i.path] ?? []) : [];
  const allRelated = items.flatMap((i) => related[i.path] ?? []);
  const relatedSize = allRelated.reduce((s, r) => s + r.size, 0);

  const mode = (m: string) => (m === "trash" && skipTrash ? "permanent" : m);
  const toTrash = items.filter((i) => mode(i.mode) === "trash").reduce((s, i) => s + i.size, 0) + (skipTrash ? 0 : extras.reduce((s, r) => s + r.size, 0));
  const forGood = items.filter((i) => mode(i.mode) !== "trash").reduce((s, i) => s + i.size, 0) + (skipTrash ? extras.reduce((s, r) => s + r.size, 0) : 0);
  const hasTrashable = items.some((i) => i.mode === "trash");

  const summary =
    toTrash > 0 && forGood > 0
      ? t(win ? "confirm.mixedBin" : "confirm.mixed", { trash: formatBytes(toTrash), permanent: formatBytes(forGood) })
      : toTrash > 0
        ? t(win ? "confirm.toBin" : "confirm.toTrash", { size: formatBytes(toTrash) })
        : forGood > 0
          ? t("confirm.forGood", { size: formatBytes(forGood) })
          : "";

  const confirm = () => {
    const requests: DeleteRequest[] = items.map((i) => ({
      path: i.path,
      mode: i.path === TRASH_TOKEN ? "emptyTrash" : (mode(i.mode) as DeleteRequest["mode"]),
      cleanup: i.cleanup,
    }));
    for (const extra of extras) requests.push({ path: extra.path, mode: skipTrash ? "permanent" : "trash", cleanup: false });
    void runDelete(requests);
  };

  const close = () => !deleting && setState({ confirmOpen: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <h2>{tn("confirm.title", items.length)}</h2>
        {summary && <p className="dialog-summary">{summary}</p>}

        <div className="dialog-list">
          {items.map((i) => (
            <div className="dialog-item" key={i.path}>
              <FileIcon path={i.icon} kind={i.kind} size={24} name={i.name} />
              <span className="row-main">
                <span className="row-title">{i.name}</span>
                {i.path !== TRASH_TOKEN && <span className="row-sub">{shortPath(i.path)}</span>}
              </span>
              {mode(i.mode) !== "trash" && <span className="tag review">{t("confirm.permanentTag")}</span>}
              {!i.unknownSize && <span className="row-size">{formatBytes(i.size)}</span>}
              <button type="button" className="icon-btn" disabled={!!deleting} title={t("sel.clear")} onClick={() => (items.length === 1 ? clearSelection() : toggleSelect(i))}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>

        {allRelated.length > 0 && (
          <label className="option">
            <input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} disabled={!!deleting} />
            <span>
              <b>{t("confirm.related")}</b>
              <small>{t("confirm.relatedHint", { count: formatCount(allRelated.length), size: formatBytes(relatedSize) })}</small>
            </span>
          </label>
        )}
        {hasTrashable && (
          <label className="option">
            <input type="checkbox" checked={skipTrash} onChange={(e) => setSkipTrash(e.target.checked)} disabled={!!deleting} />
            <span>
              <b>{t("confirm.skipTrash")}</b>
              <small>{t("confirm.skipTrashHint")}</small>
            </span>
          </label>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn large" onClick={close} disabled={!!deleting}>
            {t("confirm.cancel")}
          </button>
          <button type="button" className="btn large danger" onClick={confirm} disabled={!!deleting} autoFocus>
            {deleting
              ? t("confirm.working", { done: Math.min(deleting.done + 1, deleting.total), total: deleting.total })
              : forGood > 0 || toTrash === 0
                ? t("confirm.delete")
                : t(win ? "confirm.bin" : "confirm.trash")}
          </button>
        </div>
        {deleting && (
          <div className="dialog-progress">
            <i style={{ width: `${(deleting.done / Math.max(1, deleting.total)) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <Icon name={toast.tone === "ok" ? "check" : "info"} size={14} stroke={2.4} />
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                dismissToast(toast.id);
                toast.action!.run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const ready = useStore((s) => s.meta !== null);
  const view = useStore((s) => s.view);
  const confirmOpen = useStore((s) => s.confirmOpen);
  const hasSelection = useStore((s) => s.selection.size > 0);

  useEffect(() => {
    void init().then(runShots);
  }, []);

  // Screenshots outside the desktop app draw their own window frame.
  const frame = document.documentElement.dataset.frame;

  if (!ready) return <div className="app" />;

  return (
    <>
      {frame === "windows" && (
        <div className="wintitle">
          <span className="wintitle-name">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Roomy
          </span>
          <b>&#x2500;</b>
          <b>&#x25A1;</b>
          <b>&#x2715;</b>
        </div>
      )}
      <div className="app">
        {frame === "macos" && (
          <div className="lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
      <Sidebar />
      <main className={`main${hasSelection ? " has-selection" : ""}`}>
        {view === "overview" && <OverviewView />}
        {view === "apps" && <AppsView />}
        {view === "files" && <FilesView />}
        {view === "folders" && <FoldersView />}
        {view === "cleanup" && <CleanupView />}
        <SelectionBar />
        <Toasts />
      </main>
      {confirmOpen && hasSelection && <ConfirmDialog />}
      </div>
    </>
  );
}
