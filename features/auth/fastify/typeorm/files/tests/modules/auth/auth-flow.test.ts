import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import errorHandler from "../../../src/plugins/error-handler.js";
import authPlugin from "../../../src/plugins/auth.js";
import requestIdPlugin from "../../../src/plugins/request-id.js";
import { dataSource } from "../../../src/db/data-source.js";
import { RefreshToken } from "../../../src/entities/refresh-token.js";
import { User } from "../../../src/entities/user.js";
import { VerificationToken } from "../../../src/entities/verification-token.js";
import { authRoutes } from "../../../src/modules/auth/index.js";

async function buildAuthApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: (req) =>
      (req.headers["x-request-id"] as string) || crypto.randomUUID(),
  });
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(errorHandler);
  await app.register(requestIdPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes);
  return app;
}

describe("auth signup -> login -> me flow", () => {
  let app: FastifyInstance;
  const email = `test-${Date.now()}@example.com`;
  const raceEmail = `race-${Date.now()}@example.com`;
  const password = "P@ssw0rd!2025"; // pragma: allowlist secret

  beforeAll(async () => {
    app = await buildAuthApp();
    await dataSource.getRepository(RefreshToken).clear();
    await dataSource.getRepository(VerificationToken).clear();
    await dataSource.getRepository(User).delete({ email });
  });

  afterAll(async () => {
    await dataSource.getRepository(User).delete({ email });
    await dataSource.getRepository(User).delete({ email: raceEmail });
    await app.close();
  });

  it("POST /auth/signup creates a user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, name: "Test User", password },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it("POST /auth/login returns tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.user.email).toBe(email);
  });

  it("POST /auth/login rejects wrong password with request_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "wrong-password" }, // pragma: allowlist secret
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.detail).toBe("Invalid credentials");
    expect(body.request_id).toBeTruthy();
  });

  it("GET /auth/me returns current user", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    const { access_token } = loginRes.json();

    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe(email);
  });

  it("POST /auth/refresh rotates the refresh token", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    const { refresh_token: oldRefresh } = loginRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token: oldRefresh },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refresh_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(oldRefresh);
  });

  it("POST /auth/refresh detects replay of revoked token", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    const { refresh_token } = loginRes.json();

    const first = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token },
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().detail).toBe("token_replay_detected");
  });

  it("POST /auth/refresh lets exactly one concurrent rotation win", async () => {
    const signupRes = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: raceEmail, name: "Race User", password },
    });
    const { refresh_token } = signupRes.json();

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/auth/refresh",
          payload: { refresh_token },
        }),
      ),
    );

    const winners = attempts.filter((r) => r.statusCode === 200);
    const losers = attempts.filter((r) => r.statusCode === 401);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(attempts.length - 1);
    for (const loser of losers) {
      expect(loser.json().detail).toBe("token_replay_detected");
    }
  });
});
