import RFB from "@novnc/novnc/core/rfb.js";

import { buildIbkrViewerWebSocketUrl } from "./viewerModel";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error("The IBKR viewer could not be initialized.");
  }
  return element;
}

const shell = requireElement<HTMLElement>("[data-viewer-shell]");
const screen = requireElement<HTMLElement>("[data-viewer-screen]");
const status = requireElement<HTMLElement>("[data-viewer-status]");
const retry = requireElement<HTMLButtonElement>("[data-viewer-retry]");

let rfb: RFB | null = null;

function showState(
  state: "connected" | "connecting" | "disconnected" | "error",
  message: string,
): void {
  shell.dataset.state = state;
  status.textContent = message;
  retry.hidden = state === "connected" || state === "connecting";
}

function connect(): void {
  rfb?.disconnect();
  rfb = null;
  screen.replaceChildren();
  showState("connecting", "Connecting to the secure IBKR viewer…");

  try {
    const connection = new RFB(
      screen,
      buildIbkrViewerWebSocketUrl(window.location),
    );
    connection.viewOnly = false;
    connection.scaleViewport = true;
    connection.resizeSession = true;
    connection.clipViewport = false;
    connection.background = "#ffffff";
    connection.addEventListener("connect", () => {
      if (rfb !== connection) return;
      showState("connected", "Secure IBKR viewer connected.");
    });
    connection.addEventListener("disconnect", (event) => {
      if (rfb !== connection) return;
      rfb = null;
      showState(
        event.detail?.clean ? "disconnected" : "error",
        event.detail?.clean
          ? "The secure IBKR viewer disconnected."
          : "The secure IBKR viewer connection was interrupted.",
      );
    });
    connection.addEventListener("securityfailure", () => {
      if (rfb !== connection) return;
      showState("error", "The secure IBKR viewer could not be opened.");
    });
    rfb = connection;
  } catch {
    showState("error", "The secure IBKR viewer could not be opened.");
  }
}

retry.addEventListener("click", connect);
window.addEventListener("pagehide", () => rfb?.disconnect());
connect();
