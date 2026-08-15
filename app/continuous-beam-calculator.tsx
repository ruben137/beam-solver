"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ConceptTooltip from "./concept-tooltip";
import LanguageSwitcher from "./language-switcher";
import {
  ContinuousBeamValidationError,
  solveContinuousBeam,
  type ContinuousBeamLoad,
  type ContinuousBeamResponse,
  type ContinuousBeamSolution,
  type ContinuousNodeSupport,
} from "@/lib/continuous-beam/solver";

type UiLoad = (ContinuousBeamLoad & { id: number; direction?: "ccw" | "cw" });
type FieldName = "shear" | "moment" | "deflection";
type ContinuousPreset = { id: string; title: string; description: string; spans: number[]; supports: ContinuousNodeSupport[]; loads: UiLoad[] };

const fmt = (value: number, digits = 2) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(value);

const continuousPresets: ContinuousPreset[] = [
  { id: "two-equal", title: "Dos vanos iguales · carga uniforme", description: "Caso clásico simétrico: aparece un momento negativo sobre el apoyo interior.", spans: [5, 5], supports: ["simple", "simple", "simple"], loads: [{ id: 101, type: "linear-distributed", spanIndex: 0, startPosition: 0, endPosition: 5, startIntensity: 4000, endIntensity: 4000 }, { id: 102, type: "linear-distributed", spanIndex: 1, startPosition: 0, endPosition: 5, startIntensity: 4000, endIntensity: 4000 }] },
  { id: "unequal", title: "Dos vanos desiguales", description: "Permite observar cómo la rigidez relativa de cada vano redistribuye las reacciones.", spans: [4, 7], supports: ["simple", "simple", "simple"], loads: [{ id: 103, type: "linear-distributed", spanIndex: 0, startPosition: 0, endPosition: 4, startIntensity: 6000, endIntensity: 6000 }, { id: 104, type: "point", spanIndex: 1, magnitude: 18000, position: 4.5 }] },
  { id: "three-spans", title: "Tres vanos · cargas alternadas", description: "Ejemplo asimétrico para estudiar continuidad y equilibrio global.", spans: [4, 5, 4], supports: ["simple", "simple", "simple", "simple"], loads: [{ id: 105, type: "linear-distributed", spanIndex: 0, startPosition: 0, endPosition: 4, startIntensity: 3000, endIntensity: 3000 }, { id: 106, type: "point", spanIndex: 1, magnitude: 15000, position: 2 }, { id: 107, type: "linear-distributed", spanIndex: 2, startPosition: 0, endPosition: 4, startIntensity: 0, endIntensity: 7000 }] },
  { id: "fixed-ends", title: "Extremos empotrados", description: "Compara la respuesta cuando los giros extremos también están restringidos.", spans: [5, 5], supports: ["fixed", "simple", "fixed"], loads: [{ id: 108, type: "linear-distributed", spanIndex: 0, startPosition: 0, endPosition: 5, startIntensity: 5000, endIntensity: 5000 }, { id: 109, type: "linear-distributed", spanIndex: 1, startPosition: 0, endPosition: 5, startIntensity: 5000, endIntensity: 5000 }] },
];

function NumberField({ label, unit, value, min, hint, onChange }: {
  label: string; unit: string; value: number; min?: number; hint?: string; onChange: (value: number) => void;
}) {
  return <label className="field"><span className="field-label">{label}{hint && <ConceptTooltip label={label}>{hint}</ConceptTooltip>}</span><span className="input-shell">
    <input type="number" value={value} min={min} step="any" onChange={(event) => onChange(event.target.valueAsNumber)} />
    <span>{unit}</span>
  </span></label>;
}

