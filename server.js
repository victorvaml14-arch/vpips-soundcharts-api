import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

const CM_BASE = "https://api.chartmetric.com/api";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Safety: evitar que se caiga el proceso por errores ---
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});

// --- Auth: obtener access token desde refresh token ---
async function getAccessToken() {
  const r = await fetch(`${CM_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      refreshtoken: process.env.CHARTMETRIC_REFRESH_TOKEN || "",
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) {
    throw new Error(`token_error status=${r.status} body=${JSON.stringify(data)}`);
  }
  return data.token;
}

// --- Basic routes ---
app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.json({ ok: true }));

// --- Test: Chartmetric search ---
app.get("/cm-test", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const r = await fetch(`${CM_BASE}/search?q=drake&type=artists`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const text = await r.text();
    res.status(200).json({
      ok: r.ok,
      upstream_status: r.status,
      upstream_preview: text.slice(0, 800),
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
});

// --- Link artist: guarda chartmetric_artist_id en Supabase ---
app.get("/cm-link-artist", async (req, res) => {
  try {
    const artistId = Number(req.query.artist_id);
    const q = String(req.query.q || "").trim();
    if (!artistId || !q) return res.status(400).json({ error: "artist_id and q are required" });

    const accessToken = await getAccessToken();

    const r = await fetch(`${CM_BASE}/search?q=${encodeURIComponent(q)}&type=artists`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    const data = await r.json().catch(() => ({}));
    const artists = data?.obj?.artists || [];
    if (!artists.length) return res.status(404).json({ error: "No artists found in Chartmetric" });

    // Prefer verified + higher followers
    artists.sort(
      (a, b) =>
        (b.verified === true) - (a.verified === true) ||
        (b.sp_followers || 0) - (a.sp_followers || 0)
    );

    const best = artists[0];

    const { error } = await supabase
      .from("artists")
      .update({ chartmetric_artist_id: best.id })
      .eq("id", artistId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ok: true,
      artist_id: artistId,
      chartmetric_artist_id: best.id,
      chosen_name: best.name,
      verified: best.verified === true,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Sync ONE artist: guarda métricas + USD estimado ---
app.get("/cm-sync-artist", async (req, res) => {
  try {
    const artistId = Number(req.query.artist_id);
    if (!artistId) return res.status(400).json({ error: "artist_id required" });

    // 1) chartmetric_artist_id
    const { data: rows, error: e1 } = await supabase
      .from("artists")
      .select("id, chartmetric_artist_id")
      .eq("id", artistId)
      .limit(1);

    if (e1) return res.status(500).json({ error: e1.message });
    if (!rows?.length || !rows[0].chartmetric_artist_id) {
      return res.status(400).json({ error: "artist has no chartmetric_artist_id yet" });
    }

    const cmId = rows[0].chartmetric_artist_id;

    // 2) token
    const accessToken = await getAccessToken();

    // 3) spotify stats
    const r = await fetch(`${CM_BASE}/artist/${cmId}/stat/spotify`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(500).json({ error: `upstream ${r.status}`, body: data });
    }

    // 4) latest listeners
    const stats = data?.obj || {};
    const listenersHistory = stats?.listeners || [];

    const latestListeners =
      Array.isArray(listenersHistory) && listenersHistory.length
        ? Number(listenersHistory[listenersHistory.length - 1].value || 0)
        : 0;

    // 5) hour timestamp
    const ts = new Date();
    ts.setMinutes(0, 0, 0);
    const tsHour = ts.toISOString();

    // 6) upsert metrics
    const { error: upsertErr } = await supabase
      .from("hourly_artist_metrics")
      .upsert({
        ts_hour: tsHour,
        artist_id: artistId,
        streams_total: latestListeners,
        listeners_total: latestListeners,
        top_country_code: null,
        source: "chartmetric",
      });

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    // 7) estimate USD (modelo simple global)
    const payoutPerStream = 0.0035;
    const estimatedUsd = Number((latestListeners * payoutPerStream).toFixed(6));

    const { error: revErr } = await supabase
      .from("hourly_artist_revenue_estimate")
      .upsert({
        ts_hour: tsHour,
        artist_id: artistId,
        estimated_usd: estimatedUsd,
      });

    if (revErr) return res.status(500).json({ error: revErr.message });

    return res.json({
      ok: true,
      artist_id: artistId,
      chartmetric_id: cmId,
      ts_hour: tsHour,
      latest_listeners: latestListeners,
      payout_per_stream: payoutPerStream,
      estimated_usd: estimatedUsd,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Sync ALL active artists ---
app.get("/cm-sync-all", async (req, res) => {
  try {
    const { data: artists, error } = await supabase
      .from("artists")
      .select("id")
      .eq("is_active", true);

    if (error) return res.status(500).json({ error: error.message });
    if (!artists?.length) return res.json({ ok: true, synced_artists: 0 });

    const results = [];
    for (const a of artists) {
      try {
        // Llama tu propio endpoint (simple y suficiente)
        const rr = await fetch(
          `https://imaginative-passion-production.up.railway.app/cm-sync-artist?artist_id=${a.id}`
        );
        results.push({ artist_id: a.id, status: rr.status });
      } catch (e) {
        results.push({ artist_id: a.id, status: "error", error: e.message });
      }
    }

    return res.json({
      ok: true,
      synced_artists: artists.length,
      results,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
