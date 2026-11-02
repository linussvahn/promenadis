// Writes the synthetic OpenStreetMap-shaped fixture used by local walking-
// network builds. Deterministic: rerunning produces identical bytes, so the
// checksum recorded in routing-source.ts stays valid. Not real map data.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const elements = [];
let nextNode = 1;
let nextWay = 1;
const node = (lon, lat) => {
  const id = nextNode++;
  elements.push({ type: "node", id, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) });
  return id;
};
const way = (nodes, tags) => elements.push({ type: "way", id: nextWay++, nodes, tags });

// Residential grid, about 85 x 89 metres per block.
const columns = 17;
const rows = 19;
const grid = [];
for (let row = 0; row < rows; row++) {
  grid.push([]);
  for (let column = 0; column < columns; column++) {
    grid[row].push(node(18.055 + column * 0.0015, 59.305 + row * 0.0008));
  }
}
for (let row = 0; row < rows; row++)
  way(grid[row], {
    highway: row % 6 === 0 ? "tertiary" : "residential",
    name: `Provgatan ${row + 1}`,
  });
for (let column = 0; column < columns; column++) {
  way(
    grid.map((line) => line[column]),
    { highway: column % 5 === 2 ? "pedestrian" : "residential", name: `Testgränd ${column + 1}` },
  );
}
// A stair shortcut, a motorway and a private road that must not be walkable.
way([grid[4][4], node(18.06275, 59.3086), grid[5][5]], { highway: "steps" });
way([node(18.05, 59.3205), node(18.085, 59.3205)], { highway: "motorway" });
way([grid[10][10], node(18.07025, 59.3138), grid[10][11]], {
  highway: "service",
  access: "private",
});
// A closed courtyard path with no link to the streets: a disconnected island.
const cx = 18.06775;
const cy = 59.3118;
const ring = [
  node(cx - 0.0002, cy - 0.0001),
  node(cx + 0.0002, cy - 0.0001),
  node(cx + 0.0002, cy + 0.0001),
  node(cx - 0.0002, cy + 0.0001),
];
way([...ring, ring[0]], { highway: "footway" });

const body = `${JSON.stringify({ elements, generator: "promenadis synthetic fixture", version: 1 })}\n`;
const path = resolve(
  import.meta.dirname,
  "../supabase/functions/api-v1/fixtures/osm-synthetic-sodermalm.json",
);
writeFileSync(path, body);
console.log(`${createHash("sha256").update(body).digest("hex")}  ${path}`);
