import { useEffect } from "react";
import { api, type MalwareStatus, type SecurityCheck, type Threat } from "../api";
import { formatAgo, formatBytes, formatSeconds, shortPath } from "../format";
import { formatCount, hasText, t, tn, tx } from "../i18n";
import { Icon } from "../icons";
import { ensureBloat, getState, loadMalware, scanMalware, setSelected, setState, stopMalwareScan, toggleIntended, useStore, type LastScan, type SelItem } from "../store";
import { Band, FileIcon, Header, StatusRow, type BandTone } from "../ui";

/**
 * One security setting of the system: is it on, what does that mean, where
 * to change it. A setting that is off on purpose can be marked as such; it
 * then stops counting as something to look at.
 */
function SecurityRow({ check, windows, intended }: { check: SecurityCheck; windows: boolean; intended: boolean }) {
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
  const accepted = check.status === "warn" && intended;

  return (
    <StatusRow tone={accepted ? "info" : check.status === "unknown" ? "unknown" : check.status} title={tx(titleKey)} text={accepted ? `${text} ${t("sec.intendedNote")}` : text}>
      {accepted ? (
        <button type="button" className="btn small" onClick={() => toggleIntended(check.id)}>
          {t("sec.undo")}
        </button>
      ) : (
        check.status !== "ok" && (
          <>
            {check.status === "warn" && (
              <button type="button" className="btn small" data-intended onClick={() => toggleIntended(check.id)}>
                {t("sec.intended")}
              </button>
            )}
            <button type="button" className="btn small" onClick={() => void api.openSettings(check.id)}>
              {t("bloat.security.open")}
            </button>
          </>
        )
      )}
    </StatusRow>
  );
}

/** What wants a look first: off, then worth knowing, then off on purpose, then unreadable, then fine. */
function rank(check: SecurityCheck, intended: string[]): number {
  if (check.status === "warn") return intended.includes(check.id) ? 2 : 0;
  return check.status === "info" ? 1 : check.status === "unknown" ? 3 : 4;
}

function ThreatRow({ threat, reveal, defender }: { threat: Threat; reveal: string; defender: boolean }) {
  const remove = () => {
    // The whole app when the file is part of one. Goes through the normal delete dialog (Trash first).
    const target = threat.container ?? threat.path;
    const app = threat.container ? getState().apps?.find((a) => a.path === threat.container) : undefined;
    const item: SelItem = {
      path: target,
      name: threat.container ? target.split("/").pop()! : threat.name,
      // Of an app only the one file was measured: say how big the whole thing is, or that it is not known.
      size: threat.container ? (app?.size ?? 0) : threat.size,
      unknownSize: !!threat.container && !app,
      kind: threat.container ? "app" : "other",
      mode: "trash",
      cleanup: false,
      icon: target,
    };
    setSelected([item], true);
    setState({ confirmOpen: true });
  };
  return (
    <div className="row tall">
      <FileIcon path={defender ? null : (threat.container ?? threat.path)} kind={threat.container ? "app" : "other"} size={32} name={threat.name} />
      <span className="row-main">
        <span className="row-title">
          {threat.name}
          <span className={`tag${threat.test ? "" : " review"}`}>{threat.test ? t("protection.threat.test") : threat.signature}</span>
        </span>
        <span className="row-sub">{shortPath(threat.path)}</span>
      </span>
      {threat.size > 0 && <span className="row-size">{formatBytes(threat.size)}</span>}
      {threat.handled ? (
        <span className="tag">{t("protection.threat.handled")}</span>
      ) : defender ? (
        // Not Roomy's to remove: Microsoft Defender has it, and its own window says what it needs.
        <button type="button" className="btn small" onClick={() => void api.openSettings("antivirus")}>
          {t("protection.threat.open")}
        </button>
      ) : (
        <>
          <button type="button" className="icon-btn row-action" title={reveal} onClick={() => void api.reveal(threat.path)}>
            <Icon name="reveal" size={14} />
          </button>
          <button type="button" className="btn small danger" onClick={remove}>
            {t("confirm.trash")}
          </button>
        </>
      )}
    </div>
  );
}

