import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, modelKey, templateVars } from "../server/registry.ts";

const { apps, problems } = loadRegistry();

test("every manifest passes the schema and its bindings resolve", () => {
  const errors = problems.filter((p) => p.severity === "error");
  assert.deepEqual(errors, []);
});

test("ready apps all have a workflow on disk", () => {
  for (const app of apps.filter((a) => a.status === "ready")) {
    assert.ok(app.graph, `${app.id} has no workflow loaded`);
  }
});

test("folder name and id agree, ids are unique", () => {
  const ids = apps.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of apps) assert.ok(a.dir.endsWith(a.id), `${a.id} lives in ${a.dir}`);
});

test("apps that share models produce the same model key, so switching between them does not unload", () => {
  const edit = apps.find((a) => a.id === "edit")!;
  const relight = apps.find((a) => a.id === "relight")!;
  const inpaint = apps.find((a) => a.id === "inpaint")!;
  const character = apps.find((a) => a.id === "character")!;
  const cinema = apps.find((a) => a.id === "cinema-studio")!;
  const styleRef = apps.find((a) => a.id === "style-reference")!;
  const zImage = apps.find((a) => a.id === "z-image")!;
  const cinemaVideo = apps.find((a) => a.id === "cinema-video")!;
  const h3 = apps.find((a) => a.id === "h3-video")!;
  const video = apps.find((a) => a.id === "video")!;
  assert.equal(modelKey(character), modelKey(inpaint));
  assert.equal(modelKey(edit), modelKey(relight));
  assert.equal(modelKey(cinema), modelKey(styleRef));
  assert.equal(modelKey(cinemaVideo), modelKey(h3));
  assert.notEqual(modelKey(edit), modelKey(video));
});

test("templateVars finds placeholders", () => {
  assert.deepEqual(templateVars("{prompt}, shot on a {camera}"), ["prompt", "camera"]);
});
