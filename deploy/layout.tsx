import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "人类社会实验室 · Society Lab",
  description:
    "上帝视角的社会演化沙盒：创造一个世界，观察文明从原始部落生长、分化与变革，在关键时刻以神力改写历史的走向。",
  keywords: ["Society Lab", "社会演化", "沙盒", "上帝模拟", "文明模拟"],
  authors: [{ name: "Society Lab" }],
  icons: { icon: "/game/favicon.svg" },
  openGraph: {
    title: "人类社会实验室 · Society Lab",
    description: "上帝视角的社会演化沙盒——历史在玩家的意料之外自然发生。",
    siteName: "Society Lab",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">{children}</body>
    </html>
  );
}
