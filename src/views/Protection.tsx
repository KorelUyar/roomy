import { useEffect } from "react";
import { api, type SecurityCheck } from "../api";
import { fixableByDefault, flaggedStartup, harmful, listIssues, openThreats, securityText, securityTitle, testFiles, type Issue } from "../findings";
import { formatAgo, formatBytes, formatSeconds, shortPath } from "../format";
import { formatCount, t, tn, tx } from "../i18n";
import { Icon } from "../icons";
import { checkAll, ensureBloat, fixIssue, loadMalware, setState, stopMalwareScan, toggleIntended, useStore } from "../store";
import { Band, FileIcon, Header, StatusRow, type BandTone } from "../ui";

const CHECK_STEPS = ["security", "startup", "software", "malware"];

/**
 * One thing a scan found, and the button that deals with it. Removing is
 * always the careful kind (the Trash, switched off rather than deleted);
 * what Roomy cannot do itself opens in the window of the system that can.
 */
function IssueRow({ issue, reveal, disabled }: { issue: Issue; reveal: string; disabled: boolean }) {
  const removes = issue.fix === "auto" && (issue.kind === "threat" || (issue.unwanted && issue.unwanted.removal !== "none"));
  return (
    <div className="row tall" data-issue={issue.kind}>
      {/* Every row starts with a sign of the same size, so the names line up. */}
      <span className="lead">
        {issue.kind === "setting" ? (
          <span className="status warn">
            <Icon name="bang" size={15} stroke={2.6} />
          </span>
        ) : issue.icon || issue.kind === "unwanted" ? (
          <FileIcon path={issue.icon} kind="app" size={32} name={issue.name} />
        ) : (
          // No app behind it, so no face: the sign of its kind.
          <span className="tile tile-other" style={{ width: 32, height: 32, borderRadius: 9 }}>
            <Icon name={issue.kind === "startup" ? "power" : "shieldAlert"} size={16} stroke={1.7} />
          </span>
        )}
      </span>
      <span className="row-main">
        <span className="row-title">
          {issue.name}
          {issue.tag && <span className={`tag${issue.weight === "bad" ? " bad" : issue.weight === "warn" ? " review" : ""}`}>{issue.tag}</span>}
        </span>
        <span className={`row-sub${issue.kind === "setting" ? " wrap" : ""}`}>{issue.detail}</span>
      </span>
      {issue.threat && (
        <button type="button" className="icon-btn row-action" title={reveal} onClick={() => void api.reveal(issue.threat!.path)}>
          <Icon name="reveal" size={14} />
        </button>
      )}
      {issue.setting && (
        <button type="button" className="btn small" data-intended title={t("sec.intendedHint")} onClick={() => toggleIntended(issue.setting!.id)}>
          {t("sec.intended")}
        </button>
      )}
      <button type="button" className={`btn small${removes ? " danger" : ""}`} data-fix={issue.fix} title={issue.does} disabled={disabled} onClick={() => void fixIssue(issue)}>
        {issue.action}
        {issue.ask && "…"}
      </button>
    </div>
  );
}

/** A security setting that needs no look right now: fine, a note, or off on purpose. */
function SettingRow({ check, windows, intended }: { check: SecurityCheck; windows: boolean; intended: boolean }) {
  const accepted = check.status === "warn" && intended;
  const text = securityText(check);
  return (
    <StatusRow tone={accepted ? "info" : check.status === "unknown" ? "unknown" : check.status === "warn" ? "info" : check.status} title={securityTitle(check, windows)} text={accepted ? `${text} ${t("sec.intendedNote")}` : text}>
      {accepted ? (
        <button type="button" className="btn small" onClick={() => toggleIntended(check.id)}>
          {t("sec.undo")}
        </button>
      ) : (
        check.status !== "ok" && (
          <button type="button" className="btn small" onClick={() => void api.openSettings(check.id)}>
            {t("bloat.security.open")}
          </button>
        )
      )}
    </StatusRow>
  );
}

/** What wants a look first among the rest: notes, then off on purpose, then unreadable, then fine. */
const rank = (check: SecurityCheck) => (check.status === "info" ? 0 : check.status === "warn" ? 1 : check.status === "unknown" ? 2 : 3);

