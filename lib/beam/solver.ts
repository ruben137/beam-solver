import type {
  AppliedMoment,
  BeamLoad,
  BeamModel,
  BeamReactions,
  BeamResponse,
  BeamSolution,
  LinearDistributedLoad,
  PointLoad,
  ResponseExtreme,
  SimplySupportedBeam,
} from "./types";

export class BeamValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "BeamValidationError";
    this.issues = issues;
  }
}

const macaulay = (x: number, origin: number, exponent: number) =>
  x >= origin ? (x - origin) ** exponent : 0;

const isActive = (x: number, origin: number, side: "left" | "right") =>
  x > origin || (x === origin && side === "right");

function validateBeam(beam: BeamModel | SimplySupportedBeam): void {
  const issues: string[] = [];
  const positiveFields: Array<[string, number]> = [
    ["La longitud", beam.length],
    ["El módulo de elasticidad", beam.elasticModulus],
    ["El segundo momento de área", beam.secondMomentOfArea],
  ];

  for (const [label, value] of positiveFields) {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push(`${label} debe ser un número finito mayor que cero.`);
    }
  }

  const support = beam.support ?? "simply-supported";
  if (!["simply-supported", "cantilever-left", "cantilever-right"].includes(support)) {
    issues.push("La configuración de apoyos no es compatible.");
  }

  if (!Array.isArray(beam.loads)) {
    issues.push("Las cargas deben proporcionarse como una lista.");
  } else {
    beam.loads.forEach((load, index) => {
      const number = index + 1;
      if (load.type === "point") {
        if (!Number.isFinite(load.magnitude) || load.magnitude < 0) {
          issues.push(`La carga puntual ${number} debe ser finita y no negativa.`);
        }
        if (!isPositionOnBeam(load.position, beam.length)) {
          issues.push(`La posición de la carga puntual ${number} debe estar dentro de la viga.`);
        }
      } else if (load.type === "moment") {
        if (!Number.isFinite(load.magnitude)) {
          issues.push(`El momento aplicado ${number} debe ser finito.`);
        }
        if (!isPositionOnBeam(load.position, beam.length)) {
          issues.push(`La posición del momento aplicado ${number} debe estar dentro de la viga.`);
        }
      } else if (load.type === "uniform") {
        if (!Number.isFinite(load.intensity) || load.intensity < 0) {
          issues.push(`La carga distribuida ${number} debe ser finita y no negativa.`);
        }
      } else if (load.type === "linear-distributed") {
        if (
          !Number.isFinite(load.startIntensity) || load.startIntensity < 0 ||
          !Number.isFinite(load.endIntensity) || load.endIntensity < 0
        ) {
          issues.push(`Las intensidades de la carga distribuida ${number} deben ser finitas y no negativas.`);
        }
        if (
          !isPositionOnBeam(load.startPosition, beam.length) ||
          !isPositionOnBeam(load.endPosition, beam.length) ||
          load.endPosition <= load.startPosition
        ) {
          issues.push(`El tramo de la carga distribuida ${number} debe estar dentro de la viga y tener longitud positiva.`);
        }
      } else {
        issues.push(`El tipo de carga ${number} no es compatible.`);
      }
    });
  }

  if (issues.length > 0) throw new BeamValidationError(issues);
}

const isPositionOnBeam = (position: number, length: number) =>
  Number.isFinite(position) && position >= 0 && position <= length;

function absoluteExtreme(
  responses: BeamResponse[],
  field: "shear" | "moment" | "deflection",
): ResponseExtreme {
  const response = responses.reduce((current, candidate) =>
    Math.abs(candidate[field]) > Math.abs(current[field]) ? candidate : current,
  );
  return { x: response.x, value: response[field] };
}

function asDistributedLoads(loads: BeamLoad[], length: number): LinearDistributedLoad[] {
  return loads.flatMap((load) => {
    if (load.type === "linear-distributed") return [load];
    if (load.type === "uniform") {
      return [{
        type: "linear-distributed" as const,
        startPosition: 0,
        endPosition: length,
        startIntensity: load.intensity,
        endIntensity: load.intensity,
      }];
    }
    return [];
  });
}

