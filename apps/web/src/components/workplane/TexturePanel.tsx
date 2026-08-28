"use client";

import { type CSSProperties } from "react";
import { X } from "lucide-react";
import type { ShapeFaceTexture } from "@/types/sketchforge";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function TexturePanel({
  targetName,
  faceLabel,
  facePicked,
  texture,
  onUpload,
  onUseAsBumpChange,
  onBumpScaleChange,
  onClear,
  onCancel,
}: {
  targetName: string;
  faceLabel: string;
  facePicked: boolean;
  texture: ShapeFaceTexture | null;
  onUpload: () => void;
  onUseAsBumpChange: (useAsBump: boolean) => void;
  onBumpScaleChange: (bumpScale: number) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const bumpScale = texture?.bumpScale ?? 0.05;
  const bumpEnabled = Boolean(texture?.useAsBump);
  const sliderPosition = clamp(Math.log10(Math.max(0.001, bumpScale)) / 2, 0, 1) * 100;

  return (
    <aside className="edge-modifier-panel texture-panel" aria-label="Paint face">
      <div className="edge-modifier-header">
        <div>
          <strong>Paint face</strong>
          <span>Apply an image texture to one surface</span>
        </div>
        <button type="button" aria-label="Cancel face paint" onClick={onCancel}>
          <X size={20} />
        </button>
      </div>

      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>{facePicked ? `Face: ${faceLabel}` : "Face: not picked yet"}</span>
      </div>

      {!facePicked ? (
        <p className="edge-modifier-selection-help">
          Click a face on the object in the 3D view to choose which surface to paint.
        </p>
      ) : (
        <>
          <div className="texture-preview">
            {texture?.dataUrl ? (
              <img src={texture.dataUrl} alt="" draggable={false} />
            ) : (
              <div className="texture-preview-placeholder">No image</div>
            )}
          </div>

          <div className="edge-modifier-quick-actions">
            <button type="button" className="texture-upload-button" onClick={onUpload}>
              {texture?.dataUrl ? "Change image" : "Choose image"}
            </button>
            <button type="button" onClick={onClear}>Clear</button>
          </div>

          {texture?.dataUrl ? (
            <label className="edge-modifier-field texture-toggle">
              <input
                type="checkbox"
                checked={bumpEnabled}
                onChange={(event) => onUseAsBumpChange(event.currentTarget.checked)}
              />
              <span>Use image as bump map</span>
            </label>
          ) : null}

          {bumpEnabled && texture?.dataUrl ? (
            <label className="edge-modifier-field edge-modifier-slider range-property texture-bump-slider" style={{ "--slider-pos": `${sliderPosition}%` } as CSSProperties}>
              <span className="range-property-header">
                <span className="range-property-name">Bump scale</span>
                <span className="range-value-control">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bumpScale.toFixed(3)}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.currentTarget.value);
                      if (Number.isFinite(parsed)) onBumpScaleChange(clamp(parsed, 0.001, 10));
                    }}
                  />
                </span>
              </span>
              <div className="range-control">
                <input
                  type="range"
                  min={0.001}
                  max={10}
                  step={0.001}
                  value={bumpScale}
                  onChange={(event) => onBumpScaleChange(Number(event.currentTarget.value))}
                />
              </div>
            </label>
          ) : null}

          {texture?.dataUrl ? (
            <p className="edge-modifier-selection-help">
              {texture.useAsBump
                ? "The image is applied as a bump map (0.001–10 relative depth)."
                : "The image is applied as a surface texture. Re-edit the object's size to start over on this face."}
            </p>
          ) : (
            <p className="edge-modifier-selection-help">
              Textures persist in the project file. Geometry edits clear face textures.
            </p>
          )}
        </>
      )}

      <div className="edge-modifier-footer edge-modifier-quick-actions">
        <button type="button" onClick={onCancel}>Done</button>
      </div>
    </aside>
  );
}
