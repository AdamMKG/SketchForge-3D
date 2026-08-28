import * as THREE from "three";
import type { ShapeFaceId, ShapeKind, WorkplaneShape } from "@/types/sketchforge";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";

// Declarative per-face texturing for primitive shapes.
//
// A "face" is a set of triangles that a user can pick in the 3D viewport and
// paint a texture onto. Faces are derived from the built geometry rather than
// hard-coded per kind so they track the tessellation actually rendered:
//   - primitives with Three.js material groups (box, cylinder, cone, polygon,
//     non-4-sided pyramid) map one face per group;
//   - smooth bodies (sphere, icosahedron, torus, text, scribble, tube, ring,
//     gear, rounded box) are a single "surface" face;
//   - flat custom builders (4-sided pyramid, wedge, roof, round roof, half
//     sphere) are clustered by geometric normal.
//
// UVs come from the built-in attribute where present, otherwise they are
// generated per face (planar projection onto the face plane, or a cylindrical
// projection for bodies of revolution).

export type FaceUvMode = "builtin" | "planar" | "cylindrical";

export type ShapeFace = {
  id: string;
  label: string;
  uv: FaceUvMode;
  // Reference normal of the face (geometry-local). Null for bodies where the
  // face does not sit in a single plane (e.g. a cylinder side or a dome).
  normal: THREE.Vector3 | null;
  // Triangle indices that make up the face. Contiguous after
  // `applyFaceTexturesToGeometry` has reordered a clustered geometry.
  triangles: number[];
  // Contiguous triangle range, valid once the geometry has been reordered
  // (or for geometries that already produce contiguous faces).
  triangleStart: number;
  triangleCount: number;
};

const GROUPED_KIND_LABELS: Partial<Record<ShapeKind, Array<{ id: string; label: string }>>> = {
  box: [
    { id: "px", label: "Right" },
    { id: "nx", label: "Left" },
    { id: "py", label: "Top" },
    { id: "ny", label: "Bottom" },
    { id: "pz", label: "Front" },
    { id: "nz", label: "Back" },
  ],
  cylinder: [
    { id: "side", label: "Side" },
    { id: "top", label: "Top" },
    { id: "bottom", label: "Bottom" },
  ],
  polygon: [
    { id: "side", label: "Side" },
    { id: "top", label: "Top" },
    { id: "bottom", label: "Bottom" },
  ],
  cone: [
    { id: "side", label: "Side" },
    { id: "top", label: "Top" },
    { id: "bottom", label: "Bottom" },
  ],
};

// Kinds rendered as one continuous surface. `uv` describes how to generate UVs
// when the geometry carries none.
const SURFACE_KINDS: Partial<Record<ShapeKind, { id: string; label: string; uv: FaceUvMode }>> = {
  sphere: { id: "surface", label: "Surface", uv: "builtin" },
  icosahedron: { id: "surface", label: "Surface", uv: "builtin" },
  torus: { id: "surface", label: "Surface", uv: "builtin" },
  text: { id: "surface", label: "Surface", uv: "builtin" },
  scribble: { id: "surface", label: "Surface", uv: "builtin" },
  tube: { id: "surface", label: "Surface", uv: "cylindrical" },
  ring: { id: "surface", label: "Surface", uv: "cylindrical" },
  gear: { id: "surface", label: "Surface", uv: "planar" },
};

// Flat custom builders whose triangles are interleaved across faces and so must
// be reordered before material groups can be applied.
const REORDER_KINDS = new Set<ShapeKind>(["pyramid", "wedge", "roof", "roundRoof"]);

const CLUSTER_TOLERANCE_RAD = 0.05;

export function isFaceTextureSupportedKind(kind: ShapeKind) {
  return kind !== "mesh" && kind !== "sketch";
}

export function hasFaceTextures(shape: WorkplaneShape) {
  if (shape.hole) return false;
  const faces = shape.faceTextures;
  return Boolean(faces) && Object.keys(faces ?? {}).length > 0;
}

function triangleCountOf(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  return Math.floor((position?.count ?? 0) / 3);
}

