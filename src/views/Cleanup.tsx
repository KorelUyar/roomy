import { useState } from "react";
import { TRASH_TOKEN, type CleanGroup, type CleanItem } from "../api";
import { formatBytes } from "../format";
import { formatCount, t } from "../i18n";
import { Icon } from "../icons";
import { emptyTrash, setSelected, setState, toggleSelect, useStore, type SelItem } from "../store";
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
  const loaded = useStore((s) => s.cleanup);
  const pending = useStore((s) => s.pending);
  const selection = useStore((s) => s.selection);
  // What is on its way out is gone from the list at once, and from the sums.
  const groups =
    loaded && pending.size > 0
      ? loaded
          .map((g) => {
            const items = g.items.filter((i) => !pending.has(i.path));
            return items.length === g.items.length ? g : { ...g, items, size: items.reduce((sum, i) => sum + i.size, 0) };
          })
          .filter((g) => g.items.length > 0)
      : loaded;
  const platform = useStore((s) => s.meta?.platform);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const total = (groups ?? []).reduce((s, g) => s + g.size, 0);
  const safeItems = (groups ?? []).filter((g) => g.safety === "safe").flatMap((g) => g.items.map((i) => sel(g, i)));
  const safeSize = safeItems.reduce((sum, i) => sum + i.size, 0);

  // Cache folders are named after bundle ids: show the app's name instead.
  const apps = useStore((s) => s.apps);
  const appNames = new Map((apps ?? []).filter((a) => a.bundleId).map((a) => [a.bundleId!.toLowerCase(), a.name]));
  const label = (name: string) => appNames.get(name.toLowerCase()) ?? name;

  const title = (g: CleanGroup) => (g.id === "trash" && platform === "windows" ? t("cleanup.trash.titleWin") : t(`cleanup.${g.id}.title`));

  return (
    <>
      <Header title={t("nav.cleanup")} subtitle={groups && total > 0 ? t("cleanup.found", { size: formatBytes(total), safe: formatBytes(safeSize) }) : t("cleanup.subtitle")}>
        {/* The short way: everything safe, one question, gone. Once something is ticked, the bar below is the one way. */}
        {safeItems.length > 0 && selection.size === 0 && (
          <button
            type="button"
            className="btn primary"
            data-clean
            onClick={() => {
              setSelected(safeItems, true);
              setState({ confirmOpen: true });
            }}
          >
            <Icon name="cleanup" size={14} />
            {t("cleanup.clean", { size: formatBytes(safeSize) })}
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
                    <span className="card-icon">
                      <Icon name={CLEAN_ICON[g.id]} size={18} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">
                        {title(g)}
                        {/* Safe is the rule here; only the exception gets a word. */}
                        {g.safety === "review" && <span className="tag review">{t("cleanup.review")}</span>}
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
