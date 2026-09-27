document.addEventListener('DOMContentLoaded', () => {
  // auto-dismiss toasts
  document.querySelectorAll('.app-toast').forEach(t => {
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(30px)'; setTimeout(() => t.remove(), 300); }, 4500);
  });

  // Manual toast close button (event delegation — works for any toast, present or future)
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="close-toast"]')) {
      e.target.closest('.app-toast')?.remove();
    }
  });

  // Sidebar toggle (dashboard mobile)
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.querySelector('.dash-sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== sidebarToggle) {
        sidebar.classList.remove('open');
      }
    });
  }

  // Favorite toggle buttons
  document.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const productId = btn.dataset.productId;
      try {
        const res = await fetch(`/api/favorites/toggle/${productId}`, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          btn.classList.toggle('active', data.favorited);
          btn.querySelector('i').className = data.favorited ? 'bi bi-heart-fill' : 'bi bi-heart';
        } else if (res.status === 401 || data.error) {
          window.location.href = '/auth/login';
        }
      } catch (err) { console.error(err); }
    });
  });

  // Notification mark-as-read
  document.querySelectorAll('.notif-item[data-notif-id]').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.notifId;
      fetch(`/api/notifications/mark-read/${id}`, { method: 'POST' }).catch(() => {});
    });
  });
  const markAllBtn = document.getElementById('markAllReadBtn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      await fetch('/api/notifications/mark-all-read', { method: 'POST' });
      document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
      window.location.reload();
    });
  }

  // Quantity steppers
  document.querySelectorAll('.qty-stepper').forEach(stepper => {
    const input = stepper.querySelector('input');
    stepper.querySelector('.qty-minus')?.addEventListener('click', () => {
      input.value = Math.max(1, parseInt(input.value || 1) - 1);
      input.dispatchEvent(new Event('change'));
    });
    stepper.querySelector('.qty-plus')?.addEventListener('click', () => {
      input.value = parseInt(input.value || 1) + 1;
      input.dispatchEvent(new Event('change'));
    });
  });

  // Generic confirm-submit forms (delete actions)
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
});
