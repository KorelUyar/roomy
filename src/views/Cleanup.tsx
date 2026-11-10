import { useState } from "react";
import { TRASH_TOKEN, type CleanGroup, type CleanItem } from "../api";
import { formatBytes } from "../format";
import { formatCount, t } from "../i18n";
import { Icon } from "../icons";
import { emptyTrash, setSelected, toggleSelect, useStore, type SelItem } from "../store";
import { CLEAN_ICON } from "../theme";
import { Checkbox, Empty, Header, Skeleton } from "../ui";

function sel(group: CleanGroup, item: CleanItem): SelItem {
  return {
    path: item.path,
    name: item.name,
    size: item.size,
    kind: item.kind,
    mode: group.mode,
    // Caches & co. live inside folders that are otherwise off-limits.
    cleanup: group.mode !== "trash",
    icon: item.path === TRASH_TOKEN ? null : item.path,
    unknownSize: group.unknown,
  };
}

export function CleanupView() {
  const groups = useStore((s) => s.cleanup);
  const selection = useStore((s) => s.selection);
  const platform = useStore((s) => s.meta?.platform);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const total = (groups ?? []).reduce((s, g) => s + g.size, 0);
  const safeItems = (groups ?? []).filter((g) => g.safety === "safe").flatMap((g) => g.items.map((i) => sel(g, i)));
  const allSafeSelected = safeItems.length > 0 && safeItems.every((i) => selection.has(i.path));

  // Cache folders are named after bundle ids: show the app's name instead.
  const apps = useStore((s) => s.apps);
  const appNames = new Map((apps ?? []).filter((a) => a.bundleId).map((a) => [a.bundleId!.toLowerCase(), a.name]));
  const label = (name: string) => appNames.get(name.toLowerCase()) ?? name;

  const title = (g: CleanGroup) => (g.id === "trash" && platform === "windows" ? t("cleanup.trash.titleWin") : t(`cleanup.${g.id}.title`));

  return (
    <>
      <Header title={t("nav.cleanup")} subtitle={groups && total > 0 ? t("cleanup.total", { size: formatBytes(total) }) : t("cleanup.subtitle")}>
        {safeItems.length > 0 && (
          <button type="button" className="btn" onClick={() => setSelected(safeItems, !allSafeSelected)}>
            <Icon name="shield" size={14} />
            {allSafeSelected ? t("sel.clear") : t("cleanup.selectSafe")}
          </button>
        )}
      </Header>

      <div className="content">
        {!groups ? (
          <Skeleton rows={5} />
        ) : groups.length === 0 ? (
          <Empty icon="cleanup" title={t("cleanup.empty.title")} body={t("cleanup.empty.body")} />
        ) : (
          <div className="groups">
            {groups.map((g) => {
              const items = g.items.map((i) => ({ ...sel(g, i), name: label(i.name) }));
              const picked = items.filter((i) => selection.has(i.path)).length;
              const expanded = open.has(g.id);
              const single = g.items.length === 1 && g.items[0].path === TRASH_TOKEN;
              const toggleOpen = () => {
                const next = new Set(open);
                if (expanded) next.delete(g.id);
                else next.add(g.id);
                setOpen(next);
              };
              return (
                <section key={g.id} className={`group${picked > 0 ? " picked" : ""}`}>
                  <div className="group-head" onClick={() => (single ? undefined : toggleOpen())}>
                    {g.unknown ? (
                      <span className="check-space" />
                    ) : (
                      <Checkbox checked={picked === items.length} mixed={picked > 0 && picked < items.length} onChange={() => setSelected(items, picked !== items.length)} />
                    )}
                    <span className={`card-icon clean-${g.safety}`}>
                      <Icon name={CLEAN_ICON[g.id]} size={18} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">
                        {title(g)}
                        <span className={`tag ${g.safety}`}>{t(g.safety === "safe" ? "cleanup.safe" : "cleanup.review")}</span>
                      </span>
                      <span className="row-sub">{g.unknown ? t("cleanup.trash.unknown") : t(`cleanup.${g.id}.desc`)}</span>
                    </span>
                    {g.unknown ? (
                      <button
                        type="button"
                        className="btn small"
                        onClick={(e) => {
                          e.stopPropagation();
                          void emptyTrash();
                        }}
                      >
                        {t("cleanup.trash.empty")}
                      </button>
                    ) : (
                      <>
                        {!single && <span className="group-count">{t("cleanup.items", { count: formatCount(g.items.length) })}</span>}
                        <span className="row-size">{formatBytes(g.size)}</span>
                        <Icon name="chevronDown" size={16} className={`group-arrow${expanded ? " open" : ""}${single ? " hidden" : ""}`} />
                      </>
                    )}
                  </div>
                  {expanded && !single && (
                    <div className="group-items">
                      {items.map((item) => {
                        const selected = selection.has(item.path);
                        return (
                          <div key={item.path} className={`row compact clickable${selected ? " selected" : ""}`} onClick={() => toggleSelect(item)}>
                            <Checkbox checked={selected} onChange={() => toggleSelect(item)} />
                            <span className="row-main">
                              <span className="row-title">{item.name}</span>
                            </span>
                            <span className="row-size">{formatBytes(item.size)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
