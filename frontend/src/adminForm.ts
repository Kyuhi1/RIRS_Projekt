// Skupni gradniki obrazcev na strani Administracija: polje z napako in branje vrednosti.
export interface Field {
  name: string;
  label: string;
  type: 'text' | 'number' | 'password' | 'email' | 'select' | 'checkbox';
  options?: { value: string; label: string }[]; // za select
  hint?: string;
}

export interface Form {
  element: HTMLFormElement;
  values: () => Record<string, unknown>;
  showErrors: (errors: Record<string, string>, general?: string) => void;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Obrazec z danimi polji; `initial` so začetne vrednosti, `locked` so polja, ki jih ni mogoče urejati (npr. ključ).
// Številsko polje, ki je prazno, se pošlje kot null (strežnik vrne napako »mora biti število«), ne kot 0.
export function buildForm(fields: Field[], initial: Record<string, unknown>, locked: string[] = []): Form {
  const element = make('form');
  element.noValidate = true;
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const errors = new Map<string, HTMLElement>();
  for (const field of fields) {
    const id = `admin-${field.name}`;
    const value = initial[field.name];
    let input: HTMLInputElement | HTMLSelectElement;
    if (field.type === 'select') {
      input = make('select');
      for (const o of field.options ?? []) input.append(new Option(o.label, o.value));
      input.value = String(value ?? field.options?.[0]?.value ?? '');
    } else {
      input = make('input');
      input.type = field.type === 'number' ? 'text' : field.type; // besedilo, da strežnik presodi o številu
      if (field.type === 'number') input.inputMode = 'decimal';
      if (field.type === 'checkbox') input.checked = value === true;
      else input.value = value === undefined || value === null ? '' : String(value);
    }
    input.id = id;
    input.name = field.name;
    input.disabled = locked.includes(field.name);
    inputs.set(field.name, input);
    const label = make('label', field.type === 'checkbox' ? 'inline' : undefined);
    label.htmlFor = id;
    const error = make('span', 'error');
    error.setAttribute('role', 'alert');
    errors.set(field.name, error);
    if (field.type === 'checkbox') label.append(input, document.createTextNode(field.label));
    else label.append(document.createTextNode(field.label));
    element.append(label);
    if (field.type !== 'checkbox') element.append(input);
    if (field.hint) element.append(make('p', 'hint', field.hint));
    element.append(error);
  }
  const general = make('p', 'error');
  general.setAttribute('role', 'alert');
  general.dataset.general = '';
  element.append(general);

  return {
    element,
    values: () =>
      Object.fromEntries(
        fields
          .filter((f) => !locked.includes(f.name))
          .map((f) => {
            const input = inputs.get(f.name)!;
            if (f.type === 'checkbox') return [f.name, (input as HTMLInputElement).checked];
            if (f.type === 'number') return [f.name, input.value.trim() === '' ? null : Number(input.value.trim().replace(',', '.'))];
            return [f.name, input.value];
          }),
      ),
    showErrors: (fieldErrors, message = '') => {
      for (const [name, node] of errors) node.textContent = fieldErrors[name] ?? '';
      general.textContent = message;
    },
  };
}
