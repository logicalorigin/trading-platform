import { qrcodegen } from "./brokerConnectQrVendor.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildBrokerConnectQrSvg(url, { scale = 4, border = 4 } = {}) {
  if (typeof url !== "string" || !url.trim()) {
    return "";
  }
  const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.LOW);
  const size = qr.size + border * 2;
  const modules = [];

  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) {
        modules.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    }
  }

  const pixelSize = size * scale;
  return [
    `<svg xmlns="${SVG_NS}" viewBox="0 0 ${size} ${size}" width="${pixelSize}" height="${pixelSize}" role="img" aria-label="Broker connect QR code">`,
    `<title>Broker connect QR code</title>`,
    `<desc>${escapeXml(url)}</desc>`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<path d="${modules.join(" ")}" fill="#111"/>`,
    `</svg>`,
  ].join("");
}

export function buildBrokerConnectQrDataUri(url, options) {
  const svg = buildBrokerConnectQrSvg(url, options);
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : "";
}

export async function copyBrokerConnectLaunchUrl(url, clipboard) {
  if (typeof url !== "string" || !url) {
    throw new Error("Broker connect launch URL is missing.");
  }
  const targetClipboard =
    clipboard ||
    (typeof navigator !== "undefined" ? navigator.clipboard : null);
  if (!targetClipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }
  await targetClipboard.writeText(url);
}
