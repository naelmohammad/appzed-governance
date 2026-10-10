/**
 * AppZed governance (managed=true). Audits the account: tagged inventory,
 * untagged-resource detection, policy checks. Daily cron stores reports.
 * Bindings: AI, GOV (kv). Vars: CF_ACCOUNT_ID. Secrets: CF_API_TOKEN.
 */
const API = "https://api.cloudflare.com/client/v4";
const REQUIRED_TAGS = ["appzed:solution", "appzed:env", "appzed:customer", "appzed:managed"];

async function cf(env, path) {
  const res = await fetch(API + path, { headers: { authorization: "Bearer " + env.CF_API_TOKEN } });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    throw new Error("Cloudflare API " + path + " failed: HTTP " + res.status);
  }
  return json.result;
}

async function listAll(env, path) {
  const out = [];
  let page = 1;
  for (;;) {
    const res = await fetch(API + path + (path.includes("?") ? "&" : "?") + "per_page=100&page=" + page, {
      headers: { authorization: "Bearer " + env.CF_API_TOKEN },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success !== true) break;
    const rows = Array.isArray(json.result) ? json.result : [];
    out.push(...rows);
    const info = json.result_info || {};
    if (!info.total_pages || page >= info.total_pages) break;
    page += 1;
    if (page > 10) break;
  }
  return out;
}

async function inventory(env) {
  const acct = env.CF_ACCOUNT_ID;
  const results = await Promise.all([
    cf(env, "/accounts/" + acct + "/tags/resources?per_page=100").catch(() => []),
    listAll(env, "/accounts/" + acct + "/workers/scripts"),
    listAll(env, "/accounts/" + acct + "/queues"),
    listAll(env, "/accounts/" + acct + "/d1/database"),
    listAll(env, "/accounts/" + acct + "/storage/kv/namespaces"),
    listAll(env, "/accounts/" + acct + "/r2/buckets"),
  ]);
  return {
    tagged: Array.isArray(results[0]) ? results[0] : [],
    workers: results[1], queues: results[2], d1: results[3], kv: results[4], r2: results[5],
  };
}

function audit(inv) {
  const tagById = {};
  for (const t of inv.tagged) tagById[t.id] = t.tags || {};
  const pickName = (r) => r.name || r.title || r.queue_name || "?";
  const check = (rows, idFn, type) =>
    rows.map((r) => {
      const id = idFn(r);
      const tags = tagById[id] || {};
      const missing = REQUIRED_TAGS.filter((k) => !(k in tags));
      return { type, id, name: pickName(r), managed: pickName(r).startsWith("appzed-"), missing };
    });
  const rows = [
    ...check(inv.workers, (r) => r.id || r.name, "worker"),
    ...check(inv.queues, (r) => r.queue_id || r.queue_name, "queue"),
    ...check(inv.d1, (r) => r.uuid || r.name, "d1"),
    ...check(inv.kv, (r) => r.id || r.title, "kv"),
    ...check(inv.r2, (r) => r.name, "r2"),
  ];
  const violations = rows.filter((r) => r.managed && r.missing.length > 0);
  return {
    at: new Date().toISOString(),
    totals: { resources: rows.length, managed: rows.filter((r) => r.managed).length, violations: violations.length },
    violations,
  };
}

async function summarize(env, auditResult) {
  try {
    const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
      messages: [
        { role: "system", content: "You are a cloud governance analyst. Summarize the audit in 5 bullets. Be specific." },
        { role: "user", content: JSON.stringify(auditResult).slice(0, 8000) },
      ],
      max_tokens: 400,
    });
    return out.response || "";
  } catch {
    return "";
  }
}

async function runAudit(env) {
  const result = audit(await inventory(env));
  result.summary = await summarize(env, result);
  await env.GOV.put("audit:latest", JSON.stringify(result));
  await env.GOV.put("audit:" + result.at.slice(0, 10), JSON.stringify(result));
  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
      return Response.json({ error: "Missing CF_API_TOKEN secret or CF_ACCOUNT_ID var." }, { status: 500 });
    }
    try {
      if (url.pathname === "/health") return Response.json({ ok: true, solution: "governance" });
      if (url.pathname === "/inventory") {
        const inv = await inventory(env);
        return Response.json({
          tagged: inv.tagged.length, workers: inv.workers.length, queues: inv.queues.length,
          d1: inv.d1.length, kv: inv.kv.length, r2: inv.r2.length,
        });
      }
      if (url.pathname === "/audit") return Response.json(await runAudit(env));
      if (url.pathname === "/report") {
        const latest = await env.GOV.get("audit:latest", "json");
        if (!latest) return Response.json({ error: "No audit yet. GET /audit to run one." }, { status: 404 });
        return Response.json(latest);
      }
      if (url.pathname === "/policy") {
        return Response.json({ required_tags: REQUIRED_TAGS, note: "Every appzed-managed resource must carry all tags." });
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return Response.json({ error: String((err && err.message) || err) }, { status: 502 });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAudit(env).catch(() => null));
  },
};
