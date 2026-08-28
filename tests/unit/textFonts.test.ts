import { describe, expect, it, vi } from "vitest";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { BUILTIN_FONT_NAMES } from "@/lib/builtinFonts";
import {
  convertFontFileToTypeface,
  customFontAssetIds,
  getCustomFontsVersion,
  isBuiltinFontName,
  parseTypefaceFont,
  registerCustomFont,
  resolveTextFont,
  unregisterCustomFont,
} from "@/lib/textFonts";
import type { WorkplaneShape } from "@/types/sketchforge";

type FontkitCommand = { command: string; args: number[] };

const { makeFakeFont, BIG_FONT_MARKER } = vi.hoisted(() => {
  type Glyph = {
    id: number;
    name: string;
    advanceWidth: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    path: { commands: FontkitCommand[] };
  };
  const fakeGlyph = (id: number, advanceWidth: number, bbox: Glyph["bbox"], commands: FontkitCommand[]): Glyph => ({
    id,
    name: "",
    advanceWidth,
    bbox,
    path: { commands },
  });
  const makeFakeFont = (characterSet: number[]) => {
    const glyphs = new Map<number, Glyph>();
    glyphs.set(65, fakeGlyph(1, 500, { minX: 0, minY: 0, maxX: 400, maxY: 700 }, [
      { command: "moveTo", args: [0, 0] },
      { command: "lineTo", args: [400, 0] },
      { command: "lineTo", args: [400, 700] },
      { command: "quadraticCurveTo", args: [200, 900, 0, 700] },
      { command: "bezierCurveTo", args: [100, 300, 300, 300, 0, 0] },
      { command: "closePath", args: [] },
    ]));
    glyphs.set(66, fakeGlyph(2, 300, { minX: 10, minY: 20, maxX: 200, maxY: 600 }, [
      { command: "moveTo", args: [10, 20] },
      { command: "lineTo", args: [200, 600] },
    ]));
    glyphs.set(32, fakeGlyph(3, 200, { minX: 0, minY: 0, maxX: 0, maxY: 0 }, []));
    glyphs.set(0, fakeGlyph(0, 0, { minX: 0, minY: 0, maxX: 500, maxY: 700 }, [
      { command: "moveTo", args: [0, 0] },
      { command: "lineTo", args: [500, 0] },
      { command: "lineTo", args: [500, 700] },
      { command: "lineTo", args: [0, 700] },
      { command: "closePath", args: [] },
    ]));
    return {
      unitsPerEm: 1000,
      familyName: "Test Font",
      fullName: "Test Font Bold",
      ascent: 800,
      descent: -200,
      underlineThickness: 50,
      underlinePosition: -100,
      bbox: { minX: -20, minY: -200, maxX: 450, maxY: 900 },
      characterSet: new Set(characterSet),
      glyphForCodePoint: (codePoint: number) => glyphs.get(codePoint),
      getGlyph: (id: number) => glyphs.get(id) ?? fakeGlyph(id, 0, { minX: 0, minY: 0, maxX: 0, maxY: 0 }, []),
    };
  };
  return { makeFakeFont, BIG_FONT_MARKER: 0xff };
});

vi.mock("fontkit", () => ({
  create: (bytes: Uint8Array) => {
    if (bytes[0] === BIG_FONT_MARKER) {
      const characterSet = new Set<number>();
      for (let codePoint = 0x400; codePoint < 0x400 + 200000; codePoint += 1) characterSet.add(codePoint);
      const huge = makeFakeFont([]);
      return {
        ...huge,
        characterSet,
        glyphForCodePoint: () => ({
          id: 1,
          name: "",
          advanceWidth: 500,
          bbox: { minX: 0, minY: 0, maxX: 500, maxY: 700 },
          path: { commands: [{ command: "moveTo", args: [0, 0] }, { command: "lineTo", args: [500, 700] }] },
        }),
      };
    }
    return makeFakeFont([32, 65, 66]);
  },
}));

function textShape(overrides: Partial<WorkplaneShape> = {}): WorkplaneShape {
  return {
    id: "text-1",
    name: "Text",
    kind: "text",
    color: "#12a4cc",
    x: 0,
    z: 0,
    size: 86,
    width: 86,
    depth: 28,
    height: 10,
    rotation: 0,
    text: "HI",
    ...overrides,
  };
}

