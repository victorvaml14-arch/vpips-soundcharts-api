import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = "https://api.soundcharts.com/api/v2";

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/test-platforms", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${BASE}/platforms`, {
      method: "GET",
      headers: {
        "x-app-id": process.env.SOUNDCHARTS_APP_ID || "",
        "x-api-key": process.env.SOUNDCHARTS_API_KEY || "",
        "accept": "application/json",
        "user-agent": "vpips-soundcharts-app/1.0",
        "connection": "close"
      },
      signal: controller.signal
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({
      error: error.name === "AbortError" ? "timeout" : error.message
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
