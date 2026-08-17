"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ConceptTooltip from "./concept-tooltip";
import LanguageSwitcher from "./language-switcher";

import {
  BeamValidationError,
  solveBeam,
  type BeamReactions,
  type BeamResponse,
  type BeamSupport,
} from "@/lib/beam/solver";

type PointLoadInput = { id: number; magnitude: number; position: number };
type DistributedLoadInput = {
  id: number;
  startPosition: number;
  endPosition: number;
  startIntensity: number;
  endIntensity: number;
};
type MomentInput = { id: number; magnitude: number; position: number; direction: "ccw" | "cw" };
type ExamplePreset = {
  id: string;
  title: string;
  description: string;
  length: number;
  support: BeamSupport;
  pointLoads: PointLoadInput[];
  distributedLoads: DistributedLoadInput[];
  moments: MomentInput[];
};
type UnitSystem = "kn-m" | "n-mm";
type UnitConfig = {
  name: string;
  length: string;
  force: string;
  distributed: string;
  moment: string;
  modulus: string;
  inertia: string;
  deflection: string;
  factors: { length: number; force: number; distributed: number; moment: number; modulus: number; inertia: number; deflection: number };
};

const fmt = (value: number, digits = 2) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(value);

const unitSystems: Record<UnitSystem, UnitConfig> = {
  "kn-m": {
    name: "kN · m",
    length: "m", force: "kN", distributed: "kN/m", moment: "kN·m",
    modulus: "GPa", inertia: "cm⁴", deflection: "mm",
    factors: { length: 1, force: 1_000, distributed: 1_000, moment: 1_000, modulus: 1e9, inertia: 1e-8, deflection: 1e-3 },
  },
  "n-mm": {
    name: "N · mm",
    length: "mm", force: "N", distributed: "N/mm", moment: "N·mm",
    modulus: "MPa", inertia: "mm⁴", deflection: "mm",
    factors: { length: 1e-3, force: 1, distributed: 1_000, moment: 1e-3, modulus: 1e6, inertia: 1e-12, deflection: 1e-3 },
  },
};

const examples: ExamplePreset[] = [
  { id: "center-point", title: "Carga puntual centrada", description: "Caso simétrico: las reacciones son iguales y la flecha máxima aparece en el centro.", length: 6, support: "simply-supported", pointLoads: [{ id: 11, magnitude: 10, position: 3 }], distributedLoads: [], moments: [] },
  { id: "offset-point", title: "Carga puntual descentrada", description: "Permite observar cómo la cercanía a un apoyo modifica las reacciones.", length: 6, support: "simply-supported", pointLoads: [{ id: 12, magnitude: 12, position: 2 }], distributedLoads: [], moments: [] },
  { id: "full-uniform", title: "Carga uniforme completa", description: "Caso simétrico con cortante lineal y momento parabólico.", length: 6, support: "simply-supported", pointLoads: [], distributedLoads: [{ id: 13, startPosition: 0, endPosition: 6, startIntensity: 4, endIntensity: 4 }], moments: [] },
  { id: "partial-uniform", title: "Carga uniforme parcial", description: "La resultante actúa en el centro del tramo realmente cargado.", length: 8, support: "simply-supported", pointLoads: [], distributedLoads: [{ id: 14, startPosition: 2, endPosition: 6, startIntensity: 5, endIntensity: 5 }], moments: [] },
  { id: "triangular", title: "Carga triangular", description: "Su resultante equivale al área del triángulo y actúa a un tercio del lado más intenso.", length: 6, support: "simply-supported", pointLoads: [], distributedLoads: [{ id: 15, startPosition: 0, endPosition: 6, startIntensity: 0, endIntensity: 6 }], moments: [] },
  { id: "trapezoidal", title: "Carga trapezoidal parcial", description: "Combina una carga uniforme y otra triangular sobre un tramo intermedio.", length: 8, support: "simply-supported", pointLoads: [], distributedLoads: [{ id: 16, startPosition: 1, endPosition: 7, startIntensity: 2, endIntensity: 6 }], moments: [] },
  { id: "cantilever-tip", title: "Voladizo con carga en el extremo", description: "El empotramiento aporta una fuerza y un momento de reacción.", length: 4, support: "cantilever-left", pointLoads: [{ id: 17, magnitude: 8, position: 4 }], distributedLoads: [], moments: [] },
  { id: "cantilever-uniform", title: "Voladizo con carga uniforme", description: "La magnitud del momento aumenta hacia el empotramiento.", length: 5, support: "cantilever-left", pointLoads: [], distributedLoads: [{ id: 18, startPosition: 0, endPosition: 5, startIntensity: 3, endIntensity: 3 }], moments: [] },
  { id: "applied-moment", title: "Momento puntual aplicado", description: "El momento produce un salto en el diagrama de momento flector.", length: 6, support: "simply-supported", pointLoads: [], distributedLoads: [], moments: [{ id: 19, magnitude: 12, position: 3, direction: "ccw" }] },
];

