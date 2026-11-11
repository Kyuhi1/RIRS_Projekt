// Tema (light/dark): privzeto po sistemski nastavitvi, ročna izbira se shrani v localStorage.
// Če localStorage ni na voljo (zasebno okno, blokirani podatki), tema deluje, le ne ostane shranjena.
export type Theme = 'light' | 'dark';

const KEY = 'theme';

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return stored() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

// Nastavi temo na <html>; en sam atribut je dovolj za vse CSS tokene.
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // brez shranjevanja
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
