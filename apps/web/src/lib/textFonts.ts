import { FontLoader, type Font } from "three/examples/jsm/loaders/FontLoader.js";
import { BUILTIN_FONT_NAMES, BUILTIN_TEXT_FONTS } from "@/lib/builtinFonts";
import type { WorkplaneShape } from "@/types/sketchforge";

export function isBuiltinFontName(name: string | null | undefined): name is string {
  return typeof name === "string" && (BUILTIN_FONT_NAMES as readonly string[]).includes(name);
}

const customFontRegistry = new Map<string, Font>();
let customFontsVersion = 0;

export function getCustomFontsVersion() {
  return customFontsVersion;
}

export function registerCustomFont(assetId: string, font: Font) {
  customFontRegistry.set(assetId, font);
  customFontsVersion += 1;
}

export function unregisterCustomFont(assetId: string) {
  if (customFontRegistry.delete(assetId)) {
    customFontsVersion += 1;
  }
}

export function customFontAssetIds() {
  return [...customFontRegistry.keys()];
}

export function fallbackTextFont() {
  return BUILTIN_TEXT_FONTS.Multilanguage;
}

export function resolveTextFont(shape: WorkplaneShape): Font {
  const fontName = shape.font ?? "Multilanguage";
  if (isBuiltinFontName(fontName)) {
    return BUILTIN_TEXT_FONTS[fontName] ?? fallbackTextFont();
  }
  return customFontRegistry.get(fontName) ?? fallbackTextFont();
}

const typefaceFontLoader = new FontLoader();

export function parseTypefaceFont(bytes: Uint8Array): Font {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Stored font data is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Stored font data is not a valid typeface font");
  }
  const data = raw as Record<string, unknown>;
  if (typeof data.familyName !== "string" || !data.familyName.trim()) {
    throw new Error("Stored font is missing its family name");
  }
  if (!data.glyphs || typeof data.glyphs !== "object" || Array.isArray(data.glyphs)) {
    throw new Error("Stored font is missing its glyph outlines");
  }
  const resolution = data.resolution;
  if (typeof resolution !== "number" || !Number.isFinite(resolution) || resolution <= 0) {
    throw new Error("Stored font has an invalid resolution");
  }
  if (typeof data.ascender !== "number" || typeof data.descender !== "number" || !Number.isFinite(data.ascender) || !Number.isFinite(data.descender)) {
    throw new Error("Stored font has invalid vertical metrics");
  }
  const boundingBox = data.boundingBox as Record<string, unknown> | undefined;
  if (!boundingBox || typeof boundingBox !== "object" || typeof boundingBox.yMin !== "number" || typeof boundingBox.yMax !== "number") {
    throw new Error("Stored font is missing its bounding box");
  }
  return typefaceFontLoader.parse(raw as Parameters<typeof typefaceFontLoader.parse>[0]);
}

const MAX_FONT_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_TYPEFACE_JSON_BYTES = 6 * 1024 * 1024;
const TYPEFACE_SCALE_NUMERATOR = 100000;
const TYPEFACE_SCALE_DIVISOR = 72;
const TYPEFACE_RESOLUTION = 1000;

type TypefaceGlyph = {
  x_min: number;
  x_max: number;
  ha: number;
  o?: string;
};

function glyphToTypefaceGlyph(glyph: { advanceWidth?: number; bbox?: { minX?: number; maxX?: number }; path?: { commands: Array<{ command?: string; type?: string; args?: number[] }> } }, round: (value: number) => number): TypefaceGlyph {
  const commands = glyph.path?.commands ?? [];
  const parts: string[] = [];
  let contourStartX = 0;
  let contourStartY = 0;
  for (const command of commands) {
    const args = command.args ?? [];
    const name = command.command ?? command.type ?? "";
    if (name === "moveTo") {
      contourStartX = args[0] ?? 0;
      contourStartY = args[1] ?? 0;
      parts.push(`m ${round(args[0] ?? 0)} ${round(args[1] ?? 0)}`);
    } else if (name === "lineTo") {
      parts.push(`l ${round(args[0] ?? 0)} ${round(args[1] ?? 0)}`);
    } else if (name === "quadraticCurveTo") {
      parts.push(`q ${round(args[2] ?? 0)} ${round(args[3] ?? 0)} ${round(args[0] ?? 0)} ${round(args[1] ?? 0)}`);
    } else if (name === "bezierCurveTo") {
      parts.push(`b ${round(args[4] ?? 0)} ${round(args[5] ?? 0)} ${round(args[0] ?? 0)} ${round(args[1] ?? 0)} ${round(args[2] ?? 0)} ${round(args[3] ?? 0)}`);
    } else if (name === "closePath") {
      parts.push(`l ${round(contourStartX)} ${round(contourStartY)}`);
    }
  }
  const token: TypefaceGlyph = {
    x_min: round(glyph.bbox?.minX ?? 0),
    x_max: round(glyph.bbox?.maxX ?? 0),
    ha: round(glyph.advanceWidth ?? 0),
  };
  const outline = parts.join(" ");
  if (outline) token.o = outline;
  return token;
}

