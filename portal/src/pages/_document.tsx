import { Head, Html, Main, NextScript } from "next/document";

/** The page's frame. No inline script: the export's only one is `__NEXT_DATA__`, JSON. */
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
