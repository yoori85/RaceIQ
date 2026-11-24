import type { TelemetryPacket } from "@raceiq/shared/telemetry/types";

// Packed little-endian R3E API 3.6, kwstudios-sweden/r3e-api e57a72f.
// The prefix ends after BrakeTemp. The live source never reads the opponent array.
export const RACEROOM_PREFIX_BYTES = 1920;
const HEADER_BYTES = 16;
const LEGACY_MAGIC = 0x36453352; // R3E6
const TREAD_MAGIC = 0x54453352; // R3ET
const MAGIC = 0x53453352; // R3ES
export const R3E = {
  paused: 20, menus: 24, replay: 28, garage: 36, ticks: 44, position: 56,
  localVelocity: 104, localAngularVelocity: 272, localGForce: 296, torque: 336,
  suspensionDeflection: 392,
  trackName: 600, layoutName: 664, layoutId: 732, layoutLength: 736,
  eventIndex: 776, sessionType: 780, sessionIteration: 784, inPitlane: 848,
  racePosition: 988, completedLaps: 1028, lapValid: 1032, lapDistance: 1040,
  bestLap: 1068, lastLap: 1084, currentLap: 1100,
  classId: 1264, modelId: 1268, controlType: 1388, speed: 1392,
  engineRadians: 1396, maxEngineRadians: 1400, gear: 1408, orientation: 1428,
  fuel: 1456, fuelCapacity: 1460, throttle: 1504, brake: 1512, clutch: 1520,
  steer: 1524, tireRotation: 1632, tirePressure: 1712, tireTemperature: 1744, brakeTemperature: 1856,
} as const;

export function isRaceRoomMemory(memory: Buffer): boolean {
  return memory.length >= RACEROOM_PREFIX_BYTES && memory.readInt32LE(0) === 3 &&
    memory.readInt32LE(4) === 6 && memory.readInt32LE(8) === 2008 && memory.readInt32LE(12) === 328;
}

export function encodeRaceRoomFrame(memory: Buffer, time: number, epoch: number): Buffer {
  const frame = Buffer.allocUnsafe(HEADER_BYTES + RACEROOM_PREFIX_BYTES);
  frame.writeUInt32LE(MAGIC, 0);
  frame.writeUInt32LE(epoch, 4);
  frame.writeDoubleLE(time, 8);
  memory.copy(frame, HEADER_BYTES, 0, RACEROOM_PREFIX_BYTES);
  return frame;
}

function frameMemory(frame: Buffer): Buffer | null {
  if (frame.length !== HEADER_BYTES + RACEROOM_PREFIX_BYTES) return null;
  const magic = frame.readUInt32LE(0);
  if (magic !== MAGIC && magic !== TREAD_MAGIC && magic !== LEGACY_MAGIC) return null;
  const memory = frame.subarray(HEADER_BYTES);
  return isRaceRoomMemory(memory) ? memory : null;
}

export function isRaceRoomSessionEnd(frame: Buffer): boolean {
  const memory = frameMemory(frame);
  return memory?.readInt32LE(R3E.menus) === 1 || memory?.readInt32LE(R3E.replay) === 1;
}

function readName(memory: Buffer, offset: number): string {
  return memory.toString("utf8", offset, offset + 64).split("\0", 1)[0]!.trim();
}

