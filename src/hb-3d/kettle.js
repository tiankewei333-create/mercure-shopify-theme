import {
  CanvasTexture,
  CatmullRomCurve3,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';

// Surface presets a merchant picks per finish. Values are physically based (metalness/roughness).
export const SURFACES = {
  matte: { metalness: 0.15, roughness: 0.62, clearcoat: 0, clearcoatRoughness: 0 },
  satin: { metalness: 1, roughness: 0.3, clearcoat: 0, clearcoatRoughness: 0 },
  polished: { metalness: 1, roughness: 0.08, clearcoat: 0, clearcoatRoughness: 0 },
  glazed: { metalness: 0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 },
};

const v2 = (x, y) => new Vector2(x, y);

// Lathe profiles as (radius, height) in centimetres, modelled on the 600 ml kettle.
const BODY_PROFILE = [
  v2(0, 0),
  v2(5.5, 0),
  v2(5.95, 0.15),
  v2(6.1, 0.6),
  v2(6.0, 2),
  v2(5.4, 7),
  v2(4.75, 11.2),
  v2(4.55, 11.8),
  v2(4.2, 12.05),
  v2(4.05, 12.0),
  v2(4.0, 11.0),
];

const LID_PROFILE = [
  v2(0, 12.75),
  v2(2.8, 12.7),
  v2(4.2, 12.35),
  v2(4.4, 12.15),
  v2(4.4, 11.95),
  v2(3.9, 11.95),
  v2(3.85, 11.4),
];

const KNOB_PROFILE = [
  v2(0, 12.7),
  v2(1.15, 12.7),
  v2(1.2, 12.9),
  v2(1.45, 13.9),
  v2(1.4, 14.6),
  v2(1.1, 14.95),
  v2(0, 15.0),
];

const SPOUT_PATH = [
  [5.0, 2.2],
  [6.6, 2.6],
  [8.4, 4.4],
  [9.6, 7.6],
  [10.4, 10.8],
  [11.2, 13.0],
  [12.6, 14.3],
  [14.3, 14.6],
  [15.6, 14.1],
].map(([x, y]) => new Vector3(x, y, 0));

const HANDLE_PATH = [
  [-3.9, 11.6],
  [-6.5, 11.9],
  [-8.6, 11.5],
  [-9.6, 10.2],
  [-9.8, 7.0],
  [-9.3, 4.6],
  [-8.0, 3.4],
  [-5.6, 3.3],
].map(([x, y]) => new Vector3(x, y, 0));

/**
 * A tube whose cross-section radius follows `radiusAt(t)` along the path, optionally squashed on z.
 * TubeGeometry lays vertices out ring by ring, (radial + 1) per ring, centred on path.getPointAt(i / segments).
 */
function shapedTube(points, radiusAt, { segments = 120, radial = 28, zScale = 1 } = {}) {
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const geometry = new TubeGeometry(curve, segments, 1, radial, false);
  const position = geometry.attributes.position;
  const center = new Vector3();
  const vertex = new Vector3();

  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, center);
    const radius = radiusAt(i / segments);
    for (let j = 0; j <= radial; j++) {
      const index = i * (radial + 1) + j;
      vertex.fromBufferAttribute(position, index).sub(center).multiplyScalar(radius);
      vertex.z *= zScale;
      vertex.add(center);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  if (zScale !== 1) geometry.computeVertexNormals();
  return geometry;
}

function woodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Lathe UVs run u around the knob, v up it: vertical streaks read as end-grain stripes.
  for (let x = 0; x < canvas.width; x += 1) {
    const shade = 200 + Math.round(40 * Math.sin(x * 0.21) * Math.sin(x * 0.047) + 15 * Math.random());
    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    ctx.fillRect(x, 0, 1, canvas.height);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Builds the gooseneck kettle. Bigger capacities stretch the body; 600 ml is the reference size.
 * Returns the group, the materials the finish controls, the movable lid and hotspot anchors
 * (local position + owning object, so anchors follow the lid when it lifts).
 */
export function buildKettle({ capacityMl = 600 } = {}) {
  const group = new Group();
  const scale = Math.max(0.6, Math.min(2.5, capacityMl / 600));
  group.scale.set(scale ** 0.3, scale ** 0.4, scale ** 0.3);

  const materials = {
    body: new MeshPhysicalMaterial({ color: '#1d1d1f', side: DoubleSide, ...SURFACES.matte }),
    handle: new MeshPhysicalMaterial({ color: '#141414', metalness: 0, roughness: 0.55 }),
    knob: new MeshPhysicalMaterial({ color: '#6b4a2f', metalness: 0, roughness: 0.5, map: woodTexture() }),
  };

  const body = new Mesh(new LatheGeometry(BODY_PROFILE, 128), materials.body);
  const spout = new Mesh(
    shapedTube(SPOUT_PATH, (t) => 0.95 - 0.55 * t),
    materials.body
  );
  const handle = new Mesh(
    shapedTube(HANDLE_PATH, (t) => 0.78 - 0.12 * Math.sin(Math.PI * t), { zScale: 1.35, radial: 24 }),
    materials.handle
  );

  const lid = new Group();
  lid.add(new Mesh(new LatheGeometry(LID_PROFILE, 128), materials.body));
  lid.add(new Mesh(new LatheGeometry(KNOB_PROFILE, 64), materials.knob));

  group.add(body, spout, handle, lid);

  const anchors = {
    spout: { object: spout, position: new Vector3(16.1, 14.6, 0) },
    handle: { object: handle, position: new Vector3(-10.8, 7.5, 0) },
    lid: { object: lid, position: new Vector3(0, 15.6, 0) },
    base: { object: body, position: new Vector3(0, 0.7, 6.7) },
  };

  const meshes = [];
  group.traverse((child) => child.isMesh && meshes.push(child));

  return { group, materials, lid, anchors, meshes };
}
