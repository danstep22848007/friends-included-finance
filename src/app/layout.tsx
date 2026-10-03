import type { Metadata } from 'next';
import './style.css';

export const metadata: Metadata = {
  title: 'Friends Included Finance',
  description: 'Fictional wedding guest agency finance system',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
