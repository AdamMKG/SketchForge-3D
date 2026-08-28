import * as THREE from "three";
import type { WorkplaneShape } from "@/types/sketchforge";
import { applyFaceTexturesToGeometry, faceTextureRepeat, type ShapeFace } from "@/lib/faceTextures";

// Relief export: turns a face texture into actual geometry displacement.
//
// Textured faces are subdivided into `detail x detail` triangles, welded
// within each face, and every vertex is pushed along its smooth vertex normal
// by `depthMm * (luminance - 0.5)`. Face UVs are sampled with the same repeat
// used by the viewport material so the carved pattern matches what is painted
// on the shape. Faces that share no texture are copied through untouched.

export type ReliefOptions = {
  depthMm: number;
  detail: number;
};

// Samples a luminance value in [0, 1] for normalized texture coordinates
// (u, v) in [0, 1). Callers are responsible for applying the face repeat and
// wrapping before calling.
export type ReliefSample = (u: number, v: number) => number;

export function hasReliefFaces(shape: WorkplaneShape) {
  const textures = shape.faceTextures;
  return Boolean(textures) && Object.keys(textures ?? {}).length > 0;
}

function frac(value: number) {
  return ((value % 1) + 1) % 1;
}

function subdivideFaceRange(
  geometry: THREE.BufferGeometry,
  face: ShapeFace,
  detail: number,
  positions: number[],
  uvs: number[],
) {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const hasUv = Boolean(uv);
  const pushVertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z);
    if (hasUv) uvs.push(u, v);
  };
  for (let triangle = 0; triangle < face.triangleCount; triangle += 1) {
    const base = (face.triangleStart + triangle) * 3;
    const p = [0, 1, 2].map((corner) => {
      const index = base + corner;
      return [position.getX(index), position.getY(index), position.getZ(index)];
    });
    const t = [0, 1, 2].map((corner) => {
      if (!uv) return [0, 0];
      const index = base + corner;
      return [uv.getX(index), uv.getY(index)];
    });

    const gridX: number[] = [];
    const gridY: number[] = [];
    const gridZ: number[] = [];
    const gridU: number[] = [];
    const gridV: number[] = [];
    const rowStart: number[] = [];
    for (let i = 0; i <= detail; i += 1) {
      rowStart.push(gridX.length);
      for (let j = 0; j <= detail - i; j += 1) {
        const fi = i / detail;
        const fj = j / detail;
        const w0 = 1 - fi - fj;
        const w1 = fi;
        const w2 = fj;
        gridX.push(w0 * p[0][0] + w1 * p[1][0] + w2 * p[2][0]);
        gridY.push(w0 * p[0][1] + w1 * p[1][1] + w2 * p[2][1]);
        gridZ.push(w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2]);
        gridU.push(w0 * t[0][0] + w1 * t[1][0] + w2 * t[2][0]);
        gridV.push(w0 * t[0][1] + w1 * t[1][1] + w2 * t[2][1]);
      }
    }
    const vertexAt = (i: number, j: number) => rowStart[i] + j;

    for (let i = 0; i < detail; i += 1) {
      for (let j = 0; j < detail - i; j += 1) {
        const a = vertexAt(i, j);
        const b = vertexAt(i + 1, j);
        const c = vertexAt(i, j + 1);
        if (i + j === detail - 1) {
          // Slanted-edge cell: the fourth grid point does not exist, the cell
          // is the single upward triangle (a, b, c).
          pushVertex(gridX[a], gridY[a], gridZ[a], gridU[a], gridV[a]);
          pushVertex(gridX[b], gridY[b], gridZ[b], gridU[b], gridV[b]);
          pushVertex(gridX[c], gridY[c], gridZ[c], gridU[c], gridV[c]);
          continue;
        }
        const d = vertexAt(i + 1, j + 1);
        if ((i + j) % 2 === 0) {
          pushVertex(gridX[a], gridY[a], gridZ[a], gridU[a], gridV[a]);
          pushVertex(gridX[b], gridY[b], gridZ[b], gridU[b], gridV[b]);
          pushVertex(gridX[d], gridY[d], gridZ[d], gridU[d], gridV[d]);
          pushVertex(gridX[a], gridY[a], gridZ[a], gridU[a], gridV[a]);
          pushVertex(gridX[d], gridY[d], gridZ[d], gridU[d], gridV[d]);
          pushVertex(gridX[c], gridY[c], gridZ[c], gridU[c], gridV[c]);
        } else {
          pushVertex(gridX[a], gridY[a], gridZ[a], gridU[a], gridV[a]);
          pushVertex(gridX[b], gridY[b], gridZ[b], gridU[b], gridV[b]);
          pushVertex(gridX[c], gridY[c], gridZ[c], gridU[c], gridV[c]);
          pushVertex(gridX[b], gridY[b], gridZ[b], gridU[b], gridV[b]);
          pushVertex(gridX[d], gridY[d], gridZ[d], gridU[d], gridV[d]);
          pushVertex(gridX[c], gridY[c], gridZ[c], gridU[c], gridV[c]);
        }
      }
    }
  }
}

