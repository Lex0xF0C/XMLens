import './shared.css';

const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('Missing app host');

const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = ':host { display:block }';
shadow.append(style);

let selected = 0;
const labels = ['document', 'catalog', 'entry'];
const tree = document.createElement('div');
tree.className = 'tree';
tree.setAttribute('role', 'tree');
tree.setAttribute('aria-label', 'XML outline');
const status = document.createElement('p');
status.setAttribute('aria-live', 'polite');
const button = document.createElement('button');
button.textContent = 'Increment signal-like state';
button.addEventListener('click', () => { selected = (selected + 1) % labels.length; update(); });
function update() {
  tree.replaceChildren();
  labels.forEach((label, index) => {
    const item = document.createElement('div');
    item.setAttribute('role', 'treeitem');
    item.setAttribute('tabindex', index === selected ? '0' : '-1');
    item.setAttribute('aria-selected', String(index === selected));
    item.textContent = label;
    item.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selected = (selected + (event.key === 'ArrowDown' ? 1 : labels.length - 1)) % labels.length;
        update();
        tree.querySelector<HTMLElement>(`[role="treeitem"]:nth-child(${selected + 1})`)?.focus();
      }
    });
    tree.append(item);
  });
  status.textContent = `Selected: ${labels[selected]}`;
}
shadow.append(tree, button, status);
update();
