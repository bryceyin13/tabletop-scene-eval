const root = document.querySelector("#app");
const config = window.EVAL_CONFIG ?? {};
const configured = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
const adminOnly = Boolean(window.EVAL_ADMIN_ROUTE);
let supabase;
let evaluation;
let currentScene = 0;
let adminState = { rows: [], selectedId: null, filter: "", stats: [] };

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const friendlyError = (error) => error?.message || "操作未完成，请稍后再试。";
const status = (message, type = "") => `<p class="status ${type}">${escapeHtml(message)}</p>`;

async function db() {
  if (!configured) throw new Error("尚未配置 Supabase。");
  if (!supabase) {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  }
  return supabase;
}

function assetUrl(asset) {
  const base = (config.ASSET_BASE_URL || "./assets/").replace(/\/?$/, "/");
  return `${base}${encodeURIComponent(asset)}`;
}

async function ensureParticipant() {
  const client = await db();
  const { data: { session } } = await client.auth.getSession();
  if (session) return client;
  const { error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return client;
}

async function rpc(name, args = {}) {
  const client = await db();
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

function configNotice() {
  return `<section class="hero"><p class="eyebrow">Configuration required</p><h1>数据库尚未连接</h1><p class="lead">页面已经就绪，但还需要在 <code>dist/config.js</code> 填入 Supabase 项目地址和匿名 key，并运行一次数据准备与导入脚本。</p><p class="notice">这两个值用于连接公开的前端；请不要把 service role key 放进此文件。</p></section>`;
}

function participantWelcome(active) {
  const resume = active
    ? `<p class="notice">检测到未完成的测评任务 <strong>${escapeHtml(active.code)}</strong>。继续不会领取新的任务。</p>`
    : "";
  root.innerHTML = `<section class="hero">
    <p class="eyebrow">Anonymous quality study</p>
    <h1>Tabletop 场景质量测评</h1>
    <p class="lead">每次测评包含 10 个场景。请根据参考图，对五个匿名结果做总体质量排序。</p>
    <ul class="rules">
      <li><strong>1 = 最好，5 = 最差。</strong>五个结果必须使用不同名次。</li>
      <li>每个浏览器会保留未完成的任务；完成后可再次开始下一次测评。</li>
      <li>请按直觉独立评价，不需要知道生成方法。</li>
    </ul>
    ${resume}
    <div class="button-row"><button class="button" id="start-evaluation">${active ? "继续测评" : "开始测评"}</button></div>
    ${status("领取任务只会在点击“开始测评”后发生。")}
  </section>`;
  document.querySelector("#start-evaluation").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = active ? "正在恢复…" : "正在领取…";
    try {
      evaluation = active || await rpc("claim_assignment");
      if (!evaluation) {
        participantUnavailable();
        return;
      }
      currentScene = firstUnfinishedScene(evaluation);
      renderEvaluation();
    } catch (error) {
      button.disabled = false;
      button.textContent = active ? "继续测评" : "开始测评";
      document.querySelector(".status").outerHTML = status(friendlyError(error), "error");
    }
  });
}

function participantUnavailable() {
  root.innerHTML = `<section class="hero"><p class="eyebrow">Study capacity reached</p><h1>当前没有可领取的测评任务</h1><p class="lead">750 个预设任务均已领取或完成。请联系研究人员了解后续安排。</p></section>`;
}

function firstUnfinishedScene(payload) {
  const index = payload.scenes.findIndex((scene) => !validRanks(scene));
  return index === -1 ? payload.scenes.length - 1 : index;
}

function validRanks(scene) {
  const ranks = scene.candidates.map((candidate) => Number(candidate.rank || 0)).sort((a, b) => a - b);
  return ranks.length === 5 && ranks.every((rank, index) => rank === index + 1);
}

function rankText(rank) {
  return rank ? `当前：第 ${rank} 名` : "当前：未排名";
}