// Displaces a prepared, face-ordered geometry. The geometry must already have
// been passed through `applyFaceTexturesToGeometry` so UVs and contiguous face
// ranges exist for textured faces. `sampleForFace` returns the luminance
// sampler for a face, or null when that face should be left flat.
export function applyReliefToGeometry(
  geometry: THREE.BufferGeometry,
  shape: WorkplaneShape,
  options: ReliefOptions,
  sampleForFace: (face: ShapeFace) => ReliefSample | null,
) {
  const original = geometry;
  const prepared = original.index ? original.toNonIndexed() : original;
  applyFaceTexturesToGeometry(prepared, shape);
  const faces = (prepared.userData.shapeFaces ?? []) as ShapeFace[];
  const detail = Math.max(1, Math.round(options.detail));
  const depthMm = Math.max(0, options.depthMm);

  const hasUv = Boolean(prepared.getAttribute("uv"));
  const outPositions: number[] = [];
  const outUvs: number[] = [];
  const outIndex: number[] = [];
  const relief: Map<number, number> = new Map();
  let anyRelief = false;

  faces.forEach((face) => {
    const sample = sampleForFace(face);
    if (!sample || depthMm <= 0) {
      const position = prepared.getAttribute("position");
      const uv = prepared.getAttribute("uv");
      const baseVertex = outPositions.length / 3;
      for (let triangle = 0; triangle < face.triangleCount; triangle += 1) {
        const base = (face.triangleStart + triangle) * 3;
        for (let corner = 0; corner < 3; corner += 1) {
          const index = base + corner;
          outPositions.push(position.getX(index), position.getY(index), position.getZ(index));
          if (uv) outUvs.push(uv.getX(index), uv.getY(index));
        }
        outIndex.push(baseVertex + triangle * 3, baseVertex + triangle * 3 + 1, baseVertex + triangle * 3 + 2);
      }
      return;
    }
    anyRelief = true;
    const repeat = faceTextureRepeat(shape, prepared, face);
    const subPositions: number[] = [];
    const subUvs: number[] = [];
    subdivideFaceRange(prepared, face, detail, subPositions, subUvs);
    const map = new Map<string, number>();
    for (let vertex = 0; vertex < subPositions.length / 3; vertex += 1) {
      const x = subPositions[vertex * 3];
      const y = subPositions[vertex * 3 + 1];
      const z = subPositions[vertex * 3 + 2];
      const u = hasUv ? subUvs[vertex * 2] : 0;
      const v = hasUv ? subUvs[vertex * 2 + 1] : 0;
      const key = `${Math.round(x * 1e6)}|${Math.round(y * 1e6)}|${Math.round(z * 1e6)}|${Math.round(u * 1e6)}|${Math.round(v * 1e6)}`;
      let welded = map.get(key);
      if (welded === undefined) {
        welded = outPositions.length / 3;
        map.set(key, welded);
        outPositions.push(x, y, z);
        if (hasUv) outUvs.push(u, v);
      }
      outIndex.push(welded);
    }
    for (let vertex = 0; vertex < subPositions.length / 3; vertex += 1) {
      const x = subPositions[vertex * 3];
      const y = subPositions[vertex * 3 + 1];
      const z = subPositions[vertex * 3 + 2];
      const u = hasUv ? subUvs[vertex * 2] : 0;
      const v = hasUv ? subUvs[vertex * 2 + 1] : 0;
      const key = `${Math.round(x * 1e6)}|${Math.round(y * 1e6)}|${Math.round(z * 1e6)}|${Math.round(u * 1e6)}|${Math.round(v * 1e6)}`;
      const welded = map.get(key);
      if (welded === undefined) continue;
      const luminance = sample(frac(u * repeat.x), frac(v * repeat.y));
      relief.set(welded, depthMm * (luminance - 0.5));
    }
  });

  if (!anyRelief) {
    if (prepared !== original) original.dispose();
    return prepared;
  }

  const rebuilt = new THREE.BufferGeometry();
  rebuilt.setAttribute("position", new THREE.Float32BufferAttribute(outPositions, 3));
  if (hasUv) rebuilt.setAttribute("uv", new THREE.Float32BufferAttribute(outUvs, 2));
  rebuilt.setIndex(outIndex);
  rebuilt.computeVertexNormals();

  const position = rebuilt.getAttribute("position");
  const normal = rebuilt.getAttribute("normal");
  relief.forEach((offset, vertex) => {
    position.setXYZ(
      vertex,
      position.getX(vertex) + normal.getX(vertex) * offset,
      position.getY(vertex) + normal.getY(vertex) * offset,
      position.getZ(vertex) + normal.getZ(vertex) * offset,
    );
  });
  position.needsUpdate = true;

  if (prepared !== original) original.dispose();
  return rebuilt;
}

// Decodes a data URL into a luminance sampler. The image is sampled with
// nearest-neighbor lookup and the texture is treated as wrapping.
export async function reliefSampleFromImage(dataUrl: string): Promise<ReliefSample> {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) return () => 0.5;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return () => 0.5;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, width, height);
  return (u: number, v: number) => {
    const x = Math.min(width - 1, Math.max(0, Math.floor(frac(u) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(frac(v) * height)));
    const index = (y * width + x) * 4;
    return (0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]) / 255;
  };
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode relief texture image"));
    image.src = dataUrl;
  });
}
