<script>
  import Sidebar from "./lib/Sidebar.svelte";
  import HeaderStrip from "./lib/HeaderStrip.svelte";
  import Dashboard from "./lib/Dashboard.svelte";
  import Discover from "./lib/Discover.svelte";
  import Packages from "./lib/Packages.svelte";
  import Options from "./lib/Options.svelte";
  import Generations from "./lib/Generations.svelte";
  import SystemInfoModal from "./lib/SystemInfoModal.svelte";
  import NotificationsModal from "./lib/NotificationsModal.svelte";
  import GitModal from "./lib/GitModal.svelte";
  import TerminalOverlay from "./lib/TerminalOverlay.svelte";
  import FlakeInfoModal from "./lib/FlakeInfoModal.svelte";

  const VALID_PAGES = new Set(['dashboard', 'discover', 'packages', 'options', 'generations']);
  // UX-09: restore last active tab; fall back to dashboard for unknown values
  const _savedPage = localStorage.getItem('nixos-manager:active-tab');
  let currentPage = $state(VALID_PAGES.has(_savedPage) ? _savedPage : 'dashboard');

  // Persist active tab whenever it changes
  $effect(() => {
    localStorage.setItem('nixos-manager:active-tab', currentPage);
  });
  let showSystemInfo = $state(false);
  let showNotifications = $state(false);
  let showGit = $state(false);
  let showFlakeInfo = $state(false);
  let notificationCount = $state(0);
  let systemInfo = $state({
    profile: "",
    hostname: "",
    nixosVersion: "",
    kernelVersion: "",
    generation: 0,
    lastBuild: "",
    healthy: true,
  });

  async function loadSystemInfo() {
    try {
      systemInfo = await window.electronAPI.getSystemInfo();
    } catch (e) {
      console.error("Failed to load system info:", e);
    }
  }

  async function loadNotificationCount() {
    try {
      const notifications = await window.electronAPI.getNotifications();
      // Mirror the dismissed-IDs filter from NotificationsModal so the badge
      // stays accurate even when the modal is closed or the check fires in the background.
      let dismissed = new Set();
      try {
        const raw = sessionStorage.getItem('nixos-manager:dismissed-notifications');
        if (raw) dismissed = new Set(JSON.parse(raw));
      } catch {}
      notificationCount = notifications.filter(n => !dismissed.has(n.id)).length;
    } catch (e) {
      console.error("Failed to load notifications:", e);
      notificationCount = 0;
    }
  }

  $effect(() => {
    loadSystemInfo();
    loadNotificationCount();

    // Background flake update check — runs once on launch, updates badges + notifications
    window.electronAPI.checkFlakeInputUpdates().catch(() => {});
    const cleanupFlake = window.electronAPI.onFlakeUpdateCheckComplete(() => {
      loadNotificationCount();
    });
    return cleanupFlake;
  });

  let isMaximized = $state(false);
  let appVersion = $state('');

  $effect(() => {
    window.electronAPI.getVersion().then(v => {
      appVersion = v || '';
    }).catch(() => {});
  });

  $effect(() => {
    const cleanup = window.electronAPI.onShowUpdates(() => {
      showGit = true;
    });
    return cleanup;
  });

  function handleMinimize() {
    window.electronAPI.minimize();
  }

  async function handleMaximize() {
    isMaximized = await window.electronAPI.maximize();
  }

  function handleClose() {
    window.electronAPI.close();
  }
</script>

