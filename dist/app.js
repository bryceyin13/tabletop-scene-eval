const root = document.querySelector("#app");
const config = window.EVAL_CONFIG ?? {};
const configured = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
const adminOnly = Boolean(window.EVAL_ADMIN_ROUTE);
const participantCopy = {
  zh: {
    nav: "参与测评", navLabel: "主导航", homeLabel: "回到测评首页", operationFailed: "操作未完成，请稍后再试。",
    configTitle: "数据库尚未连接", configLead: "页面已经就绪，但还需要在 dist/config.js 填入 Supabase 项目地址和匿名 key，并运行一次数据准备与导入脚本。", configWarning: "这两个值用于连接公开的前端；请不要把 service role key 放进此文件。",
    active: (code) => `检测到未完成的测评任务 <strong>${escapeHtml(code)}</strong>。继续不会领取新的任务。`,
    title: "Tabletop 场景质量测评", lead: "每次测评包含 10 个场景。请根据参考图，对五个匿名结果做总体质量排序。",
    rankRule: "1 = 最好，5 = 最差。", uniqueRule: "五个结果必须使用不同名次。", resumeRule: "每个浏览器会保留未完成的任务；完成后可再次开始下一次测评。", independentRule: "请按直觉独立评价，不需要知道生成方法。",
    continue: "继续测评", start: "开始测评", claimOnly: "领取任务只会在点击“开始测评”后发生。", restoring: "正在恢复…", claiming: "正在领取…",
    noTasksTitle: "当前没有可领取的测评任务", noTasksLead: "750 个预设任务均已领取或完成。请联系研究人员了解后续安排。",
    currentRank: (rank) => `当前：第 ${rank} 名`, unranked: "当前：未排名", complete: "排名完整，可以继续。", incomplete: "请为五个结果分别选择 1–5 名。",
    evaluate: "请评价当前场景", scene: (current, total) => `场景 ${current} / ${total}`, referenceAlt: "当前场景的参考图", reference: "参考图", candidatesLabel: "匿名结果与排名", candidate: (index) => `匿名结果 ${index}`, candidateRank: (index) => `匿名结果 ${index} 的排名`,
    notRated: "未评", best: "最好", worst: "最差", previous: "上一场景", adjustHint: "如需调整，请先把原结果移到“未评”，再选择空出的名次。", submit: "提交测评", save: "保存并继续",
    duplicate: (rank) => `第 ${rank} 名已被其他结果使用，请选择未使用的名次。`, saving: "正在保存…",
    thankTitle: "本次测评已提交", thankLead: "感谢你的评价。若要再完成一次独立测评，可以继续领取下一组场景。", next: "开始下一次测评", returnHome: "返回首页",
    preparing: "正在准备匿名测评…", connectFailed: "无法连接测评服务"
  },
  en: {
    nav: "Take the Evaluation", navLabel: "Main navigation", homeLabel: "Return to the evaluation home page", operationFailed: "The operation could not be completed. Please try again.",
    configTitle: "Database not connected", configLead: "The page is ready, but the Supabase project URL and anonymous key must be added to dist/config.js, and the data setup and import must be run once.", configWarning: "These values connect the public front end. Never put the service role key in this file.",
    active: (code) => `An unfinished evaluation task <strong>${escapeHtml(code)}</strong> was found. Continuing will not claim a new task.`,
    title: "Tabletop Scene Quality Evaluation", lead: "Each evaluation contains 10 scenes. Use the reference image to rank the overall quality of the five anonymous results.",
    rankRule: "1 = best, 5 = worst.", uniqueRule: "Each result must receive a different rank.", resumeRule: "This browser will retain an unfinished task. After completing it, you may start another evaluation.", independentRule: "Please evaluate independently based on your first impression. You do not need to know which method produced each result.",
    continue: "Continue Evaluation", start: "Start Evaluation", claimOnly: "A task is claimed only after you click “Start Evaluation.”", restoring: "Restoring…", claiming: "Claiming…",
    noTasksTitle: "No evaluation tasks are currently available", noTasksLead: "All 750 preset tasks have already been claimed or completed. Please contact the research team for more information.",
    currentRank: (rank) => `Current: rank ${rank}`, unranked: "Current: not ranked", complete: "Ranking complete. You can continue.", incomplete: "Assign each result a different rank from 1 to 5.",
    evaluate: "Evaluate the current scene", scene: (current, total) => `Scene ${current} / ${total}`, referenceAlt: "Reference image for the current scene", reference: "Reference", candidatesLabel: "Anonymous results and rankings", candidate: (index) => `Anonymous result ${index}`, candidateRank: (index) => `Rank for anonymous result ${index}`,
    notRated: "Not rated", best: "Best", worst: "Worst", previous: "Previous scene", adjustHint: "To change the order, move a result to “Not rated” first, then select the available rank.", submit: "Submit Evaluation", save: "Save and Continue",
    duplicate: (rank) => `Rank ${rank} is already assigned to another result. Please choose an available rank.`, saving: "Saving…",
    thankTitle: "Your evaluation has been submitted", thankLead: "Thank you for your evaluation. You may claim another group of scenes to complete a separate evaluation.", next: "Start Another Evaluation", returnHome: "Return Home",
    preparing: "Preparing the anonymous evaluation…", connectFailed: "Unable to connect to the evaluation service"
  }
};
let language = adminOnly ? "zh" : localStorage.getItem("tabletop-eval-language") === "en" ? "en" : "zh";
let participantScreen = "loading";
const p = (key, ...args) => typeof participantCopy[language][key] === "function" ? participantCopy[language][key](...args) : participantCopy[language][key];
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

