import { redirect } from "next/navigation";

// De inzichten wonen per klant onder /client/[id] → tabblad Inzichten. Deze losse route
// toonde alleen een "fase 6"-placeholder; we leiden door naar de klantenlijst zodat er geen
// dood eindpunt meer meeloopt.
export default function InsightsPage() {
  redirect("/clients");
}
