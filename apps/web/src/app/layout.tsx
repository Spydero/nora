import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: { default: "Nora Health Assistant", template: "%s · Nora" },
  description: "Describe a health concern, understand a reviewed assessment, and reach appropriate care.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-canvas text-body text-fg">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
