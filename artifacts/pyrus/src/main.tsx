import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import { installPyrusRuntimeDiagnostics } from "./app/runtimeDiagnostics";
import {
  completeBootProgressTask,
  skipBootProgressTask,
  startBootProgressTask,
} from "./app/bootProgress";
import App from "./App";
import "./index.css";

const dismissBootCrashDiagnostics = () => {
  const bootDiagnostics = (
    window as unknown as {
      __PYRUS_BOOT_CRASH_DIAGNOSTICS__?: { dismiss?: () => void };
    }
  ).__PYRUS_BOOT_CRASH_DIAGNOSTICS__;
  bootDiagnostics?.dismiss?.();
};

const now = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const readBootLoaderElapsedMs = (rootElement: HTMLElement): number | null => {
  if (!rootElement.querySelector('[data-testid="pyrus-boot-loader"]')) return null;

  const bootState = window as unknown as {
    __PYRUS_BOOT_LOADER_STARTED_AT__?: number;
  };
  const startedAt = bootState.__PYRUS_BOOT_LOADER_STARTED_AT__;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;

  return Math.max(0, now() - startedAt);
};

installPyrusRuntimeDiagnostics();

const rootElement = document.getElementById("root")!;
const bootLoaderElapsedMs = readBootLoaderElapsedMs(rootElement);
if (bootLoaderElapsedMs === null) {
  skipBootProgressTask("static-html", "Static boot loader was not present");
} else {
  completeBootProgressTask("static-html");
}
startBootProgressTask("react-root");

createRoot(rootElement).render(<App bootLoaderElapsedMs={bootLoaderElapsedMs} />);
completeBootProgressTask("react-root");
dismissBootCrashDiagnostics();
