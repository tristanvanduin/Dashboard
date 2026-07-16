import type { Metadata } from "next";
import { Ubuntu, Open_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import "./globals.css";

const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Ranking Masters — SEA Dashboard",
  description: "Revenue & Conversie Forecasting Dashboard voor het SEA-team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${ubuntu.variable} ${openSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <TooltipProvider>
          <Sidebar />
          <div className="flex-1 flex flex-col min-h-screen ml-72">
            <TopBar />
            <main className="flex-1 p-6">
              {children}
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
