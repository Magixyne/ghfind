import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_EN, TIER_LABEL_EN, TIER_ZH } from "../badge";
import { tierFor } from "../score-presentation";
import { TIER_STYLES, tierStyle } from "../tier";
import { V13_SNARK_BANNED_EN, V13_SNARK_BANNED_ZH } from "../roast-v13/voice";

/** Derogatory / mocking strings that must not appear in lowest-tier *display* copy. */
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
    expect(V13_SNARK_BANNED_ZH).toEqual(expect.arrayContaining(["拉完了", "低价值"]));
    expect(V13_SNARK_BANNED_EN.map((s) => s.toLowerCase())).toEqual(
      expect.arrayContaining(["low-value", "likely farmed"]),
    );
  });
});
