import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { observeVisibility } from "@/lib/observe-visibility";
import { PYRUS_MARK_RINGS } from "@/lib/pyrus-mark-geometry";
import { PyrusMark } from "./pyrus-mark";

const CAMERA_FOV = 42;
const CAMERA_Z = 2.8;
const MAX_PIXEL_RATIO = 1.5;

export default function PyrusMark3DScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return undefined;
    }

    renderer.setClearAlpha(0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    camera.position.set(0, 0, CAMERA_Z);

    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    PYRUS_MARK_RINGS.forEach((ring, index) => {
      const geometry = new THREE.TorusGeometry(ring.radius, ring.tube, 10, 112);
      const material = new THREE.MeshBasicMaterial({
        color: ring.color,
        opacity: 0.9 - index * 0.08,
        transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = index * 0.08;
      mesh.rotation.y = -index * 0.12;
      group.add(mesh);
      geometries.push(geometry);
      materials.push(material);
    });

    scene.add(group);

    let disposed = false;
    let frameId: number | null = null;
    let visible = true;
    const timer = new THREE.Timer();
    timer.connect(document);

    const resize = () => {
      if (disposed) return;
      const width = Math.max(1, canvas.clientWidth || 1);
      const height = Math.max(1, canvas.clientHeight || 1);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(resize)
        : null;
    resizeObserver?.observe(canvas);
    resize();

    const renderFrame = (timestamp: number) => {
      if (disposed) return;
      frameId = window.requestAnimationFrame(renderFrame);
      timer.update(timestamp);
      const dt = Math.min(timer.getDelta(), 0.05);
      group.rotation.x += dt * 0.18;
      group.rotation.y += dt * 0.24;
      group.rotation.z += dt * 0.08;
      renderer.render(scene, camera);
    };

    const start = () => {
      if (frameId !== null || disposed || !visible) return;
      timer.reset();
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const stop = () => {
      if (frameId === null) return;
      window.cancelAnimationFrame(frameId);
      frameId = null;
    };

    const cleanupVisibility = observeVisibility(canvas, (nextVisible) => {
      visible = nextVisible;
      if (visible) start();
      else stop();
    });

    start();

    return () => {
      disposed = true;
      stop();
      cleanupVisibility();
      resizeObserver?.disconnect();
      timer.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
    };
  }, []);

  if (failed) return <PyrusMark className="pyrus-mark-3d-fallback" title="" />;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pyrus-mark-3d-canvas"
    />
  );
}
