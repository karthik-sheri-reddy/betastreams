import fs from 'node:fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';

const stationSchema = z.object({
  callsign: z.string().regex(/^[KW][A-Z]{2,3}$/),
  network: z.string().min(1),
  city: z.string().min(1),
});

const stationsFileSchema = z.object({
  version: z.literal(1),
  stations: z.array(stationSchema),
});

export type Station = z.infer<typeof stationSchema>;
export type StationsFile = z.infer<typeof stationsFileSchema>;

export function loadStationsFromString(content: string): StationsFile {
  return stationsFileSchema.parse(yaml.load(content));
}

export function loadStationsFromFile(filePath: string): StationsFile {
  return loadStationsFromString(fs.readFileSync(filePath, 'utf-8'));
}

/** callsign (uppercase) -> Station, for the cascade's call-sign lookup step. */
export function buildStationIndex(file: StationsFile): Map<string, Station> {
  return new Map(file.stations.map((s) => [s.callsign.toUpperCase(), s]));
}

/** (network, normalized city) -> Station, for "FOX 2 Detroit"-style name patterns that name the city instead of the call sign. */
export function buildStationByNetworkCityIndex(file: StationsFile): Map<string, Station> {
  const index = new Map<string, Station>();
  for (const s of file.stations) {
    index.set(`${s.network.toUpperCase()}\u0000${s.city.toLowerCase()}`, s);
  }
  return index;
}
