/** All values use SI base units: N, m, Pa and m^4. */
export type BeamSupport = "simply-supported" | "cantilever-left" | "cantilever-right";

export interface PointLoad {
  type: "point";
  /** Downward force in newtons. */
  magnitude: number;
  /** Distance from the left end in metres. */
  position: number;
}

/** Backwards-compatible uniform load over the complete span. */
export interface UniformLoad {
  type: "uniform";
  /** Downward force per unit length in N/m. */
  intensity: number;
}

export interface LinearDistributedLoad {
  type: "linear-distributed";
  startPosition: number;
  endPosition: number;
  /** Downward intensity at startPosition in N/m. */
  startIntensity: number;
  /** Downward intensity at endPosition in N/m. */
  endIntensity: number;
}

export interface AppliedMoment {
  type: "moment";
  /** Moment in N*m. Positive is counter-clockwise. */
  magnitude: number;
  position: number;
}

export type BeamLoad = PointLoad | UniformLoad | LinearDistributedLoad | AppliedMoment;

export interface BeamModel {
  length: number;
  elasticModulus: number;
  secondMomentOfArea: number;
  support: BeamSupport;
  loads: BeamLoad[];
}

export interface SimplySupportedBeam extends Omit<BeamModel, "support"> {
  support?: "simply-supported";
}

export interface BeamResponse {
  x: number;
  /** Positive means upward on the left cut face. */
  shear: number;
  /** Positive means sagging. */
  moment: number;
  /** Radians; positive means counter-clockwise. */
  slope: number;
  /** Metres; negative means downward. */
  deflection: number;
}

export interface BeamReactions {
  /** Upward forces in N. */
  left: number;
  right: number;
  /** Optional support moments in N*m. Positive is counter-clockwise. */
  leftMoment?: number;
  rightMoment?: number;
}

export interface ResponseExtreme {
  x: number;
  value: number;
}

export interface BeamSolution {
  reactions: BeamReactions;
  /** At a concentrated action, `side` selects the value before or after its jump. */
  evaluateAt: (x: number, side?: "left" | "right") => BeamResponse;
  sample: (pointCount?: number) => BeamResponse[];
  extremes: {
    maximumAbsoluteShear: ResponseExtreme;
    maximumAbsoluteMoment: ResponseExtreme;
    maximumAbsoluteDeflection: ResponseExtreme;
  };
}
