const response = await fetch(`${BASE}/platforms`, {
  method: "GET",
  headers: {
    "x-app-id": process.env.SOUNDCHARTS_APP_ID,
    "x-api-key": process.env.SOUNDCHARTS_API_KEY,
    "accept": "application/json",
    "User-Agent": "vpips-soundcharts-app/1.0",
    "Connection": "close"
  }
});
