import assert from "node:assert/strict";
import test from "node:test";

import { BeamValidationError, solveBeam, solveSimplySupportedBeam } from "../lib/beam/solver.ts";

const closeTo = (actual: number, expected: number, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Se esperaba ${expected}, se obtuvo ${actual}`,
  );
};

test("carga puntual centrada: reacciones, momento y flecha clásicos", () => {
  const length = 10;
  const force = 1_000;
  const elasticModulus = 200e9;
  const secondMomentOfArea = 8e-6;
  const solution = solveSimplySupportedBeam({
    length,
    elasticModulus,
    secondMomentOfArea,
    loads: [{ type: "point", magnitude: force, position: length / 2 }],
  });

  closeTo(solution.reactions.left, force / 2);
  closeTo(solution.reactions.right, force / 2);
  closeTo(solution.evaluateAt(length / 2).moment, force * length / 4);
  closeTo(
    solution.evaluateAt(length / 2).deflection,
    -force * length ** 3 / (48 * elasticModulus * secondMomentOfArea),
  );
  closeTo(solution.evaluateAt(0).deflection, 0);
  closeTo(solution.evaluateAt(length).deflection, 0, 1e-15);
});

test("carga uniforme: reacciones, momento y flecha clásicos", () => {
  const length = 6;
  const intensity = 2_000;
  const elasticModulus = 210e9;
  const secondMomentOfArea = 12e-6;
  const solution = solveSimplySupportedBeam({
    length,
    elasticModulus,
    secondMomentOfArea,
    loads: [{ type: "uniform", intensity }],
  });

  closeTo(solution.reactions.left, intensity * length / 2);
  closeTo(solution.reactions.right, intensity * length / 2);
  closeTo(solution.evaluateAt(length / 2).moment, intensity * length ** 2 / 8);
  closeTo(
    solution.evaluateAt(length / 2).deflection,
    -5 * intensity * length ** 4 / (384 * elasticModulus * secondMomentOfArea),
  );
});

test("superpone varias cargas y conserva el equilibrio global", () => {
  const solution = solveSimplySupportedBeam({
    length: 8,
    elasticModulus: 200e9,
    secondMomentOfArea: 10e-6,
    loads: [
      { type: "point", magnitude: 4_000, position: 2 },
      { type: "point", magnitude: 6_000, position: 6 },
      { type: "uniform", intensity: 1_000 },
    ],
  });

  closeTo(solution.reactions.left + solution.reactions.right, 18_000);
  closeTo(solution.reactions.right * 8, 4_000 * 2 + 6_000 * 6 + 8_000 * 4);
  closeTo(solution.evaluateAt(0).moment, 0);
  closeTo(solution.evaluateAt(8).moment, 0);
  closeTo(solution.evaluateAt(8).deflection, 0, 1e-15);
});

test("rechaza geometría, propiedades y posiciones inválidas", () => {
  assert.throws(
    () =>
      solveSimplySupportedBeam({
        length: 0,
        elasticModulus: -1,
        secondMomentOfArea: 0,
        loads: [{ type: "point", magnitude: 1, position: 2 }],
      }),
    BeamValidationError,
  );
});

test("carga puntual descentrada: obtiene las reacciones por equilibrio", () => {
  const force = 12_000;
  const length = 9;
  const position = 3;
  const solution = solveSimplySupportedBeam({
    length,
    elasticModulus: 200e9,
    secondMomentOfArea: 9e-6,
    loads: [{ type: "point", magnitude: force, position }],
  });

  closeTo(solution.reactions.left, force * (length - position) / length);
  closeTo(solution.reactions.right, force * position / length);
  closeTo(solution.evaluateAt(position).moment, solution.reactions.left * position);
});

test("representa ambos lados del salto de cortante en una carga puntual", () => {
  const solution = solveSimplySupportedBeam({
    length: 10,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    loads: [{ type: "point", magnitude: 1_000, position: 2 }],
  });

  const leftFace = solution.evaluateAt(2, "left").shear;
  const rightFace = solution.evaluateAt(2, "right").shear;
  closeTo(leftFace - rightFace, 1_000);
  closeTo(solution.extremes.maximumAbsoluteShear.value, leftFace);
});

test("cumple dM/dx = V lejos de discontinuidades", () => {
  const solution = solveSimplySupportedBeam({
    length: 7,
    elasticModulus: 205e9,
    secondMomentOfArea: 7e-6,
    loads: [
      { type: "point", magnitude: 2_500, position: 2 },
      { type: "uniform", intensity: 700 },
    ],
  });
  const x = 4;
  const step = 1e-5;
  const momentDerivative =
    (solution.evaluateAt(x + step).moment - solution.evaluateAt(x - step).moment) / (2 * step);

  closeTo(momentDerivative, solution.evaluateAt(x).shear, 1e-5);
});

test("cumple EI por la segunda derivada de la deflexión igual a M", () => {
  const elasticModulus = 190e9;
  const secondMomentOfArea = 11e-6;
  const solution = solveSimplySupportedBeam({
    length: 8,
    elasticModulus,
    secondMomentOfArea,
    loads: [
      { type: "point", magnitude: 3_000, position: 5 },
      { type: "uniform", intensity: 400 },
    ],
  });
  const x = 3;
  const step = 1e-3;
  const secondDerivative =
    (solution.evaluateAt(x + step).deflection -
      2 * solution.evaluateAt(x).deflection +
      solution.evaluateAt(x - step).deflection) /
    step ** 2;

  closeTo(
    elasticModulus * secondMomentOfArea * secondDerivative,
    solution.evaluateAt(x).moment,
    1e-3,
  );
});

test("la pendiente es la derivada de la deflexión", () => {
  const solution = solveSimplySupportedBeam({
    length: 5,
    elasticModulus: 210e9,
    secondMomentOfArea: 5e-6,
    loads: [{ type: "uniform", intensity: 1_200 }],
  });
  const x = 1.75;
  const step = 1e-5;
  const deflectionDerivative =
    (solution.evaluateAt(x + step).deflection - solution.evaluateAt(x - step).deflection) /
    (2 * step);

  closeTo(deflectionDerivative, solution.evaluateAt(x).slope, 1e-10);
});

test("una carga simétrica produce pendiente nula y máximos en el centro", () => {
  const solution = solveSimplySupportedBeam({
    length: 6,
    elasticModulus: 200e9,
    secondMomentOfArea: 6e-6,
    loads: [
      { type: "point", magnitude: 2_000, position: 1.5 },
      { type: "point", magnitude: 2_000, position: 4.5 },
    ],
  });

  closeTo(solution.evaluateAt(3).slope, 0, 1e-15);
  // El momento máximo es una meseta entre las dos cargas, no un único punto.
  closeTo(solution.extremes.maximumAbsoluteMoment.value, 3_000, 1e-9);
  assert.ok(solution.extremes.maximumAbsoluteMoment.x >= 1.5);
  assert.ok(solution.extremes.maximumAbsoluteMoment.x <= 4.5);
  closeTo(solution.extremes.maximumAbsoluteDeflection.x, 3, 1e-12);
});

test("la respuesta combinada es igual a la suma de respuestas individuales", () => {
  const base = { length: 10, elasticModulus: 200e9, secondMomentOfArea: 8e-6 };
  const point = solveSimplySupportedBeam({
    ...base,
    loads: [{ type: "point", magnitude: 2_000, position: 4 }],
  });
  const uniform = solveSimplySupportedBeam({
    ...base,
    loads: [{ type: "uniform", intensity: 300 }],
  });
  const combined = solveSimplySupportedBeam({
    ...base,
    loads: [
      { type: "point", magnitude: 2_000, position: 4 },
      { type: "uniform", intensity: 300 },
    ],
  });
  const x = 6.25;

  closeTo(combined.evaluateAt(x).shear, point.evaluateAt(x).shear + uniform.evaluateAt(x).shear);
  closeTo(combined.evaluateAt(x).moment, point.evaluateAt(x).moment + uniform.evaluateAt(x).moment);
  closeTo(
    combined.evaluateAt(x).deflection,
    point.evaluateAt(x).deflection + uniform.evaluateAt(x).deflection,
    1e-15,
  );
});

test("sin cargas devuelve una viga en reposo", () => {
  const solution = solveSimplySupportedBeam({
    length: 4,
    elasticModulus: 200e9,
    secondMomentOfArea: 4e-6,
    loads: [],
  });

  assert.deepEqual(solution.reactions, { left: 0, right: 0 });
  for (const response of solution.sample(5)) {
    closeTo(response.shear, 0);
    closeTo(response.moment, 0);
    closeTo(response.slope, 0);
    closeTo(response.deflection, 0);
  }
});

test("valida posiciones de evaluación y tamaños de muestreo", () => {
  const solution = solveSimplySupportedBeam({
    length: 4,
    elasticModulus: 200e9,
    secondMomentOfArea: 4e-6,
    loads: [],
  });

  assert.throws(() => solution.evaluateAt(-0.1), BeamValidationError);
  assert.throws(() => solution.evaluateAt(4.1), BeamValidationError);
  assert.throws(() => solution.sample(1), BeamValidationError);
  assert.throws(() => solution.sample(10_002), BeamValidationError);
});

test("voladizo izquierdo con carga en el extremo: reacciones y flecha clásicas", () => {
  const length = 4;
  const force = 5_000;
  const elasticModulus = 200e9;
  const secondMomentOfArea = 6e-6;
  const solution = solveBeam({
    length,
    elasticModulus,
    secondMomentOfArea,
    support: "cantilever-left",
    loads: [{ type: "point", magnitude: force, position: length }],
  });

  closeTo(solution.reactions.left, force);
  closeTo(solution.reactions.right, 0);
  closeTo(solution.reactions.leftMoment ?? 0, force * length);
  closeTo(solution.evaluateAt(0).moment, -force * length);
  closeTo(solution.evaluateAt(0).slope, 0);
  closeTo(solution.evaluateAt(0).deflection, 0);
  closeTo(
    solution.evaluateAt(length).deflection,
    -force * length ** 3 / (3 * elasticModulus * secondMomentOfArea),
    1e-15,
  );
});

test("voladizo izquierdo con carga uniforme: flecha clásica en el extremo", () => {
  const length = 5;
  const intensity = 1_200;
  const elasticModulus = 210e9;
  const secondMomentOfArea = 9e-6;
  const solution = solveBeam({
    length,
    elasticModulus,
    secondMomentOfArea,
    support: "cantilever-left",
    loads: [{ type: "uniform", intensity }],
  });

  closeTo(solution.reactions.left, intensity * length);
  closeTo(solution.reactions.leftMoment ?? 0, intensity * length ** 2 / 2);
  closeTo(
    solution.evaluateAt(length).deflection,
    -intensity * length ** 4 / (8 * elasticModulus * secondMomentOfArea),
    1e-15,
  );
});

test("voladizo derecho satisface las condiciones del empotramiento", () => {
  const length = 3;
  const force = 2_000;
  const elasticModulus = 200e9;
  const secondMomentOfArea = 5e-6;
  const solution = solveBeam({
    length,
    elasticModulus,
    secondMomentOfArea,
    support: "cantilever-right",
    loads: [{ type: "point", magnitude: force, position: 0 }],
  });

  closeTo(solution.reactions.right, force);
  closeTo(solution.reactions.rightMoment ?? 0, -force * length);
  closeTo(solution.evaluateAt(length).slope, 0, 1e-15);
  closeTo(solution.evaluateAt(length).deflection, 0, 1e-15);
  closeTo(
    solution.evaluateAt(0).deflection,
    -force * length ** 3 / (3 * elasticModulus * secondMomentOfArea),
    1e-15,
  );
});

test("carga uniforme parcial usa su resultante y centroide", () => {
  const solution = solveBeam({
    length: 8,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    support: "simply-supported",
    loads: [{
      type: "linear-distributed",
      startPosition: 2,
      endPosition: 6,
      startIntensity: 1_000,
      endIntensity: 1_000,
    }],
  });

  closeTo(solution.reactions.left, 2_000);
  closeTo(solution.reactions.right, 2_000);
  closeTo(solution.evaluateAt(8).moment, 0, 1e-9);
  closeTo(solution.evaluateAt(0).deflection, 0);
  closeTo(solution.evaluateAt(8).deflection, 0, 1e-15);
});

test("carga triangular completa produce las reacciones analíticas", () => {
  const length = 6;
  const peakIntensity = 3_000;
  const solution = solveBeam({
    length,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    support: "simply-supported",
    loads: [{
      type: "linear-distributed",
      startPosition: 0,
      endPosition: length,
      startIntensity: 0,
      endIntensity: peakIntensity,
    }],
  });

  closeTo(solution.reactions.left, peakIntensity * length / 6);
  closeTo(solution.reactions.right, peakIntensity * length / 3);
  closeTo(solution.evaluateAt(length).moment, 0, 1e-9);
});

test("momento puntual genera reacciones opuestas y salto de momento", () => {
  const length = 10;
  const appliedMoment = 20_000;
  const position = 4;
  const solution = solveBeam({
    length,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    support: "simply-supported",
    loads: [{ type: "moment", magnitude: appliedMoment, position }],
  });

  closeTo(solution.reactions.left, appliedMoment / length);
  closeTo(solution.reactions.right, -appliedMoment / length);
  closeTo(
    solution.evaluateAt(position, "left").moment - solution.evaluateAt(position, "right").moment,
    appliedMoment,
  );
  closeTo(solution.evaluateAt(0).moment, 0);
  closeTo(solution.evaluateAt(length).moment, 0);
});

test("rechaza tramos distribuidos inválidos", () => {
  assert.throws(
    () => solveBeam({
      length: 5,
      elasticModulus: 200e9,
      secondMomentOfArea: 8e-6,
      support: "simply-supported",
      loads: [{
        type: "linear-distributed",
        startPosition: 4,
        endPosition: 2,
        startIntensity: 1_000,
        endIntensity: -1,
      }],
    }),
    BeamValidationError,
  );
});

test("carga trapezoidal parcial produce las reacciones de su resultante", () => {
  const length = 10;
  const start = 2;
  const end = 8;
  const startIntensity = 1_000;
  const endIntensity = 3_000;
  const loadedSpan = end - start;
  const gradient = (endIntensity - startIntensity) / loadedSpan;
  const resultant = startIntensity * loadedSpan + gradient * loadedSpan ** 2 / 2;
  const firstMoment =
    start * resultant + startIntensity * loadedSpan ** 2 / 2 + gradient * loadedSpan ** 3 / 3;
  const solution = solveBeam({
    length,
    elasticModulus: 200e9,
    secondMomentOfArea: 10e-6,
    support: "simply-supported",
    loads: [{
      type: "linear-distributed",
      startPosition: start,
      endPosition: end,
      startIntensity,
      endIntensity,
    }],
  });

  closeTo(solution.reactions.right, firstMoment / length);
  closeTo(solution.reactions.left, resultant - firstMoment / length);
  closeTo(solution.reactions.left + solution.reactions.right, resultant);
  closeTo(solution.evaluateAt(length).moment, 0, 1e-9);
});

test("carga triangular decreciente tiene su centroide a un tercio del tramo", () => {
  const length = 9;
  const peakIntensity = 4_000;
  const resultant = peakIntensity * length / 2;
  const solution = solveBeam({
    length,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    support: "simply-supported",
    loads: [{
      type: "linear-distributed",
      startPosition: 0,
      endPosition: length,
      startIntensity: peakIntensity,
      endIntensity: 0,
    }],
  });

  closeTo(solution.reactions.right, resultant / 3);
  closeTo(solution.reactions.left, 2 * resultant / 3);
});

test("momento en el extremo libre de un voladizo izquierdo", () => {
  const length = 4;
  const appliedMoment = 12_000;
  const elasticModulus = 200e9;
  const secondMomentOfArea = 5e-6;
  const solution = solveBeam({
    length,
    elasticModulus,
    secondMomentOfArea,
    support: "cantilever-left",
    loads: [{ type: "moment", magnitude: appliedMoment, position: length }],
  });

  closeTo(solution.reactions.left, 0);
  closeTo(solution.reactions.leftMoment ?? 0, -appliedMoment);
  closeTo(solution.evaluateAt(0).moment, appliedMoment);
  closeTo(solution.evaluateAt(length, "right").moment, 0);
  closeTo(
    solution.evaluateAt(length).slope,
    appliedMoment * length / (elasticModulus * secondMomentOfArea),
    1e-15,
  );
  closeTo(
    solution.evaluateAt(length).deflection,
    appliedMoment * length ** 2 / (2 * elasticModulus * secondMomentOfArea),
    1e-15,
  );
});

test("momento en el extremo libre de un voladizo derecho", () => {
  const length = 4;
  const appliedMoment = 12_000;
  const elasticModulus = 200e9;
  const secondMomentOfArea = 5e-6;
  const solution = solveBeam({
    length,
    elasticModulus,
    secondMomentOfArea,
    support: "cantilever-right",
    loads: [{ type: "moment", magnitude: appliedMoment, position: 0 }],
  });

  closeTo(solution.reactions.right, 0);
  closeTo(solution.reactions.rightMoment ?? 0, -appliedMoment);
  closeTo(solution.evaluateAt(0, "left").moment, 0);
  closeTo(solution.evaluateAt(0, "right").moment, -appliedMoment);
  closeTo(solution.evaluateAt(length).slope, 0, 1e-15);
  closeTo(solution.evaluateAt(length).deflection, 0, 1e-15);
  closeTo(
    solution.evaluateAt(0).deflection,
    -appliedMoment * length ** 2 / (2 * elasticModulus * secondMomentOfArea),
    1e-15,
  );
});

test("superposición mixta conserva cortante, momento y deflexión en un voladizo", () => {
  const base = {
    length: 7,
    elasticModulus: 195e9,
    secondMomentOfArea: 7e-6,
    support: "cantilever-left" as const,
  };
  const pointLoad = { type: "point" as const, magnitude: 3_000, position: 5 };
  const trapezoid = {
    type: "linear-distributed" as const,
    startPosition: 1,
    endPosition: 6,
    startIntensity: 250,
    endIntensity: 900,
  };
  const moment = { type: "moment" as const, magnitude: -4_000, position: 4 };
  const individual = [pointLoad, trapezoid, moment].map((load) =>
    solveBeam({ ...base, loads: [load] }),
  );
  const combined = solveBeam({ ...base, loads: [pointLoad, trapezoid, moment] });
  const x = 5.5;
  const sum = (field: "shear" | "moment" | "slope" | "deflection") =>
    individual.reduce((total, solution) => total + solution.evaluateAt(x)[field], 0);

  closeTo(combined.evaluateAt(x).shear, sum("shear"), 1e-9);
  closeTo(combined.evaluateAt(x).moment, sum("moment"), 1e-9);
  closeTo(combined.evaluateAt(x).slope, sum("slope"), 1e-15);
  closeTo(combined.evaluateAt(x).deflection, sum("deflection"), 1e-15);
});

test("cumple dV/dx = -q(x) dentro de una carga trapezoidal", () => {
  const start = 1;
  const end = 7;
  const startIntensity = 500;
  const endIntensity = 2_000;
  const solution = solveBeam({
    length: 8,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    support: "cantilever-left",
    loads: [{
      type: "linear-distributed",
      startPosition: start,
      endPosition: end,
      startIntensity,
      endIntensity,
    }],
  });
  const x = 4.25;
  const step = 1e-5;
  const expectedIntensity =
    startIntensity + (endIntensity - startIntensity) * (x - start) / (end - start);
  const shearDerivative =
    (solution.evaluateAt(x + step).shear - solution.evaluateAt(x - step).shear) / (2 * step);

  closeTo(shearDerivative, -expectedIntensity, 1e-5);
});

test("cumple las relaciones diferenciales en un voladizo derecho con cargas mixtas", () => {
  const elasticModulus = 205e9;
  const secondMomentOfArea = 12e-6;
  const solution = solveBeam({
    length: 9,
    elasticModulus,
    secondMomentOfArea,
    support: "cantilever-right",
    loads: [
      { type: "point", magnitude: 1_800, position: 2 },
      {
        type: "linear-distributed",
        startPosition: 3,
        endPosition: 8,
        startIntensity: 400,
        endIntensity: 1_100,
      },
      { type: "moment", magnitude: 2_500, position: 7 },
    ],
  });
  const x = 5;
  const firstStep = 1e-5;
  const secondStep = 1e-3;
  const momentDerivative =
    (solution.evaluateAt(x + firstStep).moment - solution.evaluateAt(x - firstStep).moment) /
    (2 * firstStep);
  const deflectionSecondDerivative =
    (solution.evaluateAt(x + secondStep).deflection -
      2 * solution.evaluateAt(x).deflection +
      solution.evaluateAt(x - secondStep).deflection) /
    secondStep ** 2;

  closeTo(momentDerivative, solution.evaluateAt(x).shear, 1e-5);
  closeTo(
    elasticModulus * secondMomentOfArea * deflectionSecondDerivative,
    solution.evaluateAt(x).moment,
    1e-3,
  );
});

test("las tres configuraciones satisfacen sus condiciones cinemáticas de borde", () => {
  const common = {
    length: 6,
    elasticModulus: 200e9,
    secondMomentOfArea: 8e-6,
    loads: [
      { type: "point" as const, magnitude: 2_000, position: 2 },
      {
        type: "linear-distributed" as const,
        startPosition: 1,
        endPosition: 5,
        startIntensity: 300,
        endIntensity: 700,
      },
      { type: "moment" as const, magnitude: -1_500, position: 4 },
    ],
  };
  const simple = solveBeam({ ...common, support: "simply-supported" });
  const left = solveBeam({ ...common, support: "cantilever-left" });
  const right = solveBeam({ ...common, support: "cantilever-right" });

  closeTo(simple.evaluateAt(0).deflection, 0, 1e-15);
  closeTo(simple.evaluateAt(common.length).deflection, 0, 1e-15);
  closeTo(left.evaluateAt(0).slope, 0, 1e-15);
  closeTo(left.evaluateAt(0).deflection, 0, 1e-15);
  closeTo(right.evaluateAt(common.length).slope, 0, 1e-15);
  closeTo(right.evaluateAt(common.length).deflection, 0, 1e-15);
});