function ContinuousSketch({ spans, supports, loads, reactions }: {
  spans: number[]; supports: ContinuousNodeSupport[]; loads: UiLoad[]; reactions: number[] | null;
}) {
  const { t } = useTranslation();
  const total = spans.reduce((sum, span) => sum + (Number.isFinite(span) ? span : 0), 0) || 1;
  const nodes = [0]; spans.forEach((span) => nodes.push(nodes.at(-1)! + span));
  const xFor = (x: number) => 55 + 490 * x / total;
  const globalFor = (load: UiLoad, local: number) => nodes[load.spanIndex] + local;
  const maxLoad = Math.max(1, ...loads.flatMap((load) => load.type === "point" ? [load.magnitude] : load.type === "linear-distributed" ? [load.startIntensity, load.endIntensity] : []));
  const arrowTop = (value: number) => 92 - Math.max(14, 62 * value / maxLoad);
  return <div className="sketch-card continuous-sketch-card">
    <div className="section-heading"><div><span className="eyebrow">{t("continuous.model")}</span><h2>{t("continuous.spansCount", { count: spans.length })} · {t("continuous.nodesCount", { count: supports.length })}</h2></div><span className="length-pill">L = {fmt(total)} m</span></div>
    <svg className="beam-sketch" viewBox="0 0 600 270" role="img" aria-label="Viga continua con apoyos, cargas y reacciones">
      {loads.map((load, index) => {
        if (load.type === "point") {
          const x = xFor(globalFor(load, load.position)); const top = arrowTop(load.magnitude);
          return <g className="point-arrow" key={load.id}><path d={`M ${x} ${top} V 91 M ${x - 6} 80 L ${x} 92 L ${x + 6} 80`} /><text x={x + 8} y={top - 5}>P{index + 1} = {fmt(load.magnitude / 1000)} kN</text></g>;
        }
        if (load.type === "moment") {
          const x = xFor(globalFor(load, load.position));
          return <g className="applied-moment" key={load.id}><text className="moment-symbol" x={x} y="81" textAnchor="middle">{load.magnitude >= 0 ? "↺" : "↻"}</text></g>;
        }
        const a = xFor(globalFor(load, load.startPosition)); const b = xFor(globalFor(load, load.endPosition));
        const y1 = arrowTop(load.startIntensity); const y2 = arrowTop(load.endIntensity);
        return <g className="udl" key={load.id}><line x1={a} y1={y1} x2={b} y2={y2} />{Array.from({ length: 7 }, (_, i) => {
          const ratio = i / 6; const x = a + (b - a) * ratio; const q = load.startIntensity + (load.endIntensity - load.startIntensity) * ratio; const y = arrowTop(q);
          return q <= 0 ? null : <path key={i} d={`M ${x} ${y} V 91 M ${x - 5} 82 L ${x} 92 L ${x + 5} 82`} />;
        })}<text x={a} y={Math.min(y1, y2) - 6}>q = {fmt(load.startIntensity / 1000)} → {fmt(load.endIntensity / 1000)} kN/m</text></g>;
      })}
      {spans.map((span, index) => <rect className="beam" key={index} x={xFor(nodes[index])} y="94" width={490 * span / total + .5} height="12" />)}
      {supports.map((support, index) => {
        const x = xFor(nodes[index]);
        if (support === "free") return <text className="node-label" key={index} x={x} y="137" textAnchor="middle">N{index + 1} · libre</text>;
        if (support === "fixed") return <g className="fixed-support" key={index}><line x1={x} y1="76" x2={x} y2="140" />{Array.from({ length: 6 }, (_, i) => <line key={i} x1={x - 15} y1={84 + i * 9} x2={x} y2={76 + i * 9} />)}</g>;
        return <g key={index}><path className="support" d={`M${x} 106 L${x - 15} 132 H${x + 15} Z`} /><line className="ground" x1={x - 22} y1="136" x2={x + 22} y2="136" /></g>;
      })}
      {reactions?.map((reaction, index) => Math.abs(reaction) < 1e-8 ? null : <g className="reaction-arrows" key={index}><path d={`M ${xFor(nodes[index])} 206 V 151 M ${xFor(nodes[index]) - 6} 162 L ${xFor(nodes[index])} 150 L ${xFor(nodes[index]) + 6} 162`} /><text x={xFor(nodes[index])} y="222" textAnchor="middle">R{index + 1} = {fmt(reaction / 1000, 3)} kN</text></g>)}
      {spans.map((span, index) => <g key={index}><line className="dimension" x1={xFor(nodes[index])} y1="247" x2={xFor(nodes[index + 1])} y2="247" /><text className="dimension-text" x={(xFor(nodes[index]) + xFor(nodes[index + 1])) / 2} y="263" textAnchor="middle">L{index + 1} = {fmt(span)} m</text></g>)}
    </svg>
  </div>;
}