export function ProtectionView() {
  const platform = useStore((s) => s.meta?.platform);
  const malware = useStore((s) => s.malware);
  const lastScan = useStore((s) => s.lastScan);
  const bloat = useStore((s) => s.bloat);
  const check = useStore((s) => s.check);
  const fixing = useStore((s) => s.fixing);
  const fixingOne = useStore((s) => s.fixingOne);
  const intended = useStore((s) => s.intended);
  const windows = platform === "windows";
  const reveal = t(windows ? "action.reveal.win" : "action.reveal.mac");

  // Opened before anything ran (or while a scan is under way elsewhere): catch up quietly.
  useEffect(() => {
    ensureBloat();
    void loadMalware();
  }, []);

  const engine = malware?.engine;
  const defender = engine?.engine === "defender";
  const scanningFiles = malware?.state === "scanning";
  const scanning = check.running || scanningFiles;
  const fixingNow = fixingOne !== null || (fixing !== null && !fixing.finished);
  const issues = listIssues({ malware, bloat, intended, windows });
  const fixable = fixableByDefault(issues).length;
  // Microsoft Defender's findings one by one: what it dealt with, and what is still waiting.
  const byDefender = defender && malware?.state === "done" ? malware.threats : [];
  const rest = bloat ? bloat.security.filter((c) => !(c.status === "warn" && !intended.includes(c.id))).sort((a, b) => rank(a) - rank(b)) : null;

  // --- what the band says: the answer about malware first, the rest after ------
  const scannedNow = malware?.state === "done";
  const real = scannedNow ? openThreats(malware).length : 0;
  const tests = scannedNow ? testFiles(malware).length : 0;
  const matches = real + tests;
  const tidy = issues.filter((i) => i.kind === "unwanted" || i.kind === "startup").length;
  // Amber is for what costs points. Apps that merely came with the computer are a matter of taste.
  const nagging = harmful(bloat).length + flaggedStartup(bloat).length > 0;
  const settings = issues.filter((i) => i.kind === "setting").length;
  const scanned = malware?.state === "done";

  let tone: BandTone = "idle";
  let title = t("protection.idle");
  const lines: (string | null | undefined)[] = [];
  if (scanning) {
    title = t(scanningFiles && defender ? "protection.scan.runningDefender" : "protection.scan.running");
    if (scanningFiles && defender) lines.push(t("protection.scan.defenderWait"));
    else if (scanningFiles) lines.push(t("protection.scan.progress", { count: formatCount(malware!.files), size: formatBytes(malware!.bytes) }));
  } else if (bloat) {
    if (matches > 0) {
      // Red is for a file that matches a signature, and for nothing else.
      tone = real > 0 ? "bad" : "idle";
      title = tn("health.malware.found", matches);
      if (tests > 0) lines.push(real > 0 ? tn("protection.scan.tests", tests) : t("protection.scan.testsOnly"));
    } else if (malware?.state === "failed") {
      tone = "unknown";
      title = t("protection.scan.failed");
      lines.push(malware.error);
    } else if (engine && !engine.available) {
      tone = "unknown";
      title = t("health.malware.off");
      lines.push(t(defender ? "protection.scan.unavailable.defender" : "protection.scan.unavailable.xprotect"));
    } else if (scanned && !malware!.cancelled) {
      tone = nagging ? "warn" : "ok";
      title = t("protection.malware.none");
    } else if (defender) {
      // Microsoft Defender watches by itself; nobody asked it to scan just now.
      tone = nagging ? "warn" : "ok";
      title = t("health.malware.defender");
    } else {
      // The software and the settings were looked at, the files were not (yet): no all-clear.
      tone = nagging ? "warn" : "idle";
      title = scanned ? t("protection.scan.stopped") : t("protection.idle");
      if (lastScan && !scanned) lines.push(`${t("protection.scan.last", { when: formatAgo(lastScan.at / 1000) })}: ${lastScan.threats > 0 ? tn("protection.scan.lastFound", lastScan.threats) : t("protection.scan.lastClean")}`);
    }
    // What else there is, counted one by one like everywhere.
    const others = [tidy > 0 ? tn("protection.tidy", tidy) : null, settings > 0 ? tn("health.security.warn", settings) : null].filter(Boolean).join("  ·  ");
    if (others) lines.push(others);
    // How the answer came about, quietly.
    if (scanned) {
      lines.push(
        [
          defender
            ? t("protection.scan.summaryDefender", { time: formatSeconds(malware!.durationMs) })
            : t("protection.scan.summary", { count: formatCount(malware!.files), rules: formatCount(malware!.engine.rules), time: formatSeconds(malware!.durationMs) }),
          malware!.skipped > 0 ? tn("protection.scan.skipped", malware!.skipped) : null,
        ]
          .filter(Boolean)
          .join("  ·  "),
      );
    }
  }

  const signatures = engine?.available && engine.version ? t("protection.scan.signatures", { version: engine.version, when: engine.updated > 0 ? formatAgo(engine.updated) : t("time.never") }) : null;

  return (
    <>
      <Header title={t("nav.protection")} subtitle={t("protection.subtitle")} />

      <div className="content">
        <Band
          tone={tone}
          icon="shield"
          busy={scanning}
          title={title}
          below
          actions={
            scanning ? (
              // Microsoft Defender cannot be stopped from outside.
              scanningFiles &&
              !defender && (
                <button type="button" className="btn large" onClick={stopMalwareScan}>
                  <Icon name="stop" size={13} />
                  {t("protection.scan.stop")}
                </button>
              )
            ) : (
              <>
                {fixable > 0 && (
                  <button type="button" className="btn large primary" data-fix-all disabled={fixingNow} onClick={() => setState({ fixAsk: issues })}>
                    {tn("fix.all", fixable)}
                  </button>
                )}
                <button
                  type="button"
                  className={`btn large${fixable > 0 ? "" : " primary"}`}
                  data-scan="quick"
                  title={t(defender ? "protection.scan.hintDefender" : "protection.scan.hint")}
                  disabled={fixingNow}
                  onClick={() => void checkAll("quick", true)}
                >
                  {t(bloat ? "protection.scan.again" : "protection.scan")}
                </button>
                <button type="button" className="btn large" data-scan="full" title={t(defender ? "protection.scan.deepHintDefender" : "protection.scan.deepHint")} disabled={fixingNow} onClick={() => void checkAll("full", true)}>
                  {t("protection.scan.deep")}
                </button>
                {issues.length > fixable && fixable > 0 && <span className="needs-you">{tn("fix.needsYou", issues.length - fixable)}</span>}
              </>
            )
          }
          foot={
            <span>
              {t(defender ? "protection.note.defender" : "protection.note.xprotect")}
              {signatures && ` ${signatures}.`}
            </span>
          }
        >
          {scanning && !scanningFiles ? (
            <ul className="steps">
              {CHECK_STEPS.slice(0, check.withMalware ? 4 : 3).map((step, i) => (
                <li key={step} className={i < check.step ? "done" : i === check.step ? "now" : ""}>
                  <span>{i < check.step ? <Icon name="check" size={13} stroke={2.8} /> : <i className="dot" />}</span>
                  {tx(`health.step.${step}`)}
                </li>
              ))}
            </ul>
          ) : (
            lines.filter(Boolean).map((line, i) => (
              <p className={`band-sub${i > 0 && i === lines.filter(Boolean).length - 1 && scanned && !scanning ? " quiet" : ""}`} key={line}>
                {line}
              </p>
            ))
          )}
          {scanningFiles && !defender && <p className="band-sub path">{malware!.current ? shortPath(malware!.current) : " "}</p>}
        </Band>

        {issues.length > 0 && (
          <>
            <h2 className="section">
              {t("protection.threats.title")} <span>{formatCount(issues.length)}</span>
            </h2>
            <div className="list flush" data-list="issues">
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} reveal={reveal} disabled={fixingNow || check.running} />
              ))}
            </div>
          </>
        )}

        {byDefender.length > 0 && (
          <>
            <h2 className="section">
              {t("protection.threat.handled")} <span>{formatCount(byDefender.length)}</span>
            </h2>
            <div className="list flush" data-list="defender">
              {byDefender.map((threat, i) => (
                <StatusRow key={`${threat.id}|${threat.path}|${i}`} tone={threat.handled ? "ok" : "bad"} title={threat.name} text={`${threat.signature}  ·  ${threat.path}`}>
                  <span className="row-note">{t(threat.handled ? "protection.defender.done" : "protection.defender.open")}</span>
                </StatusRow>
              ))}
            </div>
          </>
        )}

        <h2 className="section">{t("protection.settings.title")}</h2>
        {rest ? (
          <div className="list flush" data-list="settings">
            {rest.map((item) => (
              <SettingRow key={item.id} check={item} windows={windows} intended={intended.includes(item.id)} />
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
