import { renderAnalystSchemaForPrompt } from "@raceiq/backend-core/ai/schemas";
import type { ServerGameAdapter } from "@raceiq/backend-core/games/types";
import { LapDetector } from "@raceiq/backend-core/lap-detection/detector";
import { raceroomAdapter } from "@raceiq/shared/games/raceroom";
import { DEFAULT_LAP_DETECTOR_POLICY } from "@raceiq/telemetry-core/processor/lap-policy";
import { isRaceRoomSessionEnd, raceroomParser } from "./frame";

export const raceroomServerAdapter: ServerGameAdapter = {
  ...raceroomAdapter,
  ...raceroomParser,
  parserStateIsFrameLocal: true,
  isSessionEndFrame: isRaceRoomSessionEnd,
  processNames: ["RRRE64.exe", "RRRE.exe"],
  runtime: {
    pit: { seedFuelFromHistory: true, seedTireWearFromHistory: false, useDistanceBasedWearCurves: false },
    bestLapFromSession: false,
    requiresTrackCalibration: false,
    normSuspensionTravelMm: { min: 0, max: 100 },
  },
  createLapDetector: options => new LapDetector({
    ...options,
    bypassPacketRateFilter: true,
    policy: {
      ...DEFAULT_LAP_DETECTOR_POLICY,
      invalidReason: packets => packets.some(packet => packet.raceroom?.lapInvalidated) ? "game-invalidated" : null,
    },
  }),
  aiSystemPrompt: `You are a RaceRoom driving coach. Use only supplied telemetry.
When the evidence shows a persistent hot-pressure difference, put a concrete setup test in coaching. Ask the driver to verify both cold settings, repeat clean laps with the baseline setup, and compare hot readings at the same point on track. Reserve setup entries for targets grounded in verified garage settings and adjustment ranges.
Use the following JSON shape.
${renderAnalystSchemaForPrompt()}`,
};