function Field({
  label,
  unit,
  value,
  min,
  step = "any",
  hint,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min?: number;
  step?: number | "any";
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint && <ConceptTooltip label={label}>{hint}</ConceptTooltip>}</span>
      <span className="input-shell">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}

function BeamSketch({
  length,
  support,
  pointLoads,
  distributedLoads,
  moments,
  reactions,
  units,
}: {
  length: number;
  support: BeamSupport;
  pointLoads: PointLoadInput[];
  distributedLoads: DistributedLoadInput[];
  moments: MomentInput[];
  reactions: BeamReactions | null;
  units: UnitConfig;
}) {
  const { t } = useTranslation();
  const localizedSupportName = support === "simply-supported" ? t("single.simple") : support === "cantilever-left" ? t("single.cantLeft") : t("single.cantRight");
  const xFor = (position: number) => 55 + 490 * Math.max(0, Math.min(1, position / length));
  const magnitudes = [
    ...pointLoads.map((load) => load.magnitude),
    ...distributedLoads.flatMap((load) => [load.startIntensity, load.endIntensity]),
  ].filter((magnitude) => Number.isFinite(magnitude) && magnitude > 0);
  const maximumMagnitude = Math.max(...magnitudes, 1);
  const arrowEnd = 90;
  const arrowLength = (magnitude: number) =>
    magnitude > 0 ? Math.max(12, 70 * magnitude / maximumMagnitude) : 0;
  const arrowStart = (magnitude: number) => arrowEnd - arrowLength(magnitude);
  const reactionForce = support === "cantilever-left"
    ? reactions?.left
    : support === "cantilever-right" ? reactions?.right : null;
  const reactionMoment = support === "cantilever-left"
    ? reactions?.leftMoment
    : reactions?.rightMoment;

  return (
    <div className="sketch-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Modelo estructural</span>
          <h2>{localizedSupportName}</h2>
        </div>
        <span className="length-pill">L = {fmt(length)} {units.length}</span>
      </div>
      <svg className="beam-sketch" viewBox="0 0 600 265" role="img" aria-label="Esquema de la viga, sus cargas y reacciones">
        {distributedLoads.map((load, loadIndex) => {
          const startX = xFor(load.startPosition);
          const endX = xFor(load.endPosition);
          const startY = arrowStart(load.startIntensity);
          const endY = arrowStart(load.endIntensity);
          return (
            <g className="udl" key={load.id}>
              <line x1={startX} y1={startY} x2={endX} y2={endY} />
              {Array.from({ length: 9 }, (_, index) => {
                const ratio = index / 8;
                const x = startX + (endX - startX) * ratio;
                const intensity = load.startIntensity + (load.endIntensity - load.startIntensity) * ratio;
                const y = arrowStart(intensity);
                if (intensity <= 0) return null;
                return <path key={index} d={`M ${x} ${y} V ${arrowEnd - 1} M ${x - 5} ${arrowEnd - 10} L ${x} ${arrowEnd} L ${x + 5} ${arrowEnd - 10}`} />;
              })}
              <text x={startX} y={Math.max(10, Math.min(startY, endY) - 7)} textAnchor="start">
                q{loadIndex + 1} = {fmt(load.startIntensity)} → {fmt(load.endIntensity)} {units.distributed}
              </text>
            </g>
          );
        })}
        {pointLoads.map((load, index) => {
          const x = xFor(load.position);
          const start = arrowStart(load.magnitude);
          return (
            <g className="point-arrow" key={load.id}>
              <path d={`M ${x} ${start} V ${arrowEnd - 1} M ${x - 7} ${arrowEnd - 12} L ${x} ${arrowEnd} L ${x + 7} ${arrowEnd - 12}`} />
              <text className="point-load-label" x={x > 490 ? x - 9 : x + 9} y={Math.max(10, start - 7)} textAnchor={x > 490 ? "end" : "start"}>
                P{index + 1} = {fmt(load.magnitude)} {units.force}
              </text>
            </g>
          );
        })}
        {moments.map((moment, index) => {
          const x = xFor(moment.position);
          return (
            <g className="applied-moment" key={moment.id}>
              <text className="moment-symbol" x={x} y="72" textAnchor="middle">{moment.direction === "ccw" ? "↺" : "↻"}</text>
              <text x={x + (x > 470 ? -24 : 24)} y="57" textAnchor={x > 470 ? "end" : "start"}>
                M{index + 1} = {fmt(moment.magnitude)} {units.moment}
              </text>
            </g>
          );
        })}

        <rect className="beam" x="55" y="92" width="490" height="12" rx="2" />
        {support === "simply-supported" && (
          <>
            <path className="support" d="M55 104 L39 132 H71 Z M545 104 L529 132 H561 Z" />
            <line className="ground" x1="30" y1="136" x2="80" y2="136" />
            <line className="ground" x1="520" y1="136" x2="570" y2="136" />
          </>
        )}
        {support === "cantilever-left" && (
          <g className="fixed-support">
            <line x1="55" y1="72" x2="55" y2="140" />
            {Array.from({ length: 7 }, (_, index) => <line key={index} x1="38" y1={78 + index * 9} x2="55" y2={70 + index * 9} />)}
          </g>
        )}
        {support === "cantilever-right" && (
          <g className="fixed-support">
            <line x1="545" y1="72" x2="545" y2="140" />
            {Array.from({ length: 7 }, (_, index) => <line key={index} x1="545" y1={70 + index * 9} x2="562" y2={78 + index * 9} />)}
          </g>
        )}

        {reactions && support === "simply-supported" && (
          <g className="reaction-arrows">
            <g><path d="M55 194 V142 M47 154 L55 140 L63 154" /><text x="55" y="216" textAnchor="middle">R<tspan baselineShift="sub">A</tspan> = {fmt(reactions.left / units.factors.force, 3)} {units.force}</text></g>
            <g><path d="M545 194 V142 M537 154 L545 140 L553 154" /><text x="545" y="216" textAnchor="middle">R<tspan baselineShift="sub">B</tspan> = {fmt(reactions.right / units.factors.force, 3)} {units.force}</text></g>
          </g>
        )}
        {reactions && support !== "simply-supported" && (
          <g className="reaction-arrows">
            <path d={`M ${support === "cantilever-left" ? 90 : 510} 194 V 148 M ${support === "cantilever-left" ? 82 : 502} 160 L ${support === "cantilever-left" ? 90 : 510} 146 L ${support === "cantilever-left" ? 98 : 518} 160`} />
            <text x={support === "cantilever-left" ? 90 : 510} y="216" textAnchor="middle">R = {fmt((reactionForce ?? 0) / units.factors.force, 3)} {units.force}</text>
            <text className="reaction-moment" x={support === "cantilever-left" ? 185 : 415} y="174" textAnchor="middle">
              {reactionMoment && reactionMoment < 0 ? "↻" : "↺"} M = {fmt(Math.abs(reactionMoment ?? 0) / units.factors.moment, 3)} {units.moment}
            </text>
          </g>
        )}
        <line className="dimension" x1="55" y1="240" x2="545" y2="240" />
        <text className="dimension-text" x="300" y="258">{fmt(length)} {units.length}</text>
      </svg>
    </div>
  );
}

