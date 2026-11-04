/**
 * Zero Reps campaign spec: the permanent keyword → destination map, kept in
 * config/zero-reps/campaigns.json and validated here before it can be applied.
 *
 * Two kinds of campaign, never mixed:
 *   - free:        a free guide. Sends ONLY its own Tally form (never the PDF,
 *                  never the sales page). Every free campaign has its own form.
 *   - commercial:  El Método Zero (paid). Sends ONLY the sales landing page,
 *                  never a Tally form.
 *
 * "SÍ" is a very common word, so a commercial campaign keyed on it must be
 * bound to specific posts and must not fire on DMs, where it would answer
 * ordinary conversation.
 */
import { z } from "zod";
import { matchKeywords } from "@/lib/utils/keyword-matcher";

export const PLACEHOLDER = "PENDIENTE";

const campaignSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["free", "commercial"]),
  keywords: z.array(z.string().min(1).max(50)).min(1).max(10),
  scope: z.enum(["any-post", "posts"]),
  postIds: z.array(z.string().min(1)).optional(),
  dmTrigger: z.boolean(),
  message: z.string().min(1).max(1000),
  // OpenReply caps button labels at 20 characters.
  buttonLabel: z.string().min(1).max(20),
  url: z.string().min(1),
});

export const specSchema = z.object({
  $comment: z.string().optional(),
  campaigns: z.array(campaignSchema).min(1),
});

export type ZeroRepsCampaign = z.infer<typeof campaignSchema>;
export type ZeroRepsSpec = z.infer<typeof specSchema>;

export interface SpecProblem {
  campaign: string;
  severity: "error" | "pending";
  message: string;
}

// Words so common in Spanish conversation that a campaign keyed on them must
// stay off DMs and be bound to specific posts.
const COMMON_WORDS = new Set(["si", "no", "ok", "hola", "gracias", "yo", "quiero"]);

function fold(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isTally(host: string): boolean {
  return host === "tally.so" || host.endsWith(".tally.so");
}

const FILE_EXTENSION = /\.(pdf|zip|docx?|pptx?|epub)(\?|#|$)/i;

export function validateSpec(spec: ZeroRepsSpec): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const keywordOwner = new Map<string, string>();
  const freeUrlOwner = new Map<string, string>();
  const names = new Set<string>();

  for (const c of spec.campaigns) {
    const err = (message: string) => problems.push({ campaign: c.name, severity: "error", message });
    const pending = (message: string) => problems.push({ campaign: c.name, severity: "pending", message });

    if (names.has(c.name)) err("nombre de campaña duplicado");
    names.add(c.name);

    // The same keyword in two campaigns makes the destination depend on list
    // order instead of on the keyword — exactly the FLEXIÓN/INFO mix-up.
    for (const keyword of c.keywords) {
      const key = fold(keyword);
      const owner = keywordOwner.get(key);
      if (owner && owner !== c.name) {
        err(`la palabra "${keyword}" ya pertenece a "${owner}"`);
      }
      keywordOwner.set(key, c.name);
    }

    const common = c.keywords.filter((k) => COMMON_WORDS.has(fold(k)));
    if (common.length > 0) {
      if (c.dmTrigger) {
        err(`"${common.join(", ")}" es una palabra muy común: no puede activarse por DM`);
      }
      if (c.scope !== "posts") {
        err(`"${common.join(", ")}" es una palabra muy común: debe limitarse a posts concretos`);
      }
    }

    if (c.scope === "posts") {
      const ids = c.postIds ?? [];
      if (ids.length === 0) err("scope 'posts' necesita al menos un postId");
      if (ids.some((id) => id === PLACEHOLDER)) pending("falta el ID del post de Instagram");
    } else if (c.postIds?.length) {
      err("scope 'any-post' no usa postIds");
    }

    if (c.message.trim() === PLACEHOLDER) pending("falta el texto del mensaje");

    if (c.url.trim() === PLACEHOLDER) {
      pending(c.type === "free" ? "falta el enlace del formulario de Tally" : "falta el enlace de la landing de El Método Zero");
      continue;
    }

    const host = hostOf(c.url);
    if (!host) {
      err("el enlace debe ser una URL https:// válida");
      continue;
    }
    if (FILE_EXTENSION.test(new URL(c.url).pathname)) {
      err("el enlace apunta a un archivo directo; las guías se entregan con el formulario, no con el PDF");
    }

    if (c.type === "free") {
      if (!isTally(host)) err("una guía gratuita debe enviar su formulario de Tally (tally.so)");
      const owner = freeUrlOwner.get(c.url);
      if (owner) err(`usa el mismo formulario que "${owner}": cada guía tiene su propio formulario`);
      freeUrlOwner.set(c.url, c.name);
    } else if (isTally(host)) {
      err("El Método Zero es de pago: debe enviar la landing de venta, no un formulario de Tally");
    }
  }

  return problems;
}

export function readyToApply(problems: SpecProblem[]): boolean {
  return problems.length === 0;
}

/**
 * Which campaign answers a piece of text, following the same rules the worker
 * applies: first matching campaign in order wins, whole-word matching, accents
 * folded. `source` is where the text came from and `postId` is the post a
 * comment was left on.
 */
export function routeText(
  spec: ZeroRepsSpec,
  text: string,
  source: { kind: "comment"; postId: string } | { kind: "dm" }
): ZeroRepsCampaign | null {
  for (const c of spec.campaigns) {
    if (source.kind === "dm" && !c.dmTrigger) continue;
    if (source.kind === "comment" && c.scope === "posts" && !(c.postIds ?? []).includes(source.postId)) {
      continue;
    }
    if (matchKeywords(text, c.keywords, true).matched) return c;
  }
  return null;
}