const friendlyError = (error) => error?.message || p("operationFailed");
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
  return `<section class="hero"><p class="eyebrow">Configuration required</p><h1>${p("configTitle")}</h1><p class="lead">${p("configLead")}</p><p class="notice">${p("configWarning")}</p></section>`;
}

function participantWelcome(active) {
  participantScreen = "welcome";
  const resume = active
    ? `<p class="notice">${p("active", active.code)}</p>`
    : "";
  root.innerHTML = `<section class="hero">
    <p class="eyebrow">Anonymous quality study</p>
    <h1>${p("title")}</h1>
    <p class="lead">${p("lead")}</p>
    <ul class="rules">
      <li><strong>${p("rankRule")}</strong> ${p("uniqueRule")}</li>
      <li>${p("resumeRule")}</li>
      <li>${p("independentRule")}</li>
    </ul>
    ${resume}
    <div class="button-row"><button class="button" id="start-evaluation">${active ? p("continue") : p("start")}</button></div>
    ${status(p("claimOnly"))}
  </section>`;
  document.querySelector("#start-evaluation").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = active ? p("restoring") : p("claiming");
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
      button.textContent = active ? p("continue") : p("start");
      document.querySelector(".status").outerHTML = status(friendlyError(error), "error");
    }
  });
}

function participantUnavailable() {
  participantScreen = "unavailable";
  root.innerHTML = `<section class="hero"><p class="eyebrow">Study capacity reached</p><h1>${p("noTasksTitle")}</h1><p class="lead">${p("noTasksLead")}</p></section>`;
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
  return rank ? p("currentRank", rank) : p("unranked");
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
    summary.textContent = error || (complete ? p("complete") : p("incomplete"));
    summary.classList.toggle("error", Boolean(error));
  }
}

function renderEvaluation() {
  participantScreen = "evaluation";
  const scene = evaluation.scenes[currentScene];
  const completed = evaluation.scenes.filter(validRanks).length;
  const canContinue = validRanks(scene);
  root.innerHTML = `<section class="evaluation-header">
      <div><p class="eyebrow">Assignment ${escapeHtml(evaluation.code)}</p><h2>${p("evaluate")}</h2></div>
      <div class="progress">${p("scene", currentScene + 1, evaluation.scenes.length)}<div class="progress-bar"><span style="width:${(completed / evaluation.scenes.length) * 100}%"></span></div></div>
    </section>
    <section class="reference card"><img src="${assetUrl(scene.reference_asset)}" alt="${p("referenceAlt")}" /><p class="label">${p("reference")}</p></section>
    <section class="candidate-list" aria-label="${p("candidatesLabel")}">
      ${scene.candidates.map((candidate, index) => `<article class="candidate">
        <img src="${assetUrl(candidate.asset_file)}" alt="${p("candidate", index + 1)}" />
        <div class="rank-control">
          <div class="rank-head"><strong>${p("candidate", index + 1)}</strong><span class="rank-value">${rankText(candidate.rank)}</span></div>
          <input class="rank-slider" data-candidate-id="${candidate.id}" type="range" min="0" max="5" step="1" value="${candidate.rank || 0}" aria-label="${p("candidateRank", index + 1)}" aria-valuetext="${rankText(candidate.rank)}" />
          <div class="rank-scale" aria-hidden="true"><span>${p("notRated")}</span><span>1<small>${p("best")}</small></span><span>2</span><span>3</span><span>4</span><span>5<small>${p("worst")}</small></span></div>
        </div>
      </article>`).join("")}
    </section>
    <section class="evaluation-actions">
      <button class="button secondary" id="previous-scene" ${currentScene === 0 ? "disabled" : ""}>${p("previous")}</button>
      <span class="hint">${p("adjustHint")}</span>
      <button class="button" id="next-scene" ${canContinue ? "" : "disabled"}>${currentScene === evaluation.scenes.length - 1 ? p("submit") : p("save")}</button>
    </section>
    <p id="evaluation-status" class="status" role="status" aria-live="polite">${canContinue ? p("complete") : p("incomplete")}</p>`;

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
    return p("duplicate", nextRank);
  }
  candidate.rank = nextRank;
  return "";
}

