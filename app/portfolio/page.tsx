import { PortfolioScoreboard } from "@/components/portfolio/portfolio-scoreboard";

// Het klassieke YTD-scorebord, verhuisd van / naar /portfolio bij de introductie van de
// "Vandaag"-cockpit. Ongewijzigde reporting-view.
export default function PortfolioPage() {
  return <PortfolioScoreboard />;
}
