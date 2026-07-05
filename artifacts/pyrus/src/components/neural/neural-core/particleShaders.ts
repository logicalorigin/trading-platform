// GLSL for the neural particle system. The vertex shader does ALL per-particle
// work on the GPU: ambient drift, sphere→logo morph (uMorph), and the outward
// disperse (uScatter). The CPU only writes a handful of uniforms per frame.

export const NEURAL_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aSpherePos;   // drifting "loading" cloud position
  attribute vec3 aTargetPos;   // sampled PYRUS-lockup position
  attribute vec3 aRandom;      // unit-ish scatter direction
  attribute float aPhase;      // per-particle drift phase [0,1)

  uniform float uTime;
  uniform float uMorph;        // 0 = sphere, 1 = logo
  uniform float uScatter;      // 0 = formed, 1 = fully dispersed
  uniform float uPointSize;
  uniform float uPixelRatio;

  varying float vRadius;       // target distance from center (drives color)

  void main() {
    // Ambient drift applied to the sphere phase only, so the formed logo is crisp.
    float t = uTime * 0.6 + aPhase * 6.2831853;
    vec3 sphere = aSpherePos + 0.05 * vec3(sin(t), cos(t * 1.1), sin(t * 0.7));

    float m = smoothstep(0.0, 1.0, uMorph);
    vec3 pos = mix(sphere, aTargetPos, m);

    // Disperse outward along a per-particle random direction.
    pos += aRandom * uScatter * 3.2;

    vRadius = clamp(length(aTargetPos.xy) / 1.6, 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Distance + DPR attenuated point size.
    gl_PointSize = uPointSize * uPixelRatio * (300.0 / max(0.001, -mvPosition.z));
  }
`;

export const NEURAL_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform float uOpacity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  varying float vRadius;

  void main() {
    // Soft round sprite.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float mask = smoothstep(0.5, 0.12, length(uv));
    if (mask <= 0.001) discard;

    vec3 color = mix(uColorA, uColorB, smoothstep(0.0, 0.5, vRadius));
    color = mix(color, uColorC, smoothstep(0.5, 1.0, vRadius));

    gl_FragColor = vec4(color, mask * uOpacity);
  }
`;
