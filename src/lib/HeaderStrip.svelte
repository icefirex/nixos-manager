<script>
  import Icon from "./Icon.svelte";

  let { systemInfo, onSystemInfoClick, onNotificationsClick, onGitClick, notificationCount = 0 } = $props();
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
    background: rgba(24, 24, 37, 0.9);
    padding: 16px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(49, 50, 68, 0.5);
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
    background: linear-gradient(135deg, #a6e3a1 0%, #94e2d5 100%);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e1e2e;
    box-shadow: 0 4px 12px rgba(166, 227, 161, 0.3);
  }

  .profile-info h3 {
    font-size: 14px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .profile-info span {
    font-size: 11px;
    color: #6c7086;
  }

  .header-status {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: 24px;
    padding-left: 24px;
    border-left: 1px solid rgba(49, 50, 68, 0.5);
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
    background: rgba(166, 227, 161, 0.12);
    border: 1px solid rgba(166, 227, 161, 0.25);
    color: #a6e3a1;
    box-shadow: 0 2px 8px rgba(166, 227, 161, 0.15);
  }

  .status-badge.healthy .status-icon {
    width: 8px;
    height: 8px;
    background: #a6e3a1;
    border-radius: 50%;
    box-shadow: 0 0 10px rgba(166, 227, 161, 0.6);
    animation: glow 2s ease-in-out infinite;
  }

  @keyframes glow {
    0%,
    100% {
      box-shadow: 0 0 8px rgba(166, 227, 161, 0.4);
    }
    50% {
      box-shadow: 0 0 16px rgba(166, 227, 161, 0.8);
    }
  }

  .status-badge.generation {
    background: rgba(137, 180, 250, 0.12);
    border: 1px solid rgba(137, 180, 250, 0.25);
    color: #89b4fa;
    box-shadow: 0 2px 8px rgba(137, 180, 250, 0.15);
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
    background: rgba(49, 50, 68, 0.8);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 8px;
    padding: 8px 16px;
    color: #cdd6f4;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .header-btn:hover {
    background: rgba(69, 71, 90, 0.6);
    border-color: rgba(137, 180, 250, 0.5);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .git-btn {
    background: rgba(250, 179, 135, 0.1);
    border-color: rgba(250, 179, 135, 0.2);
    color: #fab387;
  }

  .git-btn:hover {
    background: rgba(250, 179, 135, 0.2);
    border-color: rgba(250, 179, 135, 0.4);
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
    background: #f38ba8;
    border-radius: 9px;
    font-size: 10px;
    font-weight: 700;
    color: #1e1e2e;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(243, 139, 168, 0.4);
    animation: badge-pop 0.3s ease;
  }

  @keyframes badge-pop {
    0% { transform: scale(0); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
</style>
