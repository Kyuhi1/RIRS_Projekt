import { postJson } from './api';

const FIELDS = ['name', 'email', 'password', 'role'] as const;
type Field = (typeof FIELDS)[number];

// Obrazec registracije (WF-01). Ob uspehu pokliče onSuccess s potrditvenim sporočilom.
export function renderRegister(container: HTMLElement, onSuccess: (message: string) => void): void {
  container.innerHTML = `
    <h2>Registracija</h2>
    <form id="register-form" novalidate>
      <label for="name">Ime in priimek</label>
      <input id="name" name="name" autocomplete="name" />
      <span class="error" data-error="name"></span>

      <label for="email">E-naslov</label>
      <input id="email" name="email" type="email" autocomplete="email" />
      <span class="error" data-error="email"></span>

      <label for="password">Geslo (najmanj 8 znakov)</label>
      <input id="password" name="password" type="password" autocomplete="new-password" />
      <span class="error" data-error="password"></span>

      <label for="role">Vloga</label>
      <select id="role" name="role">
        <option value="">Izberite vlogo</option>
        <option value="trader">Trgovec</option>
        <option value="mentor">Mentor</option>
      </select>
      <span class="error" data-error="role"></span>

      <button type="submit">Ustvari račun</button>
      <span class="error" data-error="form"></span>
    </form>`;

  const form = container.querySelector<HTMLFormElement>('#register-form')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;

  const showErrors = (errors: Partial<Record<Field | 'form', string>>) => {
    form.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => {
      el.textContent = errors[el.dataset.error as Field | 'form'] ?? '';
    });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showErrors({});
    button.disabled = true;
    try {
      const values = Object.fromEntries(FIELDS.map((f) => [f, (form.elements.namedItem(f) as HTMLInputElement).value]));
      const { status, data } = await postJson('/api/auth/register', values);
      if (status === 201) {
        form.reset();
        onSuccess('Račun je ustvarjen. Zdaj se lahko prijavite.');
      } else if ((status === 400 || status === 409) && data && typeof data === 'object' && 'errors' in data) {
        showErrors((data as { errors: Partial<Record<Field, string>> }).errors);
      } else {
        showErrors({ form: 'Registracija ni uspela, poskusite znova.' });
      }
    } catch {
      showErrors({ form: 'Strežnik ni dosegljiv, poskusite znova.' });
    } finally {
      button.disabled = false;
    }
  });
}
