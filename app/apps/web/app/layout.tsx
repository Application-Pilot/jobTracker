/**
 * Root layout — wraps every page in the App Router.
 *
 * Lives at app/layout.tsx by Next.js convention. The single <html><body>
 * wrapper here is required; without it Next throws a runtime error.
 */

import type { ReactNode } from 'react';

export const metadata = {
  title: 'Jobtracker',
  description: 'Multi-tenant job application tracker.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#0a0a0a',
          color: '#fafafa',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
