import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing. Never put the service role key in dist/config.js.");
const seed = path.resolve(import.meta.dirname, "..", "supabase", "seed");
const [catalog, plan, privateVariants] = await Promise.all(["catalog.json", "plan.json", "private-variants.json"].map(async (file) => JSON.parse(await readFile(path.join(seed, file), "utf8"))));

async function request(endpoint, options = {}) {
  const response = await fetch(`${url}/rest/v1/${endpoint}`, {
    ...options,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${endpoint}: ${body || response.statusText}`);
  return body ? JSON.parse(body) : null;
}

async function insert(table, rows, chunkSize = 500, representation = false) {
  const result = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const body = await request(table, { method: "POST", headers: { Prefer: representation ? "return=representation" : "return=minimal" }, body: JSON.stringify(chunk) });
    if (body) result.push(...body);
    process.stdout.write(`\r${table}: ${Math.min(index + chunk.length, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
  return result;
}

if ((await request("assignments?select=id&limit=1")).length) throw new Error("The database already has assignments. Import only into an empty study database.");
await insert("scenes", catalog.scenes.map(({ scene_id, tier, reference_asset }) => ({ scene_id, tier, reference_asset })));
const variants = await insert("scene_variants", privateVariants, 500, true);
const variantId = new Map(variants.map((variant) => [`${variant.scene_id}:${variant.asset_file}`, variant.id]));
const assignmentIds = new Map(plan.assignments.map((assignment) => [assignment.code, randomUUID()]));
await insert("assignments", plan.assignments.map((assignment) => ({ id: assignmentIds.get(assignment.code), code: assignment.code, round_no: assignment.round_no, group_no: assignment.group_no, issue_order: assignment.issue_order })));

const catalogByScene = new Map(catalog.scenes.map((scene) => [scene.scene_id, scene]));
const assignmentScenes = [];
const assignmentVariants = [];
for (const assignment of plan.assignments) {
  const assignmentId = assignmentIds.get(assignment.code);
  for (const scene of assignment.scenes) {
    assignmentScenes.push({ assignment_id: assignmentId, scene_id: scene.scene_id, position: scene.position });
    const assets = catalogByScene.get(scene.scene_id).candidate_assets;
    scene.candidate_order.forEach((candidateIndex, displayIndex) => assignmentVariants.push({
      id: randomUUID(), assignment_id: assignmentId, scene_id: scene.scene_id,
      variant_id: variantId.get(`${scene.scene_id}:${assets[candidateIndex]}`), display_position: displayIndex + 1
    }));
  }
}
await insert("assignment_scenes", assignmentScenes, 500);
await insert("assignment_scene_variants", assignmentVariants, 500);
console.log("Supabase import complete: 150 scenes, 750 assignments, and 37,500 anonymous display rows.");
