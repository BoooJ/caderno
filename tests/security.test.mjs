import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../server/app.mjs";

const origin = "https://security-test.example";
const password = "synthetic-security-test-password";
async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "caderno-security-"));
  const { app, db } = createApp({ dataDir, password, origin, production: true });
  const server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const request = (path, { method = "GET", body, cookie = "", from = origin } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Origin: from, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { db, request };
}

test("security: private endpoints reject anonymous and forged sessions", async t => {
  const { request } = await setup(t);
  for (const path of ["/api/entries", "/api/export", "/api/verbs", "/api/usage"]) {
    for (const cookie of ["", "caderno=forged-session"]) {
      const response = await request(path, { cookie });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
});

test("security: production cookies, hashed tokens, expiry and logout", async t => {
  const { request, db } = await setup(t);
  const response = await request("/api/login", { method: "POST", body: { password } });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie");
  for (const flag of [/HttpOnly/, /Secure/, /SameSite=Strict/]) assert.match(header, flag);
  const cookie = header.split(";")[0];
  const token = cookie.slice("caderno=".length);
  const saved = db.prepare("SELECT token FROM sessions").get().token;
  assert.notEqual(saved, token);
  assert.equal(saved, createHash("sha256").update(token).digest("hex"));
  db.prepare("UPDATE sessions SET expires=0").run();
  assert.equal((await request("/api/export", { cookie })).status, 401);
  const login = await request("/api/login", { method: "POST", body: { password } });
  const renewed = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("/api/logout", { method: "POST", body: {}, cookie: renewed })).status, 200);
  assert.equal((await request("/api/export", { cookie: renewed })).status, 401);
});

test("security: login rejects foreign origins and limits guesses", async t => {
  const { request } = await setup(t);
  for (const from of ["https://other.example", "null", ""]) {
    assert.equal((await request("/api/login", { method: "POST", body: { password }, from })).status, 403);
  }
  for (let i = 0; i < 10; i++) {
    assert.equal((await request("/api/login", { method: "POST", body: { password: "wrong" } })).status, 401);
  }
  assert.equal((await request("/api/login", { method: "POST", body: { password: "wrong" } })).status, 429);
});

test("security: production responses include browser protection headers", async t => {
  const { request } = await setup(t);
  const response = await request("/api/session");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("strict-transport-security"));
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
