import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transyt",
  description: "下载 YouTube 视频并加上字幕，按 CEFR框架 A1 到 C2 抽出单词、词组、搭配和句子进行学习",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