/** The scan: what it is, how it is going, what came of it. Always says how it was done. */
function ScanBand({ malware, lastScan }: { malware: MalwareStatus; lastScan: LastScan | null }) {
  const { engine } = malware;
  const defender = engine.engine === "defender";
  const scanning = malware.state === "scanning";
  const done = malware.state === "done";
  const tests = malware.threats.filter((x) => x.test);
  const real = malware.threats.filter((x) => !x.test);
  const open = real.filter((x) => !x.handled);

  const summary = defender
    ? t("protection.scan.summaryDefender", { time: formatSeconds(malware.durationMs) })
    : t("protection.scan.summary", { count: formatCount(malware.files), rules: formatCount(engine.rules), time: formatSeconds(malware.durationMs) });
  // What the scan did not get to see, said as plainly as what it saw.
  const gaps = [malware.skipped > 0 ? tn("protection.scan.skipped", malware.skipped) : null, malware.cancelled && malware.threats.length > 0 ? t("protection.scan.stopped") : null]
    .filter(Boolean)
    .join("  ·  ");

  let tone: BandTone = "idle";
  let title = t("protection.scan.title");
  let lines: (string | null)[] = [defender ? t("protection.scan.defender") : t("protection.scan.xprotect", { rules: formatCount(engine.rules) })];
  if (!engine.available) {
    tone = "unknown";
    lines = [t(defender ? "protection.scan.unavailable.defender" : "protection.scan.unavailable.xprotect")];
  } else if (scanning) {
    title = t(defender ? "protection.scan.runningDefender" : "protection.scan.running");
    lines = defender ? [t("protection.scan.defenderWait")] : [t("protection.scan.progress", { count: formatCount(malware.files), size: formatBytes(malware.bytes) })];
  } else if (malware.state === "failed") {
    tone = "warn";
    title = t("protection.scan.failed");
    lines = [malware.error];
  } else if (done && real.length > 0) {
    // Open: still there and nobody has dealt with it. Otherwise Microsoft Defender has.
    tone = open.length > 0 ? "bad" : "warn";
    title = defender ? tn("protection.scan.foundDefender", real.length) : tn("health.malware.found", malware.threats.length);
    lines = [tests.length > 0 ? tn("protection.scan.tests", tests.length) : null, summary, gaps];
  } else if (done && tests.length > 0) {
    // Found what it was meant to find, and nothing else: no alarm, no all-clear either.
    title = tn("health.malware.found", tests.length);
    lines = [t("protection.scan.testsOnly"), summary, gaps];
  } else if (done) {
    // A scan that was stopped has not looked at everything: no verdict.
    tone = malware.cancelled ? "idle" : "ok";
    title = malware.cancelled ? t("protection.scan.stopped") : t("protection.scan.clean");
    lines = [summary, gaps];
  }

  const signatures = engine.version ? t("protection.scan.signatures", { version: engine.version, when: engine.updated > 0 ? formatAgo(engine.updated) : t("time.never") }) : null;
  const earlier =
    lastScan && malware.state === "idle"
      ? `${t("protection.scan.last", { when: formatAgo(lastScan.at / 1000) })}: ${lastScan.threats > 0 ? tn("protection.scan.lastFound", lastScan.threats) : t("protection.scan.lastClean")}`
      : null;

  return (
    <Band
      tone={tone}
      icon={engine.available ? "shield" : "shieldPlain"}
      busy={scanning}
      title={title}
      actions={
        !engine.available ? null : scanning ? (
          // Microsoft Defender cannot be stopped from outside.
          !defender && (
            <button type="button" className="btn large" onClick={stopMalwareScan}>
              <Icon name="stop" size={13} />
              {t("protection.scan.stop")}
            </button>
          )
        ) : (
          <>
            {!defender && (
              <button type="button" className="btn large" data-scope="full" onClick={() => void scanMalware("full")}>
                {t("protection.scan.full")}
              </button>
            )}
            <button type="button" className="btn large primary" data-scope="quick" onClick={() => void scanMalware("quick")}>
              {t("protection.scan.quick")}
            </button>
          </>
        )
      }
      foot={
        engine.available ? (
          <>
            {!defender && <span>{t("protection.scan.scopes")}</span>}
            <span>{t(defender ? "protection.note.defender" : "protection.note.xprotect")}</span>
            {(signatures || earlier) && <span>{[signatures, earlier].filter(Boolean).join("  ·  ")}</span>}
          </>
        ) : null
      }
    >
      {lines.filter(Boolean).map((line) => (
        <p className="band-sub" key={line}>
          {line}
        </p>
      ))}
      {scanning && !defender && <p className="band-sub path">{malware.current ? shortPath(malware.current) : " "}</p>}
    </Band>
  );
}

export function ProtectionView() {
  const platform = useStore((s) => s.meta?.platform);
  const malware = useStore((s) => s.malware);
  const lastScan = useStore((s) => s.lastScan);
  const bloat = useStore((s) => s.bloat);
  const intended = useStore((s) => s.intended);
  const windows = platform === "windows";
  const reveal = t(windows ? "action.reveal.win" : "action.reveal.mac");

  // The security settings are read by the Bloat Scanner's scan: get them quietly when nobody has yet.
  useEffect(() => {
    ensureBloat();
    void loadMalware();
  }, []);

  const defender = malware?.engine.engine === "defender";
  const checks = bloat ? [...bloat.security].sort((a, b) => rank(a, intended) - rank(b, intended)) : null;

  return (
    <>
      <Header title={t("nav.protection")} subtitle={t("protection.subtitle", { device: t(windows ? "device.pc" : "device.mac") })} />

      <div className="content">
        {malware ? <ScanBand malware={malware} lastScan={lastScan} /> : <Band tone="idle" icon="shield" busy title={t("protection.scan.title")} />}

        {malware && malware.state === "done" && malware.threats.length > 0 && (
          <>
            <h2 className="section">{t("protection.threats.title")}</h2>
            <div className="list flush">
              {malware.threats.map((threat, i) => (
                <ThreatRow key={`${threat.path}|${threat.signature}|${i}`} threat={threat} reveal={reveal} defender={defender} />
              ))}
            </div>
          </>
        )}

        <h2 className="section">{t("protection.settings.title")}</h2>
        {checks ? (
          <div className="list flush">
            {checks.map((check) => (
              <SecurityRow key={check.id} check={check} windows={windows} intended={intended.includes(check.id)} />
            ))}
          </div>
        ) : (
          <div className="list flush" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div className="row tall skeleton" key={i}>
                <span className="sk sk-icon" />
                <span className="sk sk-text" style={{ width: `${30 + ((i * 37) % 26)}%` }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
