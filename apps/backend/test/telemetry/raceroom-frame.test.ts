import { describe, expect, test } from "bun:test";
import { encodeRaceRoomFrame, isRaceRoomSessionEnd, parseRaceRoomFrame, R3E, RACEROOM_PREFIX_BYTES } from "@raceiq/game-raceroom/frame";
import { LiveTelemetryProjector } from "@raceiq/telemetry-core/telemetry/live-projector";

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
    const { schema, frame } = new LiveTelemetryProjector().project({ packet, receivedAtMs: time });
    const value = (id: string) => frame?.values[schema!.definitions.findIndex(item => item.semanticId === id)];

    expect(schema?.simulator).toBe("raceroom");
    expect(frame?.observedAt).toEqual({ domain: "wall-clock", milliseconds: time });
    expect(value("motion.speed")).toBe(50);
    expect(value("race.on-pit-road")).toBe(true);
    expect(value("timing.track-length")).toBe(4000);
    expect(value("tire.temperature.surface.representative")).toBeNull();
  });
});
