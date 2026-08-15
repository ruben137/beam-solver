import type {
  ContinuousBeamLoad,
  ContinuousBeamModel,
  ContinuousBeamResponse,
  ContinuousBeamSolution,
  ElementEndForces,
  SpanAppliedMoment,
  SpanDistributedLoad,
  SpanPointLoad,
} from "./types";

export class ContinuousBeamValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "ContinuousBeamValidationError";
    this.issues = issues;
  }
}

const zeros = (rows: number, columns = rows) =>
  Array.from({ length: rows }, () => Array<number>(columns).fill(0));

function elementStiffness(length: number, rigidity: number): number[][] {
  const factor = rigidity / length ** 3;
  const l = length;
  return [
    [12, 6 * l, -12, 6 * l],
    [6 * l, 4 * l ** 2, -6 * l, 2 * l ** 2],
    [-12, -6 * l, 12, -6 * l],
    [6 * l, 2 * l ** 2, -6 * l, 4 * l ** 2],
  ].map((row) => row.map((value) => value * factor));
}

function shapeFunctions(position: number, length: number): number[] {
  const x = position / length;
  return [
    1 - 3 * x ** 2 + 2 * x ** 3,
    length * (x - 2 * x ** 2 + x ** 3),
    3 * x ** 2 - 2 * x ** 3,
    length * (-(x ** 2) + x ** 3),
  ];
}

function shapeDerivatives(position: number, length: number): number[] {
  const x = position / length;
  return [
    (-6 * x + 6 * x ** 2) / length,
    1 - 4 * x + 3 * x ** 2,
    (6 * x - 6 * x ** 2) / length,
    -2 * x + 3 * x ** 2,
  ];
}

const gaussPoints = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526];
const gaussWeights = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538];

function equivalentLoadVector(loads: ContinuousBeamLoad[], spanIndex: number, length: number): number[] {
  const vector = [0, 0, 0, 0];
  for (const load of loads) {
    if (load.spanIndex !== spanIndex) continue;
    if (load.type === "point") {
      const shape = shapeFunctions(load.position, length);
      shape.forEach((value, index) => { vector[index] -= load.magnitude * value; });
    } else if (load.type === "moment") {
      const derivatives = shapeDerivatives(load.position, length);
      derivatives.forEach((value, index) => { vector[index] += load.magnitude * value; });
    } else {
      const half = (load.endPosition - load.startPosition) / 2;
      const center = (load.startPosition + load.endPosition) / 2;
      for (let pointIndex = 0; pointIndex < gaussPoints.length; pointIndex += 1) {
        const position = center + half * gaussPoints[pointIndex];
        const ratio = (position - load.startPosition) / (load.endPosition - load.startPosition);
        const intensity = load.startIntensity + (load.endIntensity - load.startIntensity) * ratio;
        const shape = shapeFunctions(position, length);
        shape.forEach((value, index) => {
          vector[index] -= gaussWeights[pointIndex] * half * intensity * value;
        });
      }
    }
  }
  return vector;
}

function validateModel(model: ContinuousBeamModel): void {
  const issues: string[] = [];
  if (!Array.isArray(model.spans) || model.spans.length < 1 || model.spans.length > 3) {
    issues.push("La viga debe contener entre uno y tres vanos.");
  } else if (model.spans.some((span) => !Number.isFinite(span) || span <= 0)) {
    issues.push("Todas las longitudes de vano deben ser finitas y mayores que cero.");
  }
  if (!Number.isFinite(model.elasticModulus) || model.elasticModulus <= 0) {
    issues.push("El módulo de elasticidad debe ser finito y mayor que cero.");
  }
  if (!Number.isFinite(model.secondMomentOfArea) || model.secondMomentOfArea <= 0) {
    issues.push("El segundo momento de área debe ser finito y mayor que cero.");
  }
  if (!Array.isArray(model.supports) || model.supports.length !== model.spans.length + 1) {
    issues.push("Debe definirse un apoyo por cada nudo.");
  } else if (model.supports.some((support) => !["free", "simple", "fixed"].includes(support))) {
    issues.push("Existe un tipo de apoyo no compatible.");
  }
  if (!Array.isArray(model.loads)) {
    issues.push("Las cargas deben proporcionarse como una lista.");
  } else {
    model.loads.forEach((load, index) => {
      const spanLength = model.spans[load.spanIndex];
      if (!Number.isInteger(load.spanIndex) || spanLength === undefined) {
        issues.push(`La carga ${index + 1} pertenece a un vano inexistente.`);
        return;
      }
      if (load.type === "point") {
        if (!Number.isFinite(load.magnitude) || load.magnitude < 0 || !onSpan(load.position, spanLength)) {
          issues.push(`La carga puntual ${index + 1} no es válida.`);
        }
      } else if (load.type === "moment") {
        if (!Number.isFinite(load.magnitude) || !onSpan(load.position, spanLength)) {
          issues.push(`El momento aplicado ${index + 1} no es válido.`);
        }
      } else if (
        !Number.isFinite(load.startIntensity) || load.startIntensity < 0 ||
        !Number.isFinite(load.endIntensity) || load.endIntensity < 0 ||
        !onSpan(load.startPosition, spanLength) || !onSpan(load.endPosition, spanLength) ||
        load.endPosition <= load.startPosition
      ) {
        issues.push(`La carga distribuida ${index + 1} no es válida.`);
      }
    });
  }
  if (issues.length > 0) throw new ContinuousBeamValidationError(issues);
}

