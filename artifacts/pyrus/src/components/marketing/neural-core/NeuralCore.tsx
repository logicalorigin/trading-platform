import { useEffect, useRef } from "react";
import * as THREE from "three";

import { observeVisibility } from "@/lib/observe-visibility";

import {
  CHARSETS,
  fibonacciSphere,
  lockupTargets,
  makeGlyphAtlas,
  ringTargets,
} from "./helpers";
import { fragmentShader, vertexShader } from "./shaders";
import type { NeuralCoreProps } from "./types";

// A SINGLE wall clock shared by EVERY NeuralCore instance. Independently-mounted
// clouds (the opener overlay + the ambient backdrop + the hero mark) read the same
// elapsed seconds, so their rotation / noise / warp / breath / drift stay in
// lockstep. That phase-lock is what lets the opener cloud cross-dissolve INTO the
// ambient backdrop as one fluid motion instead of two clouds drifting out of sync.
const NEURAL_EPOCH = typeof performance !== "undefined" ? performance.now() : 0;
/** Seconds since module load, identical across all instances. */
const sharedTime = () =>
  ((typeof performance !== "undefined" ? performance.now() : 0) - NEURAL_EPOCH) / 1000;

const DEFAULTS = {
  coreColor: "#3DB8FF", // Pyrus blue
  outerColor: "#FF3D2A", // Pyrus red
  look: "balanced",
  particles: 14000,
  orbitCount: 3500,
  radius: 2.2,
  particleSize: 2.4,
  distortion: 0.55,
  noiseSpeed: 0.25,
  rotationSpeed: 0.12,
  tiltStrength: 0.35,
  coreOpacity: 0.9,
  orbitOpacity: 0.8,
  charSet: "binary",
  morph: false, // loop dots into the logo rings and back
  morphCycleMs: 9000,
  morphStagger: 0.45,
  ringScale: 1.15, // dot-ring radius vs sphere radius (tune to match the mark)
  convergeFloor: 0.13, // per-particle alpha floor at full ring convergence
  convergeStart: 0.34, // taper window start (per-particle vConverge)
  convergeEnd: 0.82, // taper window end - alpha at convergeFloor by here
  superSample: 1, // devicePixelRatio multiplier (1 = native)
  maxPixelRatio: 2.5, // cap on the resulting pixel ratio
  antialias: true, // MSAA on the context (false = lighter, for backgrounds)
  glow: 0.05, // per-speck halo intensity (lower = razor specks, less haze)
  crisp: false, // true = opaque depth-buffered occluding dots (sharp, not additive glow)
  bloom: 0, // 0 = straight cloud<->ring lerp; 1 = organic bloom (swirl + turbulence) path
  swirl: 0.55, // bloom tangential-curl magnitude
  turb: 0.4, // bloom turbulence (noise drift) magnitude
  vortex: 0, // inflow spiral (rad) - dots spiral INWARD into the logo; 0 = straight
  stray: 1, // stray-tendril reach multiplier (1 = reference; tight surfaces dial down)
  nebulaCloud: false, // crisp surfaces: additive-nebula cloud crossfading to crisp formed dots
  // Ambient "dreamy" drift levers - all default off so shared surfaces are unchanged.
  warp: 0, // domain-warp amount (the fluid flow); only NeuralBackdrop opts in
  warpScale: 0.9, // domain-warp spatial frequency
  warpSpeed: 0.25, // domain-warp time rate
  breath: 0, // global radius swell amount
  breathSpeed: 0.4, // breathing rate
  shimmer: 0, // per-speck alpha twinkle amount
  shimmerSpeed: 1.5, // twinkle rate
  orbitTimeScale: 0.9, // orbit-layer noise time scale (was hardcoded)
  driftX: 0, // whole-group lateral parallax
  driftY: 0, // whole-group vertical parallax
  maxFps: 0, // frame-rate cap (0 = native); the backdrop opts into ~30
} as const;

