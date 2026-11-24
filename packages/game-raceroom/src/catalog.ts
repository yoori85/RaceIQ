import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalGameCatalog } from "@raceiq/backend-core/games/types";

const APP_MANIFEST = "appmanifest_211500.acf";
const CATALOG_FILE = ["Game", "GameData", "General", "r3e-data.json"];
const LIVERY_CDN = "https://game.raceroomracing.com/cdn/apex-production";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function id(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
}

function catalogEntries(value: unknown) {
  return Object.values(record(value) ?? {}).flatMap(row => {
    const entry = record(row);
    const entryId = id(entry?.Id);
    const name = typeof entry?.Name === "string" ? entry.Name.trim() : "";
    return entryId && name && entry ? [{ id: entryId, name, entry }] : [];
  });
}

export function parseRaceRoomCatalog(contents: string): LocalGameCatalog {
  const root = record(JSON.parse(contents.replace(/^\uFEFF/, "")));
  if (!root || !record(root.cars) || !record(root.tracks) || !record(root.layouts)) {
    throw new Error("Expected a RaceRoom car and layout catalog");
  }
  const circuits = new Map(catalogEntries(root.tracks).map(({ id, name }) => [id, name]));
  const classes = new Map(catalogEntries(root.classes).map(({ id, name }) => [id, name]));
  const liveries = record(root.liveries);
  const cars = new Map(catalogEntries(root.cars).map(({ id: carId, name, entry }) => {
    const defaultLivery = id(entry.DefaultLivery);
    const livery = defaultLivery ? record(liveries?.[defaultLivery]) : undefined;
    const imageUrl = defaultLivery && id(livery?.Car) === carId
      ? `${LIVERY_CDN}/Livery:${defaultLivery}:small.webp`
      : undefined;
    return [carId, { id: carId, name, category: classes.get(id(entry.Class) ?? "") ?? "", imageUrl }] as const;
  }));
  const tracks = new Map(catalogEntries(root.layouts).flatMap(({ id: layoutId, name, entry }) => {
    const circuit = circuits.get(id(entry.Track) ?? "");
    if (!circuit) return [];
    return [[layoutId, { id: layoutId, name: name === circuit ? circuit : `${circuit} – ${name}`, variant: name }] as const];
  }));
  return { cars, tracks };
}

function readText(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); }
  catch { return undefined; }
}

function vdfValues(text: string | undefined, key: "path" | "installdir"): string[] {
  const field = new RegExp(`"${key}"\\s+"((?:\\\\.|[^"\\\\])*)"`, "gi");
  return Array.from((text ?? "").matchAll(field), match => match[1]!.replace(/\\([\\"])/g, "$1"));
}

/** Locate the installed file through Steam's library and application manifests. */
export function raceRoomCatalogPaths(steamRoots: readonly string[]): string[] {
  const libraries = new Set(steamRoots);
  for (const root of steamRoots) {
    for (const path of vdfValues(readText(join(root, "steamapps", "libraryfolders.vdf")), "path")) {
      libraries.add(path);
    }
  }
  const candidates: string[] = [];
  for (const library of libraries) {
    const steamapps = join(library, "steamapps");
    const [installDir] = vdfValues(readText(join(steamapps, APP_MANIFEST)), "installdir");
    if (!installDir || /[\\/:]/.test(installDir) || installDir === "." || installDir === "..") continue;
    candidates.push(join(steamapps, "common", installDir, ...CATALOG_FILE));
  }
  return candidates;
}

let catalog: LocalGameCatalog | null | undefined;

export function getRaceRoomCatalog(): LocalGameCatalog | null {
  if (catalog !== undefined) return catalog;
  const override = process.env.RACEIQ_RACEROOM_CATALOG?.trim();
  const roots = [
    join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Steam"),
    join(process.env.ProgramFiles ?? "C:/Program Files", "Steam"),
  ];
  const paths = override ? [override] : process.platform === "win32" ? raceRoomCatalogPaths(roots) : [];
  for (const path of paths) {
    const contents = readText(path);
    if (!contents) continue;
    try {
      const loaded = parseRaceRoomCatalog(contents);
      console.log(`[RaceRoom] Loaded local catalog with ${loaded.cars.size} cars and ${loaded.tracks.size} layouts`);
      return catalog = loaded;
    } catch {
      console.warn("[RaceRoom] Could not read the local car and layout catalog");
    }
  }
  if (override) console.warn("[RaceRoom] Catalog override could not be loaded");
  return catalog = null;
}