describe("custom model fonts", () => {
  it("recognizes built-in font names and treats asset ids as custom", () => {
    expect(BUILTIN_FONT_NAMES).toContain("Multilanguage");
    expect(isBuiltinFontName("Sans")).toBe(true);
    expect(isBuiltinFontName("asset-1234")).toBe(false);
    expect(isBuiltinFontName(null)).toBe(false);
    expect(isBuiltinFontName(undefined)).toBe(false);
    expect(isBuiltinFontName("")).toBe(false);
  });

  it("resolves built-in fonts by name and falls back to the default for missing custom fonts", () => {
    const builtin = resolveTextFont(textShape({ font: "Serif" }));
    expect(builtin.data.familyName).toBeDefined();
    const fallback = resolveTextFont(textShape({ font: "asset-missing" }));
    const defaultFont = resolveTextFont(textShape({ font: "Multilanguage" }));
    expect(fallback).toBe(defaultFont);
    expect(resolveTextFont(textShape({ font: null as unknown as string }))).toBe(defaultFont);
    expect(resolveTextFont(textShape({ font: undefined as unknown as string }))).toBe(defaultFont);
  });

  it("resolves registered custom fonts by asset id", () => {
    const font = parseTypefaceFont(new TextEncoder().encode(JSON.stringify({
      familyName: "Registered",
      resolution: 1000,
      ascender: 800,
      descender: -200,
      underlineThickness: 50,
      underlinePosition: -100,
      boundingBox: { xMin: 0, yMin: 0, xMax: 500, yMax: 700 },
      glyphs: {
        "?": { x_min: 0, x_max: 500, ha: 500, o: "m 0 0 l 500 700" },
        "A": { x_min: 0, x_max: 500, ha: 500, o: "m 0 0 l 500 700" },
        " ": { x_min: 0, x_max: 0, ha: 250 },
      },
    })));
    registerCustomFont("asset-abc", font);
    try {
      expect(customFontAssetIds()).toContain("asset-abc");
      expect(resolveTextFont(textShape({ font: "asset-abc" }))).toBe(font);
    } finally {
      unregisterCustomFont("asset-abc");
    }
    expect(customFontAssetIds()).not.toContain("asset-abc");
    expect(resolveTextFont(textShape({ font: "asset-abc" }))).toBe(resolveTextFont(textShape({ font: "Multilanguage" })));
  });

  it("tracks a version counter while custom fonts register and unregister", () => {
    const start = getCustomFontsVersion();
    const font = parseTypefaceFont(new TextEncoder().encode(JSON.stringify({
      familyName: "Versioned",
      resolution: 1000,
      ascender: 800,
      descender: -200,
      underlineThickness: 50,
      underlinePosition: -100,
      boundingBox: { xMin: 0, yMin: 0, xMax: 500, yMax: 700 },
      glyphs: { "A": { x_min: 0, x_max: 500, ha: 500, o: "m 0 0 l 500 700" } },
    })));
    registerCustomFont("asset-versioned", font);
    expect(getCustomFontsVersion()).toBe(start + 1);
    unregisterCustomFont("asset-versioned");
    expect(getCustomFontsVersion()).toBe(start + 2);
  });
});

describe("parseTypefaceFont validation", () => {
  const utf8 = new TextEncoder();
  const valid = {
    familyName: "Valid",
    resolution: 1000,
    ascender: 800,
    descender: -200,
    underlineThickness: 50,
    underlinePosition: -100,
    boundingBox: { xMin: 0, yMin: 0, xMax: 500, yMax: 700 },
    glyphs: { "A": { x_min: 0, x_max: 500, ha: 500, o: "m 0 0 l 500 700" } },
  };

  it("parses a valid typeface document", () => {
    const font = parseTypefaceFont(utf8.encode(JSON.stringify(valid)));
    expect(font.data.familyName).toBe("Valid");
    expect(font.data.glyphs.A).toBeDefined();
  });

  it("rejects invalid stored font data", () => {
    expect(() => parseTypefaceFont(utf8.encode("not json"))).toThrow("not valid JSON");
    expect(() => parseTypefaceFont(utf8.encode(JSON.stringify({ ...valid, familyName: "" })))).toThrow("family name");
    expect(() => parseTypefaceFont(utf8.encode(JSON.stringify({ ...valid, resolution: 0 })))).toThrow("resolution");
    expect(() => parseTypefaceFont(utf8.encode(JSON.stringify({ ...valid, ascender: "x" })))).toThrow("vertical metrics");
    expect(() => parseTypefaceFont(utf8.encode(JSON.stringify({ ...valid, boundingBox: undefined })))).toThrow("bounding box");
    expect(() => parseTypefaceFont(utf8.encode(JSON.stringify({ ...valid, glyphs: null })))).toThrow("glyph outlines");
  });
});

