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

app.get("/cm-link-artist", async (req, res) => {
  try {
    const artistId = Number(req.query.artist_id);
    const q = String(req.query.q || "").trim();

    if (!artistId || !q) {
      return res.status(400).json({ error: "artist_id and q are required" });
    }

    const accessToken = await getAccessToken();

    const r = await fetch(`${CM_BASE}/search?q=${encodeURIComponent(q)}&type=artists`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    const data = await r.json();
    const artists = data?.obj?.artists || [];

    if (!artists.length) {
      return res.status(404).json({ error: "No artists found in Chartmetric" });
    }

    // ✅ elegir el mejor: verified primero, luego más followers
    artists.sort((a, b) =>
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
      chosen_name: best.name
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
