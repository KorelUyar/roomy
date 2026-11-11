import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Consumer } from "../api";
import { diskTone, fixableByDefault, flaggedStartup, harmful, healthScore, listIssues, openThreats, securityToCheck, testFiles, usedPercent } from "../findings";
import { formatAgo, formatBytes, formatClock, formatDuration, formatMemory, formatPercent, shortPath } from "../format";
import { formatCount, t, tn, tx } from "../i18n";
import { Icon } from "../icons";
import { checkAll, CPU_POINTS, navigate, quitConsumer, selectDisk, setState, useStore, watchHealth } from "../store";
import { FileIcon, Header, Ring, Segmented, SizeBar, StatusRow, TONE_ICON, type Tone } from "../ui";

const HALF_YEAR = 182 * 86400;
/** Below this, "you could clean up" is not worth a line. */
const WORTH_CLEANING = 500_000_000;
/** How many lines "Using the most" shows. */
const TOP_ROWS = 6;
const CHECK_STEPS = ["security", "startup", "software", "malware"];

/**
 * The last couple of minutes of one reading. The bottom is nothing, the top
 * is `top`. Drawn across the whole tile from the third reading on; before
 * that a line would only be a guess.
 */
function Spark({ values, top }: { values: number[]; top: number }) {
  const W = 100;
  const H = 30;
  // However many readings there are, they span the tile: a few seconds at first, the full two minutes later.
  const steps = Math.max(1, Math.min(values.length, CPU_POINTS) - 1);
  const x = (i: number) => W - (values.length - 1 - i) * (W / steps);
  const y = (v: number) => H - 1.5 - (Math.max(0, Math.min(top, v)) / top) * (H - 5);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const last = values[values.length - 1] ?? 0;
  // A handful of readings first: three points are a wedge, not a chart.
  const drawn = values.length >= 6;
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

/** An app, or a program that runs in the background, and how much of the computer it takes. */
function ConsumerRow({ item, by, most, quitting, withQuit }: { item: Consumer; by: "memory" | "cpu"; most: number; quitting: boolean; withQuit: boolean }) {
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
      {by === "memory" ? <SizeBar value={item.memory} max={most} /> : <SizeBar value={item.cpu} max={100} />}
      <span className="row-size">{by === "memory" ? formatMemory(item.memory) : formatPercent(item.cpu, item.cpu < 0.95 ? 1 : 0)}</span>
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
  const netHistory = useStore((s) => s.netHistory);
  const disks = useStore((s) => s.disks);
  const overviews = useStore((s) => s.overviews);
  const bloat = useStore((s) => s.bloat);
  const malware = useStore((s) => s.malware);
  const lastScan = useStore((s) => s.lastScan);
  const check = useStore((s) => s.check);
  const fixing = useStore((s) => s.fixing);
  const fixingOne = useStore((s) => s.fixingOne);
  const intended = useStore((s) => s.intended);
  const apps = useStore((s) => s.apps);
  const cleanup = useStore((s) => s.cleanup);
  const quitting = useStore((s) => s.quitting);
  const [everything, setEverything] = useState(false);
  const [by, setBy] = useState<"memory" | "cpu">("memory");
  const consumers = useRef<HTMLDivElement>(null);

  // The numbers are live for as long as this tab is open.
  useEffect(() => watchHealth(), []);

  if (!meta) return null;
  const windows = meta.platform === "windows";
  const device = t(windows ? "device.pc" : "device.mac");

  // --- the numbers -----------------------------------------------------------
  const system = disks.find((d) => d.system) ?? disks[0];
  const disk = system ? (overviews[system.root]?.disk ?? system) : null;
  const storageTone = diskTone(disk);
  const memoryTone = health?.pressure === "critical" ? "bad" : health?.pressure === "warn" ? "warn" : "";
  const heatTone = health?.thermal === "critical" ? "bad" : health?.thermal === "serious" ? "warn" : "";
  const battery = health?.battery ?? null;
  const batteryLow = battery?.percent != null && !battery.plugged && battery.percent <= 20;
  const batteryTone = battery?.condition === "service" ? "warn" : batteryLow ? (battery!.percent! <= 10 ? "bad" : "warn") : "";

  // --- the health of the whole thing -----------------------------------------
  const score = healthScore({ health, disk, bloat, malware, intended, cpuHistory: history });
  const issues = listIssues({ malware, bloat, intended, windows });
  const fixable = fixableByDefault(issues).length;
  // The same things are counted the same way everywhere: one by one.
  const things = score.deductions.reduce((sum, d) => sum + d.count, 0);
  const pointsOff = score.deductions.reduce((sum, d) => sum + d.points, 0);
  const off = (key: string) => score.deductions.find((d) => d.key === key)?.points;
  const withPoints = (text: string, key: string) => (off(key) ? `${text}  ·  −${off(key)}` : text);
  const checked = check.at !== null;
  const busy = fixingOne !== null || (fixing !== null && !fixing.finished);

  // --- what was looked at and is fine, and what could be tidied up ------------
  const toProtection = () => navigate("protection");
  const fine: Finding[] = [];
  const scanned = malware?.state === "done" && !malware.cancelled;
  if (openThreats(malware).length === 0) {
    if (malware?.state === "failed") {
      fine.push({ key: "malware", tone: "unknown", title: t("health.malware"), text: t("health.malware.failed"), go: toProtection });
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
      fine.push({ key: "malware", tone: dealtWith > 0 ? "info" : "ok", title: t("health.malware"), text, go: toProtection });
    } else if (malware?.engine.engine === "defender" && malware.engine.available) {
      fine.push({ key: "malware", tone: "ok", title: t("health.malware"), text: t("health.malware.defender"), go: toProtection });
    } else if (malware && !malware.engine.available) {
      fine.push({ key: "malware", tone: "unknown", title: t("health.malware"), text: t("health.malware.off"), go: toProtection });
    } else if (lastScan && lastScan.threats === 0) {
      fine.push({ key: "malware", tone: "ok", title: t("health.malware"), text: `${t("protection.scan.last", { when: formatAgo(lastScan.at / 1000) })}: ${t("protection.scan.lastClean")}`, go: toProtection });
    }
  }
  if (bloat) {
    // "All switched on" is only true of what could be read.
    const unread = bloat.security.filter((c) => c.status === "unknown").length;
    if (securityToCheck(bloat, intended).length === 0) {
      fine.push(
        unread > 0
          ? { key: "security", tone: "unknown", title: t("health.security"), text: tn("health.security.unknown", unread), go: toProtection }
          : { key: "security", tone: "ok", title: t("health.security"), text: t("health.security.good"), go: toProtection },
      );
    }
    if (flaggedStartup(bloat).length === 0) fine.push({ key: "startup", tone: "ok", title: t("health.startup"), text: tn("health.startup.count", bloat.startup.length), go: () => navigate("bloat") });
    if (bloat.unwanted.length === 0) fine.push({ key: "unwanted", tone: "ok", title: t("health.unwanted"), text: t("health.unwanted.none"), go: () => navigate("bloat") });
    // What merely came with the computer costs nothing, but is worth a line.
    else if (harmful(bloat).length === 0) fine.push({ key: "unwanted", tone: "info", title: t("health.unwanted"), text: tn("health.unwanted.taste", bloat.unwanted.length), go: toProtection });
  }
  if (health && health.diskHealth !== "failing") {
    fine.push({ key: "drive", tone: health.diskHealth === "ok" ? "ok" : "unknown", title: t("health.drive"), text: tx(`health.drive.${health.diskHealth}`) });
  }

  // Not states but chances: what could be tidied up.
  const cleanable = (cleanup ?? []).reduce((sum, g) => sum + g.size, 0);
  const now = Date.now() / 1000;
  const hasUsage = (apps ?? []).some((a) => a.lastUsed !== null);
  const unused = (apps ?? []).filter((a) => !a.running && (a.lastUsed === null || now - a.lastUsed > HALF_YEAR));
  if (cleanup && cleanable >= WORTH_CLEANING) {
    fine.push({ key: "cleanup", tone: "info", icon: "cleanup", title: t("health.cleanup"), text: t("health.cleanup.some", { size: formatBytes(cleanable) }), go: () => navigate("cleanup") });
  }
  if (apps && hasUsage && unused.length > 0) {
    fine.push({
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

  // "Excellent" has to be earned: every step of the check-up done, none of its answers "could not tell".
  const unanswered = fine.some((f) => f.tone === "unknown" && ["security", "startup", "unwanted", "malware"].includes(f.key));
  const complete = checked && check.complete && bloat !== null && malware !== null && !unanswered;
  // Until the check-up has run once there is no number to stand behind: only half of it is known.
  const waiting = !checked;
  const level = score.level === "great" && !complete ? "good" : score.level;
  const steps = CHECK_STEPS.slice(0, check.withMalware ? 4 : 3);

  // --- what uses the computer ------------------------------------------------
  const all = health?.top ?? [];
  const anyApp = all.some((c) => c.app);
  const top = (everything || !anyApp ? all : all.filter((c) => c.app))
    .slice()
    .sort((a, b) => (by === "memory" ? b.memory - a.memory : b.cpu - a.cpu))
    .slice(0, TOP_ROWS);
  const withQuit = top.some((c) => c.canQuit);
  const uptime = health && health.uptime > 0 ? t("health.uptime", { time: formatDuration(health.uptime) }) : null;
  const vitals = 3 + (battery ? 1 : 0) + (health ? 1 : 0);

  return (
    <>
      <Header title={t("nav.health")} subtitle={health ? [health.host, health.os, uptime].filter(Boolean).join("  ·  ") : undefined} />

      <div className="content">
        {/* The answer first: one number, the word for it, and every point that is missing with its reason. */}
        <section className={`condition ${waiting ? "unknown" : level}${check.running ? " checking" : ""}`}>
          <Ring value={waiting ? (check.running ? null : 0) : score.value / 100} size={104} stroke={9} tone={waiting ? "" : level}>
            <b>{waiting ? (check.running ? "…" : "–") : score.value}</b>
            {!waiting && <small>{t("health.score.of")}</small>}
          </Ring>
          <div className="condition-text">
            <span className="condition-label">
              <i className="live-dot" />
              {t("health.score.label", { device })}
            </span>
            <h2>{waiting ? (check.running ? t("health.status.checking", { device }) : t("health.score.unchecked")) : tx(`health.level.${level}`)}</h2>
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
              <p>{waiting ? t("health.score.uncheckedHint") : things > 0 ? tn("health.score.off", things, { points: pointsOff }) : t(complete ? "health.score.clean" : "health.score.partial")}</p>
            )}
          </div>
          <div className="condition-actions">
            {issues.length > fixable && fixable > 0 && <span className="needs-you">{tn("fix.needsYou", issues.length - fixable)}</span>}
            {fixable > 0 && (
              <button type="button" className="btn large primary" data-fix-all disabled={busy || check.running} onClick={() => setState({ fixAsk: issues })}>
                {tn("fix.all", fixable)}
              </button>
            )}
            <button type="button" className={`btn large${fixable > 0 ? "" : " primary"}`} data-check disabled={check.running || busy} onClick={() => void checkAll()}>
              {t(checked ? "health.checkAgain" : "health.check")}
            </button>
          </div>
          {/* Points only where there is a number to take them off. */}
          {!waiting && score.deductions.length > 0 && (
            <div className="band-list">
              {score.deductions.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className="band-item"
                  data-tone={d.tone}
                  disabled={!d.view}
                  // "Storage" is about the system disk, whichever one is being looked at.
                  onClick={() => (d.key === "storage" && system ? selectDisk(system.root) : d.view && navigate(d.view))}
                >
                  <span className={`status ${d.tone}`}>
                    <Icon name={TONE_ICON[d.tone]} size={13} stroke={2.8} />
                  </span>
                  <b>{d.title}</b>
                  <span>{d.text}</span>
                  <em>−{d.points}</em>
                  {d.view && <Icon name="chevronRight" size={15} className="row-arrow" />}
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="vitals" data-count={vitals}>
          {disk && (
            <Vital
              icon="disk"
              label={t("health.storage")}
              value={formatBytes(disk.free)}
              unit={t("health.free")}
              tone={storageTone}
              percent={usedPercent(disk)}
              lines={[disk.name, t("health.memory.of", { total: formatBytes(disk.total) })]}
              flag={storageTone ? withPoints(t("health.storage.low"), "storage") : null}
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
              flag={memoryTone ? withPoints(tx(`health.pressure.${health.pressure}`), "memory") : null}
              percent={health.memoryTotal > 0 ? (health.memoryUsed / health.memoryTotal) * 100 : 0}
              lines={[
                t("health.memory.of", { total: formatMemory(health.memoryTotal) }),
                health.pressure === "unknown" ? t("health.memory.available", { size: formatMemory(health.memoryAvailable) }) : tx(`health.pressure.${health.pressure}`),
              ]}
              onClick={() => {
                setBy("memory");
                consumers.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
          )}
          {health && (
            <Vital
              icon="cpu"
              label={t("health.cpu")}
              value={formatPercent(health.cpu)}
              tone={heatTone}
              flag={heatTone ? withPoints(tx(`health.thermal.${health.thermal}`), "thermal") : null}
              lines={[health.cpuBrand, health.thermal === "unknown" ? t("health.cores", { count: formatCount(health.cores) }) : tx(`health.thermal.${health.thermal}`)]}
              onClick={() => {
                setBy("cpu");
                consumers.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Spark values={history} top={100} />
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
              flag={battery.condition === "service" ? withPoints(t("health.battery.service"), "battery") : null}
            />
          )}
          {health && (
            <Vital icon="network" label={t("health.network")} value={`↓ ${formatBytes(health.netDown)}/s`} lines={[`↑ ${formatBytes(health.netUp)}/s`]}>
              <Spark values={netHistory} top={Math.max(512 * 1024, ...netHistory)} />
            </Vital>
          )}
        </div>

        {fine.length > 0 && (
          <>
            <h2 className="section">
              {t("health.report")} {checked && !check.running && <span>{t("health.report.at", { time: formatClock(check.at!) })}</span>}
            </h2>
            <div className="list flush">
              {fine.map((f) => (
                <StatusRow key={f.key} line tone={f.tone} icon={f.icon} title={f.title} text={f.text} onClick={f.go} />
              ))}
            </div>
          </>
        )}

        {all.length > 0 && (
          <>
            <div className="section-tools" ref={consumers}>
              <h2 className="section">{t("health.top")}</h2>
              <span className="section-controls">
                {anyApp && all.some((c) => !c.app) && (
                  <label className="switch">
                    <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} />
                    <i />
                    {t("health.top.all")}
                  </label>
                )}
                <Segmented
                  value={by}
                  onChange={setBy}
                  options={[
                    { value: "memory", label: t("health.memory") },
                    { value: "cpu", label: t("health.cpu") },
                  ]}
                />
              </span>
            </div>
            <div className="list flush">
              {top.map((item) => (
                <ConsumerRow key={item.path || item.name} item={item} by={by} most={Math.max(...top.map((c) => c.memory))} quitting={quitting.includes(item.path)} withQuit={withQuit} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
