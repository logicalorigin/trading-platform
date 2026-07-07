import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetWebglCapabilityCacheForTests,
  isWebglAvailable,
  isSoftwareWebglRenderer,
  shouldPlayNeuralOpener,
  type WebglRendererInfo,
} from "./webglCapability";

type FakeWindow = {
  matchMedia?: (query: string) => { matches: boolean };
};

type FakeDocument = {
  hidden: boolean;
  documentElement: { getAttribute: (name: string) => string | null };
  createElement: (tagName: string) => {
    getContext: (name: string) => unknown;
  };
};

const DEBUG_VENDOR = 0x9245;
const DEBUG_RENDERER = 0x9246;

function installDom({
  rendererInfo,
  reducedMotion = false,
}: {
  rendererInfo: WebglRendererInfo | null;
  reducedMotion?: boolean;
}) {
  const context = rendererInfo
    ? {
        VENDOR: 0x1f00,
        RENDERER: 0x1f01,
        getExtension(name: string) {
          if (name === "WEBGL_debug_renderer_info") {
            return {
              UNMASKED_VENDOR_WEBGL: DEBUG_VENDOR,
              UNMASKED_RENDERER_WEBGL: DEBUG_RENDERER,
            };
          }
          if (name === "WEBGL_lose_context") {
            return { loseContext() {} };
          }
          return null;
        },
        getParameter(parameter: number) {
          if (parameter === 0x1f00) return rendererInfo.vendor;
          if (parameter === 0x1f01) return rendererInfo.renderer;
          if (parameter === DEBUG_VENDOR) return rendererInfo.unmaskedVendor;
          if (parameter === DEBUG_RENDERER) return rendererInfo.unmaskedRenderer;
          return "";
        },
      }
    : null;

  const fakeWindow: FakeWindow = {
    matchMedia() {
      return { matches: reducedMotion };
    },
  };
  const fakeDocument: FakeDocument = {
    hidden: false,
    documentElement: { getAttribute: () => null },
    createElement() {
      return {
        getContext(name: string) {
          return name === "webgl2" ? context : null;
        },
      };
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument,
  });
  __resetWebglCapabilityCacheForTests();
}

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
  __resetWebglCapabilityCacheForTests();
});

test("software WebGL renderers are not eligible for the neural opener", () => {
  const swiftShader = {
    vendor: "WebKit",
    renderer: "WebKit WebGL",
    unmaskedVendor: "Google Inc. (Google)",
    unmaskedRenderer:
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero))), SwiftShader driver",
  };

  assert.equal(isSoftwareWebglRenderer(swiftShader), true);
  installDom({ rendererInfo: swiftShader });
  assert.equal(isWebglAvailable(), true);
  assert.equal(shouldPlayNeuralOpener(), false);
});

test("hardware-looking WebGL renderers remain eligible when motion is allowed", () => {
  installDom({
    rendererInfo: {
      vendor: "WebKit",
      renderer: "WebKit WebGL",
      unmaskedVendor: "Intel Inc.",
      unmaskedRenderer: "ANGLE (Intel, Intel Iris OpenGL Engine)",
    },
  });

  assert.equal(shouldPlayNeuralOpener(), true);
});

test("reduced motion still disables an otherwise eligible neural opener", () => {
  installDom({
    reducedMotion: true,
    rendererInfo: {
      vendor: "WebKit",
      renderer: "WebKit WebGL",
      unmaskedVendor: "NVIDIA Corporation",
      unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX)",
    },
  });

  assert.equal(shouldPlayNeuralOpener(), false);
});