function syncRankControls(scene, error = "") {
  for (const input of document.querySelectorAll(".rank-slider")) {
    const candidate = scene.candidates.find((item) => item.id === input.dataset.candidateId);
    if (!candidate) continue;
    const text = rankText(candidate.rank);
    input.value = String(candidate.rank || 0);
    input.setAttribute("aria-valuetext", text);
    const value = input.closest(".candidate")?.querySelector(".rank-value");
    if (value) value.textContent = text;
  }
  const complete = validRanks(scene);
  const nextButton = document.querySelector("#next-scene");
  if (nextButton) nextButton.disabled = !complete;
  const summary = document.querySelector("#evaluation-status");
  if (summary) {
    summary.textContent = error || (complete ? "排名完整，可以继续。" : "请为五个结果分别选择 1–5 名。");
    summary.classList.toggle("error", Boolean(error));
  }
}

function renderEvaluation() {
  const scene = evaluation.scenes[currentScene];
  const completed = evaluation.scenes.filter(validRanks).length;
  const canContinue = validRanks(scene);
  root.innerHTML = `<section class="evaluation-header">
      <div><p class="eyebrow">Assignment ${escapeHtml(evaluation.code)}</p><h2>请评价当前场景</h2></div>
      <div class="progress">场景 ${currentScene + 1} / ${evaluation.scenes.length}<div class="progress-bar"><span style="width:${(completed / evaluation.scenes.length) * 100}%"></span></div></div>
    </section>
    <section class="reference card"><img src="${assetUrl(scene.reference_asset)}" alt="当前场景的参考图" /><p class="label">参考图</p></section>
    <section class="candidate-list" aria-label="匿名结果与排名">
      ${scene.candidates.map((candidate, index) => `<article class="candidate">
        <img src="${assetUrl(candidate.asset_file)}" alt="匿名结果 ${index + 1}" />
        <div class="rank-control">
          <div class="rank-head"><strong>匿名结果 ${index + 1}</strong><span class="rank-value">${rankText(candidate.rank)}</span></div>
          <input class="rank-slider" data-candidate-id="${candidate.id}" type="range" min="0" max="5" step="1" value="${candidate.rank || 0}" aria-label="匿名结果 ${index + 1} 的排名" aria-valuetext="${rankText(candidate.rank)}" />
          <div class="rank-scale" aria-hidden="true"><span>未评</span><span>1<small>最好</small></span><span>2</span><span>3</span><span>4</span><span>5<small>最差</small></span></div>
        </div>
      </article>`).join("")}
    </section>
    <section class="evaluation-actions">
      <button class="button secondary" id="previous-scene" ${currentScene === 0 ? "disabled" : ""}>上一场景</button>
      <span class="hint">如需调整，请先把原结果移到“未评”，再选择空出的名次。</span>
      <button class="button" id="next-scene" ${canContinue ? "" : "disabled"}>${currentScene === evaluation.scenes.length - 1 ? "提交测评" : "保存并继续"}</button>
    </section>
    <p id="evaluation-status" class="status" role="status" aria-live="polite">${canContinue ? "排名完整，可以继续。" : "请为五个结果分别选择 1–5 名。"}</p>`;

  document.querySelectorAll(".rank-slider").forEach((input) => input.addEventListener("change", (event) => {
    const error = updateRank(scene, event.currentTarget.dataset.candidateId, Number(event.currentTarget.value));
    syncRankControls(scene, error);
  }));
  document.querySelector("#previous-scene").addEventListener("click", () => {
    currentScene -= 1;
    renderEvaluation();
  });
  document.querySelector("#next-scene").addEventListener("click", saveAndAdvance);
}

function updateRank(scene, candidateId, nextRank) {
  const candidate = scene.candidates.find((item) => item.id === candidateId);
  if (!candidate || nextRank === Number(candidate.rank || 0)) return "";
  const occupied = nextRank && scene.candidates.find((item) => item.id !== candidateId && Number(item.rank || 0) === nextRank);
  if (occupied) {
    candidate.rank = 0;
    return `第 ${nextRank} 名已被其他结果使用，请选择未使用的名次。`;
  }
  candidate.rank = nextRank;
  return "";
}