const onSpan = (position: number, length: number) =>
  Number.isFinite(position) && position >= 0 && position <= length;

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) {
      throw new ContinuousBeamValidationError(["La estructura es inestable o sus restricciones son insuficientes."]);
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

const matrixVector = (matrix: number[][], vector: number[]) =>
  matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));

const macaulay = (x: number, origin: number, exponent: number) =>
  x >= origin ? (x - origin) ** exponent : 0;

const active = (x: number, origin: number, side: "left" | "right") =>
  x > origin || (x === origin && side === "right");

function distributedContribution(load: SpanDistributedLoad, x: number) {
  const gradient = (load.endIntensity - load.startIntensity) / (load.endPosition - load.startPosition);
  const a = load.startPosition;
  const b = load.endPosition;
  return {
    shear: load.startIntensity * macaulay(x, a, 1) + gradient * macaulay(x, a, 2) / 2 - load.endIntensity * macaulay(x, b, 1) - gradient * macaulay(x, b, 2) / 2,
    moment: load.startIntensity * macaulay(x, a, 2) / 2 + gradient * macaulay(x, a, 3) / 6 - load.endIntensity * macaulay(x, b, 2) / 2 - gradient * macaulay(x, b, 3) / 6,
    slope: load.startIntensity * macaulay(x, a, 3) / 6 + gradient * macaulay(x, a, 4) / 24 - load.endIntensity * macaulay(x, b, 3) / 6 - gradient * macaulay(x, b, 4) / 24,
    deflection: load.startIntensity * macaulay(x, a, 4) / 24 + gradient * macaulay(x, a, 5) / 120 - load.endIntensity * macaulay(x, b, 4) / 24 - gradient * macaulay(x, b, 5) / 120,
  };
}

