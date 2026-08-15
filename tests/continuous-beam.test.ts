import assert from "node:assert/strict";
import test from "node:test";

import {
  ContinuousBeamValidationError,
  solveContinuousBeam,
} from "../lib/continuous-beam/solver.ts";
import { solveBeam } from "../lib/beam/solver.ts";

const closeTo = (actual: number, expected: number, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Se esperaba ${expected}, se obtuvo ${actual}`);
};

test("un vano simplemente apoyado reproduce una carga puntual centrada", () => {
  const length = 6;
  const force = 10_000;
  const elasticModulus = 200e9;
  const secondMomentOfArea = 8e-6;
  const solution = solveContinuousBeam({
    spans: [length],
    supports: ["simple", "simple"],
    elasticModulus,
    secondMomentOfArea,
    loads: [{ type: "point", spanIndex: 0, magnitude: force, position: length / 2 }],
  });

  closeTo(solution.reactions[0].vertical, force / 2);
  closeTo(solution.reactions[1].vertical, force / 2);
  closeTo(solution.evaluateAt(0, length / 2).moment, force * length / 4);
  closeTo(
    solution.evaluateAt(0, length / 2).deflection,
    -force * length ** 3 / (48 * elasticModulus * secondMomentOfArea),
    1e-12,
  );
});

test("un vano simplemente apoyado reproduce una carga uniforme", () => {
  const length = 5;
  const intensity = 2_000;
  const elasticModulus = 210e9;
  const secondMomentOfArea = 9e-6;
  const solution = solveContinuousBeam({
    spans: [length],
    supports: ["simple", "simple"],
    elasticModulus,
    secondMomentOfArea,
    loads: [{
      type: "linear-distributed",
      spanIndex: 0,
      startPosition: 0,
      endPosition: length,
      startIntensity: intensity,
      endIntensity: intensity,
    }],
  });

  closeTo(solution.reactions[0].vertical, intensity * length / 2);
  closeTo(solution.reactions[1].vertical, intensity * length / 2);
  closeTo(solution.evaluateAt(0, length / 2).moment, intensity * length ** 2 / 8);
  closeTo(
    solution.evaluateAt(0, length / 2).deflection,
    -5 * intensity * length ** 4 / (384 * elasticModulus * secondMomentOfArea),
    1e-12,
  );
});

test("un elemento fijo-libre reproduce el voladizo con carga de extremo", () => {
  const length = 4;
  const force = 6_000;
  const elasticModulus = 200e9;
  const secondMomentOfArea = 7e-6;
  const solution = solveContinuousBeam({
    spans: [length],
    supports: ["fixed", "free"],
    elasticModulus,
    secondMomentOfArea,
    loads: [{ type: "point", spanIndex: 0, magnitude: force, position: length }],
  });

  closeTo(solution.reactions[0].vertical, force);
  closeTo(solution.reactions[0].moment, force * length);
  closeTo(solution.displacements[0].vertical, 0);
  closeTo(solution.displacements[0].rotation, 0);
  closeTo(
    solution.displacements[1].vertical,
    -force * length ** 3 / (3 * elasticModulus * secondMomentOfArea),
    1e-12,
  );
});

test("dos vanos iguales con carga uniforme producen la solución continua clásica", () => {
  const span = 5;
  const intensity = 3_000;
  const solution = solveContinuousBeam({
    spans: [span, span],
    supports: ["simple", "simple", "simple"],
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    loads: [0, 1].map((spanIndex) => ({
      type: "linear-distributed" as const,
      spanIndex,
      startPosition: 0,
      endPosition: span,
      startIntensity: intensity,
      endIntensity: intensity,
    })),
  });

  closeTo(solution.reactions[0].vertical, 3 * intensity * span / 8, 1e-8);
  closeTo(solution.reactions[1].vertical, 5 * intensity * span / 4, 1e-8);
  closeTo(solution.reactions[2].vertical, 3 * intensity * span / 8, 1e-8);
  closeTo(solution.evaluateAt(0, span).moment, -intensity * span ** 2 / 8, 1e-8);
  closeTo(solution.evaluateAt(1, 0).moment, -intensity * span ** 2 / 8, 1e-8);
});

test("tres vanos ensamblan ocho grados de libertad y conservan equilibrio", () => {
  const solution = solveContinuousBeam({
    spans: [4, 5, 3],
    supports: ["simple", "simple", "simple", "simple"],
    elasticModulus: 205e9,
    secondMomentOfArea: 10e-6,
    loads: [
      { type: "point", spanIndex: 0, magnitude: 4_000, position: 1.5 },
      { type: "linear-distributed", spanIndex: 1, startPosition: 1, endPosition: 4, startIntensity: 1_000, endIntensity: 2_000 },
      { type: "moment", spanIndex: 2, magnitude: 3_000, position: 2 },
    ],
  });

  assert.equal(solution.stiffnessMatrix.length, 8);
  assert.equal(solution.restrainedDofs.length, 4);
  assert.equal(solution.freeDofs.length, 4);
  closeTo(
    solution.reactions.reduce((sum, reaction) => sum + reaction.vertical, 0),
    4_000 + (1_000 + 2_000) * 3 / 2,
    1e-7,
  );
  solution.displacements.forEach((displacement) => closeTo(displacement.vertical, 0, 1e-15));
});

test("un momento puntual genera el salto correcto en un vano", () => {
  const moment = 12_000;
  const position = 2;
  const solution = solveContinuousBeam({
    spans: [6],
    supports: ["simple", "simple"],
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    loads: [{ type: "moment", spanIndex: 0, magnitude: moment, position }],
  });

  closeTo(solution.evaluateAt(0, position, "left").moment - solution.evaluateAt(0, position, "right").moment, moment);
  closeTo(solution.reactions[0].vertical, moment / 6);
  closeTo(solution.reactions[1].vertical, -moment / 6);
});

test("rechaza mecanismos y modelos fuera del alcance", () => {
  assert.throws(
    () => solveContinuousBeam({
      spans: [4],
      supports: ["free", "free"],
      elasticModulus: 200e9,
      secondMomentOfArea: 8e-6,
      loads: [],
    }),
    ContinuousBeamValidationError,
  );
  assert.throws(
    () => solveContinuousBeam({
      spans: [2, 2, 2, 2],
      supports: ["simple", "simple", "simple", "simple", "simple"],
      elasticModulus: 200e9,
      secondMomentOfArea: 8e-6,
      loads: [],
    }),
    ContinuousBeamValidationError,
  );
});

test("una carga trapezoidal parcial coincide con el solver analítico", () => {
  const length = 8;
  const elasticModulus = 195e9;
  const secondMomentOfArea = 11e-6;
  const load = {
    startPosition: 1.5,
    endPosition: 6.5,
    startIntensity: 700,
    endIntensity: 2_300,
  };
  const matrixSolution = solveContinuousBeam({
    spans: [length],
    supports: ["simple", "simple"],
    elasticModulus,
    secondMomentOfArea,
    loads: [{ type: "linear-distributed", spanIndex: 0, ...load }],
  });
  const analyticSolution = solveBeam({
    length,
    support: "simply-supported",
    elasticModulus,
    secondMomentOfArea,
    loads: [{ type: "linear-distributed", ...load }],
  });

  closeTo(matrixSolution.reactions[0].vertical, analyticSolution.reactions.left, 1e-8);
  closeTo(matrixSolution.reactions[1].vertical, analyticSolution.reactions.right, 1e-8);
  for (const x of [0.75, 2.5, 4.75, 7.25]) {
    const matrix = matrixSolution.evaluateAt(0, x);
    const analytic = analyticSolution.evaluateAt(x);
    closeTo(matrix.shear, analytic.shear, 1e-8);
    closeTo(matrix.moment, analytic.moment, 1e-8);
    closeTo(matrix.slope, analytic.slope, 1e-12);
    closeTo(matrix.deflection, analytic.deflection, 1e-12);
  }
});

test("la matriz global ensamblada es simétrica", () => {
  const solution = solveContinuousBeam({
    spans: [3, 5, 4],
    supports: ["fixed", "free", "simple", "simple"],
    elasticModulus: 200e9,
    secondMomentOfArea: 9e-6,
    loads: [{ type: "point", spanIndex: 1, magnitude: 3_000, position: 2 }],
  });

  solution.stiffnessMatrix.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      closeTo(value, solution.stiffnessMatrix[columnIndex][rowIndex], 1e-9);
    });
  });
});

test("desplazamiento, giro y momento son compatibles en nudos interiores", () => {
  const solution = solveContinuousBeam({
    spans: [4, 6, 3],
    supports: ["simple", "simple", "free", "simple"],
    elasticModulus: 205e9,
    secondMomentOfArea: 10e-6,
    loads: [
      { type: "point", spanIndex: 0, magnitude: 5_000, position: 2 },
      { type: "linear-distributed", spanIndex: 1, startPosition: 0.5, endPosition: 5.5, startIntensity: 400, endIntensity: 1_500 },
      { type: "moment", spanIndex: 2, magnitude: -2_000, position: 1 },
    ],
  });

  for (let spanIndex = 0; spanIndex < 2; spanIndex += 1) {
    const leftElementEnd = solution.evaluateAt(spanIndex, [4, 6][spanIndex]);
    const rightElementStart = solution.evaluateAt(spanIndex + 1, 0);
    closeTo(leftElementEnd.deflection, rightElementStart.deflection, 1e-13);
    closeTo(leftElementEnd.slope, rightElementStart.slope, 1e-13);
    closeTo(leftElementEnd.moment, rightElementStart.moment, 1e-8);
  }
});

test("viga biempotrada con carga uniforme reproduce fuerzas de extremo clásicas", () => {
  const length = 6;
  const intensity = 2_400;
  const solution = solveContinuousBeam({
    spans: [length],
    supports: ["fixed", "fixed"],
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    loads: [{ type: "linear-distributed", spanIndex: 0, startPosition: 0, endPosition: length, startIntensity: intensity, endIntensity: intensity }],
  });

  closeTo(solution.reactions[0].vertical, intensity * length / 2);
  closeTo(solution.reactions[1].vertical, intensity * length / 2);
  closeTo(solution.reactions[0].moment, intensity * length ** 2 / 12);
  closeTo(solution.reactions[1].moment, -intensity * length ** 2 / 12);
  closeTo(solution.evaluateAt(0, 0).moment, -intensity * length ** 2 / 12);
  closeTo(solution.evaluateAt(0, length).moment, -intensity * length ** 2 / 12);
});

test("una combinación asimétrica de tres vanos satisface equilibrio global", () => {
  const spans = [4, 5, 3];
  const nodePositions = [0, 4, 9, 12];
  const pointForce = 4_000;
  const pointGlobalX = 1.5;
  const distributedForce = (600 + 1_800) * 4 / 2;
  const gradient = (1_800 - 600) / 4;
  const distributedLocalMoment = 600 * 4 ** 2 / 2 + gradient * 4 ** 3 / 3;
  const distributedCentroid = distributedLocalMoment / distributedForce;
  const distributedGlobalX = 4.5 + distributedCentroid;
  const appliedMoment = -3_500;
  const solution = solveContinuousBeam({
    spans,
    supports: ["fixed", "simple", "free", "simple"],
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    loads: [
      { type: "point", spanIndex: 0, magnitude: pointForce, position: pointGlobalX },
      { type: "linear-distributed", spanIndex: 1, startPosition: 0.5, endPosition: 4.5, startIntensity: 600, endIntensity: 1_800 },
      { type: "moment", spanIndex: 2, magnitude: appliedMoment, position: 2 },
    ],
  });

  const verticalBalance = solution.reactions.reduce((sum, reaction) => sum + reaction.vertical, 0);
  const reactionMomentAboutLeft = solution.reactions.reduce(
    (sum, reaction, index) => sum + reaction.vertical * nodePositions[index] + reaction.moment,
    0,
  );
  closeTo(verticalBalance, pointForce + distributedForce, 1e-7);
  closeTo(
    reactionMomentAboutLeft + appliedMoment - pointForce * pointGlobalX - distributedForce * distributedGlobalX,
    0,
    1e-6,
  );
});

test("el motor matricial conserva superposición en desplazamientos y reacciones", () => {
  const base = {
    spans: [4, 5],
    supports: ["fixed", "simple", "simple"] as const,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
  };
  const point = { type: "point" as const, spanIndex: 0, magnitude: 3_000, position: 2.5 };
  const triangle = { type: "linear-distributed" as const, spanIndex: 1, startPosition: 0, endPosition: 5, startIntensity: 0, endIntensity: 1_400 };
  const moment = { type: "moment" as const, spanIndex: 1, magnitude: 2_000, position: 3 };
  const individual = [point, triangle, moment].map((load) => solveContinuousBeam({ ...base, supports: [...base.supports], loads: [load] }));
  const combined = solveContinuousBeam({ ...base, supports: [...base.supports], loads: [point, triangle, moment] });

  combined.displacements.forEach((displacement, nodeIndex) => {
    closeTo(displacement.vertical, individual.reduce((sum, item) => sum + item.displacements[nodeIndex].vertical, 0), 1e-13);
    closeTo(displacement.rotation, individual.reduce((sum, item) => sum + item.displacements[nodeIndex].rotation, 0), 1e-13);
  });
  combined.reactions.forEach((reaction, nodeIndex) => {
    closeTo(reaction.vertical, individual.reduce((sum, item) => sum + item.reactions[nodeIndex].vertical, 0), 1e-8);
    closeTo(reaction.moment, individual.reduce((sum, item) => sum + item.reactions[nodeIndex].moment, 0), 1e-8);
  });
});

test("cumple dM/dx = V y EI v'' = M dentro de un vano continuo", () => {
  const elasticModulus = 200e9;
  const secondMomentOfArea = 9e-6;
  const solution = solveContinuousBeam({
    spans: [5, 4],
    supports: ["simple", "simple", "fixed"],
    elasticModulus,
    secondMomentOfArea,
    loads: [
      { type: "linear-distributed", spanIndex: 0, startPosition: 0, endPosition: 5, startIntensity: 500, endIntensity: 1_500 },
      { type: "point", spanIndex: 1, magnitude: 2_000, position: 3 },
    ],
  });
  const spanIndex = 0;
  const x = 2.25;
  const firstStep = 1e-5;
  const secondStep = 1e-3;
  const momentDerivative = (solution.evaluateAt(spanIndex, x + firstStep).moment - solution.evaluateAt(spanIndex, x - firstStep).moment) / (2 * firstStep);
  const deflectionSecondDerivative = (
    solution.evaluateAt(spanIndex, x + secondStep).deflection -
    2 * solution.evaluateAt(spanIndex, x).deflection +
    solution.evaluateAt(spanIndex, x - secondStep).deflection
  ) / secondStep ** 2;

  closeTo(momentDerivative, solution.evaluateAt(spanIndex, x).shear, 1e-5);
  closeTo(elasticModulus * secondMomentOfArea * deflectionSecondDerivative, solution.evaluateAt(spanIndex, x).moment, 1e-3);
});

test("rechaza cargas con vano, posición o intensidad inválidos", () => {
  const base = {
    spans: [4, 4],
    supports: ["simple", "simple", "simple"] as const,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
  };
  assert.throws(() => solveContinuousBeam({ ...base, supports: [...base.supports], loads: [{ type: "point", spanIndex: 3, magnitude: 1, position: 1 }] }), ContinuousBeamValidationError);
  assert.throws(() => solveContinuousBeam({ ...base, supports: [...base.supports], loads: [{ type: "point", spanIndex: 0, magnitude: 1, position: 5 }] }), ContinuousBeamValidationError);
  assert.throws(() => solveContinuousBeam({ ...base, supports: [...base.supports], loads: [{ type: "linear-distributed", spanIndex: 1, startPosition: 3, endPosition: 2, startIntensity: 1, endIntensity: -1 }] }), ContinuousBeamValidationError);
});
