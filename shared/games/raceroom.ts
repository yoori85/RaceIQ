import type { GameAdapter } from "./types";

const unavailable = { source: "unavailable", reason: "source-limitation" } as const;

export const raceroomAdapter: GameAdapter = {
  id: "raceroom",
  displayName: "RaceRoom Racing Experience",
  shortName: "RaceRoom",
  routePrefix: "raceroom",
  coordSystem: "raceroom-world",
  nativeSectors: false,
  appendsDelayedFinishFrame: false,
  authoritativeTrackLength: true,
  steeringCenter: 0,
  steeringRange: 127,
  tireHealthThresholds: { green: 0.85, yellow: 0.7 },
  tireTempThresholds: { cold: 70, warm: 105, hot: 125 },
  suspensionThresholds: { values: [] },
  carForwardOffset: yaw => [Math.sin(yaw), Math.cos(yaw)],
  followViewRotation: yaw => Math.PI - yaw,
  getCarName: id => `RaceRoom car #${id}`,
  getTrackName: id => `RaceRoom layout #${id}`,
  getSharedTrackName: () => undefined,
  telemetry: {
    fuel: { packetUnit: "litre", binding: { kind: "value", semanticId: "fuel.fuel" } },
    tireTemperature: { packetUnit: "celsius" },
    tireSurfaceProfile: {
      source: "direct",
      freshness: "continuous",
      binding: { kind: "group", required: ["tire.temperature.surface.inner", "tire.temperature.surface.middle", "tire.temperature.surface.outer"] },
    },
    brakeTemperature: { packetUnit: "celsius", binding: { kind: "value", semanticId: "brakes.brake-temp" } },
    tirePressure: { packetUnit: "psi", binding: { kind: "value", semanticId: "tires.tire-pressure" } },
    clutch: { source: "direct", freshness: "continuous", binding: { kind: "value", semanticId: "inputs.clutch" } },
    pitStatus: { source: "direct", freshness: "continuous", binding: { kind: "value", semanticId: "race.on-pit-road" } },
    analysis: {
      balance: unavailable, brakeBias: unavailable, gripDemand: unavailable,
      traction: unavailable, tireTemperature: unavailable, surface: unavailable,
      slipRatio: unavailable, slipAngle: unavailable, lateralSlip: unavailable,
      suspensionTravel: { source: "direct", freshness: "continuous", display: "millimeters", binding: { kind: "value", semanticId: "suspension.suspension-travel-m" } },
      suspensionCompressionBias: unavailable,
      tireWearRate: unavailable, tireHealth: unavailable,
      wheelRotation: { source: "direct", freshness: "continuous", display: "per-wheel", binding: { kind: "value", semanticId: "tires.wheel-rotation-speed" } },
      tirePressure: { source: "direct", freshness: "continuous", display: "per-wheel", binding: { kind: "value", semanticId: "tires.tire-pressure" } },
    },
  },
};