function triangleNormal(geometry: THREE.BufferGeometry, triangle: number, out: THREE.Vector3) {
  const position = geometry.getAttribute("position");
  const a = new THREE.Vector3().fromBufferAttribute(position, triangle * 3);
  const b = new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + 1);
  const c = new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + 2);
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  out.crossVectors(ab, ac);
  if (out.lengthSq() < 1e-14) {
    out.set(0, 1, 0);
    return false;
  }
  out.normalize();
  return true;
}

export function faceIdForNormal(normal: THREE.Vector3): string {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ay > 0.98) return normal.y > 0 ? "top" : "bottom";
  if (az > 0.98) return normal.z > 0 ? "front" : "back";
  if (ax > 0.98) return normal.x > 0 ? "right" : "left";
  if (az > ax) return normal.z > 0 ? "frontSlope" : "backSlope";
  if (ax > az) return normal.x > 0 ? "rightSlope" : "leftSlope";
  return "slope";
}

export function faceLabelForId(id: string) {
  const first = id.charAt(0).toUpperCase();
  return `${first}${id.slice(1)}`;
}

function faceFromTriangles(id: string, label: string, uv: FaceUvMode, normal: THREE.Vector3 | null, triangles: number[]) {
  return {
    id,
    label,
    uv,
    normal,
    triangles,
    triangleStart: triangles.length ? triangles[0] : 0,
    triangleCount: triangles.length,
  } satisfies ShapeFace;
}

function facesFromGroups(shape: WorkplaneShape, geometry: THREE.BufferGeometry) {
  const groups = geometry.groups;
  if (!groups.length) return null;
  const spec = GROUPED_KIND_LABELS[shape.kind];
  if (!spec) return null;
  const faces: ShapeFace[] = [];
  groups.forEach((group, groupIndex) => {
    const specIndex = shape.kind === "box"
      ? group.materialIndex ?? 0
      : groups.length < spec.length && groupIndex >= 1 ? groupIndex + 1 : groupIndex;
    const entry = spec[specIndex];
    if (!entry) return;
    const triangleStart = Math.floor(group.start / 3);
    const triangleCount = Math.floor(group.count / 3);
    const triangles: number[] = [];
    for (let index = triangleStart; index < triangleStart + triangleCount; index += 1) triangles.push(index);
    faces.push(faceFromTriangles(entry.id, entry.label, "builtin", null, triangles));
  });
  return faces.length ? faces : null;
}

function clusterFaces(geometry: THREE.BufferGeometry) {
  const triangleCount = triangleCountOf(geometry);
  const clusters: Array<{ normal: THREE.Vector3; triangles: number[] }> = [];
  const cosTolerance = Math.cos(CLUSTER_TOLERANCE_RAD);
  const tmp = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    triangleNormal(geometry, triangle, tmp);
    let cluster: (typeof clusters)[number] | undefined;
    for (const candidate of clusters) {
      if (candidate.normal.dot(tmp) >= cosTolerance) {
        cluster = candidate;
        break;
      }
    }
    if (!cluster) {
      cluster = { normal: tmp.clone(), triangles: [] };
      clusters.push(cluster);
    }
    cluster.triangles.push(triangle);
  }
  clusters.sort((a, b) => {
    const countDiff = b.triangles.length - a.triangles.length;
    if (countDiff !== 0) return countDiff;
    const keyA = faceIdForNormal(a.normal);
    const keyB = faceIdForNormal(b.normal);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  return clusters.map((cluster) => {
    const id = faceIdForNormal(cluster.normal);
    return faceFromTriangles(id, faceLabelForId(id), "planar", cluster.normal.clone(), cluster.triangles);
  });
}

function classifyRoundRoof(geometry: THREE.BufferGeometry) {
  const triangleCount = triangleCountOf(geometry);
  const dome: number[] = [];
  const front: number[] = [];
  const back: number[] = [];
  const bottom: number[] = [];
  const tmp = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    triangleNormal(geometry, triangle, tmp);
    if (tmp.y < -0.9) bottom.push(triangle);
    else if (tmp.z > 0.9) front.push(triangle);
    else if (tmp.z < -0.9) back.push(triangle);
    else dome.push(triangle);
  }
  return [
    faceFromTriangles("dome", "Dome", "builtin", null, dome),
    faceFromTriangles("front", "Front", "builtin", null, front),
    faceFromTriangles("back", "Back", "builtin", null, back),
    faceFromTriangles("bottom", "Bottom", "builtin", null, bottom),
  ];
}

