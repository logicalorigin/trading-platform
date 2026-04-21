# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run dev` — canonical Replit workspace run command; starts API + RayAlgo together
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **rayalgo** (`artifacts/rayalgo`, `/`) — RayAlgo Platform. React + Vite + Recharts + D3 trading terminal imported from external project. Single ~5300-line component (`src/RayAlgoPlatform.jsx`) containing six screens: Market, Flow, Trade, Research, Algo, Backtest. Uses inline styles only; `index.css` is intentionally minimal (no Tailwind theme tokens) and `App.tsx` simply renders `<RayAlgoPlatform />`.