async function saveAndAdvance(event) {
  const scene = evaluation.scenes[currentScene];
  if (!validRanks(scene)) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "正在保存…";
  try {
    await rpc("save_scene_response", {
      p_assignment_id: evaluation.assignment_id,
      p_scene_id: scene.scene_id,
      p_ranks: scene.candidates.map(({ id, rank }) => ({ candidate_id: id, rank }))
    });
    if (currentScene < evaluation.scenes.length - 1) {
      currentScene += 1;
      renderEvaluation();
      return;
    }
    await rpc("complete_attempt", { p_assignment_id: evaluation.assignment_id });
    evaluationComplete();
  } catch (error) {
    button.disabled = false;
    button.textContent = currentScene === evaluation.scenes.length - 1 ? "提交测评" : "保存并继续";
    document.querySelector(".status").outerHTML = status(friendlyError(error), "error");
  }
}

function evaluationComplete() {
  root.innerHTML = `<section class="hero"><p class="eyebrow">Thank you</p><h1>本次测评已提交</h1><p class="lead">感谢你的评价。若要再完成一次独立测评，可以继续领取下一组场景。</p><div class="button-row"><button id="next-assignment" class="button">开始下一次测评</button><a class="button secondary" href="#/evaluate">返回首页</a></div></section>`;
  document.querySelector("#next-assignment").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "正在领取…";
    try {
      evaluation = await rpc("claim_assignment");
      if (!evaluation) return participantUnavailable();
      currentScene = 0;
      renderEvaluation();
    } catch (error) {
      button.disabled = false;
      button.textContent = "开始下一次测评";
      root.insertAdjacentHTML("beforeend", status(friendlyError(error), "error"));
    }
  });
}

async function renderParticipant() {
  if (!configured) return void (root.innerHTML = configNotice());
  root.innerHTML = `<section class="hero"><p class="lead">正在准备匿名测评…</p></section>`;
  try {
    await ensureParticipant();
    participantWelcome(await rpc("get_active_assignment"));
  } catch (error) {
    root.innerHTML = `<section class="hero"><h1>无法连接测评服务</h1>${status(friendlyError(error), "error")}</section>`;
  }
}

async function isAdmin() {
  await ensureParticipant();
  return Boolean(await rpc("admin_session"));
}

function adminLogin(message = "") {
  root.innerHTML = `<section class="hero"><p class="eyebrow">Restricted area</p><h1>管理员入口</h1><p class="lead">请输入研究人员提供的授权码。通过后，此浏览器会保持管理权限，直到主动退出、清除网站数据或研究人员更换密码。</p><form id="admin-login" class="form-grid" autocomplete="off">
      <label>授权码<input required type="password" name="code" autocomplete="off" /></label>
      <div class="button-row"><button class="button">进入管理页</button></div>
      ${status(message)}
    </form></section>`;
  document.querySelector("#admin-login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      await ensureParticipant();
      if (!await rpc("authorize_admin", { p_code: String(form.get("code") || "") })) return adminLogin("授权码不正确。");
      renderAdminHome();
    } catch (error) {
      adminLogin(friendlyError(error));
    }
  });
}

async function loadAssignments() {
  const client = await db();
  const { data, error } = await client.from("assignments")
    .select("id,code,round_no,group_no,issue_order,status,note,claimed_at,completed_at,attempts(count)")
    .order("issue_order", { ascending: true });
  if (error) throw error;
  return data;
}

function attemptsCount(row) {
  return row.attempts?.[0]?.count ?? 0;
}

async function loadSceneStats() {
  return (await rpc("admin_scene_stats")) || [];
}

