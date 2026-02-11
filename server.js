import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

const BASE = "https://api.soundcharts.com/api/v2";

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/test-platforms", async (req, res) => {
  try {
    const response = await fetch(`${BASE}/platforms`, {
      headers: {
        "x-app-id": process.env.SOUNDCHARTS_APP_ID,
        "x-api-key": process.env.SOUNDCHARTS_API_KEY,
        "accept": "application/json",
      },
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
