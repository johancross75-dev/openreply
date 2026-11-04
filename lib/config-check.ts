/**
 * Deployment configuration check.
 *
 * A self-hosted instance fails in confusing ways when an environment variable
 * is present but empty: an empty EMAIL_SERVER silently falls back to Resend and
 * magic-link sign-in errors with a Resend message, and an empty app secret makes
 * every webhook fail signature verification. Hosting dashboards (Railway,
 * Dokploy, Vercel) make it easy to save a variable with no value, with a stray
 * space in its name, or with the value wrapped in quotes.
 *
 * This reports which variables have a problem and why, so the fix is obvious
 * from /api/health, the worker log or `npm run check:env`. It never returns or
 * logs a variable's value — only its name and a fixed hint.
 */

const HEX_32_BYTE = /^[a-f0-9]{64}$/i;

export type ConfigSeverity = "error" | "warning";

export interface ConfigIssue {
  name: string;
  severity: ConfigSeverity;
  hint: string;
}

export interface ConfigReport {
  ok: boolean;
  issues: ConfigIssue[];
}

type Env = Record<string, string | undefined>;

const CORE_VARS = [
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "ENCRYPTION_KEY",
  "WEBHOOK_VERIFY_TOKEN",
] as const;

// Needed for the direct Meta connection. A Zernio-only instance does not use
// them, so they are warnings rather than errors.
const META_VARS = [
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "FACEBOOK_APP_SECRET",
] as const;

const KNOWN_VARS = [
  ...CORE_VARS,
  ...META_VARS,
  "EMAIL_SERVER",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "ALLOWED_EMAILS",
  "CRON_SECRET",
  "META_GRAPH_API_VERSION",
];

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isQuoted(value: string): boolean {
  return (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  );
}

/** Problem with a plain "must be set" variable, or null when it is fine. */
function presenceProblem(env: Env, name: string): string | null {
  const value = env[name];
  if (value === undefined) return "is not set";
  if (value.trim() === "") return "is set but empty — edit it and paste the value again";
  if (value !== value.trim()) return "has leading or trailing spaces — remove them";
  if (isQuoted(value)) return "is wrapped in quotes — remove the quotes";
  return null;
}

function emailAddressOf(from: string): string | null {
  const angle = from.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : from).trim().toLowerCase();
  return address.includes("@") ? address : null;
}

