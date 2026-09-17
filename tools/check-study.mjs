import { readFile } from "node:fs/promises";
import path from "node:path";

const seed = path.resolve(import.meta.dirname, "..", "supabase", "seed");
const catalog = JSON.parse(await readFile(path.join(seed, "catalog.json"), "utf8"));
const plan = JSON.parse(await readFile(path.join(seed, "plan.json"), "utf8"));
const tierByScene = new Map(catalog.scenes.map((scene) => [scene.scene_id, scene.tier]));

function assert(condition, message) { if (!condition) throw new Error(message); }
assert(catalog.scenes.length === 150, "catalog must contain 150 scenes");
assert(plan.assignments.length === 750, "plan must contain 750 assignments");

plan.assignments.slice().sort((left, right) => left.issue_order - right.issue_order).forEach((assignment, index) => {
  assert(assignment.issue_order === index + 1, `issue order ${index + 1} is missing`);
  assert(assignment.round_no === Math.floor(index / 15) + 1, `${assignment.code}: rounds must be issued sequentially`);
});

for (let round = 1; round <= 50; round += 1) {
  const assignments = plan.assignments.filter((assignment) => assignment.round_no === round);
  assert(assignments.length === 15, `round ${round}: expected 15 assignments`);
  assignments.forEach((assignment) => assert(assignment.scenes.length === 10, `${assignment.code}: expected 10 scenes`));
  const sceneIds = assignments.flatMap((assignment) => assignment.scenes.map((scene) => scene.scene_id));
  assert(new Set(sceneIds).size === 150, `round ${round}: scene repeated or missing`);
  const compositions = assignments.map((assignment) => assignment.scenes.reduce((counts, scene) => {
    counts[tierByScene.get(scene.scene_id)] += 1;
    return counts;
  }, { perfect: 0, excellent: 0 }));
  assert(compositions.filter((counts) => counts.perfect === 7 && counts.excellent === 3).length === 14, `round ${round}: expected fourteen 7P+3E groups`);
  assert(compositions.filter((counts) => counts.perfect === 8 && counts.excellent === 2).length === 1, `round ${round}: expected one 8P+2E group`);
}

for (const scene of catalog.scenes) {
  const positionCounts = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const assignment of plan.assignments) {
    const occurrence = assignment.scenes.find((item) => item.scene_id === scene.scene_id);
    if (!occurrence) continue;
    assert(new Set(occurrence.candidate_order).size === 5, `${scene.scene_id}: duplicate candidate in one display`);
    occurrence.candidate_order.forEach((candidate, position) => { positionCounts[candidate][position] += 1; });
  }
  positionCounts.forEach((counts, candidate) => counts.forEach((count, position) => assert(count === 10, `${scene.scene_id}: candidate ${candidate} occurs ${count} times at position ${position}`)));
}

console.log("OK: 750 assignments; every round covers all 150 scenes once; candidate positions are balanced 10× each.");
