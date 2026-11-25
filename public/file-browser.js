const fileBrowser = (() => {
 const dateFormat = new Intl.DateTimeFormat('vi-VN', {dateStyle:'medium'});

 function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
 }

 function formatSize(size) {
  if (size == null) return '';
  return size >= 1073741824 ? (size / 1073741824).toFixed(2) + ' GB' : (size / 1048576).toFixed(1) + ' MB';
 }

 function bindLayout(control, ...grids) {
  const buttons = [...control.querySelectorAll('button')];
  for (const button of buttons) {
   button.onclick = () => {
    for (const grid of grids) grid.classList.toggle('file-list', button.dataset.layout === 'list');
    for (const option of buttons) option.setAttribute('aria-pressed', String(option === button));
   };
  }
 }

 function actionsFor(name, options) {
  const menu = element('details', 'file-menu');
  const toggle = element('summary', 'file-menu-toggle', '⋯');
  toggle.setAttribute('aria-label', 'Thao tác với ' + name);
  const actions = element('div', 'file-menu-actions');
  for (const {label, action, href, disabled, danger} of options) {
   const item = element(href ? 'a' : 'button', danger ? 'file-danger' : '', label);
   if (href) {
    item.href = href;
    item.download = name;
   } else {
    item.type = 'button';
    item.disabled = !!disabled;
   }
   item.onclick = () => {
    menu.open = false;
    toggle.focus();
    action?.(item);
   };
   actions.append(item);
  }
  menu.addEventListener('toggle', () => {
   if (!menu.open) return;
   for (const other of document.querySelectorAll('.file-menu[open]')) {
    if (other !== menu) other.open = false;
   }
  });
  menu.onkeydown = event => {
   if (event.key !== 'Escape' || !menu.open) return;
   event.stopPropagation();
   event.preventDefault();
   menu.open = false;
   toggle.focus();
  };
  menu.append(toggle, actions);
  return menu;
 }

 document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.file-menu[open]')) {
   if (!menu.contains(event.target)) menu.open = false;
  }
 });

 function card({name, type, meta, open, options, quality, duration}) {
  const item = element('article', 'file-card file-' + type);
  const button = element('button', 'file-open');
  button.type = 'button';
  button.disabled = !open;
  button.onclick = open || null;
  button.setAttribute('aria-label', (type === 'folder' ? 'Mở thư mục ' : 'Xem ') + name);
  const preview = element('span', 'file-preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.append(element('span', 'file-symbol'));
  if (quality) preview.append(element('span', 'file-quality', quality));
  if (duration) preview.append(element('span', 'file-duration', duration));
  const details = element('span', 'file-details');
  const title = element('strong', 'file-name', name);
  title.title = name;
  details.append(title);
  if (meta) details.append(element('span', 'file-meta', meta));
  button.append(preview, details);
  item.append(button, actionsFor(name, options));
  return item;
 }

 function videoCard(video, {open, options, extra}) {
  const {name, width, height, duration, size, created_at: createdAt} = video;
  const time = duration > 0 ? Math.floor(duration / 60) + ':' + String(Math.floor(duration % 60)).padStart(2, '0') : '';
  const meta = [createdAt && dateFormat.format(new Date(createdAt)), formatSize(size), extra].filter(Boolean).join(' · ');
  return card({name, type:'video', meta, open, options, quality:width && height ? videoQuality(width, height) : '', duration:time});
 }

 return {bindLayout, card, element, videoCard};
})();