function checkEmail(env: Env, issues: ConfigIssue[]) {
  const server = env.EMAIL_SERVER;
  const resend = env.RESEND_API_KEY;

  // auth.ts picks SMTP only when EMAIL_SERVER is truthy, so an empty value
  // means Resend is used instead.
  if (!server) {
    if (server !== undefined) {
      issues.push({
        name: "EMAIL_SERVER",
        severity: "error",
        hint: "is set but empty, so sign-in falls back to Resend — paste the SMTP URL again",
      });
    }
    if (!resend || !resend.trim()) {
      issues.push({
        name: server === undefined ? "EMAIL_SERVER" : "RESEND_API_KEY",
        severity: "error",
        hint: "no email transport configured — set EMAIL_SERVER (SMTP) or RESEND_API_KEY, or magic-link sign-in cannot send",
      });
    }
    return;
  }

  const trimmed = server.trim();
  if (trimmed !== server) {
    issues.push({ name: "EMAIL_SERVER", severity: "error", hint: "has leading or trailing spaces — remove them" });
    return;
  }
  if (isQuoted(server)) {
    issues.push({ name: "EMAIL_SERVER", severity: "error", hint: "is wrapped in quotes — remove the quotes" });
    return;
  }
  if (!/^smtps?:\/\//i.test(server)) {
    issues.push({
      name: "EMAIL_SERVER",
      severity: "error",
      hint: "must start with smtps:// (port 465) or smtp:// (port 587)",
    });
    return;
  }

  // Split by hand: credentials may contain characters URL parsers reject, and
  // the point here is to explain the mistake, not to throw on it.
  const rest = server.replace(/^smtps?:\/\//i, "");
  const at = rest.lastIndexOf("@");
  const credentials = at === -1 ? "" : rest.slice(0, at);
  const host = (at === -1 ? rest : rest.slice(at + 1)).split(/[:/]/)[0].toLowerCase();
  const colon = credentials.indexOf(":");
  const user = colon === -1 ? credentials : credentials.slice(0, colon);
  const password = colon === -1 ? "" : credentials.slice(colon + 1);

  if (!host) {
    issues.push({ name: "EMAIL_SERVER", severity: "error", hint: "has no mail server host after the @" });
  }
  if (!user || !password) {
    issues.push({
      name: "EMAIL_SERVER",
      severity: "error",
      hint: "needs user:password before the host, e.g. smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465",
    });
  }
  if (user.includes("@")) {
    issues.push({
      name: "EMAIL_SERVER",
      severity: "error",
      hint: "the @ inside the username must be written as %40 (you%40gmail.com)",
    });
  }
  if (host === "smtp.gmail.com" && /\s/.test(decodeSafe(password))) {
    issues.push({
      name: "EMAIL_SERVER",
      severity: "error",
      hint: "the Gmail app password must be the 16 letters without spaces",
    });
  }

  const from = env.EMAIL_FROM;
  if (!from || !from.trim()) {
    issues.push({
      name: "EMAIL_FROM",
      severity: "error",
      hint: "must be set when EMAIL_SERVER is used, e.g. Your Name <you@gmail.com>",
    });
  } else if (host === "smtp.gmail.com") {
    const fromAddress = emailAddressOf(from);
    const smtpUser = decodeSafe(user).toLowerCase();
    if (fromAddress && smtpUser.includes("@") && fromAddress !== smtpUser) {
      issues.push({
        name: "EMAIL_FROM",
        severity: "warning",
        hint: "Gmail sends from the signed-in address; use the same address as the EMAIL_SERVER user",
      });
    }
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function checkDeploymentConfig(env: Env = process.env): ConfigReport {
  const issues: ConfigIssue[] = [];

  // A dashboard that keeps a stray space in the name creates "EMAIL_SERVER "
  // next to (or instead of) "EMAIL_SERVER", and the app only reads the latter.
  for (const key of Object.keys(env)) {
    const normalized = key.trim().toUpperCase();
    if (key !== normalized && KNOWN_VARS.includes(normalized)) {
      issues.push({
        name: normalized,
        severity: "error",
        hint: `a variable named "${key}" exists — its name has spaces or lowercase letters; rename it to ${normalized}`,
      });
    }
  }

  for (const name of CORE_VARS) {
    const problem = presenceProblem(env, name);
    if (problem) issues.push({ name, severity: "error", hint: problem });
  }

  const url = env.NEXTAUTH_URL?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && !isLocalhost(parsed.hostname)) {
        issues.push({
          name: "NEXTAUTH_URL",
          severity: "error",
          hint: "must use https:// — Meta rejects non-HTTPS redirect and webhook URLs",
        });
      }
      if (parsed.pathname !== "/" || url.endsWith("/")) {
        issues.push({
          name: "NEXTAUTH_URL",
          severity: "warning",
          hint: "should be just the origin with no path or trailing slash, e.g. https://your-app.up.railway.app",
        });
      }
    } catch {
      issues.push({ name: "NEXTAUTH_URL", severity: "error", hint: "is not a valid URL" });
    }
  }

  const secret = env.NEXTAUTH_SECRET;
  if (secret && secret.trim() && secret.trim().length < 16) {
    issues.push({ name: "NEXTAUTH_SECRET", severity: "error", hint: "must be at least 16 characters" });
  }

  const key = env.ENCRYPTION_KEY?.trim();
  if (key && !HEX_32_BYTE.test(key)) {
    issues.push({
      name: "ENCRYPTION_KEY",
      severity: "error",
      hint: "must be 64 hex characters (generate with: openssl rand -hex 32)",
    });
  }

  for (const name of META_VARS) {
    const problem = presenceProblem(env, name);
    if (problem) {
      issues.push({
        name,
        severity: "warning",
        hint: `${problem} (required when you connect Instagram with your own Meta app instead of Zernio)`,
      });
    }
  }

  checkEmail(env, issues);

  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}

export function formatConfigReport(report: ConfigReport): string {
  if (report.issues.length === 0) return "Configuration OK: all checked variables are set.";
  const lines = report.issues.map(
    (issue) => `  [${issue.severity.toUpperCase()}] ${issue.name}: ${issue.hint}`
  );
  const head = report.ok
    ? "Configuration OK with warnings:"
    : "Configuration problems found (values are never printed):";
  return [head, ...lines].join("\n");
}
