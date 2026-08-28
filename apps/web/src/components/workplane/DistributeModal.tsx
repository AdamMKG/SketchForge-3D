"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CopyPlus, Grid3X3, MoveHorizontal, MoveVertical, X } from "lucide-react";
import {
  displayToMillimeters,
  formatMeasurementNumber,
  millimetersToDisplay,
  parseMeasurementInput,
} from "@/lib/measurementUnits";
import {
  distributionTileBounds,
  distributionUnitCount,
  isValidDistributionOptions,
  type DistributionLayout,
  type DistributionOptions,
} from "@/lib/shapeDistribution";
import type { WorkplaneShape, WorkplaneWorkspaceSettings } from "@/types/sketchforge";

const MAX_DISTRIBUTION_ITEMS = 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseIntValue(value: string, fallback: number) {
  const parsed = Math.floor(parseMeasurementInput(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

const LAYOUT_OPTIONS: { value: DistributionLayout; label: string; icon: typeof MoveHorizontal }[] = [
  { value: "horizontal", label: "Horizontal", icon: MoveHorizontal },
  { value: "vertical", label: "Vertical", icon: MoveVertical },
  { value: "grid", label: "Grid", icon: Grid3X3 },
];

function DistributionField({
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

export function DistributeModal({
  sourceShapes,
  workspace,
  onPreviewChange,
  onApply,
  onCancel,
}: {
  sourceShapes: WorkplaneShape[];
  workspace: WorkplaneWorkspaceSettings;
  onPreviewChange: (options: DistributionOptions | null) => void;
  onApply: (options: DistributionOptions) => void;
  onCancel: () => void;
}) {
  const [layout, setLayout] = useState<DistributionLayout>("horizontal");
  const [count, setCount] = useState("5");
  const [columns, setColumns] = useState("3");
  const [rows, setRows] = useState("3");
  const [spacing, setSpacing] = useState(() => millimetersToDisplay(5, workspace).toFixed(workspace.accuracy));

  const tile = useMemo(() => distributionTileBounds(sourceShapes), [sourceShapes]);

  const options = useMemo<DistributionOptions>(() => {
    const parsedSpacing = parseMeasurementInput(spacing);
    const spacingMm = Number.isFinite(parsedSpacing) ? clamp(displayToMillimeters(parsedSpacing, workspace), 0, 100000) : 0;
    return {
      layout,
      count: parseIntValue(count, 5),
      columns: parseIntValue(columns, 3),
      rows: parseIntValue(rows, 3),
      spacingX: spacingMm,
      spacingZ: spacingMm,
    };
  }, [columns, count, layout, rows, spacing]);

  const unitCount = useMemo(() => distributionUnitCount(options), [options]);
  const valid = useMemo(
    () => isValidDistributionOptions(options, tile.width, tile.depth) && unitCount <= MAX_DISTRIBUTION_ITEMS,
    [options, tile.depth, tile.width, unitCount],
  );

  useEffect(() => {
    onPreviewChange(valid ? options : null);
    return () => onPreviewChange(null);
  }, [onPreviewChange, options, valid]);

  const formatLength = (millimeters: number) => formatMeasurementNumber(millimetersToDisplay(millimeters, workspace), workspace.accuracy);
  const pitchX = tile.width + (options.spacingX || 0);
  const pitchZ = tile.depth + (options.spacingZ || 0);
  const copyCount = Math.max(0, unitCount - 1);
  const pitchLabel = layout === "grid" ? `${formatLength(pitchX)} × ${formatLength(pitchZ)}` : formatLength(layout === "horizontal" ? pitchX : pitchZ);

  const sourceLabel = sourceShapes.length === 1 ? sourceShapes[0].name : `${sourceShapes.length} selected objects`;

  return (
    <div className="workspace-modal" role="dialog" aria-modal="true" aria-label="Distribute copies">
      <div className="workspace-modal-card distribute-modal-card" onPointerDown={(event) => event.stopPropagation()}>
        <header className="workspace-modal-header">
          <strong>Distribute copies</strong>
          <button aria-label="Close distribute dialog" onClick={onCancel}>
            <X size={18} />
          </button>
        </header>

        <div className="workspace-modal-content distribute-modal-content">
          <div className="workspace-modal-body distribute-modal-body">
            <div className="distribute-target">
              <strong>{sourceLabel}</strong>
              <span>The selection is the first cell and stays in place. Copies extend right (+X) and toward the back (+Z).</span>
            </div>

            <div className="distribute-layout" role="group" aria-label="Distribution direction">
              {LAYOUT_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={layout === option.value ? "active" : ""}
                    aria-pressed={layout === option.value}
                    onClick={() => setLayout(option.value)}
                  >
                    <Icon size={17} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="distribute-fields">
              {layout === "grid" ? (
                <>
                  <DistributionField label="Columns" value={columns} onChange={setColumns} />
                  <DistributionField label="Rows" value={rows} onChange={setRows} />
                </>
              ) : (
                <DistributionField label="Total items" value={count} onChange={setCount} />
              )}
              <DistributionField label="Spacing between shapes" value={spacing} onChange={setSpacing} />
            </div>

            <div className="distribute-summary" aria-live="polite">
              <CopyPlus size={16} />
              <span>
                {valid
                  ? layout === "grid"
                    ? `${rows} × ${columns} grid · ${unitCount} total · ${copyCount} new copy${copyCount === 1 ? "" : "s"} · ${pitchLabel} pitch`
                    : `${unitCount} total · ${copyCount} new copy${copyCount === 1 ? "" : "s"} · ${pitchLabel} apart`
                  : unitCount > MAX_DISTRIBUTION_ITEMS
                    ? "Too many copies; reduce the count below 1000"
                    : "Adjust the count or spacing to create at least one copy"}
              </span>
            </div>
          </div>

          <div className="distribute-footer">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={!valid} onClick={() => onApply(options)}>
              <Check size={16} />
              Distribute
            </button>
          </div>
        </div>
      </div>
      <button className="workspace-modal-backdrop" aria-label="Close distribute dialog" onClick={onCancel} />
    </div>
  );
}
