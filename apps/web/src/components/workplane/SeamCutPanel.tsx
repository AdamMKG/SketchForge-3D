"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import {
  displayToMillimeters,
  formatMeasurementNumber,
  millimetersToDisplay,
  parseMeasurementInput,
} from "@/lib/measurementUnits";
import type { SeamCutOptions } from "@/lib/seamCut";
import type { WorkplaneWorkspaceSettings } from "@/types/sketchforge";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function SeamField({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: string;
  unit?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="distribute-field">
      <span>{label}</span>
      <span className="distribute-value-control">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            }
          }}
        />
        {unit ? <span className="distribute-value-unit">{unit}</span> : null}
      </span>
    </label>
  );
}

export function SeamCutPanel({
  targetName,
  pointCount,
  options,
  actualKeyCount,
  seamLength,
  workspace,
  canApply,
  conflictingNotice,
  onOptionsChange,
  onCountChange,
  onApply,
  onCancel,
}: {
  targetName: string;
  pointCount: 0 | 1 | 2;
  options: SeamCutOptions;
  actualKeyCount: number | null;
  seamLength: number | null;
  workspace: WorkplaneWorkspaceSettings;
  canApply: boolean;
  conflictingNotice: string | null;
  onOptionsChange: (options: SeamCutOptions) => void;
  onCountChange: (count: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const toDisplay = (millimeters: number) => millimetersToDisplay(millimeters, workspace).toFixed(workspace.accuracy);
  const [drafts, setDrafts] = useState({
    keyWidth: "",
    keyDepth: "",
    keyThroat: "",
    keyFlare: "",
    keyGap: "",
    clearance: "",
  });
  const draft = (key: keyof typeof drafts) => drafts[key] || toDisplay(
    key === "keyWidth" ? options.keyWidth
      : key === "keyDepth" ? options.keyDepth
        : key === "keyThroat" ? options.keyThroat
          : key === "keyFlare" ? options.keyFlare
            : key === "keyGap" ? options.keyGap
              : options.clearance,
  );

  const commitDraft = (key: keyof typeof drafts, min: number, max: number) => {
    return (value: string) => {
      setDrafts((current) => ({ ...current, [key]: value }));
      const parsed = parseMeasurementInput(value);
      if (!Number.isFinite(parsed)) {
        return;
      }
      const millimeters = displayToMillimeters(parsed, workspace);
      onOptionsChange({ ...options, [key]: clamp(millimeters, min, max) });
    };
  };

  const sealed = pointCount === 2;
  const seamSummary = useMemo(() => {
    if (seamLength === null) {
      return null;
    }
    return formatMeasurementNumber(millimetersToDisplay(seamLength, workspace), workspace.accuracy);
  }, [seamLength]);
  const keyCountSummary = actualKeyCount !== null && actualKeyCount !== options.keyCount
    ? `${options.keyCount} requested · ${actualKeyCount} fit`
    : actualKeyCount !== null
      ? String(actualKeyCount)
      : null;

  return (
    <aside className="edge-modifier-panel seam-panel" aria-label="Cut interlocking seam">
      <div className="edge-modifier-header">
        <div>
          <strong>Cut interlocking seam</strong>
          <span>Split the object in two with dovetail keys</span>
        </div>
        <button type="button" aria-label="Cancel seam cut" onClick={onCancel}>
          <X size={20} />
        </button>
      </div>

      <div className="edge-modifier-target">
        <strong>{targetName}</strong>
        <span>
          {pointCount === 0
            ? "Click two points on the object to draw the seam line"
            : pointCount === 1
              ? "First seam point picked — click a second point"
              : "Seam line locked — adjust the keys below"}
        </span>
      </div>

      {!sealed ? (
        <p className="edge-modifier-selection-help">
          Pick two points on one face of the object. The cut passes through them and straight into the object, perpendicular to that face. Switch to the 3D view to draw the seam.
        </p>
      ) : (
        <>
          <div className="distribute-fields seam-fields">
            <SeamField
              label="Number of keys"
              value={String(options.keyCount)}
              onChange={(value) => {
                const parsed = Math.floor(parseMeasurementInput(value));
                if (Number.isFinite(parsed) && parsed >= 1) onCountChange(parsed);
              }}
            />
            <SeamField label="Key width" value={draft("keyWidth")} unit="mm" onChange={commitDraft("keyWidth", 1, 200)} />
            <SeamField label="Key depth" value={draft("keyDepth")} unit="mm" onChange={commitDraft("keyDepth", 1, 200)} />
            <SeamField label="Barrel height" value={draft("keyThroat")} unit="mm" onChange={commitDraft("keyThroat", 1, 200)} />
            <SeamField label="Tip flare" value={draft("keyFlare")} unit="mm" onChange={commitDraft("keyFlare", 1, 200)} />
            <SeamField label="Spacing" value={draft("keyGap")} unit="mm" onChange={commitDraft("keyGap", 0, 500)} />
            <SeamField label="Fit clearance" value={draft("clearance")} unit="mm" onChange={commitDraft("clearance", 0, 10)} />
          </div>

          <button
            type="button"
            className="seam-flip-button"
            onClick={() => onOptionsChange({ ...options, flip: !options.flip })}
            aria-pressed={options.flip}
          >
            <ArrowLeftRight size={16} />
            {options.flip ? "Keys on the other half" : "Keys on this half"}
          </button>

          <div className="seam-summary" aria-live="polite">
            <span>
              {seamSummary ? `Seam length ${seamSummary} mm` : "Seam length unknown"}
              {keyCountSummary ? ` · ${keyCountSummary} keys` : ""}
            </span>
          </div>

          {conflictingNotice ? <p className="edge-modifier-selection-help">{conflictingNotice}</p> : null}
        </>
      )}

      <div className="edge-modifier-footer edge-modifier-quick-actions">
        {sealed ? (
          <button type="button" className="primary" disabled={!canApply} onClick={onApply}>
            Cut seam
          </button>
        ) : null}
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </aside>
  );
}