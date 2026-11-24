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
  aiSystemPrompt: `You are a RaceRoom driving coach. Use only supplied telemetry. Return JSON matching: ${renderAnalystSchemaForPrompt()}`,
};
