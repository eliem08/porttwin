import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PortTwin — Digital Twin of the Port of Casablanca",
  description:
    "An interactive discrete-event simulation of Casablanca's landside port operations. Test truck appointment systems, night gates and berth strategies virtually — before spending a dirham on concrete.",
  keywords: [
    "digital twin",
    "port of casablanca",
    "truck appointment system",
    "port simulation",
    "discrete event simulation",
    "Morocco",
    "logistics",
  ],
  openGraph: {
    title: "PortTwin — Digital Twin of the Port of Casablanca",
    description:
      "Simulate Casablanca's port congestion crisis and test the fixes — appointment systems, night gates, berth priority — in a live digital twin.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="bg-abyss text-ink font-body antialiased">
        {children}
      </body>
    </html>
  );
}
