<script>
  import Icon from "./Icon.svelte";

  let { currentPage = $bindable("dashboard") } = $props();

  const navItems = [
    { id: "dashboard", icon: "Home", tooltip: "Dashboard" },
    { id: "discover", icon: "Compass", tooltip: "Discover" },
    { id: "packages", icon: "Package", tooltip: "Packages" },
    { id: "options", icon: "SlidersHorizontal", tooltip: "Options" },
    { id: "generations", icon: "History", tooltip: "Generations" },
    { id: "rebuild", icon: "Hammer", tooltip: "Rebuild" },
    { id: "updates", icon: "ArrowDownToLine", tooltip: "Updates" },
    { id: "profiles", icon: "Users", tooltip: "Profiles" },
  ];

  const secondaryItems = [
    { id: "cleanup", icon: "Trash2", tooltip: "Cleanup" },
    { id: "history", icon: "ScrollText", tooltip: "History" },
  ];

  function navigate(pageId) {
    currentPage = pageId;
  }
</script>

<div class="sidebar">
  {#each navItems as item}
    <button
      class="nav-btn"
      class:active={currentPage === item.id}
      onclick={() => navigate(item.id)}
    >
      <Icon name={item.icon} size={20} />
      <span class="tooltip">{item.tooltip}</span>
    </button>
  {/each}

  <div class="sidebar-divider"></div>

  {#each secondaryItems as item}
    <button
      class="nav-btn"
      class:active={currentPage === item.id}
      onclick={() => navigate(item.id)}
    >
      <Icon name={item.icon} size={20} />
      <span class="tooltip">{item.tooltip}</span>
    </button>
  {/each}

  <div class="sidebar-footer">
    <button
      class="nav-btn"
      class:active={currentPage === "settings"}
      onclick={() => navigate("settings")}
    >
      <Icon name="Settings" size={20} />
      <span class="tooltip">Settings</span>
    </button>
  </div>
</div>

<style>
  .sidebar {
    width: 72px;
    background: rgba(24, 24, 37, 0.95);
    padding: 16px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border-right: 1px solid rgba(49, 50, 68, 0.5);
    flex-shrink: 0;
    position: relative;
    z-index: 1000;
  }

  .nav-btn {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    background: transparent;
    border: none;
    color: inherit;
  }

  .nav-btn:hover {
    background: rgba(49, 50, 68, 0.6);
    transform: scale(1.05);
  }

  .nav-btn.active {
    background: linear-gradient(
      135deg,
      rgba(137, 180, 250, 0.8) 0%,
      rgba(180, 190, 254, 0.8) 100%
    );
    box-shadow: 0 4px 16px rgba(137, 180, 250, 0.3);
  }

  .nav-btn.active::after {
    content: "";
    position: absolute;
    left: -8px;
    width: 4px;
    height: 24px;
    background: #89b4fa;
    border-radius: 0 4px 4px 0;
    box-shadow: 0 0 12px rgba(137, 180, 250, 0.6);
  }

  .nav-btn .tooltip {
    position: absolute;
    left: 60px;
    background: rgba(49, 50, 68, 0.98);
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 100;
    border: 1px solid rgba(69, 71, 90, 0.5);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .nav-btn:hover .tooltip {
    opacity: 1;
  }

  .sidebar-divider {
    width: 32px;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(49, 50, 68, 0.8),
      transparent
    );
    margin: 8px 0;
  }

  .sidebar-footer {
    margin-top: auto;
  }
</style>
