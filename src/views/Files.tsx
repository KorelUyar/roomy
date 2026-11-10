import { useEffect, useMemo, useState } from "react";
import { api, type Entry, type Kind } from "../api";
import { formatAgo, formatBytes, shortPath } from "../format";
import { formatCount, t } from "../i18n";
import { Icon } from "../icons";
import { toggleSelect, useStore, type SelItem } from "../store";
import { Checkbox, Empty, FileIcon, Header, Skeleton, SizeBar } from "../ui";

type Filter = "all" | "video" | "image" | "audio" | "archive" | "diskimage" | "document" | "other";

const FILTERS: Filter[] = ["all", "video", "image", "audio", "archive", "diskimage", "document", "other"];

function bucket(kind: Kind): Filter {
  switch (kind) {
    case "video":
    case "image":
    case "audio":
    case "archive":
    case "document":
      return kind;
    case "diskimage":
    case "installer":
      return "diskimage";
    default:
      return "other";
  }
}

export function entryToSel(e: Entry): SelItem {
  return { path: e.path, name: e.name, size: e.size, kind: e.kind, mode: "trash", cleanup: false, icon: e.path };
}

const PAGE = 150;

export function FilesView() {
  const version = useStore((s) => s.version);
  const scanned = useStore((s) => s.overview !== null);
  const selection = useStore((s) => s.selection);
  const platform = useStore((s) => s.meta?.platform);
  const [files, setFiles] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [appData, setAppData] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (!scanned) return;
    let alive = true;
    void api.largeFiles(0, 3000).then((list) => alive && setFiles(list));
    return () => {
      alive = false;
    };
  }, [version, scanned]);

  const base = useMemo(() => (files ?? []).filter((f) => appData || !f.appData), [files, appData]);
  const present = useMemo(() => new Set(base.map((f) => bucket(f.kind))), [base]);
  const shown = useMemo(() => base.filter((f) => filter === "all" || bucket(f.kind) === filter), [base, filter]);
  const total = shown.reduce((s, f) => s + f.size, 0);
  const max = shown[0]?.size ?? 0;
  const hasAppData = (files ?? []).some((f) => f.appData);

  return (
    <>
      <Header
        title={t("nav.files")}
        subtitle={files ? t("files.subtitle", { count: formatCount(shown.length), size: formatBytes(total) }) : undefined}
      >
        {hasAppData && (
          <label className="switch" title={t("files.appDataHint")}>
            <input type="checkbox" checked={appData} onChange={(e) => setAppData(e.target.checked)} />
            <i />
            {t("files.appData")}
          </label>
        )}
      </Header>

      <div className="chips">
        {FILTERS.filter((f) => f === "all" || present.has(f)).map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${filter === f ? " on" : ""}`}
            onClick={() => {
              setFilter(f);
              setLimit(PAGE);
            }}
          >
            {t(`files.kind.${f}`)}
          </button>
        ))}
      </div>

      <div className="content">
        {!scanned ? (
          <>
            <p className="waiting">{t("scan.waiting")}</p>
            <Skeleton />
          </>
        ) : !files ? (
          <Skeleton />
        ) : shown.length === 0 ? (
          <Empty icon="file" title={t("files.empty")} />
        ) : (
          <div className="list">
            {shown.slice(0, limit).map((file) => {
              const selected = selection.has(file.path);
              return (
                <div key={file.path} className={`row tall clickable${selected ? " selected" : ""}`} onClick={() => toggleSelect(entryToSel(file))}>
                  <Checkbox checked={selected} onChange={() => toggleSelect(entryToSel(file))} />
                  <FileIcon path={file.path} kind={file.kind} size={34} />
                  <span className="row-main">
                    <span className="row-title">{file.name}</span>
                    <span className="row-sub">
                      {shortPath(file.parent)}
                      {file.modified > 0 && `  ·  ${formatAgo(file.modified)}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="icon-btn row-action"
                    title={t(platform === "windows" ? "action.reveal.win" : "action.reveal.mac")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.reveal(file.path);
                    }}
                  >
                    <Icon name="reveal" size={14} />
                  </button>
                  <SizeBar value={file.size} max={max} />
                  <span className="row-size">{formatBytes(file.size)}</span>
                </div>
              );
            })}
            {shown.length > limit && (
              <button type="button" className="more" onClick={() => setLimit(limit + PAGE * 2)}>
                {t("files.more")}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
