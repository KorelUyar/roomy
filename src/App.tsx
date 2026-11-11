import { Fragment, useEffect, useMemo, useState } from "react";
import { api, TRASH_TOKEN, type DeleteRequest, type RelatedItem } from "./api";
import { fixableByDefault, flaggedStartup, harmful, openThreats, securityToCheck, type Issue } from "./findings";
import { formatBytes, formatPercent, shortPath } from "./format";
import { formatCount, t, tn, tx } from "./i18n";
import { Icon } from "./icons";
import { runShots } from "./shots";
import {
  cancelDelete,
  chooseLanguage,
  clearSelection,
  dismissToast,
  fixIssues,
  init,
  navigate,
  queueDelete,
  rescan,
  selectDisk,
  selectionSize,
  setState,
  toggleSelect,
  useStore,
  type Outgoing,
  type View,
} from "./store";
import type { Lang } from "./i18n";
import { Checkbox, FileIcon, Ring } from "./ui";
import { AppsView } from "./views/Apps";
import { BloatView } from "./views/Bloat";
import { CleanupView } from "./views/Cleanup";
import { FilesView } from "./views/Files";
import { FoldersView } from "./views/Folders";
import { HealthView } from "./views/Health";
import { OverviewView } from "./views/Overview";
import { ProtectionView } from "./views/Protection";

// How the computer is doing, what takes up space, and what should not be there.
const NAV: { view: View; icon: string }[][] = [
  [{ view: "health", icon: "pulse" }],
  [
    { view: "overview", icon: "overview" },
    { view: "cleanup", icon: "cleanup" },
    { view: "files", icon: "file" },
    { view: "folders", icon: "folder" },
    { view: "apps", icon: "apps" },
  ],
  [
    { view: "protection", icon: "shield" },
    { view: "bloat", icon: "bloat" },
  ],
];

const CHECK_STEPS = ["security", "startup", "software", "malware"];

/** "51.9" for "51.9 GB of 60.4 GB": the unit is said once when both sides have the same. */
function sameUnit(part: number, whole: number): string {
  const [number, unit] = formatBytes(part).split(" ");
  return formatBytes(whole).endsWith(` ${unit}`) ? number : `${number} ${unit}`;
}

/**
 * What Roomy is doing in the background, in the corner of the window: a ring
 * that fills up while things are deleted or fixed, an arc that turns while a
 * scan runs. Nothing here has to be waited for.
 */
