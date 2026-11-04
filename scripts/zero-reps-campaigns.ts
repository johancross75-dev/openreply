/**
 * Validate and apply the Zero Reps campaign config (config/zero-reps/campaigns.json).
 *
 *   npm run zr:campaigns -- check [--spec other.json]
 *       Validates the file and prints keyword → destination. No database.
 *
 *   npm run zr:campaigns -- apply --account <instagram_username>
 *       DRY RUN: shows what would be created/updated in the database.
 *
 *   npm run zr:campaigns -- apply --account <instagram_username> --confirm
 *       Writes it. Refuses while any link, text or post ID is still PENDIENTE,
 *       and refuses while other active campaigns exist on the account (they
 *       could answer the same words) unless --deactivate-others is passed.
 *
 * Campaigns are matched by name, so re-running is safe: it updates in place and
 * keeps each campaign's tracked-link slug and click stats. List order is
 * priority — it is written to createdAt, which is the order the worker uses.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PLACEHOLDER,
  specSchema,
  validateSpec,
  type ZeroRepsCampaign,
} from "../lib/zero-reps/campaign-spec";

// --spec lets a filled-in copy be tested without touching the committed file.
const SPEC_PATH = (() => {
  const i = process.argv.indexOf("--spec");
  return i === -1
    ? path.join(__dirname, "../config/zero-reps/campaigns.json")
    : path.resolve(process.argv[i + 1]);
})();

function loadSpec() {
  const raw = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  return specSchema.parse(raw);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function describeCampaign(c: ZeroRepsCampaign): string {
  const kind = c.type === "free" ? "GRATIS  " : "DE PAGO ";
  const where =
    c.scope === "any-post" ? "cualquier post" : `posts ${(c.postIds ?? []).join(", ")}`;
  const dm = c.dmTrigger ? " + DMs/stories" : "";
  return `${kind} ${c.keywords.join(", ").padEnd(36)} → ${c.url}  (${where}${dm})`;
}

/** One database campaign per post for post-scoped entries (OpenReply binds one post per campaign). */
function expand(c: ZeroRepsCampaign) {
  if (c.scope === "any-post") return [{ name: c.name, postId: null as string | null }];
  const ids = c.postIds ?? [];
  return ids.map((postId) => ({
    name: ids.length === 1 ? c.name : `${c.name} [${postId}]`,
    postId,
  }));
}

function check(): boolean {
  const spec = loadSpec();
  const problems = validateSpec(spec);
  console.log("Campañas (en orden de prioridad):");
  spec.campaigns.forEach((c, i) => console.log(`  ${i + 1}. ${describeCampaign(c)}`));
  const errors = problems.filter((p) => p.severity === "error");
  const pending = problems.filter((p) => p.severity === "pending");
  if (errors.length) {
    console.log("\nERRORES (corregir antes de aplicar):");
    errors.forEach((p) => console.log(`  - ${p.campaign}: ${p.message}`));
  }
  if (pending.length) {
    console.log("\nPENDIENTES (no se inventan, hay que completarlos):");
    pending.forEach((p) => console.log(`  - ${p.campaign}: ${p.message}`));
  }
  if (!problems.length) console.log("\nTodo correcto: listo para aplicar.");
  return problems.length === 0;
}