async function loadAllRatings() {
  const client = await db();
  const pageSize = 500;
  const ratings = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client.from("responses").select("scene_id,rank,evaluated_at,attempt:attempts!inner(attempt_no,started_at,submitted_at,assignment:assignments!inner(code,round_no,group_no)),candidate:assignment_scene_variants!inner(display_position,method:scene_variants!inner(method_name))").order("id", { ascending: true }).range(start, start + pageSize - 1);
    if (error) throw error;
    ratings.push(...data.map((row) => {
      const attempt = row.attempt || {};
      const assignment = attempt.assignment || {};
      const candidate = row.candidate || {};
      return {
        assignment_code: assignment.code || "",
        round_no: assignment.round_no ?? null,
        group_no: assignment.group_no ?? null,
        attempt_no: attempt.attempt_no,
        attempt_started_at: attempt.started_at,
        attempt_submitted_at: attempt.submitted_at,
        attempt_status: attempt.submitted_at ? "completed" : "unfinished_history",
        scene_id: row.scene_id,
        method_name: candidate.method?.method_name || "Unknown",
        candidate_display_position: candidate.display_position,
        rank: row.rank,
        evaluated_at: row.evaluated_at
      };
    }));
    if (data.length < pageSize) break;
  }
  ratings.sort((a, b) => a.assignment_code.localeCompare(b.assignment_code, undefined, { numeric: true }) || a.attempt_no - b.attempt_no || a.scene_id.localeCompare(b.scene_id, undefined, { numeric: true }) || a.method_name.localeCompare(b.method_name));
  return ratings;
}

