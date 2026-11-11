import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Consumer } from "../api";
import { diskTone, flaggedStartup, openThreats, securityToCheck, testFiles, usedPercent } from "../findings";
import { formatAgo, formatBytes, formatClock, formatDuration, formatMemory, formatPercent, shortPath } from "../format";
import { formatCount, t, tn, tx } from "../i18n";
import { Icon } from "../icons";
import { checkAll, CPU_POINTS, navigate, quitConsumer, selectDisk, setState, useStore, watchHealth } from "../store";
import { Band, FileIcon, Header, SizeBar, StatusRow, TONE_ICON, type BandTone, type Tone } from "../ui";

const HALF_YEAR = 182 * 86400;
/** Below this, "you could clean up" is not worth a line. */
const WORTH_CLEANING = 500_000_000;
/** How many lines "Using the most memory" shows. */
const TOP_ROWS = 6;

/**
 * The processor's last couple of minutes on a fixed scale: the bottom is
 * idle, the top is every core busy. Drawn across the whole width from the
 * third reading on; before that a line would only be a guess.
 */
function Spark({ values }: { values: number[] }) {
  const W = 100;
  const H = 30;
  // However many readings there are, they span the tile: a few seconds at first, the full two minutes later.
  const steps = Math.max(1, Math.min(values.length, CPU_POINTS) - 1);
  const x = (i: number) => W - (values.length - 1 - i) * (W / steps);
  const y = (v: number) => H - 1.5 - (Math.max(0, Math.min(100, v)) / 100) * (H - 5);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const last = values[values.length - 1] ?? 0;
  const drawn = values.length >= 3;
  return (
    <span className="spark" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {drawn && <path className="spark-area" d={`${line} L${W} ${H} L${x(0).toFixed(2)} ${H} Z`} />}
        {drawn && <path className="spark-line" d={line} />}
      </svg>
      {values.length > 0 && <i style={{ top: `${(y(last) / H) * 100}%` }} />}
    </span>
  );
}

