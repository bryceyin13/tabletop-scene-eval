# Tabletop Scene Evaluation

匿名的 Tabletop 场景质量测评网站。每位参与者完成一个 10 场景任务：看到参考图和五个随机排列的结果，用互不重复的 1–5 名排序（1 最好）。

## 已实现的研究设计

- 预生成 50 轮 × 15 组 = 750 个任务；每组 10 个场景。
- 每轮严格覆盖 150 个场景一次：14 组为 7 `perfect` + 3 `excellent`，最后一组为 8 `perfect` + 2 `excellent`。
- 每轮内 15 组按固定随机顺序发放；轮次按 1 → 50 顺序推进。
- 对每个场景，五个方法在 50 次出现中各占每个显示位置 10 次；参与者只看到“匿名结果”。
- Supabase RPC 用 `FOR UPDATE SKIP LOCKED` 原子领取任务。同一浏览器未完成时恢复，完成后才可领取下一组。
- 管理员可搜索 750 个任务，查看方法名还原后的答卷，并创建、修改、重开或删除任务/作答。
- 两个独立网址：`/` 为参与者入口，`/admin/` 为管理员入口；管理员码只在 Supabase 中按哈希验证，不会放入网页 JavaScript。

## 一次性安装与数据准备

在本仓库运行：

```powershell
npm install
npm run prepare-data -- "C:\Personal\CG\Repos\TabletopArti\local\tabletop_scene_evaluation_150"
npm run check
```

第一条命令只安装图片转码所需的 `sharp`。第二条会把 900 张 PNG 一致地转为 1280×720、质量 90 的 WebP，写入 `dist/assets/`，并生成：

- `supabase/seed/catalog.json`：公开的场景层级和匿名资源文件名；
- `supabase/seed/plan.json`：750 个预采样任务；
- `supabase/seed/private-variants.json`：真实方法名映射。它被 `.gitignore` 排除，不应提交；
- `npm run check` 会验证分层、每轮无重复以及显示位置平衡。

原始 PNG 不会复制进仓库。匿名 WebP 文件名没有方法名；真实映射仅存于 Supabase 中，管理员权限下可见。

## 连接 Supabase

1. 新建一个 Supabase 项目。在 Authentication 中启用 Anonymous sign-ins。
2. 在 SQL Editor 中完整执行 [supabase/schema.sql](supabase/schema.sql)。
3. 编辑 `dist/config.js`，填入 Project URL 和 anon public key。anon key 可以公开；**绝不能**把 service role key 放进前端。
4. 在同一台机器、同一个 PowerShell 窗口中导入预采样任务：

   ```powershell
   $env:SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
   npm run seed
   ```

导入器拒绝向已有任务的数据库重复写入。它会插入 150 个场景、750 个任务、7,500 个任务场景行和 37,500 个匿名显示行。

在 Supabase 的 Authentication URL Configuration 里，添加最终 GitHub Pages 地址为 Site URL / Redirect URL；本地预览时也可添加 `http://localhost:8000`。

管理员使用单独发放的授权码进入 `/admin/`；同一浏览器会持续保留权限，直到主动退出、清除网站数据或研究人员轮换密码。若要轮换授权码，在 Supabase SQL Editor 执行（把文字替换成新的、足够长的码）：

```sql
update public.study_settings
set admin_code_hash = encode(digest('REPLACE_WITH_A_LONG_NEW_CODE', 'sha256'), 'hex')
where id = true;

delete from public.admin_sessions;
```

## GitHub Pages 部署

提交 `dist/assets/`、`dist/config.js`（只含 anon key）及其余源码后，仓库已带有 GitHub Actions 部署工作流。GitHub 仓库 Settings → Pages 中把 Source 设为 **GitHub Actions**，随后推送 `main` 即会发布静态站点。

```powershell
git add .
git commit -m "Build tabletop evaluation study"
git push origin main
```

参与者入口是网站根目录 `/`，管理员入口是 `/admin/`。不要把 service role key 或明文管理员码提交到 Git。
