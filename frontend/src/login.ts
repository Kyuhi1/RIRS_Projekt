import { login, type User } from './session';

// Obrazec prijave (WF-02). Ob uspehu pokliče onSuccess z uporabnikom.
export function renderLogin(container: HTMLElement, message: string, onSuccess: (user: User) => void): void {
  container.innerHTML = `
    <h2>Prijava</h2>
    <p class="success" role="status"></p>
    <form id="login-form" novalidate>
      <label for="login-email">E-naslov</label>
      <input id="login-email" name="email" type="email" autocomplete="email" />

      <label for="login-password">Geslo</label>
      <input id="login-password" name="password" type="password" autocomplete="current-password" />

      <button type="submit">Prijava</button>
      <span class="error" role="alert" data-error="form"></span>
    </form>`;
  container.querySelector<HTMLElement>('[role=status]')!.textContent = message;

  const form = container.querySelector<HTMLFormElement>('#login-form')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;
  const error = form.querySelector<HTMLElement>('[data-error]')!;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    if (!email || !password) {
      error.textContent = 'Vnesite e-naslov in geslo';
      return;
    }
    button.disabled = true;
    const result = await login(email, password);
    button.disabled = false;
    if ('user' in result) onSuccess(result.user);
    else error.textContent = result.error;
  });
}
