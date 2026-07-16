export interface StepDataAvailability {
  step: number;
  dimensions: {
    name: string;
    available: boolean;
    rowCount: number;
    note?: string;
  }[];
  promptNote: string;
}

interface AvailabilityInput {
  audienceData: unknown[];
  deviceData: unknown[];
  checkoutData: unknown[];
  creativeData: unknown[];
  keywordData: unknown[];
  productData: unknown[];
  countryData: unknown[];
  networkData: unknown[];
  scheduleData: unknown[];
}

function dimension(name: string, rows: unknown[], note?: string) {
  return {
    name,
    available: rows.length > 0,
    rowCount: rows.length,
    note,
  };
}

function renderPromptNote(step: number, dimensions: StepDataAvailability["dimensions"]): string {
  const missing = dimensions.filter((item) => !item.available);
  if (missing.length === 0) {
    return `Alle verwachte data voor stap ${step} is beschikbaar.`;
  }
  return `Let op: ${missing.map((item) => `${item.name} niet beschikbaar`).join(", ")}. Sla ontbrekende werkwijzen compact over zonder te hallucineren.`;
}

export function checkStepDataAvailability(opts: AvailabilityInput): StepDataAvailability[] {
  const byStep: Array<{ step: number; dimensions: StepDataAvailability["dimensions"] }> = [
    { step: 1, dimensions: [] },
    { step: 2, dimensions: [] },
    { step: 3, dimensions: [] },
    { step: 4, dimensions: [] },
    { step: 5, dimensions: [dimension("Keyword data", opts.keywordData)] },
    { step: 6, dimensions: [dimension("Product data", opts.productData)] },
    { step: 7, dimensions: [dimension("Keyword data", opts.keywordData), dimension("Product data", opts.productData)] },
    { step: 8, dimensions: [dimension("Creative data", opts.creativeData)] },
    { step: 9, dimensions: [dimension("Audience data", opts.audienceData)] },
    {
      step: 10,
      dimensions: [
        dimension("Device data", opts.deviceData),
        dimension("Engagement KPI data", opts.deviceData.filter((row) => {
          const record = row as Record<string, unknown>;
          return record.bounce_rate != null || record.engagement_rate != null || record.avg_session_duration != null;
        })),
      ],
    },
    { step: 11, dimensions: [dimension("Geo data", opts.countryData)] },
    {
      step: 12,
      dimensions: [
        dimension("Checkout data", opts.checkoutData),
        dimension("Schedule data", opts.scheduleData),
        dimension("Network data", opts.networkData),
      ],
    },
    { step: 13, dimensions: [] },
  ];

  return byStep.map((entry) => ({
    step: entry.step,
    dimensions: entry.dimensions,
    promptNote: renderPromptNote(entry.step, entry.dimensions),
  }));
}
