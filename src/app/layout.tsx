import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LG 트윈스 AI 제구 예측 플랫폼 (DEMO)",
  description:
    "투수·구종·구속·상황별 제구 성공 확률을 예측하는 AI 대시보드. 모든 학습 데이터는 합성(DEMO)이며 팬 학습용 비공식 프로젝트입니다.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#111111" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