<div class="app-container">
  <div class="title-bar">
    <div class="title-left">
      <span class="title-text">NixOS Manager</span>
    </div>
    <div class="window-controls">
      {#if appVersion}
        <span class="app-version">v{appVersion}</span>
      {/if}
      <button class="control-btn minimize" onclick={handleMinimize} title="Minimize">
        <span class="btn-icon">−</span>
      </button>
      <button class="control-btn maximize" onclick={handleMaximize} title="Maximize">
        <span class="btn-icon">□</span>
      </button>
      <button class="control-btn close" onclick={handleClose} title="Close">
        <span class="btn-icon">×</span>
      </button>
    </div>
  </div>
  <div class="main-container">
    <Sidebar bind:currentPage />

    <div class="content">
      <HeaderStrip {systemInfo} {notificationCount} onSystemInfoClick={() => showSystemInfo = true} onNotificationsClick={() => showNotifications = true} onGitClick={() => showGit = true} onFlakeInfoClick={() => showFlakeInfo = true} />

      {#if currentPage === "dashboard"}
        <Dashboard {systemInfo} />
      {:else if currentPage === "discover"}
        <Discover />
      {:else if currentPage === "packages"}
        <Packages />
      {:else if currentPage === "options"}
        <Options />
      {:else if currentPage === "generations"}
        <Generations />
      {:else}
        <div class="placeholder-page">
          <h2>{currentPage}</h2>
          <p>Coming soon...</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<SystemInfoModal show={showSystemInfo} onClose={() => showSystemInfo = false} />
<NotificationsModal show={showNotifications} onClose={() => { showNotifications = false; loadNotificationCount(); }} onCountChange={(n) => { notificationCount = n; }} />
<GitModal show={showGit} onClose={() => showGit = false} />
<FlakeInfoModal show={showFlakeInfo} onClose={() => showFlakeInfo = false} />
<TerminalOverlay />

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(html),
  :global(body),
  :global(#app) {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  :global(body) {
    font-family: "Segoe UI", "Noto Sans", sans-serif;
    background: #1e1e2e;
    color: #cdd6f4;
  }

  .app-container {
    width: 100%;
    height: 100%;
    background: #1e1e2e;
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(69, 71, 90, 0.8);
    overflow: hidden;
  }

  .title-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    background: rgba(24, 24, 37, 0.95);
    border-bottom: 1px solid rgba(49, 50, 68, 0.5);
    padding: 0 16px;
    -webkit-app-region: drag;
    flex-shrink: 0;
  }

  .title-left {
    display: flex;
    align-items: center;
  }

  .title-text {
    font-size: 13px;
    font-weight: 500;
    color: #6c7086;
    user-select: none;
  }

  .window-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    -webkit-app-region: no-drag;
  }

  .app-version {
    font-size: 11px;
    color: rgba(205, 214, 244, 0.4);
    margin-right: 8px;
    font-weight: 400;
  }

  .control-btn {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .btn-icon {
    font-size: 10px;
    font-weight: bold;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s ease;
    color: rgba(0, 0, 0, 0.7);
  }

  .control-btn:hover .btn-icon {
    opacity: 1;
  }

  .control-btn.minimize {
    background: #f9e2af;
    box-shadow: 0 0 8px rgba(249, 226, 175, 0.4);
  }

  .control-btn.minimize:hover {
    box-shadow: 0 0 12px rgba(249, 226, 175, 0.7);
    transform: scale(1.1);
  }

  .control-btn.maximize {
    background: #a6e3a1;
    box-shadow: 0 0 8px rgba(166, 227, 161, 0.4);
  }

  .control-btn.maximize:hover {
    box-shadow: 0 0 12px rgba(166, 227, 161, 0.7);
    transform: scale(1.1);
  }

  .control-btn.close {
    background: #f38ba8;
    box-shadow: 0 0 8px rgba(243, 139, 168, 0.4);
  }

  .control-btn.close:hover {
    box-shadow: 0 0 12px rgba(243, 139, 168, 0.7);
    transform: scale(1.1);
  }

  .main-container {
    display: flex;
    flex: 1;
    min-height: 0;
    width: 100%;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .placeholder-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #6c7086;
  }

  .placeholder-page h2 {
    font-size: 24px;
    text-transform: capitalize;
    margin-bottom: 8px;
  }
</style>