export function parseRaceRoomFrame(frame: Buffer): TelemetryPacket | null {
  const memory = frameMemory(frame);
  if (!memory) return null;
  const i = (offset: number) => memory.readInt32LE(offset);
  const f = (offset: number) => memory.readFloatLE(offset);
  const d = (offset: number) => memory.readDoubleLE(offset);
  const finite = (value: number) => Number.isFinite(value) ? value : 0;
  const nonnegative = (value: number) => Math.max(0, finite(value));
  const pedal = (offset: number) => Math.round(Math.min(1, nonnegative(f(offset))) * 255);
  const optional = (value: number) => Number.isFinite(value) && value >= 0 ? value : undefined;
  // Retain the original parser output for already-recorded R3E6 frames.
  const magic = frame.readUInt32LE(0);
  const hasTreadTemperatures = magic !== LEGACY_MAGIC;
  const treadTemperature = (offset: number) => hasTreadTemperatures ? optional(f(offset)) : undefined;
  const suspensionTravelAvailable = magic === MAGIC && [0, 8, 16, 24].every(offset =>
    Number.isFinite(d(R3E.suspensionDeflection + offset)),
  );
  const completed = i(R3E.completedLaps);
  const trackLengthM = f(R3E.layoutLength);
  const lapDistanceM = f(R3E.lapDistance);
  const car = i(R3E.modelId);
  const layout = i(R3E.layoutId);
  const sessionType = i(R3E.sessionType);
  const time = frame.readDoubleLE(8);
  if (i(R3E.paused) || i(R3E.menus) || i(R3E.replay) || i(R3E.garage) || i(R3E.controlType) !== 0 ||
      car <= 0 || layout <= 0 || completed < 0 || sessionType < 0 || sessionType > 3 ||
      !Number.isFinite(time) || nonnegative(trackLengthM) === 0 || !Number.isFinite(lapDistanceM) || lapDistanceM < 0 ||
      [R3E.throttle, R3E.brake, R3E.clutch].some(offset => optional(f(offset)) === undefined) ||
      !Number.isFinite(f(R3E.steer)) || optional(f(R3E.speed)) === undefined) return null;

  const trackName = readName(memory, R3E.trackName);
  const layoutName = readName(memory, R3E.layoutName);
  const gear = i(R3E.gear);
  const yaw = finite(f(R3E.orientation + 4));
  const pressure = (offset: number) => {
    const value = optional(f(offset));
    return value === undefined ? undefined : value / 6.894757;
  };
  return {
    gameId: "raceroom", carId: String(car), trackId: String(layout),
    sessionUID: JSON.stringify([frame.readUInt32LE(4), i(R3E.eventIndex), sessionType, i(R3E.sessionIteration), layout, car]),
    raceroom: { trackName: [trackName, layoutName].filter(Boolean).join(" – "), trackLengthM, lapDistanceM,
      sessionType: ["practice", "qualifying", "race", "warmup"][sessionType]!,
      lapInvalidated: i(R3E.lapValid) === 0, inPits: i(R3E.inPitlane) === 1,
      ...(suspensionTravelAvailable ? { suspensionTravelAvailable: true } : {}) },
    IsRaceOn: 1, TimestampMS: time,
    EngineMaxRpm: nonnegative(f(R3E.maxEngineRadians)) * 30 / Math.PI,
    EngineIdleRpm: 0, CurrentEngineRpm: nonnegative(f(R3E.engineRadians)) * 30 / Math.PI,
    AccelerationX: -finite(d(R3E.localGForce)), AccelerationY: finite(d(R3E.localGForce + 8)),
    AccelerationZ: -finite(d(R3E.localGForce + 16)),
    VelocityX: -finite(d(R3E.localVelocity)), VelocityY: finite(d(R3E.localVelocity + 8)),
    VelocityZ: -finite(d(R3E.localVelocity + 16)),
    AngularVelocityX: -finite(d(R3E.localAngularVelocity)), AngularVelocityY: finite(d(R3E.localAngularVelocity + 8)),
    AngularVelocityZ: -finite(d(R3E.localAngularVelocity + 16)),
    Pitch: finite(f(R3E.orientation)), Yaw: Math.atan2(-Math.sin(yaw), -Math.cos(yaw)), Roll: finite(f(R3E.orientation + 8)),
    NormSuspensionTravelFL: 0, NormSuspensionTravelFR: 0, NormSuspensionTravelRL: 0, NormSuspensionTravelRR: 0,
    TireSlipRatioFL: 0, TireSlipRatioFR: 0, TireSlipRatioRL: 0, TireSlipRatioRR: 0,
    WheelRotationSpeedFL: finite(f(R3E.tireRotation)), WheelRotationSpeedFR: finite(f(R3E.tireRotation + 4)),
    WheelRotationSpeedRL: finite(f(R3E.tireRotation + 8)), WheelRotationSpeedRR: finite(f(R3E.tireRotation + 12)),
    WheelOnRumbleStripFL: 0, WheelOnRumbleStripFR: 0, WheelOnRumbleStripRL: 0, WheelOnRumbleStripRR: 0,
    WheelInPuddleDepthFL: 0, WheelInPuddleDepthFR: 0, WheelInPuddleDepthRL: 0, WheelInPuddleDepthRR: 0,
    SurfaceRumbleFL_2: 0, SurfaceRumbleFR_2: 0, SurfaceRumbleRL_2: 0, SurfaceRumbleRR_2: 0, TireSlipCombinedFL_2: 0,
    TireTempFL: 0, TireTempFR: 0, TireTempRL: 0, TireTempRR: 0,
    // The API labels tread bands left/center/right in car coordinates.
    TireSurfaceTempInnerFL: treadTemperature(R3E.tireTemperature + 8),
    TireSurfaceTempInnerFR: treadTemperature(R3E.tireTemperature + 24),
    TireSurfaceTempInnerRL: treadTemperature(R3E.tireTemperature + 56),
    TireSurfaceTempInnerRR: treadTemperature(R3E.tireTemperature + 72),
    TireSurfaceTempMiddleFL: treadTemperature(R3E.tireTemperature + 4),
    TireSurfaceTempMiddleFR: treadTemperature(R3E.tireTemperature + 28),
    TireSurfaceTempMiddleRL: treadTemperature(R3E.tireTemperature + 52),
    TireSurfaceTempMiddleRR: treadTemperature(R3E.tireTemperature + 76),
    TireSurfaceTempOuterFL: treadTemperature(R3E.tireTemperature),
    TireSurfaceTempOuterFR: treadTemperature(R3E.tireTemperature + 32),
    TireSurfaceTempOuterRL: treadTemperature(R3E.tireTemperature + 48),
    TireSurfaceTempOuterRR: treadTemperature(R3E.tireTemperature + 80),
    TirePressureFrontLeft: pressure(R3E.tirePressure), TirePressureFrontRight: pressure(R3E.tirePressure + 4),
    TirePressureRearLeft: pressure(R3E.tirePressure + 8), TirePressureRearRight: pressure(R3E.tirePressure + 12),
    BrakeTempFrontLeft: optional(f(R3E.brakeTemperature)), BrakeTempFrontRight: optional(f(R3E.brakeTemperature + 16)),
    BrakeTempRearLeft: optional(f(R3E.brakeTemperature + 32)), BrakeTempRearRight: optional(f(R3E.brakeTemperature + 48)),
    Boost: 0, Fuel: nonnegative(f(R3E.fuel)), FuelCapacity: optional(f(R3E.fuelCapacity)),
    DistanceTraveled: completed * trackLengthM + lapDistanceM,
    BestLap: nonnegative(f(R3E.bestLap)), LastLap: nonnegative(f(R3E.lastLap)),
    CurrentLap: nonnegative(f(R3E.currentLap)), CurrentRaceTime: 0,
    LapNumber: completed + 1, RacePosition: Math.max(0, i(R3E.racePosition)),
    Accel: pedal(R3E.throttle), Brake: pedal(R3E.brake), Clutch: pedal(R3E.clutch), HandBrake: 0,
    Gear: gear < 0 ? 0 : gear === 0 ? 11 : gear,
    Steer: Math.round(Math.max(-1, Math.min(1, f(R3E.steer))) * 127),
    NormDrivingLine: 0, NormAIBrakeDiff: 0,
    TireWearFL: 0, TireWearFR: 0, TireWearRL: 0, TireWearRR: 0,
    SurfaceRumbleFL: 0, SurfaceRumbleFR: 0, SurfaceRumbleRL: 0, SurfaceRumbleRR: 0,
    TireSlipAngleFL: 0, TireSlipAngleFR: 0, TireSlipAngleRL: 0, TireSlipAngleRR: 0,
    TireCombinedSlipFL: 0, TireCombinedSlipFR: 0, TireCombinedSlipRL: 0, TireCombinedSlipRR: 0,
    SuspensionTravelMFL: suspensionTravelAvailable ? d(R3E.suspensionDeflection) : 0,
    SuspensionTravelMFR: suspensionTravelAvailable ? d(R3E.suspensionDeflection + 8) : 0,
    SuspensionTravelMRL: suspensionTravelAvailable ? d(R3E.suspensionDeflection + 16) : 0,
    SuspensionTravelMRR: suspensionTravelAvailable ? d(R3E.suspensionDeflection + 24) : 0,
    CarClass: Math.max(0, i(R3E.classId)), CarPerformanceIndex: 0, DrivetrainType: 0, NumCylinders: 0,
    PositionX: finite(d(R3E.position)), PositionY: finite(d(R3E.position + 8)), PositionZ: finite(d(R3E.position + 16)),
    Speed: f(R3E.speed), Power: 0, Torque: finite(d(R3E.torque)),
  };
}

export const raceroomParser = {
  canHandle: (frame: Buffer) => frameMemory(frame) !== null,
  tryParse: parseRaceRoomFrame,
  tryParseLapIndex: parseRaceRoomFrame,
  primeParserState: () => {},
  createParserState: () => null,
};
