import Link from 'next/link';

export default function NotFound() {
  return <main className="not-found"><p className="eyebrow">404 · Screensaver</p><h1>Page not found</h1><p>This page may have moved.</p><Link className="hig-button" data-intent="primary" href="/">Back to downloads</Link></main>;
}
