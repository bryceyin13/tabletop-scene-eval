import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const seedDir = path.join(repo, "supabase", "seed");
const [catalog, plan] = await Promise.all(["catalog.json", "plan.json"].map(async (file) => JSON.parse(await readFile(path.join(seedDir, file), "utf8"))));

if (catalog.scenes.length !== 150 || plan.assignments.length !== 750) throw new Error("Unexpected seed size.");

const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const sql = `-- Generated from the current _150_final seed. Run the whole file once after clearing the study tables.
begin;

create temporary table _tabletop_seed (catalog jsonb not null, plan jsonb not null) on commit drop;
insert into _tabletop_seed values (
  convert_from(decode('${encoded(catalog)}', 'base64'), 'utf8')::jsonb,
  convert_from(decode('${encoded(plan)}', 'base64'), 'utf8')::jsonb
);

insert into public.scenes (scene_id, tier, reference_asset)
select scene_id, tier, reference_asset
from _tabletop_seed seed
cross join lateral jsonb_to_recordset(seed.catalog -> 'scenes')
  as scene(scene_id text, tier text, reference_asset text, candidate_assets jsonb);

insert into public.scene_variants (scene_id, method_name, asset_file)
select scene.scene_id, method.method_name, asset.asset_file
from _tabletop_seed seed
cross join lateral jsonb_to_recordset(seed.catalog -> 'scenes')
  as scene(scene_id text, tier text, reference_asset text, candidate_assets jsonb)
cross join lateral jsonb_array_elements_text(scene.candidate_assets) with ordinality
  as asset(asset_file, position)
join (values
  (1::bigint, 'acdc'),
  (2::bigint, 'gen3dsr'),
  (3::bigint, 'midi'),
  (4::bigint, 'tabletoparti'),
  (5::bigint, 'tabletopgen')
) as method(position, method_name) on method.position = asset.position;

insert into public.assignments (code, round_no, group_no, issue_order)
select assignment.code, assignment.round_no, assignment.group_no, assignment.issue_order
from _tabletop_seed seed
cross join lateral jsonb_to_recordset(seed.plan -> 'assignments')
  as assignment(code text, round_no smallint, group_no smallint, issue_order integer, scenes jsonb)
order by assignment.issue_order;

with plan_assignments as (
  select assignment.code, assignment.scenes
  from _tabletop_seed seed
  cross join lateral jsonb_to_recordset(seed.plan -> 'assignments')
    as assignment(code text, round_no smallint, group_no smallint, issue_order integer, scenes jsonb)
)
insert into public.assignment_scenes (assignment_id, scene_id, position)
select target.id, scene.value ->> 'scene_id', (scene.value ->> 'position')::smallint
from plan_assignments plan
join public.assignments target on target.code = plan.code
cross join lateral jsonb_array_elements(plan.scenes) as scene(value);

with plan_assignments as (
  select assignment.code, assignment.scenes
  from _tabletop_seed seed
  cross join lateral jsonb_to_recordset(seed.plan -> 'assignments')
    as assignment(code text, round_no smallint, group_no smallint, issue_order integer, scenes jsonb)
), candidates as (
  select plan.code,
    scene.value ->> 'scene_id' as scene_id,
    candidate.value::integer as candidate_index,
    candidate.position::smallint as display_position
  from plan_assignments plan
  cross join lateral jsonb_array_elements(plan.scenes) as scene(value)
  cross join lateral jsonb_array_elements_text(scene.value -> 'candidate_order') with ordinality
    as candidate(value, position)
), catalog as (
  select scene.scene_id, scene.candidate_assets
  from _tabletop_seed seed
  cross join lateral jsonb_to_recordset(seed.catalog -> 'scenes')
    as scene(scene_id text, tier text, reference_asset text, candidate_assets jsonb)
)
insert into public.assignment_scene_variants (assignment_id, scene_id, variant_id, display_position)
select assignment.id, candidate.scene_id, variant.id, candidate.display_position
from candidates candidate
join public.assignments assignment on assignment.code = candidate.code
join catalog on catalog.scene_id = candidate.scene_id
join public.scene_variants variant
  on variant.scene_id = candidate.scene_id
  and variant.asset_file = catalog.candidate_assets ->> candidate.candidate_index;

do $$
begin
  if (select count(*) from public.scenes) <> 150
    or (select count(*) from public.scene_variants) <> 750
    or (select count(*) from public.assignments) <> 750
    or (select count(*) from public.assignment_scenes) <> 7500
    or (select count(*) from public.assignment_scene_variants) <> 37500 then
    raise exception 'Seed row counts do not match the study design.';
  end if;
end $$;

commit;
`;

await writeFile(path.join(seedDir, "import.sql"), sql);
console.log(`Generated import.sql (${Buffer.byteLength(sql)} bytes).`);
