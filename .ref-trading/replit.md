# SPY Options Multi-Agent Trading Platform

## Overview
A React-based dashboard platform for SPY options trading strategy research, backtesting, live simulation, and broker portfolio operations. The app now runs with a Node API server plus Vite middleware so the Positions & Accounts workspace can connect/sync broker accounts and submit orders.

## Architecture

### Frontend
- **Framework**: React 18 + Vite 6
- **Charts**: Recharts
- **Port**: 5000 (0.0.0.0)
- **Entry**: `src/main.jsx` → `src/App.jsx`

### Dashboards (src/components/)
- `ResearchWorkbench.jsx` — Unified Backtest Dashboard (integrated research workbench with embedded analysis and optimizer tooling)
- `PositionsAccountsTab.jsx` — Broker account connection, credential management, positions monitor, and trade ticket

### Backend (server/)
- `server/index.js` — Unified HTTP server (API + Vite middleware in dev, static asset serving in prod)
- `server/routes/api.js` — Broker account, position, and order endpoints
- `server/brokers/*` — Broker adapter layer (E*Trade, Webull, IBKR)
- `server/state/store.js` — Runtime account/position/order state persistence

### Data Files (src/data/)
- Static backtest result bundles were removed from `src/data/` during dead-code cleanup.

### Historical Prototypes
- Early root-level backtest scripts, dashboards, and result bundles were removed from the working tree during archival cleanup.
- Recover any of those prototypes from git history if they are still needed for reference.

## Development
```bash
npm run dev    # Start unified API + UI server on port 5000
npm run dev:ui # Start Vite UI only (no /api routes)
npm run build  # Build for production → dist/
npm run start  # Run production server (serves dist/ + /api)
```

## Deployment
Configured as an autoscale Node deployment:
- Build: `npm run build`
- Run: `npm run start`

## Key Trading Strategy Findings
- **Best config**: Momentum Breakout, 5DTE ATM, wide exits (40% SL / 60% TP), not_bear regime filter → 10.72% return, 1.94 PF, 2.72% max DD
- **Runner-up**: Sweep Reversal, 3DTE ATM, tight exits (25% SL / 35% TP) → 10.14% return, 67.7% WR
