import { useEffect, useState } from "react";
import { api, type Entry } from "../api";
import { crumbs, formatBytes, parentPath } from "../format";
import { formatCount, t } from "../i18n";
import { Icon } from "../icons";
import { openFolder, toggleSelect, useStore } from "../store";
import { Checkbox, Empty, FileIcon, Header, Skeleton, SizeBar } from "../ui";
import { entryToSel } from "./Files";

const PAGE = 200;

export function FoldersView() {
  const meta = useStore((s) => s.meta)!;
  const path = useStore((s) => s.folderPath);
  const version = useStore((s) => s.version);
  const scanned = useStore((s) => s.overview !== null);
  const diskName = useStore((s) => s.disk?.name ?? "");
  const diskRoot = useStore((s) => s.diskRoot);
  const onSystemDisk = useStore((s) => s.disk?.system ?? true);
  const selection = useStore((s) => s.selection);
  const [data, setData] = useState<{ path: string; entries: Entry[] } | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!scanned) return;
    let alive = true;
    api
      .listDir(path)
      .then((entries) => alive && setData({ path, entries }))
      .catch(() => alive && setData({ path, entries: [] }));
    return () => {
      alive = false;
    };
  }, [path, version, scanned]);

  useEffect(() => setShowAll(false), [path]);

  // While another folder loads, do not show the old rows under the new path.
  const stale = !data || data.path !== path;
  const entries = stale ? null : data.entries;

  const trail = crumbs(path, diskRoot);
  const up = parentPath(path, diskRoot);
  const total = (entries ?? []).reduce((s, e) => s + e.size, 0);
  const max = entries?.[0]?.size ?? 0;
  const shown = showAll ? (entries ?? []) : (entries ?? []).slice(0, PAGE);
  const reveal = t(meta.platform === "windows" ? "action.reveal.win" : "action.reveal.mac");

  return (
    <>
      <Header title={t("nav.folders")} subtitle={entries ? `${t("folders.items", { count: formatCount(entries.length) })} · ${formatBytes(total)}` : undefined}>
        {onSystemDisk && (
          <button type="button" className={`chip${path === meta.home ? " on" : ""}`} onClick={() => openFolder(meta.home)}>
            <Icon name="home" size={13} />
            {t("folders.home")}
          </button>
        )}
        <button type="button" className={`chip${path === diskRoot ? " on" : ""}`} onClick={() => openFolder(diskRoot)}>
          <Icon name="disk" size={13} />
          {t("folders.disk")}
        </button>
      </Header>

      <nav className="crumbs">
        <button type="button" className="icon-btn" disabled={!up} title={t("folders.back")} onClick={() => up && openFolder(up)}>
          <Icon name="chevronLeft" size={16} />
        </button>
        {trail.map((c, i) => (
          <span key={c.path} className="crumb-wrap">
            {i > 0 && <Icon name="chevronRight" size={12} className="crumb-sep" />}
            <button type="button" className={`crumb${i === trail.length - 1 ? " current" : ""}`} onClick={() => openFolder(c.path)}>
              {c.name ?? diskName}
            </button>
          </span>
        ))}
      </nav>

      <div className="content">
        {!scanned ? (
          <>
            <p className="waiting">{t("scan.waiting")}</p>
            <Skeleton />
          </>
        ) : !entries ? (
          <Skeleton />
        ) : entries.length === 0 ? (
          <Empty icon="folder" title={t("folders.empty")} />
        ) : (
          <div className="list">
            {shown.map((e) => {
              const selected = selection.has(e.path);
              const browsable = e.isDir && !e.package && !e.denied;
              const activate = () => (browsable ? openFolder(e.path) : !e.protected && toggleSelect(entryToSel(e)));
              return (
                <div key={e.path} className={`row clickable${selected ? " selected" : ""}`} onClick={activate}>
                  <Checkbox checked={selected} locked={e.protected} title={e.protected ? t("folders.protected") : undefined} onChange={() => toggleSelect(entryToSel(e))} />
                  <FileIcon path={e.path} kind={e.kind} size={28} />
                  <span className="row-main">
                    <span className="row-title">{e.name}</span>
                    {e.denied ? (
                      <span className="row-sub">{t("folders.denied")}</span>
                    ) : e.isDir && !e.package ? (
                      <span className="row-sub">{t("folders.files", { count: formatCount(e.files) })}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="icon-btn row-action"
                    title={reveal}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void api.reveal(e.path);
                    }}
                  >
                    <Icon name="reveal" size={14} />
                  </button>
                  <SizeBar value={e.size} max={max} />
                  <span className="row-size">{formatBytes(e.size)}</span>
                  <Icon name="chevronRight" size={15} className={`row-arrow${browsable ? "" : " hidden"}`} />
                </div>
              );
            })}
            {!showAll && entries.length > PAGE && (
              <button type="button" className="more" onClick={() => setShowAll(true)}>
                {t("folders.showAll", { count: formatCount(entries.length) })}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
