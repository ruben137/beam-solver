export type ContinuousNodeSupport = "free" | "simple" | "fixed";

export interface SpanPointLoad {
  type: "point";
  spanIndex: number;
  magnitude: number;
  position: number;
}

export interface SpanDistributedLoad {
  type: "linear-distributed";
  spanIndex: number;
  startPosition: number;
  endPosition: number;
  startIntensity: number;
  endIntensity: number;
}

export interface SpanAppliedMoment {
  type: "moment";
  spanIndex: number;
  /** N*m. Positive is counter-clockwise. */
  magnitude: number;
  position: number;
}

export type ContinuousBeamLoad = SpanPointLoad | SpanDistributedLoad | SpanAppliedMoment;

export interface ContinuousBeamModel {
  /** One to three physical spans, in metres. */
  spans: number[];
  /** One support definition per node: spans.length + 1. */
  supports: ContinuousNodeSupport[];
  elasticModulus: number;
  secondMomentOfArea: number;
  loads: ContinuousBeamLoad[];
}

export interface NodeDisplacement {
  vertical: number;
  rotation: number;
}

export interface NodeReaction {
  vertical: number;
  moment: number;
}

export interface ElementEndForces {
  leftShear: number;
  leftMoment: number;
  rightShear: number;
  rightMoment: number;
}

export interface ContinuousBeamResponse {
  spanIndex: number;
  localX: number;
  globalX: number;
  shear: number;
  moment: number;
  slope: number;
  deflection: number;
}

export interface ContinuousBeamSolution {
  nodePositions: number[];
  displacements: NodeDisplacement[];
  reactions: NodeReaction[];
  elementEndForces: ElementEndForces[];
  stiffnessMatrix: number[][];
  loadVector: number[];
  freeDofs: number[];
  restrainedDofs: number[];
  evaluateAt: (spanIndex: number, localX: number, side?: "left" | "right") => ContinuousBeamResponse;
}