async function apply() {
  const username = arg("--account");
  const confirm = process.argv.includes("--confirm");
  const deactivateOthers = process.argv.includes("--deactivate-others");
  if (!username) {
    console.error("Falta --account <usuario_de_instagram>");
    process.exit(2);
  }

  const ready = check();
  if (confirm && !ready) {
    console.error(`\nNo se aplica: hay errores o valores ${PLACEHOLDER}.`);
    process.exit(1);
  }

  const spec = loadSpec();
  const { prisma } = await import("../lib/db/client");
  const { generateTrackedLinkSlug } = await import("../lib/tracking/server");
  const { generateReportShareSlug } = await import("../lib/reports/share");
  const { TRACKED_LINK_ORDER } = await import("../lib/tracking/link-order");

  const account = await prisma.instagramAccount.findFirst({
    where: { username: username.replace(/^@/, "") },
  });
  if (!account) {
    console.error(`\nNo hay ninguna cuenta de Instagram conectada con el usuario "${username}".`);
    process.exit(1);
  }

  const wanted = spec.campaigns.flatMap((c) => expand(c).map((e) => ({ ...e, spec: c })));
  const wantedNames = new Set(wanted.map((w) => w.name));

  const others = await prisma.automation.findMany({
    where: { instagramAccountId: account.id, isActive: true, name: { notIn: [...wantedNames] } },
    select: { id: true, name: true, keywords: true },
  });
  if (others.length) {
    console.log("\nOtras campañas ACTIVAS en la cuenta (podrían responder a las mismas palabras):");
    others.forEach((o) => console.log(`  - ${o.name} [${o.keywords.join(", ")}]`));
    if (confirm && !deactivateOthers) {
      console.error("\nNo se aplica. Revísalas, o vuelve a ejecutar con --deactivate-others para pausarlas (no se borran).");
      process.exit(1);
    }
  }

  console.log(`\n${confirm ? "APLICANDO" : "SIMULACIÓN (sin --confirm no se escribe nada)"} en @${account.username}:`);
  const base = Date.now() - wanted.length * 1000;

  for (const [i, w] of wanted.entries()) {
    const c = w.spec;
    const existing = await prisma.automation.findFirst({
      where: { instagramAccountId: account.id, name: w.name },
      include: { trackedLinks: { orderBy: TRACKED_LINK_ORDER } },
    });
    const data = {
      goal: c.type === "free" ? "Guía gratuita (formulario Tally)" : "Venta El Método Zero",
      keywords: c.keywords,
      wholeWordMatch: true,
      matchAnyWord: false,
      matchAnyPost: w.postId === null,
      postId: w.postId,
      pendingNextReel: false,
      dmTriggerEnabled: c.dmTrigger,
      dmMessage: c.message,
      linkButtonLabel: c.buttonLabel,
      openingDmEnabled: false,
      requireFollow: false,
      publicReplyEnabled: false,
      isActive: true,
      // Priority order for the worker (oldest matching campaign wins).
      createdAt: new Date(base + i * 1000),
    };
    const primary = existing?.trackedLinks[0];
    const action = existing ? "actualizar" : "crear";
    const linkNote = primary
      ? primary.destinationUrl === c.url
        ? "enlace sin cambios"
        : `enlace ${primary.destinationUrl} → ${c.url}`
      : `enlace nuevo ${c.url}`;
    console.log(`  ${action.padEnd(10)} ${w.name}  (${linkNote})`);
    if (!confirm) continue;

    await prisma.$transaction(async (tx) => {
      const automation = existing
        ? await tx.automation.update({ where: { id: existing.id }, data })
        : await tx.automation.create({
            data: {
              ...data,
              name: w.name,
              workspaceId: account.workspaceId,
              instagramAccountId: account.id,
              reportShareSlug: generateReportShareSlug(),
            },
          });
      if (primary) {
        // Keep the slug so click stats carry over; extra buttons are removed so
        // the campaign sends exactly one destination.
        await tx.trackedLink.update({
          where: { id: primary.id },
          data: { destinationUrl: c.url, label: c.buttonLabel, position: 0 },
        });
        const extra = existing!.trackedLinks.slice(1).map((l) => l.id);
        if (extra.length) await tx.trackedLink.deleteMany({ where: { id: { in: extra } } });
      } else {
        await tx.trackedLink.create({
          data: {
            workspaceId: account.workspaceId,
            automationId: automation.id,
            slug: generateTrackedLinkSlug(),
            label: c.buttonLabel,
            destinationUrl: c.url,
            position: 0,
          },
        });
      }
    });
  }

  if (confirm && deactivateOthers && others.length) {
    await prisma.automation.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { isActive: false },
    });
    console.log(`  pausadas ${others.length} campañas que no están en la configuración`);
  }

  await prisma.$disconnect();
}

const command = process.argv[2];
if (command === "check") {
  process.exit(check() ? 0 : 1);
} else if (command === "apply") {
  apply().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else {
  console.log("Uso: npm run zr:campaigns -- check | apply --account <usuario> [--confirm] [--deactivate-others]");
  process.exit(2);
}
