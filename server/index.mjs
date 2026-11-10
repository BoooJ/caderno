import { createApp } from "./app.mjs";
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3090);
const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const password = process.env.APP_PASSWORD;
const minimumPasswordLength = process.env.APP_ALLOW_SHORT_PASSWORD === "true" ? 4 : 16;
if (
  production &&
  (!password || password.length < minimumPasswordLength || !origin.startsWith("https://"))
)
  throw new Error(
    `Définir APP_PASSWORD (${minimumPasswordLength} caractères minimum) et APP_ORIGIN (https) avant le déploiement.`,
  );
const { app } = createApp({
  password,
  origin,
  production,
  dataDir: process.env.DATA_DIR || "data",
});
app.listen(port, production ? "0.0.0.0" : "127.0.0.1", () =>
  console.log(
    `Caderno: http://localhost:${port} — ${production ? "accès protégé" : "développement local uniquement"}`,
  ),
);
