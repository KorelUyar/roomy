import { useState } from "react";
import { api, type SecurityCheck, type StartupItem, type Unwanted } from "../api";
import { formatBytes, shortPath } from "../format";
import { formatCount, hasText, t, tn, tx } from "../i18n";
import { Icon } from "../icons";
import { refreshBloat, refreshLists, scanBloat, setSelected, setState, toast, useStore, type SelItem } from "../store";
import { FileIcon, Header } from "../ui";

const STEPS = ["software", "startup", "processes", "security"] as const;
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
      <FileIcon path={item.icon || null} kind="app" size={36} name={item.name} />
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
  const details = [item.vendor, t(`bloat.kind.${item.kind}`), item.scope === "system" ? t("bloat.scope.system") : null, item.program ? shortPath(item.program) : null]
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
      <FileIcon path={item.icon || null} kind="app" size={32} name={item.name} />
      <span className="row-main">
        <span className="row-title">
          {item.name}
          {item.flags.map((flag) => (
            <span key={flag} className={`tag ${flag === "unsigned" ? "" : "review"}`} title={t(`bloat.flag.${flag}Hint`)}>
              {t(`bloat.flag.${flag}`)}
            </span>
          ))}
          {item.running && <span className="tag live">{t("bloat.running")}</span>}
          {!item.enabled && <span className="tag">{t("bloat.off")}</span>}
        </span>
        <span className="row-sub">{details}</span>
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

const STATUS_ICON = { ok: "ok", warn: "alert", info: "info", unknown: "question" } as const;

function SecurityRow({ check, windows }: { check: SecurityCheck; windows: boolean }) {
  const titleKey = hasText(`sec.${check.id}.title`) ? `sec.${check.id}.title` : `sec.${check.id}.title.${windows ? "win" : "mac"}`;
  // "Last update installed 12 days ago" when the system told us a number.
  const withDays = `sec.${check.id}.${check.status}Days`;
  const plain = `sec.${check.id}.${check.status}`;
  const text =
    check.status === "unknown"
      ? t("sec.unknown")
      : check.detail && hasText(withDays)
        ? tx(withDays, { days: check.detail })
        : hasText(plain)
          ? tx(plain)
          : "";

  return (
    <div className="row tall">
      <span className={`status ${check.status}`}>
        <Icon name={STATUS_ICON[check.status]} size={18} />
      </span>
      <span className="row-main">
        <span className="row-title">{tx(titleKey)}</span>
        <span className="row-sub wrap">{text}</span>
      </span>
      <span className={`tag ${check.status === "ok" ? "safe" : check.status === "warn" ? "review" : ""}`}>{t(`bloat.status.${check.status}`)}</span>
      {check.status !== "ok" && (
        <button type="button" className="btn small" onClick={() => void api.openSettings(check.id)}>
          {t("bloat.security.open")}
        </button>
      )}
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

  const flagged = report.startup.filter((i) => i.flags.some((f) => f !== "unsigned")).length;
  const toCheck = report.security.filter((c) => c.status === "warn").length;
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
        <div className="stats">
          <div className={`stat ${report.unwanted.length ? "warn" : "good"}`}>
            <span className="card-icon">
              <Icon name="bloat" size={18} />
            </span>
            <span className="card-title">{t("bloat.tile.unwanted")}</span>
            <span className="stat-value">{report.unwanted.length ? tn("bloat.tile.count", report.unwanted.length) : t("bloat.tile.none")}</span>
          </div>
          <div className={`stat ${flagged ? "warn" : "plain"}`}>
            <span className="card-icon">
              <Icon name="power" size={18} />
            </span>
            <span className="card-title">{t("bloat.tile.startup")}</span>
            <span className="stat-value">{flagged ? tn("bloat.tile.flagged", flagged) : t("bloat.tile.startupCount", { count: formatCount(report.startup.length) })}</span>
          </div>
          <div className={`stat ${toCheck ? "warn" : "good"}`}>
            <span className="card-icon">
              <Icon name="shield" size={18} />
            </span>
            <span className="card-title">{t("bloat.tile.security")}</span>
            <span className="stat-value">{toCheck ? tn("bloat.tile.flagged", toCheck) : t("bloat.tile.allGood")}</span>
          </div>
        </div>

        <h2 className="section">{t("bloat.unwanted.title")}</h2>
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
          {t("bloat.startup.title")} <span>{t("bloat.startup.hint")}</span>
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

        <h2 className="section">{t("bloat.security.title")}</h2>
        <div className="list flush">
          {report.security.map((check) => (
            <SecurityRow key={check.id} check={check} windows={windows} />
          ))}
        </div>

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
