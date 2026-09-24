import request from "supertest";
import { createApp } from "../src/app.js";

describe("system endpoints", () => {
  const app = createApp();

  it("returns a healthy liveness response", async () => {
    const response = await request(app).get("/health").expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("up");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("preserves an incoming request ID", async () => {
    const response = await request(app).get("/health").set("x-request-id", "test-request-id");
    expect(response.headers["x-request-id"]).toBe("test-request-id");
  });

  it("serves the versioned API root", async () => {
    const response = await request(app).get("/api/v1").expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { version: "v1", documentation: "/api-docs/" },
    });
  });

  it("returns the OpenAPI document", async () => {
    const response = await request(app).get("/api-docs.json").expect(200);
    expect(response.body.openapi).toBe("3.1.0");
  });

  it("returns a structured 404 response", async () => {
    const response = await request(app).get("/missing-route").expect(404);
    expect(response.body).toMatchObject({ success: false, code: "ROUTE_NOT_FOUND", errors: [] });
    expect(response.body.requestId).toBeTruthy();
  });
});