/** Direct-stiffness solver for one to three collinear Euler-Bernoulli beam spans. */
export function solveContinuousBeam(model: ContinuousBeamModel): ContinuousBeamSolution {
  validateModel(model);
  const nodeCount = model.spans.length + 1;
  const dofCount = nodeCount * 2;
  const rigidity = model.elasticModulus * model.secondMomentOfArea;
  const stiffnessMatrix = zeros(dofCount);
  const loadVector = Array<number>(dofCount).fill(0);
  const elementMatrices: number[][][] = [];
  const elementLoadVectors: number[][] = [];

  model.spans.forEach((length, spanIndex) => {
    const matrix = elementStiffness(length, rigidity);
    const loads = equivalentLoadVector(model.loads, spanIndex, length);
    const dofs = [2 * spanIndex, 2 * spanIndex + 1, 2 * spanIndex + 2, 2 * spanIndex + 3];
    elementMatrices.push(matrix);
    elementLoadVectors.push(loads);
    dofs.forEach((globalRow, localRow) => {
      loadVector[globalRow] += loads[localRow];
      dofs.forEach((globalColumn, localColumn) => {
        stiffnessMatrix[globalRow][globalColumn] += matrix[localRow][localColumn];
      });
    });
  });

  const restrainedDofs: number[] = [];
  model.supports.forEach((support, nodeIndex) => {
    if (support === "simple" || support === "fixed") restrainedDofs.push(2 * nodeIndex);
    if (support === "fixed") restrainedDofs.push(2 * nodeIndex + 1);
  });
  const restrainedSet = new Set(restrainedDofs);
  const freeDofs = Array.from({ length: dofCount }, (_, index) => index).filter((index) => !restrainedSet.has(index));
  const reducedMatrix = freeDofs.map((row) => freeDofs.map((column) => stiffnessMatrix[row][column]));
  const reducedVector = freeDofs.map((dof) => loadVector[dof]);
  const freeDisplacements = freeDofs.length > 0 ? solveLinearSystem(reducedMatrix, reducedVector) : [];
  const displacementVector = Array<number>(dofCount).fill(0);
  freeDofs.forEach((dof, index) => { displacementVector[dof] = freeDisplacements[index]; });
  const residual = matrixVector(stiffnessMatrix, displacementVector).map((value, index) => value - loadVector[index]);

  const elementEndForces: ElementEndForces[] = model.spans.map((_, spanIndex) => {
    const dofs = [2 * spanIndex, 2 * spanIndex + 1, 2 * spanIndex + 2, 2 * spanIndex + 3];
    const localDisplacements = dofs.map((dof) => displacementVector[dof]);
    const forces = matrixVector(elementMatrices[spanIndex], localDisplacements)
      .map((value, index) => value - elementLoadVectors[spanIndex][index]);
    return { leftShear: forces[0], leftMoment: forces[1], rightShear: forces[2], rightMoment: forces[3] };
  });
  const nodePositions = [0];
  model.spans.forEach((span) => nodePositions.push(nodePositions.at(-1)! + span));

  const evaluateAt = (spanIndex: number, localX: number, side: "left" | "right" = "right"): ContinuousBeamResponse => {
    const length = model.spans[spanIndex];
    if (length === undefined || !onSpan(localX, length)) {
      throw new ContinuousBeamValidationError(["La posición de evaluación no pertenece a un vano válido."]);
    }
    const loads = model.loads.filter((load) => load.spanIndex === spanIndex);
    const points = loads.filter((load): load is SpanPointLoad => load.type === "point");
    const moments = loads.filter((load): load is SpanAppliedMoment => load.type === "moment");
    const distributed = loads.filter((load): load is SpanDistributedLoad => load.type === "linear-distributed");
    const startForces = elementEndForces[spanIndex];
    const initialShear = startForces.leftShear;
    const initialMoment = -startForces.leftMoment;
    const pointShear = points.reduce((sum, load) => sum + (active(localX, load.position, side) ? load.magnitude : 0), 0);
    const pointMoment = points.reduce((sum, load) => sum + load.magnitude * macaulay(localX, load.position, 1), 0);
    const pointSlope = points.reduce((sum, load) => sum + load.magnitude * macaulay(localX, load.position, 2) / 2, 0);
    const pointDeflection = points.reduce((sum, load) => sum + load.magnitude * macaulay(localX, load.position, 3) / 6, 0);
    const momentJump = moments.reduce((sum, load) => sum + (active(localX, load.position, side) ? load.magnitude : 0), 0);
    const momentSlope = moments.reduce((sum, load) => sum + load.magnitude * macaulay(localX, load.position, 1), 0);
    const momentDeflection = moments.reduce((sum, load) => sum + load.magnitude * macaulay(localX, load.position, 2) / 2, 0);
    const distributedTotal = distributed.reduce((sum, load) => {
      const value = distributedContribution(load, localX);
      return { shear: sum.shear + value.shear, moment: sum.moment + value.moment, slope: sum.slope + value.slope, deflection: sum.deflection + value.deflection };
    }, { shear: 0, moment: 0, slope: 0, deflection: 0 });
    const leftDisplacement = displacementVector[2 * spanIndex];
    const leftRotation = displacementVector[2 * spanIndex + 1];
    return {
      spanIndex,
      localX,
      globalX: nodePositions[spanIndex] + localX,
      shear: initialShear - pointShear - distributedTotal.shear,
      moment: initialMoment + initialShear * localX - pointMoment - momentJump - distributedTotal.moment,
      slope: leftRotation + (initialMoment * localX + initialShear * localX ** 2 / 2 - pointSlope - momentSlope - distributedTotal.slope) / rigidity,
      deflection: leftDisplacement + leftRotation * localX + (initialMoment * localX ** 2 / 2 + initialShear * localX ** 3 / 6 - pointDeflection - momentDeflection - distributedTotal.deflection) / rigidity,
    };
  };

  return {
    nodePositions,
    displacements: Array.from({ length: nodeCount }, (_, index) => ({ vertical: displacementVector[2 * index], rotation: displacementVector[2 * index + 1] })),
    reactions: Array.from({ length: nodeCount }, (_, index) => ({ vertical: residual[2 * index], moment: residual[2 * index + 1] })),
    elementEndForces,
    stiffnessMatrix,
    loadVector,
    freeDofs,
    restrainedDofs,
    evaluateAt,
  };
}

export type {
  ContinuousBeamLoad,
  ContinuousBeamModel,
  ContinuousBeamResponse,
  ContinuousBeamSolution,
  ContinuousNodeSupport,
  ElementEndForces,
  NodeDisplacement,
  NodeReaction,
  SpanAppliedMoment,
  SpanDistributedLoad,
  SpanPointLoad,
} from "./types";
