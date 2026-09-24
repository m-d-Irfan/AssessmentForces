import { openApiDocument } from "../../src/config/swagger.js";

describe("OpenAPI contract", () => {
  it("documents the canonical API version and authentication scheme", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.info.version).toBe("1.4.0");
    expect(openApiDocument.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it.each([
    "/api/v1/auth/login",
    "/api/v1/payments/bkash/initiate",
    "/api/v1/recruitment-programs",
    "/api/v1/recruitment-programs/tasks/{progressId}/reviews",
    "/api/v1/admin/audit-logs",
  ])("documents %s", (path) => {
    expect(openApiDocument.paths).toHaveProperty(path);
  });
});
