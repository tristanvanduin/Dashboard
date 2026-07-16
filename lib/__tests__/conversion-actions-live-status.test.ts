import { mergeConversionActionsWithLiveStatus } from "../client-settings";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=== Conversion Action Live Status Tests ===\n");

console.log("1. Lead actions use primary_for_goal instead of category heuristics");
{
  const merged = mergeConversionActionsWithLiveStatus([], [
    {
      id: "1",
      name: "afspraak_bevestigd_RM",
      category: "BOOK_APPOINTMENT",
      status: "ENABLED",
      type: "WEBPAGE",
      primaryForGoal: true,
    },
    {
      id: "2",
      name: "Contact_pagina_bezocht_RM",
      category: "PAGE_VIEW",
      status: "ENABLED",
      type: "WEBPAGE",
      primaryForGoal: false,
    },
  ]);

  const appointment = merged.find((action) => action.id === "1");
  const pageView = merged.find((action) => action.id === "2");
  assert(appointment?.category === "primary", "BOOK_APPOINTMENT action should become primary when primary_for_goal is true");
  assert(pageView?.category === "secondary", "PAGE_VIEW action should remain secondary when primary_for_goal is false");
}

console.log("2. Existing includedInDashboard selection is preserved");
{
  const merged = mergeConversionActionsWithLiveStatus([
    {
      id: "1",
      name: "Calendly Zapier flow",
      category: "secondary",
      activeInAds: true,
      includedInDashboard: false,
    },
  ], [
    {
      id: "1",
      name: "Calendly Zapier flow",
      category: "SUBMIT_LEAD_FORM",
      status: "ENABLED",
      type: "UPLOAD_CLICKS",
      primaryForGoal: true,
    },
  ]);

  assert(merged[0]?.includedInDashboard === false, "live status merge should not override dashboard inclusion choice");
  assert(merged[0]?.category === "primary", "live status merge should still refresh primary category");
}

console.log("3. Removed actions are excluded from live merge");
{
  const merged = mergeConversionActionsWithLiveStatus([], [
    {
      id: "3",
      name: "Old removed goal",
      category: "CONTACT",
      status: "REMOVED",
      type: "UNIVERSAL_ANALYTICS_GOAL",
      primaryForGoal: true,
    },
  ]);

  assert(merged.length === 0, "removed actions should not be surfaced as active dashboard actions");
}

if (failed > 0) {
  console.error(`\nConversion action live status tests failed: ${failed} failed, ${passed} passed.`);
  process.exit(1);
}

console.log(`\nConversion action live status tests passed: ${passed} passed, ${failed} failed.`);
