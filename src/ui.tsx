// Small building blocks shared by every view.

import { useEffect, useState, type ReactNode } from "react";
import { api, type Kind } from "./api";
import { Icon } from "./icons";

/** Round tick box. `mixed` = some of a group, `locked` = cannot be selected. */
export function Checkbox({
  checked,
  mixed,
  locked,
  title,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  locked?: boolean;
  title?: string;
  onChange?: () => void;
}) {
  if (locked) {
    return (
      <span className="check locked" title={title}>
        <Icon name="lock" size={12} stroke={2} />
      </span>
    );
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      title={title}
      className={`check${checked || mixed ? " on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.();
      }}
    >
      {mixed ? <Icon name="minus" size={12} stroke={3} /> : checked ? <Icon name="check" size={12} stroke={3} /> : null}
    </button>
  );
}

const failedIcons = new Set<string>();

/**
 * The real system icon when the backend can provide one, otherwise a tinted
 * tile with a glyph for the kind of file.
 */
export function FileIcon({ path, kind, size = 32, name }: { path: string | null; kind: Kind; size?: number; name?: string }) {
  const url = path ? api.iconUrl(path, size * 2) : null;
  const [failed, setFailed] = useState(url ? failedIcons.has(url) : true);
  useEffect(() => setFailed(url ? failedIcons.has(url) : true), [url]);

  if (url && !failed) {
    return (
      <img
        className="icon-img"
        src={url}
        width={size}
        height={size}
        alt=""
        draggable={false}
        onError={() => {
          failedIcons.add(url);
          setFailed(true);
        }}
      />
    );
  }
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  if (kind === "app" && name) {
    return (
      <span className="tile tile-letter" style={{ ...style, fontSize: size * 0.44 }}>
        {name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={`tile tile-${kind}`} style={style}>
      <Icon name={kind} size={Math.round(size * 0.54)} stroke={1.7} />
    </span>
  );
}

/** Thin bar: how big is this compared to the biggest item in the list. */
export function SizeBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="bar" aria-hidden="true">
      <i style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export function Empty({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Title row of a view. The empty space doubles as the window's drag area. */
export function Header({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="header" data-tauri-drag-region>
      <div className="header-text" data-tauri-drag-region>
        <h1 data-tauri-drag-region>{title}</h1>
        {subtitle && <p data-tauri-drag-region>{subtitle}</p>}
      </div>
      <div className="header-tools">{children}</div>
    </header>
  );
}

export function Skeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="row skeleton" key={i}>
          <span className="sk sk-check" />
          <span className="sk sk-icon" />
          <span className="sk sk-text" style={{ width: `${28 + ((i * 37) % 30)}%` }} />
          <span className="sk sk-size" />
        </div>
      ))}
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "info" | "unknown";

export const TONE_ICON: Record<Tone, string> = { ok: "check", warn: "bang", bad: "bang", info: "info", unknown: "minus" };

/**
 * One line of a report: a state, what it is about and what was found. The
 * sign never stands alone; the words next to it say the same.
 */
export function StatusRow({
  tone,
  icon,
  title,
  text,
  line,
  onClick,
  children,
}: {
  tone: Tone;
  /** Another sign than the one the state has by default. */
  icon?: string;
  title: ReactNode;
  text?: ReactNode;
  /** Title and text next to each other on one line. */
  line?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className={`status ${icon ? "" : tone}`}>
        <Icon name={icon ?? TONE_ICON[tone]} size={icon ? 17 : 15} stroke={icon ? 1.8 : 2.6} />
      </span>
      <span className="row-main">
        <span className="row-title">{title}</span>
        {text && <span className={`row-sub${line ? "" : " wrap"}`}>{text}</span>}
      </span>
      {children}
      {onClick && <Icon name="chevronRight" size={15} className="row-arrow" />}
    </>
  );
  return onClick ? (
    <button type="button" className={`row clickable ${line ? "line" : "tall"}`} data-tone={tone} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`row ${line ? "line" : "tall"}`} data-tone={tone}>
      {body}
    </div>
  );
}

export type BandTone = "idle" | "ok" | "warn" | "bad" | "unknown";

/**
 * What a tab leads with: a sign, a sentence and what to do about it.
 * A result (good, look at this, wrong) draws its own sign; `icon` is for
 * the states before there is one.
 */
export function Band({
  tone,
  icon,
  busy,
  title,
  children,
  actions,
  list,
  foot,
}: {
  tone: BandTone;
  icon: string;
  busy?: boolean;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** What the sentence counts, as rows right under it. */
  list?: ReactNode;
  foot?: ReactNode;
}) {
  const result = tone === "ok" || tone === "warn" || tone === "bad";
  return (
    <section className={`band ${busy ? "idle" : tone}`}>
      <span className="band-mark" key={busy ? "busy" : tone}>
        {busy ? (
          <span className="spinner" />
        ) : result ? (
          <svg className="drawn" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {tone === "ok" ? (
              <path pathLength={1} d="M19.5 6.5 9.5 17l-5-5" />
            ) : (
              <>
                <path pathLength={1} d="M12 5.5v8" />
                <path pathLength={1} d="M12 18h.01" />
              </>
            )}
          </svg>
        ) : (
          <Icon name={icon} size={24} stroke={1.8} />
        )}
      </span>
      <div className="band-text">
        <h2 className="band-title">{title}</h2>
        {children}
      </div>
      {actions && <div className="band-actions">{actions}</div>}
      {list && <div className="band-list">{list}</div>}
      {foot && <div className="band-foot">{foot}</div>}
    </section>
  );
}