function ContinuousDiagram({ title, symbol, unit, color, data, field, cursorX, total, onCursor }: {
  title: string; symbol: string; unit: string; color: string; data: ContinuousBeamResponse[]; field: FieldName; cursorX: number; total: number; onCursor: (ratio: number) => void;
}) {
  const values = data.map((point) => field === "deflection" ? point[field] * 1000 : point[field] / 1000);
  const max = Math.max(...values.map(Math.abs), 1e-9); const width = 720; const height = 220; const left = 48; const right = 16; const top = 22; const bottom = 30;
  const px = (x: number) => left + x / total * (width - left - right); const py = (value: number) => top + (max - value) / (2 * max) * (height - top - bottom);
  const path = data.map((point, index) => `${index ? "L" : "M"}${px(point.globalX).toFixed(2)},${py(values[index]).toFixed(2)}`).join(" ");
  const cursorPoint = data.reduce((best, point) => Math.abs(point.globalX - cursorX) < Math.abs(best.globalX - cursorX) ? point : best, data[0]);
  const cursorValue = field === "deflection" ? cursorPoint[field] * 1000 : cursorPoint[field] / 1000;
  const setFromPointer = (clientX: number, element: SVGSVGElement) => { const box = element.getBoundingClientRect(); onCursor(Math.max(0, Math.min(1, (clientX - box.left) / box.width))); };
  return <article className="diagram-card" style={{ "--diagram-color": color } as React.CSSProperties}>
    <div className="diagram-title"><span className="symbol">{symbol}</span><div><h3>{title}</h3><p>Máx. |{symbol}| = {fmt(max, 3)} {unit}</p></div></div>
    <svg viewBox={`0 0 ${width} ${height}`} tabIndex={0} aria-label={`${title}, cursor interactivo`} onPointerMove={(event) => setFromPointer(event.clientX, event.currentTarget)} onPointerDown={(event) => setFromPointer(event.clientX, event.currentTarget)}>
      <line className="chart-grid zero" x1={left} y1={py(0)} x2={width - right} y2={py(0)} /><path className="chart-line" d={path} />
      <line className="chart-cursor" x1={px(cursorPoint.globalX)} y1={top} x2={px(cursorPoint.globalX)} y2={height - bottom} /><circle className="cursor-dot" cx={px(cursorPoint.globalX)} cy={py(cursorValue)} r="4" />
      <text className="chart-label" x={left} y={height - 8}>0</text><text className="chart-label" x={width - right} y={height - 8} textAnchor="end">{fmt(total)} m</text>
    </svg>
  </article>;
}

const scientific = (value: number) => Math.abs(value) < 1e-12 ? "0" : value.toExponential(2);

