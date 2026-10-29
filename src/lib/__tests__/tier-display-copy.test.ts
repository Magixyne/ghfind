import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_EN, TIER_LABEL_EN, TIER_ZH } from "../badge";
import { tierFor } from "../score-presentation";
import { TIER_STYLES, tierStyle } from "../tier";
import { V13_SNARK_BANNED_EN, V13_SNARK_BANNED_ZH } from "../roast-v13/voice";

/** Derogatory / mocking / obsolete display strings that must not appear in tier *display* copy. */
const BANNED_TIER_DISPLAY = [
  "拉完了",
  "TRASH",
  "Trash",
  "trash",
  "終わってる",
  "나락",
  "低价值",
  "Low-value",
  "Likely farmed",
  "疑似刷量",
  "AI 机器人",
  "💩",
  // obsolete NPC display (stored key remains "NPC")
  "普通账号",
  "特征平庸",
  "平庸存疑",
  "平庸",
  "Average · Unremarkable",
  "Unremarkable",
  "量産型",
  "特筆事項なし",
  "평범한 계정",
  "존재감 없음",
  "Promedio · Nada memorable",
  "Mediano · Sem destaque",
  "Rata-rata · Biasa saja",
  "Trung bình · Không có gì nổi bật",
  "عادي · لا شيء يلفت",
  "探索者",
  "成长中",
  "Rising",
  "RISING",
  "🧭",
  "🫥",
  "📈",
];

function assertClean(label: string, text: string) {
  for (const banned of BANNED_TIER_DISPLAY) {
    expect(text, `${label} must not contain ${JSON.stringify(banned)}`).not.toContain(banned);
  }
}

describe("lowest-tier display copy (newbie village)", () => {
  it("maps the stored 拉完了 key to friendly zh/en badge words", () => {
    expect(TIER_ZH["拉完了"]).toBe("新手村");
    expect(TIER_EN["拉完了"]).toBe("NEWBIE");
    assertClean("TIER_ZH", TIER_ZH["拉完了"]);
    assertClean("TIER_EN", TIER_EN["拉完了"]);
    assertClean("TIER_LABEL_EN", TIER_LABEL_EN["拉完了"]);
  });

  it("keeps score→tier key stable while soft-labelling the blurb", () => {
    const low = tierFor(12);
    expect(low.tier).toBe("拉完了"); // stored/canonical key unchanged
    assertClean("tierFor.blurb", low.tier_label);
    expect(tierStyle("拉完了").emoji).toBe("🌱");
    assertClean("TIER_STYLES.blurb", TIER_STYLES["拉完了"].blurb);
  });

  it("uses friendly trash.name/blurb in every locale messages file", () => {
    const dir = join(__dirname, "../../messages");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        tiers: { trash: { name: string; blurb: string } };
      };
      const { name, blurb } = data.tiers.trash;
      assertClean(`${file} tiers.trash.name`, name);
      assertClean(`${file} tiers.trash.blurb`, blurb);
      expect(name.length).toBeGreaterThan(0);
      expect(blurb.length).toBeGreaterThan(0);
    }
  });

  it("bans old derogatory tier labels from roast output lexicons", () => {
    expect(V13_SNARK_BANNED_ZH).toEqual(
      expect.arrayContaining(["拉完了", "低价值", "普通账号", "平庸"]),
    );
    expect(V13_SNARK_BANNED_EN.map((s) => s.toLowerCase())).toEqual(
      expect.arrayContaining(["low-value", "likely farmed", "unremarkable", "mediocre"]),
    );
  });
});

describe("mid-tier display copy (Apprentice / 学徒)", () => {
  it("maps the stored NPC key to Apprentice / 学徒 badge words", () => {
    expect(TIER_ZH.NPC).toBe("学徒");
    expect(TIER_EN.NPC).toBe("APPRENTICE");
    expect(TIER_LABEL_EN.NPC).toBe("Steadily building · Keep polishing");
    assertClean("TIER_ZH.NPC", TIER_ZH.NPC);
    assertClean("TIER_EN.NPC", TIER_EN.NPC);
    assertClean("TIER_LABEL_EN.NPC", TIER_LABEL_EN.NPC);
  });

  it("keeps score→tier key stable while soft-labelling the blurb", () => {
    const mid = tierFor(42);
    expect(mid.tier).toBe("NPC"); // stored/canonical key unchanged
    expect(mid.tier_label).toBe("稳步积累 · 继续打磨作品");
    assertClean("tierFor.blurb", mid.tier_label);
    expect(tierStyle("NPC").emoji).toBe("📜");
    assertClean("TIER_STYLES.blurb", TIER_STYLES.NPC.blurb);
  });

  it("uses Apprentice-style npc.name/blurb in every locale (no 探索者 / person-title)", () => {
    const expected: Record<string, { name: string; blurb: string }> = {
      "zh.json": { name: "学徒", blurb: "稳步积累 · 继续打磨作品" },
      "en.json": { name: "Apprentice", blurb: "Steadily building · Keep polishing" },
      "ja.json": { name: "見習い", blurb: "着実に積み上げ · 作品を磨こう" },
      "ko.json": { name: "견습생", blurb: "차곡차곡 쌓는 중 · 작품을 다듬자" },
      "es.json": { name: "Aprendiz", blurb: "Construyendo con constancia · Sigue puliendo" },
      "pt.json": { name: "Aprendiz", blurb: "Construindo com constância · Continue polindo" },
      "id.json": { name: "Murid", blurb: "Terus menumpuk · Asah karyamu" },
      "vi.json": { name: "Học việc", blurb: "Tích lũy đều · Tiếp tục mài giũa" },
      "ar.json": { name: "متدرب", blurb: "تراكم ثابت · واصل الصقل" },
    };
    const dir = join(__dirname, "../../messages");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        tiers: { npc: { name: string; blurb: string } };
      };
      const { name, blurb } = data.tiers.npc;
      assertClean(`${file} tiers.npc.name`, name);
      assertClean(`${file} tiers.npc.blurb`, blurb);
      expect(name).not.toContain("者");
      expect(name).not.toMatch(/Explorer|Builder|Developer/i);
      const exp = expected[file];
      expect(exp, `missing expected for ${file}`).toBeTruthy();
      expect(name).toBe(exp.name);
      expect(blurb).toBe(exp.blurb);
    }
  });
});
