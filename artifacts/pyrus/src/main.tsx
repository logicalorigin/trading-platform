import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/600-italic.css";
import "@fontsource/ibm-plex-sans/700.css";
import { installPyrusRuntimeDiagnostics } from "./app/runtimeDiagnostics";
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

installPyrusRuntimeDiagnostics();

createRoot(document.getElementById("root")!).render(<App />);
dismissBootCrashDiagnostics();
