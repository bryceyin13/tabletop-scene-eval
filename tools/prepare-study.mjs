import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const repo = path.resolve(import.meta.dirname, "..");
const source = process.argv[2] || "C:\\Personal\\CG\\Repos\\TabletopArti\\local\\tabletop_scene_evaluation_150";
const assetsDir = path.join(repo, "dist", "assets");
const seedDir = path.join(repo, "supabase", "seed");
const methods = ["acdc", "gen3dsr", "midi", "tabletoparti", "tabletopgen"];
const assetSalt = "tabletop-scene-eval-v1";
const random = seededRandom("tabletop-scene-eval-plan-v1");

function seededRandom(seed) {
  let value = [...seed].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 2166136261) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function opaqueAsset(sceneId, kind) {
  return `${createHash("sha256").update(`${assetSalt}:${sceneId}:${kind}`).digest("hex").slice(0, 24)}.webp`;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function convertImage(input, output) {
  if (await exists(output)) return;
  await sharp(input).resize(1280, 720).webp({ quality: 90, effort: 4 }).toFile(output);
}

function sceneId(imageKey) {
  return `S${imageKey.match(/\d+$/)[0]}`;
}

function candidateOrders(scenes) {
  const orders = new Map();
  for (const scene of scenes) {
    const base = shuffle([0, 1, 2, 3, 4]);
    const balanced = [];
    for (let repeat = 0; repeat < 10; repeat += 1) {
      for (let rotation = 0; rotation < 5; rotation += 1) balanced.push([...base.slice(rotation), ...base.slice(0, rotation)]);
    }
    orders.set(scene.scene_id, shuffle(balanced));
  }
  return orders;
}

function makePlan(scenes) {
  const perfect = scenes.filter((scene) => scene.tier === "perfect").map((scene) => scene.scene_id);
  const excellent = scenes.filter((scene) => scene.tier === "excellent").map((scene) => scene.scene_id);
  if (perfect.length !== 106 || excellent.length !== 44) throw new Error(`Expected 106 perfect + 44 excellent scenes; found ${perfect.length} + ${excellent.length}.`);

  const orders = candidateOrders(scenes);
  const appearances = new Map(scenes.map((scene) => [scene.scene_id, 0]));
  const assignments = [];
  let issueOrder = 1;

  for (let round = 1; round <= 50; round += 1) {
    const shuffledPerfect = shuffle(perfect);
    const shuffledExcellent = shuffle(excellent);
    const groups = [];
    for (let group = 1; group <= 14; group += 1) {
      groups.push(shuffle([...shuffledPerfect.splice(0, 7), ...shuffledExcellent.splice(0, 3)]));
    }
    groups.push(shuffle([...shuffledPerfect.splice(0, 8), ...shuffledExcellent.splice(0, 2)]));
    if (shuffledPerfect.length || shuffledExcellent.length) throw new Error(`Round ${round} did not consume every scene.`);

    for (const groupIndex of shuffle([...Array(15).keys()])) {
      const groupNo = groupIndex + 1;
      assignments.push({
        code: `R${String(round).padStart(2, "0")}-G${String(groupNo).padStart(2, "0")}`,
        round_no: round,
        group_no: groupNo,
        issue_order: issueOrder++,
        scenes: groups[groupIndex].map((id, index) => {
          const seen = appearances.get(id);
          appearances.set(id, seen + 1);
          return { scene_id: id, position: index + 1, candidate_order: orders.get(id)[seen] };
        })
      });
    }
  }
  return { version: 1, assignments };
}

async function main() {
  const index = JSON.parse(await readFile(path.join(source, "image_index.json"), "utf8"));
  const imageKeys = Object.keys(index).sort();
  if (imageKeys.length !== 150) throw new Error(`Expected 150 entries in image_index.json; found ${imageKeys.length}.`);

  await mkdir(assetsDir, { recursive: true });
  await mkdir(seedDir, { recursive: true });
  const scenes = [];
  const privateVariants = [];

  for (const [position, imageKey] of imageKeys.entries()) {
    const id = sceneId(imageKey);
    const tier = index[imageKey].startsWith("perfect/") ? "perfect" : index[imageKey].startsWith("excellent/") ? "excellent" : null;
    if (!tier) throw new Error(`${imageKey} has no perfect/excellent tier.`);
    const referenceAsset = opaqueAsset(id, "reference");
    const referenceInput = path.join(source, "reference", `${imageKey}.png`);
    await convertImage(referenceInput, path.join(assetsDir, referenceAsset));

    const candidateAssets = [];
    for (const method of methods) {
      const asset = opaqueAsset(id, method);
      await convertImage(path.join(source, method, `${imageKey}.png`), path.join(assetsDir, asset));
      candidateAssets.push(asset);
      privateVariants.push({ scene_id: id, method_name: method, asset_file: asset });
    }
    scenes.push({ scene_id: id, tier, reference_asset: referenceAsset, candidate_assets: candidateAssets });
    process.stdout.write(`\rPrepared ${position + 1}/150 scenes`);
  }
  process.stdout.write("\n");

  const plan = makePlan(scenes);
  await writeFile(path.join(seedDir, "catalog.json"), `${JSON.stringify({ version: 1, scenes }, null, 2)}\n`);
  await writeFile(path.join(seedDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(seedDir, "private-variants.json"), `${JSON.stringify(privateVariants, null, 2)}\n`);
  await writeFile(path.join(seedDir, "asset-report.json"), `${JSON.stringify({ files: (await Promise.all(scenes.flatMap((scene) => [scene.reference_asset, ...scene.candidate_assets]).map((file) => stat(path.join(assetsDir, file))))).length }, null, 2)}\n`);
  console.log("Generated 900 WebP assets plus the 750-assignment plan.");
}

await main();