/** One number about the computer: what it is, how much, how full, and a line or two of detail. */
function Vital({
  icon,
  label,
  value,
  unit,
  tone,
  percent,
  lines,
  flag,
  onClick,
  children,
}: {
  icon: string;
  label: string;
  value: string;
  unit?: string;
  tone?: "" | "warn" | "bad";
  /** How full the meter is, 0–100. Left out when `children` draws something else. */
  percent?: number;
  lines: (string | null | undefined)[];
  /** A word of warning, shown in place of the last line. */
  flag?: string | null;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const shown = lines.filter(Boolean) as string[];
  const body = (
    <>
      <span className="vital-label">
        <Icon name={icon} size={14} />
        {label}
        {onClick && <Icon name="chevronRight" size={14} className="row-arrow" />}
      </span>
      <span className="vital-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {children ??
        (percent !== undefined && (
          <span className="meter">
            <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
          </span>
        ))}
      <span className="vital-sub">
        {(flag ? shown.slice(0, 1) : shown).map((line) => (
          <span key={line}>{line}</span>
        ))}
        {flag && <span className="flag">{flag}</span>}
      </span>
    </>
  );
  const className = `vital${tone ? ` ${tone}` : ""}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** An app, or a program that runs in the background, and how much memory it holds. */
function ConsumerRow({ item, total, quitting, withQuit }: { item: Consumer; total: number; quitting: boolean; withQuit: boolean }) {
  return (
    <div className="row">
      {item.app ? (
        <FileIcon path={item.path || null} kind="app" size={28} name={item.name} />
      ) : (
        // Programs have no face of their own: one quiet sign for all of them.
        <span className="tile tile-other" style={{ width: 28, height: 28, borderRadius: 8 }}>
          <Icon name="cpu" size={15} stroke={1.7} />
        </span>
      )}
      <span className="row-main">
        <span className="row-title">{item.name}</span>
        {/* A bare program says little by its name ("2.1.3"): where it lives says more. */}
        {!item.app && item.path && <span className="row-sub">{shortPath(item.path)}</span>}
      </span>
      <SizeBar value={item.memory} max={total} />
      <span className="row-size">{formatMemory(item.memory)}</span>
      {withQuit && (
        <span className="row-end">
          {item.canQuit && (
            <button type="button" className="btn small" disabled={quitting} onClick={() => void quitConsumer(item)}>
              {t(quitting ? "health.quitting" : "health.quit")}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

interface Finding {
  key: string;
  tone: Tone;
  icon?: string;
  title: string;
  text: string;
  go?: () => void;
}

export function HealthView() {
  const meta = useStore((s) => s.meta);
  const health = useStore((s) => s.health);
  const history = useStore((s) => s.cpuHistory);
  const disks = useStore((s) => s.disks);
  const overviews = useStore((s) => s.overviews);
  const bloat = useStore((s) => s.bloat);
  const malware = useStore((s) => s.malware);
  const lastScan = useStore((s) => s.lastScan);
  const check = useStore((s) => s.check);
  const intended = useStore((s) => s.intended);
  const apps = useStore((s) => s.apps);
  const cleanup = useStore((s) => s.cleanup);
  const quitting = useStore((s) => s.quitting);
  const [everything, setEverything] = useState(false);
  const memoryList = useRef<HTMLHeadingElement>(null);

  // The numbers are live for as long as this tab is open.
  useEffect(() => watchHealth(), []);

  if (!meta) return null;
  const windows = meta.platform === "windows";
  const device = t(windows ? "device.pc" : "device.mac");

  // --- the four numbers ------------------------------------------------------
  const system = disks.find((d) => d.system) ?? disks[0];
  const disk = system ? (overviews[system.root]?.disk ?? system) : null;
  const storageTone = diskTone(disk);
  const memoryTone = health?.pressure === "critical" ? "bad" : health?.pressure === "warn" ? "warn" : "";
  const battery = health?.battery ?? null;
  const batteryLow = battery?.percent != null && !battery.plugged && battery.percent <= 20;
  const batteryTone = battery?.condition === "service" ? "warn" : batteryLow ? (battery!.percent! <= 10 ? "bad" : "warn") : "";

  // --- the check-up, in the order it is done ---------------------------------
  const toProtection = () => navigate("protection");
  const toBloat = () => navigate("bloat");
  const findings: Finding[] = [];

  if (bloat) {
    const toCheck = securityToCheck(bloat, intended).length;
    // "All switched on" is only true of what could be read.
    const unread = bloat.security.filter((c) => c.status === "unknown").length;
    const flagged = flaggedStartup(bloat);
    findings.push(
      toCheck > 0
        ? { key: "security", tone: "warn", title: t("health.security"), text: tn("health.security.warn", toCheck), go: toProtection }
        : unread > 0
          ? { key: "security", tone: "unknown", title: t("health.security"), text: tn("health.security.unknown", unread), go: toProtection }
          : { key: "security", tone: "ok", title: t("health.security"), text: t("health.security.good"), go: toProtection },
      flagged > 0
        ? { key: "startup", tone: "warn", title: t("health.startup"), text: tn("health.startup.flagged", flagged), go: toBloat }
        : { key: "startup", tone: "ok", title: t("health.startup"), text: tn("health.startup.count", bloat.startup.length), go: toBloat },
      bloat.unwanted.length > 0
        ? { key: "unwanted", tone: "warn", title: t("health.unwanted"), text: tn("health.unwanted.found", bloat.unwanted.length), go: toBloat }
        : { key: "unwanted", tone: "ok", title: t("health.unwanted"), text: t("health.unwanted.none"), go: toBloat },
    );
  }

  // Malware: what the scan of this session says; failing that, what is remembered of the last one.
  const threats = openThreats(malware);
  const scanned = malware?.state === "done" && !malware.cancelled;
  let malwareKnown = true;
  const malwareRow = (tone: Tone, text: string): Finding => ({ key: "malware", tone, title: t("health.malware"), text, go: toProtection });
  if (threats.length > 0) {
    findings.push(malwareRow("bad", tn("health.malware.found", threats.length)));
  } else if (malware?.state === "failed") {
    findings.push(malwareRow("warn", t("health.malware.failed")));
  } else if (scanned) {
    // Microsoft Defender does not say how many files it looked at, and deals with what it finds itself.
    const dealtWith = malware!.threats.filter((x) => x.handled).length;
    const text =
      testFiles(malware).length > 0
        ? t("health.malware.testOnly")
        : malware!.engine.engine !== "defender"
          ? t("health.malware.clean", { count: formatCount(malware!.files) })
          : dealtWith > 0
            ? tn("health.malware.handled", dealtWith)
            : t("health.malware.cleanDefender");
    findings.push(malwareRow(dealtWith > 0 ? "info" : "ok", text));
  } else if (malware?.engine.engine === "defender" && malware.engine.available) {
    findings.push(malwareRow("ok", t("health.malware.defender")));
  } else if (malware && !malware.engine.available) {
    findings.push(malwareRow("unknown", t("health.malware.off")));
  } else if (lastScan) {
    const result = lastScan.threats > 0 ? tn("protection.scan.lastFound", lastScan.threats) : t("protection.scan.lastClean");
    findings.push(malwareRow(lastScan.threats > 0 ? "warn" : "ok", `${t("protection.scan.last", { when: formatAgo(lastScan.at / 1000) })}: ${result}`));
  } else {
    malwareKnown = false;
  }

  if (health) {
    findings.push({
      key: "drive",
      tone: health.diskHealth === "ok" ? "ok" : health.diskHealth === "failing" ? "bad" : "unknown",
      title: t("health.drive"),
      text: tx(`health.drive.${health.diskHealth}`),
    });
  }

  // Not states but chances: what could be tidied up.
  const cleanable = (cleanup ?? []).reduce((sum, g) => sum + g.size, 0);
  const now = Date.now() / 1000;
  const hasUsage = (apps ?? []).some((a) => a.lastUsed !== null);
  const unused = (apps ?? []).filter((a) => !a.running && (a.lastUsed === null || now - a.lastUsed > HALF_YEAR));
  if (cleanup && cleanable >= WORTH_CLEANING) {
    findings.push({ key: "cleanup", tone: "info", icon: "cleanup", title: t("health.cleanup"), text: t("health.cleanup.some", { size: formatBytes(cleanable) }), go: () => navigate("cleanup") });
  }
  if (apps && hasUsage && unused.length > 0) {
    findings.push({
      key: "apps",
      tone: "info",
      icon: "apps",
      title: t("health.apps"),
      text: tn("health.apps.some", unused.length, { size: formatBytes(unused.reduce((sum, a) => sum + a.size, 0)) }),
      go: () => {
        setState({ appsSort: "used" });
        navigate("apps");
      },
    });
  }

  // --- the verdict -----------------------------------------------------------
  // What wants to be looked at stands right under the sentence that counts it;
  // the list below keeps the rest.
  const vitals: Finding[] = [];
  if (storageTone && disk) {
    vitals.push({
      key: "storage",
      tone: storageTone,
      title: t("health.storage"),
      text: `${t("health.storage.low")}: ${t("disk.freeOf", { free: formatBytes(disk.free), total: formatBytes(disk.total) })}`,
      go: () => navigate("overview"),
    });
  }
  if (memoryTone && health) vitals.push({ key: "memory", tone: memoryTone, title: t("health.memory"), text: tx(`health.pressure.${health.pressure}`) });
  if (batteryTone === "warn" && battery?.condition === "service") vitals.push({ key: "battery", tone: "warn", title: t("health.battery"), text: t("health.battery.service") });

  const flaggedRows = [...vitals, ...findings].filter((f) => f.tone === "warn" || f.tone === "bad");
  const restRows = findings.filter((f) => f.tone !== "warn" && f.tone !== "bad");
  const severe = flaggedRows.some((f) => f.tone === "bad");
  const checked = check.at !== null;
  // "Everything looks good" needs everything to have been looked at: every
  // step of the check-up done, and none of its answers "could not tell".
  const unanswered = findings.some((f) => f.tone === "unknown" && ["security", "startup", "unwanted", "malware"].includes(f.key));
  const complete = checked && check.complete && bloat !== null && malwareKnown && !unanswered;
  const bandTone: BandTone = flaggedRows.length > 0 ? (severe ? "bad" : "warn") : complete ? "ok" : "idle";
  const steps = ["security", "startup", "software", ...(malware?.engine.engine === "xprotect" && malware.engine.available ? ["malware"] : [])];

  // --- what uses the memory --------------------------------------------------
  const all = health?.top ?? [];
  const anyApp = all.some((c) => c.app);
  const top = (everything || !anyApp ? all : all.filter((c) => c.app)).slice(0, TOP_ROWS);
  const withQuit = top.some((c) => c.canQuit);
  const uptime = health && health.uptime > 0 ? t("health.uptime", { time: formatDuration(health.uptime) }) : null;

  return (
    <>
      <Header title={t("nav.health")} subtitle={health ? [health.host, health.os, uptime].filter(Boolean).join("  ·  ") : undefined} />

      <div className="content">
        <Band
          tone={bandTone}
          icon="pulse"
          busy={check.running}
          title={
            check.running
              ? t("health.status.checking", { device })
              : flaggedRows.length > 0
                ? tn("health.status.attention", flaggedRows.length)
                : t(complete ? "health.status.good" : checked ? "health.status.partial" : "health.status.unchecked")
          }
          actions={
            !check.running && (
              <button type="button" className={`btn large${checked ? "" : " primary"}`} onClick={() => void checkAll()}>
                {t(checked ? "health.checkAgain" : "health.check")}
              </button>
            )
          }
          list={
            !check.running && flaggedRows.length > 0
              ? flaggedRows.map((f) => (
                  <button key={f.key} type="button" className="band-item" data-tone={f.tone} disabled={!f.go} onClick={f.go}>
                    <span className={`status ${f.tone}`}>
                      <Icon name={TONE_ICON[f.tone]} size={13} stroke={2.8} />
                    </span>
                    <b>{f.title}</b>
                    <span>{f.text}</span>
                    {f.go && <Icon name="chevronRight" size={15} className="row-arrow" />}
                  </button>
                ))
              : null
          }
        >
          {check.running ? (
            <ul className="steps">
              {steps.map((step, i) => (
                <li key={step} className={i < check.step ? "done" : i === check.step ? "now" : ""}>
                  <span>{i < check.step ? <Icon name="check" size={13} stroke={2.8} /> : <i className="dot" />}</span>
                  {tx(`health.step.${step}`)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="band-sub">{checked ? t("health.status.checkedAt", { time: formatClock(check.at!) }) : t(windows ? "health.status.hintWin" : "health.status.hint")}</p>
          )}
        </Band>

        <div className={`vitals${battery ? "" : " three"}`}>
          {disk && (
            <Vital
              icon="disk"
              label={t("health.storage")}
              value={formatBytes(disk.free)}
              unit={t("health.free")}
              tone={storageTone}
              percent={usedPercent(disk)}
              lines={[disk.name, t("disk.usedOf", { used: formatBytes(disk.used), total: formatBytes(disk.total) })]}
              flag={storageTone ? t("health.storage.low") : null}
              onClick={() => {
                selectDisk(disk.root);
                navigate("overview");
              }}
            />
          )}
          {health && (
            <Vital
              icon="memory"
              label={t("health.memory")}
              value={formatMemory(health.memoryUsed)}
              unit={t("health.used")}
              tone={memoryTone}
              percent={health.memoryTotal > 0 ? (health.memoryUsed / health.memoryTotal) * 100 : 0}
              lines={[
                t("health.memory.of", { total: formatMemory(health.memoryTotal) }),
                health.pressure === "unknown" ? t("health.memory.available", { size: formatMemory(health.memoryAvailable) }) : tx(`health.pressure.${health.pressure}`),
              ]}
              onClick={() => memoryList.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />
          )}
          {health && (
            <Vital icon="cpu" label={t("health.cpu")} value={formatPercent(health.cpu)} lines={[health.cpuBrand, t("health.cores", { count: formatCount(health.cores) })]}>
              <Spark values={history} />
            </Vital>
          )}
          {battery && (
            <Vital
              icon="battery"
              label={t("health.battery")}
              value={battery.percent === null ? "–" : formatPercent(battery.percent)}
              unit={t(battery.charging ? "health.battery.charging" : battery.plugged ? "health.battery.plugged" : "health.battery.unplugged")}
              tone={batteryTone}
              percent={battery.percent ?? 0}
              lines={[
                battery.maxCapacity !== null ? t("health.battery.capacity", { percent: formatPercent(battery.maxCapacity) }) : null,
                battery.cycles !== null ? t("health.battery.cycles", { count: formatCount(battery.cycles) }) : null,
              ]}
              flag={battery.condition === "service" ? t("health.battery.service") : null}
            />
          )}
        </div>

        {restRows.length > 0 && (
          <>
            <h2 className="section">{t("health.report")}</h2>
            <div className="list flush">
              {restRows.map((f) => (
                <StatusRow key={f.key} line tone={f.tone} icon={f.icon} title={f.title} text={f.text} onClick={f.go} />
              ))}
            </div>
          </>
        )}

        {all.length > 0 && (
          <>
            <div className="section-tools">
              <h2 className="section" ref={memoryList}>
                {t("health.top")}
              </h2>
              {anyApp && all.some((c) => !c.app) && (
                <label className="switch">
                  <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} />
                  <i />
                  {t("health.top.all")}
                </label>
              )}
            </div>
            <div className="list flush">
              {top.map((item) => (
                <ConsumerRow key={item.path || item.name} item={item} total={health!.memoryTotal} quitting={quitting.includes(item.path)} withQuit={withQuit} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
