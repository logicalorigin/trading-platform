import { createRoot } from "react-dom/client";
import { installRayalgoRuntimeDiagnostics } from "./app/runtimeDiagnostics";
import App from "./App";
import "./index.css";

installRayalgoRuntimeDiagnostics();

createRoot(document.getElementById("root")!).render(<App />);
