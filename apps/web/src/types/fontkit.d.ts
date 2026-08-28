declare module "fontkit" {
  interface FontkitBoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  interface FontkitPathCommand {
    command: string;
    args: number[];
  }

  interface FontkitGlyphPath {
    commands: FontkitPathCommand[];
  }

  interface FontkitGlyph {
    id: number;
    name: string;
    advanceWidth: number;
    bbox: FontkitBoundingBox;
    path: FontkitGlyphPath;
  }

  interface FontkitFont {
    familyName: string;
    fullName: string;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    underlinePosition: number;
    underlineThickness: number;
    bbox: FontkitBoundingBox;
    numGlyphs: number;
    characterSet: Iterable<number>;
    glyphForCodePoint(codePoint: number): FontkitGlyph | undefined;
    hasGlyphForCodePoint(codePoint: number): boolean;
    getGlyph(id: number, codePoints?: number[]): FontkitGlyph;
  }

  export function create(data: ArrayBuffer | Uint8Array): FontkitFont;
}
