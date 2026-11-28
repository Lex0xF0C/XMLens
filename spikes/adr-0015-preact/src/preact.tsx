import { signal } from '@preact/signals';
import { render } from 'preact';
import './shared.css';

const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('Missing app host');
const shadow = host.attachShadow({ mode: 'open' });
const state = signal(0);
const labels = ['document', 'catalog', 'entry'];

function Tree() {
  const selected = state.value;
  const move = (delta: number) => {
    state.value = (state.value + delta + labels.length) % labels.length;
  };

  return (
    <section>
      <div class="tree" role="tree" aria-label="XML outline">
        {labels.map((label, index) => (
          <div
            role="treeitem"
            tabindex={index === selected ? 0 : -1}
            aria-selected={index === selected}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(event.key === 'ArrowDown' ? 1 : -1);
                requestAnimationFrame(() =>
                  shadow
                    .querySelector<HTMLElement>(
                      `[role="treeitem"]:nth-child(${state.value + 1})`,
                    )
                    ?.focus(),
                );
              }
            }}
          >
            {label}
          </div>
        ))}
      </div>
      <button onClick={() => move(1)}>Increment signal state</button>
      <p aria-live="polite">Selected: {labels[selected]}</p>
    </section>
  );
}

render(<Tree />, shadow);
