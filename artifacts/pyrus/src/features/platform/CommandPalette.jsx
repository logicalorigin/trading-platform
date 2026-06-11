import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  ChartCandlestick,
  Eye,
  EyeOff,
  Gauge,
  LineChart,
  Moon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Sun,
  TrendingUp,
  WalletCards,
  Zap,
} from "lucide-react";
import {
  CSS_COLOR,
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { SCREENS } from "./screenRegistry.jsx";

const SCREEN_ICONS = {
  market: LineChart,
  flow: Zap,
  gex: Gauge,
  trade: ChartCandlestick,
  account: WalletCards,
  research: SearchIcon,
  algo: Bot,
  backtest: ChartCandlestick,
  diagnostics: Gauge,
  settings: SettingsIcon,
};

const buildScreenCommands = (handleSetScreen) =>
  SCREENS.map((screen) => ({
    id: `screen:${screen.id}`,
    label: `Go to ${screen.label}`,
    hint: "Screen",
    icon: SCREEN_ICONS[screen.id] || LineChart,
    keywords: `${screen.id} ${screen.label.toLowerCase()} navigate goto open`,
    run: () => handleSetScreen(screen.id),
  }));

const buildSystemCommands = ({ theme, onToggleTheme, scrollersCollapsed, onToggleScrollers }) => {
  const commands = [];
  if (typeof onToggleTheme === "function") {
    commands.push({
      id: "theme:toggle",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      hint: "Appearance",
      icon: theme === "dark" ? Sun : Moon,
      keywords: "theme dark light appearance mode color",
      run: () => onToggleTheme(),
    });
  }
  if (typeof onToggleScrollers === "function") {
    commands.push({
      id: "scrollers:toggle",
      label: scrollersCollapsed ? "Show live event scrollers" : "Hide live event scrollers",
      hint: "Header",
      icon: scrollersCollapsed ? Eye : EyeOff,
      keywords: "scrollers tape signals flow algo header collapse expand show hide",
      run: () => onToggleScrollers(),
    });
  }
  return commands;
};

const normalizeSymbolInput = (raw) => {
  const trimmed = String(raw || "").trim().toUpperCase();
  if (!trimmed) return "";
  if (!/^[A-Z0-9.\-_/]{1,12}$/.test(trimmed)) return "";
  return trimmed;
};

const rankResults = (commands, query) => {
  const lower = String(query || "").toLowerCase().trim();
  if (!lower) return commands;
  const scored = [];
  for (const command of commands) {
    const labelLower = command.label.toLowerCase();
    const keywordsLower = String(command.keywords || "").toLowerCase();
    let score = 0;
    if (labelLower.startsWith(lower)) score += 100;
    else if (labelLower.includes(lower)) score += 60;
    if (keywordsLower.includes(lower)) score += 30;
    if (score > 0) scored.push({ command, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.command);
};

const CommandPaletteInner = ({
  open,
  onClose,
  onSelectSymbol,
  handleSetScreen,
  theme,
  onToggleTheme,
  scrollersCollapsed,
  onToggleScrollers,
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 16);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  const commands = useMemo(() => {
    const screenCmds = buildScreenCommands(handleSetScreen);
    const systemCmds = buildSystemCommands({
      theme,
      onToggleTheme,
      scrollersCollapsed,
      onToggleScrollers,
    });
    return [...screenCmds, ...systemCmds];
  }, [handleSetScreen, theme, onToggleTheme, scrollersCollapsed, onToggleScrollers]);

  const symbolCandidate = useMemo(() => normalizeSymbolInput(query), [query]);

  const results = useMemo(() => {
    const ranked = rankResults(commands, query);
    if (symbolCandidate && typeof onSelectSymbol === "function") {
      return [
        {
          id: `symbol:${symbolCandidate}`,
          label: `Open chart for ${symbolCandidate}`,
          hint: "Symbol",
          icon: TrendingUp,
          keywords: symbolCandidate.toLowerCase(),
          run: () => onSelectSymbol(symbolCandidate),
        },
        ...ranked,
      ];
    }
    return ranked;
  }, [commands, query, symbolCandidate, onSelectSymbol]);

  useEffect(() => {
    if (activeIndex >= results.length) {
      setActiveIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, activeIndex]);

  const handleRun = useCallback(
    (command) => {
      if (!command) return;
      command.run();
      onClose();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(results.length - 1, current + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        handleRun(results[activeIndex]);
      }
    },
    [results, activeIndex, handleRun, onClose],
  );

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: "min(520px, 92vw)",
          maxHeight: "70vh",
          background: CSS_COLOR.bg1,
          border: `1px solid ${CSS_COLOR.border}`,
          borderRadius: dim(RADII.md),
          boxShadow: ELEVATION?.lg || "0 16px 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: T.sans,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(4),
            padding: sp("8px 12px"),
            borderBottom: `1px solid ${CSS_COLOR.borderLight}`,
          }}
        >
          <SearchIcon size={dim(16)} strokeWidth={2.2} color={CSS_COLOR.textSec} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search symbols, screens, or actions…"
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: CSS_COLOR.text,
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.medium,
              fontFamily: T.sans,
              padding: 0,
            }}
          />
          <kbd
            style={{
              fontSize: fs(9),
              fontFamily: T.mono,
              color: CSS_COLOR.textMuted,
              padding: sp("1px 5px"),
              border: `1px solid ${CSS_COLOR.borderLight}`,
              borderRadius: dim(RADII.xs),
              background: CSS_COLOR.bg0,
            }}
          >
            esc
          </kbd>
        </div>
        <div
          role="listbox"
          aria-label="Command results"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: sp(2),
          }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: sp("12px 16px"),
                color: CSS_COLOR.textMuted,
                fontSize: textSize("body"),
                textAlign: "center",
              }}
            >
              No matches. Try a screen name (Market, Flow, Trade…) or a symbol.
            </div>
          ) : (
            results.map((command, index) => {
              const Icon = command.icon || SearchIcon;
              const isActive = index === activeIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => handleRun(command)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sp(4),
                    width: "100%",
                    padding: sp("8px 10px"),
                    background: isActive ? CSS_COLOR.accentHoverBg : "transparent",
                    border: "none",
                    borderRadius: dim(RADII.xs),
                    color: isActive ? CSS_COLOR.text : CSS_COLOR.textSec,
                    fontFamily: T.sans,
                    fontSize: textSize("body"),
                    fontWeight: FONT_WEIGHTS.medium,
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "background var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease",
                  }}
                >
                  <Icon
                    size={dim(14)}
                    strokeWidth={2.2}
                    color={isActive ? CSS_COLOR.accent : CSS_COLOR.textSec}
                    aria-hidden="true"
                    style={{ flex: "0 0 auto" }}
                  />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {command.label}
                  </span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: fs(9),
                      color: CSS_COLOR.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {command.hint}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(4),
            padding: sp("6px 12px"),
            borderTop: `1px solid ${CSS_COLOR.borderLight}`,
            background: CSS_COLOR.bg0,
            fontSize: fs(9),
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
          }}
        >
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span>⌘K / Ctrl-K</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const CommandPalette = memo(CommandPaletteInner);
