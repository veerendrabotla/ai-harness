const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/api/greeting", (_req, res) => {
  res.json({ message: "Hello from fixture app" });
});

const server = app.listen(PORT, () => {
  console.log(`Fixture app running on http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down");
  server.close(() => process.exit(0));
});
