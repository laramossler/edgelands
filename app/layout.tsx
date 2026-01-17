import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Edgelands - Life Operating System',
  description: 'Your conversational life operating system',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