function classifyHalfSphere(geometry: THREE.BufferGeometry) {
  const triangleCount = triangleCountOf(geometry);
  const dome: number[] = [];
  const bottom: number[] = [];
  const tmp = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    triangleNormal(geometry, triangle, tmp);
    if (tmp.y < -0.9) bottom.push(triangle);
    else dome.push(triangle);
  }
  return [
    faceFromTriangles("dome", "Dome", "cylindrical", null, dome),
    faceFromTriangles("bottom", "Bottom", "planar", new THREE.Vector3(0, -1, 0), bottom),
  ];
}

// Derives the ordered face list for a shape's geometry. Returns [] for kinds
// that cannot be face-textured (imported meshes, sketch bodies).
export function computeShapeFaces(shape: WorkplaneShape, geometry: THREE.BufferGeometry): ShapeFace[] {
  if (!isFaceTextureSupportedKind(shape.kind)) return [];

  const surface = SURFACE_KINDS[shape.kind];
  const isRoundedBox = shape.kind === "box" && Boolean(shape.radius && shape.radius > 0);

  const grouped = !isRoundedBox ? facesFromGroups(shape, geometry) : null;
  if (grouped) return grouped;

  if (isRoundedBox || surface) {
    const triangleCount = triangleCountOf(geometry);
    const spec = surface ?? { id: "surface", label: "Surface", uv: "builtin" };
    const triangles: number[] = [];
    for (let index = 0; index < triangleCount; index += 1) triangles.push(index);
    const uv: FaceUvMode = geometry.getAttribute("uv") ? "builtin" : spec.uv;
    return [faceFromTriangles(spec.id, spec.label, uv, null, triangles)];
  }

  if (shape.kind === "roundRoof") return classifyRoundRoof(geometry);
  if (shape.kind === "halfSphere") return classifyHalfSphere(geometry);
  if (shape.kind === "pyramid" && (shape.sides ?? 4) === 4) return clusterFaces(geometry);
  if (shape.kind === "wedge" || shape.kind === "roof") return clusterFaces(geometry);

  // Fallback: whole surface.
  const triangleCount = triangleCountOf(geometry);
  const triangles: number[] = [];
  for (let index = 0; index < triangleCount; index += 1) triangles.push(index);
  return [faceFromTriangles("surface", "Surface", "planar", null, triangles)];
}

function sortFaceIds(shape: WorkplaneShape) {
  return Object.keys(shape.faceTextures ?? {}).sort();
}

// Included in the geometry cache key so textured shapes get their own cached
// geometry with baked UVs + material groups.
export function faceTextureGeometryToken(shape: WorkplaneShape) {
  return sortFaceIds(shape).join(",");
}

// Included in the material cache key so texture edits re-sync materials.
export function faceTextureMaterialToken(shape: WorkplaneShape) {
  return sortFaceIds(shape)
    .map((id) => {
      const texture = shape.faceTextures?.[id as ShapeFaceId];
      return `${id}:${texture?.dataUrl ?? ""}:${texture?.useAsBump ? "bump" : "map"}:${texture?.bumpScale ?? 1}`;
    })
    .join("|");
}

