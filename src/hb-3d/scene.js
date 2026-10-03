import {
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  Spherical,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildKettle, SURFACES } from './kettle.js';

const FOV = 30;
const DEFAULT_VIEW = { azimuth: 0.35, polar: 1.33, distance: 0.84 };
// Camera angle per detail. Distance is a fraction of the "whole kettle fits" distance.
const PART_VIEWS = {
  spout: { azimuth: 0.55, polar: 1.2, distance: 0.62 },
  handle: { azimuth: -0.95, polar: 1.35, distance: 0.66 },
  lid: { azimuth: 0.3, polar: 0.78, distance: 0.72 },
  base: { azimuth: 0.25, polar: 1.72, distance: 0.66 },
};
const LID_LIFT = 5;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function contactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.16)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

/**
 * Mounts the 3D kettle into `host` and positions the given hotspot buttons over it.
 * Throws if WebGL is unavailable so the caller can keep its poster image.
 *
 * @param {object} options
 * @param {HTMLElement} options.host - element the canvas is appended to; its size drives the canvas
 * @param {{ part: string, element: HTMLElement }[]} options.hotspots
 * @param {object} options.finish - { body, handle, knob, surface }
 * @param {number} options.capacityMl
 * @param {boolean} options.reducedMotion
 * @param {() => void} options.onUserInteract - first drag/zoom by the shopper
 */
