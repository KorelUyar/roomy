import { useMemo, useState } from "react";
import { api, type AppInfo } from "../api";
import { formatAgo, formatBytes } from "../format";
import { formatCount, t } from "../i18n";
import { Icon } from "../icons";
import { refreshLists, setState, tickRow, toast, useStore, type SelItem } from "../store";
import { Checkbox, Empty, FileIcon, Header, Segmented, SizeBar, Skeleton } from "../ui";

function selItem(app: AppInfo): SelItem {
  return { path: app.path, name: app.name, size: app.size, kind: "app", mode: "trash", cleanup: false, icon: app.icon || null, app };
}

function detail(app: AppInfo): string {
  const parts: string[] = [];
  if (app.publisher) parts.push(app.publisher);
  if (app.version) parts.push(t("apps.version", { version: app.version }));
  if (app.removal === "trash") parts.push(app.lastUsed ? t("apps.lastUsed", { when: formatAgo(app.lastUsed) }) : t("apps.neverUsed"));
  else if (app.installed) parts.push(t("apps.installed", { when: formatAgo(app.installed) }));
  return parts.join("  ·  ");
}

export function AppsView() {
  const apps = useStore((s) => s.apps);
  const sort = useStore((s) => s.appsSort);
  const selection = useStore((s) => s.selection);
  const pending = useStore((s) => s.pending);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // What is on its way out is gone from the list at once.
    const list = (apps ?? []).filter((a) => !pending.has(a.path) && (!q || a.name.toLowerCase().includes(q) || (a.publisher ?? "").toLowerCase().includes(q)));
    const byName = (a: AppInfo, b: AppInfo) => a.name.localeCompare(b.name);
    if (sort === "name") list.sort(byName);
    // Longest unused first; apps that were never opened lead the list.
    else if (sort === "used") list.sort((a, b) => (a.lastUsed ?? a.installed ?? 0) - (b.lastUsed ?? b.installed ?? 0) || b.size - a.size);
    else list.sort((a, b) => b.size - a.size || byName(a, b));
    return list;
  }, [apps, query, sort, pending]);
  // The rows that can be ticked, in the order they are shown (for ticking a stretch with Shift).
  const tickable = useMemo(() => shown.filter((a) => a.removal === "trash" && !a.running).map(selItem), [shown]);

  // Windows does not record when a program was last started.
  const hasUsage = (apps ?? []).some((a) => a.removal === "trash");
  const total = (apps ?? []).reduce((s, a) => s + a.size, 0);
  const max = (apps ?? []).reduce((m, a) => Math.max(m, a.size), 0);

  const uninstall = async (app: AppInfo) => {
    try {
      await api.uninstallApp(app.id);
      toast(t("apps.uninstallStarted", { name: app.name }));
      // The list is reloaded when the window gets the focus back.
      window.addEventListener("focus", () => void refreshLists(), { once: true });
    } catch (error) {
      toast(t("toast.error", { error: String(error) }), "warn");
    }
  };

  return (
    <>
      <Header title={t("nav.apps")} subtitle={apps ? t("apps.subtitle", { count: formatCount(apps.length), size: formatBytes(total) }) : undefined}>
        <label className="search">
          <Icon name="search" size={14} />
          <input type="search" value={query} placeholder={t("apps.search")} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        </label>
        <Segmented
          value={sort}
          onChange={(appsSort) => setState({ appsSort })}
          options={[
            { value: "size", label: t("apps.sort.size") },
            { value: "used", label: t(hasUsage ? "apps.sort.used" : "apps.sort.installed") },
            { value: "name", label: t("apps.sort.name") },
          ]}
        />
      </Header>

      <div className="content">
        {!apps ? (
          <Skeleton />
        ) : shown.length === 0 ? (
          <Empty icon="apps" title={t("apps.empty")} />
        ) : (
          <div className="list">
            {shown.map((app) => {
              const selected = selection.has(app.path);
              const selectable = app.removal === "trash" && !app.running;
              const index = tickable.findIndex((x) => x.path === app.path);
              return (
                <div
                  key={app.id}
                  className={`row tall${selected ? " selected" : ""}${selectable ? " clickable" : ""}`}
                  onClick={(e) => selectable && tickRow("apps", tickable, index, e.shiftKey)}
                >
                  {app.removal === "trash" && (
                    <Checkbox checked={selected} locked={app.running} title={app.running ? t("apps.runningHint") : undefined} onChange={(shift) => tickRow("apps", tickable, index, shift)} />
                  )}
                  <FileIcon path={app.icon || null} kind="app" size={36} name={app.name} />
                  <span className="row-main">
                    <span className="row-title">
                      {app.name}
                      {app.running && <span className="tag live">{t("apps.running")}</span>}
                    </span>
                    <span className="row-sub">{detail(app)}</span>
                  </span>
                  <SizeBar value={app.size} max={max} />
                  <span className="row-size">{formatBytes(app.size)}</span>
                  {app.removal === "uninstaller" && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={(e) => {
                        e.stopPropagation();
                        void uninstall(app);
                      }}
                    >
                      {t("apps.uninstall")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
