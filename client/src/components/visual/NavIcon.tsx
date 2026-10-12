const paths: Record<string, string> = {
  Dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  Profile: 'M20 21v-2a7 7 0 0 0-14 0v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  Tests: 'M8 3H5v18h14V3h-3 M9 2h6v4H9z M8 11h8 M8 15h5',
  'My Tests': 'M8 3H5v18h14V3h-3 M9 2h6v4H9z M8 12l2 2 5-5',
  'Attempts / Results': 'M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h4',
  Analytics: 'M4 20V10 M10 20V4 M16 20v-8 M22 20H2',
  Resources: 'M3 5h7l2 2h9v13H3z',
};
export function NavIcon({ name }: { name: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.Tests} /></svg>;
}
