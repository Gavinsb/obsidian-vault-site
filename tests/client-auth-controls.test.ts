import { describe, expect, it } from "vitest";
import fs from "node:fs";

const app = fs.readFileSync(
  new URL("../src/client/App.tsx", import.meta.url),
  "utf8",
);
const dashboard = fs.readFileSync(
  new URL("../src/client/components/Dashboard.tsx", import.meta.url),
  "utf8",
);
const settings = fs.readFileSync(
  new URL("../src/client/components/Extras.tsx", import.meta.url),
  "utf8",
);
const syncBar = fs.readFileSync(
  new URL("../src/client/components/SyncBar.tsx", import.meta.url),
  "utf8",
);

describe("authenticated mutation controls", () => {
  it("hides new-note controls from public users", () => {
    expect(app).toContain("canCreate={!!user}");
    expect(dashboard).toContain("{user && newNote && (");
  });

  it("shows reindex only to administrators", () => {
    expect(settings).toMatch(/user\?\.role === ["']admin["']/);
    expect(settings).toContain(
      "Administrator sign-in is required to re-index.",
    );
  });

  it("keeps login in Settings and shows authenticated users in the header", () => {
    expect(app).not.toContain('className="auth-strip"');
    expect(settings).toContain("<LoginView />");
    expect(syncBar).toContain('className="header-user"');
    expect(syncBar).toContain("Signed in as ${user.username}");
  });
});