describe("font file conversion", () => {
  it("converts a TTF into a Three.js typeface document with scaled path data", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const { familyName, json } = await convertFontFileToTypeface(bytes, "sample.ttf");
    expect(familyName).toBe("Test Font");

    const typeface = JSON.parse(json) as Record<string, unknown>;
    expect(typeface.resolution).toBe(1000);
    expect(typeface.generator).toBe("sketchforge-fontkit");
    expect(typeface.familyName).toBe("Test Font");
    expect(typeface.ascender).toBe(1111);
    expect(typeface.descender).toBe(-278);
    expect(typeface.boundingBox).toEqual({ xMin: -28, yMin: -278, xMax: 625, yMax: 1250 });

    const glyphs = typeface.glyphs as Record<string, { x_min: number; x_max: number; ha: number; o?: string }>;
    expect(Object.keys(glyphs).sort()).toEqual([" ", "?", "A", "B"]);

    expect(glyphs[" "]).toEqual({ x_min: 0, x_max: 0, ha: 278 });
    expect(glyphs["?"]).toEqual({
      x_min: 0,
      x_max: 694,
      ha: 0,
      o: "m 0 0 l 694 0 l 694 972 l 0 972 l 0 0",
    });
    expect(glyphs["A"]).toEqual({
      x_min: 0,
      x_max: 556,
      ha: 694,
      o: "m 0 0 l 556 0 l 556 972 q 0 972 278 1250 b 0 0 139 417 417 417 l 0 0",
    });
    expect(glyphs["B"]).toEqual({ x_min: 14, x_max: 278, ha: 417, o: "m 14 28 l 278 833" });
  });

  it("produces typeface JSON that renders real text geometry", async () => {
    const { json } = await convertFontFileToTypeface(new Uint8Array([9, 9, 9]), "geometry.ttf");
    const font = parseTypefaceFont(new TextEncoder().encode(json));
    const geometry = new TextGeometry("AB", { font, size: 20, depth: 5, curveSegments: 8 });
    geometry.computeBoundingBox();
    expect(geometry.boundingBox).toBeDefined();
    expect((geometry.boundingBox?.max.x ?? 0) - (geometry.boundingBox?.min.x ?? 0)).toBeGreaterThan(0);
    expect((geometry.boundingBox?.max.y ?? 0) - (geometry.boundingBox?.min.y ?? 0)).toBeGreaterThan(0);
  });

  it("uses the glyphs[?] fallback for characters missing from the font", async () => {
    const { json } = await convertFontFileToTypeface(new Uint8Array([7, 7, 7]), "missing.ttf");
    const font = parseTypefaceFont(new TextEncoder().encode(json));
    const geometry = new TextGeometry("§", { font, size: 20, depth: 5, curveSegments: 8 });
    geometry.computeBoundingBox();
    expect((geometry.boundingBox?.max.x ?? 0) - (geometry.boundingBox?.min.x ?? 0)).toBeGreaterThan(0);
  });

  it("rejects input fonts over the size limit before parsing", async () => {
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
    await expect(convertFontFileToTypeface(oversized, "huge.ttf")).rejects.toThrow("too large");
  });

  it("rejects conversion output over the typeface size limit", async () => {
    const marker = new Uint8Array([BIG_FONT_MARKER]);
    await expect(convertFontFileToTypeface(marker, "many-glyphs.ttf")).rejects.toThrow("exceeds the 6 MB limit");
  });
});
