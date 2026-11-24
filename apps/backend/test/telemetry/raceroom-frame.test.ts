import { describe, expect, test } from "bun:test";
import { encodeRaceRoomFrame, isRaceRoomSessionEnd, parseRaceRoomFrame, R3E, RACEROOM_PREFIX_BYTES } from "@raceiq/game-raceroom/frame";
import { LiveTelemetryProjector } from "@raceiq/telemetry-core/telemetry/live-projector";
import { normalizeTelemetryPacket } from "@raceiq/telemetry-core/telemetry/normalization";
import { raceroomServerAdapter } from "@raceiq/game-raceroom";
import { analyseSemanticIds } from "@raceiq/shared/games/metric-contracts";

function drivingSnapshot() {
  const memory = Buffer.alloc(RACEROOM_PREFIX_BYTES);
  memory.writeInt32LE(3, 0);
  memory.writeInt32LE(6, 4);
  memory.writeInt32LE(2008, 8);
  memory.writeInt32LE(328, 12);
  memory.write("Test Circuit", R3E.trackName);
  memory.write("GP", R3E.layoutName);
  memory.writeInt32LE(42, R3E.layoutId);
  memory.writeInt32LE(97, R3E.modelId);
  memory.writeInt32LE(2, R3E.completedLaps);
  memory.writeInt32LE(2, R3E.sessionType);
  memory.writeInt32LE(1, R3E.inPitlane);
  memory.writeFloatLE(4000, R3E.layoutLength);
  memory.writeFloatLE(300, R3E.lapDistance);
  memory.writeFloatLE(50, R3E.speed);
  memory.writeFloatLE(0.5, R3E.throttle);
  memory.writeFloatLE(0.25, R3E.brake);
  memory.writeFloatLE(-0.5, R3E.steer);
  memory.writeFloatLE(650, R3E.engineRadians);
  memory.writeFloatLE(24, R3E.fuel);
  memory.writeFloatLE(101, R3E.lastLap);
  memory.writeFloatLE(-1, R3E.tirePressure);
  for (const [index, value] of [0.018, -0.009, 0, 0.065].entries()) {
    memory.writeDoubleLE(value, R3E.suspensionDeflection + index * 8);
  }
  for (const [index, value] of [60, 61, 62, 70, 71, 72, 80, 81, 82, 90, -1, 92].entries()) {
    memory.writeFloatLE(value, R3E.tireTemperature + Math.floor(index / 3) * 24 + (index % 3) * 4);
  }
  return memory;
}

describe("RaceRoom 3.6 source frames", () => {
  test("preserve player identity, lap timing and units", () => {
    const frame = encodeRaceRoomFrame(drivingSnapshot(), 123456, 1);
    const packet = parseRaceRoomFrame(frame)!;
    expect(packet).toMatchObject({
      gameId: "raceroom", carId: "97", trackId: "42", TimestampMS: 123456,
      LapNumber: 3, DistanceTraveled: 8300, LastLap: 101, Speed: 50,
      Accel: 128, Brake: 64, Steer: -63, Fuel: 24, Gear: 11,
      raceroom: { trackName: "Test Circuit – GP", sessionType: "race", inPits: true, lapInvalidated: true },
    });
    expect(packet.CurrentEngineRpm).toBeCloseTo(650 * 30 / Math.PI);
    expect(packet.TirePressureFrontLeft).toBeUndefined();
  });

  test("rejects unknown layouts, truncated frames and non-player contexts", () => {
    const memory = drivingSnapshot();
    const frame = () => encodeRaceRoomFrame(memory, 1, 1);
    expect(parseRaceRoomFrame(frame().subarray(0, -1))).toBeNull();
    for (const offset of [R3E.paused, R3E.replay, R3E.garage, R3E.controlType]) {
      memory.writeInt32LE(1, offset);
      expect(parseRaceRoomFrame(frame())).toBeNull();
      memory.writeInt32LE(0, offset);
    }
    memory.writeInt32LE(1, R3E.menus);
    expect(isRaceRoomSessionEnd(frame())).toBe(true);
    expect(parseRaceRoomFrame(frame())).toBeNull();
    memory.writeInt32LE(5, 4);
    expect(isRaceRoomSessionEnd(frame())).toBe(false);
  });

  test("projects native measurements and leaves unsupported dashboard values empty", () => {
    const time = 123456;
    const packet = parseRaceRoomFrame(encodeRaceRoomFrame(drivingSnapshot(), time, 1))!;
    normalizeTelemetryPacket(packet, false, raceroomServerAdapter.runtime.normSuspensionTravelMm);
    const { schema, frame } = new LiveTelemetryProjector().project({ packet, receivedAtMs: time });
    const value = (id: string) => frame?.values[schema!.definitions.findIndex(item => item.semanticId === id)];

    expect(schema?.simulator).toBe("raceroom");
    expect(frame?.observedAt).toEqual({ domain: "wall-clock", milliseconds: time });
    expect(value("motion.speed")).toBe(50);
    expect(value("race.on-pit-road")).toBe(true);
    expect(value("timing.track-length")).toBe(4000);
    expect(value("tire.temperature.surface.inner")).toEqual([62, 70, 82, 90]);
    expect(packet.TireSurfaceTempMiddleFL).toBe(61);
    expect(packet.TireSurfaceTempMiddleRR).toBeUndefined();
    expect(value("tire.temperature.surface.middle")).toBeNull();
    expect(value("tire.temperature.surface.outer")).toEqual([60, 72, 80, 92]);
    expect(value("tire.temperature.surface.representative")).toBeNull();
    expect(value("suspension.suspension-travel-m")).toEqual([0.018, -0.009, 0, 0.065]);
    expect(value("suspension.norm-suspension-travel")).toBeNull();
    expect(packet.NormSuspensionTravelFL).toBe(0);
    expect(analyseSemanticIds(raceroomServerAdapter)).toContain("suspension.suspension-travel-m");
  });

  test("preserves the parser output of previously recorded RaceRoom frames", () => {
    const frame = encodeRaceRoomFrame(drivingSnapshot(), 123456, 1);
    frame.write("R3E6", 0, "ascii");
    const packet = parseRaceRoomFrame(frame)!;
    expect(packet.TireSurfaceTempInnerFL).toBeUndefined();
    expect(packet.TireSurfaceTempOuterRR).toBeUndefined();
    expect(packet.Speed).toBe(50);
  });

  test("keeps suspension unavailable for older or non-finite source snapshots", () => {
    const time = 123456;
    const memory = drivingSnapshot();
    const treadFrame = encodeRaceRoomFrame(memory, time, 1);
    treadFrame.write("R3ET", 0, "ascii");
    expect(parseRaceRoomFrame(treadFrame)?.TireSurfaceTempInnerFL).toBe(62);
    memory.writeDoubleLE(Number.NaN, R3E.suspensionDeflection + 8);
    const invalidFrame = encodeRaceRoomFrame(memory, time, 1);
    for (const source of [treadFrame, invalidFrame]) {
      const packet = parseRaceRoomFrame(source)!;
      const { schema, frame } = new LiveTelemetryProjector().project({ packet, receivedAtMs: time });
      const slot = schema!.definitions.findIndex(item => item.semanticId === "suspension.suspension-travel-m");
      expect(frame?.values[slot]).toBeNull();
      expect(packet.raceroom?.suspensionTravelAvailable).toBeUndefined();
    }
  });
});
