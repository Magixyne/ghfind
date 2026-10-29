import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileEvaluateWait } from "@/components/ProfileEvaluateWait";

describe("ProfileEvaluateWait", () => {
  it("renders the profile skeleton and active stage while fetching", () => {
    const html = renderToStaticMarkup(
      <ProfileEvaluateWait
        username="octo-demo"
        phase="fetch"
        stageLabel="Fetching data"
        stageLabels={["Fetching data", "Analyzing repos", "Writing the roast"]}
        percent={12}
      />,
    );
    expect(html).toContain("@octo-demo");
    expect(html).toContain("Fetching data");
    expect(html).toContain('data-profile-evaluate="fetch"');
    expect(html).toContain('data-phase="fetch"');
    expect(html).toContain('data-active="1"');
    expect(html).toContain("12%");
  });

  it("shows a retry action on timeout without claiming progress chips", () => {
    const html = renderToStaticMarkup(
      <ProfileEvaluateWait
        username="octo-demo"
        phase="timeout"
        stageLabel="Writing the roast"
        stageLabels={["Fetching data", "Analyzing repos", "Writing the roast"]}
        percent={40}
        errorLabel="This is taking too long."
        retryLabel="Retry"
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('data-profile-evaluate="timeout"');
    expect(html).toContain("This is taking too long.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("12%");
  });
});
