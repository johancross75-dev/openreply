import { describe, expect, it } from "vitest";
import { checkDeploymentConfig, formatConfigReport } from "../lib/config-check";

const GOOD = {
  NEXTAUTH_URL: "https://zr.up.railway.app",
  NEXTAUTH_SECRET: "a-very-long-random-secret-value",
  DATABASE_URL: "postgresql://u:p@db:5432/x",
  REDIS_URL: "redis://redis:6379",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  WEBHOOK_VERIFY_TOKEN: "verify",
  INSTAGRAM_APP_ID: "123",
  INSTAGRAM_APP_SECRET: "igsecret",
  FACEBOOK_APP_SECRET: "fbsecret",
  EMAIL_SERVER: "smtps://owner%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465",
  EMAIL_FROM: "Zero Reps <owner@gmail.com>",
};

const names = (env: Record<string, string | undefined>) =>
  checkDeploymentConfig(env).issues.map((i) => `${i.severity}:${i.name}`);

describe("checkDeploymentConfig", () => {
  it("accepts a complete Gmail + Meta configuration", () => {
    const report = checkDeploymentConfig(GOOD);
    expect(report).toEqual({ ok: true, issues: [] });
  });

  it("flags the exact failure seen in production: secrets present but empty", () => {
    const report = checkDeploymentConfig({
      ...GOOD,
      EMAIL_SERVER: "",
      INSTAGRAM_APP_SECRET: "",
      FACEBOOK_APP_SECRET: "  ",
    });
    expect(report.ok).toBe(false);
    expect(names({ ...GOOD, EMAIL_SERVER: "", INSTAGRAM_APP_SECRET: "", FACEBOOK_APP_SECRET: "  " })).toEqual(
      expect.arrayContaining([
        "error:EMAIL_SERVER",
        "warning:INSTAGRAM_APP_SECRET",
        "warning:FACEBOOK_APP_SECRET",
      ])
    );
    const emailIssue = report.issues.find((i) => i.name === "EMAIL_SERVER");
    expect(emailIssue?.hint).toMatch(/falls back to Resend/);
  });

  it("never includes a variable's value in the report", () => {
    const secretValue = "SUPER-SECRET-VALUE-123";
    const report = checkDeploymentConfig({
      ...GOOD,
      INSTAGRAM_APP_SECRET: ` ${secretValue} `,
      EMAIL_SERVER: `smtps://owner@gmail.com:${secretValue}@smtp.gmail.com:465`,
    });
    expect(JSON.stringify(report)).not.toContain(secretValue);
    expect(formatConfigReport(report)).not.toContain(secretValue);
  });

  it("detects a variable saved with a space in its name", () => {
    const env: Record<string, string | undefined> = { ...GOOD };
    delete env.EMAIL_SERVER;
    env["EMAIL_SERVER "] = GOOD.EMAIL_SERVER;
    expect(names(env)).toContain("error:EMAIL_SERVER");
    const issue = checkDeploymentConfig(env).issues.find((i) => i.hint.includes("rename"));
    expect(issue).toBeDefined();
  });

  it("explains common SMTP URL mistakes", () => {
    const hint = (server: string) =>
      checkDeploymentConfig({ ...GOOD, EMAIL_SERVER: server }).issues.map((i) => i.hint).join(" | ");
    expect(hint("owner%40gmail.com:pw@smtp.gmail.com")).toMatch(/smtps:\/\//);
    expect(hint("smtps://owner@gmail.com:pw@smtp.gmail.com:465")).toMatch(/%40/);
    expect(hint("smtps://owner%40gmail.com:abcd%20efgh@smtp.gmail.com:465")).toMatch(/without spaces/);
    expect(hint('"smtps://owner%40gmail.com:pw@smtp.gmail.com:465"')).toMatch(/quotes/);
    expect(hint("smtps://@smtp.gmail.com:465")).toMatch(/user:password/);
  });

  it("requires some email transport", () => {
    const env: Record<string, string | undefined> = { ...GOOD };
    delete env.EMAIL_SERVER;
    expect(checkDeploymentConfig(env).ok).toBe(false);
    expect(checkDeploymentConfig({ ...env, RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co" }).ok).toBe(true);
  });

  it("warns when the Gmail sender differs from the SMTP user", () => {
    expect(names({ ...GOOD, EMAIL_FROM: "Zero Reps <other@gmail.com>" })).toEqual(["warning:EMAIL_FROM"]);
  });

  it("checks NEXTAUTH_URL shape", () => {
    expect(names({ ...GOOD, NEXTAUTH_URL: "http://zr.up.railway.app" })).toContain("error:NEXTAUTH_URL");
    expect(names({ ...GOOD, NEXTAUTH_URL: "https://zr.up.railway.app/" })).toEqual(["warning:NEXTAUTH_URL"]);
    expect(names({ ...GOOD, NEXTAUTH_URL: "http://localhost:3000" })).toEqual([]);
  });

  it("treats Meta secrets as warnings so a Zernio-only instance still passes", () => {
    const env: Record<string, string | undefined> = { ...GOOD };
    delete env.INSTAGRAM_APP_ID;
    delete env.INSTAGRAM_APP_SECRET;
    delete env.FACEBOOK_APP_SECRET;
    expect(checkDeploymentConfig(env).ok).toBe(true);
  });

  it("validates the encryption key format", () => {
    expect(names({ ...GOOD, ENCRYPTION_KEY: "short" })).toContain("error:ENCRYPTION_KEY");
  });
});
