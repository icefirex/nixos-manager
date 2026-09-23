<script>
  import Icon from "./Icon.svelte";

  let { currentPage = $bindable("dashboard") } = $props();

  let hasDrift = $state(false);

  $effect(() => {
    function onPendingChanges(e) {
      hasDrift = e.detail.hasDrift;
    }
    window.addEventListener('pending-changes', onPendingChanges);
    return () => window.removeEventListener('pending-changes', onPendingChanges);
  });

  const navItems = [
    { id: "dashboard", icon: "Home", tooltip: "Dashboard" },
    { id: "discover", icon: "Compass", tooltip: "Discover" },
    { id: "packages", icon: "Package", tooltip: "Packages" },
    { id: "options", icon: "SlidersHorizontal", tooltip: "Options" },
    { id: "generations", icon: "History", tooltip: "Generations" },
    { id: "rebuild", icon: "Hammer", tooltip: "Rebuild", comingSoon: true },
    { id: "updates", icon: "ArrowDownToLine", tooltip: "Updates", comingSoon: true },
    { id: "profiles", icon: "Users", tooltip: "Profiles", comingSoon: true },
  ];

  const secondaryItems = [
    { id: "changes", icon: "FileText", tooltip: "Changes" },
    { id: "cleanup", icon: "Trash2", tooltip: "Cleanup", comingSoon: true },
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
      class:coming-soon={item.comingSoon}
      onclick={item.comingSoon ? undefined : () => navigate(item.id)}
    >
      <Icon name={item.icon} size={20} />
      <span class="tooltip">{item.tooltip}{item.comingSoon ? ' (coming soon)' : ''}</span>
    </button>
  {/each}

  <div class="sidebar-divider"></div>

  {#each secondaryItems as item}
    <button
      class="nav-btn"
      class:active={currentPage === item.id}
      class:coming-soon={item.comingSoon}
      onclick={item.comingSoon ? undefined : () => navigate(item.id)}
    >
      <Icon name={item.icon} size={20} />
      {#if item.id === 'changes' && hasDrift}
        <span class="drift-dot"></span>
      {/if}
      <span class="tooltip">{item.tooltip}{item.comingSoon ? ' (coming soon)' : ''}</span>
    </button>
  {/each}

  <div class="sidebar-footer">
    <button
      class="nav-btn coming-soon"
      onclick={undefined}
    >
      <Icon name="Settings" size={20} />
      <span class="tooltip">Settings (coming soon)</span>
    </button>
  </div>
</div>

<style>
  .sidebar {
    width: 72px;
    background: rgba(var(--mantle-rgb), 0.95);
    padding: 16px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border-right: 1px solid rgba(var(--surface0-rgb), 0.5);
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

  .drift-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--yellow);
    box-shadow: 0 0 6px rgba(var(--yellow-rgb), 0.5);
  }

  .nav-btn:hover {
    background: rgba(var(--surface0-rgb), 0.6);
    transform: scale(1.05);
  }

  .nav-btn.active {
    background: linear-gradient(
      135deg,
      rgba(var(--blue-rgb), 0.8) 0%,
      rgba(var(--lavender-rgb), 0.8) 100%
    );
    box-shadow: 0 4px 16px rgba(var(--blue-rgb), 0.3);
  }

  .nav-btn.active::after {
    content: "";
    position: absolute;
    left: -8px;
    width: 4px;
    height: 24px;
    background: var(--blue);
    border-radius: 0 4px 4px 0;
    box-shadow: 0 0 12px rgba(var(--blue-rgb), 0.6);
  }

  .nav-btn .tooltip {
    position: absolute;
    left: 60px;
    background: rgba(var(--surface0-rgb), 0.98);
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 100;
    border: 1px solid rgba(var(--surface1-rgb), 0.5);
    box-shadow: 0 4px 12px rgba(var(--black-rgb), 0.3);
  }

  .nav-btn:hover .tooltip {
    opacity: 1;
  }

  .nav-btn.coming-soon {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .nav-btn.coming-soon:hover {
    opacity: 0.5;
    transform: none;
    background: transparent;
  }

  .sidebar-divider {
    width: 32px;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(var(--surface0-rgb), 0.8),
      transparent
    );
    margin: 8px 0;
  }

  .sidebar-footer {
    margin-top: auto;
  }
</style>