async function saveAndAdvance(event) {
  const scene = evaluation.scenes[currentScene];
  if (!validRanks(scene)) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = p("saving");
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
    button.textContent = currentScene === evaluation.scenes.length - 1 ? p("submit") : p("save");
    document.querySelector(".status").outerHTML = status(friendlyError(error), "error");
  }
}

function evaluationComplete() {
  participantScreen = "complete";
  root.innerHTML = `<section class="hero"><p class="eyebrow">Thank you</p><h1>${p("thankTitle")}</h1><p class="lead">${p("thankLead")}</p><div class="button-row"><button id="next-assignment" class="button">${p("next")}</button><a class="button secondary" href="#/evaluate" data-participant-home>${p("returnHome")}</a></div></section>`;
  document.querySelector("#next-assignment").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = p("claiming");
    try {
      evaluation = await rpc("claim_assignment");
      if (!evaluation) return participantUnavailable();
      currentScene = 0;
      renderEvaluation();
    } catch (error) {
      button.disabled = false;
      button.textContent = p("next");
      root.insertAdjacentHTML("beforeend", status(friendlyError(error), "error"));
    }
  });
}

async function renderParticipant() {
  if (!configured) return void (root.innerHTML = configNotice());
  participantScreen = "loading";
  root.innerHTML = `<section class="hero"><p class="lead">${p("preparing")}</p></section>`;
  try {
    await ensureParticipant();
    participantWelcome(await rpc("get_active_assignment"));
  } catch (error) {
    root.innerHTML = `<section class="hero"><h1>${p("connectFailed")}</h1>${status(friendlyError(error), "error")}</section>`;
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

function syncLanguageChrome() {
  if (adminOnly) return;
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  document.querySelector(".brand")?.setAttribute("aria-label", p("homeLabel"));
  const nav = document.querySelector("nav");
  nav?.setAttribute("aria-label", p("navLabel"));
  const home = nav?.querySelector("[data-participant-home]");
  if (home) home.textContent = p("nav");
  document.querySelectorAll("[data-language]").forEach((button) => button.setAttribute("aria-current", String(button.dataset.language === language)));
}

function renderParticipantScreen() {
  if (participantScreen === "evaluation" && evaluation) renderEvaluation();
  else if (participantScreen === "complete") evaluationComplete();
  else if (participantScreen === "unavailable") participantUnavailable();
  else renderParticipant();
}

function renderRoute() {
  if (adminOnly) renderAdmin();
  else renderParticipant();
}

window.addEventListener("hashchange", renderRoute);
document.addEventListener("click", (event) => {
  const languageButton = event.target.closest?.("[data-language]");
  if (languageButton && !adminOnly) {
    language = languageButton.dataset.language === "en" ? "en" : "zh";
    localStorage.setItem("tabletop-eval-language", language);
    document.querySelector(".language-menu")?.removeAttribute("open");
    syncLanguageChrome();
    renderParticipantScreen();
    return;
  }
  if (!event.target.closest?.("[data-participant-home]") || adminOnly) return;
  event.preventDefault();
  renderParticipant();
});
if (!location.hash && !adminOnly) location.hash = "#/evaluate";
syncLanguageChrome();
renderRoute();