function reorderGeometryByFace(geometry: THREE.BufferGeometry, faces: ShapeFace[]) {
  const position = geometry.getAttribute("position");
  const attributes: Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute> = {};
  (["uv", "normal"] as const).forEach((name) => {
    const attribute = geometry.getAttribute(name);
    if (attribute) attributes[name] = attribute;
  });

  const triangleCount = triangleCountOf(geometry);
  const reordered: Record<string, Float32Array> = { position: new Float32Array(position.array.length) };
  Object.keys(attributes).forEach((name) => {
    reordered[name] = new Float32Array(attributes[name].array.length);
  });

  let write = 0;
  faces.forEach((face) => {
    face.triangles.forEach((triangle) => {
      for (let corner = 0; corner < 3; corner += 1) {
        const readIndex = (triangle * 3 + corner) * 3;
        reordered.position[write * 3 + 0] = position.array[readIndex + 0];
        reordered.position[write * 3 + 1] = position.array[readIndex + 1];
        reordered.position[write * 3 + 2] = position.array[readIndex + 2];
        Object.keys(attributes).forEach((name) => {
          const source = attributes[name];
          const target = reordered[name];
          target[write * 3 + 0] = source.array[readIndex + 0];
          target[write * 3 + 1] = source.array[readIndex + 1];
          target[write * 3 + 2] = source.array[readIndex + 2];
        });
        write += 1;
      }
    });
    face.triangleStart = write / 3;
    face.triangleCount = face.triangles.length;
  });

  if (write !== triangleCount * 3) {
    return false;
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(reordered.position, 3));
  Object.keys(attributes).forEach((name) => {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(reordered[name], 3));
  });
  return true;
}

function generatePlanarUvsForFace(geometry: THREE.BufferGeometry, face: ShapeFace) {
  const position = geometry.getAttribute("position");
  const normal = face.normal ?? new THREE.Vector3(0, 1, 0).clone();
  if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
  normal.normalize();

  const basis = pickBasis(normal);
  const points: THREE.Vector2[] = [];
  let minU = Number.POSITIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  face.triangles.forEach((triangle) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const point = new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + corner);
      const u = point.dot(basis[0]);
      const v = point.dot(basis[1]);
      points.push(new THREE.Vector2(u, v));
      minU = Math.min(minU, u);
      minV = Math.min(minV, v);
      maxU = Math.max(maxU, u);
      maxV = Math.max(maxV, v);
    }
  });
  const spanU = Math.max(1e-9, maxU - minU);
  const spanV = Math.max(1e-9, maxV - minV);
  writeUvs(geometry, face, points, (point) => new THREE.Vector2((point.x - minU) / spanU, (point.y - minV) / spanV));
}

function generateCylindricalUvsForFace(geometry: THREE.BufferGeometry, face: ShapeFace) {
  const position = geometry.getAttribute("position");
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  face.triangles.forEach((triangle) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const y = position.getY(triangle * 3 + corner);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  });
  const spanY = Math.max(1e-9, maxY - minY);
  const points: THREE.Vector3[] = [];
  face.triangles.forEach((triangle) => {
    for (let corner = 0; corner < 3; corner += 1) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + corner));
    }
  });
  writeUvs(geometry, face, points, (point) =>
    new THREE.Vector2((Math.atan2(point.z, point.x) + Math.PI) / (Math.PI * 2), (point.y - minY) / spanY),
  );
}

function pickBasis(normal: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const axis = new THREE.Vector3(
    Math.abs(normal.x) < 0.9 ? 1 : 0,
    Math.abs(normal.y) < 0.9 ? 1 : 0,
    Math.abs(normal.z) < 0.9 ? 1 : 0,
  );
  if (axis.lengthSq() === 0) axis.set(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, normal).normalize();
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return [u, v];
}

function writeUvs<P extends THREE.Vector2 | THREE.Vector3>(
  geometry: THREE.BufferGeometry,
  face: ShapeFace,
  points: P[],
  project: (point: P) => THREE.Vector2,
) {
  let uv = geometry.getAttribute("uv");
  if (!uv) {
    uv = new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2);
    geometry.setAttribute("uv", uv);
  }
  let pointIndex = 0;
  face.triangles.forEach((triangle) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const projected = project(points[pointIndex]);
      uv.setXY(triangle * 3 + corner, projected.x, projected.y);
      pointIndex += 1;
    }
  });
  uv.needsUpdate = true;
}