function Activity() {
  const deleting = useStore((s) => s.deleting);
  const fixing = useStore((s) => s.fixing);
  const fixingOne = useStore((s) => s.fixingOne);
  const check = useStore((s) => s.check);
  const malware = useStore((s) => s.malware);
  const scanning = malware?.state === "scanning";
  if (!deleting && !fixing && !fixingOne && !check.running && !scanning) return null;

  const share = deleting ? (deleting.bytesTotal > 0 ? deleting.bytesDone / deleting.bytesTotal : deleting.done / Math.max(1, deleting.total)) : 0;
  return (
    <div className="activity" aria-live="polite">
      {deleting && (
        <div className={`activity-row${deleting.finished ? " done" : ""}`} data-activity="delete">
          <Ring value={deleting.finished ? 1 : share} size={40} tone={deleting.finished ? "ok" : "danger"}>
            <Icon name={deleting.finished ? "check" : "trash"} size={17} stroke={deleting.finished ? 2.8 : 1.9} />
          </Ring>
          <span className="activity-text">
            <b>{deleting.finished ? t("activity.deleted") : t("activity.deleting", { percent: formatPercent(share * 100) })}</b>
            <span>
              {deleting.bytesTotal > 0
                ? t("activity.bytes", { done: sameUnit(deleting.bytesDone, deleting.bytesTotal), total: formatBytes(deleting.bytesTotal) })
                : t("activity.of", { done: formatCount(deleting.done), total: formatCount(deleting.total) })}
            </span>
          </span>
          {!deleting.finished && deleting.total - deleting.done > 1 && (
            <button type="button" className="icon-btn" title={t("activity.stop")} onClick={cancelDelete}>
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      )}
      {fixing && (
        <div className={`activity-row${fixing.finished ? " done" : ""}`} data-activity="fix">
          <Ring value={fixing.finished ? 1 : fixing.done / Math.max(1, fixing.total)} size={40} tone={fixing.finished ? "ok" : ""}>
            <Icon name={fixing.finished ? "check" : "shield"} size={17} stroke={fixing.finished ? 2.8 : 1.9} />
          </Ring>
          <span className="activity-text">
            <b>{t(fixing.finished ? "activity.fixed" : "activity.fixing")}</b>
            <span>{t("activity.of", { done: formatCount(fixing.done), total: formatCount(fixing.total) })}</span>
          </span>
        </div>
      )}
      {fixingOne && !fixing && (
        // One finding, by its own button: no telling how far it is, only that it is under way.
        <div className="activity-row" data-activity="fix-one">
          <Ring value={null} size={40}>
            <Icon name="shield" size={17} stroke={1.9} />
          </Ring>
          <span className="activity-text">
            <b>{t("activity.fixing")}</b>
            <span>{fixingOne.name}</span>
          </span>
        </div>
      )}
      {(check.running || scanning) && (
        <div className="activity-row" data-activity="scan">
          <Ring value={null} size={40}>
            <Icon name="shieldPlain" size={17} stroke={1.9} />
          </Ring>
          <span className="activity-text">
            {/* Which scan it is: the check-up with its step, or a malware scan someone asked for. */}
            <b>{t(check.running ? "activity.checkup" : "activity.scanning")}</b>
            <span>
              {scanning
                ? malware!.engine.engine === "defender"
                  ? "Microsoft Defender"
                  : `${check.running ? `${tx("health.step.malware")}  ·  ` : ""}${t("scan.files", { count: formatCount(malware!.files) })}`
                : tx(`health.step.${CHECK_STEPS[Math.min(check.step, 3)]}`)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const view = useStore((s) => s.view);
  const disks = useStore((s) => s.disks);
  const diskRoot = useStore((s) => s.diskRoot);
  const scans = useStore((s) => s.scans);
  const overviews = useStore((s) => s.overviews);
  const bloat = useStore((s) => s.bloat);
  const malware = useStore((s) => s.malware);
  const intended = useStore((s) => s.intended);
  const demo = useStore((s) => s.meta?.demo);
  const lang = useStore((s) => s.lang);
  // A disk is "the one being looked at" only where a tab is about one disk.
  const diskTab = view === "overview" || view === "files" || view === "folders";

  // A dot where something wants to be looked at.
  const attention: Partial<Record<View, boolean>> = {
    protection: openThreats(malware).length > 0 || securityToCheck(bloat, intended).length > 0 || harmful(bloat).length > 0 || flaggedStartup(bloat).length > 0,
  };

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
        {demo && <span className="pill">{t("overview.demo")}</span>}
      </div>
      <nav className="nav">
        {NAV.map((group, i) => (
          <Fragment key={group[0].view}>
            {i > 0 && <span className="nav-gap" />}
            {group.map((item) => (
              <button key={item.view} type="button" data-view={item.view} className={`nav-item${view === item.view ? " on" : ""}`} onClick={() => navigate(item.view)}>
                <Icon name={item.icon} size={16} />
                <span>{t(`nav.${item.view}`)}</span>
                {attention[item.view] && <i className="nav-dot" title={t("nav.attention")} />}
              </button>
            ))}
          </Fragment>
        ))}
      </nav>
      <div className="sidebar-fill" data-tauri-drag-region />

      {disks.length > 1 && <div className="side-label">{t("disks.title")}</div>}
      <div className="disks">
        {disks.map((d) => {
          // Fresh numbers from the last scan when there is one.
          const disk = overviews[d.root]?.disk ?? d;
          const scanning = scans[d.root]?.state === "scanning";
          const selected = d.root === diskRoot;
          const usedPct = disk.total > 0 ? (disk.used / disk.total) * 100 : 0;
          return (
            <div key={d.root} className={`disk${selected && diskTab ? " on" : ""}${disks.length > 1 ? " pick" : ""}`} onClick={() => selectDisk(d.root)}>
              <div className="disk-name">
                <Icon name={d.system ? "disk" : "external"} size={13} />
                <span>{disk.name}</span>
                {selected && (
                  <button
                    type="button"
                    className="icon-btn"
                    title={t("disk.rescan")}
                    disabled={scanning}
                    onClick={(e) => {
                      e.stopPropagation();
                      void rescan();
                    }}
                  >
                    <Icon name="refresh" size={13} className={scanning ? "spin" : ""} />
                  </button>
                )}
              </div>
              <div className="disk-bar">
                <i style={{ width: `${usedPct}%` }} className={usedPct > 90 ? "full" : ""} />
              </div>
              <div className="disk-text">{scanning && !selected ? t("disks.scanning") : t("disk.freeOf", { free: formatBytes(disk.free), total: formatBytes(disk.total) })}</div>
            </div>
          );
        })}
      </div>

      <Activity />

      <label className="lang" title={t("lang.label")}>
        <Icon name="globe" size={13} />
        <select value={lang} onChange={(e) => chooseLanguage(e.target.value as Lang)} aria-label={t("lang.label")}>
          <option value="en">{t("lang.en")}</option>
          <option value="de">{t("lang.de")}</option>
        </select>
      </label>
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
      <button
        type="button"
        className="selbar-delete"
        tabIndex={count ? 0 : -1}
        onClick={(e) => {
          // The bar slides away; a button that keeps the focus would be scrolled after.
          e.currentTarget.blur();
          setState({ confirmOpen: true });
        }}
      >
        <Icon name="trash" size={14} />
        {t("sel.delete")}
      </button>
    </div>
  );
}

function ConfirmDialog() {
  const selection = useStore((s) => s.selection);
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

  // Yes means go: the dialog closes at once and the work carries on in the corner.
  const confirm = () => {
    const out: Outgoing[] = items.map((i) => ({
      request: { path: i.path, mode: i.path === TRASH_TOKEN ? "emptyTrash" : (mode(i.mode) as DeleteRequest["mode"]), cleanup: i.cleanup },
      size: i.size,
    }));
    for (const extra of extras) out.push({ request: { path: extra.path, mode: skipTrash ? "permanent" : "trash", cleanup: false }, size: extra.size });
    queueDelete(out);
  };

  const close = () => setState({ confirmOpen: false });
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
              <button type="button" className="icon-btn" title={t("sel.clear")} onClick={() => (items.length === 1 ? clearSelection() : toggleSelect(i))}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>

        {allRelated.length > 0 && (
          <label className="option">
            <input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} />
            <span>
              <b>{t("confirm.related")}</b>
              <small>{t("confirm.relatedHint", { count: formatCount(allRelated.length), size: formatBytes(relatedSize) })}</small>
            </span>
          </label>
        )}
        {hasTrashable && (
          <label className="option">
            <input type="checkbox" checked={skipTrash} onChange={(e) => setSkipTrash(e.target.checked)} />
            <span>
              <b>{t("confirm.skipTrash")}</b>
              <small>{t("confirm.skipTrashHint")}</small>
            </span>
          </label>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn large" onClick={close}>
            {t("confirm.cancel")}
          </button>
          <button type="button" className="btn large danger" onClick={confirm} autoFocus>
            {forGood > 0 || toTrash === 0 ? t("confirm.delete") : t(win ? "confirm.bin" : "confirm.trash")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One yes for what a scan found and Roomy can fix by itself. Every line says
 * what will happen to it and can be unticked. What cannot be taken back
 * starts out unticked.
 */
function FixDialog({ issues }: { issues: Issue[] }) {
  const win = useStore((s) => s.meta?.platform === "windows");
  const auto = issues.filter((i) => i.fix === "auto");
  const manual = issues.length - auto.length;
  // Asked about by the button in its own row, a finding is ticked whatever it is.
  const [chosen, setChosen] = useState(() => new Set((auto.length === 1 ? auto : fixableByDefault(auto)).map((i) => i.id)));
  const picked = auto.filter((i) => chosen.has(i.id));
  const untouched = auto.filter((i) => i.optional && !chosen.has(i.id)).length;
  const close = () => setState({ fixAsk: null });
  const tick = (id: string) => {
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    setChosen(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide" role="dialog" aria-modal="true">
        <h2>{picked.length > 0 ? tn("fix.ask.title", picked.length) : t("fix.ask.none")}</h2>
        <p className="dialog-summary">{t(win ? "fix.ask.summary.win" : "fix.ask.summary.mac")}</p>
        <div className="dialog-list">
          {auto.map((i) => (
            <div className={`dialog-item${chosen.has(i.id) ? "" : " off"}`} key={i.id} data-fix-item={i.optional ? "optional" : "default"} onClick={() => tick(i.id)}>
              <Checkbox checked={chosen.has(i.id)} onChange={() => tick(i.id)} />
              {i.icon ? (
                <FileIcon path={i.icon} kind="app" size={24} name={i.name} />
              ) : (
                <span className="tile tile-other" style={{ width: 24, height: 24, borderRadius: 7 }}>
                  <Icon name={i.kind === "startup" ? "power" : "shieldAlert"} size={13} stroke={1.8} />
                </span>
              )}
              <span className="row-main">
                {/* Microsoft Defender's findings are one line: who removes them, and what they are. */}
                <span className="row-title">{i.defender ? "Microsoft Defender" : i.name}</span>
                {/* A file is told apart from another of the same name by where it is. */}
                <span className="row-sub">{[i.kind === "startup" ? t("health.startup") : null, i.tag, i.threat ? i.detail : null].filter(Boolean).join("  ·  ") || i.detail}</span>
              </span>
              <span className={`dialog-does${i.optional ? " for-good" : ""}`}>{i.does}</span>
            </div>
          ))}
        </div>
        {untouched > 0 && <p className="dialog-note">{tn("fix.ask.optional", untouched)}</p>}
        {manual > 0 && <p className="dialog-note">{tn("fix.ask.manual", manual)}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn large" onClick={close}>
            {t("confirm.cancel")}
          </button>
          <button type="button" className="btn large primary" data-fix-go disabled={picked.length === 0} onClick={() => void fixIssues(picked)} autoFocus>
            {tn("fix.all", Math.max(1, picked.length))}
          </button>
        </div>
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
  const fixAsk = useStore((s) => s.fixAsk);
  const hasSelection = useStore((s) => s.selection.size > 0);
  // A new language rebuilds everything on screen.
  const lang = useStore((s) => s.lang);

  useEffect(() => {
    void init().then(runShots);
  }, []);

  // Something is ticked: the Delete key asks the question the red button asks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      // Not while another question is open: its answer must not land on this one.
      if ((e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) && !typing && hasSelection && !confirmOpen && !fixAsk) {
        e.preventDefault();
        setState({ confirmOpen: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection, confirmOpen, fixAsk]);

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
      <div className="app" key={lang}>
        {frame === "macos" && (
          <div className="lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
        <Sidebar />
        <main className={`main${hasSelection ? " has-selection" : ""}`}>
          {view === "health" && <HealthView />}
          {view === "overview" && <OverviewView />}
          {view === "apps" && <AppsView />}
          {view === "files" && <FilesView />}
          {view === "folders" && <FoldersView />}
          {view === "cleanup" && <CleanupView />}
          {view === "protection" && <ProtectionView />}
          {view === "bloat" && <BloatView />}
          <SelectionBar />
          <Toasts />
        </main>
        {confirmOpen && hasSelection && <ConfirmDialog />}
        {fixAsk && <FixDialog issues={fixAsk} />}
      </div>
    </>
  );
}
