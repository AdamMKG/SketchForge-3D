import * as THREE from "three";

export type SeamVec3 = [number, number, number];

// The cut plane is perpendicular to the shape face at the first picked point
// and contains the drawn seam line. `normal` points at the half that keeps the
// pins, `tangent` runs along the seam, `faceUp` is the in-plane vertical.
export type SeamPlane = {
  point: SeamVec3;
  normal: SeamVec3;
  tangent: SeamVec3;
  faceUp: SeamVec3;
};

export type SeamBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type SeamKeySpec = {
  keyNum: number;
  keyWidth: number;
  keyDepth: number;
  keyThroat: number;
  keyFlare: number;
  keyBuried: number;
  keyGap: number;
  endMargin: number;
  clearance: number;
};

export type SeamCutOptions = {
  keyCount: number;
  keyWidth: number;
  keyDepth: number;
  keyThroat: number;
  keyFlare: number;
  keyGap: number;
  clearance: number;
  flip: boolean;
};

export const DEFAULT_SEAM_OPTIONS: SeamCutOptions = {
  keyCount: 3,
  keyWidth: 8,
  keyDepth: 5,
  keyThroat: 3,
  keyFlare: 4.5,
  keyGap: 14,
  clearance: 0.1,
  flip: false,
};

export function seamKeySpecFromOptions(options: SeamCutOptions): SeamKeySpec {
  return {
    keyNum: options.keyCount,
    keyWidth: options.keyWidth,
    keyDepth: options.keyDepth,
    keyThroat: options.keyThroat,
    keyFlare: options.keyFlare,
    keyBuried: 3,
    keyGap: options.keyGap,
    endMargin: 2,
    clearance: options.clearance,
  };
}

export type SeamKeyCenter = {
  center: SeamVec3;
  tangentOffset: number;
};

export type SeamKeyLayout = {
  keys: SeamKeyCenter[];
  count: number;
  tenonPolygon: Array<[number, number]>;
  socketPolygon: Array<[number, number]>;
  socketOffset: number;
};

export function seamPlaneFromPoints(p1: SeamVec3, faceNormal: SeamVec3, p2: SeamVec3): SeamPlane | null {
  const a = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const b = new THREE.Vector3(p2[0], p2[1], p2[2]);
  const n = new THREE.Vector3(faceNormal[0], faceNormal[1], faceNormal[2]);
  if (n.lengthSq() < 1e-10) {
    return null;
  }
  n.normalize();
  const displacement = new THREE.Vector3().subVectors(b, a);
  if (displacement.lengthSq() < 1e-8) {
    return null;
  }
  const tangent = displacement.clone().projectOnPlane(n);
  if (tangent.lengthSq() < 1e-10) {
    return null;
  }
  tangent.normalize();
  const normal = new THREE.Vector3().crossVectors(n, tangent);
  if (normal.lengthSq() < 1e-10) {
    return null;
  }
  normal.normalize();
  return {
    point: [a.x, a.y, a.z],
    normal: [normal.x, normal.y, normal.z],
    tangent: [tangent.x, tangent.y, tangent.z],
    faceUp: [n.x, n.y, n.z],
  };
}

// Interval of `plane.point + s * plane.tangent` that lies inside the AABB
// (slab method along the seam tangent).
export function seamLineInterval(box: SeamBox, plane: SeamPlane): [number, number] | null {
  const t = new THREE.Vector3(plane.tangent[0], plane.tangent[1], plane.tangent[2]);
  const p = new THREE.Vector3(plane.point[0], plane.point[1], plane.point[2]);
  const mins = [box.minX, box.minY, box.minZ];
  const maxs = [box.maxX, box.maxY, box.maxZ];
  const origin = [p.x, p.y, p.z];
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const direction = t.getComponent(axis);
    const start = origin[axis];
    if (Math.abs(direction) < 1e-12) {
      if (start < mins[axis] || start > maxs[axis]) {
        return null;
      }
      continue;
    }
    const exit0 = (mins[axis] - start) / direction;
    const exit1 = (maxs[axis] - start) / direction;
    lo = Math.max(lo, Math.min(exit0, exit1));
    hi = Math.min(hi, Math.max(exit0, exit1));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
    return null;
  }
  return [lo, hi];
}

export function maxSeamKeyCount(span: number, keyWidth: number, keyGap: number, endMargin: number) {
  const usable = span - 2 * endMargin;
  if (usable <= 0 || keyWidth <= 0) {
    return 0;
  }
  return Math.floor((usable + keyGap) / (keyWidth + keyGap));
}

export function clampSeamKeyCount(requested: number, span: number, keyWidth: number, keyGap: number, endMargin: number) {
  const allowed = maxSeamKeyCount(span, keyWidth, keyGap, endMargin);
  if (allowed < 1 || requested < 1) {
    return 0;
  }
  return Math.max(1, Math.min(Math.floor(requested), allowed));
}

