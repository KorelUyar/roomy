import { useState } from "react";
import { api, type StartupItem, type Unwanted } from "../api";
import { formatBytes, shortPath } from "../format";
import { formatCount, t } from "../i18n";
import { Icon } from "../icons";
import { refreshBloat, refreshLists, scanBloat, setSelected, setState, toast, useStore, type SelItem } from "../store";
import { FileIcon, Header } from "../ui";

const STEPS = ["software", "startup", "processes"] as const;
const FIRST = 10;

function Intro({ busy }: { busy: boolean }) {
  return (
    <div className="bloat-intro">
      <div className={`scan-pulse${busy ? "" : " still"}`}>
        <Icon name="bloat" size={26} stroke={1.6} />
      </div>
      <h2>{busy ? t("bloat.scanning") : t("bloat.intro.title")}</h2>
      {busy ? (
        <ul className="bloat-steps">
          {STEPS.map((step, i) => (
            <li key={step} style={{ animationDelay: `${i * 0.3}s` }}>
              <Icon name="check" size={13} stroke={2.6} />
              {t(`bloat.step.${step}`)}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p>{t("bloat.intro.body")}</p>
          <button type="button" className="btn primary large" onClick={() => void scanBloat()}>
            <Icon name="bloat" size={15} />
            {t("bloat.start")}
          </button>
        </>
      )}
    </div>
  );
}

function UnwantedRow({ item }: { item: Unwanted }) {
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast(done);
      await refreshBloat();
    } catch (error) {
      toast(t("toast.error", { error: String(error) }), "warn");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (item.removal === "trash") {
      // Goes through the normal delete dialog (Trash by default, app data included).
      const sel: SelItem = { path: item.target, name: item.name, size: item.size, kind: "app", mode: "trash", cleanup: false, icon: item.icon || null };
      setSelected([sel], true);
      setState({ confirmOpen: true });
    } else if (item.removal === "uninstaller") {
      void api
        .uninstallApp(item.target)
        .then(() => {
          toast(t("apps.uninstallStarted", { name: item.name }));
          window.addEventListener("focus", () => void Promise.all([refreshLists(), refreshBloat()]), { once: true });
        })
        .catch((error) => toast(t("toast.error", { error: String(error) }), "warn"));
    } else if (item.removal === "package") {
      void act(() => api.bloatRemovePackage(item.target), t("bloat.removed", { name: item.name }));
    }
  };

  return (
    <div className="row tall">
      <FileIcon path={item.icon || null} kind="app" size={32} name={item.name} />
      <span className="row-main">
        <span className="row-title">
          {item.name}
          <span className="tag review">{t(`bloat.reason.${item.reason}`)}</span>
          {item.running && <span className="tag live">{t("bloat.running")}</span>}
        </span>
        {item.path && <span className="row-sub">{shortPath(item.path)}</span>}
      </span>
      {item.size > 0 && <span className="row-size">{formatBytes(item.size)}</span>}
      {item.running && (
        <button type="button" className="btn small" disabled={busy} onClick={() => void act(() => api.bloatQuit(item.pids), t("bloat.quitDone", { name: item.name }))}>
          {t("bloat.quit")}
        </button>
      )}
      {item.removal !== "none" && (
        <button type="button" className="btn small danger" disabled={busy} onClick={remove}>
          {item.removal === "uninstaller" ? t("apps.uninstall") : t("bloat.remove")}
        </button>
      )}
    </div>
  );
}

function StartupRow({ item, reveal }: { item: StartupItem; reveal: string }) {
  const [busy, setBusy] = useState(false);
  // One word in colour says why a row stands out; the rest is plain text.
  const reason = (["unwanted", "suspicious", "leftover"] as const).find((flag) => item.flags.includes(flag));
  const details = [
    item.vendor,
    t(`bloat.kind.${item.kind}`),
    item.scope === "system" ? t("bloat.scope.system") : null,
    item.flags.includes("unsigned") ? t("bloat.flag.unsigned") : null,
    item.enabled ? null : t("bloat.off"),
    item.program ? shortPath(item.program) : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const disable = async () => {
    setBusy(true);
    try {
      await api.bloatDisableStartup(item.id);
      toast(t("bloat.disabled", { name: item.name }));
      await refreshBloat();
    } catch (error) {
      toast(t("toast.error", { error: String(error) }), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`row tall${item.enabled ? "" : " muted"}`}>
      {item.icon ? (
        <FileIcon path={item.icon} kind="app" size={32} name={item.name} />
      ) : (
        // No app behind it, so no face: one quiet sign for all of these.
        <span className="tile tile-other" style={{ width: 32, height: 32, borderRadius: 9 }}>
          <Icon name="power" size={16} stroke={1.7} />
        </span>
      )}
      <span className="row-main">
        <span className="row-title">
          {item.name}
          {reason && (
            <span className="tag review" title={t(`bloat.flag.${reason}Hint`)}>
              {t(`bloat.flag.${reason}`)}
            </span>
          )}
          {item.running && <span className="tag live">{t("bloat.running")}</span>}
        </span>
        <span className="row-sub" title={item.flags.includes("unsigned") ? t("bloat.flag.unsignedHint") : undefined}>
          {details}
        </span>
      </span>
      {item.source && (
        <button type="button" className="icon-btn row-action" title={reveal} onClick={() => void api.reveal(item.source)}>
          <Icon name="reveal" size={14} />
        </button>
      )}
      {item.canDisable && item.enabled ? (
        <button type="button" className="btn small" disabled={busy} onClick={() => void disable()}>
          {t("bloat.disable")}
        </button>
      ) : !item.canDisable ? (
        <button type="button" className="btn small" onClick={() => void api.openSettings("loginItems")}>
          {t("bloat.manage")}
        </button>
      ) : null}
    </div>
  );
}

export function BloatView() {
  const report = useStore((s) => s.bloat);
  const busy = useStore((s) => s.bloatBusy);
  const platform = useStore((s) => s.meta?.platform);
  const [showAll, setShowAll] = useState(false);
  const windows = platform === "windows";
  const reveal = t(windows ? "action.reveal.win" : "action.reveal.mac");

  if (!report) {
    return (
      <>
        <Header title={t("nav.bloat")} subtitle={t("bloat.subtitle")} />
        <div className="content center">
          <Intro busy={busy} />
        </div>
      </>
    );
  }

  const startup = showAll ? report.startup : report.startup.slice(0, FIRST);

  return (
    <>
      <Header title={t("nav.bloat")} subtitle={t("bloat.subtitle")}>
        <button type="button" className="btn" onClick={() => void scanBloat()} disabled={busy}>
          <Icon name="refresh" size={14} className={busy ? "spin" : ""} />
          {busy ? t("scan.scanning") : t("bloat.again")}
        </button>
      </Header>

      <div className="content">
        <h2 className="section">
          {t("bloat.unwanted.title")} {report.unwanted.length > 0 && <span>{formatCount(report.unwanted.length)}</span>}
        </h2>
        {report.unwanted.length === 0 ? (
          <p className="calm">
            <Icon name="ok" size={16} />
            {t("bloat.unwanted.empty")}
          </p>
        ) : (
          <div className="list flush">
            {report.unwanted.map((item) => (
              <UnwantedRow key={item.id} item={item} />
            ))}
          </div>
        )}

        <h2 className="section">
          {t("bloat.startup.title")} <span>{report.startup.length > 0 ? formatCount(report.startup.length) : t("bloat.startup.hint")}</span>
        </h2>
        {report.startup.length === 0 ? (
          <p className="calm">
            <Icon name="ok" size={16} />
            {t("bloat.startup.empty")}
          </p>
        ) : (
          <div className="list flush">
            {startup.map((item) => (
              <StartupRow key={item.id} item={item} reveal={reveal} />
            ))}
            {!showAll && report.startup.length > FIRST && (
              <button type="button" className="more" onClick={() => setShowAll(true)}>
                {t("bloat.showAll", { count: formatCount(report.startup.length) })}
              </button>
            )}
          </div>
        )}

        <p className="footnote">
          {t("bloat.result", {
            processes: formatCount(report.processes),
            seconds: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(report.durationMs / 1000),
          })}
          {"  ·  "}
          {t("bloat.notAntivirus")}
        </p>
      </div>
    </>
  );
}
