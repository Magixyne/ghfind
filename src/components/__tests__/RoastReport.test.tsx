import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoastReport } from "@/components/RoastReport";

const SAMPLE = `## LofiSu — 54.40/100  ·  NPC (普通账号)

**称号**: 对话前台修理师

> **一句话结论**
>
> 合作价值在前台体验。

### 笑点三连

1. **双滚动条猎手**

   ant-design/x 这一笔专治两条滚动条。

2. **气泡贴边校正**

   hetaoBackend/deer-flow 修了上传文件右对齐。

3. **官网示例布置**

   apache/fory-site 补进 Scala 示例。

### 维度评分

#### 账号成熟度 · 6/10

原创仓库已经铺开。

#### 贡献质量 · 12/27

合入集中在对话前台。

**风险标记**：无

### 建议

- 把招聘技能做成可安装包。
- 给浏览器 MCP 补仓库描述。
`;

describe("RoastReport compact layout", () => {
  it("renders dimension cards and finding chips from 笑点三连 loose lists", () => {
    const html = renderToStaticMarkup(<RoastReport markdown={SAMPLE} tier="NPC" />);
    expect(html).toContain('data-tier-tone="npc"');
    expect(html).toContain('class="roast-dims"');
    expect(html).toContain('class="roast-dim-card"');
    expect(html).toContain('class="roast-dim-score"');
    expect(html).toContain('class="roast-dim-bar"');
    expect(html).toContain("账号成熟度");
    expect(html).toContain('class="roast-verdict');
    expect(html).toContain('class="roast-findings"');
    expect(html).toContain('class="roast-finding"');
    expect(html).toContain('class="roast-finding-title"');
    expect(html).toContain("双滚动条猎手");
    expect(html).toContain('class="roast-advice"');
    // Must not fall back to bare <li> for findings
    expect(html).not.toMatch(/<ol class="roast-findings">\s*<li>\s*<p/);
  });

  it("still parses legacy 扎心三连 after rewrite", () => {
    const legacy = SAMPLE.replace("笑点三连", "扎心三连");
    const html = renderToStaticMarkup(<RoastReport markdown={legacy} tier="NPC" />);
    expect(html).toContain('class="roast-finding"');
    expect(html).toContain("双滚动条猎手");
  });
});
