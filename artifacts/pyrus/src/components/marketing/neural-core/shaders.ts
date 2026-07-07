export const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSpinTime;    // UNSCALED shared seconds for the per-ring spin. uTime is
                              // per-layer scaled (orbitTimeScale) for the cloud noise;
                              // if spin used it, the orbit layer's copy of every ring
                              // would rotate slower than the core layer's and the two
                              // 'marks' would shear apart (ghost-doubled dashes).
  uniform float uDistortion;
  uniform float uNoiseSpeed;
  uniform float uSize;
  uniform float uRadius;
  uniform float uViewportH;   // drawing-buffer height (device px) - keeps glyphs
                              // a constant FRACTION of the sphere at any canvas size
  uniform float uGlyphCount;
  uniform float uMorph;       // 0 = neural sphere, 1 = dots laid onto the logo rings
  uniform float uStagger;     // 0..1 spread of per-particle morph timing
  uniform float uScatter;     // 0..1 radial burst (mark disperses into the charts)
  uniform float uBloom;       // 0 = straight cloud<->ring lerp, 1 = organic bloom path
  uniform float uSwirl;       // tangential curl magnitude during the bloom transit
  uniform float uTurb;        // turbulence (noise drift) magnitude during the transit
  uniform float uWarp;        // domain-warp amount (0 = off; warps the noise sample pos)
  uniform float uWarpScale;   // domain-warp spatial frequency
  uniform float uWarpSpeed;   // domain-warp time rate (relative to t)
  uniform float uBreath;      // global radius swell amount (0 = off)
  uniform float uBreathSpeed; // breathing rate
  uniform float uShimmer;     // per-speck alpha twinkle amount (0 = off)
  uniform float uShimmerSpeed;// twinkle rate
  uniform float uLockupCenterY;// y of the mark center (pivot each ring spins about)
  uniform float uLockupHalfW;  // rim radius (world units); span of the FIXED brand gradient (0 = off-lockup)
  uniform float uVortex;      // inflow spiral angle (rad) that unwinds to 0 at the ring
  uniform float uStray;       // stray-tendril reach multiplier (1 = reference look, 0 = none)

  attribute vec3 aDir;        // unit direction on sphere
  attribute vec3 aRing;       // target position on the logo rings (world units)
  attribute float aSpin;      // per-ring spin rate (rad/s); each ring rotates independently
  attribute float aColorMix;  // 0..1 ramp factor
  attribute vec3 aRingColor;  // per-particle TARGET color = the sampled logo-pixel color
  attribute float aWordFill;  // 1 = wordmark particle (grows extra so the letters fuse solid)
  attribute float aSeed;      // per-particle randomness

  varying float vColorMix;
  varying vec3 vRingColor;
  varying float vWordFill;    // 1 = wordmark speck
  varying float vGlyph;       // which glyph index to draw
  varying float vDepth;       // 1 = facing camera, 0 = far side
  varying float vConverge;    // 0 = sphere, 1 = settled on the ring (per-particle)
  varying float vShimmer;     // 1 = full alpha; <1 when the per-speck twinkle dips it

  // --- simplex 3D noise (Ashima) ---
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod(i,289.0);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  // The brand mark's FIXED horizontal gradient (mirrors pyrus-mark-shared's
  // userSpaceOnUse linearGradient: blue -> dim violet "split" -> red). t: 0=left,
  // 1=right. Spinning rings are recoloured by their CURRENT x through this, so the
  // gradient stays put while the rings rotate (the baked per-dot colour would
  // otherwise rotate with the dot and scramble the gradient).
  vec3 brandGrad(float t){
    t = clamp(t, 0.0, 1.0);
    // Flank stops match the brand SVG; the BRIDGE stops (c2-c4) are
    // luminance-lifted versions of the SVG's indigo/brick. The SVG's own mid
    // colors sit at ~11-14% luminance vs ~40-65% flanks - fine as shading in
    // continuous strokes, but a particle carrying a dark color IS darkness on
    // this page, so even at full opacity they still read as a faint shaded
    // bar (the third and final layer of that bug). Same hue family, lifted
    // to flank brightness: periwinkle violet bridge into a lifted brick red.
    vec3 c0=vec3(0.239,0.722,1.000); // #3DB8FF blue
    vec3 c1=vec3(0.169,0.659,1.000); // #2BA8FF
    vec3 c2=vec3(0.420,0.353,0.878); // #6B5AE0 (was #3A2A8C)
    vec3 c3=vec3(0.498,0.361,1.000); // #7F5CFF (was the dark split)
    vec3 c4=vec3(0.761,0.263,0.235); // #C2433C (was #7A1E26)
    vec3 c5=vec3(1.000,0.239,0.165); // #FF3D2A red
    vec3 c6=vec3(1.000,0.302,0.239); // #FF4D3D
    vec3 col;
    // COLOR ONLY - deliberately NO opacity dip. This recolor keys off a dot's
    // CURRENT screen x (the gradient is fixed in space so blue stays left /
    // red stays right while the rings spin), which means any opacity dimming
    // here is POSITION-LOCKED: it painted a permanent dark column at center
    // that every dash faded into as it rotated past - read as an errant black
    // separation bar. The mark's real split character comes from the artwork
    // itself: the ring-dash GAPS near the vertical axis at rest, which rotate
    // away with the rings (geometry, not a stationary veil). So the particle
    // gradient carries hue alone - blue -> violet bridge -> red at full
    // brightness. (The SVG's dim-split stops remain in the SVG mark only.)
    if(t<0.32){ float k=t/0.32;             col=mix(c0,c1,k); }
    else if(t<0.44){ float k=(t-0.32)/0.12; col=mix(c1,c2,k); }
    else if(t<0.50){ float k=(t-0.44)/0.06; col=mix(c2,c3,k); }
    else if(t<0.56){ float k=(t-0.50)/0.06; col=mix(c3,c4,k); }
    else if(t<0.68){ float k=(t-0.56)/0.12; col=mix(c4,c5,k); }
    else { float k=(t-0.68)/0.32;            col=mix(c5,c6,k); }
    return col;
  }

  void main(){
    float t = uTime * uNoiseSpeed;

    // Per-particle eased morph (0 = sphere, 1 = on the logo rings). Crystallize
    // ring-by-ring from the CENTER OUT: dots bound for a larger ring radius lead
    // more, so the inner rings lock first and the mark assembles in a clean
    // radial wave (a little per-particle seed keeps it organic, not mechanical) -
    // rather than every dot snapping at once.
    float radNorm = clamp(length(aRing) / (uRadius * 0.85), 0.0, 1.0);
    float lead = uStagger * (0.7 * radNorm + 0.3 * aSeed);
    // All particles finish settling onto the rings by uMorph ~= SETTLE (0.78),
    // then HOLD as clean rings through to 1.0 - so the crisp mark can crossfade
    // in over fully-formed dotted rings (seamless) rather than over still-
    // converging spokes. (Denominator = SETTLE - uStagger.)
    float pm = clamp((uMorph - lead) / max(0.78 - uStagger, 0.001), 0.0, 1.0);
    pm = pm * pm * pm * (pm * (pm * 6.0 - 15.0) + 10.0); // smootherstep (quintic) - flatter ends so dots leave the sphere AND settle onto the rings gently (no snap)
    vConverge = pm;

    // DOMAIN WARP (ambient backdrop only; uWarp=0 elsewhere skips this whole
    // coherent branch). Displace the noise SAMPLE position by a single low-freq
    // noise field before the main taps - the buzzing octaves become slow liquid
    // undulation (the "dreamy" flow). One extra snoise tap; the scalar field is
    // spread into an anisotropic-but-coherent 3D offset (no further taps).
    vec3 sampleDir = aDir;
    if (uWarp > 0.001) {
      float wt = t * uWarpSpeed;
      float w = snoise(aDir * uWarpScale + vec3(wt, -wt * 0.7, wt * 0.5));
      sampleDir = aDir + vec3(w, w * 0.6 - 0.3, -w * 0.8) * uWarp;
    }

    // Organic morph of the SPHERE surface (two octaves of flowing noise). The
    // noise eases to 0 as the dots reach ring form so the rings stay clean.
    float n1 = snoise(sampleDir * 1.5 + vec3(t, 0.0, -t));
    float n2 = snoise(sampleDir * 3.2 + vec3(-t * 1.3, t * 0.7, t * 0.5));
    float n = n1 * 0.72 + n2 * 0.28;
    // Breathing: a slow global radius swell so the cloud feels alive (uBreath=0
    // elsewhere -> breath==1.0, identical). Driven by uTime, FR-independent.
    float breath = 1.0 + uBreath * sin(uTime * uBreathSpeed);
    // QUADRATIC settle falloff: residual cloud displacement dies as (1-pm)^2,
    // not (1-pm). With the linear falloff + the flat-ended settle curve, dots
    // at pm 0.85-0.99 hovered visibly OFF the strokes (residual noise is
    // +/-12px at pm .95; the far-flung strays still ~55px out at .9) - read
    // as stray neural dots jittering around the mark/word edges through the
    // whole late converge. Squared, the visible offset collapses much earlier
    // while the motion stays gentle. pm=0 (cloud/backdrop) is unchanged.
    float settleFall = (1.0 - pm) * (1.0 - pm);
    float disp = uRadius * (1.0 + n * uDistortion * settleFall) * breath;
    // A few particles drift FAR out as nebula strays + the surface frays into
    // wispy tendrils (reference look). Only in sphere form - they pull
    // back in (quadratically) as the dots crystallize onto the rings.
    // uStray scales their REACH per surface (tight surfaces like the header
    // logo can't afford dots flying half the canvas past the cloud body).
    float stray = smoothstep(0.88, 1.0, aSeed) * settleFall * uStray;
    disp += uRadius * stray * (0.5 + 0.95 * (0.5 + 0.5 * n));
    vec3 spherePos = aDir * disp;

    // Sphere <-> ring straight path: the dots becoming the logo (or back).
    // Each ring spins INDEPENDENTLY: rotate this dot's ring target about the mark
    // center (0, uLockupCenterY) by its own per-ring rate. aSpin = 0 (wordmark /
    // non-lockup) leaves the target untouched. Only the converged position spins
    // (it's mixed by pm), so the cloud is unaffected.
    vec3 ringPos = aRing;
    if (abs(aSpin) > 1e-6) {
      // NEGATED: aSpin rates are authored in the SVG's convention (positive =
      // CSS rotate = CLOCKWISE on screen, y-down), but a positive z-rotation
      // here is counter-clockwise (three.js world is y-up). Without the flip
      // every dotted ring spins OPPOSITE its real animated-mark counterpart.
      float sa = -aSpin * uSpinTime;
      float cs = cos(sa), sn = sin(sa);
      vec2 rel = aRing.xy - vec2(0.0, uLockupCenterY);
      ringPos.xy = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + vec2(0.0, uLockupCenterY);
    }
    // VORTEX inflow: the dots converge toward a target rotated by uVortex*(1-pm)
    // about the mark center - the angle UNWINDS to 0 as they land, so the path
    // spirals INWARD into place (clockwise). At pm=0 the dot is still the cloud
    // (mix weight 0), so the cloud itself is untouched.
    if (uVortex > 0.0001) {
      float va = -uVortex * settleFall; // unwinds early too - dashes land instead of sliding
      float cv = cos(va), sv = sin(va);
      vec2 c = vec2(0.0, uLockupCenterY);
      vec2 rv = ringPos.xy - c;
      ringPos.xy = vec2(rv.x * cv - rv.y * sv, rv.x * sv + rv.y * cv) + c;
    }
    vec3 straight = mix(spherePos, ringPos, pm);
    vec3 pos = straight;

    // ORGANIC BLOOM (uBloom): dots CURL + DRIFT along their journey between the
    // rings and the cloud - a flowing bloom OUT (ring->cloud), and a curling
    // gather IN when the same path is played reversed (cloud->ring, the loader/
    // hero assembly). Everything is weighted by 'flight', which is ZERO at BOTH
    // ends (4*pm*(1-pm)): at pm=1 the rings stay perfectly clean, at pm=0 the
    // cloud is left as the existing neural sphere - the bloom lives ONLY in the
    // transit, never the endpoints. Reuses the n1/n2 surface noise for the
    // turbulence (no extra noise taps), and the whole block is a coherent
    // uniform branch so non-bloom surfaces (header / route loaders) pay nothing.
    if (uBloom > 0.001) {
      float flight = 4.0 * pm * (1.0 - pm);               // mid-transit peak, 0 at ends
      // Sweep the dots toward their ring slots ALONG THE SPIN: the in-plane
      // CLOCKWISE tangent at the dot's position (matching group.rotation.z =
      // -spin), so they spiral into formation the way the mark turns - not
      // straight in. A little seed variation keeps it organic.
      vec2 rxy = straight.xy + vec2(1e-4, 1e-4);
      vec3 tangent = vec3(normalize(vec2(rxy.y, -rxy.x)), 0.0); // clockwise in XY
      float swirl = uRadius * uSwirl * flight * (0.7 + 0.6 * aSeed);
      vec3 turb = vec3(n1, n2, (n1 - n2) * 0.7) * (uRadius * uTurb * flight);
      vec3 bloomPos = straight + tangent * swirl + turb;
      pos = mix(straight, bloomPos, uBloom);
    }

    // Scatter burst: dots fly radially outward (seed-varied speed) so the mark
    // disperses into the charts at the hero's hand-off beat.
    if (uScatter > 0.0) {
      vec3 outDir = normalize(pos + vec3(0.0001));
      pos += outDir * uScatter * (1.5 + aSeed * 3.5);
    }

    // Glyph flicker: each particle cycles its character at its own rate.
    float rate = 2.5 + aSeed * 9.0;
    vGlyph = floor(mod(uTime * rate + aSeed * uGlyphCount, uGlyphCount));

    // Slow per-speck alpha twinkle (ambient backdrop only; uShimmer=0 -> 1.0). Each
    // particle breathes its brightness on its own phase, so the field gently
    // scintillates like distant stars rather than holding flat.
    vShimmer = (uShimmer > 0.001)
      ? 1.0 - uShimmer * (0.5 + 0.5 * sin(uTime * uShimmerSpeed + aSeed * 6.2831))
      : 1.0;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // Depth: camera sits at +z, so -mv.z grows with distance. Map near->1, far->0.
    vDepth = clamp((9.0 - (-mv.z)) / 4.0, 0.0, 1.0);
    // Color: a soft screen-X bias (blue left -> red right, matching the mark)
    // INTERMIXED with per-particle randomness, so red and blue specks weave
    // through each other (additive overlap blooms to magenta) - the reference's
    // woven nebula, not a clean two-tone split. Bias slightly warm overall.
    float baseMix = clamp(mv.x / (uRadius * 1.7) + 0.5, 0.0, 1.0);
    vColorMix = clamp(mix(baseMix, aSeed, 0.62) + 0.1, 0.0, 1.0);
    // Ring dots keep their BAKED rest-position color and carry it as they
    // rotate - matching the real mark, whose painted dashes travel with the
    // ring so blue and red interleave over time. (An earlier recolor sampled
    // the brand gradient by CURRENT screen x - gradient fixed in space - but
    // that pinned a hard blue|red handoff line at the vertical axis that
    // every dash snapped through as it spun. Baked-and-carried is the
    // artwork's behavior; the rest-pose still reads blue-left/red-right.)
    vRingColor = aRingColor;
    vWordFill = aWordFill;

    // Point size is a fixed fraction of viewport height (with perspective +
    // slight front-bias), so glyphs stay small & legible whether the canvas is
    // 50px or 1000px - the key to reading as ASCII instead of a blob.
    // Depth-varied size sells the 3D cloud, but on the FORMED mark it makes
    // dash strokes lumpy (neighboring dots at 0.82x vs 1.18x scallop the
    // edge). Flatten to uniform size as the dot converges - cloud keeps its
    // volume cue, the settled mark renders even-width strokes.
    float depthSize = mix(mix(0.82, 1.18, vDepth), 1.0, vConverge);
    // DENSE TINY POINTS (Codrops image->particles technique): the MARK fills solid
    // by DENSITY at base size (no growth -> no blobbing of the dashes/dots). The
    // WORDMARK letters are THIN, so grow ONLY those specks at the final settle so
    // the dots fuse into SOLID letter strokes (vConverge -> 1) instead of reading
    // as a dotted approximation of the text. aWordFill = 1 on wordmark dots only.
    // 1.1 (was 1.6): the resampled word bake is denser/uniform, so letters
    // fuse at a smaller grow - less disc overhang past the letter edges =
    // sharper glyph outlines at near-true stroke weight. (0.85 matched the
    // PNG's weight exactly but notched the thin horizontals; 1.1 fills them.)
    float wordGrow = 1.0 + aWordFill * smoothstep(0.55, 1.0, vConverge) * 1.1;
    float ps = uSize * (uViewportH / 3.0) / -mv.z * depthSize * wordGrow;
    gl_PointSize = min(ps, uViewportH * 0.05); // headroom so grown wordmark dots fuse (mark dots sit far below this)
    gl_Position = projectionMatrix * mv;
  }