function drawSceneStats() {
  const target = document.querySelector("#scene-stats-table");
  if (!target) return;
  const methods = [...new Set(adminState.stats.flatMap((row) => Object.keys(row.averages || {})))].sort();
  if (!adminState.stats.length) {
    target.innerHTML = `<p class="muted">尚无评分记录。</p>`;
    return;
  }
  const average = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
  target.innerHTML = `<table class="stats-table"><thead><tr><th>场景</th><th>评分数</th>${methods.map((method) => `<th>${escapeHtml(method)} 平均排名</th>`).join("")}</tr></thead><tbody>${adminState.stats.map((row) => `<tr><td>${escapeHtml(row.scene_id)}</td><td>${row.rating_count}</td>${methods.map((method) => `<td>${average(row.averages?.[method])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function drawAdminRows() {
  const target = document.querySelector("#assignment-rows");
  if (!target) return;
  const filter = adminState.filter.trim().toLowerCase();
  const rows = adminState.rows.filter((row) => !filter || [row.code, row.status, row.round_no, row.group_no, row.note].join(" ").toLowerCase().includes(filter));
  target.innerHTML = rows.length ? rows.map((row) => `<tr class="selectable ${row.id === adminState.selectedId ? "selected" : ""}" data-assignment-id="${row.id}">
      <td>${escapeHtml(row.code)}</td><td>${row.round_no ?? "自定义"}</td><td>${row.group_no ?? "—"}</td><td>${row.issue_order ?? "—"}</td>
      <td><span class="tag ${row.status}">${escapeHtml(row.status)}</span></td><td>${attemptsCount(row)}</td>
    </tr>`).join("") : `<tr><td class="empty" colspan="6">没有匹配的任务</td></tr>`;
  target.querySelectorAll("[data-assignment-id]").forEach((row) => row.addEventListener("click", () => {
    adminState.selectedId = row.dataset.assignmentId;
    renderAdminDetails();
    drawAdminRows();
  }));
}

function renderAdminDetails() {
  const target = document.querySelector("#assignment-detail");
  if (!target) return;
  const selected = adminState.rows.find((row) => row.id === adminState.selectedId);
  if (!selected) {
    target.innerHTML = `<p class="muted">选择左侧的任务后，可查看答卷、修改元数据或删除任务。</p>`;
    return;
  }
  const resetButton = ["claimed", "completed"].includes(selected.status)
    ? `<button type="button" class="button secondary" id="reset-assignment">清空状态并重新开放</button>`
    : "";
  target.innerHTML = `<h3>${escapeHtml(selected.code)}</h3><p class="muted">状态：${escapeHtml(selected.status)} · 已有 ${attemptsCount(selected)} 次作答</p>
    <form id="assignment-edit" class="form-grid">
      <label>备注<textarea name="note">${escapeHtml(selected.note || "")}</textarea></label>
      <label>发放顺序<input name="issue_order" type="number" min="1" value="${selected.issue_order || ""}" /></label>
      <label>状态<select name="status"><option value="${escapeHtml(selected.status)}">保持 ${escapeHtml(selected.status)}</option><option value="available">重新开放（下一位可领取）</option></select></label>
      <div class="button-row"><button class="button">保存修改</button><button type="button" class="button secondary" id="show-results">查看答卷</button>${resetButton}<button type="button" class="button danger" id="delete-assignment">删除任务</button></div>
      ${status("清空状态只会把任务变为可领取；历史作答和评分会保留。")}
    </form><div id="assignment-results"></div>`;
  document.querySelector("#assignment-edit").addEventListener("submit", saveAssignmentEdit);
  document.querySelector("#show-results").addEventListener("click", () => showResults(selected.id));
  document.querySelector("#reset-assignment")?.addEventListener("click", () => resetAssignment(selected));
  document.querySelector("#delete-assignment").addEventListener("click", () => deleteAssignment(selected));
}

async function resetAssignment(selected) {
  if (!window.confirm(`将 ${selected.code} 重新开放，但保留已有作答和评分。确定继续吗？`)) return;
  try {
    await rpc("admin_reset_assignment", { p_assignment_id: selected.id });
    await renderAdminHome(selected.id);
  } catch (error) {
    document.querySelector("#assignment-detail").insertAdjacentHTML("beforeend", status(friendlyError(error), "error"));
  }
}

async function saveAssignmentEdit(event) {
  event.preventDefault();
  const selected = adminState.rows.find((row) => row.id === adminState.selectedId);
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await rpc("admin_update_assignment", {
      p_assignment_id: selected.id,
      p_note: String(form.get("note") || "").trim() || null,
      p_issue_order: Number(form.get("issue_order")) || selected.issue_order,
      p_status: form.get("status")
    });
    await renderAdminHome(selected.id);
  } catch (error) {
    button.disabled = false;
    event.currentTarget.insertAdjacentHTML("beforeend", status(friendlyError(error), "error"));
  }
}

async function deleteAssignment(selected) {
  const confirmation = window.prompt(`删除会同时删除 ${selected.code} 的所有答卷。请输入任务代码以确认：`);
  if (confirmation !== selected.code) return;
  try {
    await rpc("admin_delete_assignment", { p_assignment_id: selected.id });
    await renderAdminHome();
  } catch (error) {
    document.querySelector("#assignment-detail").insertAdjacentHTML("beforeend", status(friendlyError(error), "error"));
  }
}

async function showResults(assignmentId) {
  const target = document.querySelector("#assignment-results");
  target.innerHTML = `<p class="status">正在加载答卷…</p>`;
  try {
    const client = await db();
    const [{ data: attempts, error: attemptsError }, { data: variants, error: variantsError }] = await Promise.all([
      client.from("attempts").select("id,attempt_no,participant_id,started_at,submitted_at,responses(scene_id,candidate_id,rank,evaluated_at)").eq("assignment_id", assignmentId).order("attempt_no"),
      client.from("assignment_scene_variants").select("id,scene_id,display_position,scene_variants(method_name)").eq("assignment_id", assignmentId)
    ]);
    if (attemptsError) throw attemptsError;
    if (variantsError) throw variantsError;
    const methodByCandidate = new Map(variants.map((item) => [item.id, item.scene_variants?.method_name || "未知方法"]));
    target.innerHTML = attempts.length ? attempts.map((attempt) => {
      const grouped = attempt.responses.reduce((map, response) => {
        const method = methodByCandidate.get(response.candidate_id) || "未知方法";
        (map[response.scene_id] ??= {})[method] = response.rank;
        return map;
      }, {});
      const scenes = Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
      const methods = [...new Set(variants.map((item) => item.scene_variants?.method_name).filter(Boolean))].sort();
      const resultStatus = attempt.submitted_at ? `已提交 · 提交于 ${escapeHtml(attempt.submitted_at)}` : "未完成历史记录";
      const table = scenes.length ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>场景</th>${methods.map((method) => `<th>${escapeHtml(method)}</th>`).join("")}</tr></thead><tbody>${scenes.map(([sceneId, ranks]) => `<tr><th scope="row">${escapeHtml(sceneId)}</th>${methods.map((method) => `<td>${ranks[method] ?? "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">尚无已保存的场景评分。</p>`;
      return `<article class="result-block"><h3>作答 #${attempt.attempt_no}</h3><p class="muted">开始于 ${escapeHtml(attempt.started_at)} · ${resultStatus} · 已评分 ${scenes.length} / 10 个场景</p>
        ${table}
        <div class="button-row"><button class="button danger" data-delete-attempt="${attempt.id}">删除此作答</button></div></article>`;
    }).join("") : `<p class="muted">尚无作答记录。</p>`;
    target.querySelectorAll("[data-delete-attempt]").forEach((button) => button.addEventListener("click", () => deleteAttempt(button.dataset.deleteAttempt)));
  } catch (error) {
    target.innerHTML = status(friendlyError(error), "error");
  }
}

async function deleteAttempt(attemptId) {
  if (!window.confirm("确定删除这次作答及其 50 条评分吗？此操作不可恢复。")) return;
  try {
    await rpc("admin_delete_attempt", { p_attempt_id: attemptId });
    await renderAdminHome(adminState.selectedId);
  } catch (error) {
    document.querySelector("#assignment-results").insertAdjacentHTML("beforeend", status(friendlyError(error), "error"));
  }
}

async function exportRatings(format) {
  const buttons = [...document.querySelectorAll("#export-csv, #export-json")];
  const message = document.querySelector("#export-status");
  buttons.forEach((button) => { button.disabled = true; });
  message.textContent = "正在读取全部已保存评分…";
  message.className = "muted";
  try {
    const ratings = await loadAllRatings();
    const fields = ["assignment_code", "round_no", "group_no", "attempt_no", "attempt_started_at", "attempt_submitted_at", "attempt_status", "scene_id", "method_name", "candidate_display_position", "rank", "evaluated_at"];
    const csvCell = (value) => {
      const text = String(value ?? "");
      const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
      return "\"" + safe.replaceAll("\"", "\"\"") + "\"";
    };
    const content = format === "json"
      ? JSON.stringify({ exported_at: new Date().toISOString(), rating_count: ratings.length, ratings }, null, 2)
      : "\uFEFF" + [fields.join(","), ...ratings.map((rating) => fields.map((field) => csvCell(rating[field])).join(","))].join("\r\n");
    const extension = format === "csv" ? "csv" : "json";
    const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "tabletop-ratings-" + new Date().toISOString().slice(0, 10) + "." + extension;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = "已导出 " + ratings.length + " 条评分记录。";
  } catch (error) {
    message.className = "status error";
    message.textContent = friendlyError(error);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function setupAdminCreation() {
  document.querySelector("#custom-assignment").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sceneIds = String(form.get("scenes") || "").split(/[\s,，]+/).filter(Boolean).map((value) => `S${value.replace(/^S/i, "").padStart(3, "0")}`);
    if (sceneIds.length !== 10 || new Set(sceneIds).size !== 10) {
      event.currentTarget.insertAdjacentHTML("beforeend", status("请填写 10 个互不重复的场景编号，例如 001, 002, …, 010。", "error"));
      return;
    }
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      await rpc("admin_create_assignment", { p_scene_ids: sceneIds, p_note: String(form.get("note") || "").trim() || null });
      await renderAdminHome();
    } catch (error) {
      button.disabled = false;
      event.currentTarget.insertAdjacentHTML("beforeend", status(friendlyError(error), "error"));
    }
  });
}

