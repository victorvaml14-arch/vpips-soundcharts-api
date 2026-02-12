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

async function getAccessToken() {
  const r = await fetch(`${CM_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      refreshtoken: process.env.CHARTMETRIC_REFRESH_TOKEN || ""
    })
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok || !data.token) {
    throw new Error(`token_error status=${r.status} body=${JSON.stringify(data)}`);
  }

  return data.token;
}

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/cm-test", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const accessToken = await getAccessToken();
    const url = `${CM_BASE}/search?q=drake&type=artists`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const text = await r.text();
    res.status(200).json({
      ok: r.ok,
      upstream_status: r.status,
      upstream_preview: text.slice(0, 800)
    });

  } catch (e) {
    res.status(200).json({
      ok: false,
      error: e.name === "AbortError" ? "timeout" : e.message
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/cm-sync-artist", async (req, res) => {
  try {
    const artistId = Number(req.query.artist_id);
    if (!artistId) {
      return res.status(400).json({ error: "artist_id required" });
    }

    // 1️⃣ Obtener chartmetric_artist_id desde Supabase
    const { data: rows, error } = await supabase
      .from("artists")
      .select("chartmetric_artist_id")
      .eq("id", artistId)
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    if (!rows?.length || !rows[0].chartmetric_artist_id) {
      return res.status(400).json({ error: "Artist not linked to Chartmetric yet" });
    }

    const cmId = rows[0].chartmetric_artist_id;

    // 2️⃣ Obtener access token
    const accessToken = await getAccessToken();

    // 3️⃣ Llamar endpoint Spotify stats
    const r = await fetch(
      `${CM_BASE}/artist/${cmId}/stat/spotify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: data });
    }

    const stats = data?.obj || {};

    // 4️⃣ Guardar métricas básicas en hourly_artist_metrics
    const ts = new Date();
    ts.setMinutes(0,0,0);

    const { error: insertError } = await supabase
      .from("hourly_artist_metrics")
      .upsert({
        ts_hour: ts.toISOString(),
        artist_id: artistId,
        streams_total: stats.listeners || 0,
        listeners_total: stats.listeners || 0,
        top_country_code: null,
        source: "chartmetric"
      });

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    return res.json({
      ok: true,
      chartmetric_id: cmId,
      listeners: stats.listeners,
      saved_at: ts
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
