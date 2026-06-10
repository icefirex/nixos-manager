<script>
  let { show = false, onClose, onCountChange } = $props();
  let notifications = $state([]);
  let loading = $state(true);

  const STORAGE_KEY = 'nixos-manager:dismissed-notifications';

  // Load persisted dismissed IDs from sessionStorage (session-scoped so that
  // notifications with the same ID but new underlying state reappear after restart)
  function loadDismissed() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveDismissed(ids) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    } catch {}
  }

  let dismissedIds = loadDismissed();

  $effect(() => {
    if (show) {
      loadNotifications();
    }
  });

  async function loadNotifications() {
    loading = true;
    try {
      const allNotifications = await window.electronAPI.getNotifications();
      // Filter out dismissed notifications
      notifications = allNotifications.filter(n => !dismissedIds.has(n.id));
      onCountChange?.(notifications.length);
    } catch (e) {
      console.error('Failed to load notifications:', e);
      notifications = [];
      onCountChange?.(0);
    } finally {
      loading = false;
    }
  }

  function dismissNotification(id) {
    dismissedIds.add(id);
    saveDismissed(dismissedIds);
    notifications = notifications.filter(n => n.id !== id);
    onCountChange?.(notifications.length);
  }

  function clearAll() {
    notifications.forEach(n => dismissedIds.add(n.id));
    saveDismissed(dismissedIds);
    notifications = [];
    onCountChange?.(0);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }

  function getTypeIcon(type) {
    switch (type) {
      case 'error': return '!';
      case 'warning': return '!';
      case 'success': return '✓';
      case 'info': return 'i';
      default: return '•';
    }
  }

  function copyAction(action) {
    navigator.clipboard.writeText(action);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <div class="modal-overlay" onclick={onClose}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2>Notifications</h2>
        <div class="header-actions">
          {#if notifications.length > 0}
            <button class="clear-all-btn" onclick={clearAll}>
              Clear All
            </button>
          {/if}
          <button class="close-btn" onclick={onClose}>x</button>
        </div>
      </div>

      {#if loading}
        <div class="loading">
          <div class="spinner"></div>
          <p>Checking system status...</p>
        </div>
      {:else if notifications.length === 0}
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          <p>All clear! No notifications.</p>
        </div>
      {:else}
        <div class="notifications-list">
          {#each notifications as notif (notif.id)}
            <div class="notification-item {notif.type}">
              <div class="notif-icon {notif.type}">
                {getTypeIcon(notif.type)}
              </div>
              <div class="notif-content">
                <div class="notif-title">{notif.title}</div>
                <div class="notif-message">{notif.message}</div>
                {#if notif.time}
                  <div class="notif-time">{notif.time}</div>
                {/if}
              </div>
              {#if notif.action}
                <button class="action-btn" onclick={() => copyAction(notif.action)} title="Copy command">
                  <code>{notif.action}</code>
                </button>
              {/if}
              <button class="dismiss-btn" onclick={() => dismissNotification(notif.id)} title="Dismiss">
                x
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background: #1e1e2e;
    border: 1px solid rgba(137, 180, 250, 0.3);
    border-radius: 20px;
    padding: 0;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(49, 50, 68, 0.5);
    background: rgba(24, 24, 37, 0.9);
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .clear-all-btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid rgba(243, 139, 168, 0.3);
    background: rgba(243, 139, 168, 0.1);
    color: #f38ba8;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .clear-all-btn:hover {
    background: rgba(243, 139, 168, 0.2);
    border-color: rgba(243, 139, 168, 0.5);
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: rgba(49, 50, 68, 0.8);
    color: #a6adc8;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
  }

  .loading, .empty-state {
    padding: 60px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    color: #a6adc8;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-icon {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: rgba(166, 227, 161, 0.15);
    border: 2px solid rgba(166, 227, 161, 0.3);
    color: #a6e3a1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
  }

  .notifications-list {
    max-height: 400px;
    overflow-y: auto;
    padding: 12px;
  }

  .notification-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px;
    margin-bottom: 8px;
    background: rgba(30, 30, 46, 0.8);
    border-radius: 12px;
    border: 1px solid rgba(49, 50, 68, 0.5);
    transition: all 0.2s;
    position: relative;
  }

  .notification-item:last-child {
    margin-bottom: 0;
  }

  .notification-item:hover {
    border-color: rgba(69, 71, 90, 0.8);
  }

  .notification-item.error {
    border-left: 3px solid #f38ba8;
  }

  .notification-item.warning {
    border-left: 3px solid #f9e2af;
  }

  .notification-item.success {
    border-left: 3px solid #a6e3a1;
  }

  .notification-item.info {
    border-left: 3px solid #89b4fa;
  }

  .notif-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .notif-icon.error {
    background: rgba(243, 139, 168, 0.15);
    color: #f38ba8;
  }

  .notif-icon.warning {
    background: rgba(249, 226, 175, 0.15);
    color: #f9e2af;
  }

  .notif-icon.success {
    background: rgba(166, 227, 161, 0.15);
    color: #a6e3a1;
  }

  .notif-icon.info {
    background: rgba(137, 180, 250, 0.15);
    color: #89b4fa;
  }

  .notif-content {
    flex: 1;
    min-width: 0;
  }

  .notif-title {
    font-size: 13px;
    font-weight: 600;
    color: #cdd6f4;
    margin-bottom: 4px;
  }

  .notif-message {
    font-size: 12px;
    color: #a6adc8;
    line-height: 1.4;
  }

  .notif-time {
    font-size: 10px;
    color: #6c7086;
    margin-top: 6px;
  }

  .action-btn {
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(49, 50, 68, 0.8);
    background: rgba(24, 24, 37, 0.9);
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .action-btn:hover {
    background: rgba(49, 50, 68, 0.8);
    border-color: rgba(137, 180, 250, 0.5);
  }

  .action-btn code {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 10px;
    color: #89b4fa;
  }

  .dismiss-btn {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #6c7086;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
    opacity: 0;
  }

  .notification-item:hover .dismiss-btn {
    opacity: 1;
  }

  .dismiss-btn:hover {
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
  }

  /* Scrollbar */
  .notifications-list::-webkit-scrollbar {
    width: 6px;
  }

  .notifications-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .notifications-list::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 3px;
  }
</style>
