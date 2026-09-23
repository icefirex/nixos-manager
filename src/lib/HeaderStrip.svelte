<script>
  import Icon from "./Icon.svelte";

  let { systemInfo, onSystemInfoClick, onNotificationsClick, onGitClick, onFlakeInfoClick, notificationCount = 0 } = $props();
</script>

<div class="header-strip">
  <div class="current-profile">
    <div class="profile-avatar"><Icon name="Snowflake" size={18} /></div>
    <div class="profile-info">
      <h3>{systemInfo.profile} @ {systemInfo.hostname}</h3>
      <span
        >NixOS {systemInfo.nixosVersion} · Kernel {systemInfo.kernelVersion} · Last
        build {systemInfo.lastBuild}</span
      >
    </div>
    <div class="header-status">
      <div class="status-badge" class:healthy={systemInfo.healthy}>
        <span class="status-icon"></span>
        <span>{systemInfo.healthy ? "Healthy" : "Issues"}</span>
      </div>
      <div class="status-badge generation">
        <span>Generation</span>
        <span class="generation-number">#{systemInfo.generation}</span>
      </div>
    </div>
  </div>
  <div class="header-actions">
    <button class="header-btn git-btn" onclick={onGitClick}>
      <Icon name="GitBranch" size={14} /> Git
    </button>
    <button class="header-btn" onclick={onFlakeInfoClick}>Flake</button>
    <button class="header-btn" onclick={onSystemInfoClick}>System Info</button>
    <button class="header-btn notif-btn" onclick={onNotificationsClick}>
      Notifications
      {#if notificationCount > 0}
        <span class="notif-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>
      {/if}
    </button>
  </div>
</div>

<style>
  .header-strip {
    background: rgba(var(--mantle-rgb), 0.9);
    padding: 16px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(var(--surface0-rgb), 0.5);
    flex-shrink: 0;
  }

  .current-profile {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .profile-avatar {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, var(--green) 0%, var(--teal) 100%);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--base);
    box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
  }

  .profile-info h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .profile-info span {
    font-size: 11px;
    color: var(--overlay0);
  }

  .header-status {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: 24px;
    padding-left: 24px;
    border-left: 1px solid rgba(var(--surface0-rgb), 0.5);
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .status-badge:hover {
    transform: translateY(-1px);
  }

  .status-badge.healthy {
    background: rgba(var(--green-rgb), 0.12);
    border: 1px solid rgba(var(--green-rgb), 0.25);
    color: var(--green);
    box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.15);
  }

  .status-badge.healthy .status-icon {
    width: 8px;
    height: 8px;
    background: var(--green);
    border-radius: 50%;
    box-shadow: 0 0 10px rgba(var(--green-rgb), 0.6);
    animation: glow 2s ease-in-out infinite;
  }

  @keyframes glow {
    0%,
    100% {
      box-shadow: 0 0 8px rgba(var(--green-rgb), 0.4);
    }
    50% {
      box-shadow: 0 0 16px rgba(var(--green-rgb), 0.8);
    }
  }

  .status-badge.generation {
    background: rgba(var(--blue-rgb), 0.12);
    border: 1px solid rgba(var(--blue-rgb), 0.25);
    color: var(--blue);
    box-shadow: 0 2px 8px rgba(var(--blue-rgb), 0.15);
  }

  .generation-number {
    font-weight: 700;
    font-size: 12px;
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }

  .header-btn {
    background: rgba(var(--surface0-rgb), 0.8);
    border: 1px solid rgba(var(--surface1-rgb), 0.5);
    border-radius: 8px;
    padding: 8px 16px;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .header-btn:hover {
    background: rgba(var(--surface1-rgb), 0.6);
    border-color: rgba(var(--blue-rgb), 0.5);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(var(--black-rgb), 0.2);
  }

  .git-btn {
    background: rgba(var(--peach-rgb), 0.1);
    border-color: rgba(var(--peach-rgb), 0.2);
    color: var(--peach);
  }

  .git-btn:hover {
    background: rgba(var(--peach-rgb), 0.2);
    border-color: rgba(var(--peach-rgb), 0.4);
  }

  .git-btn :global(svg) {
    vertical-align: middle;
  }

  .notif-btn {
    position: relative;
  }

  .notif-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    background: var(--red);
    border-radius: 9px;
    font-size: 10px;
    font-weight: 700;
    color: var(--base);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(var(--red-rgb), 0.4);
    animation: badge-pop 0.3s ease;
  }

  @keyframes badge-pop {
    0% { transform: scale(0); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
</style>
