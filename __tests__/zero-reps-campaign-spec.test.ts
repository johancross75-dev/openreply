import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  routeText,
  specSchema,
  validateSpec,
  type ZeroRepsSpec,
} from "../lib/zero-reps/campaign-spec";

const realSpec = specSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "../config/zero-reps/campaigns.json"), "utf8"))
);

// The real file with test links filled in, so routing can be checked before
// the real links are known.
const MZ_POST = "post_metodo_zero";
const filled: ZeroRepsSpec = {
  campaigns: realSpec.campaigns.map((c, i) => ({
    ...c,
    message: `mensaje ${c.name}`,
    url: c.type === "free" ? `https://tally.so/r/form${i}` : "https://metodozero.example/landing",
    ...(c.scope === "posts" ? { postIds: [MZ_POST] } : {}),
  })),
};

const route = (text: string, source: Parameters<typeof routeText>[2]) =>
  routeText(filled, text, source)?.name ?? null;

describe("Zero Reps campaign config", () => {
  it("the committed config is structurally valid (only pending links/texts left)", () => {
    const problems = validateSpec(realSpec);
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("is ready once the real links and texts are filled in", () => {
    expect(validateSpec(filled)).toEqual([]);
  });

  it("covers exactly the agreed keywords: 6 free guides + 3 Método Zero words", () => {
    const free = realSpec.campaigns.filter((c) => c.type === "free").map((c) => c.keywords[0]);
    expect(free.sort()).toEqual(["DOMINADA", "FLEXIÓN", "GRASA", "HOMBRO", "MUNDO", "RUTINA"]);
    const commercial = realSpec.campaigns
      .filter((c) => c.type === "commercial")
      .flatMap((c) => c.keywords);
    expect(commercial).toEqual(expect.arrayContaining(["SÍ", "INFO", "MARAVILLA"]));
  });

  describe("commercial words → El Método Zero landing", () => {
    it.each(["INFO", "info porfa", "Información", "informacion", "MARAVILLA", "maravillas ✨"])(
      "%s (comment on any post) → Método Zero",
      (text) => {
        const c = routeText(filled, text, { kind: "comment", postId: "any_post" });
        expect(c?.type).toBe("commercial");
        expect(c?.url).toBe("https://metodozero.example/landing");
      }
    );

    it.each(["SÍ", "si", "Sí!!", "si quiero 🙌"])("%s on a Método Zero post → Método Zero", (text) => {
      expect(routeText(filled, text, { kind: "comment", postId: MZ_POST })?.type).toBe("commercial");
    });

    it("SÍ on any other post does nothing", () => {
      expect(route("sí", { kind: "comment", postId: "flexiones_post" })).toBeNull();
      expect(route("si, muy bueno el video", { kind: "comment", postId: "flexiones_post" })).toBeNull();
    });

    it("SÍ in a DM does nothing (ordinary conversation)", () => {
      expect(route("sí", { kind: "dm" })).toBeNull();
      expect(route("si claro, gracias", { kind: "dm" })).toBeNull();
    });

    it("INFO and MARAVILLA work by DM / story reply", () => {
      expect(routeText(filled, "info", { kind: "dm" })?.type).toBe("commercial");
      expect(routeText(filled, "MARAVILLA", { kind: "dm" })?.type).toBe("commercial");
    });
  });

  describe("free words → their own Tally form only", () => {
    it.each([
      ["RUTINA", "RUTINA"],
      ["rutinas", "RUTINA"],
      ["GRASA", "GRASA"],
      ["flexion", "FLEXIÓN"],
      ["Flexiones 💪", "FLEXIÓN"],
      ["dominadas", "DOMINADA"],
      ["hombro", "HOMBRO"],
      ["MUNDO", "MUNDO"],
    ])("%s → %s guide", (text, keyword) => {
      for (const source of [{ kind: "comment", postId: "x" } as const, { kind: "dm" } as const]) {
        const c = routeText(filled, text, source);
        expect(c?.type).toBe("free");
        expect(c?.keywords[0]).toBe(keyword);
        expect(new URL(c!.url).hostname).toBe("tally.so");
      }
    });

    it("each free guide sends a different form", () => {
      const urls = filled.campaigns.filter((c) => c.type === "free").map((c) => c.url);
      expect(new Set(urls).size).toBe(urls.length);
    });

    it("FLEXIÓN never routes to Método Zero", () => {
      expect(routeText(filled, "flexión", { kind: "comment", postId: MZ_POST })?.type).toBe("free");
    });
  });

  it("a message with a free word and a commercial word gets only the free guide", () => {
    expect(routeText(filled, "info de la rutina", { kind: "dm" })?.keywords[0]).toBe("RUTINA");
    expect(routeText(filled, "sí, quiero flexiones", { kind: "comment", postId: MZ_POST })?.keywords[0]).toBe("FLEXIÓN");
  });

  it.each(["hola", "qué buen video", "mundial", "grasoso", "sigo"])("%s triggers nothing", (text) => {
    expect(route(text, { kind: "comment", postId: MZ_POST })).toBeNull();
    expect(route(text, { kind: "dm" })).toBeNull();
  });

  describe("validation blocks wrong destinations", () => {
    const withCampaign = (index: number, patch: Partial<ZeroRepsSpec["campaigns"][number]>) => ({
      campaigns: filled.campaigns.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
    const freeIndex = filled.campaigns.findIndex((c) => c.type === "free");
    const mzIndex = filled.campaigns.findIndex((c) => c.type === "commercial");
    const sIndex = filled.campaigns.findIndex((c) => c.keywords.includes("SÍ"));
    const messages = (spec: ZeroRepsSpec) => validateSpec(spec).map((p) => p.message).join(" | ");

    it("free guide pointing to the sales page", () => {
      expect(messages(withCampaign(freeIndex, { url: "https://metodozero.example/landing" }))).toMatch(/Tally/);
    });
    it("free guide sending the PDF directly", () => {
      expect(messages(withCampaign(freeIndex, { url: "https://tally.so/guia.pdf" }))).toMatch(/PDF/);
    });
    it("two guides sharing one form", () => {
      expect(messages(withCampaign(freeIndex + 1, { url: filled.campaigns[freeIndex].url }))).toMatch(/mismo formulario/);
    });
    it("Método Zero pointing to a Tally form", () => {
      expect(messages(withCampaign(mzIndex, { url: "https://tally.so/r/abc" }))).toMatch(/landing/);
    });
    it("SÍ enabled for DMs or for every post", () => {
      expect(messages(withCampaign(sIndex, { dmTrigger: true }))).toMatch(/DM/);
      expect(messages(withCampaign(sIndex, { scope: "any-post", postIds: undefined }))).toMatch(/posts concretos/);
    });
    it("the same keyword in two campaigns", () => {
      expect(messages(withCampaign(mzIndex, { keywords: ["INFO", "FLEXIÓN"] }))).toMatch(/ya pertenece/);
    });
    it("pending links are reported, not guessed", () => {
      const pending = validateSpec(realSpec).filter((p) => p.severity === "pending");
      expect(pending.some((p) => /Tally/.test(p.message))).toBe(true);
      expect(pending.some((p) => /landing/.test(p.message))).toBe(true);
    });
  });
});
