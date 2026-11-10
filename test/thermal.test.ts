import { test } from "node:test";
import assert from "node:assert/strict";
import { thermalGuard } from "../server/thermal.ts";

test("thermal guard status and configuration", () => {
  const status = thermalGuard.status();
  assert.equal(typeof status.enabled, "boolean");
  assert.equal(typeof status.threshold, "number");
  assert.ok(status.threshold >= 60 && status.threshold <= 90);

  thermalGuard.configure({ enabled: false, threshold: 80 });
  const updated = thermalGuard.status();
  assert.equal(updated.enabled, false);
  assert.equal(updated.threshold, 80);

  // restore default
  thermalGuard.configure({ enabled: true, threshold: 78 });
  assert.equal(thermalGuard.status().enabled, true);
});