export function seamKeyTenonPolygon(spec: SeamKeySpec): Array<[number, number]> {
  return [
    [-spec.keyBuried, -spec.keyThroat],
    [0, -spec.keyThroat],
    [spec.keyDepth, -spec.keyFlare],
    [spec.keyDepth, spec.keyFlare],
    [0, spec.keyThroat],
    [-spec.keyBuried, spec.keyThroat],
  ];
}

export function seamKeySocketPolygon(spec: SeamKeySpec): Array<[number, number]> {
  const clearance = spec.clearance;
  return [
    [-(spec.keyBuried + clearance), -(spec.keyThroat + clearance)],
    [-clearance, -(spec.keyThroat + clearance)],
    [spec.keyDepth + clearance, -(spec.keyFlare + clearance)],
    [spec.keyDepth + clearance, spec.keyFlare + clearance],
    [-clearance, spec.keyThroat + clearance],
    [-(spec.keyBuried + clearance), spec.keyThroat + clearance],
  ];
}

export function layoutSeamKeys(plane: SeamPlane, box: SeamBox, spec: SeamKeySpec): SeamKeyLayout | null {
  const interval = seamLineInterval(box, plane);
  if (!interval) {
    return null;
  }
  const span = interval[1] - interval[0];
  const count = clampSeamKeyCount(spec.keyNum, span, spec.keyWidth, spec.keyGap, spec.endMargin);
  if (count < 1) {
    return null;
  }
  const positions: number[] = [];
  const first = interval[0] + spec.endMargin + spec.keyWidth / 2;
  if (count === 1) {
    positions.push((interval[0] + interval[1]) / 2);
  } else {
    const step = (span - 2 * spec.endMargin - spec.keyWidth) / (count - 1);
    for (let index = 0; index < count; index += 1) {
      positions.push(first + index * step);
    }
  }
  const point = new THREE.Vector3(plane.point[0], plane.point[1], plane.point[2]);
  const tangent = new THREE.Vector3(plane.tangent[0], plane.tangent[1], plane.tangent[2]);
  const keys = positions.map((s) => {
    const center = new THREE.Vector3().copy(point).addScaledVector(tangent, s);
    return { center: [center.x, center.y, center.z] as SeamVec3, tangentOffset: s };
  });
  return {
    keys,
    count,
    tenonPolygon: seamKeyTenonPolygon(spec),
    socketPolygon: seamKeySocketPolygon(spec),
    socketOffset: spec.clearance,
  };
}

// Rectangular patch of the seam plane for the viewport "saw blade" overlay.
// Centered on the seam point, spanning the seam interval along the tangent and
// the box's full extent along `faceUp`, padded so the blade clearly covers the
// shape's section on the cut plane.
export function seamPlaneCorners(box: SeamBox, plane: SeamPlane, pad = 4): SeamVec3[] | null {
  const t = new THREE.Vector3(plane.tangent[0], plane.tangent[1], plane.tangent[2]);
  const v = new THREE.Vector3(plane.faceUp[0], plane.faceUp[1], plane.faceUp[2]);
  const point = new THREE.Vector3(plane.point[0], plane.point[1], plane.point[2]);
  const originTangent = point.dot(t);
  const originVertical = point.dot(v);
  let vHalf = 0;
  aabbCorners(box).forEach((corner) => {
    const elevation = corner[0] * v.x + corner[1] * v.y + corner[2] * v.z;
    vHalf = Math.max(vHalf, Math.abs(elevation - originVertical));
  });
  const interval = seamLineInterval(box, plane);
  if (!interval) {
    return null;
  }
  const tHalf = Math.max(Math.abs(interval[0] - originTangent), Math.abs(interval[1] - originTangent));
  const tReach = tHalf + pad;
  const vReach = vHalf + pad;
  return [
    [-tReach, -vReach],
    [-tReach, vReach],
    [tReach, vReach],
    [tReach, -vReach],
  ].map(([offset, elevation]) => {
    const world = new THREE.Vector3()
      .copy(point)
      .addScaledVector(t, offset)
      .addScaledVector(v, elevation);
    return [world.x, world.y, world.z] as SeamVec3;
  });
}

export function aabbCorners(box: SeamBox): SeamVec3[] {
  return [
    [box.minX, box.minY, box.minZ],
    [box.maxX, box.minY, box.minZ],
    [box.minX, box.maxY, box.minZ],
    [box.maxX, box.maxY, box.minZ],
    [box.minX, box.minY, box.maxZ],
    [box.maxX, box.minY, box.maxZ],
    [box.minX, box.maxY, box.maxZ],
    [box.maxX, box.maxY, box.maxZ],
  ];
}