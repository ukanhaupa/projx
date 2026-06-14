import type { Metadata } from 'next';
import Script from 'next/script';
import { Providers } from '../components/Providers';
import { runtimeConfigScript } from '../lib/runtime-config-script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Template',
  description:
    'Next.js application shell with auth, theming, and design tokens.',
};

const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        <Script id='runtime-config' strategy='beforeInteractive'>
          {runtimeConfigScript()}
        </Script>
        <Script id='theme-init' strategy='beforeInteractive'>
          {themeScript}
        </Script>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