export function mountScene({ host, hotspots = [], finish, capacityMl, reducedMotion = false, onUserInteract }) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = NeutralToneMapping;
  renderer.domElement.classList.add('hb-configurator__gl');
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();

  const key = new DirectionalLight('#ffffff', 1.4);
  key.position.set(-20, 40, 30);
  scene.add(key);

  const kettle = buildKettle({ capacityMl });
  scene.add(kettle.group);

  const box = new Box3().setFromObject(kettle.group);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = 0.5 * Math.hypot(size.x, size.y);

  const shadow = new Mesh(
    new PlaneGeometry(size.x * 1.25, size.x * 0.9),
    new MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(center.x * 0.6, 0.02, 0);
  scene.add(shadow);

  const camera = new PerspectiveCamera(FOV, 1, 1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.8;
  controls.autoRotateSpeed = 0.8;
  controls.autoRotate = !reducedMotion;
  controls.target.copy(center);

  let fitDistance = 60;
  let placed = false;
  let needsRender = true;
  let tweens = [];
  let running = false;
  let inView = false;
  let interacted = false;
  let exploded = false;

  const requestRender = () => {
    needsRender = true;
  };

  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => {
    if (interacted) return;
    interacted = true;
    controls.autoRotate = false;
    onUserInteract?.();
  });

  // Let the page scroll on a plain wheel; only Ctrl/⌘ + wheel zooms the model.
  const onWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) event.stopImmediatePropagation();
  };
  host.addEventListener('wheel', onWheel, { capture: true });

  function animate(duration, update) {
    return new Promise((resolve) => {
      if (reducedMotion || duration === 0) {
        update(1);
        requestRender();
        resolve();
        return;
      }
      tweens.push({ start: performance.now(), duration, update, resolve });
    });
  }

  function currentSpherical() {
    return new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  }

  function placeCamera(target, spherical) {
    controls.target.copy(target);
    camera.position.setFromSpherical(spherical).add(target);
    camera.lookAt(target);
  }

  function anchorWorld(part, out = new Vector3()) {
    const anchor = kettle.anchors[part];
    return anchor.object.localToWorld(out.copy(anchor.position));
  }

  function flyTo(view, target, duration = 900) {
    const from = currentSpherical();
    const fromTarget = controls.target.clone();
    let deltaTheta = view.azimuth - from.theta;
    deltaTheta = Math.atan2(Math.sin(deltaTheta), Math.cos(deltaTheta));
    const to = {
      theta: from.theta + deltaTheta,
      phi: MathUtils.clamp(view.polar, controls.minPolarAngle, controls.maxPolarAngle),
      radius: view.distance * fitDistance,
    };
    controls.autoRotate = false;
    controls.enabled = false;
    const spherical = new Spherical();
    const t = new Vector3();
    return animate(duration, (k) => {
      const e = ease(k);
      spherical.set(
        MathUtils.lerp(from.radius, to.radius, e),
        MathUtils.lerp(from.phi, to.phi, e),
        MathUtils.lerp(from.theta, to.theta, e)
      );
      placeCamera(t.lerpVectors(fromTarget, target, e), spherical);
    }).then(() => {
      controls.enabled = true;
    });
  }

  // Narrow (portrait) stages get a little more room around the model for the overlays.
  const defaultView = () => ({ ...DEFAULT_VIEW, distance: DEFAULT_VIEW.distance * (camera.aspect < 1.2 ? 1.3 : 1) });

  function fit() {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const vertical = MathUtils.degToRad(FOV) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const previous = fitDistance;
    fitDistance = (radius / Math.sin(Math.min(vertical, horizontal))) * 1.02;
    controls.minDistance = fitDistance * 0.4;
    controls.maxDistance = fitDistance * 1.6;

    if (!placed) {
      placed = true;
      const view = defaultView();
      placeCamera(center, new Spherical(fitDistance * view.distance, view.polar, view.azimuth));
    } else {
      const spherical = currentSpherical();
      spherical.radius *= fitDistance / previous;
      placeCamera(controls.target.clone(), spherical);
    }
    requestRender();
  }

  const raycaster = new Raycaster();
  const world = new Vector3();
  const projected = new Vector3();
  const direction = new Vector3();

  function updateHotspots() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    for (const { part, element } of hotspots) {
      if (!kettle.anchors[part]) continue;
      anchorWorld(part, world);
      projected.copy(world).project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;

      direction.copy(world).sub(camera.position);
      const distance = direction.length();
      raycaster.set(camera.position, direction.normalize());
      raycaster.far = distance - 0.5;
      const occluded = raycaster.intersectObjects(kettle.meshes, false).length > 0;

      element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      element.classList.toggle('is-occluded', occluded);
    }
  }

  function tick() {
    const now = performance.now();
    if (tweens.length) {
      tweens = tweens.filter((tween) => {
        const k = Math.min(1, (now - tween.start) / tween.duration);
        tween.update(k);
        if (k < 1) return true;
        tween.resolve();
        return false;
      });
      needsRender = true;
    } else if (controls.update()) {
      needsRender = true;
    }

    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
    updateHotspots();
  }

  function setRunning() {
    const shouldRun = inView && !document.hidden;
    if (shouldRun === running) return;
    running = shouldRun;
    renderer.setAnimationLoop(running ? tick : null);
  }

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    setRunning();
  });
  intersectionObserver.observe(host);
  document.addEventListener('visibilitychange', setRunning);

  function applyFinish(next, duration = 450) {
    const surface = SURFACES[next.surface] || SURFACES.matte;
    const { body, handle, knob } = kettle.materials;
    const start = {
      body: body.color.clone(),
      handle: handle.color.clone(),
      knob: knob.color.clone(),
      metalness: body.metalness,
      roughness: body.roughness,
      clearcoat: body.clearcoat,
      clearcoatRoughness: body.clearcoatRoughness,
    };
    const end = {
      body: new Color(next.body || '#1d1d1f'),
      handle: new Color(next.handle || '#141414'),
      knob: new Color(next.knob || '#6b4a2f'),
    };
    return animate(duration, (k) => {
      const e = ease(k);
      body.color.lerpColors(start.body, end.body, e);
      handle.color.lerpColors(start.handle, end.handle, e);
      knob.color.lerpColors(start.knob, end.knob, e);
      body.metalness = MathUtils.lerp(start.metalness, surface.metalness, e);
      body.roughness = MathUtils.lerp(start.roughness, surface.roughness, e);
      body.clearcoat = MathUtils.lerp(start.clearcoat, surface.clearcoat, e);
      body.clearcoatRoughness = MathUtils.lerp(start.clearcoatRoughness, surface.clearcoatRoughness, e);
    });
  }

  applyFinish(finish, 0);
  fit();

  return {
    setFinish: (next) => applyFinish(next),

    focusPart(part) {
      const view = PART_VIEWS[part];
      if (!view || !kettle.anchors[part]) return Promise.resolve();
      const anchor = anchorWorld(part);
      // The lid may still be mid-lift: aim at where it will end up.
      if (part === 'lid') anchor.y += ((exploded ? LID_LIFT : 0) - kettle.lid.position.y) * kettle.group.scale.y;
      const target = new Vector3().lerpVectors(center, anchor, 0.6);
      return flyTo(view, target);
    },

    resetView() {
      return flyTo(defaultView(), center);
    },

    setExploded(value) {
      if (value === exploded) return Promise.resolve();
      exploded = value;
      const from = kettle.lid.position.y;
      const fromTilt = kettle.lid.rotation.z;
      const to = value ? LID_LIFT : 0;
      const toTilt = value ? 0.18 : 0;
      return animate(700, (k) => {
        const e = ease(k);
        kettle.lid.position.y = MathUtils.lerp(from, to, e);
        kettle.lid.rotation.z = MathUtils.lerp(fromTilt, toTilt, e);
      });
    },

    setAutoRotate(value) {
      controls.autoRotate = value && !reducedMotion;
      requestRender();
    },

    get autoRotate() {
      return controls.autoRotate;
    },

    /** Keyboard/button control: rotate by radians and/or zoom by a factor (<1 zooms in). */
    nudge({ azimuth = 0, polar = 0, zoom = 1 } = {}) {
      const spherical = currentSpherical();
      spherical.theta += azimuth;
      spherical.phi = MathUtils.clamp(spherical.phi + polar, controls.minPolarAngle, controls.maxPolarAngle);
      spherical.radius = MathUtils.clamp(spherical.radius * zoom, controls.minDistance, controls.maxDistance);
      controls.autoRotate = false;
      placeCamera(controls.target.clone(), spherical);
      requestRender();
    },

    dispose() {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', setRunning);
      host.removeEventListener('wheel', onWheel, { capture: true });
      controls.dispose();
      scene.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          material.map?.dispose();
          material.dispose();
        });
      });
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
