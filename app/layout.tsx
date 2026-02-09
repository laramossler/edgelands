import type { Metadata } from 'next';
import { Cormorant_Garamond, Karla, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
});

const karla = Karla({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-sans',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Edgelands',
  description: 'Morning Dispatch · Evening Debrief · Weekly Edgelands',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${karla.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