async function renderAdminHome(selectedId = adminState.selectedId) {
  root.innerHTML = `<section class="admin-top"><div><p class="eyebrow">Study administration</p><h1>测评管理</h1><p class="lead">管理预生成的 750 个任务、每次作答和补充任务。所有显示的方法名称只对管理员可见。</p></div><button class="button secondary" id="admin-sign-out">退出登录</button></section><section class="admin-grid"><article class="card"><div class="list-tools"><input id="assignment-search" placeholder="按编号、轮次、状态或备注查找" aria-label="查找任务" /></div><div class="table-wrap"><table><thead><tr><th>任务</th><th>轮次</th><th>组</th><th>顺序</th><th>状态</th><th>作答</th></tr></thead><tbody id="assignment-rows"></tbody></table></div></article><aside class="card" id="assignment-detail"></aside><aside class="card"><h3>新增补充任务</h3><p class="muted">仅适合研究者补测。预设的 750 个任务不需要手动创建。</p><form id="custom-assignment" class="form-grid"><label>10 个场景编号<textarea name="scenes" required placeholder="001, 002, 003, …, 010"></textarea></label><label>备注<textarea name="note" placeholder="可选"></textarea></label><button class="button">创建任务</button></form></aside><section class="card stats-card"><h2>全局打分统计</h2><p class="muted">按场景和方法统计所有已记录评分；1 最好，5 最差。五种方法合计的平均值恒为 3，因此这里分别列出每种方法。</p><div class="table-wrap" id="scene-stats-table">正在加载…</div></section></section>`;
  try {
    [adminState.rows, adminState.stats] = await Promise.all([loadAssignments(), loadSceneStats()]);
    adminState.selectedId = selectedId;
    drawAdminRows();
    renderAdminDetails();
    drawSceneStats();
    root.querySelector(".admin-top").insertAdjacentHTML("afterend", `<div class="admin-export-toolbar"><div><strong>用户实际评分</strong><p id="export-status" class="muted" role="status">导出所有已保存评分，包括未完成作答中的评分。</p></div><div class="button-row"><button type="button" class="button secondary" id="export-csv">导出 CSV</button><button type="button" class="button secondary" id="export-json">导出 JSON</button></div></div>`);
    document.querySelector("#export-csv").addEventListener("click", () => exportRatings("csv"));
    document.querySelector("#export-json").addEventListener("click", () => exportRatings("json"));
    document.querySelector("#assignment-search").addEventListener("input", (event) => {
      adminState.filter = event.currentTarget.value;
      drawAdminRows();
    });
    document.querySelector("#admin-sign-out").addEventListener("click", async () => {
      await rpc("admin_sign_out");
      adminLogin();
    });
    setupAdminCreation();
  } catch (error) {
    root.innerHTML = `<section class="hero"><h1>无法加载管理数据</h1>${status(friendlyError(error), "error")}</section>`;
  }
}

async function renderAdmin() {
  if (!configured) return void (root.innerHTML = configNotice());
  root.innerHTML = `<section class="hero"><p class="lead">正在验证管理员身份…</p></section>`;
  try {
    if (await isAdmin()) await renderAdminHome();
    else adminLogin();
  } catch (error) {
    adminLogin(friendlyError(error));
  }
}

function renderRoute() {
  if (adminOnly) renderAdmin();
  else renderParticipant();
}

window.addEventListener("hashchange", renderRoute);
if (!location.hash && !adminOnly) location.hash = "#/evaluate";
renderRoute();