function Diagram({
  title,
  symbol,
  unit,
  color,
  data,
  field,
  displayFactor,
  lengthFactor,
  cursorRatio,
  cursorPoint,
  onCursorChange,
}: {
  title: string;
  symbol: string;
  unit: string;
  color: string;
  data: BeamResponse[];
  field: "shear" | "moment" | "deflection";
  displayFactor: number;
  lengthFactor: number;
  cursorRatio: number;
  cursorPoint: BeamResponse;
  onCursorChange: (ratio: number) => void;
}) {
  const width = 720;
  const height = 230;
  const pad = { left: 58, right: 18, top: 24, bottom: 36 };
  const values = data.map((point) => point[field]);
  const maxAbs = Math.max(...values.map(Math.abs), Number.EPSILON);
  const xMax = data.at(-1)?.x ?? 1;
  const xScale = (x: number) => pad.left + x / xMax * (width - pad.left - pad.right);
  const yScale = (value: number) => height / 2 - value / maxAbs * (height / 2 - pad.top);
  const points = data.map((point) => `${xScale(point.x)},${yScale(point[field])}`).join(" ");
  const extreme = data.reduce((current, candidate) =>
    Math.abs(candidate[field]) > Math.abs(current[field]) ? candidate : current,
  );
  const cursorX = pad.left + cursorRatio * (width - pad.left - pad.right);
  const cursorY = yScale(cursorPoint[field]);
  const updateCursor = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const svgX = (clientX - bounds.left) / bounds.width * width;
    onCursorChange(Math.max(0, Math.min(1, (svgX - pad.left) / (width - pad.left - pad.right))));
  };

  return (
    <article className="diagram-card" style={{ "--diagram-color": color } as React.CSSProperties}>
      <div className="diagram-title">
        <span className="symbol">{symbol}</span>
        <div><h3>{title}</h3><p>Máx. |{symbol}| = {fmt(Math.abs(extreme[field]) * displayFactor, 3)} {unit}</p></div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="slider"
        aria-label={`${title}. Mueve el cursor para consultar valores.`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cursorRatio * 100)}
        tabIndex={0}
        onPointerMove={(event) => updateCursor(event.clientX, event.currentTarget)}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updateCursor(event.clientX, event.currentTarget); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onCursorChange(Math.max(0, Math.min(1, cursorRatio + (event.key === "ArrowRight" ? 0.01 : -0.01))));
          }
        }}
      >
        <line className="chart-grid" x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} />
        <line className="chart-grid zero" x1={pad.left} y1={height / 2} x2={width - pad.right} y2={height / 2} />
        <polygon className="chart-fill" points={`${xScale(0)},${height / 2} ${points} ${xScale(xMax)},${height / 2}`} />
        <polyline className="chart-line" points={points} />
        <circle className="chart-dot" cx={xScale(extreme.x)} cy={yScale(extreme[field])} r="4" />
        <line className="chart-cursor" x1={cursorX} y1={pad.top} x2={cursorX} y2={height - pad.bottom} />
        <circle className="cursor-dot" cx={cursorX} cy={cursorY} r="4" />
        <text className="chart-label" x={pad.left} y={height - 12}>0</text>
        <text className="chart-label" x={width - pad.right} y={height - 12} textAnchor="end">{fmt(xMax / lengthFactor)} {lengthFactor === 1 ? "m" : "mm"}</text>
        <text className="chart-label" x={pad.left - 8} y={pad.top + 4} textAnchor="end">+{fmt(maxAbs * displayFactor, 2)}</text>
        <text className="chart-label" x={pad.left - 8} y={height - pad.top + 4} textAnchor="end">−{fmt(maxAbs * displayFactor, 2)}</text>
      </svg>
    </article>
  );
}