export async function convertFontFileToTypeface(bytes: Uint8Array, fileName: string): Promise<{ familyName: string; json: string }> {
  if (bytes.byteLength > MAX_FONT_INPUT_BYTES) {
    throw new Error(`"${fileName}" is too large to use as a model font (max ${MAX_FONT_INPUT_BYTES / 1024 / 1024} MB)`);
  }

  const { create } = await import("fontkit");
  let font;
  try {
    font = create(bytes);
  } catch {
    throw new Error(`"${fileName}" is not a supported font file (expected TTF, OTF, WOFF, or WOFF2)`);
  }
  if (!font || typeof font.glyphForCodePoint !== "function") {
    throw new Error(`"${fileName}" is not a supported font file (expected TTF, OTF, WOFF, or WOFF2)`);
  }

  const unitsPerEm = Number(font.unitsPerEm) || 2048;
  const scale = TYPEFACE_SCALE_NUMERATOR / (unitsPerEm * TYPEFACE_SCALE_DIVISOR);
  const round = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * scale);

  const glyphs: Record<string, TypefaceGlyph> = {};
  const characterSet = font.characterSet;
  if (characterSet && typeof characterSet[Symbol.iterator] === "function") {
    for (const rawCodePoint of characterSet) {
      const codePoint = Number(rawCodePoint);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) continue;
      const char = String.fromCodePoint(codePoint);
      if (glyphs[char]) continue;
      try {
        const glyph = font.glyphForCodePoint(codePoint);
        if (glyph) glyphs[char] = glyphToTypefaceGlyph(glyph, round);
      } catch {
        // Skip glyphs whose outlines cannot be extracted (e.g. bitmap-only).
      }
    }
  }

  if (!glyphs["?"]) {
    let fallback: TypefaceGlyph | undefined;
    try {
      const notdef = font.getGlyph(0);
      if (notdef) fallback = glyphToTypefaceGlyph(notdef, round);
    } catch {
      fallback = undefined;
    }
    glyphs["?"] = fallback ?? { x_min: 0, x_max: 0, ha: round(500), o: "" };
  }
  if (!glyphs[" "]) {
    glyphs[" "] = { x_min: 0, x_max: 0, ha: round(unitsPerEm * 0.28) };
  }

  const glyphCount = Object.keys(glyphs).length;
  if (glyphCount === 0) {
    throw new Error(`"${fileName}" has no usable glyph outlines`);
  }

  const familyName = String(font.familyName ?? font.fullName ?? "").trim() || fileName.replace(/\.[^.]*$/, "");
  const ascender = Number.isFinite(font.ascent) ? font.ascent : unitsPerEm * 0.8;
  const descender = Number.isFinite(font.descent) ? font.descent : -unitsPerEm * 0.2;
  const bbox = font.bbox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  const typeface = {
    generator: "sketchforge-fontkit",
    familyName,
    ascender: round(ascender),
    descender: round(descender),
    underlineThickness: round(Number.isFinite(font.underlineThickness) ? font.underlineThickness : 50),
    underlinePosition: round(Number.isFinite(font.underlinePosition) ? font.underlinePosition : -100),
    boundingBox: {
      xMin: round(bbox.minX ?? 0),
      yMin: round(bbox.minY ?? 0),
      xMax: round(bbox.maxX ?? 0),
      yMax: round(bbox.maxY ?? 0),
    },
    resolution: TYPEFACE_RESOLUTION,
    glyphs,
  };

  const json = JSON.stringify(typeface);
  if (json.length > MAX_TYPEFACE_JSON_BYTES) {
    throw new Error(`"${fileName}" expands to ${(json.length / 1024 / 1024).toFixed(1)} MB of geometry data, which exceeds the ${MAX_TYPEFACE_JSON_BYTES / 1024 / 1024} MB limit for model fonts`);
  }
  return { familyName, json };
}
