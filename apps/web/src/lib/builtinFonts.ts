import { FontLoader, type Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import droidMonoFontJson from "three/examples/fonts/droid/droid_sans_mono_regular.typeface.json";
import droidSansBoldFontJson from "three/examples/fonts/droid/droid_sans_bold.typeface.json";
import droidSerifBoldFontJson from "three/examples/fonts/droid/droid_serif_bold.typeface.json";
import gentilisBoldFontJson from "three/examples/fonts/gentilis_bold.typeface.json";
import helvetikerBoldFontJson from "three/examples/fonts/helvetiker_bold.typeface.json";
import optimerBoldFontJson from "three/examples/fonts/optimer_bold.typeface.json";

export const BUILTIN_FONT_NAMES = [
  "Multilanguage",
  "Sans",
  "Serif",
  "Script",
  "Monospace",
  "Rounded",
  "Stencil",
] as const;

const builtinFontLoader = new FontLoader();

export const BUILTIN_TEXT_FONTS: Record<string, Font> = {
  Multilanguage: builtinFontLoader.parse(helvetikerBoldFontJson as FontData),
  Sans: builtinFontLoader.parse(droidSansBoldFontJson as FontData),
  Serif: builtinFontLoader.parse(droidSerifBoldFontJson as FontData),
  Script: builtinFontLoader.parse(gentilisBoldFontJson as FontData),
  Monospace: builtinFontLoader.parse(droidMonoFontJson as FontData),
  Rounded: builtinFontLoader.parse(optimerBoldFontJson as FontData),
  Stencil: builtinFontLoader.parse(helvetikerBoldFontJson as FontData),
};