function LoadSection({
  number,
  title,
  onAdd,
  children,
}: {
  number: string;
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="load-section">
      <div className="load-heading">
        <div><span>{number}</span><h2>{title}</h2></div>
        <button className="add-button" onClick={onAdd}>+ Añadir</button>
      </div>
      {children}
    </div>
  );
}

export default function BeamCalculator({ onSwitchMode }: { onSwitchMode?: () => void }) {
  const { t } = useTranslation();
  const [length, setLength] = useState(6);
  const [elasticModulus, setElasticModulus] = useState(200);
  const [inertia, setInertia] = useState(8_000);
  const [support, setSupport] = useState<BeamSupport>("simply-supported");
  const [pointLoads, setPointLoads] = useState<PointLoadInput[]>([{ id: 1, magnitude: 10, position: 3 }]);
  const [distributedLoads, setDistributedLoads] = useState<DistributedLoadInput[]>([
    { id: 2, startPosition: 0, endPosition: 6, startIntensity: 2, endIntensity: 2 },
  ]);
  const [moments, setMoments] = useState<MomentInput[]>([]);
  const [nextId, setNextId] = useState(3);
  const [selectedExample, setSelectedExample] = useState("custom");
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("kn-m");
  const [cursorRatio, setCursorRatio] = useState(0.5);
  const units = unitSystems[unitSystem];

  const calculation = useMemo(() => {
    try {
      const solution = solveBeam({
        length: length * units.factors.length,
        elasticModulus: elasticModulus * units.factors.modulus,
        secondMomentOfArea: inertia * units.factors.inertia,
        support,
        loads: [
          ...pointLoads.map((load) => ({ type: "point" as const, magnitude: load.magnitude * units.factors.force, position: load.position * units.factors.length })),
          ...distributedLoads.map((load) => ({
            type: "linear-distributed" as const,
            startPosition: load.startPosition * units.factors.length,
            endPosition: load.endPosition * units.factors.length,
            startIntensity: load.startIntensity * units.factors.distributed,
            endIntensity: load.endIntensity * units.factors.distributed,
          })),
          ...moments.map((moment) => ({
            type: "moment" as const,
            magnitude: moment.magnitude * units.factors.moment * (moment.direction === "ccw" ? 1 : -1),
            position: moment.position * units.factors.length,
          })),
        ],
      });
      const discontinuityPositions = [...new Set([
        ...pointLoads.map((load) => load.position * units.factors.length),
        ...moments.map((moment) => moment.position * units.factors.length),
      ])];
      const base = solution.sample(241).filter(
        (response) => !discontinuityPositions.some(
          (position) => Math.abs(response.x - position) <= Number.EPSILON * Math.max(1, length * units.factors.length),
        ),
      );
      const discontinuities = discontinuityPositions.flatMap((position) => [
        solution.evaluateAt(position, "left"),
        solution.evaluateAt(position, "right"),
      ]);
      return { solution, data: [...base, ...discontinuities].sort((a, b) => a.x - b.x), error: null };
    } catch (error) {
      return {
        solution: null,
        data: [],
        error: error instanceof BeamValidationError ? error.issues[0] : "No se pudo realizar el cálculo.",
      };
    }
  }, [length, elasticModulus, inertia, support, pointLoads, distributedLoads, moments, units]);

  const learning = useMemo(() => {
    const distributedResultants = distributedLoads.map((load, index) => {
      const span = load.endPosition - load.startPosition;
      const gradient = span > 0 ? (load.endIntensity - load.startIntensity) / span : 0;
      const force = (load.startIntensity + load.endIntensity) * span / 2;
      const firstMoment = load.startPosition * force + load.startIntensity * span ** 2 / 2 + gradient * span ** 3 / 3;
      const position = force > 0 ? firstMoment / force : (load.startPosition + load.endPosition) / 2;
      return { label: `Q${index + 1}`, force, position };
    });
    const totalForce =
      pointLoads.reduce((sum, load) => sum + load.magnitude, 0) +
      distributedResultants.reduce((sum, load) => sum + load.force, 0);
    const forceMomentAboutLeft =
      pointLoads.reduce((sum, load) => sum + load.magnitude * load.position, 0) +
      distributedResultants.reduce((sum, load) => sum + load.force * load.position, 0);
    const appliedMoment = moments.reduce(
      (sum, moment) => sum + moment.magnitude * (moment.direction === "ccw" ? 1 : -1),
      0,
    );
    const forceMomentAboutRight = totalForce * length - forceMomentAboutLeft;
    const momentEquation = support === "simply-supported"
      ? `ΣM_A = R_B·${fmt(length)} + (${fmt(appliedMoment)}) − ${fmt(forceMomentAboutLeft)} = 0`
      : support === "cantilever-left"
        ? `ΣM_A = M_A + (${fmt(appliedMoment)}) − ${fmt(forceMomentAboutLeft)} = 0`
        : `ΣM_B = M_B + (${fmt(appliedMoment)}) + ${fmt(forceMomentAboutRight)} = 0`;
    const forceEquation = support === "simply-supported"
      ? `ΣF_y = R_A + R_B − ${fmt(totalForce)} = 0`
      : `ΣF_y = R − ${fmt(totalForce)} = 0`;
    const boundaryConditions = support === "simply-supported"
      ? "v(0) = 0  ·  v(L) = 0"
      : support === "cantilever-left"
        ? "v(0) = 0  ·  θ(0) = 0"
        : "v(L) = 0  ·  θ(L) = 0";
    return { distributedResultants, totalForce, forceEquation, momentEquation, boundaryConditions };
  }, [length, support, pointLoads, distributedLoads, moments]);

  const updatePoint = (id: number, key: "magnitude" | "position", value: number) =>
    setPointLoads((loads) => loads.map((load) => load.id === id ? { ...load, [key]: value } : load));
  const updateDistributed = (id: number, key: keyof Omit<DistributedLoadInput, "id">, value: number) =>
    setDistributedLoads((loads) => loads.map((load) => load.id === id ? { ...load, [key]: value } : load));
  const updateMoment = <K extends keyof Omit<MomentInput, "id">>(id: number, key: K, value: MomentInput[K]) =>
    setMoments((items) => items.map((moment) => moment.id === id ? { ...moment, [key]: value } : moment));

  const changeUnitSystem = (nextSystem: UnitSystem) => {
    if (nextSystem === unitSystem) return;
    const next = unitSystems[nextSystem];
    const convert = (value: number, from: number, to: number) => value * from / to;
    setLength((value) => convert(value, units.factors.length, next.factors.length));
    setElasticModulus((value) => convert(value, units.factors.modulus, next.factors.modulus));
    setInertia((value) => convert(value, units.factors.inertia, next.factors.inertia));
    setPointLoads((loads) => loads.map((load) => ({ ...load, magnitude: convert(load.magnitude, units.factors.force, next.factors.force), position: convert(load.position, units.factors.length, next.factors.length) })));
    setDistributedLoads((loads) => loads.map((load) => ({
      ...load,
      startPosition: convert(load.startPosition, units.factors.length, next.factors.length),
      endPosition: convert(load.endPosition, units.factors.length, next.factors.length),
      startIntensity: convert(load.startIntensity, units.factors.distributed, next.factors.distributed),
      endIntensity: convert(load.endIntensity, units.factors.distributed, next.factors.distributed),
    })));
    setMoments((items) => items.map((moment) => ({ ...moment, magnitude: convert(moment.magnitude, units.factors.moment, next.factors.moment), position: convert(moment.position, units.factors.length, next.factors.length) })));
    setUnitSystem(nextSystem);
  };

  const reset = () => {
    setLength(6);
    setElasticModulus(200);
    setInertia(8_000);
    setSupport("simply-supported");
    setPointLoads([{ id: 1, magnitude: 10, position: 3 }]);
    setDistributedLoads([{ id: 2, startPosition: 0, endPosition: 6, startIntensity: 2, endIntensity: 2 }]);
    setMoments([]);
    setNextId(3);
    setSelectedExample("custom");
    setUnitSystem("kn-m");
    setCursorRatio(0.5);
  };

  const loadExample = (id: string) => {
    setSelectedExample(id);
    const example = examples.find((item) => item.id === id);
    if (!example) return;
    setSupport(example.support);
    const source = unitSystems["kn-m"];
    const convert = (value: number, from: number, to: number) => value * from / to;
    setLength(convert(example.length, source.factors.length, units.factors.length));
    setPointLoads(example.pointLoads.map((load) => ({ ...load, magnitude: convert(load.magnitude, source.factors.force, units.factors.force), position: convert(load.position, source.factors.length, units.factors.length) })));
    setDistributedLoads(example.distributedLoads.map((load) => ({
      ...load,
      startPosition: convert(load.startPosition, source.factors.length, units.factors.length),
      endPosition: convert(load.endPosition, source.factors.length, units.factors.length),
      startIntensity: convert(load.startIntensity, source.factors.distributed, units.factors.distributed),
      endIntensity: convert(load.endIntensity, source.factors.distributed, units.factors.distributed),
    })));
    setMoments(example.moments.map((moment) => ({ ...moment, magnitude: convert(moment.magnitude, source.factors.moment, units.factors.moment), position: convert(moment.position, source.factors.length, units.factors.length) })));
    setNextId(100);
  };

  const activeExample = examples.find((example) => example.id === selectedExample);

  const reactionCards = calculation.solution && support === "simply-supported"
    ? [
        ["Reacción izquierda · RA", calculation.solution.reactions.left / units.factors.force, units.force],
        ["Reacción derecha · RB", calculation.solution.reactions.right / units.factors.force, units.force],
      ]
    : calculation.solution
      ? [
          ["Reacción vertical", (support === "cantilever-left" ? calculation.solution.reactions.left : calculation.solution.reactions.right) / units.factors.force, units.force],
          ["Reacción de momento", (support === "cantilever-left" ? calculation.solution.reactions.leftMoment ?? 0 : calculation.solution.reactions.rightMoment ?? 0) / units.factors.moment, units.moment],
        ]
      : [];
  const cursorPoint = calculation.solution
    ? calculation.solution.evaluateAt(length * units.factors.length * cursorRatio)
    : null;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="BeamLab, inicio"><span className="brand-mark">M</span><span>BeamLab <small>EDU</small></span></a>
        <div className="topbar-actions">
          <LanguageSwitcher />
          {onSwitchMode && <button className="mode-button" onClick={onSwitchMode}>{t("common.continuous")}</button>}
          <span className="educational-badge">{t("common.educational")}</span>
        </div>
      </header>
      <section className="hero" id="top">
        <span className="eyebrow">{t("single.eyebrow")}</span>
        <h1>{t("single.title")}</h1>
        <p>{t("single.intro")}</p>
      </section>

      <div className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <div><span>01</span><h2>{t("single.define")}</h2></div>
            <button className="reset-button" onClick={reset}>{t("common.reset")}</button>
          </div>
          <label className="example-field">
            <span>{t("common.guided")}</span>
            <select value={selectedExample} onChange={(event) => loadExample(event.target.value)}>
              <option value="custom">{t("common.custom")}</option>
              {examples.map((example) => <option key={example.id} value={example.id}>{t(`examples.single.${example.id}.title`)}</option>)}
            </select>
            <small>{activeExample ? t(`examples.single.${activeExample.id}.description`) : t("single.modify")}</small>
          </label>
          <fieldset className="unit-switch">
            <legend>{t("common.units")}</legend>
            {(Object.keys(unitSystems) as UnitSystem[]).map((system) => (
              <button key={system} type="button" className={unitSystem === system ? "active" : ""} onClick={() => changeUnitSystem(system)}>{unitSystems[system].name}</button>
            ))}
          </fieldset>
          <label className="support-field">
            <span>{t("single.support")}</span>
            <select value={support} onChange={(event) => setSupport(event.target.value as BeamSupport)}>
              <option value="simply-supported">{t("single.simple")}</option>
              <option value="cantilever-left">{t("single.cantLeft")}</option>
              <option value="cantilever-right">{t("single.cantRight")}</option>
            </select>
          </label>
          <div className="field-grid">
            <Field label={t("single.length")} unit={units.length} value={length} min={0.1} onChange={setLength} />
            <Field label={t("single.modulus")} unit={units.modulus} value={elasticModulus} min={0.1} hint={t("tooltip.modulus")} onChange={setElasticModulus} />
            <Field label={t("single.inertia")} unit={units.inertia} value={inertia} min={0.1} hint={t("tooltip.inertia")} onChange={setInertia} />
          </div>

          <LoadSection number="02" title={t("single.points")} onAdd={() => {
            const id = nextId;
            setNextId(id + 1);
            setPointLoads((loads) => [...loads, { id, magnitude: 5, position: length / 2 }]);
          }}>
            {pointLoads.length === 0 && <p className="empty-loads">{t("single.noPoints")}</p>}
            {pointLoads.map((load, index) => (
              <div className="load-row" key={load.id}>
                <span className="load-index">P{index + 1}</span>
                <Field label={t("common.magnitude")} unit={units.force} value={load.magnitude} min={0} onChange={(value) => updatePoint(load.id, "magnitude", value)} />
                <Field label={t("common.position")} unit={units.length} value={load.position} min={0} onChange={(value) => updatePoint(load.id, "position", value)} />
                <button className="remove-button" aria-label={`Eliminar carga P${index + 1}`} onClick={() => setPointLoads((loads) => loads.filter((item) => item.id !== load.id))}>×</button>
              </div>
            ))}
          </LoadSection>

          <LoadSection number="03" title={t("single.distributed")} onAdd={() => {
            const id = nextId;
            setNextId(id + 1);
            setDistributedLoads((loads) => [...loads, { id, startPosition: 0, endPosition: length, startIntensity: 2, endIntensity: 2 }]);
          }}>
            {distributedLoads.length === 0 && <p className="empty-loads">{t("single.noDistributed")}</p>}
            {distributedLoads.map((load, index) => (
              <div className="load-editor" key={load.id}>
                <div className="editor-title"><span>q{index + 1}</span><strong>{load.startIntensity === load.endIntensity ? "Uniforme" : load.startIntensity === 0 || load.endIntensity === 0 ? "Triangular" : "Trapezoidal"}</strong><button aria-label={`Eliminar carga q${index + 1}`} onClick={() => setDistributedLoads((loads) => loads.filter((item) => item.id !== load.id))}>×</button></div>
                <div className="editor-grid">
                  <Field label={t("common.start")} unit={units.length} value={load.startPosition} min={0} onChange={(value) => updateDistributed(load.id, "startPosition", value)} />
                  <Field label={t("common.end")} unit={units.length} value={load.endPosition} min={0} onChange={(value) => updateDistributed(load.id, "endPosition", value)} />
                  <Field label={t("single.initialIntensity")} unit={units.distributed} value={load.startIntensity} min={0} onChange={(value) => updateDistributed(load.id, "startIntensity", value)} />
                  <Field label={t("single.finalIntensity")} unit={units.distributed} value={load.endIntensity} min={0} onChange={(value) => updateDistributed(load.id, "endIntensity", value)} />
                </div>
              </div>
            ))}
          </LoadSection>

          <LoadSection number="04" title={t("single.moments")} onAdd={() => {
            const id = nextId;
            setNextId(id + 1);
            setMoments((items) => [...items, { id, magnitude: 5, position: length / 2, direction: "ccw" }]);
          }}>
            {moments.length === 0 && <p className="empty-loads">{t("single.noMoments")}</p>}
            {moments.map((moment, index) => (
              <div className="load-editor moment-editor" key={moment.id}>
                <div className="editor-title">
                  <span>M{index + 1}</span>
                  <strong>{moment.direction === "ccw" ? t("single.ccw") : t("single.cw")}</strong>
                  <button aria-label={`Eliminar momento M${index + 1}`} onClick={() => setMoments((items) => items.filter((item) => item.id !== moment.id))}>×</button>
                </div>
                <div className="moment-editor-grid">
                  <Field label={t("common.magnitude")} unit={units.moment} value={moment.magnitude} min={0} onChange={(value) => updateMoment(moment.id, "magnitude", value)} />
                  <Field label={t("common.position")} unit={units.length} value={moment.position} min={0} onChange={(value) => updateMoment(moment.id, "position", value)} />
                  <label className="direction-field"><span>{t("single.direction")}</span><select value={moment.direction} onChange={(event) => updateMoment(moment.id, "direction", event.target.value as "ccw" | "cw")}><option value="ccw">{t("single.ccw")}</option><option value="cw">{t("single.cw")}</option></select></label>
                </div>
              </div>
            ))}
          </LoadSection>
          <p className="convention">{t("single.convention")}</p>
        </aside>

        <section className="results-panel">
          <BeamSketch length={Number.isFinite(length) && length > 0 ? length : 1} support={support} pointLoads={pointLoads} distributedLoads={distributedLoads} moments={moments} reactions={calculation.solution?.reactions ?? null} units={units} />
          {calculation.error ? (
            <div className="error-card"><strong>{t("single.review")}</strong><span>{calculation.error}</span></div>
          ) : calculation.solution && (
            <>
              <div className="reaction-grid">
                {reactionCards.map(([label, value, unit]) => <div key={String(label)}><span>{label}</span><strong>{fmt(Number(value), 3)} <small>{unit}</small></strong></div>)}
                <div><span>Flecha máxima · |δ|</span><strong>{fmt(Math.abs(calculation.solution.extremes.maximumAbsoluteDeflection.value) / units.factors.deflection, 3)} <small>{units.deflection}</small></strong></div>
              </div>
              <details className="learning-panel" open>
                <summary>
                  <span className="learning-number">05</span>
                  <div><strong>{t("single.development")}</strong><small>{t("single.developmentSub")}</small></div>
                  <span className="summary-action">{t("common.showHide")}</span>
                </summary>
                <div className="learning-grid">
                  <article>
                    <span className="step-number">1</span>
                    <h3>{t("single.equivalent")}</h3>
                    {learning.distributedResultants.length > 0 ? (
                      <ul>{learning.distributedResultants.map((load) => <li key={load.label}><strong>{load.label}</strong> = {fmt(load.force, 3)} {units.force} en x = {fmt(load.position, 3)} {units.length}</li>)}</ul>
                    ) : <p>No hay cargas distribuidas que reducir.</p>}
                    <p className="formula">Σ cargas verticales = {fmt(learning.totalForce, 3)} {units.force}</p>
                  </article>
                  <article>
                    <span className="step-number">2</span>
                    <h3>{t("single.equilibrium")}</h3>
                    <p className="formula">{learning.forceEquation}</p>
                    <p className="formula">{learning.momentEquation}</p>
                    <small>Los momentos antihorarios se consideran positivos.</small>
                  </article>
                  <article>
                    <span className="step-number">3</span>
                    <h3>{t("single.diagramRelation")}</h3>
                    <p className="formula">dV/dx = −q(x)</p>
                    <p className="formula">dM/dx = V(x)</p>
                    <p className="formula">EI · v″(x) = M(x)</p>
                  </article>
                  <article>
                    <span className="step-number">4</span>
                    <h3>{t("single.boundary")}</h3>
                    <p className="formula">{learning.boundaryConditions}</p>
                    <p>Estas condiciones determinan las constantes de integración de la pendiente y la deflexión.</p>
                  </article>
                </div>
                <div className="assumptions">
                  <strong>{t("single.assumptions")}</strong>
                  <span>Material lineal-elástico</span><span>E e I constantes</span><span>Pequeñas deformaciones</span><span>Teoría de Euler–Bernoulli</span>
                </div>
              </details>
              <div className="diagram-heading"><span>06</span><div><h2>{t("single.read")} <ConceptTooltip label={t("single.diagramRelation")}>{t("tooltip.diagrams")}</ConceptTooltip></h2><p>{t("single.readSub")}</p></div></div>
              {cursorPoint && (
                <div className="cursor-readout" aria-live="polite">
                  <div><span>x</span><strong>{fmt(cursorPoint.x / units.factors.length, 3)} <small>{units.length}</small></strong></div>
                  <div><span>V(x)</span><strong>{fmt(cursorPoint.shear / units.factors.force, 3)} <small>{units.force}</small></strong></div>
                  <div><span>M(x)</span><strong>{fmt(cursorPoint.moment / units.factors.moment, 3)} <small>{units.moment}</small></strong></div>
                  <div><span>θ(x)</span><strong>{fmt(cursorPoint.slope, 6)} <small>rad</small></strong></div>
                  <div><span>v(x)</span><strong>{fmt(cursorPoint.deflection / units.factors.deflection, 4)} <small>{units.deflection}</small></strong></div>
                </div>
              )}
              {cursorPoint && <div className="diagrams">
                <Diagram title={t("single.shear")} symbol="V" unit={units.force} color="#1d5d79" data={calculation.data} field="shear" displayFactor={1 / units.factors.force} lengthFactor={units.factors.length} cursorRatio={cursorRatio} cursorPoint={cursorPoint} onCursorChange={setCursorRatio} />
                <Diagram title={t("single.bending")} symbol="M" unit={units.moment} color="#c46a2b" data={calculation.data} field="moment" displayFactor={1 / units.factors.moment} lengthFactor={units.factors.length} cursorRatio={cursorRatio} cursorPoint={cursorPoint} onCursorChange={setCursorRatio} />
                <Diagram title={t("single.deflection")} symbol="δ" unit={units.deflection} color="#6657a8" data={calculation.data} field="deflection" displayFactor={1 / units.factors.deflection} lengthFactor={units.factors.length} cursorRatio={cursorRatio} cursorPoint={cursorPoint} onCursorChange={setCursorRatio} />
              </div>}
            </>
          )}
        </section>
      </div>
      <footer><span>{t("single.footer")}</span><p>{t("common.noProfessional")}</p></footer>
    </main>
  );
}
