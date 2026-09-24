import request from "supertest";
import { createApp } from "../../src/app.js";

describe("HTTP hardening", () => {
  const app = createApp();

  it("replaces an invalid client request ID", async () => {
    const response = await request(app).get("/health").set("x-request-id", "bad id").expect(200);
    expect(response.headers["x-request-id"]).not.toBe("bad id");
    expect(response.headers["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("sets security and privacy headers", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects untrusted browser origins", async () => {
    const response = await request(app)
      .get("/api/v1")
      .set("origin", "https://attacker.example")
      .expect(403);
    expect(response.body.code).toBe("CORS_ORIGIN_DENIED");
  });

  it("returns a structured malformed-JSON error", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("content-type", "application/json")
      .send('{"email":')
      .expect(400);
    expect(response.body).toMatchObject({ success: false, code: "INVALID_JSON" });
  });

  it("rejects request bodies larger than the configured parser limit", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.com", password: "x".repeat(1_100_000) })
      .expect(413);
    expect(response.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects invalid authentication payloads before service access", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "short" })
      .expect(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});