function distributedResultant(load: LinearDistributedLoad) {
  const span = load.endPosition - load.startPosition;
  const gradient = (load.endIntensity - load.startIntensity) / span;
  const force = load.startIntensity * span + gradient * span ** 2 / 2;
  const firstMoment =
    load.startPosition * force +
    load.startIntensity * span ** 2 / 2 +
    gradient * span ** 3 / 3;
  return { force, firstMoment };
}

function distributedContribution(load: LinearDistributedLoad, x: number) {
  const a = load.startPosition;
  const b = load.endPosition;
  const gradient = (load.endIntensity - load.startIntensity) / (b - a);
  return {
    shear:
      load.startIntensity * macaulay(x, a, 1) + gradient * macaulay(x, a, 2) / 2 -
      load.endIntensity * macaulay(x, b, 1) - gradient * macaulay(x, b, 2) / 2,
    moment:
      load.startIntensity * macaulay(x, a, 2) / 2 + gradient * macaulay(x, a, 3) / 6 -
      load.endIntensity * macaulay(x, b, 2) / 2 - gradient * macaulay(x, b, 3) / 6,
    slope:
      load.startIntensity * macaulay(x, a, 3) / 6 + gradient * macaulay(x, a, 4) / 24 -
      load.endIntensity * macaulay(x, b, 3) / 6 - gradient * macaulay(x, b, 4) / 24,
    deflection:
      load.startIntensity * macaulay(x, a, 4) / 24 + gradient * macaulay(x, a, 5) / 120 -
      load.endIntensity * macaulay(x, b, 4) / 24 - gradient * macaulay(x, b, 5) / 120,
  };
}

