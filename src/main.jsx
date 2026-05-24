import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  Inbox,
  Link2,
  LockKeyhole,
  Pin,
  PinOff,
  Plus,
  ScanLine,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import { createClipPayload, displayText, openableUrl } from "./clip.js";
import { createContentKey, encodeContentKey, openClip, readContentKey, sealClip } from "./crypto.js";
import "./styles.css";

const filters = [
  { id: "all", label: "All", Icon: Inbox },
  { id: "link", label: "Links", Icon: Link2 },
  { id: "text", label: "Text", Icon: Clipboard },
  { id: "snippet", label: "Snippets", Icon: Code2 },
  { id: "code", label: "Codes", ariaLabel: "Short codes", Icon: Clipboard }
];

const expiryChoices = [
  { value: "10m", label: "10 min" },
  { value: "1h", label: "1 hour" },
  { value: "today", label: "Today" },
  { value: "keep", label: "Keep" }
];

function timeLabel(time) {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function createOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function expiryLabel(clip) {
  if (clip.pinned) return "Kept";
  const minutes = Math.max(0, Math.ceil((clip.expiresAt - Date.now()) / 60000));
  if (minutes <= 10) return `${minutes}m left`;
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.ceil(minutes / 60)}h left`;
}

function kindDetails(kind) {
  if (kind === "link") return { label: "Link", Icon: Link2 };
  if (kind === "code") return { label: "Code", Icon: Clipboard };
  if (kind === "snippet") return { label: "Snippet", Icon: Code2 };
  return { label: "Text", Icon: Inbox };
}

async function putOnClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  }
}

function ConnectionPill({ status, pendingCount = 0 }) {
  const labels = {
    connecting: "Connecting",
    reconnecting: "Resuming",
    error: "Pair again",
    online: "Synced"
  };
  const label = pendingCount ? (status === "online" ? "Sending" : `${pendingCount} queued`) : labels[status];
  return (
    <span className={`connection ${status}`}>
      <span className="connection-dot" />
      {label}
    </span>
  );
}

function SecurityChip({ caution = false }) {
  return (
    <span className={`security-chip ${caution ? "caution" : ""}`}>
      {caution ? <ShieldAlert size={13} /> : <LockKeyhole size={13} />}
      {caution ? "Local preview" : "Encrypted"}
    </span>
  );
}

function IconButton({ children, title, ...props }) {
  return (
    <button className="icon-button" title={title} aria-label={title} {...props}>
      {children}
    </button>
  );
}

function ClipItem({ clip, onCopy, onPin, onDelete, compact = false }) {
  const { label, Icon } = kindDetails(clip.kind);
  return (
    <article className={`clip-item ${compact ? "compact" : ""} ${clip.kind}`}>
      <div className="clip-meta">
        <span className="kind">
          <Icon size={13} />
          {label}
        </span>
        <span>{clip.source}</span>
        <span>{timeLabel(clip.createdAt)}</span>
        <span className={clip.pinned ? "kept" : ""}>{expiryLabel(clip)}</span>
      </div>
      <p className={clip.kind === "snippet" ? "monospace" : ""}>{displayText(clip)}</p>
      <div className="clip-actions">
        <button className="primary-small" onClick={() => onCopy(clip)}>
          <Copy size={14} />
          Copy
        </button>
        {clip.kind === "link" && (
          <button
            className="secondary-small"
            onClick={() => window.open(openableUrl(clip), "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={14} />
            Open
          </button>
        )}
        <span className="action-spacer" />
        <IconButton title={clip.pinned ? "Unpin" : "Keep"} onClick={() => onPin(clip.id)}>
          {clip.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </IconButton>
        <IconButton title="Delete" onClick={() => onDelete(clip.id)}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </article>
  );
}

function Composer({ device, send, available, expanded = false }) {
  const [text, setText] = useState("");
  const [duration, setDuration] = useState("1h");
  const [showExpiry, setShowExpiry] = useState(false);
  const areaRef = useRef(null);
  const textAreaId = useId();

  async function readClipboard() {
    try {
      const content = await navigator.clipboard.readText();
      if (content) setText(content);
    } catch {
      areaRef.current?.focus();
    }
  }

  function submit() {
    if (!text.trim()) return;
    if (send(text, duration)) setText("");
  }

  return (
    <section className={`composer ${expanded ? "expanded" : ""}`}>
      {expanded && (
        <div className="composer-heading">
          <span className="destination">
            <SendHorizontal size={14} />
            Mac
          </span>
          <span className="secure-inline">
            <LockKeyhole size={13} />
            Encrypted
          </span>
        </div>
      )}
      <label className="sr-only" htmlFor={textAreaId}>
        Text to send from {device}
      </label>
      <textarea
        id={textAreaId}
        ref={areaRef}
        value={text}
        placeholder={device === "Mac" ? "Paste or use current clipboard" : "Paste text or a link"}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="composer-tools">
        {device === "Mac" && (
          <button className="secondary-small" onClick={readClipboard}>
            <Clipboard size={15} />
            Current clipboard
          </button>
        )}
        {expanded ? (
          <div className="expiry-segments" role="group" aria-label="Expiration">
            {expiryChoices.map((choice) => (
              <button
                key={choice.value}
                className={duration === choice.value ? "selected" : ""}
                onClick={() => setDuration(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="expiry-control">
            <button
              className="secondary-small"
              aria-expanded={showExpiry}
              onClick={() => setShowExpiry(!showExpiry)}
            >
              <Clock3 size={15} />
              {expiryChoices.find((choice) => choice.value === duration)?.label}
              <ChevronDown size={13} />
            </button>
            {showExpiry && (
              <div className="expiry-menu">
                {expiryChoices.map((choice) => (
                  <button
                    key={choice.value}
                    className={duration === choice.value ? "selected" : ""}
                    onClick={() => {
                      setDuration(choice.value);
                      setShowExpiry(false);
                    }}
                  >
                    {choice.label}
                    {duration === choice.value && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="send-button" onClick={submit} disabled={!text.trim() || !available}>
          <SendHorizontal size={16} />
          Send
        </button>
      </div>
    </section>
  );
}

function FilterBar({ active, onChange, counts = {} }) {
  return (
    <nav className="filter-bar" aria-label="Clip filters">
      {filters.map((filter) => (
        <button
          key={filter.id}
          aria-label={filter.ariaLabel || filter.label}
          className={active === filter.id ? "active" : ""}
          onClick={() => onChange(filter.id)}
        >
          <filter.Icon className="filter-icon" size={13} aria-hidden="true" />
          <span>{filter.label}</span>
          <span className="filter-count" aria-hidden="true">
            {counts[filter.id] ?? 0}
          </span>
        </button>
      ))}
    </nav>
  );
}

function StatusBanner({ message }) {
  if (!message) return null;
  return (
    <p className="status-banner" role="alert">
      {message}
    </p>
  );
}

function MacView({ clips, status, pendingCount, error, config, send, action, toast }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const filterCounts = useMemo(
    () =>
      filters.reduce((counts, item) => {
        counts[item.id] = item.id === "all" ? clips.length : clips.filter((clip) => clip.kind === item.id).length;
        return counts;
      }, {}),
    [clips]
  );
  const shown = clips.filter(
    (clip) =>
      (filter === "all" || clip.kind === filter) &&
      (!query || clip.text.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <main className="mac-workspace">
      <div className="mac-menubar">
        <div className="menubar-brand">
          <span className="menu-symbol"><Clipboard size={15} /></span>
          ClipKeep
        </div>
        <div className="menu-status">
          <SecurityChip />
          <ConnectionPill status={status} pendingCount={pendingCount} />
        </div>
      </div>
      <section className="mac-layout">
        <aside className="pair-panel">
          <div className="brand">
            <span className="brand-mark"><Clipboard size={20} /></span>
            <div>
              <h1>ClipKeep</h1>
              <p>Secure handoff</p>
            </div>
          </div>
          <div className="qr-panel">
            <header className="qr-header">
              <span className="qr-icon"><ScanLine size={15} /></span>
              <div>
                <h2>Pair iPhone</h2>
                <p>Scan to join</p>
              </div>
            </header>
            {config?.qr ? (
              <img src={config.qr} alt="iPhone pairing QR code" />
            ) : (
              <p className="pair-message">Open the Mac session link printed in the terminal.</p>
            )}
            <div className="pair-tags">
              <SecurityChip />
              <SecurityChip caution />
            </div>
          </div>
          <div className="transport-note">
            <ShieldAlert size={15} />
            <span>HTTPS required for private text</span>
          </div>
        </aside>
        <section className="popover" aria-label="Clip inbox">
          <header className="popover-header">
            <div>
              <h2>Clips</h2>
              <p>{clips.length ? `${clips.length} available` : "Inbox empty"}</p>
            </div>
            <IconButton
              title="Clear inbox"
              disabled={!clips.length}
              onClick={() => window.confirm("Clear all active clips?") && action("clear")}
            >
              <Trash2 size={17} />
            </IconButton>
          </header>
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="Search clips"
              value={query}
              placeholder="Search clips"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
          <FilterBar active={filter} onChange={setFilter} counts={filterCounts} />
          <StatusBanner message={error} />
          <div className="clip-list">
            {shown.map((clip) => (
              <ClipItem
                key={clip.id}
                clip={clip}
                compact
                onCopy={toast}
                onPin={(id) => action("pin", id)}
                onDelete={(id) => action("delete", id)}
              />
            ))}
            {!shown.length && <EmptyState />}
          </div>
          <Composer device="Mac" available={status === "online" || status === "reconnecting"} send={send} />
        </section>
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Inbox size={23} /></span>
      <h2>No clips yet</h2>
      <p>No clips in this view</p>
    </div>
  );
}

function PhoneView({ clips, status, pendingCount, error, send, action, toast }) {
  const [tab, setTab] = useState("inbox");
  const [filter, setFilter] = useState("all");
  const filterCounts = useMemo(
    () =>
      filters.reduce((counts, item) => {
        counts[item.id] = item.id === "all" ? clips.length : clips.filter((clip) => clip.kind === item.id).length;
        return counts;
      }, {}),
    [clips]
  );
  const shown = clips.filter((clip) => filter === "all" || clip.kind === filter);

  return (
    <main className="phone-screen">
      <header className="phone-header">
        <div className="brand">
          <span className="brand-mark"><Clipboard size={19} /></span>
          <h1>ClipKeep</h1>
        </div>
        <div className="phone-badges">
          <ShieldCheck className="lock-status" size={17} />
          <ConnectionPill status={status} pendingCount={pendingCount} />
        </div>
      </header>
      <nav className="phone-tabs">
        <button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>
          <Inbox size={18} />
          Inbox
        </button>
        <button className={tab === "send" ? "active" : ""} onClick={() => setTab("send")}>
          <Plus size={18} />
          Send
        </button>
      </nav>
      <StatusBanner message={error} />
      {tab === "send" ? (
        <div className="phone-compose">
          <header className="view-heading">
            <h2>Send</h2>
            <SecurityChip caution />
          </header>
          <p className="mobile-transport-note">
            <ShieldAlert size={14} />
            Encrypted clips; HTTPS required for private text.
          </p>
          <Composer
            device="iPhone"
            available={status === "online" || status === "reconnecting"}
            expanded
            send={send}
          />
        </div>
      ) : (
        <>
          <header className="view-heading inbox-heading">
            <h2>Inbox</h2>
            <span>{clips.length}</span>
          </header>
          <FilterBar active={filter} onChange={setFilter} counts={filterCounts} />
          <section className="phone-list">
            {shown.map((clip) => (
              <ClipItem
                key={clip.id}
                clip={clip}
                onCopy={toast}
                onPin={(id) => action("pin", id)}
                onDelete={(id) => action("delete", id)}
              />
            ))}
            {!shown.length && <EmptyState />}
          </section>
        </>
      )}
    </main>
  );
}

function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [device] = useState(params.get("device") === "iphone" ? "iPhone" : "Mac");
  const [config, setConfig] = useState(null);
  const [clips, setClips] = useState([]);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");
  const [decryptionError, setDecryptionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const socketRef = useRef(null);
  const retryRef = useRef(null);
  const toastRef = useRef(null);
  const statusDelayRef = useRef(null);
  const warningDelayRef = useRef(null);
  const onlineRef = useRef(false);
  const outboxRef = useRef([]);
  const flushRef = useRef(() => {});
  const keyRef = useRef(null);
  const outboxStorageKeyRef = useRef("");

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let activeRoom = "";
    let wasHidden = false;

    function clearRecoveryTimers() {
      window.clearTimeout(retryRef.current);
      window.clearTimeout(statusDelayRef.current);
      window.clearTimeout(warningDelayRef.current);
    }

    function markPendingForRetry() {
      outboxRef.current.forEach((operation) => {
        operation.sent = false;
      });
      persistOutbox();
    }

    function persistOutbox() {
      if (!outboxStorageKeyRef.current) return;
      const pending = outboxRef.current.map(({ sent, ...operation }) => operation);
      if (pending.length) {
        window.localStorage.setItem(outboxStorageKeyRef.current, JSON.stringify(pending));
      } else {
        window.localStorage.removeItem(outboxStorageKeyRef.current);
      }
    }

    function restoreOutbox(room) {
      outboxStorageKeyRef.current = `clipkeep:pending:${room}`;
      try {
        const pending = JSON.parse(window.localStorage.getItem(outboxStorageKeyRef.current) || "[]");
        outboxRef.current = Array.isArray(pending)
          ? pending.map((operation) => ({ ...operation, sent: false }))
          : [];
      } catch {
        outboxRef.current = [];
        window.localStorage.removeItem(outboxStorageKeyRef.current);
      }
      setPendingCount(outboxRef.current.length);
    }

    function pauseConnection() {
      const current = socketRef.current;
      socketRef.current = null;
      onlineRef.current = false;
      markPendingForRetry();
      if (current) {
        current.onclose = null;
        current.close(1000, "Page paused");
      }
    }

    function recoverNow() {
      if (!activeRoom || disposed) return;
      clearRecoveryTimers();
      pauseConnection();
      connect(activeRoom);
    }

    function connect(room) {
      if (disposed) return;
      const existing = socketRef.current;
      if (existing && [WebSocket.CONNECTING, WebSocket.OPEN].includes(existing.readyState)) return;
      if (!onlineRef.current && !retries) setStatus("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/socket?room=${room}`);
      socketRef.current = socket;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "state") {
          let invalidCount = 0;
          const visibleClips = message.clips.flatMap((clip) => {
            try {
              return [{ ...clip, ...openClip(keyRef.current, clip.envelope) }];
            } catch {
              invalidCount += 1;
              return [];
            }
          });
          clearRecoveryTimers();
          setClips(visibleClips);
          setDecryptionError(invalidCount ? "A clip could not be decrypted for this paired device." : "");
          setStatus("online");
          setError("");
          onlineRef.current = true;
          retries = 0;
          flushRef.current();
        }
        if (message.type === "ack") {
          const operation = outboxRef.current.find((item) => item.operationId === message.operationId);
          outboxRef.current = outboxRef.current.filter((item) => item.operationId !== message.operationId);
          persistOutbox();
          setPendingCount(outboxRef.current.length);
          if (operation?.type === "add") notify("Sent");
        }
      };
      socket.onclose = (event) => {
        if (disposed || socket !== socketRef.current) return;
        socketRef.current = null;
        onlineRef.current = false;
        markPendingForRetry();
        if (event.code === 1008) {
          clearRecoveryTimers();
          setStatus("error");
          setError("This pairing is no longer valid. Scan the QR code again.");
          return;
        }
        statusDelayRef.current = window.setTimeout(() => setStatus("reconnecting"), 900);
        warningDelayRef.current = window.setTimeout(
          () => setError("Still reconnecting. Keep this page open and check Wi-Fi."),
          5000
        );
        retries += 1;
        retryRef.current = window.setTimeout(
          () => connect(room),
          Math.min(4000, 250 * 2 ** retries) + Math.floor(Math.random() * 150)
        );
      };
    }

    async function start() {
      try {
        let room = params.get("room");
        let key = readContentKey(window.location.hash);
        if (device === "Mac") {
          const host = params.get("host");
          if (!host) throw new Error("Open the Mac session link printed in the terminal.");
          if (!key) {
            key = createContentKey();
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#key=${encodeContentKey(key)}`);
          }
          const response = await fetch(`/api/config?host=${encodeURIComponent(host)}`);
          if (!response.ok) throw new Error("Open a new Mac session link from the terminal.");
          const nextConfig = await response.json();
          const phoneUrl = `${nextConfig.phoneUrl}#key=${encodeContentKey(key)}`;
          setConfig({ ...nextConfig, qr: await QRCode.toDataURL(phoneUrl, { margin: 1, width: 300 }) });
          room = nextConfig.room;
        } else if (!room || !key) {
          throw new Error("Scan the QR code shown on your Mac to pair this iPhone securely.");
        }

        if (disposed) return;
        keyRef.current = key;
        activeRoom = room;
        restoreOutbox(room);
        connect(room);
      } catch (nextError) {
        setStatus("error");
        setError(nextError.message);
      }
    }

    function resumeFromBackground() {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        pauseConnection();
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        recoverNow();
      }
    }

    function restoreNetwork() {
      recoverNow();
    }

    function restorePage(event) {
      if (event.persisted) recoverNow();
    }

    flushRef.current = () => {
      const current = socketRef.current;
      if (!onlineRef.current || current?.readyState !== WebSocket.OPEN) return;
      outboxRef.current.forEach((operation) => {
        if (operation.sent) return;
        operation.sent = true;
        const { sent, ...payload } = operation;
        current.send(JSON.stringify(payload));
      });
      persistOutbox();
    };

    start();
    document.addEventListener("visibilitychange", resumeFromBackground);
    window.addEventListener("online", restoreNetwork);
    window.addEventListener("pageshow", restorePage);
    return () => {
      disposed = true;
      clearRecoveryTimers();
      document.removeEventListener("visibilitychange", resumeFromBackground);
      window.removeEventListener("online", restoreNetwork);
      window.removeEventListener("pageshow", restorePage);
      pauseConnection();
    };
  }, [device, params]);

  useEffect(() => () => window.clearTimeout(toastRef.current), []);

  function notify(message) {
    window.clearTimeout(toastRef.current);
    setNotice(message);
    toastRef.current = window.setTimeout(() => setNotice(""), 1600);
  }

  function queueOperation(message) {
    if (status === "error") {
      notify("Pair again first");
      return false;
    }
    const operation = {
      ...message,
      operationId: createOperationId(),
      sent: false
    };
    outboxRef.current.push(operation);
    const pending = outboxRef.current.map(({ sent, ...queued }) => queued);
    if (outboxStorageKeyRef.current) {
      window.localStorage.setItem(outboxStorageKeyRef.current, JSON.stringify(pending));
    }
    setPendingCount(outboxRef.current.length);
    const readyNow = onlineRef.current && socketRef.current?.readyState === WebSocket.OPEN;
    flushRef.current();
    if (!readyNow) notify("Queued until reconnected");
    return true;
  }

  function action(type, id) {
    return queueOperation({ type, id });
  }

  function send(text, duration) {
    const clip = createClipPayload(text, device);
    return queueOperation({ type: "add", envelope: sealClip(keyRef.current, clip), duration });
  }

  async function copyClip(clip) {
    const copied = await putOnClipboard(clip.text);
    notify(copied ? "Copied" : "Copy unavailable");
  }

  return (
    <>
      {device === "Mac" ? (
        <MacView
          clips={clips}
          status={status}
          pendingCount={pendingCount}
          error={error || decryptionError}
          config={config}
          send={send}
          action={action}
          toast={copyClip}
        />
      ) : (
        <PhoneView
          clips={clips}
          status={status}
          pendingCount={pendingCount}
          error={error || decryptionError}
          send={send}
          action={action}
          toast={copyClip}
        />
      )}
      {notice && (
        <div className="toast" role="status" aria-live="polite">
          {notice}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
