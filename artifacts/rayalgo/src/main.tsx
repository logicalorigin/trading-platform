import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/600-italic.css";
import "@fontsource/ibm-plex-sans/700.css";
import { installRayalgoRuntimeDiagnostics } from "./app/runtimeDiagnostics";
import App from "./App";
import "./index.css";

installRayalgoRuntimeDiagnostics();

createRoot(document.getElementById("root")!).render(<App />);