`;

export const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uCols;
  uniform float uRows;
  uniform vec3 uCore;
  uniform vec3 uOuter;
  uniform float uOpacity;
  uniform float uScatter;
  uniform float uConvergeFloor;  // per-particle alpha floor at full ring convergence
  uniform float uConvergeStart;  // taper window start (per-particle vConverge)
  uniform float uConvergeEnd;    // taper window end - alpha reaches the floor here
  uniform float uGlow;           // per-speck halo intensity (lower = razor disc)
  uniform float uCrisp;          // 1 = opaque occluding dots (sharp), 0 = additive glow
  uniform float uFade;           // crisp-mode global fade (alpha->A2C coverage); 1 elsewhere

  varying float vColorMix;
  varying vec3 vRingColor;
  varying float vWordFill;
  varying float vGlyph;
  varying float vDepth;
  varying float vConverge;
  varying float vShimmer;   // per-speck alpha twinkle (1.0 when uShimmer off)

  void main(){
    float r = length(gl_PointCoord - 0.5);

    // Crisp speck = a HARD-edged bright core plus a tight falloff halo. Under
    // additive blending the falloff reads as a fine per-particle glow (the
    // reference's "bloom") while the hard core keeps every dot a sharp, defined
    // point - not a soft translucent blob. The AA band is ~1px (0.5..0.44).
    float core = 1.0 - smoothstep(0.47, 0.5, r);          // razor-sharp disc (sub-px AA)
    // Bloom skirt tapers away as the dot CONVERGES: per-dot halos summed along
    // a dash stroke read as a soft aura at the formed mark's edges, so the
    // settled logo renders razor discs while the free cloud keeps its bloom.
    float glow = (1.0 - smoothstep(0.0, 0.34, r)) * uGlow * (1.0 - 0.8 * vConverge);
    float shape = clamp(core + glow, 0.0, 1.0);
    if (shape < 0.01) discard;

    // Depth shading: near particles bright, far ones dim & recessed - strong
    // front/back contrast so the cloud reads as a 3D volume, not a flat blob.
    float bright = mix(0.30, 1.0, vDepth);
    // As the dot CONVERGES onto the logo it (a) fades to its sampled logo-pixel
    // color (vRingColor) and (b) stops being depth-dimmed - so the formed mark
    // shows the TRUE logo color at full brightness, while the sphere keeps its
    // gradient + 3D depth shading.
    vec3 base = mix(uCore, uOuter, clamp(vColorMix, 0.0, 1.0));
    float b = mix(bright, 1.0, vConverge);
    vec3 color = mix(base, vRingColor, vConverge) * b;
    // Wordmark -> clean solid WHITE as it settles (the sampled letter pixels carry
    // gray AA edges that read as speckle; the real PYRUS wordmark is solid white).
    color = mix(color, vec3(1.0), vWordFill * smoothstep(0.55, 1.0, vConverge) * 0.7);

    // CRISP mode: opaque, depth-buffered, occluding dots (no additive sum). The
    // alpha is just the disc coverage (edge AA against the transparent canvas);
    // the GPU z-buffer makes near dots cover far dots, and depth shows via the
    // color brightness above - so the specks read as SHARP discrete points, not
    // a summed glow. The additive blowout taper is irrelevant here, so skip it.
    if (uCrisp > 0.5) {
      // uFade rides the alpha into MSAA coverage (alphaToCoverage), so the
      // nebula-cloud crossfade can dissolve the crisp dots in/out - at 1
      // (every non-nebula surface) this is a no-op.
      gl_FragColor = vec4(color, shape * (1.0 - clamp(uScatter, 0.0, 1.0)) * uFade);
      return;
    }

    // Keep specks crisp: depth recedes mostly via color brightness above, with a
    // light alpha taper so the far side reads behind the near side.
    float a = shape * uOpacity * mix(0.6, 1.0, vDepth);
    a *= (1.0 - 0.9 * clamp(uScatter, 0.0, 1.0));   // fade as the dots scatter out
    // As the dots settle onto the thin ring lines they stack densely; under
    // additive blending that pile-up blows out to a WHITE blob right at the
    // hand-off (the "white middling step"). Taper per-particle alpha toward full
    // convergence so spatial density rises but per-speck alpha falls in step - the
    // dotted rings hold a clean, defined brightness, and the crossfade to the
    // crisp mark reads as condensing INTO the rings, never a white flash.
    // The pile-up PEAKS mid-convergence (vConverge ~0.6-0.8), BEFORE the final
    // settle. The taper window is per-surface (uniforms): the dense splash bottoms
    // out the alpha BEFORE that peak (~0.16 -> 0.54) and to a near-zero floor, so
    // the specks are already gone where they would otherwise pile to white - the
    // crisp logo then provides the rings. Lighter header/404 surfaces hold bright
    // dotted rings later (default 0.34 -> 0.82, floor 0.13) since their lower
    // density never sums to white and the dots themselves draw the mark.
    a *= mix(1.0, uConvergeFloor, smoothstep(uConvergeStart, uConvergeEnd, vConverge));
    a *= vShimmer; // slow per-speck twinkle (1.0 when shimmer is off)
    gl_FragColor = vec4(color, a);
  }
`;
