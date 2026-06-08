<script>
  import Terminal from "./Terminal.svelte";

  let showTerminal = $state(false);
  let terminalExpanded = $state(true);
  let terminalHeight = $state(320);
  let isDragging = $state(false);
  let terminalComponent = $state(null);
  let terminalTitle = $state('Terminal');
  let isRunning = $state(false);
  let hasError = $state(false);
  let isTryProcess = $state(false);
  let showKillConfirm = $state(false);
  let pendingAction = $state(null); // 'close' or 'new-try'

  // Clamp terminal height when window resizes
  $effect(() => {
    function handleResize() {
      const maxHeight = window.innerHeight - 100;
      if (terminalHeight > maxHeight) {
        terminalHeight = Math.max(150, maxHeight);
      }
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  // Listen for terminal show requests
  $effect(() => {
    window.electronAPI.onTerminalShow((data) => {
      showTerminal = true;
      terminalExpanded = true;
      isRunning = true;
      hasError = false;
      isTryProcess = data?.isTry || false;
      if (data?.title) {
        terminalTitle = data.title;
      }
      // Clear terminal for new session
      if (terminalComponent) {
        terminalComponent.clear();
      }
    });
  });

  // Listen for build output
  $effect(() => {
    window.electronAPI.onBuildOutput((data) => {
      if (terminalComponent) {
        terminalComponent.write(data);
      }
      // Detect completion/error from output
      if (data.includes('exited successfully') || data.includes('completed successfully')) {
        isRunning = false;
        hasError = false;
      } else if (data.includes('exited with code') || data.includes('failed') || data.includes('was terminated')) {
        isRunning = false;
        hasError = data.includes('failed') || data.includes('exited with code');
      }
    });
  });

  // Listen for try process ended
  $effect(() => {
    window.electronAPI.onTryProcessEnded(() => {
      isTryProcess = false;
      isRunning = false;
    });
  });

  function requestClose() {
    if (isTryProcess && isRunning) {
      pendingAction = 'close';
      showKillConfirm = true;
    } else {
      closeTerminal();
    }
  }

  async function closeTerminal() {
    if (isTryProcess) {
      await window.electronAPI.discoverKillTry();
    }
    showTerminal = false;
    isTryProcess = false;
    showKillConfirm = false;
    pendingAction = null;
    if (terminalComponent) {
      terminalComponent.clear();
    }
  }

  function toggleTerminal() {
    terminalExpanded = !terminalExpanded;
  }

  function handleDragStart(e) {
    isDragging = true;
    e.preventDefault();

    const startY = e.clientY;
    const startHeight = terminalHeight;

    function onMouseMove(e) {
      const delta = startY - e.clientY;
      const newHeight = Math.min(Math.max(startHeight + delta, 150), window.innerHeight - 200);
      terminalHeight = newHeight;
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  async function confirmKill() {
    await window.electronAPI.discoverKillTry();
    showKillConfirm = false;

    if (pendingAction === 'close') {
      showTerminal = false;
      if (terminalComponent) {
        terminalComponent.clear();
      }
    }
    pendingAction = null;
    isTryProcess = false;
  }

  function cancelKill() {
    showKillConfirm = false;
    pendingAction = null;
  }

  // Export method to check if a try process is running (for Discover to use)
  export async function checkTryRunning() {
    const status = await window.electronAPI.discoverIsTrying();
    return status;
  }

  // Export method to request killing before new try
  export function requestKillForNewTry(callback) {
    if (isTryProcess && isRunning) {
      pendingAction = 'new-try';
      showKillConfirm = true;
      // Store callback to call after kill
      window._pendingTryCallback = callback;
    } else {
      callback();
    }
  }
</script>

{#if showTerminal}
  <div
    class="terminal-overlay"
    class:collapsed={!terminalExpanded}
    style="--terminal-height: {terminalExpanded ? terminalHeight : 48}px"
  >
    <!-- Drag handle -->
    <div
      class="terminal-drag-handle"
      onmousedown={handleDragStart}
      class:dragging={isDragging}
    >
      <div class="drag-indicator"></div>
    </div>

    <!-- Header -->
    <div class="terminal-header">
      <div class="terminal-title">
        {#if isRunning}
          <span class="spinner-inline"></span>
        {:else if hasError}
          <span class="status-dot error"></span>
        {:else}
          <span class="status-dot success"></span>
        {/if}
        <span class="title-text">{terminalTitle}</span>
      </div>
      <div class="terminal-controls">
        <button class="terminal-btn" onclick={toggleTerminal} title={terminalExpanded ? "Minimize" : "Expand"}>
          {terminalExpanded ? "−" : "□"}
        </button>
        <button class="terminal-btn close" onclick={requestClose} title="Close">
          ×
        </button>
      </div>
    </div>

    <!-- Terminal content -->
    <div class="terminal-content" class:hidden={!terminalExpanded}>
      <Terminal bind:this={terminalComponent} />
    </div>
  </div>
{/if}

<!-- Kill confirmation dialog -->
{#if showKillConfirm}
  <div class="confirm-overlay" onclick={cancelKill}>
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="confirm-header">
        <span class="confirm-icon">⚠️</span>
        <h3>Application Running</h3>
      </div>
      <p class="confirm-message">
        {#if pendingAction === 'close'}
          Closing the terminal will terminate the running application.
        {:else}
          Starting a new application will terminate the currently running one.
        {/if}
      </p>
      <div class="confirm-actions">
        <button class="confirm-btn cancel" onclick={cancelKill}>Cancel</button>
        <button class="confirm-btn kill" onclick={confirmKill}>
          {pendingAction === 'close' ? 'Close & Kill' : 'Kill & Continue'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .terminal-overlay {
    position: fixed;
    bottom: 1px;
    left: 73px;
    right: 1px;
    height: var(--terminal-height);
    background: rgba(17, 17, 27, 0.98);
    border-top: 1px solid rgba(137, 180, 250, 0.3);
    border-left: 1px solid rgba(49, 50, 68, 0.5);
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    z-index: 100;
    transition: height 0.2s ease;
    backdrop-filter: blur(12px);
  }

  .terminal-overlay.collapsed {
    height: 48px;
  }

  .terminal-drag-handle {
    height: 12px;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(24, 24, 37, 0.9);
    border-bottom: 1px solid rgba(49, 50, 68, 0.3);
    transition: background 0.15s;
  }

  .terminal-drag-handle:hover,
  .terminal-drag-handle.dragging {
    background: rgba(137, 180, 250, 0.1);
  }

  .drag-indicator {
    width: 48px;
    height: 4px;
    background: rgba(69, 71, 90, 0.8);
    border-radius: 2px;
    transition: background 0.15s;
  }

  .terminal-drag-handle:hover .drag-indicator,
  .terminal-drag-handle.dragging .drag-indicator {
    background: rgba(137, 180, 250, 0.5);
  }

  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    background: rgba(24, 24, 37, 0.95);
    border-bottom: 1px solid rgba(49, 50, 68, 0.5);
    flex-shrink: 0;
  }

  .terminal-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 500;
    color: #cdd6f4;
  }

  .spinner-inline {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .status-dot.success {
    background: #a6e3a1;
    box-shadow: 0 0 8px rgba(166, 227, 161, 0.5);
  }

  .status-dot.error {
    background: #f38ba8;
    box-shadow: 0 0 8px rgba(243, 139, 168, 0.5);
  }

  .terminal-controls {
    display: flex;
    gap: 8px;
  }

  .terminal-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: rgba(49, 50, 68, 0.8);
    color: #a6adc8;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .terminal-btn:hover {
    background: rgba(69, 71, 90, 0.9);
    color: #cdd6f4;
  }

  .terminal-btn.close:hover {
    background: rgba(243, 139, 168, 0.3);
    color: #f38ba8;
  }

  .terminal-content {
    flex: 1;
    overflow: hidden;
    background: #11111b;
  }

  .terminal-content.hidden {
    display: none;
  }

  /* Confirmation Dialog */
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .confirm-dialog {
    background: #1e1e2e;
    border: 1px solid rgba(69, 71, 90, 0.6);
    border-radius: 12px;
    padding: 20px;
    max-width: 360px;
    width: 90%;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .confirm-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .confirm-icon {
    font-size: 24px;
  }

  .confirm-header h3 {
    font-size: 16px;
    font-weight: 600;
    color: #f9e2af;
    margin: 0;
  }

  .confirm-message {
    font-size: 14px;
    color: #a6adc8;
    margin: 0 0 20px 0;
    line-height: 1.5;
  }

  .confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .confirm-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .confirm-btn.cancel {
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.5);
    color: #a6adc8;
  }

  .confirm-btn.cancel:hover {
    background: rgba(69, 71, 90, 0.5);
    color: #cdd6f4;
  }

  .confirm-btn.kill {
    background: rgba(243, 139, 168, 0.2);
    border: 1px solid rgba(243, 139, 168, 0.4);
    color: #f38ba8;
  }

  .confirm-btn.kill:hover {
    background: rgba(243, 139, 168, 0.3);
  }
</style>
