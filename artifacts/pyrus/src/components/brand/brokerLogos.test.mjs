import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BrokerLogo } from "./brokerLogos.tsx";
import {
  BROKER_LOGO_PNGS,
  PYRUS_NEURAL_CLOUD_SRC,
  brokerLogoPngsForBase,
} from "./brokerLogoAssets.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BROKER_PNGS = {
  alpaca: "alpaca.png",
  etrade: "etrade.png",
  ibkr: "ibkr.png",
  robinhood: "robinhood.png",
  schwab: "schwab.png",
  snaptrade: "snaptrade.png",
  webull: "webull.png",
};

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("actual provider marks render local PNG files instead of SVG artwork", () => {
  for (const [provider, filename] of Object.entries(BROKER_PNGS)) {
    const markup = renderToStaticMarkup(
      createElement(BrokerLogo, { provider, title: provider }),
    );

    assert.match(markup, new RegExp(`src="/brand/brokers/${filename}"`));
    assert.doesNotMatch(markup, /<svg\b/u);
    assert.deepEqual(
      [
        ...readFileSync(
          new URL(`../../../public/brand/brokers/${filename}`, import.meta.url),
        ).subarray(0, PNG_SIGNATURE.length),
      ],
      PNG_SIGNATURE,
      filename,
    );
  }
});

test("broker assets honor the configured application base", () => {
  const basedLogos = brokerLogoPngsForBase("/pyrus/");

  assert.equal(basedLogos.webull, "/pyrus/brand/brokers/webull.png");
});

test("synthetic account marks remain local HTML fallbacks, not fake broker SVGs", () => {
  for (const provider of ["all", "brokerage", "unknown"]) {
    const markup = renderToStaticMarkup(
      createElement(BrokerLogo, { provider }),
    );
    assert.doesNotMatch(markup, /<(?:img|svg)\b/u, provider);
  }
});

test("Shadow uses the tight neural cloud with reduced-motion-safe animation", () => {
  const markup = renderToStaticMarkup(
    createElement(BrokerLogo, { provider: "shadow" }),
  );
  const styles = readLocalSource("../../index.css");
  const markStyles =
    /\.pyrus-shadow-cloud-mark\s*\{([^}]*)\}/u.exec(styles)?.[1] ?? "";
  const imageStyles =
    /\.pyrus-shadow-cloud-image\s*\{([^}]*)\}/u.exec(styles)?.[1] ?? "";

  assert.equal(PYRUS_NEURAL_CLOUD_SRC, "/brand/pyrus-neural-cloud.webp");
  assert.match(markup, /<img\b/u);
  assert.match(markup, /pyrus-shadow-cloud-mark/u);
  assert.match(markup, /pyrus-shadow-cloud-image/u);
  assert.match(markup, /src="\/brand\/pyrus-neural-cloud\.webp"/u);
  assert.doesNotMatch(markup, /<(?:svg|canvas|path|circle)\b/u);
  assert.match(styles, /@keyframes pyrus-shadow-cloud-drift/u);
  assert.match(styles, /animation:\s*pyrus-shadow-cloud-drift/u);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/u);
  assert.doesNotMatch(markStyles, /\bbackground:/u);
  assert.doesNotMatch(markStyles, /\bbox-shadow:/u);
  assert.match(markStyles, /overflow:\s*hidden/u);
  assert.match(markStyles, /pointer-events:\s*none/u);
  assert.match(imageStyles, /left:\s*100%/u);
  assert.match(imageStyles, /top:\s*-433\.333%/u);
  assert.match(imageStyles, /width:\s*2400%/u);
  assert.match(imageStyles, /drop-shadow\(0 0 0\.55px/u);
  assert.match(imageStyles, /transform-origin:\s*center/u);
  assert.match(imageStyles, /will-change:\s*transform,\s*opacity/u);
  assert.match(
    styles,
    /data-pyrus-theme="light"\] \.pyrus-shadow-cloud-image,[\s\S]*?brightness\(0\.45\)[\s\S]*?drop-shadow\(0 0 0\.55px/u,
  );
  assert.match(
    styles,
    /@keyframes pyrus-shadow-cloud-drift[\s\S]*?scale\(0\.99\)[\s\S]*?scale\(1\.02\)/u,
  );
  assert.match(
    styles,
    /prefers-reduced-motion:\s*reduce[\s\S]*?\.pyrus-shadow-cloud-image\s*\{[\s\S]*?animation:\s*none;[\s\S]*?will-change:\s*auto;/u,
  );
});

test("Webull removes the source PNG's transparent edge padding", () => {
  const markup = renderToStaticMarkup(
    createElement(BrokerLogo, { provider: "webull" }),
  );

  assert.match(markup, /transform:scale\(1\.2\)/u);
});

test("Settings broker choices contain no embedded SVG logo substitutes", () => {
  const panelSource = readLocalSource(
    "../../screens/settings/SnapTradeConnectPanel.jsx",
  );

  assert.doesNotMatch(panelSource, /data:image\/svg\+xml/u);
  assert.match(
    panelSource,
    /if \(!choice\.logoUrl \|\| failed\)[\s\S]*?<span\s+aria-hidden="true"/u,
  );
  for (const provider of ["robinhood", "schwab", "ibkr"]) {
    assert.match(panelSource, new RegExp(`BROKER_LOGO_PNGS\\.${provider}`));
  }
  for (const [provider, filename] of Object.entries(BROKER_PNGS)) {
    assert.equal(
      BROKER_LOGO_PNGS[provider],
      `/brand/brokers/${filename}`,
      provider,
    );
  }
});
