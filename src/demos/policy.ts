// Policy playground: the ported OpsPilot policy engine, run in the browser.
import type { DemoContext } from '../lib/demo';
import { CUSTOMERS, evaluate, type ActionType, type Role } from '../lib/policy';
import { renderActionRisks, renderDecision, renderForm, renderMatrix } from '../lib/policy-view';

export function mount({ root, used }: DemoContext): void {
  root.innerHTML = `
    <div class="playground">
      ${renderForm()}
      <div class="decision-slot" data-decision aria-live="polite"></div>
      <details class="matrix-box">
        <summary>The whole table</summary>
        ${renderMatrix()}
        <p class="ev-h">Risk by action</p>
        ${renderActionRisks()}
      </details>
    </div>`;
  const form = root.querySelector<HTMLFormElement>('[data-policy-form]')!;
  const slot = root.querySelector<HTMLElement>('[data-decision]')!;

  const update = () => {
    const f = new FormData(form);
    const customer = CUSTOMERS.find((c) => c.id === f.get('customer')) ?? CUSTOMERS[0];
    const d = evaluate(
      { action_type: f.get('action') as ActionType, target: 'checkout-api' },
      { username: 'you', role: f.get('role') as Role },
      String(f.get('env')),
      customer,
    );
    slot.innerHTML = renderDecision(d);
  };
  form.addEventListener('change', () => {
    used();
    update();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  update();
}
