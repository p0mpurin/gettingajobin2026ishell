/** South Tyrol's towns for the job map: names in German and Italian, with where they are. */
export interface Town {
  name: string;
  lat: number;
  lon: number;
  aliases: string[];
}

export const TOWNS: Town[] = [
  { name: "Bozen", lat: 46.498, lon: 11.355, aliases: ["bozen", "bolzano"] },
  { name: "Meran", lat: 46.669, lon: 11.163, aliases: ["meran", "merano"] },
  { name: "Brixen", lat: 46.716, lon: 11.657, aliases: ["brixen", "bressanone"] },
  { name: "Bruneck", lat: 46.797, lon: 11.936, aliases: ["bruneck", "brunico"] },
  { name: "Leifers", lat: 46.427, lon: 11.334, aliases: ["leifers", "laives"] },
  { name: "Eppan", lat: 46.489, lon: 11.26, aliases: ["eppan", "appiano", "girlan", "frangart"] },
  { name: "Kaltern", lat: 46.413, lon: 11.243, aliases: ["kaltern", "caldaro"] },
  { name: "Lana", lat: 46.611, lon: 11.156, aliases: ["lana"] },
  { name: "Auer", lat: 46.348, lon: 11.297, aliases: ["auer", "ora"] },
  { name: "Neumarkt", lat: 46.319, lon: 11.273, aliases: ["neumarkt", "egna"] },
  { name: "Tramin", lat: 46.343, lon: 11.241, aliases: ["tramin", "termeno"] },
  { name: "Kurtatsch", lat: 46.312, lon: 11.222, aliases: ["kurtatsch", "cortaccia"] },
  { name: "Salurn", lat: 46.242, lon: 11.2, aliases: ["salurn", "salorno"] },
  { name: "Terlan", lat: 46.533, lon: 11.247, aliases: ["terlan", "terlano", "andrian", "andriano", "nals"] },
  { name: "Ritten", lat: 46.538, lon: 11.462, aliases: ["ritten", "renon", "unterinn", "klobenstein"] },
  { name: "Klausen", lat: 46.639, lon: 11.566, aliases: ["klausen", "chiusa"] },
  { name: "Sterzing", lat: 46.893, lon: 11.43, aliases: ["sterzing", "vipiteno"] },
  { name: "Vahrn", lat: 46.736, lon: 11.636, aliases: ["vahrn", "varna"] },
  { name: "Schlanders", lat: 46.628, lon: 10.774, aliases: ["schlanders", "silandro"] },
  { name: "Mals", lat: 46.688, lon: 10.547, aliases: ["mals", "malles"] },
  { name: "Naturns", lat: 46.65, lon: 11.003, aliases: ["naturns", "naturno", "partschins"] },
  { name: "Algund", lat: 46.677, lon: 11.127, aliases: ["algund", "lagundo", "marling", "schenna"] },
  { name: "St. Ulrich", lat: 46.574, lon: 11.672, aliases: ["st. ulrich", "ortisei", "gröden", "val gardena"] },
  { name: "Kastelruth", lat: 46.568, lon: 11.56, aliases: ["kastelruth", "castelrotto", "völs"] },
  { name: "Innichen", lat: 46.733, lon: 12.283, aliases: ["innichen", "san candido"] },
  { name: "Toblach", lat: 46.733, lon: 12.222, aliases: ["toblach", "dobbiaco", "welsberg"] },
  { name: "Sand in Taufers", lat: 46.919, lon: 11.956, aliases: ["sand in taufers", "campo tures"] },
  { name: "Sarnthein", lat: 46.64, lon: 11.355, aliases: ["sarnthein", "sarentino", "sarntal"] },
  { name: "Deutschnofen", lat: 46.413, lon: 11.423, aliases: ["deutschnofen", "nova ponente", "welschnofen"] },
];

/** The first known town in a job location, matched on whole words. */
export function townOf(location: string): Town | undefined {
  const text = ` ${location.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").trim()} `;
  let best: { town: Town; at: number } | undefined;
  for (const town of TOWNS) {
    for (const alias of town.aliases) {
      const at = text.indexOf(` ${alias} `);
      if (at >= 0 && (!best || at < best.at)) best = { town, at };
    }
  }
  return best?.town;
}

/** Rough outline of South Tyrol, enough to recognise the shape: not for navigation. */
export const OUTLINE: [number, number][] = [
  [46.65, 10.39], [46.85, 10.47], [46.87, 10.68], [46.77, 10.74], [46.8, 10.95], [46.94, 11.03], [47.0, 11.17], [46.97, 11.47], [47.02, 11.63],
  [47.09, 12.02], [47.09, 12.2], [46.98, 12.15], [46.89, 12.27], [46.78, 12.48], [46.67, 12.36], [46.62, 12.2], [46.72, 12.05], [46.56, 11.99],
  [46.52, 11.84], [46.43, 11.67], [46.36, 11.5], [46.25, 11.25], [46.22, 11.17], [46.37, 11.16], [46.41, 11.03], [46.47, 11.02], [46.53, 10.9], [46.46, 10.62], [46.53, 10.45],
];

const BOX = { north: 47.13, south: 46.18, west: 10.34, east: 12.53 };

/** Map position in a viewBox, keeping the real proportions at this latitude. */
export function project(lat: number, lon: number, width: number): [number, number] {
  const scale = width / (BOX.east - BOX.west);
  // A degree of longitude is about 69% of a degree of latitude here.
  return [(lon - BOX.west) * scale, ((BOX.north - lat) / 0.69) * scale];
}

export const mapHeight = (width: number) => ((BOX.north - BOX.south) / 0.69) * (width / (BOX.east - BOX.west));
