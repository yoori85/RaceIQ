import type * as BunFFI from "bun:ffi";
import { registerDiscoveredTrack } from "@raceiq/backend-core/db/discovered-tracks";
import { parsePacket } from "@raceiq/backend-core/games/packet-dispatch";
import { lapDetector, processPacket } from "@raceiq/backend-core/telemetry/live-pipeline";
import { encodeRaceRoomFrame, isRaceRoomMemory, isRaceRoomSessionEnd, R3E, RACEROOM_PREFIX_BYTES } from "./frame";

function openRaceRoomMapping() {
  // This source is started only on Windows, where the RaceRoom mapping exists.
  const { dlopen, FFIType: F, ptr } = require("bun:ffi") as typeof BunFFI;
  const library = dlopen("kernel32.dll", {
    OpenFileMappingW: { args: [F.u32, F.bool, F.ptr], returns: F.ptr },
    MapViewOfFile: { args: [F.ptr, F.u32, F.u32, F.u32, F.u64], returns: F.ptr },
    UnmapViewOfFile: { args: [F.ptr], returns: F.bool },
    CloseHandle: { args: [F.ptr], returns: F.bool },
    RtlCopyMemory: { args: [F.ptr, F.ptr, F.u64], returns: F.void },
  });
  const api = library.symbols;
  const name = Buffer.from("$R3E\0", "utf16le");
  const read = 4; // FILE_MAP_READ
  const handle = api.OpenFileMappingW(read, false, ptr(name));
  if (!handle) {
    library.close();
    return null;
  }
  const view = api.MapViewOfFile(handle, read, 0, 0, RACEROOM_PREFIX_BYTES);
  if (!view) {
    api.CloseHandle(handle);
    library.close();
    return null;
  }
  return {
    copy(destination: Buffer) { api.RtlCopyMemory(ptr(destination), view, destination.length); },
    close() {
      api.UnmapViewOfFile(view);
      api.CloseHandle(handle);
      library.close();
    },
  };
}

export class RaceRoomTelemetrySource {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private mapping: ReturnType<typeof openRaceRoomMapping> = null;
  private readonly snapshot = Buffer.alloc(RACEROOM_PREFIX_BYTES);
  private readonly verification = Buffer.alloc(RACEROOM_PREFIX_BYTES);
  private epoch = Date.now() >>> 0;
  private tick: number | undefined;
  private track: string | undefined;
  private retryAt = 0;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.pending) return;
      this.pending = this.poll().catch(error => {
        console.error("[RaceRoom] Telemetry read failed:", error);
        this.mapping?.close();
        this.mapping = null;
        this.retryAt = Date.now() + 2000;
      }).finally(() => { this.pending = undefined; });
    }, 20);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    try {
      await this.pending;
      await this.endSession();
    } finally {
      this.mapping?.close();
      this.mapping = null;
    }
  }

  private async endSession(): Promise<void> {
    if (lapDetector.session?.gameId === "raceroom") await lapDetector.finalizeCurrentSession();
  }

  private async poll(): Promise<void> {
    if (!this.mapping) {
      if (Date.now() < this.retryAt) return;
      this.retryAt = Date.now() + 2000;
      this.mapping = openRaceRoomMapping();
      if (!this.mapping) return;
    }
    this.mapping.copy(this.snapshot);
    this.mapping.copy(this.verification);
    if (!this.snapshot.equals(this.verification) || !isRaceRoomMemory(this.snapshot)) return;

    const time = Date.now();
    const tick = this.snapshot.readInt32LE(R3E.ticks);
    if (this.tick !== undefined && tick < this.tick) this.epoch = (this.epoch + 1) >>> 0;
    const frame = encodeRaceRoomFrame(this.snapshot, time, this.epoch);
    if (isRaceRoomSessionEnd(frame)) {
      if (this.tick !== undefined) this.epoch = (this.epoch + 1) >>> 0;
      this.tick = undefined;
      await this.endSession();
      return;
    }
    if (tick === this.tick) return;
    const packet = parsePacket(frame, time);
    if (!packet?.raceroom) return;
    if (this.track !== packet.trackId && packet.raceroom.trackName) {
      await registerDiscoveredTrack(packet.gameId, packet.trackId, packet.raceroom.trackName);
      this.track = packet.trackId;
    }
    await processPacket(packet, frame, time);
    this.tick = tick;
  }
}
