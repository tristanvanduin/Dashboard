import { Suspense } from "react";
import { ClientDashboard } from "@/components/dashboard/client-dashboard";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function ClientPage({ params }: Props) {
  const { clientId } = await params;

  // Don't validate against a hardcoded list — API clients are stored client-side.
  // The dashboard component handles missing data gracefully.
  // Suspense: het dashboard leest ?geo= (beurs-scope uit het menu, Fase 3) via useSearchParams.
  return (
    <Suspense>
      <ClientDashboard client={{ id: clientId, name: clientId, source: "google-ads" }} />
    </Suspense>
  );
}