/** Solves the supported beam configurations included in the educational v2 engine. */
export function solveBeam(beam: BeamModel): BeamSolution {
  validateBeam(beam);

  const { length, elasticModulus, secondMomentOfArea, support } = beam;
  const pointLoads = beam.loads.filter((load): load is PointLoad => load.type === "point");
  const appliedMoments = beam.loads.filter((load): load is AppliedMoment => load.type === "moment");
  const distributedLoads = asDistributedLoads(beam.loads, length);
  const distributedTotals = distributedLoads.map(distributedResultant);
  const totalForce =
    pointLoads.reduce((sum, load) => sum + load.magnitude, 0) +
    distributedTotals.reduce((sum, load) => sum + load.force, 0);
  const forceMomentAboutLeft =
    pointLoads.reduce((sum, load) => sum + load.magnitude * load.position, 0) +
    distributedTotals.reduce((sum, load) => sum + load.firstMoment, 0);
  const appliedMomentTotal = appliedMoments.reduce((sum, load) => sum + load.magnitude, 0);

  let reactions: BeamReactions;
  let initialShear = 0;
  let initialMoment = 0;

  if (support === "simply-supported") {
    const right = (forceMomentAboutLeft - appliedMomentTotal) / length;
    reactions = { left: totalForce - right, right };
    initialShear = reactions.left;
  } else if (support === "cantilever-left") {
    const leftMoment = forceMomentAboutLeft - appliedMomentTotal;
    reactions = { left: totalForce, right: 0, leftMoment };
    initialShear = totalForce;
    initialMoment = -leftMoment;
  } else {
    const forceMomentAboutRight = totalForce * length - forceMomentAboutLeft;
    reactions = {
      left: 0,
      right: totalForce,
      rightMoment: -(forceMomentAboutRight + appliedMomentTotal),
    };
  }

  const rawResponse = (x: number, side: "left" | "right") => {
    const pointShear = pointLoads.reduce(
      (sum, load) => sum + (isActive(x, load.position, side) ? load.magnitude : 0),
      0,
    );
    const pointMoment = pointLoads.reduce(
      (sum, load) => sum + load.magnitude * macaulay(x, load.position, 1),
      0,
    );
    const pointSlope = pointLoads.reduce(
      (sum, load) => sum + load.magnitude * macaulay(x, load.position, 2) / 2,
      0,
    );
    const pointDeflection = pointLoads.reduce(
      (sum, load) => sum + load.magnitude * macaulay(x, load.position, 3) / 6,
      0,
    );
    const momentJump = appliedMoments.reduce(
      (sum, load) => sum + (isActive(x, load.position, side) ? load.magnitude : 0),
      0,
    );
    const momentSlope = appliedMoments.reduce(
      (sum, load) => sum + load.magnitude * macaulay(x, load.position, 1),
      0,
    );
    const momentDeflection = appliedMoments.reduce(
      (sum, load) => sum + load.magnitude * macaulay(x, load.position, 2) / 2,
      0,
    );
    const distributed = distributedLoads.reduce(
      (sum, load) => {
        const contribution = distributedContribution(load, x);
        return {
          shear: sum.shear + contribution.shear,
          moment: sum.moment + contribution.moment,
          slope: sum.slope + contribution.slope,
          deflection: sum.deflection + contribution.deflection,
        };
      },
      { shear: 0, moment: 0, slope: 0, deflection: 0 },
    );

    return {
      shear: initialShear - pointShear - distributed.shear,
      moment: initialMoment + initialShear * x - pointMoment - momentJump - distributed.moment,
      slope: initialMoment * x + initialShear * x ** 2 / 2 - pointSlope - momentSlope - distributed.slope,
      deflection:
        initialMoment * x ** 2 / 2 + initialShear * x ** 3 / 6 -
        pointDeflection - momentDeflection - distributed.deflection,
    };
  };

  const leftRaw = rawResponse(0, "right");
  const rightRaw = rawResponse(length, "right");
  let slopeConstant = 0;
  let deflectionConstant = 0;
  if (support === "simply-supported") {
    deflectionConstant = -leftRaw.deflection;
    slopeConstant = -(rightRaw.deflection + deflectionConstant) / length;
  } else if (support === "cantilever-left") {
    slopeConstant = -leftRaw.slope;
    deflectionConstant = -leftRaw.deflection;
  } else {
    slopeConstant = -rightRaw.slope;
    deflectionConstant = -rightRaw.deflection - slopeConstant * length;
  }

  const flexuralRigidity = elasticModulus * secondMomentOfArea;
  const evaluateAt = (x: number, side: "left" | "right" = "right"): BeamResponse => {
    if (!isPositionOnBeam(x, length)) {
      throw new BeamValidationError(["La posición de evaluación debe estar dentro de la viga."]);
    }
    const raw = rawResponse(x, side);
    return {
      x,
      shear: raw.shear,
      moment: raw.moment,
      slope: (raw.slope + slopeConstant) / flexuralRigidity,
      deflection: (raw.deflection + slopeConstant * x + deflectionConstant) / flexuralRigidity,
    };
  };

  const sample = (pointCount = 201): BeamResponse[] => {
    if (!Number.isInteger(pointCount) || pointCount < 2 || pointCount > 10_001) {
      throw new BeamValidationError(["El muestreo debe contener entre 2 y 10 001 puntos."]);
    }
    return Array.from({ length: pointCount }, (_, index) =>
      evaluateAt(length * index / (pointCount - 1)),
    );
  };

  const discontinuities = [
    ...pointLoads.map((load) => load.position),
    ...appliedMoments.map((load) => load.position),
  ];
  const extremeCandidates = [
    ...sample(1001),
    ...[...new Set(discontinuities)].flatMap((position) => [
      evaluateAt(position, "left"),
      evaluateAt(position, "right"),
    ]),
  ];
  return {
    reactions,
    evaluateAt,
    sample,
    extremes: {
      maximumAbsoluteShear: absoluteExtreme(extremeCandidates, "shear"),
      maximumAbsoluteMoment: absoluteExtreme(extremeCandidates, "moment"),
      maximumAbsoluteDeflection: absoluteExtreme(extremeCandidates, "deflection"),
    },
  };
}

/** Backwards-compatible entry point used by the v1 interface. */
export function solveSimplySupportedBeam(beam: SimplySupportedBeam): BeamSolution {
  return solveBeam({ ...beam, support: "simply-supported" });
}

export type {
  AppliedMoment,
  BeamLoad,
  BeamModel,
  BeamReactions,
  BeamResponse,
  BeamSolution,
  BeamSupport,
  LinearDistributedLoad,
  PointLoad,
  SimplySupportedBeam,
  UniformLoad,
} from "./types";