function MatrixDevelopment({ solution, supports }: { solution: ContinuousBeamSolution; supports: ContinuousNodeSupport[] }) {
  const { t } = useTranslation();
  const supportName = (support: ContinuousNodeSupport) => t(`continuous.${support === "free" ? "free" : support === "simple" ? "simple" : "fixed"}`);
  const [view, setView] = useState<"dofs" | "system" | "results">("dofs");
  const dofLabels = supports.flatMap((_, index) => [`v${index + 1}`, `θ${index + 1}`]);
  const restrained = new Set(solution.restrainedDofs);
  const displacementVector = solution.displacements.flatMap((node) => [node.vertical, node.rotation]);
  return <details className="matrix-panel" open>
    <summary><span className="learning-number">04</span><div><strong>{t("continuous.matrix")} <ConceptTooltip label={t("continuous.matrix")}>{t("tooltip.matrix")}</ConceptTooltip></strong><small>{t("continuous.matrixSub")}</small></div><span className="summary-action">{t("common.showHide")}</span></summary>
    <div className="matrix-tabs" role="tablist" aria-label="Etapas del método matricial">
      <button role="tab" aria-selected={view === "dofs"} className={view === "dofs" ? "active" : ""} onClick={() => setView("dofs")}>{t("continuous.dofTab")}</button>
      <button role="tab" aria-selected={view === "system"} className={view === "system" ? "active" : ""} onClick={() => setView("system")}>{t("continuous.systemTab")}</button>
      <button role="tab" aria-selected={view === "results"} className={view === "results" ? "active" : ""} onClick={() => setView("results")}>{t("continuous.resultsTab")}</button>
    </div>
    {view === "dofs" && <div className="matrix-stage">
      <div className="stage-copy"><span className="step-kicker">Paso 1</span><h3>Numerar y restringir grados de libertad</h3><p>Cada nudo tiene desplazamiento vertical <em>v</em> y giro <em>θ</em>. Los apoyos eliminan los grados restringidos antes de resolver.</p><p className="formula">d = [{dofLabels.join(", ")}]ᵀ</p></div>
      <div className="dof-grid">{dofLabels.map((label, index) => <div key={label} className={restrained.has(index) ? "restrained" : "free"}><span>GDL {index + 1}</span><strong>{label}</strong><small>{restrained.has(index) ? "Restringido = 0" : "Incógnita libre"}</small></div>)}</div>
      <p className="matrix-note"><span className="legend-dot free" /> {solution.freeDofs.length} libres <span className="legend-dot restrained" /> {solution.restrainedDofs.length} restringidos</p>
    </div>}
    {view === "system" && <div className="matrix-stage">
      <div className="stage-copy"><span className="step-kicker">Paso 2</span><h3>Ensamblar el sistema global</h3><p>Cada vano aporta una matriz elemental. Las filas y columnas que comparten nudo se suman en la matriz global simétrica.</p><p className="matrix-note">Valores de K en unidades coherentes N–m. Notación científica para conservar legibilidad.</p></div>
      <div className="equation-layout"><div><h4>Matriz global K</h4><div className="matrix-scroll"><table className="matrix-table"><thead><tr><th />{dofLabels.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{solution.stiffnessMatrix.map((row, rowIndex) => <tr key={rowIndex}><th>{dofLabels[rowIndex]}</th>{row.map((value, columnIndex) => <td key={columnIndex} className={restrained.has(rowIndex) || restrained.has(columnIndex) ? "restrained-cell" : ""}>{scientific(value)}</td>)}</tr>)}</tbody></table></div></div>
      <div><h4>Vector de cargas F</h4><div className="vector-table">{solution.loadVector.map((value, index) => <div key={index}><span>{dofLabels[index]}</span><strong>{scientific(value)}</strong><small>{index % 2 === 0 ? "N" : "N·m"}</small></div>)}</div></div></div>
      <p className="formula matrix-equation">K<sub>ll</sub> · d<sub>l</sub> = F<sub>l</sub> → se resuelven únicamente los {solution.freeDofs.length} grados libres.</p>
    </div>}
    {view === "results" && <div className="matrix-stage">
      <div className="stage-copy"><span className="step-kicker">Paso 3</span><h3>Recuperar desplazamientos y fuerzas</h3><p>Con los desplazamientos libres se calculan las reacciones y las fuerzas de extremo de cada vano.</p></div>
      <div className="nodal-table-wrap"><table className="result-table"><thead><tr><th>{t("continuous.node", { number: "" })}</th><th>{t("continuous.supports")}</th><th>v (mm)</th><th>θ (rad)</th><th>Rᵧ (kN)</th><th>Rₘ (kN·m)</th></tr></thead><tbody>{solution.displacements.map((node, index) => <tr key={index}><th>N{index + 1}</th><td>{supportName(supports[index])}</td><td>{fmt(node.vertical * 1000, 5)}</td><td>{scientific(node.rotation)}</td><td>{fmt(solution.reactions[index].vertical / 1000, 4)}</td><td>{fmt(solution.reactions[index].moment / 1000, 4)}</td></tr>)}</tbody></table></div>
      <h4 className="end-force-title">Fuerzas de extremo por vano</h4><div className="end-force-grid">{solution.elementEndForces.map((forces, index) => <article key={index}><strong>Vano {index + 1}</strong><span>Vᵢ = {fmt(forces.leftShear / 1000, 3)} kN</span><span>Mᵢ = {fmt(forces.leftMoment / 1000, 3)} kN·m</span><span>Vⱼ = {fmt(forces.rightShear / 1000, 3)} kN</span><span>Mⱼ = {fmt(forces.rightMoment / 1000, 3)} kN·m</span></article>)}</div>
      <p className="formula">d = [{displacementVector.map(scientific).join(", ")}]ᵀ</p>
    </div>}
  </details>;
}

export default function ContinuousBeamCalculator({ onSwitchMode }: { onSwitchMode: () => void }) {
  const { t, i18n } = useTranslation();
  const [spans, setSpans] = useState([5, 5]);
  const [supports, setSupports] = useState<ContinuousNodeSupport[]>(["simple", "simple", "simple"]);
  const [elasticModulus, setElasticModulus] = useState(200);
  const [inertia, setInertia] = useState(8000);
  const [loads, setLoads] = useState<UiLoad[]>([{ id: 1, type: "linear-distributed", spanIndex: 0, startPosition: 0, endPosition: 5, startIntensity: 4000, endIntensity: 4000 }, { id: 2, type: "linear-distributed", spanIndex: 1, startPosition: 0, endPosition: 5, startIntensity: 4000, endIntensity: 4000 }]);
  const [nextId, setNextId] = useState(3); const [cursorRatio, setCursorRatio] = useState(.5);
  const [selectedPreset, setSelectedPreset] = useState("two-equal");
  const supportName = (support: ContinuousNodeSupport) => t(`continuous.${support === "free" ? "free" : support === "simple" ? "simple" : "fixed"}`);
  const total = spans.reduce((sum, span) => sum + span, 0);
  const calculation = useMemo(() => { try {
    const solution = solveContinuousBeam({ spans, supports, elasticModulus: elasticModulus * 1e9, secondMomentOfArea: inertia * 1e-8, loads });
    const discontinuities = loads.filter((load) => load.type === "point" || load.type === "moment");
    const data = spans.flatMap((span, spanIndex) => {
      const regular = Array.from({ length: 101 }, (_, index) => solution.evaluateAt(spanIndex, span * index / 100));
      const jumps = discontinuities.filter((load) => load.spanIndex === spanIndex).flatMap((load) => [solution.evaluateAt(spanIndex, load.position, "left"), solution.evaluateAt(spanIndex, load.position, "right")]);
      return [...regular, ...jumps].sort((a, b) => a.localX - b.localX);
    });
    return { solution, data, error: null };
  } catch (error) { return { solution: null, data: [] as ContinuousBeamResponse[], error: error instanceof ContinuousBeamValidationError ? error.issues[0] : "No se pudo realizar el cálculo." }; } }, [spans, supports, elasticModulus, inertia, loads]);
  const cursorX = total * cursorRatio; const cursorPoint = calculation.data.length ? calculation.data.reduce((best, point) => Math.abs(point.globalX - cursorX) < Math.abs(best.globalX - cursorX) ? point : best, calculation.data[0]) : null;
  const activePreset = continuousPresets.find((preset) => preset.id === selectedPreset);
  const equilibrium = useMemo(() => {
    if (!calculation.solution) return null;
    const nodePositions = calculation.solution.nodePositions;
    let downwardForce = 0; let downwardMoment = 0; let appliedMoment = 0;
    loads.forEach((load) => {
      const origin = nodePositions[load.spanIndex];
      if (load.type === "point") { downwardForce += load.magnitude; downwardMoment += load.magnitude * (origin + load.position); }
      else if (load.type === "moment") appliedMoment += load.magnitude;
      else {
        const length = load.endPosition - load.startPosition; const force = (load.startIntensity + load.endIntensity) * length / 2;
        const localFirstMoment = load.startPosition * force + load.startIntensity * length ** 2 / 2 + (load.endIntensity - load.startIntensity) * length ** 2 / 3;
        downwardForce += force; downwardMoment += force ? force * origin + localFirstMoment : 0;
      }
    });
    const reactionForce = calculation.solution.reactions.reduce((sum, reaction) => sum + reaction.vertical, 0);
    const reactionMoment = calculation.solution.reactions.reduce((sum, reaction, index) => sum + reaction.vertical * nodePositions[index] + reaction.moment, 0);
    return { forceResidual: reactionForce - downwardForce, momentResidual: reactionMoment + appliedMoment - downwardMoment, downwardForce, reactionForce };
  }, [calculation.solution, loads]);
  const updateLoad = (id: number, changes: Partial<UiLoad>) => setLoads((items) => items.map((load) => load.id === id ? { ...load, ...changes } as UiLoad : load));
  const addSpan = () => { if (spans.length >= 3) return; setSpans((items) => [...items, 5]); setSupports((items) => [...items, "simple"]); };
  const removeSpan = () => { if (spans.length <= 1) return; const last = spans.length - 1; setSpans((items) => items.slice(0, -1)); setSupports((items) => items.slice(0, -1)); setLoads((items) => items.filter((load) => load.spanIndex !== last)); };
  const addLoad = (type: "point" | "linear-distributed" | "moment") => { const id = nextId; const spanIndex = 0; const span = spans[0]; setNextId(id + 1); setLoads((items) => [...items, type === "point" ? { id, type, spanIndex, magnitude: 10000, position: span / 2 } : type === "moment" ? { id, type, spanIndex, magnitude: 10000, position: span / 2 } : { id, type, spanIndex, startPosition: 0, endPosition: span, startIntensity: 2000, endIntensity: 2000 }]); };
  const loadPreset = (id: string) => { setSelectedPreset(id); const preset = continuousPresets.find((item) => item.id === id); if (!preset) return; setSpans([...preset.spans]); setSupports([...preset.supports]); setLoads(preset.loads.map((load) => ({ ...load }))); setNextId(200); setCursorRatio(.5); };
  const exportSummary = () => {
    if (!calculation.solution || !equilibrium) return;
    const english = i18n.resolvedLanguage === "en";
    const lines = [english ? "BeamLab EDU — Continuous beam summary" : "BeamLab EDU — Resumen de viga continua", english ? "Educational use only; not suitable for professional design." : "Uso educativo; no apto para diseño profesional.", "", `${english ? "Spans" : "Vanos"}: ${spans.map((span) => `${span} m`).join(" | ")}`, `${english ? "Supports" : "Apoyos"}: ${supports.map((support, index) => `N${index + 1} ${supportName(support)}`).join(" | ")}`, `E = ${elasticModulus} GPa`, `I = ${inertia} cm⁴`, "", english ? "REACTIONS" : "REACCIONES", ...calculation.solution.reactions.map((reaction, index) => `N${index + 1}: Ry = ${fmt(reaction.vertical / 1000, 5)} kN; M = ${fmt(reaction.moment / 1000, 5)} kN·m`), "", english ? "NODAL DISPLACEMENTS" : "DESPLAZAMIENTOS NODALES", ...calculation.solution.displacements.map((node, index) => `N${index + 1}: v = ${fmt(node.vertical * 1000, 6)} mm; theta = ${scientific(node.rotation)} rad`), "", english ? "GLOBAL EQUILIBRIUM CHECK" : "COMPROBACIÓN GLOBAL", `${english ? "Force residual" : "Residual de fuerzas"} = ${scientific(equilibrium.forceResidual)} N`, `${english ? "Moment residual" : "Residual de momentos"} = ${scientific(equilibrium.momentResidual)} N·m`];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "beamlab-viga-continua.txt"; link.click(); URL.revokeObjectURL(url);
  };
  return <main>
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">M</span><span>BeamLab <small>EDU</small></span></a><div className="topbar-actions"><LanguageSwitcher /><button className="mode-button" onClick={onSwitchMode}>{t("common.single")}</button><span className="educational-badge">{t("continuous.badge")}</span></div></header>
    <section className="hero continuous-hero" id="top"><span className="eyebrow">{t("continuous.eyebrow")}</span><h1>{t("continuous.title")}</h1><p>{t("continuous.intro")}</p></section>
    <div className="workspace continuous-workspace"><aside className="control-panel">
      <div className="panel-heading"><div><span>01</span><h2>{t("continuous.define")}</h2></div><button className="reset-button" onClick={() => { setSpans([5,5]); setSupports(["simple","simple","simple"]); setLoads([]); setSelectedPreset("custom"); }}>{t("common.reset")}</button></div>
      <label className="example-field continuous-example"><span>{t("common.guided")}</span><select value={selectedPreset} onChange={(event) => loadPreset(event.target.value)}><option value="custom">{t("common.custom")}</option>{continuousPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}</select><small>{activePreset?.description ?? t("continuous.modify")}</small></label>
      <div className="span-toolbar"><button className="add-button" disabled={spans.length >= 3} onClick={addSpan}>{t("continuous.addSpan")}</button><button className="secondary-button" disabled={spans.length <= 1} onClick={removeSpan}>{t("continuous.removeSpan")}</button></div>
      <div className="span-list">{spans.map((span, index) => <NumberField key={index} label={t("continuous.spanLength", { number: index + 1 })} unit="m" value={span} min={.1} onChange={(value) => setSpans((items) => items.map((item, i) => i === index ? value : item))} />)}</div>
      <div className="field-grid"><NumberField label={t("single.modulus")} unit="GPa" value={elasticModulus} min={.1} hint={t("tooltip.modulus")} onChange={setElasticModulus} /><NumberField label={t("single.inertia")} unit="cm⁴" value={inertia} min={.1} hint={t("tooltip.inertia")} onChange={setInertia} /></div>
      <section className="load-section"><div className="load-heading"><div><span>02</span><h2>{t("continuous.supports")} <ConceptTooltip label={t("continuous.supports")}>{t("tooltip.supports")}</ConceptTooltip></h2></div></div><div className="support-node-list">{supports.map((support, index) => <label className="support-field" key={index}><span>{t("continuous.node", { number: index + 1 })}</span><select value={support} onChange={(event) => setSupports((items) => items.map((item, i) => i === index ? event.target.value as ContinuousNodeSupport : item))}>{(["free", "simple", "fixed"] as ContinuousNodeSupport[]).map((value) => <option key={value} value={value}>{supportName(value)}</option>)}</select></label>)}</div></section>
      <section className="load-section"><div className="load-heading"><div><span>03</span><h2>{t("continuous.loads")}</h2></div></div><div className="load-type-buttons"><button onClick={() => addLoad("point")}>{t("continuous.point")}</button><button onClick={() => addLoad("linear-distributed")}>{t("continuous.distributed")}</button><button onClick={() => addLoad("moment")}>{t("continuous.moment")}</button></div>
      {loads.length === 0 && <p className="empty-loads">{t("continuous.empty")}</p>}{loads.map((load, index) => <div className="load-editor continuous-load-editor" key={load.id}><div className="editor-title"><span>{load.type === "point" ? "P" : load.type === "moment" ? "M" : "q"}{index + 1}</span><strong>{load.type === "point" ? t("continuous.pointLoad") : load.type === "moment" ? t("continuous.appliedMoment") : t("continuous.distributedLoad")}</strong><button onClick={() => setLoads((items) => items.filter((item) => item.id !== load.id))} aria-label={`${t("common.remove")} ${index + 1}`}>×</button></div><div className="editor-grid">
        <label className="support-field compact-select"><span>{t("continuous.span")}</span><select value={load.spanIndex} onChange={(event) => { const spanIndex = Number(event.target.value); const length = spans[spanIndex]; updateLoad(load.id, load.type === "linear-distributed" ? { spanIndex, startPosition: 0, endPosition: length } : { spanIndex, position: length / 2 }); }}>{spans.map((_, i) => <option key={i} value={i}>{t("continuous.spanNumber", { number: i + 1 })}</option>)}</select></label>
        {load.type === "point" && <><NumberField label={t("common.magnitude")} unit="kN" value={load.magnitude / 1000} min={0} onChange={(value) => updateLoad(load.id, { magnitude: value * 1000 })} /><NumberField label={t("continuous.localPosition")} unit="m" value={load.position} min={0} onChange={(value) => updateLoad(load.id, { position: value })} /></>}
        {load.type === "moment" && <><NumberField label={t("continuous.appliedMoment")} unit="kN·m" value={load.magnitude / 1000} onChange={(value) => updateLoad(load.id, { magnitude: value * 1000 })} /><NumberField label={t("continuous.localPosition")} unit="m" value={load.position} min={0} onChange={(value) => updateLoad(load.id, { position: value })} /></>}
        {load.type === "linear-distributed" && <><NumberField label={t("common.start")} unit="m" value={load.startPosition} min={0} onChange={(value) => updateLoad(load.id, { startPosition: value })} /><NumberField label={t("common.end")} unit="m" value={load.endPosition} min={0} onChange={(value) => updateLoad(load.id, { endPosition: value })} /><NumberField label={t("continuous.initialIntensity")} unit="kN/m" value={load.startIntensity / 1000} min={0} onChange={(value) => updateLoad(load.id, { startIntensity: value * 1000 })} /><NumberField label={t("continuous.finalIntensity")} unit="kN/m" value={load.endIntensity / 1000} min={0} onChange={(value) => updateLoad(load.id, { endIntensity: value * 1000 })} /></>}
      </div></div>)}</section><p className="convention">{t("continuous.convention")}</p>
    </aside><section className="results-panel"><ContinuousSketch spans={spans} supports={supports} loads={loads} reactions={calculation.solution?.reactions.map((reaction) => reaction.vertical) ?? null} />
      {calculation.error ? <div className="error-card"><strong>{t("continuous.review")}</strong><span>{calculation.error}</span></div> : calculation.solution && cursorPoint && equilibrium && <><div className="results-actions"><div><span className="eyebrow">{t("continuous.updated")}</span><p>{t("continuous.updatedSub")}</p></div><button className="export-button" onClick={exportSummary}>{t("continuous.export")}</button></div><div className="continuous-summary"><div><span>{t("continuous.dofs")}</span><strong>{supports.length * 2}</strong></div><div><span>{t("continuous.freeDofs")}</span><strong>{calculation.solution.freeDofs.length}</strong></div><div><span>{t("continuous.maxMoment")}</span><strong>{fmt(Math.max(...calculation.data.map((point) => Math.abs(point.moment))) / 1000, 3)} <small>kN·m</small></strong></div><div><span>{t("continuous.maxDeflection")}</span><strong>{fmt(Math.max(...calculation.data.map((point) => Math.abs(point.deflection))) * 1000, 3)} <small>mm</small></strong></div></div>
      <section className="equilibrium-card" aria-label={t("continuous.globalEquilibrium")}><div className="equilibrium-heading"><div><span className="check-mark">✓</span><div><h3>{t("continuous.globalEquilibrium")} <ConceptTooltip label={t("continuous.globalEquilibrium")}>{t("tooltip.residuals")}</ConceptTooltip></h3><p>{t("continuous.globalEquilibriumSub")}</p></div></div><span className="verified-pill">{t("continuous.verified")}</span></div><div className="equilibrium-values"><div><span>ΣFᵧ residual</span><strong>{scientific(equilibrium.forceResidual)} <small>N</small></strong></div><div><span>ΣM₀ residual</span><strong>{scientific(equilibrium.momentResidual)} <small>N·m</small></strong></div><div><span>{t("continuous.verticalLoad")}</span><strong>{fmt(equilibrium.downwardForce / 1000, 3)} <small>kN</small></strong></div><div><span>{t("continuous.verticalReactions")}</span><strong>{fmt(equilibrium.reactionForce / 1000, 3)} <small>kN</small></strong></div></div></section>
      <MatrixDevelopment solution={calculation.solution} supports={supports} />
      <div className="diagram-heading"><span>05</span><div><h2>{t("continuous.response")}</h2><p>{t("continuous.responseSub")}</p></div></div><div className="cursor-readout"><div><span>{t("continuous.globalX")}</span><strong>{fmt(cursorPoint.globalX,3)} <small>m</small></strong></div><div><span>V(x)</span><strong>{fmt(cursorPoint.shear/1000,3)} <small>kN</small></strong></div><div><span>M(x)</span><strong>{fmt(cursorPoint.moment/1000,3)} <small>kN·m</small></strong></div><div><span>θ(x)</span><strong>{fmt(cursorPoint.slope,6)} <small>rad</small></strong></div><div><span>v(x)</span><strong>{fmt(cursorPoint.deflection*1000,4)} <small>mm</small></strong></div></div><div className="diagrams"><ContinuousDiagram title={t("single.shear")} symbol="V" unit="kN" color="#1d5d79" data={calculation.data} field="shear" cursorX={cursorX} total={total} onCursor={setCursorRatio} /><ContinuousDiagram title={t("single.bending")} symbol="M" unit="kN·m" color="#c46a2b" data={calculation.data} field="moment" cursorX={cursorX} total={total} onCursor={setCursorRatio} /><ContinuousDiagram title={t("single.deflection")} symbol="δ" unit="mm" color="#6657a8" data={calculation.data} field="deflection" cursorX={cursorX} total={total} onCursor={setCursorRatio} /></div></>}
    </section></div><footer><span>{t("continuous.footer")}</span><p>{t("common.noProfessional")}</p></footer>
  </main>;
}