// Prepares a shape's geometry for per-face materials:
//   - computes and caches the face list on `geometry.userData.shapeFaces`;
//   - when the shape has face textures, reorders clustered geometries so each
//     face is contiguous, generates UVs for faces that need them, and rebuilds
//     the material groups.
export function applyFaceTexturesToGeometry(geometry: THREE.BufferGeometry, shape: WorkplaneShape) {
  const faces = computeShapeFaces(shape, geometry);
  geometry.userData.shapeFaces = faces;
  if (!hasFaceTextures(shape) || !faces.length) return geometry;

  const texturedIds = new Set(Object.keys(shape.faceTextures ?? {}));

  const needsReorder = REORDER_KINDS.has(shape.kind) && !geometry.groups.length && !geometry.getIndex();
  if (needsReorder) {
    reorderGeometryByFace(geometry, faces);
  }

  faces.forEach((face) => {
    if (!texturedIds.has(face.id)) return;
    if (geometry.getAttribute("uv") && face.uv === "builtin") return;
    if (face.uv === "cylindrical") generateCylindricalUvsForFace(geometry, face);
    else generatePlanarUvsForFace(geometry, face);
  });

  geometry.clearGroups();
  faces.forEach((face, materialIndex) => {
    geometry.addGroup(face.triangleStart * 3, face.triangleCount * 3, materialIndex);
  });
  (geometry as THREE.BufferGeometry & { groupsNeedUpdate?: boolean }).groupsNeedUpdate = true;
  return geometry;
}
export function faceTrianglesCopy(geometry: THREE.BufferGeometry, face: ShapeFace): Float32Array {
  const position = geometry.getAttribute("position");
  const out = new Float32Array(face.triangles.length * 9);
  face.triangles.forEach((triangle, index) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const source = (triangle * 3 + corner) * 3;
      const target = (index * 3 + corner) * 3;
      out[target + 0] = position.array[source + 0];
      out[target + 1] = position.array[source + 1];
      out[target + 2] = position.array[source + 2];
    }
  });
  return out;
}

export function pickPlaneBasis(normal: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const axis = new THREE.Vector3(
    Math.abs(normal.x) < 0.9 ? 1 : 0,
    Math.abs(normal.y) < 0.9 ? 1 : 0,
    Math.abs(normal.z) < 0.9 ? 1 : 0,
  );
  if (axis.lengthSq() === 0) axis.set(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, normal).normalize();
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return [u, v];
}

// Computes the texture repeat that keeps tiles square on a non-square face.
// Box faces are measured through the shape dimensions because the shared box
// geometry is the unit cube stretched by a non-uniform mesh scale.
export function faceTextureRepeat(shape: WorkplaneShape, geometry: THREE.BufferGeometry, face: ShapeFace) {
  let extentU = 0;
  let extentV = 0;
  if (shape.kind === "box") {
    const width = shapeWidth(shape);
    const depth = shapeDepth(shape);
    const height = shape.height;
    if (face.id === "py" || face.id === "ny") {
      extentU = width;
      extentV = depth;
    } else if (face.id === "pz" || face.id === "nz") {
      extentU = width;
      extentV = height;
    } else if (face.id === "px" || face.id === "nx") {
      extentU = depth;
      extentV = height;
    }
  } else if (face.normal && face.uv === "planar") {
    const positions = faceTrianglesCopy(geometry, face);
    const basis = pickPlaneBasis(face.normal);
    let minU = Number.POSITIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const point = new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
      const u = point.dot(basis[0]);
      const v = point.dot(basis[1]);
      minU = Math.min(minU, u);
      minV = Math.min(minV, v);
      maxU = Math.max(maxU, u);
      maxV = Math.max(maxV, v);
    }
    extentU = Math.max(1e-9, maxU - minU);
    extentV = Math.max(1e-9, maxV - minV);
  }
  if (extentU <= 0 || extentV <= 0) return new THREE.Vector2(1, 1);
  if (extentU >= extentV) return new THREE.Vector2(extentU / extentV, 1);
  return new THREE.Vector2(1, extentV / extentU);
}