export default function NeuralCore(userProps: NeuralCoreProps) {
  const p = { ...DEFAULTS, ...userProps };
  const mountRef = useRef<HTMLDivElement>(null);

  // Re-init when any tunable changes (cheap; mounts are infrequent).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // morphDriveRef is mutated every frame by an external owner (the hero loop);
  // it must NOT be part of the re-init key or the scene would rebuild per frame.
  const key = JSON.stringify({
    ...p,
    className: undefined,
    style: undefined,
    morphDriveRef: undefined,
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: p.antialias });
    // Crisper, higher-resolution specks come from SUPERSAMPLING (rendering above
    // the device DPR), not from raising the cap alone - on DPR<=2 desktops a cap
    // bump is a no-op. superSample multiplies the device DPR; maxPixelRatio caps
    // the result so weak/high-DPR phones don't pay for an enormous buffer. Points
    // are cheap, so the extra fragments are affordable for one-shot surfaces.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio * p.superSample, p.maxPixelRatio));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 7;

    const core = new THREE.Color(p.coreColor);
    const outer = new THREE.Color(p.outerColor);
    const blending = p.look === "soft" ? THREE.NormalBlending : THREE.AdditiveBlending;

    const group = new THREE.Group();
    scene.add(group);
    const disposables: { dispose(): void }[] = [];

    const morphTargetsEnabled = Boolean(p.morph || p.morphDriveRef);
    const atlas = makeGlyphAtlas(CHARSETS[p.charSet]);
    const atlasTex = new THREE.CanvasTexture(atlas.canvas);
    // Linear (no mipmaps) keeps glyphs crisp when points are downscaled small.
    atlasTex.minFilter = THREE.LinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.needsUpdate = true;
    disposables.push(atlasTex);

    // Per-layer state needed each frame.
    type Layer = {
      points: THREE.Points;
      material: THREE.ShaderMaterial;
      timeScale: number;
      // nebulaCloud: a SECOND additive draw of the same geometry - the soft
      // nebula that owns the dispersed cloud and dissolves out as the crisp
      // formed-mark dots dissolve in (both driven by crossT in the tick).
      nebula?: { points: THREE.Points; material: THREE.ShaderMaterial; opacity: number };
    };
    const layers: Layer[] = [];

    function buildLayer(count: number, radius: number, opacity: number, sizeMul: number, timeScale: number) {
      const dirs = fibonacciSphere(count);
      let rings: Float32Array = dirs;
      let spins: Float32Array = new Float32Array(count);
      let lockupCenterY = 0;
      let lockupHalfW = 0; // rim radius (world units) -> fixed gradient span the rings spin through
      let ringColors: Float32Array | null = null; // per-particle TARGET color (the logo pixel)
      let wordFillArr: Float32Array | null = null; // 1 = wordmark particle (extra fill)
      if (morphTargetsEnabled) {
        // Both layers share a scale so their dots settle into one coherent mark.
        const ringScale = p.radius * p.ringScale;
        if (p.lockup) {
          const lk = lockupTargets(dirs, ringScale, !!p.lockupMarkOnly);
          rings = lk.positions;
          spins = lk.spins;
          lockupCenterY = lk.centerY;
          lockupHalfW = lk.halfW;
          ringColors = lk.colors;
          wordFillArr = lk.wordFill;
        } else {
          rings = ringTargets(dirs, ringScale);
        }
      }
      const colorMix = new Float32Array(count);
      const seed = new Float32Array(count);
      // Per-particle TARGET color: in lockup mode it's the sampled logo-pixel color
      // (so the converged dots ARE the real logo, in true color); otherwise fall
      // back to the sphere gradient so the shader blend is a no-op for non-logo
      // surfaces (the background cloud, ring-only mode).
      const ringColor = morphTargetsEnabled ? new Float32Array(count * 3) : dirs;
      for (let i = 0; i < count; i++) {
        const dz = dirs[i * 3 + 2];
        colorMix[i] = THREE.MathUtils.clamp((dz * 0.5 + 0.5) * 0.9 + ((i * 2654435761) % 1000) / 1000 * 0.15, 0, 1);
        seed[i] = ((i * 40503) % 1000) / 1000;
        if (morphTargetsEnabled) {
          if (ringColors) {
            ringColor[i * 3] = ringColors[i * 3];
            ringColor[i * 3 + 1] = ringColors[i * 3 + 1];
            ringColor[i * 3 + 2] = ringColors[i * 3 + 2];
          } else {
            const c = core.clone().lerp(outer, colorMix[i]);
            ringColor[i * 3] = c.r; ringColor[i * 3 + 1] = c.g; ringColor[i * 3 + 2] = c.b;
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      disposables.push(geo);

        geo.setAttribute("aDir", new THREE.BufferAttribute(dirs, 3));
        geo.setAttribute("aRing", new THREE.BufferAttribute(rings, 3));
        geo.setAttribute("aSpin", new THREE.BufferAttribute(spins, 1));
        geo.setAttribute("aColorMix", new THREE.BufferAttribute(colorMix, 1));
        geo.setAttribute("aRingColor", new THREE.BufferAttribute(ringColor, 3));
        geo.setAttribute("aWordFill", new THREE.BufferAttribute(wordFillArr ?? spins, 1));
        geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
        // Fresh uniform objects per material - the nebulaCloud twin must not
        // share refs with the crisp material (their uOpacity/uCrisp/uFade differ).
        const makeUniforms = (crisp: boolean) => ({
          uTime: { value: 0 }, uSpinTime: { value: 0 }, uDistortion: { value: p.distortion },
          uNoiseSpeed: { value: p.noiseSpeed }, uSize: { value: p.particleSize * sizeMul },
          uRadius: { value: radius }, uViewportH: { value: renderer.domElement.height || 1 },
          uGlyphCount: { value: atlas.count }, uAtlas: { value: atlasTex },
          uCols: { value: atlas.cols }, uRows: { value: atlas.rows },
          uCore: { value: core }, uOuter: { value: outer }, uOpacity: { value: opacity },
          uMorph: { value: 0 }, uStagger: { value: p.morphStagger }, uScatter: { value: 0 },
          uLockupCenterY: { value: lockupCenterY },
          uLockupHalfW: { value: lockupHalfW },
          uVortex: { value: p.vortex },
          uStray: { value: p.stray },
          uConvergeFloor: { value: p.convergeFloor },
          uConvergeStart: { value: p.convergeStart }, uConvergeEnd: { value: p.convergeEnd },
          uGlow: { value: p.glow },
          uCrisp: { value: crisp ? 1 : 0 },
          uFade: { value: 1 },
          uBloom: { value: p.bloom }, uSwirl: { value: p.swirl }, uTurb: { value: p.turb },
          uWarp: { value: p.warp }, uWarpScale: { value: p.warpScale },
          uWarpSpeed: { value: p.warpSpeed },
          uBreath: { value: p.breath }, uBreathSpeed: { value: p.breathSpeed },
          uShimmer: { value: p.shimmer }, uShimmerSpeed: { value: p.shimmerSpeed },
        });
        const mat = new THREE.ShaderMaterial({
          uniforms: makeUniforms(!!p.crisp),
          vertexShader, fragmentShader,
          // crisp: opaque, depth-buffered, NON-additive dots so the GPU z-buffer
          // occludes back dots with front dots (sharp discrete points, no summed
          // glow). CRITICAL: NoBlending IGNORES the fragment alpha, so the
          // shader's sub-pixel disc-edge AA does nothing on its own - every dot
          // rasterized a hard binary blob whose edge pixels re-quantize each
          // frame as the rings rotate (read as stray dots jittering around the
          // formed mark's edges). alphaToCoverage routes that alpha into MSAA
          // coverage instead (needs antialias: true on the context), so the
          // discs get true edge AA while staying opaque + occluding.
          transparent: !p.crisp,
          depthWrite: !!p.crisp,
          depthTest: true,
          blending: p.crisp ? THREE.NoBlending : blending,
          alphaToCoverage: !!p.crisp && p.antialias,
        });
        disposables.push(mat);
        const points = new THREE.Points(geo, mat);
        group.add(points);
        // nebulaCloud: an ADDITIVE twin of the same geometry. It renders the
        // dispersed cloud as the soft glowing nebula (the auth-lockup look)
        // while the crisp points own the formed mark; the tick crossfades the
        // two through the late converge (crisp uFade in, nebula uOpacity out)
        // and toggles visibility so only the active draw costs anything.
        let nebula: Layer["nebula"];
        if (p.crisp && p.nebulaCloud) {
          const nu = makeUniforms(false);
          // The nebula must NOT inherit the crisp converge values (floor 1.0 =
          // dots hold full brightness because they ARE the formed logo): under
          // ADDITIVE blending the condensing pile-up then sums to a white blob
          // mid-converge. Taper the nebula out hard BEFORE that pile-up peak
          // (vConverge ~0.6-0.8) - the crisp rendition takes over via crossT.
          nu.uConvergeFloor.value = 0.08;
          nu.uConvergeStart.value = 0.25;
          nu.uConvergeEnd.value = 0.7;
          const nmat = new THREE.ShaderMaterial({
            uniforms: nu,
            vertexShader, fragmentShader,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending,
          });
          disposables.push(nmat);
          const npoints = new THREE.Points(geo, nmat);
          group.add(npoints);
          nebula = { points: npoints, material: nmat, opacity };
          // The crisp points start hidden (uFade 0 / cloud phase) - the nebula
          // opens the scene; the tick takes over from the first frame.
          points.visible = false;
        }
        layers.push({ points, material: mat, timeScale, nebula });
    }

    buildLayer(p.particles, p.radius, p.coreOpacity, p.look === "neon" ? 1.3 : 1.0, 1.0);
    buildLayer(p.orbitCount, p.radius * 1.05, p.orbitOpacity, 0.8, p.orbitTimeScale);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Keep glyph scale a constant fraction of the (possibly resized) canvas.
      const vh = renderer.domElement.height || 1;
      for (const layer of layers) {
        layer.material.uniforms.uViewportH.value = vh;
      }
    });
    ro.observe(mount);

    const mouse = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = mount.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    mount.addEventListener("pointermove", onMove);

    let raf = 0;
    let parked = false;
    let lastRenderMs = 0;
    const frameInterval = p.maxFps > 0 ? 1000 / p.maxFps : 0;
    let spinAngle = 0, lastT = 0, tiltX = 0, tiltY = 0;
    // Per-ring spin clock: STARTS when the mark fully forms and RESETS when it
    // disperses, so every formation lands the rings in the artwork's REST POSE
    // (the baked layout: blue left / red right, dash gaps splitting the vertical
    // axis) and only then do they come alive at their real rates. An absolute
    // clock here meant each ring landed at an arbitrary phase - by the second
    // or third loop the formed mark's gradient was visibly scrambled. Shared by
    // both layers (per-layer clocks would shear the lockup into ghost marks).
    let spinClock = 0;
    let everFormed = false;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const tick = () => {
      // Park entirely while off-screen / tab hidden - no rAF wakeups - and resume
      // via the visibility observer below. Frees GPU + main thread for scrolling.
      if (parked) { raf = 0; return; }
      raf = requestAnimationFrame(tick);
      // Frame-rate cap: keep the rAF cadence but skip the actual render until the
      // capped interval elapses (the ambient backdrop renders at ~30fps this way).
      const nowMs = performance.now();
      if (frameInterval > 0 && nowMs - lastRenderMs < frameInterval) return;
      lastRenderMs = nowMs;

      const t = sharedTime();
      const dt = Math.min(t - lastT, 0.05);
      lastT = t;

      // Morph + scatter. An external drive (the hero loop) takes priority via a
      // ref so it can choreograph per-frame; otherwise the internal clock loops
      // neural(0) -> converge -> rings(1) -> disperse -> neural.
      let m = 0;
      let scatter = 0;
      const drive = p.morphDriveRef?.current;
      if (drive) {
        m = drive.morph;
        scatter = drive.scatter;
      } else if (p.morph) {
        const tt = ((t * 1000) % p.morphCycleMs) / p.morphCycleMs;
        if (tt < 0.3) m = 0;
        else if (tt < 0.45) m = ease((tt - 0.3) / 0.15);
        else if (tt < 0.72) m = 1;
        else if (tt < 0.88) m = 1 - ease((tt - 0.72) / 0.16);
        else m = 0;
      }

      // Spin ONLY clockwise, in the screen plane (negative Z). This reads the
      // same direction in both the sphere and the camera-facing rings, so it
      // never has to unwind/reverse the way a Y-axis globe spin did to face the
      // rings forward. Mouse tilt adds subtle parallax that eases out as the
      // rings form so the mark settles flat to the camera.
      tiltX += (-mouse.y * p.tiltStrength - tiltX) * 0.05;
      tiltY += (mouse.x * p.tiltStrength - tiltY) * 0.05;
      const open = 1 - m;
      // The ambient cloud's rotation is ABSOLUTE off the shared clock, so every
      // instance rotates in lockstep and the opener can land in phase with it.
      const ambientRot = -p.rotationSpeed * t;
      if (p.lockup) {
        // The LOCKUP must settle UPRIGHT - the wordmark has to read horizontally
        // and align with the static crisp mark. So: spin freely as a sphere, but
        // FREEZE the spin as the mark begins forming (so the angle stops growing),
        // then ease that frozen angle to the NEAREST upright (a multiple of 2pi)
        // along the shortest path as it converges. No wrap-jump, no full unwind.
        const spinGate = Math.max(0, Math.min(1, (0.34 - m) / 0.34));
        spinAngle += p.rotationSpeed * dt * spinGate;
        let rot = -spinAngle;
        const s = Math.max(0, Math.min(1, (m - 0.34) / 0.66));
        const settle = s * s * (3 - 2 * s);
        const nearestUpright = Math.round(rot / (2 * Math.PI)) * 2 * Math.PI;
        rot += (nearestUpright - rot) * settle;
        // As the mark DISPERSES back to cloud (m -> 0), the spinGate above
        // already resumes the ambient ROTATION VELOCITY from the frozen angle -
        // velocity continuity, so the expansion reads as the cloud naturally
        // breathing apart. Deliberately NO angle snap onto the backdrop's
        // absolute rotation: the old shortest-path catch-up (up to ~180° eased
        // into the last third of the dispersal) read as a mechanical swing.
        // The remaining CONSTANT angular offset between opener cloud and
        // backdrop is imperceptible across the crossfade - two identically
        // drifting fuzzy noise fields dissolve into each other; only angular
        // MOTION reads as rotation.
        group.rotation.z = rot;
      } else {
        // Backdrop + every ambient cloud: absolute off the shared clock so all
        // instances rotate in lockstep (was per-clock dt-accumulated -> drifted).
        group.rotation.z = ambientRot;
      }
      group.rotation.x = tiltX * open;
      group.rotation.y = tiltY * open;
      // Gentle whole-group parallax drift, gated by `open` so the FORMED logo
      // (m=1 -> open=0) stays put while the sphere / dispersed cloud (open=1)
      // drifts exactly like the backdrop. Absolute sin(t) off the shared clock =
      // phase-locked, so the opener cloud and the backdrop drift as one.
      if (p.driftX || p.driftY) {
        group.position.x = Math.sin(t * 0.05) * p.driftX * open;
        group.position.y = Math.cos(t * 0.04) * p.driftY * open;
      }

      // Advance the ring-spin clock only while the mark is FULLY formed; reset
      // once it has fully dispersed so the next formation starts from the rest
      // pose again. While converging, the dots therefore fly to the exact baked
      // rest layout (the vortex supplies the in-flight motion).
      if (m >= 0.999) {
        spinClock += dt;
        everFormed = true;
      } else if (m <= 0.001 && everFormed) {
        spinClock = 0;
        everFormed = false;
      }

      // nebulaCloud crossfade: the additive nebula owns the dispersed cloud,
      // the crisp dots own the formed mark; they dissolve through the late
      // converge (by 0.85 the dots have largely settled onto the strokes, so
      // the crisp rendition fades in over an already-recognizable mark).
      const crossT = ease(Math.max(0, Math.min(1, (m - 0.55) / 0.3)));
      for (const layer of layers) {
        layer.material.uniforms.uTime.value = t * layer.timeScale;
        // Spin time is UNSCALED and SHARED for every layer: the orbit layer's
        // noise runs at orbitTimeScale, but its ring dots must rotate in
        // lockstep with the core layer's or the lockup splits into two marks
        // shearing apart.
        layer.material.uniforms.uSpinTime.value = spinClock;
        layer.material.uniforms.uMorph.value = m;
        layer.material.uniforms.uScatter.value = scatter;
        if (layer.nebula) {
          const nu = layer.nebula.material.uniforms;
          nu.uTime.value = t * layer.timeScale;
          nu.uSpinTime.value = spinClock;
          nu.uMorph.value = m;
          nu.uScatter.value = scatter;
          nu.uOpacity.value = layer.nebula.opacity * (1 - crossT);
          layer.nebula.points.visible = crossT < 0.999;
          layer.material.uniforms.uFade.value = crossT;
          layer.points.visible = crossT > 0.001;
        }
      }

      renderer.render(scene, camera);
    };

    // Pause when scrolled out of view (bounded surfaces like the hero morph) or
    // when the tab is hidden; resume seamlessly. The full-viewport backdrop is
    // always intersecting, so for it this only catches tab-hidden - the maxFps
    // cap is what trims its on-screen cost.
    const resume = () => { if (!raf && !parked) { lastT = sharedTime(); raf = requestAnimationFrame(tick); } };
    const disposeVisibility = observeVisibility(mount, (visible) => {
      parked = !visible;
      if (visible) resume();
    });
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      disposeVisibility();
      ro.disconnect();
      mount.removeEventListener("pointermove", onMove);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [key]);

  return (
    <div
      ref={mountRef}
      className={p.className}
      style={{ width: "100%", height: "100%", ...(userProps.style || {}) }}
    />
  );
}
