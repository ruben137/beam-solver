"use client";

import { useState } from "react";
import "./i18n-client";
import BeamCalculator from "./beam-calculator";
import ContinuousBeamCalculator from "./continuous-beam-calculator";

export default function CalculatorShell() {
  const [mode, setMode] = useState<"single" | "continuous">("single");
  return mode === "single"
    ? <BeamCalculator onSwitchMode={() => setMode("continuous")} />
    : <ContinuousBeamCalculator onSwitchMode={() => setMode("single")} />;
}
