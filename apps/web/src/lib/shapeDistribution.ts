import { createLocalId } from "@/lib/localIds";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export type DistributionLayout = "horizontal" | "vertical" | "grid";

export type DistributionOptions = {
  layout: DistributionLayout;
  count: number;
  columns: number;
  rows: number;
  spacingX: number;
  spacingZ: number;
};

export type DistributionBounds = {
  width: number;
  depth: number;
};

function clampPositive(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function distributionTileBounds(shapes: WorkplaneShape[]): DistributionBounds {
  if (shapes.length === 0) {
    return { width: 0, depth: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const shape of shapes) {
    const halfWidth = shapeWidth(shape) / 2;
    const halfDepth = shapeDepth(shape) / 2;
    minX = Math.min(minX, shape.x - halfWidth);
    maxX = Math.max(maxX, shape.x + halfWidth);
    minZ = Math.min(minZ, shape.z - halfDepth);
    maxZ = Math.max(maxZ, shape.z + halfDepth);
  }
  return { width: maxX - minX, depth: maxZ - minZ };
}

export function distributionPitch(options: DistributionOptions, tileWidth: number, tileDepth: number) {
  return {
    x: tileWidth + clampPositive(options.spacingX),
    z: tileDepth + clampPositive(options.spacingZ),
  };
}

export function distributionUnitCount(options: DistributionOptions) {
  if (options.layout === "grid") {
    return clampPositive(Math.floor(options.columns)) * clampPositive(Math.floor(options.rows));
  }
  return clampPositive(Math.floor(options.count));
}

export function isValidDistributionOptions(options: DistributionOptions, tileWidth: number, tileDepth: number) {
  const pitch = distributionPitch(options, tileWidth, tileDepth);
  const hasWidth = pitch.x > 0;
  const hasDepth = pitch.z > 0;
  const hasSpan = options.layout === "horizontal" ? hasWidth : options.layout === "vertical" ? hasDepth : hasWidth && hasDepth;
  return hasSpan && distributionUnitCount(options) >= 2;
}

function cloneShapeAsCopy(shape: WorkplaneShape, offsetX: number, offsetZ: number): WorkplaneShape {
  return {
    ...shape,
    id: createLocalId(`${shape.id}-copy`),
    x: Number((shape.x + offsetX).toFixed(4)),
    z: Number((shape.z + offsetZ).toFixed(4)),
    locked: false,
    hidden: false,
  };
}

export function distributionCloneShapes(sourceShapes: WorkplaneShape[], options: DistributionOptions): WorkplaneShape[] {
  if (sourceShapes.length === 0) {
    return [];
  }
  const bounds = distributionTileBounds(sourceShapes);
  const pitch = distributionPitch(options, bounds.width, bounds.depth);
  const clones: WorkplaneShape[] = [];

  if (options.layout === "grid") {
    const columns = Math.max(1, Math.floor(options.columns));
    const rows = Math.max(1, Math.floor(options.rows));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (row === 0 && column === 0) {
          continue;
        }
        const offsetX = column * pitch.x;
        const offsetZ = row * pitch.z;
        for (const shape of sourceShapes) {
          clones.push(cloneShapeAsCopy(shape, offsetX, offsetZ));
        }
      }
    }
    return clones;
  }

  const count = Math.max(1, Math.floor(options.count));
  const alongX = options.layout === "horizontal";
  for (let index = 1; index < count; index += 1) {
    const offset = alongX ? index * pitch.x : index * pitch.z;
    for (const shape of sourceShapes) {
      const offsetX = alongX ? offset : 0;
      const offsetZ = alongX ? 0 : offset;
      clones.push(cloneShapeAsCopy(shape, offsetX, offsetZ));
    }
  }
  return clones;
}
