import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRaceRoomCatalog, raceRoomCatalogPaths } from "../src/catalog";

test("resolves model and layout IDs using the installation metadata", () => {
  const catalog = parseRaceRoomCatalog("\uFEFF" + JSON.stringify({
    cars: {
      car: { Id: 10, Name: " Test Car ", Class: 20, liveries: [{ Id: 99 }] },
      invalid: { Id: -1, Name: "Unavailable" },
    },
    classes: { class: { Id: 20, Name: "GT3" } },
    tracks: { circuit: { Id: 30, Name: "Test Circuit" } },
    layouts: {
      west: { Id: 31, Track: 30, Name: "West" },
      east: { Id: 32, Track: 30, Name: "East" },
      orphan: { Id: 33, Track: 100, Name: "Unknown" },
    },
  }));
  expect([...catalog.cars.values()]).toEqual([{ id: "10", name: "Test Car", category: "GT3" }]);
  expect([...catalog.tracks.values()]).toEqual([
    { id: "31", name: "Test Circuit – West", variant: "West" },
    { id: "32", name: "Test Circuit – East", variant: "East" },
  ]);
  expect(() => parseRaceRoomCatalog('{"cars":{}}')).toThrow("Expected a RaceRoom car and layout catalog");
});

test("discovers RaceRoom on a secondary Steam library using escaped paths", () => {
  const root = mkdtempSync(join(tmpdir(), "raceiq-raceroom-catalog-"));
  try {
    const steam = join(root, "Steam Client");
    const library = join(root, "Second Library");
    mkdirSync(join(steam, "steamapps"), { recursive: true });
    mkdirSync(join(library, "steamapps"), { recursive: true });
    const escaped = library.replaceAll("\\", "\\\\");
    writeFileSync(join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders" { "1" { "path" "${escaped}" } }`);
    writeFileSync(join(library, "steamapps", "appmanifest_211500.acf"), '"AppState" { "installdir" "RaceRoom custom folder" }');
    const found = raceRoomCatalogPaths([steam]);
    expect(found).toEqual([join(library, "steamapps", "common", "RaceRoom custom folder", "Game", "GameData", "General", "r3e-data.json")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
